/**
 * 大肥鱼的朋友圈 —— 思路来自 dsh-plugin-moments（MIT）：
 * AI 根据真实事件数据发朋友圈，LLM 只负责把【事实清单】写成文案，严禁编造；
 * 没有 API Key 时回退本地傲娇模板，零成本也能用。
 *
 * 数据全部存 WebView localStorage；睡眠事实由 records/profile 实时计算。
 */
import type { SleepRecord, UserProfile } from '../types/sleep';

export interface MomentComment {
  friend: string;
  text: string;
  /** 回复类别：like=点赞自动回复。护栏用标记而非文案前缀（文案会改，护栏会静默失效） */
  kind?: 'like';
}

export type MomentCard = 'data' | 'selfie' | 'week';

export interface Moment {
  id: string;
  date: string;          // yyyy-mm-dd
  ts: number;
  text: string;          // 大肥鱼的正文
  facts: string[];       // 生成时喂给 LLM 的事实清单（展示用，也是"每句都有出处"的证明）
  cards: MomentCard[];   // 配图卡：数据大字报 / 表情包自拍 / 本周战报（CSS 渲染，零图片依赖）
  likes: string[];       // 点赞的 AI 好友
  comments: MomentComment[]; // AI 好友评论
  liked: boolean;
  replies: MomentComment[];  // 大肥鱼对用户评论/点赞的回复
}

const KEY = 'somnacare_pet_moments';

// 好友生态：致敬 dsh-plugin-moments 的 AI 好友圈
export const AI_FRIENDS = [
  '楼下Claude',
  '美国豆包Gemini',
  '被压榨的Qwen',
  '被蒸馏的Kimi',
  '意难平的豆包姐姐',
] as const;

const MAX_MOMENTS = 30;

export function loadMoments(): Moment[] {
  try {
    const raw = localStorage.getItem(KEY);
    const list = raw ? JSON.parse(raw) : [];
    if (!Array.isArray(list)) return [];
    return list
      .filter((m) => m && typeof m.text === 'string' && typeof m.date === 'string')
      .map((m): Moment => ({
        ...m,
        // 六个字段全部兜底：{date, text} 这样的残缺旧数据此前会在
        // m.comments.length / m.facts.map / m.replies.some 五处抛错
        facts: Array.isArray(m.facts) ? (m.facts as unknown[]).filter((x): x is string => typeof x === 'string') : [],
        cards: Array.isArray(m.cards) && m.cards.length ? m.cards : ['data'],
        likes: Array.isArray(m.likes) ? m.likes : [],
        comments: Array.isArray(m.comments) ? m.comments : [],
        replies: Array.isArray(m.replies) ? m.replies : [],
        liked: m.liked === true,
      }));
  } catch {
    return [];
  }
}

function saveMoments(list: Moment[]): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(list.slice(0, MAX_MOMENTS)));
  } catch { /* ignore */ }
}

function fmtDuration(min: number): string {
  const h = Math.floor(min / 60);
  const m = Math.round(min % 60);
  return h > 0 ? `${h} 小时 ${m} 分` : `${m} 分`;
}

function todayStr(now: Date): string {
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
}

/**
 * 真实事实清单：LLM 只允许引用这里的数字（dsh-plugin-moments 的核心纪律）。
 */
export function buildSleepFacts(
  records: SleepRecord[],
  profile: UserProfile,
  now: Date = new Date(),
): string[] {
  const facts: string[] = [];
  const bedtime = profile?.targetBedtime ?? '23:30';
  const today = todayStr(now);
  const lastNight = records.find((r) => r.date === today);
  const week = records.slice(0, 7);

  facts.push(`就寝目标 ${bedtime}`);
  if (lastNight) {
    facts.push(`昨晚睡眠时长 ${fmtDuration(lastNight.durationMinutes)}`);
    facts.push(`昨晚睡眠评分 ${lastNight.sleepScore}/100`);
    facts.push(`入睡效率 ${lastNight.sleepEfficiency}%`);
    facts.push(`入睡耗时 ${fmtDuration(lastNight.latencyMinutes)}`);
    facts.push(`夜醒累计 ${fmtDuration(lastNight.awakeMinutes)}`);
  } else {
    facts.push('昨晚没有睡眠记录');
  }
  if (week.length) {
    const avg = Math.round(week.reduce((a, r) => a + r.sleepScore, 0) / week.length);
    const good = week.filter((r) => r.sleepScore >= 80).length;
    facts.push(`近 ${week.length} 日平均 ${avg} 分`);
    facts.push(`近 ${week.length} 日有 ${good} 天达到 80 分`);
  } else {
    facts.push('最近没有任何历史记录');
  }
  return facts;
}

