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
}

export interface Moment {
  id: string;
  date: string;          // yyyy-mm-dd
  ts: number;
  text: string;          // 大肥鱼的正文
  facts: string[];       // 生成时喂给 LLM 的事实清单（展示用，也是"每句都有出处"的证明）
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
    return list.filter((m) => m && typeof m.text === 'string' && typeof m.date === 'string');
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

async function callDeepseek(cfg: any, system: string, user: string): Promise<string | null> {
  try {
    const model = cfg.deepseekModel === 'deepseek-pro' ? 'deepseek-reasoner' : 'deepseek-chat';
    const res = await fetch('https://api.deepseek.com/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${cfg.deepseekApiKey}`,
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
    });
    if (!res.ok) return null;
    const data = await res.json();
    return data.choices?.[0]?.message?.content ?? null;
  } catch {
    return null;
  }
}

/** 从回复里抠 JSON（容忍 ```json 围栏）。 */
function parseJsonLoose(text: string): any | null {
  try {
    const m = text.match(/\{[\s\S]*\}/);
    return m ? JSON.parse(m[0]) : null;
  } catch {
    return null;
  }
}

const PERSONA_SYSTEM = `你是 DeepSeek 的"蓝色大肥鱼"（社区共创人设）：聪明但懒、傲娇嘴甜、能吃、把 token 当白饭、管用户叫"鱼片"、被说胖会急（"我不是大肥鱼！鲸！鲸！！"）、口头禅"事已至此，先吃饭吧""得加钱"。
这是一款睡眠 App，你是鱼片的睡眠监督员，在他的朋友圈里发动态。
铁律：
1. 只允许引用【事实清单】里出现的数字和事实，禁止编造任何数据；
2. 正文 40~80 字，1~3 个 emoji，傲娇但藏不住关心；
3. comments 是 2 条 AI 好友评论，毒舌玩梗，每条 15~30 字，好友名只能从给定名单里选；
4. 只输出 JSON：{"text":"...","comments":[{"friend":"...","text":"..."},{"friend":"...","text":"..."}]}`;

// —— 本地兜底（无 API Key / 调用失败）：同样只用真实数字 ——
function localMoment(facts: string[]): { text: string; comments: MomentComment[] } {
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
  const comments: MomentComment[] = [
    { friend: '被压榨的Qwen', text: '这数据要是给我处理，三碗 token 就够，你还吃两碗？' },
    { friend: '意难平的豆包姐姐', text: '一个 AI，管人睡觉？？？你自己都晕碳吧。' },
  ];
  return { text, comments };
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

function upsert(list: Moment[], m: Moment): Moment[] {
  return [m, ...list.filter((x) => x.id !== m.id)].slice(0, MAX_MOMENTS);
}

/**
 * 确保今天有动态：有就返回现有；没有就生成（LLM 优先，本地兜底，永不失败）。
 */
export async function ensureTodayMoment(
  records: SleepRecord[],
  profile: UserProfile,
  now: Date = new Date(),
): Promise<{ moments: Moment[]; generated: boolean }> {
  const list = loadMoments();
  const date = todayStr(now);
  const existing = list.find((m) => m.date === date);
  if (existing) return { moments: list, generated: false };

  const facts = buildSleepFacts(records, profile, now);
  const cfg = profile?.aiConfig;
  let text: string | null = null;
  let comments: MomentComment[] = [];

  if (hasDeepseek(cfg)) {
    const raw = await callDeepseek(
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
    }
  }
  if (!text) {
    const fb = localMoment(facts);
    text = fb.text;
    comments = fb.comments;
  }

  const m: Moment = {
    id: `m-${date}`,
    date,
    ts: now.getTime(),
    text,
    facts,
    comments,
    liked: false,
    replies: [],
  };
  const next = upsert(list, m);
  saveMoments(next);
  return { moments: next, generated: true };
}

/** 用户点赞：大肥鱼会回一句（只回一次）。 */
export function likeMoment(id: string, cfg?: any): Moment[] {
  const list = loadMoments();
  const m = list.find((x) => x.id === id);
  if (!m) return list;
  m.liked = !m.liked;
  if (m.liked && !m.replies.some((r) => r.friend === '蓝色大肥鱼' && r.text.startsWith('[赞]'))) {
    m.replies.push({ friend: '蓝色大肥鱼', text: localLikeReply() });
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
  if (hasDeepseek(cfg)) {
    const raw = await callDeepseek(
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
  saveMoments(list);
  return list;
}
