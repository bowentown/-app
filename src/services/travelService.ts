import type { TravelPostcard, UserTravelState } from '../types/travel';
import { TRIP_POOL, getPostcardById } from '../data/travelPostcards';

const TRAVEL_STATE_KEY = 'somnacare_travel_state';

export function getInitialTravelState(): UserTravelState {
  return {
    currentEnergy: 0,
    targetEnergy: 666,
    totalTrips: 0,
    unlockedCardIds: [],
    souvenirInventory: [],
    goldStars: {},
    countedScores: {},
    pendingArrival: null,
  };
}

/** 清洗 {cardId: 星级} / {date: 已计分} 形态的映射：只保留有限数值（防坏值串型累加） */
function sanitizeScoreMap(v: unknown): Record<string, number> {
  const out: Record<string, number> = {};
  if (typeof v === 'object' && v !== null) {
    for (const [k, val] of Object.entries(v as Record<string, unknown>)) {
      if (typeof val === 'number' && Number.isFinite(val)) out[k] = val;
    }
  }
  return out;
}

export function loadTravelState(): UserTravelState {
  try {
    const raw = localStorage.getItem(TRAVEL_STATE_KEY);
    if (!raw) return getInitialTravelState();
    const parsed = JSON.parse(raw);
    return {
      currentEnergy: typeof parsed.currentEnergy === 'number' && Number.isFinite(parsed.currentEnergy) ? parsed.currentEnergy : 0,
      targetEnergy: 666,
      totalTrips: typeof parsed.totalTrips === 'number' && Number.isFinite(parsed.totalTrips) ? parsed.totalTrips : 0,
      unlockedCardIds: Array.isArray(parsed.unlockedCardIds) ? parsed.unlockedCardIds.filter((x: unknown): x is string => typeof x === 'string') : [],
      souvenirInventory: Array.isArray(parsed.souvenirInventory) ? parsed.souvenirInventory.filter((x: unknown): x is string => typeof x === 'string') : [],
      goldStars: sanitizeScoreMap(parsed.goldStars),
      countedScores: sanitizeScoreMap(parsed.countedScores),
      pendingArrival: typeof parsed.pendingArrival === 'string' ? parsed.pendingArrival : null,
    };
  } catch {
    return getInitialTravelState();
  }
}

export function saveTravelState(state: UserTravelState): void {
  try {
    localStorage.setItem(TRAVEL_STATE_KEY, JSON.stringify(state));
  } catch {
    /* ignore storage errors */
  }
}

/**
 * 抽卡去重引擎：
 * 优先从未解锁卡池中抽取（纯保底无重复）；
 * 当卡池已全集齐时，进入二周目，增加该卡片的镀金星级。
 */
export function rollNextPostcard(
  state: UserTravelState,
  pool: TravelPostcard[] = TRIP_POOL
): { card: TravelPostcard; isNew: boolean } {
  const unlockedSet = new Set(state.unlockedCardIds);
  const unobtained = pool.filter((c) => !unlockedSet.has(c.id));

  if (unobtained.length > 0) {
    const randomIndex = Math.floor(Math.random() * unobtained.length);
    return { card: unobtained[randomIndex], isNew: true };
  }

  const allRandomIndex = Math.floor(Math.random() * pool.length);
  return { card: pool[allRandomIndex], isNew: false };
}

/**
 * 结算睡眠评分并注入旅行能量池（阈值恒为 666 分）。
 * @param sleepScore 睡眠得分 (0~100)
 * @param date 记录日期（YYYY-MM-DD）：同一晚重复保存/补录时按"取更高分"去重，
 *             此前每次保存都全额充能——重跑一次睡眠追踪能量就翻倍
 */
export function processDailySleepScore(sleepScore: number, date?: string): {
  state: UserTravelState;
  triggeredTrip: boolean;
  newCard?: TravelPostcard;
} {
  const state = loadTravelState();
  const safeScore = Math.max(0, Math.min(100, Math.round(sleepScore)));
  let energy = state.currentEnergy;
  if (date) {
    const counted = state.countedScores[date] || 0;
    const delta = safeScore - counted;
    if (delta > 0) {
      energy += delta;
      state.countedScores[date] = safeScore;
    }
  } else {
    energy += safeScore;   // 无日期（理论不达）：维持旧的逐次累加语义
  }
  let triggered = false;
  let newCard: TravelPostcard | undefined;

  if (energy >= state.targetEnergy) {
    energy -= state.targetEnergy; // 溢出分数顺延保留至下一轮
    triggered = true;

    const { card, isNew } = rollNextPostcard(state);
    newCard = card;

    state.totalTrips += 1;
    if (isNew) {
      if (!state.unlockedCardIds.includes(card.id)) {
        state.unlockedCardIds.push(card.id);
      }
      if (!state.souvenirInventory.includes(card.souvenir.name)) {
        state.souvenirInventory.push(card.souvenir.name);
      }
    } else {
      state.goldStars[card.id] = (state.goldStars[card.id] || 0) + 1;
    }
    state.pendingArrival = card.id;
  }

  state.currentEnergy = energy;
  saveTravelState(state);
  return { state, triggeredTrip: triggered, newCard };
}

export function clearPendingArrival(): void {
  const state = loadTravelState();
  if (state.pendingArrival) {
    state.pendingArrival = null;
    saveTravelState(state);
  }
}

export function getTravelProgress(): {
  unlockedCount: number;
  totalCount: number;
  percentage: number;
} {
  const state = loadTravelState();
  // 进度只统计插画已就绪的大洲（TRIP_POOL）——不然达成率永远停在 36%
  const poolIds = new Set(TRIP_POOL.map((c) => c.id));
  const totalCount = TRIP_POOL.length;
  const unlockedCount = state.unlockedCardIds.filter((id) => poolIds.has(id)).length;
  const percentage = totalCount > 0 ? Math.round((unlockedCount / totalCount) * 100) : 0;
  return { unlockedCount, totalCount, percentage };
}

export { getPostcardById };
