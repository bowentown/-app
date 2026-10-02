/**
 * 使用行为信号（P3）：原生 UsageStatsManager 的聚合结果存取与权限引导。
 *
 * 隐私边界（护栏与文案共同执行）：
 *  - 原生只回传聚合结果（放下手机时刻/行为性醒来/夜间拿起次数），原始事件流不出插件
 *  - localStorage 只存聚合缓存（somnacare_usage_days），不写入导出备份
 *  - 权限被拒后记一次性标记，不再反复弹引导；功能可跳过，跳过即一切照旧
 *
 * 文案红线：数据来自手机使用记录——能说"放下手机/拿起手机"，
 * 不得声称对睡眠本身进行了监测（行为性 ≠ 生理性，禁语见 verify-no-claims）。
 */
import { clockMinutes, bedClockAxis, madFromMedian, deviationToScore } from './clockMath';
import { isNativePlatform } from './nativeAlarmScheduler';

export interface UsageDay {
  date: string;       // 该夜"日期"（跨午夜归前一天）
  lastActive: string; // 'HH:MM' 放下手机
  firstActive: string; // 'HH:MM' 行为性醒来
  nightPickups: number;
}

export interface UsageRegularity {
  score: number;
  bedDev: number;
  wakeDev: number;
}

const CACHE_KEY = 'somnacare_usage_days';
const PROMPTED_KEY = 'somnacare_usage_prompted';

function usage(): any {
  if (!isNativePlatform()) return null;
  try {
    return (window as any).Capacitor?.Plugins?.UsageSignal ?? null;
  } catch {
    return null;
  }
}

export async function usageHasPermission(): Promise<boolean> {
  const pl = usage();
  if (!pl) return false;
  try {
    const res = await pl.hasPermission?.();
    return res?.granted === true;
  } catch {
    return false;
  }
}

export async function usageOpenSettings(): Promise<void> {
  try {
    localStorage.setItem(PROMPTED_KEY, '1');
  } catch { /* ignore */ }
  const pl = usage();
  if (!pl) return;
  try {
    await pl.openPermissionSettings?.();
  } catch { /* 打不开授权页就静默，UI 引导手动前往 */ }
}

export function usagePrompted(): boolean {
  try {
    return localStorage.getItem(PROMPTED_KEY) === '1';
  } catch {
    return false;
  }
}

/** 查询并缓存聚合结果（原生失败时回退上次缓存，静默降级）。 */
export async function refreshUsageDays(days = 7): Promise<UsageDay[]> {
  const pl = usage();
  if (!pl) return cachedUsageDays();
  let list: UsageDay[] | null = null;
  try {
    const res = await pl.queryDailyUsage?.({ days });
    if (res?.days) {
      list = (res.days as any[])
        .filter((d) => d && typeof d.date === 'string')
        .map((d) => ({
          date: d.date,
          lastActive: typeof d.lastActive === 'string' ? d.lastActive : '',
          firstActive: typeof d.firstActive === 'string' ? d.firstActive : '',
          nightPickups: typeof d.nightPickups === 'number' ? d.nightPickups : 0,
        }));
    }
  } catch { /* 权限/内核问题：回退缓存 */ }
  if (list) {
    try {
      localStorage.setItem(CACHE_KEY, JSON.stringify(list));
    } catch { /* ignore */ }
    return list;
  }
  return cachedUsageDays();
}

export function cachedUsageDays(): UsageDay[] {
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((d: any) =>
      d && typeof d.date === 'string' && typeof d.lastActive === 'string');
  } catch {
    return [];
  }
}

/** 一键清除（设置页/趋势页入口）。 */
export function clearUsageData(): void {
  try {
    localStorage.removeItem(CACHE_KEY);
  } catch { /* ignore */ }
}

/**
 * 手机使用规律度：与 P1 作息规律度同一套 MAD 数学，
 * 但口径是"手机使用时刻"——命名与文案必须带"手机使用"限定词。
 * 少于 3 晚返回 null。
 */
export function computeUsageRegularity(days: UsageDay[]): UsageRegularity | null {
  const usable = days.filter((d) => d.lastActive && d.firstActive);
  if (usable.length < 3) return null;
  const bedDev = Math.round(madFromMedian(usable.map((d) => bedClockAxis(d.lastActive))));
  const wakeDev = Math.round(madFromMedian(usable.map((d) => clockMinutes(d.firstActive))));
  const avgDev = (bedDev + wakeDev) / 2;
  return { score: deviationToScore(avgDev), bedDev, wakeDev };
}
