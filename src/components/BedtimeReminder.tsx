import React, { useEffect, useState } from 'react';
import { Moon } from 'lucide-react';

export type BedtimeReminderPhase = 'ask' | 'good' | 'ignore';

interface BedtimeReminderProps {
  phase: BedtimeReminderPhase;
  onGood: () => void;
  onIgnore: () => void;
  /** 动画收尾时回调（good 阶段在此执行开始监测等动作） */
  onDone: (finalPhase: BedtimeReminderPhase) => void;
}

/**
 * 作息目标到点的全屏提醒（品牌开屏同款视觉：月亮 + 极光 + 水波，
 * 应要求不显示"懂睡眠，更懂你"标语）：
 * - "好的" → 显示"晚安💤"，收尾时由父级自动开始夜间监测
 * - "无视" → 显示"随便你🙄"，不做任何变化
 * 仅在应用处于前台时可触发（跨应用的全屏唤醒需要原生 FULL_SCREEN_INTENT，属后续原生功能）。
 */
export const BedtimeReminder: React.FC<BedtimeReminderProps> = ({ phase, onGood, onIgnore, onDone }) => {
  const [leaving, setLeaving] = useState(false);

  useEffect(() => {
    if (phase === 'ask') return;
    const t = setTimeout(() => setLeaving(true), phase === 'good' ? 1100 : 900);
    const t2 = setTimeout(() => onDone(phase), phase === 'good' ? 1500 : 1250);
    return () => {
      clearTimeout(t);
      clearTimeout(t2);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase]);

  return (
    <div
      className={`fixed inset-0 z-[300] flex flex-col items-center justify-center overflow-hidden transition-opacity duration-300 ${
        leaving ? 'opacity-0' : 'opacity-100'
      }`}
      style={{ background: 'linear-gradient(180deg, #060b1a 0%, #03060f 100%)' }}
      role="dialog"
      aria-label="就寝时间提醒"
    >
      {/* 极光带 */}
      <div aria-hidden className="absolute top-[16%] left-1/2 -translate-x-1/2 w-[130%] h-40 blur-3xl opacity-40"
        style={{ background: 'linear-gradient(100deg, transparent 15%, #2dd4bf55 38%, transparent 52%, #8b5cf644 66%, transparent 84%)' }}
      />
      {/* 星点 */}
      <div aria-hidden className="absolute top-[22%] left-[24%] w-1.5 h-1.5 rounded-full bg-white/70 animate-star-twinkle" />
      <div aria-hidden className="absolute top-[28%] right-[27%] w-1 h-1 rounded-full bg-white/50 animate-star-twinkle" style={{ animationDelay: '0.8s' }} />

      {/* 月亮（品牌弯刀新月） */}
      <div className="relative animate-moon-breathe">
        <svg width="132" height="132" viewBox="0 0 132 132" aria-hidden>
          <defs>
            <linearGradient id="br-moon" x1="0" y1="1" x2="1" y2="0">
              <stop offset="0%" stopColor="#a8e6ff" />
              <stop offset="100%" stopColor="#2563eb" />
            </linearGradient>
            <mask id="br-bite">
              <rect width="132" height="132" fill="#fff" />
              <circle cx="88" cy="42" r="40" fill="#000" />
            </mask>
          </defs>
          <circle cx="60" cy="68" r="46" fill="url(#br-moon)" mask="url(#br-bite)" />
        </svg>
        <div className="absolute inset-0 rounded-full blur-2xl opacity-30"
          style={{ background: 'radial-gradient(circle, #67b7ff55, transparent 70%)' }}
        />
      </div>

      {/* 水波 */}
      <div aria-hidden className="mt-5 space-y-2 w-40 opacity-60">
        <div className="h-px bg-gradient-to-r from-transparent via-sky-200/70 to-transparent" />
        <div className="h-px w-4/5 mx-auto bg-gradient-to-r from-transparent via-sky-200/40 to-transparent" />
        <div className="h-px w-3/5 mx-auto bg-gradient-to-r from-transparent via-sky-200/25 to-transparent" />
      </div>

      {/* 文案与按钮 */}
      {phase === 'ask' && (
        <div className="mt-10 flex flex-col items-center gap-8 animate-[splash-rise_0.6s_ease-out]">
          <h2 className="text-2xl font-black text-white tracking-wide">夜深喽，该睡了</h2>
          <div className="flex items-center gap-4">
            <button
              type="button"
              onClick={onGood}
              className="px-10 py-3 rounded-2xl bg-gradient-to-r from-sky-400 to-blue-500 text-slate-950 text-sm font-black cursor-pointer active:scale-95 transition-transform shadow-lg"
            >
              好的
            </button>
            <button
              type="button"
              onClick={onIgnore}
              className="px-10 py-3 rounded-2xl border border-white/15 text-slate-300 text-sm font-bold cursor-pointer active:scale-95 transition-transform hover:border-white/30"
            >
              无视
            </button>
          </div>
        </div>
      )}
      {phase === 'good' && (
        <div className="mt-10 flex flex-col items-center gap-3 animate-[splash-rise_0.5s_ease-out]">
          <span className="text-5xl">💤</span>
          <h2 className="text-2xl font-black text-white tracking-widest">晚安</h2>
        </div>
      )}
      {phase === 'ignore' && (
        <div className="mt-10 flex flex-col items-center gap-3 animate-[splash-rise_0.5s_ease-out]">
          <span className="text-5xl">🙄</span>
          <h2 className="text-2xl font-black text-white tracking-widest">随便你</h2>
        </div>
      )}

      {/* 无障碍/兜底：图标语义 */}
      <span className="sr-only"><Moon />就寝提醒</span>
    </div>
  );
};
