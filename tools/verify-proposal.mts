/**
 * 护栏：提议引擎（P3 的数据正确性防线）。
 *
 * 覆盖（方案 §八）：
 *  - 日期口径：targetDate 必须等于"醒来那天的日历日"——
 *    反向注入（用 UsageDay.date 当 targetDate 的错误口径）必须与正确值不同
 *  - 窗口边界：4h 接受 / 不足 4h 拒绝 / 16h 接受 / 超过 16h 拒绝
 *  - 置信度：偏离历史就寝中位数 >180 分钟 → 不预填（低置信静默跳过）
 *  - firstActive 为空 / 已有记录 / 进行中会话 / 已处理 → 均不产出提议
 *  - 同晚重复提议被 handled 键挡住
 *
 * 方法论约束：护栏必须能反向验证——错误口径必须与正确结果可区分。
 */
import { fileURLToPath } from 'node:url';

const store = new Map<string, string>();
(globalThis as any).localStorage = {
  getItem: (k: string) => (store.has(k) ? store.get(k)! : null),
  setItem: (k: string, v: string) => { store.set(k, String(v)); },
  removeItem: (k: string) => { store.delete(k); },
};

const { computeProposal } = await import(
  new URL('../src/utils/proposal.ts', import.meta.url).href
);

let failures = 0;
const check = (name: string, ok: boolean, detail = '') => {
  console.log(`${ok ? '✓' : '✗'} ${name}${detail ? '  ' + detail : ''}`);
  if (!ok) failures++;
};

const rec = (date: string, bedtime: string): any =>
  ({ id: 'r' + date, date, bedtime, wakeTime: '07:30', durationMinutes: 480, sleepScore: 80 });

// 基准夜：00:20 放下 → 07:35 拿起（夜归属键 2026-10-02，醒来日 10-03）
const baseDay = { date: '2026-10-02', lastActive: '00:20', firstActive: '07:35', nightPickups: 2 };
const baseRecords = [
  rec('2026-10-01', '23:10'),
  rec('2026-09-30', '23:05'),
  rec('2026-09-29', '23:15'),
];

{
  const p = computeProposal({ usageDays: [baseDay], records: baseRecords, sessionActive: false });
  check('基准：产出提议', p !== null);
  check('日期口径：targetDate = 醒来那天(10-03)', p?.targetDate === '2026-10-03', p?.targetDate);
  check('日期口径：≠ UsageDay.date(10-02)——反向注入的错口径可区分', p?.targetDate !== baseDay.date);
  check('时刻与 UsageDay 一致', p?.bedtime === '00:20' && p?.wakeTime === '07:35');
  check('窗口 = 435 分钟', p !== null && p.windowMinutes === 435, `w=${p?.windowMinutes}`);
  check('置信度：偏差 70 分钟 → high', p?.confidence === 'high', p?.confidence);
}

// ── 窗口边界 ──
{
  const mk = (bed: string, wake: string) => [{ date: '2026-10-02', lastActive: bed, firstActive: wake, nightPickups: 0 }];
  // 恰好 4h：00:05 → 04:05（窗内合法时刻）
  const p4 = computeProposal({ usageDays: mk('00:05', '04:05'), records: baseRecords, sessionActive: false });
  check('窗口边界：恰好 4h 接受', p4 !== null && p4.windowMinutes === 240, `w=${p4?.windowMinutes}`);
  // 不足 4h：00:06 → 04:05 = 239 分钟
  const p239 = computeProposal({ usageDays: mk('00:06', '04:05'), records: baseRecords, sessionActive: false });
  check('窗口边界：239 分钟拒绝', p239 === null);
  // 恰好 16h：19:00 → 次日 11:00。注意：16h 窗要求就寝在 19 点档，
  // 与基准历史(23:10)偏差 250 分钟会被置信度门拒绝——这是设计内行为，
  // 所以本用例的历史记录改用 19:30 就寝（与提议自洽）
  const lateBedHistory = [rec('2026-10-01', '19:30'), rec('2026-09-30', '19:25'), rec('2026-09-29', '19:35')];
  const p16 = computeProposal({ usageDays: mk('19:00', '11:00'), records: lateBedHistory, sessionActive: false });
  check('窗口边界：恰好 16h 接受（历史自洽）', p16 !== null && p16.windowMinutes === 960, `w=${p16?.windowMinutes}`);
  // 反向：同样 16h 但历史是 23:10 档 → 置信度门拒绝（设计内）
  const p16b = computeProposal({ usageDays: mk('19:00', '11:00'), records: baseRecords, sessionActive: false });
  check('反向：16h 但与历史作息偏离 250 分钟 → 置信度门拒绝', p16b === null);
  // 超过 16h：18:00 → 11:01 = 17h01m
  const p17 = computeProposal({ usageDays: mk('18:00', '11:01'), records: baseRecords, sessionActive: false });
  check('窗口边界：17h 拒绝', p17 === null);
}

// ── 降级矩阵 ──
{
  // firstActive 为空（半夜看手机抹掉）
  const p = computeProposal({ usageDays: [{ date: '2026-10-02', lastActive: '00:20', firstActive: '', nightPickups: 0 }], records: baseRecords, sessionActive: false });
  check('firstActive 为空 → 不提议（不编数字）', p === null);
  // 已有当日记录（用户自己记过）
  const p2 = computeProposal({ usageDays: [baseDay], records: [...baseRecords, rec('2026-10-03', '22:00')], sessionActive: false });
  check('该日期已有记录 → 不提议（尊重用户）', p2 === null);
  // 进行中会话
  const p3 = computeProposal({ usageDays: [baseDay], records: baseRecords, sessionActive: true });
  check('有进行中会话 → 不提议', p3 === null);
  // 已处理（忽略过）
  const p4 = computeProposal({ usageDays: [baseDay], records: baseRecords, sessionActive: false, handledDate: '2026-10-03' });
  check('该晚已处理（忽略）→ 不再提议', p4 === null);
  // 置信度：偏离历史中位数 >180 分钟 → 不预填
  const devDay = { date: '2026-10-02', lastActive: '04:30', firstActive: '07:35', nightPickups: 0 };
  const p5 = computeProposal({ usageDays: [devDay], records: baseRecords, sessionActive: false });
  check('置信度：偏离历史 200+ 分钟 → 静默跳过（不预填错值）', p5 === null);
  // 无历史（新用户）→ medium 仍提议
  const p6 = computeProposal({ usageDays: [baseDay], records: [], sessionActive: false });
  check('无历史（新用户）→ 中置信仍提议', p6?.confidence === 'medium', p6?.confidence);
  // 畸形时刻（缓存陈旧）：hour 不在合法窗 → 防御性拒绝
  const p7 = computeProposal({ usageDays: [{ date: '2026-10-02', lastActive: '15:00', firstActive: '17:00', nightPickups: 0 }], records: baseRecords, sessionActive: false });
  check('畸形缓存（午后事件）→ 防御性拒绝', p7 === null);
}

if (failures > 0) {
  console.error(`\n${failures} 项失败——提议引擎口径不符`);
  process.exit(1);
}
console.log('\n✓ verify-proposal：日期口径 / 窗口边界 / 置信度 / 降级矩阵全部符合');
