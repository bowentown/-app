import React, { useEffect, useState } from 'react';
import { ThemeConfig } from '../utils/themeStyles';

const KEY = 'somnacare_splash_shown';

/** 四主题月色：受光渐变亮色 / 暗部深色 / 极光双色 */
const MOON_THEMES: Record<string, { lit: string; deep: string; aur1: string; aur2: string }> = {
  midnight: { lit: '#a8e6ff', deep: '#2563eb', aur1: '#2d529e', aur2: '#9db4ff' },
  pure_dark: { lit: '#f1f5f9', deep: '#475569', aur1: '#1e293b', aur2: '#94a3b8' },
  warm_amber: { lit: '#fff7e0', deep: '#f59e0b', aur1: '#92400e', aur2: '#fcd34d' },
  serene_blue: { lit: '#ccfbf1', deep: '#0891b2', aur1: '#155e75', aur2: '#67e8f9' },
};

/**
 * 品牌开屏（三段式，冷启动一次）：
 * 1. 一滴水落入湖面，涟漪扩散；
 * 2. 镜头拉远，月亮顺时针渲染成形（主题色渐变）；
 * 3. 极光条带浮现于月亮后方，涟漪倒影与宣传词“懂睡眠，更懂你”随之出现。
 * 结束后 500ms 淡出进主界面。原生启动屏与首帧同色，衔接无缝。
 */
export const LaunchSplash: React.FC<{ theme: ThemeConfig }> = ({ theme }) => {
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
    const t1 = setTimeout(() => setFading(true), 2950);
    const t2 = setTimeout(() => {
      try {
        sessionStorage.setItem(KEY, '1');
      } catch {
        // ignore
      }
      setVisible(false);
    }, 3500);
    return () => {
      clearTimeout(t1);
      clearTimeout(t2);
    };
  }, [visible]);

  if (!visible) return null;

  const mc = MOON_THEMES[theme.id] ?? MOON_THEMES.midnight;
  const CIRC = 2 * Math.PI * 62;

  return (
    <div
      className={`fixed inset-0 z-[200] overflow-hidden transition-opacity duration-500 ${fading ? 'opacity-0' : 'opacity-100'}`}
      style={{ background: 'linear-gradient(180deg, #060b1a 0%, #03060f 100%)' }}
    >
      {/* 第三步：极光条带（月亮后方浮现） */}
      <div
        className="absolute inset-0"
        style={{
          opacity: 0,
          animation: 'splash-aurora-in 800ms ease-out 1500ms both',
          background: `repeating-linear-gradient(97deg, transparent 0 14px, ${mc.aur2}22 14px 22px, transparent 22px 40px), linear-gradient(180deg, transparent 8%, ${mc.aur1}30 45%, transparent 85%)`,
          filter: 'blur(14px)',
        }}
      />

      {/* 第一步：水滴落入湖面 */}
      <div
        className="absolute left-1/2 top-[38%] rounded-full"
        style={{
          width: 13,
          height: 13,
          marginLeft: -6.5,
          marginTop: -6.5,
          background: mc.lit,
          boxShadow: `0 0 16px ${mc.lit}`,
          animation: 'splash-drop 620ms cubic-bezier(0.55,0,1,0.45) both',
        }}
      />
      {/* 涟漪 */}
      {[0, 1, 2].map((i) => (
        <div
          key={i}
          className="absolute left-1/2 top-[38%] rounded-full"
          style={{
            width: 150,
            height: 150,
            marginLeft: -75,
            marginTop: -75,
            border: `1.5px solid ${mc.lit}`,
            animation: `splash-ripple 950ms ease-out ${430 + i * 170}ms both`,
          }}
        />
      ))}

      {/* 第二步：月亮顺时针渲染 + 镜头拉远 */}
      <div
        className="absolute left-1/2 top-[38%]"
        style={{
          transform: 'translate(-50%,-50%)',
          animation: 'splash-zoom 1500ms ease-out 500ms both',
        }}
      >
        <svg width="230" height="230" viewBox="0 0 200 200">
          <defs>
            <linearGradient id="splashMoonGrad" x1="0" y1="1" x2="0.55" y2="0">
              <stop offset="0%" stopColor={mc.lit} />
              <stop offset="100%" stopColor={mc.deep} />
            </linearGradient>
            <mask id="splashBiteMask">
              <rect width="200" height="200" fill="white" />
              <circle cx="139" cy="76" r="56" fill="black" />
            </mask>
          </defs>
          {/* 顺时针描边 */}
          <circle
            cx="100"
            cy="100"
            r="62"
            fill="none"
            stroke={mc.lit}
            strokeWidth="2.5"
            strokeDasharray={CIRC}
            strokeDashoffset={CIRC}
            transform="rotate(-90 100 100)"
            opacity="0.85"
            style={{ animation: 'splash-draw 850ms ease-in-out 600ms both' }}
          />
          {/* 渐变填充（描边完成后浮现） */}
          <g mask="url(#splashBiteMask)">
            <circle
              cx="100"
              cy="100"
              r="62"
              fill="url(#splashMoonGrad)"
              opacity="0"
              style={{ animation: 'splash-fill 480ms ease-out 1300ms both' }}
            />
          </g>
        </svg>
      </div>

      {/* 第三步：月亮下方的水面倒影涟漪 */}
      <div
        className="absolute left-1/2"
        style={{
          top: 'calc(38% + 118px)',
          transform: 'translateX(-50%)',
          opacity: 0,
          animation: 'splash-rise 650ms ease-out 1950ms both',
        }}
      >
        <svg width="230" height="44" viewBox="0 0 230 44">
          {(
            [
              [6, 105, 0.6],
              [14, 84, 0.52],
              [22, 96, 0.45],
              [30, 66, 0.38],
              [38, 78, 0.3],
              [45, 46, 0.22],
            ] as Array<[number, number, number]>
          ).map(([y, rx, o], i) => (
            <ellipse key={i} cx="115" cy={y} rx={rx / 2} ry="2" fill={mc.lit} opacity={o} />
          ))}
        </svg>
      </div>

      {/* 宣传词 */}
      <p
        className="absolute left-1/2 text-[14px] text-slate-300 whitespace-nowrap"
        style={{
          top: 'calc(38% + 178px)',
          transform: 'translateX(-50%)',
          letterSpacing: '0.42em',
          paddingLeft: '0.42em',
          opacity: 0,
          animation: 'splash-rise 750ms ease-out 2150ms both',
        }}
      >
        懂睡眠，更懂你
      </p>
    </div>
  );
};

export default LaunchSplash;
