/**
 * 护栏：规律度数学口径（固定输入断言，防"看着在算其实在算 0"）。
 *
 * 覆盖三类已知易错点：
 *  - 跨午夜：23:50 与 00:10 的就寝偏差是 20 分钟，不是 1420
 *  - 数据不足：少于 3 晚 → null（不显示假数字）
 *  - 完全规律：7 晚同一时刻 → 偏差 0、规律度满分
 *
 * 方法论约束：护栏必须能反向验证——构造错误口径必须报红（本文件内自检）。
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
// localStorage polyfill（sleepRegularity 不依赖它，但其类型引用链需要 DOM lib 之外的运行时安全）
const store = new Map<string, string>();
(globalThis as any).localStorage = {
  getItem: (k: string) => (store.has(k) ? store.get(k)! : null),
  setItem: (k: string, v: string) => { store.set(k, String(v)); },
  removeItem: (k: string) => { store.delete(k); },
};

const { computeRegularity } = await import(new URL('../src/utils/sleepRegularity.ts', import.meta.url).href);

type Rec = { bedtime: string; wakeTime: string; durationMinutes: number; sleepScore: number; date: string; id: string };
const rec = (bedtime: string, wakeTime: string, i: number): Rec =>
  ({ id: 'r' + i, date: `2026-10-${String((i % 28) + 1).padStart(2, '0')}`, bedtime, wakeTime, durationMinutes: 420, sleepScore: 80, deepSleepMinutes: 90, remSleepMinutes: 90, lightSleepMinutes: 240, awakeMinutes: 0, latencyMinutes: 10, efficiency: 90 } as unknown as Rec);

let failures = 0;
const check = (name: string, ok: boolean, detail = '') => {
  console.log(`${ok ? '✓' : '✗'} ${name}${detail ? '  ' + detail : ''}`);
  if (!ok) failures++;
};

// 1) 跨午夜：23:50 / 00:10 / 00:00 → 轴 1430/1450/1440，中位 1440，MAD = (10+10+0)/3 ≈ 6.67 → 7
{
  const r = computeRegularity([rec('23:50', '07:00', 1), rec('00:10', '07:05', 2), rec('00:00', '07:00', 3)]);
  check('跨午夜：就寝偏差 = 7（不是 1420）', r !== null && r.bedDev === 7, `bedDev=${r?.bedDev}`);
}

// 2) 数据不足：< 3 晚 → null
{
  check('不足 3 晚 → null（不编数字）', computeRegularity([rec('23:00', '07:00', 1), rec('23:30', '07:10', 2)]) === null);
  check('空记录 → null', computeRegularity([]) === null);
}

// 3) 完全规律：7 晚同一时刻 → 偏差 0、满分
{
  const wk = Array.from({ length: 7 }, (_, i) => rec('23:00', '07:00', i));
  const r = computeRegularity(wk as any);
  check('7 晚同一时刻 → 偏差 0', r !== null && r.bedDev === 0 && r.wakeDev === 0);
  check('完全规律 → 规律度 100', r !== null && r.score === 100);
}

// 4) 波动：22:00 / 01:30 / 00:10 交替 → 就寝 MAD = 60，起床恒定 → avgDev 30 → score 75
{
  const wk = [
    rec('22:00', '07:00', 1), rec('01:30', '07:00', 2), rec('00:10', '07:00', 3),
    rec('22:00', '07:00', 4), rec('01:30', '07:00', 5), rec('00:10', '07:00', 6), rec('00:10', '07:00', 7),
  ];
  const r = computeRegularity(wk as any);
  // 轴 1320/1530/1450/1320/1530/1450/1450 → 中位 1450 → 偏差 |130|,|130|,|0|,|0|,|0|,|80|,|80|
  //   → 和 420 / 7 = 60（手算曾错成 440/7=63，漏了一项）
  check('波动就寝 → MAD 60（中位数口径）', r !== null && r.bedDev === 60, `bedDev=${r?.bedDev}`);
  // avgDev = (60+0)/2 = 30 → score = 100 - (30-10)*1.25 = 75
  check('波动 → 规律度落在中间偏上档', r !== null && r.score === 75, `score=${r?.score}`);
}

// 5) 反向自检：把"跨午夜不归一"的错误口径必须能被本断言抓住
{
  const beds = [23 * 60 + 50, 10, 0];            // 错误口径：00:10 不加 1440
  const med = 10;
  const wrongDev = Math.round(beds.reduce((a, b) => a + Math.abs(b - med), 0) / beds.length);
  check('反向自检：错误口径会产生 477 分钟的荒谬偏差', wrongDev === 477, `wrongDev=${wrongDev}`);
  const r = computeRegularity([rec('23:50', '07:00', 1), rec('00:10', '07:05', 2), rec('00:00', '07:00', 3)]);
  check('反向自检：正确实现与错误口径结果不同', r !== null && r.bedDev !== wrongDev);
}

if (failures > 0) {
  console.error(`\n${failures} 项失败——规律度口径与断言不符`);
  process.exit(1);
}
console.log('\n✓ verify-regularity：跨午夜 / 不足 3 晚 / 满分 / 波动档位全部符合口径');
