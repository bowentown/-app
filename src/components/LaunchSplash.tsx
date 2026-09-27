import React, { useEffect, useState } from 'react';
import MoonDisc from './MoonDisc';

const KEY = 'somnacare_splash_shown';

/**
 * 品牌开屏：冷启动时展示一次（sessionStorage 门控）。
 * 序列：月相盘呼吸浮现 → 极光弧线描绘 → 品牌名 → 宣传词 → 500ms 淡出进主界面。
 * 与原生启动屏（splash.png：深底 + 居中品牌图标）同色同位，衔接无缝。
 */
export const LaunchSplash: React.FC = () => {
  const [visible, setVisible] = useState(() => {
    try {
      return sessionStorage.getItem(KEY) !== '1';
    } catch {
      return true;
    }
  });
  const [fading, setFading] = useState(false);

  useEffect(() => {
    if (!visible) return;
    const t1 = setTimeout(() => setFading(true), 2000);
    const t2 = setTimeout(() => {
      try {
        sessionStorage.setItem(KEY, '1');
      } catch {
        // ignore
      }
      setVisible(false);
    }, 2550);
    return () => {
      clearTimeout(t1);
      clearTimeout(t2);
    };
  }, [visible]);

  if (!visible) return null;

  return (
    <div
      className={`fixed inset-0 z-[200] flex flex-col items-center justify-center transition-opacity duration-500 ${fading ? 'opacity-0' : 'opacity-100'}`}
      style={{ background: '#070a12' }}
    >
      {/* 极光弧线：围绕月相盘描绘（1s 画完） */}
      <div className="relative w-[260px] h-[260px] flex items-center justify-center">
        <svg width="260" height="260" viewBox="0 0 260 260" className="absolute inset-0">
          <defs>
            <linearGradient id="splashAurora" x1="0" y1="1" x2="1" y2="0">
              <stop offset="0%" stopColor="#46e0c0" />
              <stop offset="100%" stopColor="#818cf8" />
            </linearGradient>
          </defs>
          <path
            d="M 38 186 A 100 100 0 1 1 222 148"
            fill="none"
            stroke="url(#splashAurora)"
            strokeWidth="3"
            strokeLinecap="round"
            strokeDasharray="330"
            strokeDashoffset="330"
            opacity="0.8"
            style={{ animation: 'splash-draw 1100ms ease-out 250ms forwards' }}
          />
        </svg>

        {/* 月相盘（真实月相）呼吸 */}
        <div className="animate-moon-breathe" style={{ animationDuration: '3.2s' }}>
          <MoonDisc size={104} litColor="#fcd34d" darkColor="#0a1120" strokeColor="#334155" />
        </div>
      </div>

      <h1
        className="font-display text-[24px] font-bold text-white mt-4"
        style={{ animation: 'splash-rise 700ms ease-out 500ms both' }}
      >
        极光睡眠
      </h1>
      <p
        className="text-[13px] text-slate-400 mt-3"
        style={{ letterSpacing: '0.42em', paddingLeft: '0.42em', animation: 'splash-rise 700ms ease-out 900ms both' }}
      >
        懂睡眠，更懂你
      </p>

      {/* 底部极细极光线（品牌呼应） */}
      <div
        className="absolute bottom-16 h-px w-40"
        style={{
          background: 'linear-gradient(90deg, transparent, #46e0c088, #818cf888, transparent)',
          animation: 'splash-rise 900ms ease-out 1200ms both',
        }}
      />
    </div>
  );
};

export default LaunchSplash;
