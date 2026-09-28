import { SleepRecord, SleepStageSegment, WakingMood } from '../types/sleep';

/**
 * Calculates a 0-100 scientific sleep score based on:
 * - Total duration (40 pts) - scored against the user's own target (CBT-I sleep diary
 *   convention: compare against the prescribed window, not a population constant)
 * - Deep sleep ratio (20 pts) - optimal 15%-25%
 * - REM sleep ratio (20 pts) - optimal 20%-25%
 * - Sleep efficiency & awakenings (20 pts) - awakenings penalty, latency
 */
export function calculateSleepScore(
  durationMinutes: number,
  deepSleepMinutes: number,
  remSleepMinutes: number,
  awakeMinutes: number,
  wakeCount: number,
  latencyMinutes: number,
  targetDurationMinutes: number = 480
): { score: number; efficiency: number } {
  const totalBedMinutes = durationMinutes + awakeMinutes + latencyMinutes;
  const efficiency = totalBedMinutes > 0 ? Math.round((durationMinutes / totalBedMinutes) * 100) : 0;

  // 1. Duration score (max 40) — 相对用户自设目标的偏差计分；过长与过短对称扣分
  //    （睡眠科学与流行病学研究均支持时长过短与过长关联更差结局）
  const durationHours = durationMinutes / 60;
  const absDiffHours = Math.abs(durationHours - targetDurationMinutes / 60);
  let durationScore = 0;
  if (absDiffHours <= 0.5) {
    durationScore = 40;
  } else if (absDiffHours <= 1) {
    durationScore = 35;
  } else if (absDiffHours <= 1.5) {
    durationScore = 28;
  } else if (absDiffHours <= 2.5) {
    durationScore = 18;
  } else {
    durationScore = 10;
  }

  // 2. Deep sleep ratio score (max 20)
  const deepRatio = durationMinutes > 0 ? deepSleepMinutes / durationMinutes : 0;
  let deepScore = 0;
  if (deepRatio >= 0.16 && deepRatio <= 0.25) {
    deepScore = 20;
  } else if (deepRatio >= 0.12) {
    deepScore = 16;
  } else if (deepRatio >= 0.08) {
    deepScore = 12;
  } else {
    deepScore = 8;
  }

  // 3. REM sleep ratio score (max 20)
  const remRatio = durationMinutes > 0 ? remSleepMinutes / durationMinutes : 0;
  let remScore = 0;
  if (remRatio >= 0.20 && remRatio <= 0.26) {
    remScore = 20;
  } else if (remRatio >= 0.15) {
    remScore = 16;
  } else if (remRatio >= 0.10) {
    remScore = 11;
  } else {
    remScore = 7;
  }

  // 4. Efficiency & awakenings penalty (max 20)
  let restScore = 20;
  if (wakeCount > 3) restScore -= (wakeCount - 3) * 2;
  if (latencyMinutes > 30) restScore -= Math.min(6, Math.floor((latencyMinutes - 30) / 10) * 2);
  if (efficiency < 85) restScore -= Math.min(6, Math.floor((85 - efficiency) / 3));
  // CBT-I 对齐：效率极低（卧床时间远超实际睡眠）要显著扣分，
  // 不能让"躺在床上更久"反而拿到更高分（与睡眠限制疗法方向一致）
  if (efficiency < 60) restScore -= Math.min(12, Math.round((60 - efficiency) / 5));
  restScore = Math.max(0, restScore);

  // 低分不托底：短睡/零深睡就该拿低分（此前 Math.max(25,…) 会让差记录虚高 15-20 分）
  const finalScore = Math.min(99, Math.max(5, durationScore + deepScore + remScore + restScore));

  return {
    score: finalScore,
    // 如实报告效率：此前 Math.max(50,…) 会把真实 25% 的效率显示成 50%
    efficiency: Math.min(99, Math.max(0, efficiency)),
  };
}

/**
 * Generates realistic cyclical sleep stage segments (Deep -> Light -> REM -> Awake)
 * across 90-110 min sleep ultradian cycles.
 */
