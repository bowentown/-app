import { Wllama, CacheManager } from '@wllama/wllama';
import wasmUrl from '@wllama/wllama/esm/wasm/wllama.wasm?url';

/**
 * 端侧小模型引擎 (Qwen3-0.6B GGUF + llama.cpp WASM)
 *
 * 运行形态：llama.cpp 编译为 WebAssembly，在 WebView 的 Worker 中做 CPU 推理。
 * - 纯 Web 技术栈：无需任何原生插件，PWA 与离线 APK 行为一致；
 * - 模型按需下载（约 462 MB），由本模块自管缓存（Cache API，流式落盘不占内存）；
 * - 不使用 wllama 内置缓存层：其默认 OPFS 后端在部分 Android WebView 上缺失
 *   （无 navigator.storage.getDirectory），构造时即抛 "No supported storage backend found"，
 *   因此向其注入一个直通后端，模型通过 loadModel(Blob) 喂入；
 * - 危机/用药安全护栏不在本模块内——由调用方（AIAdvicePanel）在进入本引擎之前拦截。
 */

export const LOCAL_LLM_MODEL = {
  // 多源下载：hf-mirror 在中国大陆可达，但其 308 跳转响应可能缺失 CORS 头，
  // 失败时自动降级到 Hugging Face 官方源（响应带 CORS 头），反之亦然。
  url: 'https://hf-mirror.com/bartowski/Qwen_Qwen3-0.6B-GGUF/resolve/main/Qwen_Qwen3-0.6B-Q4_K_M.gguf',
  fallbackUrl:
    'https://huggingface.co/bartowski/Qwen_Qwen3-0.6B-GGUF/resolve/main/Qwen_Qwen3-0.6B-Q4_K_M.gguf',
  label: 'Qwen3-0.6B (Q4_K_M)',
  // 用于完整性参考与界面展示的远端文件大小（约 462 MiB）
  expectedBytes: 484_220_320,
  minFreeStorageBytes: 1_200_000_000, // 下载 + 解压缓冲余量
  minDeviceMemoryGB: 4,
};

/** 依次尝试的下载源 */
const MODEL_SOURCES: string[] = [LOCAL_LLM_MODEL.url, LOCAL_LLM_MODEL.fallbackUrl];

const LLM_CACHE_NAME = 'somnacare-llm-model';

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

const LLM_STATE_KEY = 'somnacare_llm_state';

function setLlmState(state: 'idle' | 'loading' | 'generating' | 'ready') {
  try {
    localStorage.setItem(LLM_STATE_KEY, state);
  } catch {
    // 存储不可用时忽略
  }
}

/**
 * 崩溃取证：应用被系统杀死时 localStorage 中的状态不会清除。
 * 若上次会话停留在 loading/generating，说明大概率是 WASM 峰值内存触发了 OOM 击杀。
 * 在设置页展示警告，并据此保持更保守的内存配置。
 */
export function consumeLlmCrashFlag(): 'loading' | 'generating' | null {
  try {
    const state = localStorage.getItem(LLM_STATE_KEY);
    if (state === 'loading' || state === 'generating') {
      localStorage.removeItem(LLM_STATE_KEY);
      return state;
    }
  } catch {
    // ignore
  }
  return null;
}

// 应用切到后台时卸载模型，释放约 1GB 峰值内存（下次对话从缓存数秒内重载），
// 同时避免后台状态被系统因内存压力击杀。
if (typeof document !== 'undefined') {
  document.addEventListener('visibilitychange', () => {
    if (document.hidden && !busy) {
      unloadLocalLlm();
    }
  });
}

/**
 * 直通缓存后端：wllama 构造时会急切创建 CacheManager 并探测 OPFS，
 * 在缺失 OPFS 的 WebView 上会直接抛错。模型缓存由本模块的 Cache API 自管，
 * 引擎只通过 loadModel(Blob) 读取，因此这里注入一个恒可用的空后端绕过探测。
 */
function createBypassCacheManager(): CacheManager {
  const bypassBackend = { isSupported: () => true } as any;
  return new CacheManager([bypassBackend]);
}

function createWllama(): Wllama {
  return new Wllama(
    { default: wasmUrl },
    { allowOffline: true, cacheManager: createBypassCacheManager() }
  );
}

