import React, { useState, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { Volume2, VolumeX, Play, Pause, Timer, Music2, Wind, X } from 'lucide-react';
import { sleepAudio } from '../utils/audioSynth';
import { SoundscapeTrack } from '../types/sleep';
import { ThemeConfig } from '../utils/themeStyles';
import { BreathingExercise } from './BreathingExercise';

const TRACKS: SoundscapeTrack[] = [
  {
    id: 'rain',
    name: '窗畔细雨',
    category: 'nature',
    description: '柔和雨滴敲打玻璃与屋檐，天然声学掩蔽',
    soundType: 'rain',
    accentColor: 'from-blue-900/50 to-indigo-950/60',
  },
  {
    id: 'ocean',
    name: '深海潮汐',
    category: 'nature',
    description: '0.12Hz缓慢浪涌起伏，同步心肺静息节律',
    soundType: 'ocean',
    accentColor: 'from-teal-950/60 to-cyan-900/40',
  },
  {
    id: 'forest',
    name: '夜风竹林',
    category: 'nature',
    description: '微风轻拂竹叶与远处夏蝉，恬静乡村夜色',
    soundType: 'forest',
    accentColor: 'from-emerald-950/60 to-teal-900/40',
  },
  {
    id: 'whitenoise',
    name: '粉红噪音',
    category: 'noise',
    description: '能量均匀衰减的护眠声谱，隔绝突发杂音',
    soundType: 'whitenoise',
    accentColor: 'from-purple-950/60 to-indigo-950/50',
  },
  {
    id: 'bowl',
    name: '灵修颂钵',
    category: 'meditation',
    description: '432Hz共鸣基频与Theta双耳脑波，深层放松',
    soundType: 'bowl',
    accentColor: 'from-amber-950/60 to-orange-950/40',
  },
];

// 预设混音（BetterSleep 式多层叠加）：[音效, 音量]
const PRESET_MIXES: { name: string; desc: string; layers: Array<[SoundscapeTrack['soundType'], number]> }[] = [
  { name: '轻雨伴眠', desc: '细雨 + 粉噪掩蔽', layers: [['rain', 0.6], ['whitenoise', 0.25]] },
  { name: '海浪夜林', desc: '潮汐 + 竹林夜风', layers: [['ocean', 0.55], ['forest', 0.3]] },
  { name: '颂钵冥想', desc: '432Hz 单层沉浸', layers: [['bowl', 0.7]] },
];

const SoundscapePlayerInner: React.FC<{ theme: ThemeConfig; onClose: () => void }> = ({ theme, onClose }) => {
  const [active, setActive] = useState<Record<string, number>>({});
  const [showBreath, setShowBreath] = useState(false);
  const [timerMinutes, setTimerMinutes] = useState<number | null>(30);
  const [timerRemainingSeconds, setTimerRemainingSeconds] = useState<number | null>(null);
  const isPlaying = Object.keys(active).length > 0;

  useEffect(() => {
    let interval: number;
    if (isPlaying && timerRemainingSeconds !== null && timerRemainingSeconds > 0) {
      interval = window.setInterval(() => {
        setTimerRemainingSeconds((prev) => {
          if (prev && prev > 1) {
            return prev - 1;
          }
          // Timer finished
          sleepAudio.stopAllLayers(true);
          setActive({});
          return null;
        });
      }, 1000);
    }
    return () => clearInterval(interval);
  }, [isPlaying, timerRemainingSeconds]);

  const toggleLayer = (track: SoundscapeTrack) => {
    if (active[track.soundType] !== undefined) {
      sleepAudio.stopLayer(track.soundType);
      setActive((prev) => {
        const next = { ...prev };
        delete next[track.soundType];
        return next;
      });
    } else {
      sleepAudio.startLayer(track.soundType, 0.6);
      setActive((prev) => ({ ...prev, [track.soundType]: 0.6 }));
      if (timerMinutes && timerRemainingSeconds === null) {
        setTimerRemainingSeconds(timerMinutes * 60);
      }
    }
  };

  const setLayerVol = (type: string, v: number) => {
    sleepAudio.setLayerVolume(type as SoundscapeTrack['soundType'], v);
    setActive((prev) => ({ ...prev, [type]: v }));
  };

  const applyMix = (mix: typeof PRESET_MIXES[number]) => {
    sleepAudio.stopAllLayers(true);
    const next: Record<string, number> = {};
    for (const [type, vol] of mix.layers) {
      sleepAudio.startLayer(type, vol);
      next[type] = vol;
    }
    setActive(next);
    if (timerMinutes) setTimerRemainingSeconds(timerMinutes * 60);
  };

  const handleSetTimer = (mins: number | null) => {
    setTimerMinutes(mins);
    if (mins) {
      setTimerRemainingSeconds(mins * 60);
    } else {
      setTimerRemainingSeconds(null);
    }
  };

  return createPortal(
    <>
    <div className="fixed inset-0 z-[150] bg-black/60" onClick={onClose}>
    <div
      data-no-swipe
      className="absolute bottom-0 left-0 right-0 max-w-lg mx-auto rounded-t-3xl p-5 pb-9 max-h-[88vh] overflow-y-auto no-scrollbar space-y-4"
      style={{ background: '#0c1220' }}
      onClick={(e) => e.stopPropagation()}
    >
      {/* Header */}
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-2">
          <div className={`w-8 h-8 rounded-xl ${theme.cardInnerBg} ${theme.accentText} flex items-center justify-center border ${theme.cardBorder}`}>
            <Music2 className="w-4 h-4" />
          </div>
          <div>
            <h3 className="text-sm font-black text-white">助眠音景混音器</h3>
            <p className="text-[10px] text-slate-400">多层叠加 · 各自调音量 · Web Audio 实时合成</p>
          </div>
        </div>
        <div className="flex items-center gap-1.5">
          <button
            type="button"
            onClick={() => setShowBreath(true)}
            className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-teal-500/15 border border-teal-500/40 text-teal-300 text-[10px] font-bold cursor-pointer"
          >
            <Wind className="w-3 h-3" />
            呼吸放松
          </button>
          <button
            type="button"
            onClick={onClose}
            aria-label="关闭"
            className="w-8 h-8 rounded-lg bg-white/5 text-slate-300 flex items-center justify-center cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* 预设混音 */}
      <div className="grid grid-cols-3 gap-2">
        {PRESET_MIXES.map((m) => (
          <button
            key={m.name}
            type="button"
            onClick={() => applyMix(m)}
            className={`${theme.cardInnerBg} border ${theme.cardInnerBorder} rounded-2xl p-2.5 text-left cursor-pointer active:scale-[0.97] transition-transform`}
          >
            <span className="text-[11px] font-bold text-white block">{m.name}</span>
            <span className="text-[9px] text-slate-400 leading-tight block mt-0.5">{m.desc}</span>
          </button>
        ))}
      </div>

      {/* Soundscape Cards Grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5 mb-4">
        {TRACKS.map((t) => {
          const layerVol = active[t.soundType];
          const isOn = layerVol !== undefined;
          return (
            <div
              key={t.id}
              className={`rounded-2xl border transition-all p-3 ${
                isOn
                  ? 'bg-gradient-to-r ' + t.accentColor + ' ' + theme.accentBorder
                  : `${theme.cardInnerBg} ${theme.cardInnerBorder}`
              }`}
            >
              <div className="flex items-center justify-between">
                <button
                  type="button"
                  onClick={() => toggleLayer(t)}
                  className="flex items-center gap-2.5 flex-1 text-left cursor-pointer min-w-0"
                >
                  <div
                    className={`w-8 h-8 rounded-full flex items-center justify-center shrink-0 transition-transform ${
                      isOn ? theme.accentBg.split(' ')[0] + ' text-white' : 'bg-white/5 text-slate-300'
                    }`}
                  >
                    {isOn ? <Pause className="w-3.5 h-3.5" /> : <Play className="w-3.5 h-3.5 fill-current ml-0.5" />}
                  </div>
                  <div className="min-w-0">
                    <div className="flex items-center gap-1.5">
                      <span className="text-xs font-bold text-white">{t.name}</span>
                      {t.category === 'meditation' && (
                        <span className="text-[9px] px-1.5 py-0.5 rounded bg-amber-500/20 text-amber-300 font-mono">脑波</span>
                      )}
                    </div>
                    <p className="text-[10px] text-slate-400 line-clamp-1">{t.description}</p>
                  </div>
                </button>
                {isOn && (
                  <div className="flex items-center gap-2 shrink-0 ml-2" data-no-swipe>
                    <Volume2 className="w-3.5 h-3.5 text-slate-400" />
                    <input
                      type="range"
                      min={0}
                      max={1}
                      step={0.05}
                      value={layerVol}
                      onChange={(e) => setLayerVol(t.soundType, Number(e.target.value))}
                      className="w-20 accent-white h-1.5 bg-white/10 rounded-lg cursor-pointer"
                      aria-label={`${t.name}音量`}
                    />
                    <span className="text-[10px] font-mono text-slate-300 w-8 text-right tabular-nums">
                      {Math.round(layerVol * 100)}%
                    </span>
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {/* 定时关闭 */}
      <div className={`${theme.cardInnerBg} rounded-xl p-3 border ${theme.cardInnerBorder} flex items-center justify-between text-xs text-slate-300`}>
        <div className="flex items-center gap-1.5">
          <Timer className={`w-3.5 h-3.5 ${theme.accentText}`} />
          <span className="text-[11px] font-bold text-slate-200">定时关闭</span>
          {timerRemainingSeconds !== null && (
            <span className="text-[11px] font-mono text-slate-400 ml-1 tabular-nums">
              {Math.floor(timerRemainingSeconds / 60)}:{String(timerRemainingSeconds % 60).padStart(2, '0')}
            </span>
          )}
        </div>
        <div className="flex items-center gap-1.5">
          {[15, 30, 45, 60].map((mins) => (
            <button
              key={mins}
              type="button"
              onClick={() => handleSetTimer(timerMinutes === mins ? null : mins)}
              className={`px-2 py-1 rounded-lg text-[11px] font-bold transition-colors cursor-pointer ${
                timerMinutes === mins
                  ? theme.accentBg.split(' ')[0] + ' text-white'
                  : 'bg-white/5 text-slate-400'
              }`}
            >
              {mins}m
            </button>
          ))}
        </div>
      </div>

      {isPlaying && (
        <button
          type="button"
          onClick={() => {
            sleepAudio.stopAllLayers(true);
            setActive({});
          }}
          className={`w-full py-2.5 rounded-2xl ${theme.accentBg} text-white text-xs font-black cursor-pointer active:scale-[0.98] transition-transform`}
        >
          全部停止
        </button>
      )}
    </div>
    </div>,
    {showBreath ? (
      <div key="breath" className="fixed inset-0 z-[160] bg-black/70 flex items-center justify-center p-5" onClick={() => setShowBreath(false)}>
        <div
          data-no-swipe
          className="w-full max-w-sm rounded-3xl p-5"
          style={{ background: '#0c1220' }}
          onClick={(e) => e.stopPropagation()}
        >
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-sm font-black text-white">4-7-8 呼吸放松</h3>
            <button
              type="button"
              onClick={() => setShowBreath(false)}
              aria-label="关闭呼吸练习"
              className="w-8 h-8 rounded-lg bg-white/5 text-slate-300 flex items-center justify-center cursor-pointer"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
          <BreathingExercise />
        </div>
      </div>
    ) : null}
    </>,
    document.body
  );
};

// portal 包装：渲染到 body（祖先链带 transform，fixed 会退化）
export const SoundscapePlayer: React.FC<{ theme: ThemeConfig; onClose: () => void }> = ({ theme, onClose }) =>
  createPortal(<SoundscapePlayerInner theme={theme} onClose={onClose} />, document.body);
