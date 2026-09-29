import React, { useEffect, useRef, useState } from 'react';
import { X, Heart, MessageCircle, Loader2, RefreshCw } from 'lucide-react';
import type { SleepRecord, UserProfile } from '../types/sleep';
import { useModalA11y } from '../utils/modalA11y';
import {
  ensureTodayMoment,
  likeMoment,
  commentMoment,
  loadMoments,
  type Moment,
  type MomentCard,
} from '../utils/petMoments';

interface Props {
  records: SleepRecord[];
  userProfile: UserProfile;
  onClose: () => void;
}

/** "今天 / 昨天 / MM-dd" */
function dayLabel(date: string): string {
  const now = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  const today = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
  const yest = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate() - 1)}`;
  if (date === today) return '今天';
  if (date === yest) return '昨天';
  return date.slice(5).replace('-', '/');
}

function clockLabel(ts: number): string {
  return new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

function factOf(facts: string[], prefix: string): string {
  const f = facts.find((x) => x.startsWith(prefix));
  return f ? f.slice(prefix.length).trim() : '';
}

const SELFIE_SRC = `${import.meta.env.BASE_URL || '/'}whale-selfie.png`;

/** 配图卡（CSS 渲染零依赖，致敬 dsh-plugin-moments 的九宫格混合图卡）。 */
const CardView: React.FC<{ type: MomentCard; moment: Moment }> = ({ type, moment }) => {
  if (type === 'selfie') {
    return (
      <div className="relative overflow-hidden rounded-xl bg-gradient-to-br from-sky-500/30 to-blue-900/40 border border-slate-700/60 aspect-square flex items-center justify-center">
        <img src={SELFIE_SRC} alt="大肥鱼自拍" className="w-4/5 h-4/5 object-contain drop-shadow-[0_2px_8px_rgba(56,189,248,0.35)]" />
        <span className="absolute bottom-1 left-1/2 -translate-x-1/2 px-1.5 py-0.5 rounded-md bg-black/50 text-[9px] font-bold text-sky-200 whitespace-nowrap">
          今日营业自拍 · 拒绝加班
        </span>
      </div>
    );
  }
  if (type === 'week') {
    const weekLine = moment.facts.find((f) => f.startsWith('近 '));
    const good = factOf(moment.facts, '近 7 日有 ');
    const goodDays = parseInt(good, 10);
    const total = weekLine ? parseInt((weekLine.match(/近 (\d+) 日/) || [])[1] || '7', 10) : 7;
    const pct = Number.isFinite(goodDays) ? Math.min(100, Math.round((goodDays / (total || 7)) * 100)) : 0;
    return (
      <div className="rounded-xl bg-gradient-to-br from-emerald-900/40 to-slate-900 border border-emerald-800/40 aspect-square p-2.5 flex flex-col justify-between">
        <p className="text-[9px] font-bold text-emerald-300">本周达标战报</p>
        <div>
          <p className="text-2xl font-black text-white leading-none">
            {Number.isFinite(goodDays) ? goodDays : 0}
            <span className="text-xs text-slate-400 font-bold">/{total || 7} 天</span>
          </p>
          <p className="text-[9px] text-slate-400 mt-0.5">评分 ≥80 才算本鱼出手</p>
        </div>
        <div className="h-1.5 rounded-full bg-slate-800 overflow-hidden">
          <div className="h-full rounded-full bg-gradient-to-r from-emerald-400 to-sky-400" style={{ width: `${pct}%` }} />
        </div>
      </div>
    );
  }
  // data：数据大字报
  const dur = factOf(moment.facts, '昨晚睡眠时长');
  const score = factOf(moment.facts, '昨晚睡眠评分');
  const big = dur ? dur.replace(' ', '\n') : score || '无记录';
  return (
    <div className="rounded-xl bg-gradient-to-br from-sky-900/50 to-slate-900 border border-sky-800/40 aspect-square p-2.5 flex flex-col justify-between overflow-hidden">
      <p className="text-[9px] font-bold text-sky-300">睡眠数据大字报</p>
      <p className="text-lg font-black text-white leading-tight break-words">{big}</p>
      <p className="text-[9px] text-slate-400">喂 token 的是本鱼，睡觉的是你</p>
    </div>
  );
};

/**
 * 大肥鱼的朋友圈：仿朋友圈流式 UI。
 * 文案由真实睡眠事实生成（DeepSeek API 可用时走 LLM，否则本地傲娇模板），
 * 每张卡片底部都展示生成时的事实清单——"每句话都有出处"。
 */
export const MomentsOverlay: React.FC<Props> = ({ records, userProfile, onClose }) => {
  const momentsA11y = useModalA11y(true, onClose, '大肥鱼的朋友圈');
  const [moments, setMoments] = useState<Moment[]>(() => loadMoments());
  const [busy, setBusy] = useState(false);
  const [commenting, setCommenting] = useState<string | null>(null);
  const [draft, setDraft] = useState('');
  const [note, setNote] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const hasAi =
    userProfile?.aiConfig?.provider === 'deepseek' && !!userProfile?.aiConfig?.deepseekApiKey;

  // 首次打开自动补今天的动态（已有则跳过）
  useEffect(() => {
    let cancelled = false;
    const run = async () => {
      setBusy(true);
      try {
        const res = await ensureTodayMoment(records, userProfile);
        if (!cancelled) setMoments(res.moments);
      } finally {
        if (!cancelled) setBusy(false);
      }
    };
    void run();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const regenerate = async () => {
    setBusy(true);
    setNote(null);
    try {
      const res = await ensureTodayMoment(records, userProfile);
      setMoments(res.moments);
      setNote(res.generated ? '大肥鱼发新动态了！' : '今天她已经发过了～');
    } finally {
      setBusy(false);
    }
  };

  const toggleLike = (id: string) => setMoments(likeMoment(id, userProfile?.aiConfig));

  const sendComment = async (id: string) => {
    const text = draft.trim();
    if (!text) return;
    setDraft('');
    setBusy(true);
    try {
      setMoments(await commentMoment(id, text, userProfile?.aiConfig));
    } finally {
      setBusy(false);
      setCommenting(null);
    }
  };

  return (
    <div
      ref={momentsA11y.ref}
      {...momentsA11y.dialogProps}
      className="fixed inset-0 z-[90] flex flex-col bg-slate-950"
      style={{ backgroundColor: '#020617' }}
    >
      {/* 顶栏：独立页签样式 */}
      <div className="shrink-0 flex items-center justify-between px-4 pt-3 pb-2.5 border-b border-slate-800/80">
        <div className="flex items-center gap-2.5">
          <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-sky-400 to-blue-600 flex items-center justify-center text-xl">🐋</div>
          <div>
            <p className="text-xs font-black text-white leading-tight">大肥鱼的朋友圈</p>
            <p className="text-[9px] text-slate-500">蓝色大肥鱼 · 聪明但懒 · 事已至此，先吃饭吧</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => void regenerate()}
            disabled={busy}
            className="px-2.5 py-1.5 rounded-full bg-white/10 border border-white/20 text-[10px] font-bold text-white flex items-center gap-1 cursor-pointer disabled:opacity-40 active:scale-95 transition-transform"
          >
            {busy ? <Loader2 className="w-3 h-3 animate-spin" /> : <RefreshCw className="w-3 h-3" />}
            生成今日动态
          </button>
          <button
            type="button"
            onClick={onClose}
            className="w-8 h-8 rounded-full bg-slate-800/80 border border-slate-700 text-white flex items-center justify-center cursor-pointer active:scale-90 transition-transform"
            aria-label="关闭"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      </div>

      {!hasAi && (
        <p className="px-4 pt-3 text-[10px] text-slate-500 leading-relaxed shrink-0">
          未配置 DeepSeek API：文案走本地傲娇模板（同样基于真实数据）。
          在「AI 顾问」里配置后，她会写得更有梗。
        </p>
      )}
      {note && <p className="px-4 pt-2 text-[10px] text-sky-300 font-bold shrink-0">{note}</p>}

      {/* 朋友圈时间线 */}
      <div className="flex-1 overflow-y-auto px-4 py-4 space-y-4">
          {moments.length === 0 && !busy && (
            <p className="text-center text-xs text-slate-500 pt-10">她还没发过动态……去睡一觉再来催她。</p>
          )}
          {moments.map((m) => (
            <div key={m.id} className="flex gap-2.5">
              <div className="w-9 h-9 shrink-0 rounded-xl bg-gradient-to-br from-sky-400 to-blue-600 flex items-center justify-center text-lg">
                🐋
              </div>
              <div className="flex-1 min-w-0 space-y-1.5">
                <p className="text-[11px] font-black text-sky-300">蓝色大肥鱼</p>
                <p className="text-xs text-slate-100 leading-relaxed whitespace-pre-wrap">{m.text}</p>

                {/* 配图卡：九宫格布局（1 张大图 / 2-3 张并排） */}
                {m.cards.length > 0 && (
                  <div className={`grid gap-1 ${m.cards.length === 1 ? 'grid-cols-1 max-w-[190px]' : m.cards.length === 2 ? 'grid-cols-2' : 'grid-cols-3'}`}>
                    {m.cards.map((c, i) => (
                      <CardView key={i} type={c} moment={m} />
                    ))}
                  </div>
                )}

                {/* 事实清单：每句都有出处 */}
                <details className="text-[9px] text-slate-500">
                  <summary className="cursor-pointer select-none">数据来源（她不许自己编数字）</summary>
                  <div className="flex flex-wrap gap-1 pt-1">
                    {m.facts.map((f, i) => (
                      <span key={i} className="px-1.5 py-0.5 rounded-md bg-slate-800/80 border border-slate-700/60 text-[9px] text-slate-400">
                        {f}
                      </span>
                    ))}
                  </div>
                </details>

                <div className="flex items-center gap-4 pt-0.5">
                  <span className="text-[9px] text-slate-500">{dayLabel(m.date)} {clockLabel(m.ts)}</span>
                  <button
                    type="button"
                    onClick={() => toggleLike(m.id)}
                    className="flex items-center gap-1 text-[10px] font-bold cursor-pointer active:scale-90 transition-transform"
                  >
                    <Heart className={`w-3.5 h-3.5 ${m.liked ? 'text-rose-400 fill-rose-400' : 'text-slate-500'}`} />
                    <span className={m.liked ? 'text-rose-300' : 'text-slate-500'}>{m.liked ? '已赞' : '赞'}</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setCommenting(commenting === m.id ? null : m.id);
                      setDraft('');
                      setTimeout(() => inputRef.current?.focus(), 50);
                    }}
                    className="flex items-center gap-1 text-[10px] font-bold text-slate-500 cursor-pointer active:scale-90 transition-transform"
                  >
                    <MessageCircle className="w-3.5 h-3.5" />
                    评论
                  </button>
                </div>

                {/* 点赞 + 评论区：朋友圈式灰卡（AI 好友生态） */}
                {(m.likes.length > 0 || m.liked || m.comments.length > 0 || m.replies.length > 0) && (
                  <div className="rounded-xl bg-slate-900/80 border border-slate-800 px-2.5 py-2 space-y-1.5">
                    {(m.likes.length > 0 || m.liked) && (
                      <p className="text-[10px] leading-relaxed flex flex-wrap items-center gap-1">
                        <Heart className="w-3 h-3 text-rose-400 fill-rose-400 shrink-0" />
                        <span className="text-sky-400 font-bold">{[...(m.liked ? ['鱼片'] : []), ...m.likes].join('、')}</span>
                        <span className="text-slate-400">觉得很赞</span>
                      </p>
                    )}
                    {(m.comments.length > 0 || m.replies.length > 0) && (
                      <div className="space-y-1">
                        {m.comments.map((c, i) => (
                          <p key={`c${i}`} className="text-[10px] leading-relaxed">
                            <span className="text-sky-400 font-bold">{c.friend}：</span>
                            <span className="text-slate-300">{c.text}</span>
                          </p>
                        ))}
                        {m.replies.map((r, i) => (
                          <p key={`r${i}`} className="text-[10px] leading-relaxed">
                            <span className={`font-bold ${r.friend === '鱼片' ? 'text-emerald-400' : 'text-sky-400'}`}>{r.friend}：</span>
                            <span className="text-slate-300">{r.text}</span>
                          </p>
                        ))}
                      </div>
                    )}
                  </div>
                )}

                {commenting === m.id && (
                  <div className="flex gap-1.5">
                    <input
                      ref={inputRef}
                      value={draft}
                      onChange={(e) => setDraft(e.target.value)}
                      onKeyDown={(e) => { if (e.key === 'Enter') void sendComment(m.id); }}
                      placeholder="和她说点什么……"
                      maxLength={80}
                      className="flex-1 min-w-0 bg-slate-900 border border-slate-700 rounded-xl px-3 py-1.5 text-[11px] text-white placeholder:text-slate-600 outline-none focus:border-sky-500"
                    />
                    <button
                      type="button"
                      onClick={() => void sendComment(m.id)}
                      disabled={busy || !draft.trim()}
                      className="px-3 rounded-xl bg-sky-600 text-white text-[11px] font-bold cursor-pointer disabled:opacity-40 active:scale-95 transition-transform"
                    >
                      发送
                    </button>
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>
    </div>
  );
};