export function generateSleepStages(
  bedtimeStr: string,
  wakeTimeStr: string,
  latencyMinutes: number = 12
): {
  stages: SleepStageSegment[];
  deepMinutes: number;
  lightMinutes: number;
  remMinutes: number;
  awakeMinutes: number;
} {
  const [bHour, bMin] = bedtimeStr.split(':').map(Number);
  const [wHour, wMin] = wakeTimeStr.split(':').map(Number);

  let bedDate = new Date();
  bedDate.setHours(bHour, bMin, 0, 0);

  let wakeDate = new Date();
  wakeDate.setHours(wHour, wMin, 0, 0);
  if (wakeDate.getTime() <= bedDate.getTime()) {
    wakeDate.setDate(wakeDate.getDate() + 1);
  }

  const totalMin = Math.round((wakeDate.getTime() - bedDate.getTime()) / 60000);
  const stages: SleepStageSegment[] = [];

  let currentMin = 0;
  let deepMin = 0;
  let lightMin = 0;
  let remMin = 0;
  let awakeMin = 0;

  // 入睡潜伏期：清醒段（时长由调用方给定，演示数据用各家真实值保持一致）
  const latency = Math.max(1, Math.min(120, Math.round(latencyMinutes)));
  stages.push({
    stage: 'awake',
    startTime: formatTimeOffset(bedDate, currentMin),
    endTime: formatTimeOffset(bedDate, currentMin + latency),
    durationMinutes: latency,
  });
  awakeMin += latency;
  currentMin += latency;

  // Cycles of ~90 mins: deep -> light -> rem
  let cycleNum = 0;
  while (currentMin < totalMin - 15) {
    cycleNum++;
    const remaining = totalMin - currentMin;

    // Earlier cycles have more deep sleep, later cycles have more REM
    const deepDuration = cycleNum <= 2 ? Math.min(35, Math.floor(remaining * 0.35)) : Math.min(15, Math.floor(remaining * 0.15));
    const lightDuration = Math.min(30, Math.floor(remaining * 0.4));
    const remDuration = cycleNum >= 2 ? Math.min(25, Math.floor(remaining * 0.28)) : Math.min(14, Math.floor(remaining * 0.15));

    if (deepDuration > 5) {
      stages.push({
        stage: 'deep',
        startTime: formatTimeOffset(bedDate, currentMin),
        endTime: formatTimeOffset(bedDate, currentMin + deepDuration),
        durationMinutes: deepDuration,
      });
      deepMin += deepDuration;
      currentMin += deepDuration;
    }

    if (lightDuration > 5 && currentMin < totalMin - 10) {
      stages.push({
        stage: 'light',
        startTime: formatTimeOffset(bedDate, currentMin),
        endTime: formatTimeOffset(bedDate, currentMin + lightDuration),
        durationMinutes: lightDuration,
      });
      lightMin += lightDuration;
      currentMin += lightDuration;
    }

    if (remDuration > 5 && currentMin < totalMin - 10) {
      stages.push({
        stage: 'rem',
        startTime: formatTimeOffset(bedDate, currentMin),
        endTime: formatTimeOffset(bedDate, currentMin + remDuration),
        durationMinutes: remDuration,
      });
      remMin += remDuration;
      currentMin += remDuration;
    }

    // Occasional brief arousal
    if (cycleNum === 2 && currentMin < totalMin - 20) {
      stages.push({
        stage: 'awake',
        startTime: formatTimeOffset(bedDate, currentMin),
        endTime: formatTimeOffset(bedDate, currentMin + 5),
        durationMinutes: 5,
      });
      awakeMin += 5;
      currentMin += 5;
    }
  }

  // Final waking period
  if (currentMin < totalMin) {
    const finalDiff = totalMin - currentMin;
    stages.push({
      stage: 'light',
      startTime: formatTimeOffset(bedDate, currentMin),
      endTime: formatTimeOffset(bedDate, totalMin),
      durationMinutes: finalDiff,
    });
    lightMin += finalDiff;
  }

  return {
    stages,
    deepMinutes: deepMin,
    lightMinutes: lightMin,
    remMinutes: remMin,
    awakeMinutes: awakeMin,
  };
}

function formatTimeOffset(baseDate: Date, minutesOffset: number): string {
  const d = new Date(baseDate.getTime() + minutesOffset * 60000);
  const h = String(d.getHours()).padStart(2, '0');
  const m = String(d.getMinutes()).padStart(2, '0');
  return `${h}:${m}`;
}