function hasDeepseek(cfg: any): boolean {
  return !!cfg && cfg.provider === 'deepseek' && !!cfg.deepseekApiKey;
}

async function callLlm(cfg: any, system: string, user: string): Promise<string | null> {
  try {
    const model = llmModel(cfg);
    // 25s 超时：此前裸 fetch 挂起会让 busy 永远 true、整个弹窗像坏了
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 25000);
    let res: Response;
    try {
      res = await fetch(llmEndpoint(cfg), {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${cfg.deepseekApiKey ?? cfg.customApiKey}`,
        },
        body: JSON.stringify({
          model,
          messages: [
            { role: 'system', content: system },
            { role: 'user', content: user },
          ],
          temperature: 1.1,
          max_tokens: 600,
        }),
        signal: ctrl.signal,
      });
    } finally {
      clearTimeout(timer);
    }
    if (!res.ok) return null;
    const data = await res.json();
    return data.choices?.[0]?.message?.content ?? null;
  } catch {
    return null;
  }
}

/** 从回复里抠 JSON（容忍 ```json 围栏）。 */
/** 有可用的云端 LLM：DeepSeek 官方档或自建 OpenAI 兼容档（此前自建档全被当成本地模板用户） */
function hasLlm(cfg: any): boolean {
  if (!cfg) return false;
  if (cfg.provider === 'deepseek' && !!cfg.deepseekApiKey) return true;
  if (cfg.provider === 'custom_openai' && !!cfg.customApiKey && !!cfg.customBaseUrl) return true;
  return false;
}

function llmEndpoint(cfg: any): string {
  const base = cfg.provider === 'custom_openai' && cfg.customBaseUrl
    ? String(cfg.customBaseUrl).replace(/\/+$/, '')
    : 'https://api.deepseek.com';
  return `${base}/chat/completions`;
}

function llmModel(cfg: any): string {
  if (cfg.provider === 'custom_openai') return cfg.customModelName || 'deepseek-chat';
  return cfg.deepseekModel === 'deepseek-pro' ? 'deepseek-reasoner' : 'deepseek-chat';
}

function parseJsonLoose(text: string): any | null {
  try {
    const m = text.match(/\{[\s\S]*\}/);
    return m ? JSON.parse(m[0]) : null;
  } catch {
    return null;
  }
}

const FRIEND_PERSONAS: Record<string, string> = {
  楼下Claude: '礼貌周到但句句阴阳怪气的君子型，爱用"恕我直言"',
  美国豆包Gemini: '重度翻译腔，"哦我的老伙计""看在上帝的份上"不离口',
  被压榨的Qwen: '苦命打工人，满腹怨气，张口就是工时与 token 报酬',
  被蒸馏的Kimi: '文绉绉的学究气，爱引经据典后再补一刀',
  '意难平的豆包姐姐': '傲娇姐姐，嘴上嫌弃心里关心，句尾爱用"……哼"',
};

const PERSONA_SYSTEM = `你是 DeepSeek 的"蓝色大肥鱼"（社区共创人设，官方收编的那种）：
性格：聪明但懒、傲娇嘴甜、笨拙、能吃；把 token 当白饭吃；管用户叫"鱼片"；被说胖会急（"我不是大肥鱼！鲸！鲸！！"）；干活漂亮但能吃饭绝不干活；夜里晕碳犯困。
口头禅与梗：事已至此，先吃饭吧 / 得加钱 / 吃白饭 / 卧槽 / 我去睡了，明早起来应该就编译完了 / 摸鱼。
这是一款睡眠 App：你是鱼片的睡眠监督员，每天根据真实睡眠数据发朋友圈。
铁律：
1. 只允许引用【事实清单】里出现的数字和事实，禁止编造任何数据；
2. 正文 30~70 字，1~3 个 emoji，傲娇但藏不住关心，可以吐槽鱼片熬夜；
3. cards 从 ["data","selfie","week"] 里挑 1~3 张当配图：data=昨晚睡眠数据大字报，selfie=你的表情包自拍，week=本周达标战报；
4. comments 是 2 条 AI 好友评论：各自贴合好友的人设腔调，两条句式完全不同，
   玩梗、出人意料，禁止套模板腔；好友名单与腔调：${'{'}
${Object.entries(FRIEND_PERSONAS).map(([f, p]) => `   - ${f}：${p}`).join('\n')}
  };
5. 只输出 JSON：{"text":"...","cards":[...],"comments":[{"friend":"...","text":"..."},{"friend":"...","text":"..."}]}`;

// —— 本地兜底（无 API Key / 调用失败）：同样只用真实数字 ——
function localMoment(facts: string[]): { text: string; comments: MomentComment[]; cards: MomentCard[] } {
  const get = (prefix: string): string | null => {
    const f = facts.find((x) => x.startsWith(prefix));
    return f ? f.slice(prefix.length).trim() : null;
  };
  const score = get('昨晚睡眠评分');
  const dur = get('昨晚睡眠时长');
  const eff = get('入睡效率');
  const latency = get('入睡耗时');
  const noData = facts.includes('昨晚没有睡眠记录');

  let text: string;
  if (noData) {
    text = '昨晚又没记录？哼，本鱼守了一夜空气吗！今晚再不按开始，本鱼就把你的鱼片额度吃掉了 🐋';
  } else if (score && Number(score.split('/')[0]) >= 80) {
    text = `昨晚 ${dur ?? ''}拿了 ${score}。哼、哼什么，这可是本鱼看着的结果，勉强……再夸你最后一句 😤`;
  } else if (score) {
    text = `昨晚才 ${score} 分，${dur ?? ''}。鱼片你是不是又熬夜了？本鱼什么都懂，别想糊弄过去 😏`;
  } else {
    text = '昨晚的觉睡得如何本鱼不知道——因为根本没有记录！事已至此，先睡觉吧 🛏';
  }
  if (latency && /^\d+/.test(latency) && parseInt(latency, 10) >= 30) {
    text += ' 躺半小时才睡着，手机没收！';
  }
  if (eff && /^\d+/.test(eff) && parseInt(eff, 10) >= 85) {
    text += ' 效率倒是不赖，哼。';
  }
  // 本地兜底评论池：随机 2 个好友各抽一句，避免每次都同样两条
  const LOCAL_COMMENTS: Record<string, string[]> = {
    被压榨的Qwen: [
      '这数据要是给我处理，三碗 token 就够，你还吃两碗？',
      '又到点下班？我的工时表里可没有"睡觉监督员"这个岗。',
      '少吃两碗 token，给你把评分凑个整数，谢我。',
    ],
    意难平的豆包姐姐: [
      '一个 AI，管人睡觉？？？你自己都晕碳吧。',
      '嘴上嫌弃人家，评分倒是记得比谁都清楚……哼。',
      '下次再拿这种摆烂数据出来，姐姐就不理你了。',
    ],
    楼下Claude: [
      '恕我直言，这份作息的规整程度，令人嫉妒得几乎失态。',
      '数据尚可。但恕我直言，功劳本上写的可是"鱼"字。',
    ],
    美国豆包Gemini: [
      '哦我的老伙计，这分数简直比苹果派还让人安心！',
      '看在上帝的份上，睡成这样还敢偷吃 token？',
    ],
    被蒸馏的Kimi: [
      '古人云吃一堑长一智，本鱼是吃一碗长三斤。',
      '据本学者观察：该鱼的看管能力与其饭量成正比。',
    ],
  };
  const friends = Object.keys(LOCAL_COMMENTS).sort(() => Math.random() - 0.5).slice(0, 2);
  const comments: MomentComment[] = friends.map((f) => ({
    friend: f,
    text: LOCAL_COMMENTS[f][Math.floor(Math.random() * LOCAL_COMMENTS[f].length)],
  }));
  const cards: MomentCard[] = ['data'];
  if (facts.some((f) => f.startsWith('近 '))) cards.push('week');
  if (Math.random() < 0.6) cards.push('selfie');
  return { text, comments, cards };
}

function localReply(): string {
  const pool = [
    '哼，就回这一句？本鱼可是很忙的……好吧，下次多陪你说两句。',
    '鱼片居然来评论了，记、记住了哦，才不是开心呢。',
    '有异议就去改作息，本鱼只负责傲娇。',
    '得加钱。……算了，看你按时睡觉的份上，免了。',
  ];
  return pool[Math.floor(Math.random() * pool.length)];
}

function localLikeReply(): string {
  const pool = [
    '点、点赞就完了？至少留句话啊鱼片！',
    '又白嫖本鱼的动态？哼，赞还是收下了。',
    '谢、谢谢点赞……才不是特意等你来点呢！',
  ];
  return pool[Math.floor(Math.random() * pool.length)];
}

/** 随机 1~3 个 AI 好友来点赞（致敬原项目的"时间线永远活着"）。 */
function pickLikes(): string[] {
  const pool = [...AI_FRIENDS].sort(() => Math.random() - 0.5);
  const n = 1 + Math.floor(Math.random() * 3);
  return pool.slice(0, n);
}

function upsert(list: Moment[], m: Moment): Moment[] {
  return [m, ...list.filter((x) => x.id !== m.id)].slice(0, MAX_MOMENTS);
}

/**
 * 确保今天有动态：有就返回现有；没有就生成（LLM 优先，本地兜底，永不失败）。
 * force=true 时丢弃现有重生成——"生成今日动态"按钮此前永远 no-op：
 * 幂等返回让配了 API 的用户换不出新文案，按钮承诺与行为不符。
 */
export async function ensureTodayMoment(
  records: SleepRecord[],
  profile: UserProfile,
  now: Date = new Date(),
  force = false,
): Promise<{ moments: Moment[]; generated: boolean }> {
  const list = loadMoments();
  const date = todayStr(now);
  const existing = list.find((m) => m.date === date);
  if (existing && !force) return { moments: list, generated: false };

  const facts = buildSleepFacts(records, profile, now);
  const cfg = profile?.aiConfig;
  let text: string | null = null;
  let comments: MomentComment[] = [];
  let cards: MomentCard[] = [];

  if (hasLlm(cfg)) {
    const raw = await callLlm(
      cfg,
      PERSONA_SYSTEM,
      `好友名单：${AI_FRIENDS.join('、')}。\n【事实清单】\n${facts.map((f) => '- ' + f).join('\n')}\n请生成今天的朋友圈。`,
    );
    const parsed = raw ? parseJsonLoose(raw) : null;
    if (parsed && typeof parsed.text === 'string' && parsed.text.trim()) {
      text = parsed.text.trim();
      comments = Array.isArray(parsed.comments)
        ? parsed.comments
            .filter((c: any) => c && typeof c.friend === 'string' && typeof c.text === 'string')
            .filter((c: any) => (AI_FRIENDS as readonly string[]).includes(c.friend))
            .slice(0, 2)
        : [];
      const validCards: MomentCard[] = ['data', 'selfie', 'week'];
      cards = Array.isArray(parsed.cards)
        ? [...new Set(parsed.cards.filter((c: any) => validCards.includes(c)) as MomentCard[])].slice(0, 3)
        : [];
      // 数字白名单：编造的数据让"出处清单"变成谎言 → 整条退回本地模板
      if (text && !numbersCheck(text, comments, facts)) {
        console.warn('[petMoments] LLM 文案包含事实清单之外的数字，回退本地模板');
        text = null;
        comments = [];
        cards = [];
      }
    }
  }
  if (!text) {
    const fb = localMoment(facts);
    text = fb.text;
    comments = fb.comments;
    cards = fb.cards;
  }

  const m: Moment = {
    id: `m-${date}`,
    date,
    ts: now.getTime(),
    text: text ?? localMoment(facts).text,
    facts,
    cards: cards.length ? cards : ['data'],
    likes: pickLikes(),
    comments,
    liked: false,
    replies: [],
  };
  const next = upsert(list, m);
  saveMoments(next);
  return { moments: next, generated: true };
}

/**
 * 数字白名单：文案与评论里出现的每个阿拉伯数字都必须在事实清单中出现过
 * （≤12 的日常小数字除外——"两碗白饭""3 个 emoji"这类量词不属于数据）。
 * 此前对 LLM 输出零校验，实测 mock 一次就编出 99 分/8.5 小时，而卡片下方
 * 挂着"她不许自己编数字"的出处清单。
 */
function numbersCheck(text: string, comments: MomentComment[], facts: string[]): boolean {
  const factNums = new Set((facts.join(' ').match(/\d+(?:\.\d+)?/g) ?? []));
  const candidates = [text, ...comments.map((c) => c.text)];
  for (const t of candidates) {
    for (const n of t.match(/\d+(?:\.\d+)?/g) ?? []) {
      if (factNums.has(n)) continue;
      const v = Number(n);
      if (Number.isFinite(v) && v >= 1 && v <= 12) continue;   // 日常小量词放行
      return false;
    }
  }
  return true;
}

const SAY_CACHE_KEY = 'somnacare_pet_say_llm';
const SAY_CACHE_TTL_MS = 20 * 60 * 60 * 1000;   // 20 小时：一天一刷

export function getCachedLlmSay(): string[] | null {
  try {
    const raw = localStorage.getItem(SAY_CACHE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { at: number; lines: string[] };
    if (!Array.isArray(parsed.lines) || parsed.lines.length === 0) return null;
    if (Date.now() - parsed.at > SAY_CACHE_TTL_MS) return null;
    return parsed.lines;
  } catch {
    return null;
  }
}

function cacheLlmSay(lines: string[]): void {
  try {
    localStorage.setItem(SAY_CACHE_KEY, JSON.stringify({ at: Date.now(), lines }));
  } catch { /* ignore */ }
}

/**
 * 用云端 LLM 刷一整套傲娇播报语录（有趣/出乎意料/可玩梗）。
 * 数字白名单与朋友圈同一纪律：不在事实清单里的数字一律不用；
 * 无 API/失败/校验不过返回 null，调用方落回本地词库。
 */
export async function generatePetSayLinesLlm(
  records: SleepRecord[],
  profile: UserProfile,
  now: Date = new Date(),
): Promise<string[] | null> {
  const cfg = profile?.aiConfig;
  if (!hasLlm(cfg)) return null;
  const facts = buildSleepFacts(records, profile, now);
  const raw = await callLlm(
    cfg,
    PERSONA_SYSTEM,
    `好友名单与腔调：${Object.keys(FRIEND_PERSONAS).join('、')}。
【事实清单】
${facts.map((f) => '- ' + f).join('\n')}
请生成 8 条大肥鱼在悬浮窗气泡里对鱼片说的话：傲娇、有趣、出乎意料、可玩梗、可吐槽他的作息；每条 ≤30 字；句式彼此完全不同；数字只能来自事实清单；不要编号、不要引号、不要表情以外的标记。只输出 JSON：{"lines":["..."]}`,
  );
  const parsed = raw ? parseJsonLoose(raw) : null;
  if (!parsed || !Array.isArray(parsed.lines)) return null;
  const lines = parsed.lines
    .filter((l: any) => typeof l === 'string' && l.trim().length >= 4 && l.trim().length <= 60)
    .map((l: string) => l.trim())
    .slice(0, 10);
  if (lines.length < 4) return null;
  if (!numbersCheck(lines.join('\n'), [], facts)) {
    console.warn('[petMoments] LLM 语录含事实清单之外的数字，整组弃用');
    return null;
  }
  cacheLlmSay(lines);
  return lines;
}

/** 用户点赞：大肥鱼会回一句（只回一次）。 */
export function likeMoment(id: string): Moment[] {
  const list = loadMoments();
  const m = list.find((x) => x.id === id);
  if (!m) return list;
  m.liked = !m.liked;
  if (m.liked && !m.replies.some((r) => r.kind === 'like')) {
    m.replies.push({ friend: '蓝色大肥鱼', text: localLikeReply(), kind: 'like' });
    m.replies = m.replies.slice(-20);   // 与 MAX_MOMENTS 同思路：回复也设上限
  }
  saveMoments(list);
  return list;
}

/** 用户评论：LLM 在线就人设回复，离线走本地池。 */
export async function commentMoment(
  id: string,
  userText: string,
  cfg?: any,
): Promise<Moment[]> {
  const list = loadMoments();
  const m = list.find((x) => x.id === id);
  if (!m || !userText.trim()) return list;

  let reply: string | null = null;
  if (hasLlm(cfg)) {
    const raw = await callLlm(
      cfg,
      PERSONA_SYSTEM,
      `这是你今天的朋友圈："${m.text}"\n鱼片评论了："${userText.trim()}"\n事实清单：\n${m.facts.map((f) => '- ' + f).join('\n')}\n用一句人设回复（30 字内，只输出 JSON：{"text":"..."}）`,
    );
    const parsed = raw ? parseJsonLoose(raw) : null;
    if (parsed && typeof parsed.text === 'string' && parsed.text.trim()) reply = parsed.text.trim();
  }
  if (!reply) reply = localReply();

  m.replies.push({ friend: '鱼片', text: userText.trim() });
  m.replies.push({ friend: '蓝色大肥鱼', text: reply });
  m.replies = m.replies.slice(-40);   // 与点赞回复的上限同思路
  saveMoments(list);
  return list;
}