/** 环境与资源门控：内存 ≥4GB（deviceMemory 为粗粒度档位）且剩余存储 ≥1.2GB。 */
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
  } else if (typeof caches === 'undefined') {
    supported = false;
    reason = '当前浏览器内核过旧，缺少模型缓存能力';
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

async function openModelCache(): Promise<Cache> {
  return caches.open(LLM_CACHE_NAME);
}

/** 找出已成功缓存到本地的模型源 URL（可能来自任一下载源） */
async function findCachedModelUrl(): Promise<string | null> {
  if (typeof caches === 'undefined') return null;
  try {
    const cache = await openModelCache();
    for (const url of MODEL_SOURCES) {
      const hit = await cache.match(url);
      if (hit) return url;
    }
  } catch {
    // 查询失败按未下载处理
  }
  return null;
}

/** 查询模型缓存状态。缓存条目只在完整下载后写入，存在即完整。 */
export async function getLocalLlmCacheState(): Promise<LocalLlmCacheState> {
  const cachedUrl = await findCachedModelUrl();
  if (!cachedUrl) return { cached: false, cachedBytes: 0 };
  try {
    const cache = await openModelCache();
    const hit = await cache.match(cachedUrl);
    const size = Number(hit?.headers.get('content-length') || 0);
    return { cached: true, cachedBytes: size > 0 ? size : LOCAL_LLM_MODEL.expectedBytes };
  } catch {
    return { cached: true, cachedBytes: LOCAL_LLM_MODEL.expectedBytes };
  }
}

/**
 * 流式下载模型到 Cache API：边下边写盘，内存占用恒定（不积压 462MB 到内存）。
 * 多源依次尝试：任一源成功即返回；用户取消时立即中断不再尝试下一源。
 * cache.put 只有在流被完整消费后才 resolve，因此缓存存在即下载完整。
 */
export async function downloadLocalLlm(
  onProgress: (percent: number) => void,
  signal?: AbortSignal
): Promise<void> {
  if (typeof caches === 'undefined') {
    throw new Error('当前浏览器内核过旧，缺少模型缓存能力');
  }
  let lastError: unknown = null;
  for (const url of MODEL_SOURCES) {
    if (signal?.aborted) throw lastError ?? new Error('下载已取消');
    try {
      const res = await fetch(url, { signal });
      if (!res.ok || !res.body) throw new Error(`下载源响应异常 (HTTP ${res.status})`);

      const total = Number(res.headers.get('content-length') || 0);
      let loaded = 0;
      const progressStream = new TransformStream({
        transform(chunk, controller) {
          loaded += chunk.byteLength;
          if (total > 0) onProgress(Math.min(99, Math.round((loaded / total) * 100)));
          controller.enqueue(chunk);
        },
      });
      const streamedRes = new Response(res.body.pipeThrough(progressStream));

      const cache = await openModelCache();
      await cache.put(url, streamedRes);
      onProgress(100);
      return; // 当前源下载成功
    } catch (e: any) {
      if (signal?.aborted) throw e; // 用户主动取消，不换源重试
      lastError = e;
      onProgress(0); // 复位进度，换下一源
    }
  }
  const detail = lastError instanceof Error ? lastError.message : String(lastError);
  throw new Error(detail || '所有下载源均不可用');
}

/** 删除已缓存的模型文件 */
export async function deleteLocalLlm(): Promise<void> {
  if (typeof caches === 'undefined') return;
  try {
    const cache = await openModelCache();
    for (const url of MODEL_SOURCES) {
      await cache.delete(url);
    }
  } finally {
    await unloadLocalLlm();
  }
}

/**
 * 流式生成对话回复。模型未加载时从本地缓存读取 Blob 并载入（首次约需数秒）。
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
      instance = createWllama();
    }
    if (!loadedUrl) {
      handlers.onStage?.('loading');
      setLlmState('loading');
      const cachedUrl = await findCachedModelUrl();
      if (!cachedUrl) {
        throw new Error('模型尚未下载，请先在设置中下载');
      }
      const cache = await openModelCache();
      const hit = await cache.match(cachedUrl);
      const blob = await hit?.blob();
      if (!blob || blob.size === 0) {
        throw new Error('本地模型缓存读取失败，请删除后重新下载');
      }
      // 低内存配置：n_ctx 512 + 小 batch，压制 WASM 峰值内存（GGUF 经 MEMFS + 权重会双重驻留）
      await instance.loadModel([blob], { n_ctx: 512, n_batch: 128, n_gpu_layers: 0 });
      loadedUrl = cachedUrl;
      setLlmState('ready');
    }
    handlers.onStage?.('generating');
    setLlmState('generating');

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
    setLlmState('ready');
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
