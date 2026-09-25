import { Wllama } from '@wllama/wllama';
import wasmUrl from '@wllama/wllama/esm/wasm/wllama.wasm?url';

/**
 * 端侧小模型引擎 (Qwen3-0.6B GGUF + llama.cpp WASM)
 *
 * 运行形态：llama.cpp 编译为 WebAssembly，在 WebView 的 Worker 中做 CPU 推理。
 * - 纯 Web 技术栈：无需任何原生插件，PWA 与离线 APK 行为一致；
 * - 模型按需下载（约 462 MB），缓存于浏览器 OPFS，wllama 带 ETag 完整性校验；
 * - 未开跨域隔离时自动回落单线程（WebView 默认即单线程，速度较慢属预期）；
 * - 危机/用药安全护栏不在本模块内——由调用方（AIAdvicePanel）在进入本引擎之前拦截。
 */

export const LOCAL_LLM_MODEL = {
  // 多源下载：hf-mirror 在中国大陆可达，但其 308 跳转响应可能缺失 CORS 头，
  // 失败时自动降级到 Hugging Face 官方源（响应带 CORS 头），反之亦然。
  url: 'https://hf-mirror.com/bartowski/Qwen_Qwen3-0.6B-GGUF/resolve/main/Qwen_Qwen3-0.6B-Q4_K_M.gguf',
  fallbackUrl:
    'https://huggingface.co/bartowski/Qwen_Qwen3-0.6B-GGUF/resolve/main/Qwen_Qwen3-0.6B-Q4_K_M.gguf',
  label: 'Qwen3-0.6B (Q4_K_M)',
  // 用于完整性参考的远端文件大小（约 462 MiB）
  expectedBytes: 484_220_320,
  minFreeStorageBytes: 1_200_000_000, // 下载 + 解压缓冲余量
  minDeviceMemoryGB: 4,
};

/** 依次尝试的下载源 */
const MODEL_SOURCES: string[] = [LOCAL_LLM_MODEL.url, LOCAL_LLM_MODEL.fallbackUrl];

export interface LocalLlmSupport {
  supported: boolean;
  reason?: string;
  deviceMemoryGB: number | null;
  freeStorageGB: number | null;
}

export interface LocalLlmCacheState {
  cached: boolean;
  cachedBytes: number;
}

export type LocalLlmStage = 'loading' | 'generating';

let instance: Wllama | null = null;
let loadedUrl: string | null = null;
let busy = false;

/**
 * 环境与资源门控：内存 ≥4GB（deviceMemory 为粗粒度档位）且剩余存储 ≥1.2GB。
 * deviceMemory 不可用时放行（未知 ≠ 不支持），交由用户在设置页自行决定。
 */
export async function getLocalLlmSupport(): Promise<LocalLlmSupport> {
  const nav = navigator as any;
  const deviceMemoryGB: number | null = typeof nav.deviceMemory === 'number' ? nav.deviceMemory : null;

  let freeStorageGB: number | null = null;
  if (navigator.storage && navigator.storage.estimate) {
    try {
      const est = await navigator.storage.estimate();
      if (typeof est.quota === 'number' && typeof est.usage === 'number') {
        freeStorageGB = (est.quota - est.usage) / 1024 ** 3;
      }
    } catch {
      // 存储配额不可查询，视为未知
    }
  }

  let supported = true;
  let reason: string | undefined;
  if (deviceMemoryGB !== null && deviceMemoryGB < LOCAL_LLM_MODEL.minDeviceMemoryGB) {
    supported = false;
    reason = `设备可用内存档位不足（${deviceMemoryGB}GB < ${LOCAL_LLM_MODEL.minDeviceMemoryGB}GB）`;
  } else if (freeStorageGB !== null && freeStorageGB < LOCAL_LLM_MODEL.minFreeStorageBytes / 1024 ** 3) {
    supported = false;
    reason = `剩余存储空间不足（${freeStorageGB.toFixed(1)}GB）`;
  }

  return { supported, reason, deviceMemoryGB, freeStorageGB };
}

/** 请求持久化存储，避免健康数据与模型缓存被系统在存储压力下清除 */
export async function ensureStoragePersistence(): Promise<boolean> {
  try {
    if (navigator.storage && navigator.storage.persist) {
      const already = await navigator.storage.persisted();
      if (already) return true;
      return await navigator.storage.persist();
    }
  } catch {
    // 部分环境不支持，忽略
  }
  return false;
}

/** 找出已成功缓存到本地的模型源 URL（可能来自任一下载源） */
async function findCachedModelUrl(): Promise<string | null> {
  const probe = new Wllama({ default: wasmUrl });
  try {
    for (const url of MODEL_SOURCES) {
      try {
        const name = await probe.cacheManager.getNameFromURL(url);
        const size = await probe.cacheManager.getSize(name);
        if (size !== null && size > 0) return url;
      } catch {
        // 该源未缓存，继续检查下一个
      }
    }
  } finally {
    await probe.exit();
  }
  return null;
}

