/**
 * 鲸鱼娘桌宠悬浮窗：Web 侧只负责开关与"文案快照"推送。
 *
 * 数据边界是刻意的：睡眠记录仍只存在 WebView 的 localStorage，原生侧一行也读不到、
 * 也不需要。快照 = 面板两行文案 + 女仆播报词库（\n 分隔）+ 播报频率。
 */
import type { SleepRecord, UserProfile } from '../types/sleep';

function gemma(): any | null {
  try {
    const cap = (window as any).Capacitor;
    return cap?.isNativePlatform?.() ? (cap.Plugins?.GemmaLLM ?? null) : null;
  } catch {
    return null;
  }
}

export const isPetNative = (): boolean => gemma() != null;

const ENABLED_KEY = 'somnacare_pet_enabled';

/** 每 N 次点击鲸鱼娘播报一次女仆提醒，其余点击显示速览卡。 */
export const BUBBLE_EVERY_KEY = 'somnacare_pet_bubble_every';
export const DEFAULT_BUBBLE_EVERY = 8;

export function getBubbleEvery(): number {
  try {
    const n = Number(localStorage.getItem(BUBBLE_EVERY_KEY));
    return Number.isFinite(n) && n >= 1 && n <= 50 ? Math.round(n) : DEFAULT_BUBBLE_EVERY;
  } catch {
    return DEFAULT_BUBBLE_EVERY;
  }
}

export function setBubbleEvery(n: number): void {
  try {
    localStorage.setItem(BUBBLE_EVERY_KEY, String(Math.round(n)));
  } catch { /* ignore */ }
}

export function isPetEnabled(): boolean {
  try {
    return localStorage.getItem(ENABLED_KEY) === '1';
  } catch {
    return false;
  }
}

function setEnabled(v: boolean) {
  try {
    localStorage.setItem(ENABLED_KEY, v ? '1' : '0');
  } catch { /* ignore */ }
}

export async function petPermissionGranted(): Promise<boolean> {
  const g = gemma();
  if (!g) return false;
  try {
    const res = await g.petPermission();
    return !!res?.granted;
  } catch {
    return false;
  }
}

export async function petOpenPermissionSettings(): Promise<void> {
  const g = gemma();
  if (!g) return;
  try {
    await g.petOpenPermission();
  } catch {
    // 打不开授权页就静默失败，UI 上引导用户手动前往设置
  }
}

/** "HH:mm" → 距今分钟数（跨午夜按次日算）。 */
function minutesUntil(hhmm: string, now: Date): number | null {
  const m = /^(\d{1,2}):(\d{2})$/.exec((hhmm || '').trim());
  if (!m) return null;
  const target = Number(m[1]) * 60 + Number(m[2]);
  const cur = now.getHours() * 60 + now.getMinutes();
  return target >= cur ? target - cur : target + 1440 - cur;
}

function fmtDuration(min: number): string {
  const h = Math.floor(min / 60);
  const m = Math.round(min % 60);
  return h > 0 ? `${h} 小时 ${m} 分` : `${m} 分`;
}

/** 今晚是否已有记录（按 bedtime 是否为今天判断）。 */
function tonightRecord(records: SleepRecord[], now: Date): SleepRecord | undefined {
  const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
  return records.find((r) => r.date === today);
}

function greeting(now: Date): string {
  const h = now.getHours();
  if (h >= 23 || h < 6) return '夜深了';
  if (h < 11) return '早安';
  if (h < 14) return '午安';
  if (h < 18) return '下午好';
  return '晚上好';
}

