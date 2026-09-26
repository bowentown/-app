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
  restScore = Math.max(4, restScore);

  const finalScore = Math.min(99, Math.max(25, durationScore + deepScore + remScore + restScore));

  return {
    score: finalScore,
    efficiency: Math.min(99, Math.max(50, efficiency)),
  };
}

/**
 * Generates realistic cyclical sleep stage segments (Deep -> Light -> REM -> Awake)
 * across 90-110 min sleep ultradian cycles.
 */
export function generateSleepStages(bedtimeStr: string, wakeTimeStr: string): {
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

  // Initial latency: awake 12 mins
  stages.push({
    stage: 'awake',
    startTime: formatTimeOffset(bedDate, currentMin),
    endTime: formatTimeOffset(bedDate, currentMin + 12),
    durationMinutes: 12,
  });
  awakeMin += 12;
  currentMin += 12;

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
 * 7 Days of realistic pre-seeded initial logs
 */
export function getInitialSleepLogs(): SleepRecord[] {
  const logs: SleepRecord[] = [
    {
      id: 'log-7',
      date: '2026-09-22', // Last night
      bedtime: '23:15',
      wakeTime: '07:10',
      durationMinutes: 445, // 7h 25m
      deepSleepMinutes: 98, // 22%
      lightSleepMinutes: 227, // 51%
      remSleepMinutes: 92, // 21%
      awakeMinutes: 28,
      sleepScore: 89,
      sleepEfficiency: 94,
      latencyMinutes: 14,
      wakeCount: 1,
      wakingMood: 'refreshed',
      preSleepHabits: ['reading', 'hot_bath', 'meditation'],
      dreamNotes: '梦见在海边森林散步，微风徐徐，很舒服。',
      stages: generateSleepStages('23:15', '07:10').stages,
      soundEvents: [
        { time: '02:40', decibel: 32, label: '翻身微动' },
        { time: '05:15', decibel: 38, label: '轻微呼吸声' },
      ],
    },
    {
      id: 'log-6',
      date: '2026-09-21',
      bedtime: '23:45',
      wakeTime: '07:00',
      durationMinutes: 405, // 6h 45m
      deepSleepMinutes: 72,
      lightSleepMinutes: 223,
      remSleepMinutes: 80,
      awakeMinutes: 30,
      sleepScore: 81,
      sleepEfficiency: 91,
      latencyMinutes: 22,
      wakeCount: 2,
      wakingMood: 'neutral',
      preSleepHabits: ['screen_time'],
      stages: generateSleepStages('23:45', '07:00').stages,
    },
    {
      id: 'log-5',
      date: '2026-09-20',
      bedtime: '00:20',
      wakeTime: '07:30',
      durationMinutes: 390, // 6h 30m
      deepSleepMinutes: 58,
      lightSleepMinutes: 232,
      remSleepMinutes: 70,
      awakeMinutes: 40,
      sleepScore: 74,
      sleepEfficiency: 86,
      latencyMinutes: 28,
      wakeCount: 3,
      wakingMood: 'tired',
      preSleepHabits: ['screen_time', 'caffeine'],
      dreamNotes: '赶公交车迟到的紧张梦境。',
      stages: generateSleepStages('00:20', '07:30').stages,
    },
    {
      id: 'log-4',
      date: '2026-09-19',
      bedtime: '23:30',
      wakeTime: '08:00',
      durationMinutes: 480, // 8h
      deepSleepMinutes: 110,
      lightSleepMinutes: 240,
      remSleepMinutes: 105,
      awakeMinutes: 25,
      sleepScore: 92,
      sleepEfficiency: 95,
      latencyMinutes: 12,
      wakeCount: 1,
      wakingMood: 'refreshed',
      preSleepHabits: ['meditation', 'reading'],
      stages: generateSleepStages('23:30', '08:00').stages,
    },
    {
      id: 'log-3',
      date: '2026-09-18',
      bedtime: '23:10',
      wakeTime: '06:55',
      durationMinutes: 435, // 7h 15m
      deepSleepMinutes: 90,
      lightSleepMinutes: 225,
      remSleepMinutes: 88,
      awakeMinutes: 32,
      sleepScore: 86,
      sleepEfficiency: 92,
      latencyMinutes: 16,
      wakeCount: 1,
      wakingMood: 'neutral',
      preSleepHabits: ['hot_bath'],
      stages: generateSleepStages('23:10', '06:55').stages,
    },
    {
      id: 'log-2',
      date: '2026-09-17',
      bedtime: '01:05',
      wakeTime: '07:15',
      durationMinutes: 330, // 5h 30m
      deepSleepMinutes: 45,
      lightSleepMinutes: 200,
      remSleepMinutes: 60,
      awakeMinutes: 40,
      sleepScore: 68,
      sleepEfficiency: 82,
      latencyMinutes: 35,
      wakeCount: 4,
      wakingMood: 'groggy',
      preSleepHabits: ['screen_time', 'alcohol'],
      stages: generateSleepStages('01:05', '07:15').stages,
    },
    {
      id: 'log-1',
      date: '2026-09-16',
      bedtime: '23:00',
      wakeTime: '07:05',
      durationMinutes: 455, // 7h 35m
      deepSleepMinutes: 104,
      lightSleepMinutes: 231,
      remSleepMinutes: 94,
      awakeMinutes: 26,
      sleepScore: 90,
      sleepEfficiency: 94,
      latencyMinutes: 15,
      wakeCount: 1,
      wakingMood: 'refreshed',
      preSleepHabits: ['meditation'],
      stages: generateSleepStages('23:00', '07:05').stages,
    },
  ];

  return logs;
}