export function formatDurationChinese(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  if (h === 0) return `${m}分钟`;
  return `${h}小时${m > 0 ? `${m}分` : ''}`;
}

/**
 * 7 Days of realistic pre-seeded initial logs.
 * 数值字段全部从分期推演结果派生（deep/light/rem/awake/时长/得分互相自洽），
 * 手写的只有作息时间、潜伏期与叙事字段——此前手写常量与分期各算各的，
 * 分期总和比声明时长多 30-40 分钟、深睡最多差 61 分钟。
 */
const DEMO_SPEC: Array<{
  id: string;
  date: string;
  bedtime: string;
  wakeTime: string;
  latencyMinutes: number;
  wakingMood: WakingMood;
  preSleepHabits: string[];
  dreamNotes?: string;
}> = [
  {
    id: 'log-7',
    date: '2026-09-22', // Last night
    bedtime: '23:15',
    wakeTime: '07:10',
    latencyMinutes: 14,
    wakingMood: 'refreshed',
    preSleepHabits: ['reading', 'hot_bath', 'meditation'],
    dreamNotes: '梦见在海边森林散步，微风徐徐，很舒服。',
  },
  { id: 'log-6', date: '2026-09-21', bedtime: '23:45', wakeTime: '07:00', latencyMinutes: 22, wakingMood: 'neutral', preSleepHabits: ['screen_time'] },
  { id: 'log-5', date: '2026-09-20', bedtime: '00:20', wakeTime: '07:30', latencyMinutes: 28, wakingMood: 'tired', preSleepHabits: ['screen_time', 'caffeine'], dreamNotes: '赶公交车迟到的紧张梦境。' },
  { id: 'log-4', date: '2026-09-19', bedtime: '23:30', wakeTime: '08:00', latencyMinutes: 12, wakingMood: 'refreshed', preSleepHabits: ['meditation', 'reading'] },
  { id: 'log-3', date: '2026-09-18', bedtime: '23:10', wakeTime: '06:55', latencyMinutes: 16, wakingMood: 'neutral', preSleepHabits: ['hot_bath'] },
  { id: 'log-2', date: '2026-09-17', bedtime: '01:05', wakeTime: '07:15', latencyMinutes: 35, wakingMood: 'groggy', preSleepHabits: ['screen_time', 'alcohol'] },
  { id: 'log-1', date: '2026-09-16', bedtime: '23:00', wakeTime: '07:05', latencyMinutes: 15, wakingMood: 'refreshed', preSleepHabits: ['meditation'] },
];

export function getInitialSleepLogs(): SleepRecord[] {
  return DEMO_SPEC.map((spec) => {
    const gen = generateSleepStages(spec.bedtime, spec.wakeTime, spec.latencyMinutes);
    const durationMinutes = gen.deepMinutes + gen.lightMinutes + gen.remMinutes; // 总窗 - 清醒
    // 夜醒次数 = 除入睡潜伏期外的清醒段数
    const wakeCount = Math.max(0, gen.stages.filter((s) => s.stage === 'awake').length - 1);
    const { score, efficiency } = calculateSleepScore(
      durationMinutes,
      gen.deepMinutes,
      gen.remMinutes,
      gen.awakeMinutes,
      wakeCount,
      spec.latencyMinutes
    );
    return {
      id: spec.id,
      date: spec.date,
      bedtime: spec.bedtime,
      wakeTime: spec.wakeTime,
      durationMinutes,
      deepSleepMinutes: gen.deepMinutes,
      lightSleepMinutes: gen.lightMinutes,
      remSleepMinutes: gen.remMinutes,
      awakeMinutes: gen.awakeMinutes,
      sleepScore: score,
      sleepEfficiency: efficiency,
      latencyMinutes: spec.latencyMinutes,
      wakeCount,
      wakingMood: spec.wakingMood,
      preSleepHabits: spec.preSleepHabits,
      dreamNotes: spec.dreamNotes,
      stages: gen.stages,
      ...(spec.id === 'log-7'
        ? {
            soundEvents: [
              { time: '02:40', decibel: 32, label: '翻身微动' },
              { time: '05:15', decibel: 38, label: '轻微呼吸声' },
            ],
          }
        : {}),
    } as SleepRecord;
  });
}
