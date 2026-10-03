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

/**
 * 小睡判定（构建时归类）。
 * ★ 必须看用户声明的作息类型（第 21 轮 #1）：kind 是"哪一段是主睡"的
 * 宣告，不该由钟点单方面决定——
 *  - day/irregular：主睡就是主睡（一律 night，不丢弃数据）
 *  - night（缺省）：日间就寝（本地 10:00–19:59）视为小睡
 */
export type Chronotype = 'night' | 'day' | 'irregular';
export function deriveKind(bedtimeLocalHour: number, chronotype: Chronotype = 'night'): 'night' | 'nap' {
  if (chronotype === 'day' || chronotype === 'irregular') return 'night';
  return bedtimeLocalHour >= 10 && bedtimeLocalHour < 20 ? 'nap' : 'night';
}

/**
 * 切换作息类型时的存量重归类（只改归类，不删数据）：
 *  - 切到 day：同一天【唯一】的小睡很可能是被误标的主睡 → 恢复为夜睡
 *  - 切到 night：按钟点规则重新归类
 *  - 切到 irregular：维持现状（不猜）
 */
export function reclassifyForChronotype(records: SleepRecord[], chronotype: Chronotype): SleepRecord[] {
  if (chronotype === 'irregular') return records;
  return records.map((r) => {
    if (chronotype === 'day') {
      if (r.kind !== 'nap') return r;
      const sameDayOthers = records.filter((x) => x.date === r.date && x.id !== r.id && !isNap(x));
      const isOnlySleepOnDate = !records.some((x) => x.date === r.date && x.id !== r.id);
      // 同一天只有这一条睡 → 大概率是主睡，恢复夜睡；已有夜睡的保持小睡
      return isOnlySleepOnDate || sameDayOthers.length === 0 ? { ...r, kind: undefined } : r;
    }
    // night：按钟点重判
    const h = parseInt(r.bedtime.split(':')[0], 10);
    return deriveKind(h, 'night') === 'nap' ? r : { ...r, kind: undefined };
  });
}
