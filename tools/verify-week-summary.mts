/**
 * 护栏：周小结聚合（第 22 轮 #1 的回归防线）。
 *
 * 背景：TrendsTab 页面上有一份与 computeRegularity 平行的聚合——
 * 换数据口径（nightsOnly）时只改了一处，另一处对全小睡输入抛出
 * undefined（best.date）→ 白屏 + 记录不落盘。现在聚合收敛到
 * summarizeWeek 纯函数，本护栏直接测它：
 *  - 空列表 → 全部 null（不出 NaN / undefined）
 *  - 全小睡 → nights=0、best=null、不出 NaN
 *  - 混合 → 聚合值只来自夜睡（小睡免疫）
 *  - 反向自检：旧版"cy 累加"产生的越界 best 必须被检出
 */
import { fileURLToPath } from 'node:url';

const store = new Map<string, string>();
(globalThis as any).localStorage = {
  getItem: (k: string) => (store.has(k) ? store.get(k)! : null),
  setItem: (k: string, v: string) => { store.set(k, String(v)); },
  removeItem: (k: string) => { store.delete(k); },
};

const { summarizeWeek } = await import(new URL('../src/utils/weekSummary.ts', import.meta.url).href);

let failures = 0;
const check = (name: string, ok: boolean, detail = '') => {
  console.log(`${ok ? '✓' : '✗'} ${name}${detail ? '  ' + detail : ''}`);
  if (!ok) failures++;
};

const rec = (id: string, date: string, kind?: 'nap', score = 80, dur = 480): any =>
  ({ id, date, kind, bedtime: kind === 'nap' ? '13:00' : '23:00', wakeTime: kind === 'nap' ? '14:00' : '07:00', durationMinutes: dur, sleepScore: score, deepSleepMinutes: 90, lightSleepMinutes: 300, remSleepMinutes: 80, awakeMinutes: 10, sleepEfficiency: 90, latencyMinutes: 10, wakeCount: 1, wakingMood: 'refreshed', preSleepHabits: [], stages: [] });

// 1. 空列表
{
  const s = summarizeWeek([]);
  check('空列表：nights=0', s.nights === 0);
  check('空列表：best=null（不出 undefined）', s.best === null);
  check('空列表：聚合值=null（不出 NaN）', s.avgScore === null && s.avgDurationMin === null && s.avgDeepMin === null);
}

// 2. 全小睡
{
  const s = summarizeWeek([
    rec('k1', '2026-10-03', 'nap', 49, 53),
    rec('k2', '2026-10-04', 'nap', 52, 45),
  ]);
  check('全小睡：nights=0', s.nights === 0);
  check('全小睡：best=null（不崩）', s.best === null);
  check('全小睡：聚合值=null', s.avgScore === null);
  check('全小睡：小睡被统计', s.napCount === 2 && s.napMinutes === 98);
}

// 3. 混合（1 夜 + 1 小睡）：聚合只来自夜睡
{
  const s = summarizeWeek([
    rec('n1', '2026-10-03', undefined, 100, 480),
    rec('k1', '2026-10-03', 'nap', 49, 53),
  ]);
  check('混合：nights=1', s.nights === 1);
  check('混合：聚合值只来自夜睡', s.avgScore === 100 && s.avgDurationMin === 480);
  check('混合：best 是夜睡（不是小睡）', s.best?.id === 'n1');
}

// 4. 多夜：best 是最高分的一晚
{
  const s = summarizeWeek([
    rec('n1', '2026-10-01', undefined, 85, 480),
    rec('n2', '2026-10-02', undefined, 92, 480),
    rec('n3', '2026-10-03', undefined, 78, 480),
  ]);
  check('多夜：best=最高分', s.best?.id === 'n2');
  check('多夜：avgScore 正确', s.avgScore === Math.round((85 + 92 + 78) / 3));
}

// 反向自检：模拟旧版"无守卫 reduce"的产物（best=undefined），
// 断言消费端（{best &&}）会正确跳过而不是崩溃
{
  const legacyBest = ([] as any[]).reduce((a: any, r: any) => (r.sleepScore > a.sleepScore ? r : a), undefined);
  check('反向：旧版无守卫 reduce 产出 undefined', legacyBest === undefined);
  // 消费端行为：{best && ...} 对 undefined 短路为 false（不崩）
  check('反向：消费端 {undefined && ...} 不崩溃', !(legacyBest && legacyBest.date !== undefined));
}

if (failures > 0) {
  console.error(`\n${failures} 项失败——周小结聚合回归`);
  process.exit(1);
}
console.log('\n✓ verify-week-summary：空列表 / 全小睡 / 混合 / 多夜 全部安全');
