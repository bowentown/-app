import { SleepRecord } from '../types/sleep';

/**
 * 作息规律度（P1 口径：按用户自己记录的就寝/起床时刻计算——
 * 这是可验证的统计量，不是生理测量值；文案必须保留"按你自己记录的
 * 作息计算"这一诚实边界，且不得称 SRI——真正的 SRI 需要逐分钟
 * 睡着/醒着状态，只有使用行为信号（P3）落地后才有资格硬凑）。
 */

export interface RegularityResult {
  nights: number;
  bedDev: number;   // 就寝平均绝对偏差（分钟）
  wakeDev: number;  // 起床平均绝对偏差（分钟）
  avgDev: number;   // 两者均值（分钟）
  score: number;    // 0-100：avgDev ≤10 分钟 → 100，≥90 分钟 → 0，中间线性
}

// 数学口径下沉到 clockMath（P3 手机使用规律度共用同一套 MAD/映射），
// 行为不变——verify-regularity 护栏继续做反向验证
import { bedClockAxis as bedAxis, clockMinutes as wakeAxis, madFromMedian, deviationToScore } from './clockMath';

/**
 * 近 7 晚规律度（records 需按日期降序，records[0] 最新）。
 * 少于 3 晚返回 null——不显示假数字。
 */
export function computeRegularity(records: SleepRecord[]): RegularityResult | null {
  const wk = records.slice(0, 7);
  if (wk.length < 3) return null;
  const bedDev = Math.round(madFromMedian(wk.map((r) => bedAxis(r.bedtime))));
  const wakeDev = Math.round(madFromMedian(wk.map((r) => wakeAxis(r.wakeTime))));
  const avgDev = (bedDev + wakeDev) / 2;
  const score = deviationToScore(avgDev);
  return { nights: wk.length, bedDev, wakeDev, avgDev: Math.round(avgDev), score };
}

/** 规律度分档（score ≥80 稳 / ≥50 中 / 其余波动大）。 */
export function regularityTier(score: number): 'steady' | 'ok' | 'wild' {
  return score >= 80 ? 'steady' : score >= 50 ? 'ok' : 'wild';
}
