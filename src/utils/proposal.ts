/**
 * 提议引擎（P3 核心）：把昨晚的手机使用信号转成一条【待确认】的睡眠提议。
 *
 * 铁律（第 20 轮方案 §决策 1）：只预填，不自动写入——lastActive 是行为性
 * 信号（放下手机 ≠ 入睡），误判写库会污染评分/规律度/图鉴能量。
 *
 * 日期口径（方案 §3.3，最大的坑）：targetDate = 醒来那天的日历日，
 * 由 firstActive 时刻直接取——绝不能用 UsageDay.date（那是"夜归属"键，
 * 恒差一天；用它会把新记录落到前一晚，保存时删掉真正属于那晚的记录）。
 * 本实现通过 epoch 重建（§3.2 gate 链之后由 verify-proposal 反向注入验证）。
 */
import { SleepRecord } from '../types/sleep';
import { bedClockAxis, median, shortArc, clockMinutes } from './clockMath';
import { nightsOnly } from './recordFilter';
import type { UsageDay } from './usageSignal';

export interface Proposal {
  targetDate: string;        // 醒来那天的日历日（YYYY-MM-DD）
  bedtime: string;           // 'HH:MM' 放下手机
  wakeTime: string;          // 'HH:MM' 第一次拿起
  bedtimeMs: number;         // epoch（构建记录用）
  wakeMs: number;
  windowMinutes: number;
  confidence: 'high' | 'medium' | 'low';
  nightPickups: number;
}

export interface ProposalInput {
  usageDays: UsageDay[];
  chronotype?: 'night' | 'day' | 'irregular';
  records: SleepRecord[];
  sessionActive: boolean;
  handledDate?: string | null;
  now?: Date;
}

/** 单个 HH:mm + 夜归属键 → epoch（凌晨事件归 dateKey 的次一日历日）。 */
export function epochOfEvent(dateKey: string, hhmm: string, kind: 'lastActive' | 'firstActive'): number {
  const [y, mo, d] = dateKey.split('-').map(Number);
  const [h, mi] = hhmm.split(':').map(Number);
  // firstActive 恒在晨窗（04–12 点）→ 日历日 = dateKey + 1；
  // lastActive：18–24 点 = dateKey 当天，0–6 点 = dateKey + 1
  const dayShift = kind === 'firstActive' ? 1 : h >= 18 ? 0 : 1;
  return new Date(y, mo - 1, d + dayShift, h, mi, 0, 0).getTime();
}

function pad(n: number): string {
  return String(n).padStart(2, '0');
}

export function computeProposal(input: ProposalInput): Proposal | null {
  const now = input.now ?? new Date();
  if (input.chronotype === 'irregular') return null;          // gate 0：不作息者不自动提议
  if (input.sessionActive) return null;                       // gate 5：进行中不提议
  if (input.usageDays.length === 0) return null;              // 无数据（未授权/老内核）

  // 只提议最近一晚（决策 2）：取最后一晚（时间序末尾）
  const day = input.usageDays[input.usageDays.length - 1];
  if (!day) return null;

  if (!day.lastActive || !day.firstActive) return null;       // gate 1：信号不全不编数字

  // gate 7（防御性复验，Java 已保证；缓存数据可能陈旧畸形）
  const bedH = parseInt(day.lastActive.split(':')[0], 10);
  const wakeH = parseInt(day.firstActive.split(':')[0], 10);
  if (!(bedH >= 18 || bedH < 6) || !(wakeH >= 4 && wakeH < 12)) return null;

  const bedtimeMs = epochOfEvent(day.date, day.lastActive, 'lastActive');
  const wakeMs = epochOfEvent(day.date, day.firstActive, 'firstActive');
  if (!(wakeMs > bedtimeMs)) return null;                     // 时序防御

  const windowMinutes = Math.round((wakeMs - bedtimeMs) / 60000);
  if (windowMinutes < 240 || windowMinutes > 960) return null; // gate 2：4h~16h

  // ★ targetDate = 醒来那天的日历日（由 wakeMs 取，绝不用 day.date——差一天）
  const w = new Date(wakeMs);
  const targetDate = `${w.getFullYear()}-${pad(w.getMonth() + 1)}-${pad(w.getDate())}`;

  if (input.records.some((r) => r.date === targetDate)) return null;  // gate 4：已有记录
  if (input.handledDate === targetDate) return null;                  // gate 6：已处理过


  // gate 8：置信度 = 与历史就寝中位数（近 14 晚）的偏差（用你自己的历史判据）
  // 置信度判据用【夜睡】历史（小睡是资产不是作息），并改用圆周短弧——
  // 日界断点对白睡者会把高置信误判为低（D2 同源）
  const history = nightsOnly(input.records)
    .slice(0, 14)
    .map((r) => clockMinutes(r.bedtime));
  let confidence: 'high' | 'medium' | 'low';
  if (history.length < 3) {
    confidence = 'medium';
  } else {
    const med = median(history);
    const diff = shortArc(clockMinutes(day.lastActive), med);
    confidence = diff <= 90 ? 'high' : diff <= 180 ? 'medium' : 'low';
  }
  if (confidence === 'low') return null;                      // 低置信：不预填，走手动补录

  return {
    targetDate,
    bedtime: day.lastActive,
    wakeTime: day.firstActive,
    bedtimeMs,
    wakeMs,
    windowMinutes,
    confidence,
    nightPickups: day.nightPickups,
  };
}