/** 由当前数据算出面板两行文案 + 女仆播报词库。 */
export function buildPetSnapshot(
  records: SleepRecord[],
  profile: UserProfile,
  now: Date = new Date(),
): { status: string; rowToday: string; rowSub: string; say: string[] } {
  const bedtime = profile?.targetBedtime ?? '23:30';
  const tonight = tonightRecord(records, now);
  const until = minutesUntil(bedtime, now);

  // —— 今晚卡：大值一行 + 小字副行 ——
  const rowToday = tonight ? `已记录 ${tonight.sleepScore} 分` : `目标 ${bedtime}`;
  let rowSub: string;
  if (tonight) {
    rowSub = `睡了 ${fmtDuration(tonight.durationMinutes)}`;
    if (tonight.sleepEfficiency >= 85) rowSub += ' · 效率很稳';
  } else if (until != null && until > 0) {
    rowSub = `还剩 ${fmtDuration(until)} 入睡`;
  } else {
    rowSub = '记得早点休息';
  }

  // —— 女仆播报词库：每行一条，原生逐条轮播；没有的数据绝不编 ——
  const say: string[] = [];
  const h = now.getHours();
  if (h >= 23 || h < 6) {
    say.push('主人，夜已经很深了……请快去睡觉，这是女仆的请求哦。');
  } else if (h >= 18) {
    say.push('主人，晚上好呀～人家会一直陪着您到入睡的。');
  } else if (h >= 11) {
    say.push('主人，下午好～午后别太勉强自己哦。');
  } else {
    say.push('主人，早上好呀～昨晚睡得好吗？');
  }

  if (tonight) {
    say.push(`主人昨晚睡了 ${fmtDuration(tonight.durationMinutes)}，得了 ${tonight.sleepScore} 分呢。`);
    if (tonight.sleepEfficiency >= 85) {
      say.push(`主人昨夜的睡眠效率有 ${tonight.sleepEfficiency}%，人家都替您高兴～`);
    }
    if (tonight.latencyMinutes >= 30) {
      say.push(`主人昨晚躺了 ${fmtDuration(tonight.latencyMinutes)} 才睡着，试试提前放下手机好不好？`);
    }
    if (tonight.awakeMinutes >= 30) {
      say.push('主人昨晚半夜醒了好几次呢，睡前少喝点水会更好哦。');
    }
  } else if (until != null && until > 0) {
    say.push(`主人，距离 ${bedtime} 的目标就寝还有 ${fmtDuration(until)}，提前洗个澡暖暖的吧～`);
  } else {
    say.push('主人还没有记录过睡眠呢。今晚按下开始，让人家守着您入睡吧～');
  }
  say.push('天黑了记得开护眼滤镜哦，主人的眼睛人家可是很在意的～');
  say.push('主人辛苦了，累了就早点休息，人家会在桌面等您的～');

  return { status: greeting(now), rowToday, rowSub, say };
}

/** 启动桌宠（幂等：已运行则只刷新文案）。 */
export async function startPet(
  records: SleepRecord[],
  profile: UserProfile,
): Promise<{ ok: boolean; needPermission?: boolean }> {
  const g = gemma();
  if (!g) return { ok: false };
  const snap = buildPetSnapshot(records, profile);
  const payload = { ...snap, say: snap.say.join('\n'), bubbleEvery: getBubbleEvery() };
  try {
    if (isPetEnabled()) await g.petSync(payload);
    else await g.petStart(payload);
    setEnabled(true);
    return { ok: true };
  } catch (e: any) {
    if (String(e?.message ?? e).includes('OVERLAY_PERMISSION_REQUIRED')) {
      setEnabled(false);
      return { ok: false, needPermission: true };
    }
    setEnabled(false);
    return { ok: false };
  }
}

/** 只刷新文案，不改变开关状态。 */
export async function syncPet(
  records: SleepRecord[],
  profile: UserProfile,
): Promise<void> {
  const g = gemma();
  if (!g || !isPetEnabled()) return;
  try {
    const snap = buildPetSnapshot(records, profile);
    await g.petSync({ ...snap, say: snap.say.join('\n'), bubbleEvery: getBubbleEvery() });
  } catch { /* 桌宠没开或服务已停，忽略 */ }
}

export async function stopPet(): Promise<void> {
  const g = gemma();
  if (!g) return;
  try {
    await g.petStop();
  } catch { /* ignore */ }
  setEnabled(false);
}

/**
 * 读取桌宠写入的"目标分区"并清除。
 * 桌宠的速览行点击时只写 SharedPreferences 再拉起 App，由 App 自己在启动时消费——
 * 这样不必改 Capacitor 生成的 MainActivity（它在 CI 里才生成，不在仓库中）。
 */
export async function consumePendingTab(): Promise<string | null> {
  const g = gemma();
  if (!g) return null;
  try {
    const res = await g.petConsumePendingTab();
    const tab = res?.tab;
    return typeof tab === 'string' && tab ? tab : null;
  } catch {
    return null;
  }
}
