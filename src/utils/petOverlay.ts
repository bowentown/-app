/**
 * 鲸鱼娘桌宠悬浮窗：Web 侧只负责开关与"文案快照"推送。
 *
 * 数据边界是刻意的：睡眠记录仍只存在 WebView 的 localStorage，原生侧一行也读不到、
 * 也不需要。这里推过去的只是四行展示文案，桌宠把它们渲染成速览卡。
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

/** 由当前数据算出四行展示文案。 */
export function buildPetSnapshot(
  records: SleepRecord[],
  profile: UserProfile,
  now: Date = new Date(),
): { status: string; rowToday: string; rowTrends: string; rowCoach: string } {
  const bedtime = profile?.targetBedtime ?? '23:30';

  // —— 标题行：就寝倒计时 / 记录中 ——
  const tonight = tonightRecord(records, now);
  const until = minutesUntil(bedtime, now);
  let status: string;
  if (tonight) {
    status = `昨晚睡了 ${fmtDuration(tonight.durationMinutes)}`;
  } else if (until == null) {
    status = '陪你到入睡';
  } else if (until <= 60) {
    status = `还有 ${until} 分钟就该睡了`;
  } else {
    const h = Math.floor(until / 60);
    const m = until % 60;
    status = `还有 ${h} 小时${m > 0 ? ` ${m} 分` : ''} 到 ${bedtime}`;
  }

  // —— 今晚：就寝目标与今日记录 ——
  const rowToday = tonight
    ? `已记录 · ${tonight.sleepScore} 分`
    : `目标 ${bedtime}${until != null && until > 0 ? ` · 还剩 ${fmtDuration(until)}` : ''}`;

  // —— 趋势：近 7 日均分（样本不足时明说，不编数）——
  const week = records.slice(0, 7);
  const rowTrends = week.length
    ? `近 ${week.length} 日均 ${Math.round(week.reduce((a, r) => a + r.sleepScore, 0) / week.length)} 分`
    : '还没有记录';

  // —— 顾问：昨夜最值得说的一件事 ——
  let rowCoach = '问问 AI 顾问';
  if (tonight) {
    const worst = Math.max(tonight.awakeMinutes, tonight.latencyMinutes);
    if (worst >= 30) {
      rowCoach = `昨夜入睡花了 ${fmtDuration(tonight.latencyMinutes)}`;
    } else if (tonight.sleepEfficiency >= 85) {
      rowCoach = `昨夜效率 ${tonight.sleepEfficiency}%，很稳`;
    } else {
      rowCoach = `昨夜 ${tonight.sleepScore} 分，看看能改进什么`;
    }
  } else if (week.length) {
    rowCoach = '聊聊最近的睡眠';
  }

  return { status, rowToday, rowTrends, rowCoach };
}

/** 启动桌宠（幂等：已运行则只刷新文案）。 */
export async function startPet(
  records: SleepRecord[],
  profile: UserProfile,
): Promise<{ ok: boolean; needPermission?: boolean }> {
  const g = gemma();
  if (!g) return { ok: false };
  const snap = buildPetSnapshot(records, profile);
  try {
    if (isPetEnabled()) await g.petSync(snap);
    else await g.petStart(snap);
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
    await g.petSync(buildPetSnapshot(records, profile));
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
