import React, { useEffect, useRef, useState } from 'react';
import { X, Heart, MessageCircle, Loader2, RefreshCw } from 'lucide-react';
import type { SleepRecord, UserProfile } from '../types/sleep';
import {
  ensureTodayMoment,
  likeMoment,
  commentMoment,
  loadMoments,
  type Moment,
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

/**
 * 大肥鱼的朋友圈：仿朋友圈流式 UI。
 * 文案由真实睡眠事实生成（DeepSeek API 可用时走 LLM，否则本地傲娇模板），
 * 每张卡片底部都展示生成时的事实清单——"每句话都有出处"。
 */
export const MomentsOverlay: React.FC<Props> = ({ records, userProfile, onClose }) => {
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
    <div className="fixed inset-0 z-[90] bg-black/70 backdrop-blur-sm flex items-end sm:items-center justify-center">
      <div className="w-full sm:max-w-md h-[88vh] sm:h-[80vh] bg-slate-950 rounded-t-3xl sm:rounded-3xl border border-slate-700/60 overflow-hidden flex flex-col">
        {/* 顶部封面：她的人设卡 */}
        <div className="relative shrink-0">
          <div className="h-28 bg-gradient-to-br from-sky-700 via-blue-800 to-slate-900" />
          <button
            type="button"
            onClick={onClose}
            className="absolute top-3 right-3 w-8 h-8 rounded-full bg-black/40 text-white flex items-center justify-center cursor-pointer active:scale-90 transition-transform"
            aria-label="关闭"
          >
            <X className="w-4 h-4" />
          </button>
          <div className="absolute -bottom-6 left-4 flex items-end gap-3">
            <div className="w-14 h-14 rounded-2xl bg-gradient-to-br from-sky-400 to-blue-600 flex items-center justify-center text-3xl border-2 border-slate-900 shadow-xl">
              🐋
            </div>
            <div className="pb-0.5">
              <p className="text-sm font-black text-white drop-shadow">蓝色大肥鱼</p>
              <p className="text-[10px] text-slate-300">聪明但懒 · 事已至此，先吃饭吧</p>
            </div>
          </div>
          <button
            type="button"
            onClick={() => void regenerate()}
            disabled={busy}
            className="absolute bottom-2 right-3 px-2.5 py-1.5 rounded-full bg-white/10 border border-white/20 text-[10px] font-bold text-white flex items-center gap-1 cursor-pointer disabled:opacity-40 active:scale-95 transition-transform"
          >
            {busy ? <Loader2 className="w-3 h-3 animate-spin" /> : <RefreshCw className="w-3 h-3" />}
            生成今日动态
          </button>
        </div>

        {!hasAi && (
          <p className="px-4 pt-8 text-[10px] text-slate-500 leading-relaxed">
            未配置 DeepSeek API：文案走本地傲娇模板（同样基于真实数据）。
            在「AI 顾问」里配置后，她会写得更有梗。
          </p>
        )}
        {note && <p className="px-4 pt-2 text-[10px] text-sky-300 font-bold">{note}</p>}

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

                {/* 事实清单：每句都有出处 */}
                <div className="flex flex-wrap gap-1">
                  {m.facts.slice(0, 6).map((f, i) => (
                    <span key={i} className="px-1.5 py-0.5 rounded-md bg-slate-800/80 border border-slate-700/60 text-[9px] text-slate-400">
                      {f}
                    </span>
                  ))}
                </div>

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

                {/* 评论区 */}
                {(m.comments.length > 0 || m.replies.length > 0) && (
                  <div className="rounded-xl bg-slate-900/80 border border-slate-800 px-2.5 py-2 space-y-1">
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
    </div>
  );
};
