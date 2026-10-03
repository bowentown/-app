/**
 * 使用行为数据的共享 store（P3）：幂等加载 + 订阅，
 * 首页（提议）与趋势页（对照卡）共用一份原生查询结果，
 * 调用次数不因多处挂载而增加。失败静默——提议消失，其他功能不受影响。
 */
import { refreshUsageDays, cachedUsageDays, type UsageDay } from './usageSignal';
import { isNativePlatform } from './nativeAlarmScheduler';

let cache: UsageDay[] | null = null;
let loading: Promise<UsageDay[]> | null = null;
const subscribers = new Set<(days: UsageDay[]) => void>();

function emit() {
  if (cache) for (const fn of subscribers) fn(cache);
}

/** 幂等加载：已加载/加载中直接复用；仅 native 且未加载才真的查。 */
export function ensureUsageLoaded(days = 2): Promise<UsageDay[]> {
  if (!isNativePlatform()) return Promise.resolve([]);
  if (cache) return Promise.resolve(cache);
  if (loading) return loading;
  loading = refreshUsageDays(days)
    .then((list) => {
      cache = list;
      emit();
      return list;
    })
    .catch(() => {
      loading = null;
      return cachedUsageDays();
    });
  return loading;
}

export function subscribeUsage(fn: (days: UsageDay[]) => void): () => void {
  subscribers.add(fn);
  return () => subscribers.delete(fn);
}

export function getCachedUsageDays(): UsageDay[] {
  return cache ?? cachedUsageDays();
}
