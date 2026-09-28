import React, { useEffect, useState } from 'react';

export type BedtimeReminderPhase = 'ask' | 'good' | 'ignore';

interface BedtimeReminderProps {
  phase: BedtimeReminderPhase;
  onGood: () => void;
  onIgnore: () => void;
  /** 动画收尾时回调（good 阶段在此执行开始监测等动作） */
  onDone: (finalPhase: BedtimeReminderPhase) => void;
}

const CIRC = 2 * Math.PI * 62;

/**
 * 作息目标到点的全屏提醒（Web/PWA 端）：视觉与 LaunchSplash 开屏动画同源
 * （水滴→涟漪→月亮顺时针渲染→极光），仅文案与排版不同、无品牌标语。
 * "好的" → "晚安"，收尾时由父级自动开始夜间监测；"无视" → "随便你"。
 */
export const BedtimeReminder: React.FC<BedtimeReminderProps> = ({ phase, onGood, onIgnore, onDone }) => {
  const [leaving, setLeaving] = useState(false);
  const answered = phase !== 'ask';

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
      className={`fixed inset-0 z-[300] overflow-hidden transition-opacity duration-300 ${leaving ? 'opacity-0' : 'opacity-100'}`}
      style={{ background: 'linear-gradient(180deg, #060b1a 0%, #03060f 100%)' }}
      role="dialog"
      aria-label="就寝时间提醒"
    >
      {/* 极光条带（开屏第三步同款） */}
      <div
        className="absolute inset-0"
        style={{
          opacity: 0,
          animation: 'splash-aurora-in 800ms ease-out 1300ms both',
          background:
            'repeating-linear-gradient(97deg, transparent 0 14px, #9db4ff22 14px 22px, transparent 22px 40px), linear-gradient(180deg, transparent 8%, #2d529e30 45%, transparent 85%)',
          filter: 'blur(14px)',
        }}
      />

      {/* 水滴 + 涟漪 */}
      <div
        className="absolute left-1/2 top-[30%] rounded-full"
        style={{
          width: 12,
          height: 12,
          marginLeft: -6,
          marginTop: -6,
          background: '#a8e6ff',
          boxShadow: '0 0 16px #a8e6ff',
          animation: 'splash-drop 560ms cubic-bezier(0.55,0,1,0.45) both',
        }}
      />
      {[0, 1, 2].map((i) => (
        <div
          key={i}
          className="absolute left-1/2 top-[30%] rounded-full"
          style={{
            width: 130,
            height: 130,
            marginLeft: -65,
            marginTop: -65,
            border: '1.5px solid #a8e6ff',
            animation: `splash-ripple 900ms ease-out ${380 + i * 160}ms both`,
          }}
        />
      ))}

      {/* 月亮：顺时针渲染 + 渐变填充（开屏第二步同款） */}
      <div
        className="absolute left-1/2 top-[30%]"
        style={{ transform: 'translate(-50%,-50%)', animation: 'splash-zoom 1300ms ease-out 420ms both' }}
      >
        <svg width="200" height="200" viewBox="0 0 200 200">
          <defs>
            <linearGradient id="brMoonGrad" x1="0" y1="1" x2="0.55" y2="0">
              <stop offset="0%" stopColor="#a8e6ff" />
              <stop offset="100%" stopColor="#2563eb" />
            </linearGradient>
            <mask id="brBiteMask">
              <rect width="200" height="200" fill="white" />
              <circle cx="139" cy="76" r="56" fill="black" />
            </mask>
          </defs>
          <circle
            cx="100"
            cy="100"
            r="62"
            fill="none"
            stroke="#a8e6ff"
            strokeWidth="2.5"
            strokeDasharray={CIRC}
            strokeDashoffset={CIRC}
            transform="rotate(-90 100 100)"
            opacity="0.85"
            style={{ animation: 'splash-draw 800ms ease-in-out 480ms both' }}
          />
          <g mask="url(#brBiteMask)">
            <circle
              cx="100"
              cy="100"
              r="62"
              fill="url(#brMoonGrad)"
              opacity="0"
              style={{ animation: 'splash-fill 460ms ease-out 1150ms both' }}
            />
          </g>
        </svg>
      </div>

      {/* 文案 + 选项（月亮下方；无品牌标语） */}
      {phase === 'ask' && (
        <div
          className="absolute left-0 right-0 bottom-[13%] flex flex-col items-center gap-7"
          style={{ animation: 'splash-rise 520ms ease-out 1600ms both' }}
        >
          <h2 className="text-2xl font-black text-white tracking-wide">夜深喽，该睡了</h2>
          <div className="flex items-center gap-4">
            <button
              type="button"
              onClick={onGood}
              className="px-10 py-3 rounded-2xl text-slate-950 text-sm font-black cursor-pointer active:scale-95 transition-transform shadow-lg"
              style={{ background: 'linear-gradient(90deg, #a8e6ff, #3b82f6)' }}
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
        <div
          className="absolute left-0 right-0 bottom-[15%] flex flex-col items-center gap-2"
          style={{ animation: 'splash-rise 480ms ease-out both' }}
        >
          <h2 className="text-3xl font-black text-white tracking-[0.4em] indent-[0.4em]">晚安</h2>
          <span className="text-[11px] text-sky-200/70 font-mono tracking-widest">开始记录今晚的睡眠</span>
        </div>
      )}
      {phase === 'ignore' && (
        <div
          className="absolute left-0 right-0 bottom-[15%] flex flex-col items-center"
          style={{ animation: 'splash-rise 480ms ease-out both' }}
        >
          <h2 className="text-2xl font-black text-white tracking-[0.3em] indent-[0.3em]">随便你</h2>
        </div>
      )}
    </div>
  );
};
