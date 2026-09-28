/**
 * 全局护眼滤镜：原生悬浮窗（需"显示在其他应用上层"权限）+ Web 端应用内回退。
 * 参考"夜间护眼"类应用的核心机制：SYSTEM_ALERT_WINDOW 色层 + 前台服务常驻。
 */
import { EyeCareConfig } from '../types/sleep';

function gemma(): any | null {
  try {
    const cap = (window as any).Capacitor;
    return cap?.isNativePlatform?.() ? (cap.Plugins?.GemmaLLM ?? null) : null;
  } catch {
    return null;
  }
}

export const isEyeCareNative = (): boolean => gemma() != null;

export async function eyeCarePermissionGranted(): Promise<boolean> {
  const g = gemma();
  if (!g) return true; // Web 端无需系统权限
  try {
    const res = await g.eyeCarePermission();
    return !!res?.granted;
  } catch {
    return false;
  }
}

export async function eyeCareOpenPermissionSettings(): Promise<void> {
  const g = gemma();
  if (!g) return;
  try {
    await g.eyeCareOpenPermission();
  } catch {
    // 打不开授权页就静默失败，UI 上引导用户手动前往设置
  }
}

/** 滤镜强度 → 悬浮层透明度（上限与原生侧一致：暖 0.60 / 暗 0.70） */
export function eyeCareOverlayParams(cfg: EyeCareConfig): {
  warmColor: string;
  warmAlpha: number;
  dimAlpha: number;
} {
  const warmAlpha = Math.min(0.6, (Math.max(0, cfg.warmStrength) / 100) * 0.55);
  const dimAlpha = Math.min(0.7, (Math.max(0, cfg.dimStrength) / 100) * 0.65);
  return { warmColor: cfg.warmColor, warmAlpha, dimAlpha };
}

/** Web/应用内回退层的 CSS（预览与 PWA 用） */
export function eyeCareInAppStyles(cfg: EyeCareConfig): {
  warm: string;
  dim: string;
} {
  const { warmColor, warmAlpha, dimAlpha } = eyeCareOverlayParams(cfg);
  const hexA = (a: number) => Math.round(Math.min(1, Math.max(0, a)) * 255)
    .toString(16).padStart(2, '0');
  return {
    warm: `${warmColor}${hexA(warmAlpha)}`,
    dim: `#000000${hexA(dimAlpha)}`,
  };
}

/** 是否处于定时生效窗口（支持跨午夜，如 22:00 → 07:00） */
export function isInEyeCareWindow(cfg: EyeCareConfig, now: Date = new Date()): boolean {
  if (!cfg.scheduleEnabled) return true;
  const toMin = (t: string): number => {
    const [h, m] = t.split(':').map(Number);
    if (Number.isNaN(h) || Number.isNaN(m)) return 0;
    return h * 60 + m;
  };
  const cur = now.getHours() * 60 + now.getMinutes();
  const s = toMin(cfg.start);
  const e = toMin(cfg.end);
  if (s === e) return true; // 零时长视为全天
  return s < e ? cur >= s && cur < e : cur >= s || cur < e;
}

const STARTED_KEY = 'somnacare_eyecare_started';

function markStarted(v: boolean) {
  try {
    localStorage.setItem(STARTED_KEY, v ? '1' : '0');
  } catch { /* ignore */ }
}

function wasStarted(): boolean {
  try {
    return localStorage.getItem(STARTED_KEY) === '1';
  } catch {
    return false;
  }
}

/**
 * 按配置自动应用滤镜（App 打开时与定时轮询调用）。
 * 返回当前是否实际处于生效状态。
 */
export async function applyEyeCare(cfg: EyeCareConfig | undefined): Promise<boolean> {
  const g = gemma();
  if (!g || !cfg) return false;
  const shouldRun = cfg.enabled && isInEyeCareWindow(cfg);
  if (!shouldRun) {
    if (wasStarted()) {
      try { await g.eyeCareStop(); } catch { /* ignore */ }
      markStarted(false);
    }
    return false;
  }
  const params = eyeCareOverlayParams(cfg);
  try {
    await g.eyeCareStart(params);
    markStarted(true);
    return true;
  } catch {
    // 常见原因：悬浮窗权限未授予——不打断用户，由护眼页引导授权
    markStarted(false);
    return false;
  }
}

export async function stopEyeCareNow(): Promise<void> {
  const g = gemma();
  if (!g) return;
  try {
    await g.eyeCareStop();
  } catch { /* ignore */ }
  markStarted(false);
}
