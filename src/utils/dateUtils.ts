/**
 * 本地时区日期工具。全项目表示"某一天"时只用这里，禁用 toISOString()——
 * 那是 UTC：东八区早上 6–9 点会落到前一天（OneTapSleepTracker 的跨夜记录
 * 互相覆盖、备份文件名日期倒退，都是这个坑的实例）。
 */
export function toLocalDateString(d: Date = new Date()): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/** 几天前/后的本地日期（负数往前）。 */
export function localDateOffset(days: number, from: Date = new Date()): string {
  const d = new Date(from);
  d.setDate(d.getDate() + days);
  return toLocalDateString(d);
}
