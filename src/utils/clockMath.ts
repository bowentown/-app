/**
 * 时钟偏差数学（P1 规律度与 P3 使用行为共用）：
 * 中位数口径的平均绝对偏差（MAD from median）——比均值抗离群，
 * 一夜熬夜/一次深夜刷机不应毁掉整周分数。
 */

export function median(a: number[]): number {
  const s = [...a].sort((x, y) => x - y);
  const mid = s.length >> 1;
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

export function madFromMedian(a: number[]): number {
  const med = median(a);
  return a.reduce((acc, v) => acc + Math.abs(v - med), 0) / a.length;
}

/** "HH:MM" → 分钟（无跨午夜处理）。 */
export function clockMinutes(hhmm: string): number {
  const [h, m] = hhmm.split(':').map(Number);
  return (Number.isFinite(h) ? h : 0) * 60 + (Number.isFinite(m) ? m : 0);
}

/**
 * 就寝侧跨午夜统一：0:00–11:59 视作前一晚的延续
 * （23:50 与 00:10 相差 20 分钟而非 1420）。
 */
export function bedClockAxis(hhmm: string): number {
  const v = clockMinutes(hhmm);
  return v < 720 ? v + 1440 : v;
}

/** 偏差 → 0-100 分：avgDev ≤10 分钟 → 100，≥90 分钟 → 0，中间线性。 */
export function deviationToScore(avgDev: number): number {
  return Math.max(0, Math.min(100, Math.round(100 - Math.max(0, avgDev - 10) * (100 / 80))));
}