/** 查询模型缓存状态（wllama 默认后端为 OPFS，按原始 URL 寻址） */
export async function getLocalLlmCacheState(): Promise<LocalLlmCacheState> {
  try {
    const cachedUrl = await findCachedModelUrl();
    if (cachedUrl) {
      const probe = new Wllama({ default: wasmUrl });
      try {
        const name = await probe.cacheManager.getNameFromURL(cachedUrl);
        const size = await probe.cacheManager.getSize(name);
        if (size !== null && size > 0) {
          return { cached: true, cachedBytes: size };
        }
      } finally {
        await probe.exit();
      }
    }
  } catch {
    // 查询失败按未下载处理
  }
  return { cached: false, cachedBytes: 0 };
}

/**
 * 下载模型到本地缓存（仅落盘，不载入内存，避免数百 MB 的内存尖峰）。
 * 多源依次尝试：任一源成功即返回；用户取消时立即中断不再尝试下一源。
 */
export async function downloadLocalLlm(
  onProgress: (percent: number) => void,
  signal?: AbortSignal
): Promise<void> {
  const wllama = new Wllama(
    { default: wasmUrl },
    { allowOffline: true, parallelDownloads: 3 }
  );
  let lastError: unknown = null;
  try {
    for (const url of MODEL_SOURCES) {
      if (signal?.aborted) throw lastError ?? new Error('下载已取消');
      try {
        await wllama.cacheManager.download(url, {
          progressCallback: ({ loaded, total }) => {
            if (total > 0) onProgress(Math.min(100, Math.round((loaded / total) * 100)));
          },
          signal,
        });
        return; // 当前源下载成功
      } catch (e: any) {
        if (signal?.aborted) throw e; // 用户主动取消，不换源重试
        lastError = e;
        onProgress(0); // 复位进度，换下一源
      }
    }
    throw lastError ?? new Error('所有下载源均不可用');
  } finally {
    await wllama.exit();
  }
}

/** 删除已缓存的模型文件 */
export async function deleteLocalLlm(): Promise<void> {
  const probe = new Wllama({ default: wasmUrl });
  try {
    await probe.cacheManager.delete(LOCAL_LLM_MODEL.url);
    await probe.cacheManager.delete(LOCAL_LLM_MODEL.fallbackUrl);
  } finally {
    await probe.exit();
  }
  if (loadedUrl !== null) {
    // 缓存被删后常驻实例不再有效
    await unloadLocalLlm();
  }
}

/**
 * 流式生成对话回复。模型未加载时先用缓存加载（首次约需数秒）。
 * 返回完整回复文本；调用方通过 onToken 逐段收到增量。
 */
export async function generateLocalLlmReply(
  messages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }>,
  handlers: {
    onToken: (token: string) => void;
    onStage?: (stage: LocalLlmStage) => void;
  },
  signal?: AbortSignal
): Promise<string> {
  if (busy) {
    throw new Error('端侧模型正在处理中，请稍候');
  }
  busy = true;
  try {
    if (!instance) {
      instance = new Wllama(
        { default: wasmUrl },
        { allowOffline: true, parallelDownloads: 3 }
      );
    }
    if (!loadedUrl) {
      handlers.onStage?.('loading');
      // 优先加载已缓存的源；本地没有任何缓存时才回退到主源（会触发在线下载）
      const cachedUrl = await findCachedModelUrl();
      const loadFrom = cachedUrl ?? LOCAL_LLM_MODEL.url;
      await instance.loadModelFromUrl(loadFrom, {
        useCache: true,
        n_ctx: 1024,
        n_gpu_layers: 0,
      });
      loadedUrl = loadFrom;
    }
    handlers.onStage?.('generating');

    let full = '';
    await instance.createChatCompletion({
      messages: messages as any,
      stream: true,
      onData: (chunk: any) => {
        const token: string = chunk?.choices?.[0]?.delta?.content ?? '';
        if (token) {
          full += token;
          handlers.onToken(token);
        }
      },
      max_tokens: 320,
      temperature: 0.7,
      cache_prompt: true,
      abortSignal: signal,
    } as any);
    return full;
  } finally {
    busy = false;
  }
}

/** 显式卸载模型并释放内存（不影响已缓存的模型文件） */
export async function unloadLocalLlm(): Promise<void> {
  if (instance) {
    try {
      await instance.exit();
    } catch {
      // exit 对未加载状态是安全的
    }
    instance = null;
    loadedUrl = null;
  }
}
