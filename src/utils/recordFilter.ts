/**
 * 记录分类与合并（第 20 轮方案第 1 层）：
 *
 * 根因：三层共享同一个假设「一天 = 一夜，一夜在晚上」——
 * 数据模型没有"小睡"表达 → 只能按 date 去重 → 午睡会删掉当晚的夜睡
 * （D1，数据丢失）。本模块补上 kind 表达与安全的合并语义。
 *
 * 旧数据缺省视为夜睡（isNight），行为与历史版本完全一致。
 */
import { SleepRecord } from '../types/sleep';

/** 旧数据无 kind → 视为夜睡 */
export const isNap = (r: SleepRecord): boolean => r.kind === 'nap';
export const isNight = (r: SleepRecord): boolean => !isNap(r);

/** 分析层一律用这个：规律度、趋势、AI 建议、周小结都只该看夜睡 */
export const nightsOnly = (records: SleepRecord[]): SleepRecord[] => records.filter(isNight);
export const napsOnly = (records: SleepRecord[]): SleepRecord[] => records.filter(isNap);

/**
 * 把新记录合并进列表（去重语义的核心，唯一定义处）：
 *  - 小睡（kind='nap'）：同一天可多次（午睡 + 傍晚小憩），只按 id 防重复
 *  - 夜睡：同一日历日只允许一条（既有契约），且不删当天的小睡
 *
 * 抽成纯函数的原因：verify-record-kind 的反向自检必须把【坏实现】
 * （旧版按 date 一刀切）喂进真实断言路径，而不是同义反复。
 */
export function mergeRecord(prev: SleepRecord[], next: SleepRecord): SleepRecord[] {
  // 返回【已含 next 的完整列表】——调用方不再自行拼接
  return isNap(next)
    ? [next, ...prev.filter((r) => r.id !== next.id)]
    : [next, ...prev.filter((r) => !(r.date === next.date && !isNap(r)))];
}

/** 小睡判定（构建时归类）：日间就寝（本地 10:00–19:59 入睡）视为小睡。 */
export function deriveKind(bedtimeLocalHour: number): 'night' | 'nap' {
  return bedtimeLocalHour >= 10 && bedtimeLocalHour < 20 ? 'nap' : 'night';
}
