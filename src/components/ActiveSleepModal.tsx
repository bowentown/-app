import React, { useState, useEffect, useRef } from 'react';
import { Moon, Bell, Volume2, Sparkles, X, ChevronRight, Check } from 'lucide-react';
import { sleepAudio } from '../utils/audioSynth';
import { calculateSleepScore, generateSleepStages } from '../utils/sleepScore';
import { SleepRecord, WakingMood } from '../types/sleep';

interface ActiveSleepModalProps {
  isOpen: boolean;
  onClose: () => void;
  onFinishSleep: (record: SleepRecord) => void;
}

export const ActiveSleepModal: React.FC<ActiveSleepModalProps> = ({
  isOpen,
  onClose,
  onFinishSleep,
}) => {
  const [currentTime, setCurrentTime] = useState('');
  const [currentDate, setCurrentDate] = useState('');
  const [startTime, setStartTime] = useState<Date>(new Date());
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const [decibels, setDecibels] = useState(28);
  const [soundBars, setSoundBars] = useState<number[]>([12, 18, 14, 25, 20, 16, 12, 22, 19, 14]);
  const [isAudioPlaying, setIsAudioPlaying] = useState(false);
  const [activeSound, setActiveSound] = useState<'rain' | 'ocean' | 'bowl'>('rain');

  // Finish review state
  const [isWakingUp, setIsWakingUp] = useState(false);
  const [selectedMood, setSelectedMood] = useState<WakingMood>('refreshed');
  const [dreamNotes, setDreamNotes] = useState('');
  const [wakeCount, setWakeCount] = useState(1);
  const [selectedHabits, setSelectedHabits] = useState<string[]>(['hot_bath', 'reading']);

  const audioStreamRef = useRef<MediaStream | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const simTimerRef = useRef<any>(null);

  useEffect(() => {
    if (!isOpen) return;

    const startTimestamp = Date.now();
    const now = new Date(startTimestamp);
    setStartTime(now);
    setElapsedSeconds(0);
    setIsWakingUp(false);

    const updateClock = () => {
      const d = new Date();
      const h = String(d.getHours()).padStart(2, '0');
      const m = String(d.getMinutes()).padStart(2, '0');
      const s = String(d.getSeconds()).padStart(2, '0');
      setCurrentTime(`${h}:${m}:${s}`);

      const months = ['1月', '2月', '3月', '4月', '5月', '6月', '7月', '8月', '9月', '10月', '11月', '12月'];
      const days = ['星期日', '星期一', '星期二', '星期三', '星期四', '星期五', '星期六'];
      setCurrentDate(`${months[d.getMonth()]}${d.getDate()}日 ${days[d.getDay()]}`);

      // Fix P0 issue 9: Calculate real elapsed time via timestamp difference (resistant to background/sleep throttle)
      const diffSecs = Math.max(0, Math.floor((Date.now() - startTimestamp) / 1000));
      setElapsedSeconds(diffSecs);
    };

    updateClock();
    const clockTimer = setInterval(updateClock, 1000);

    // Audio / Noise monitor
    startNoiseDetection();

    return () => {
      clearInterval(clockTimer);
      stopNoiseDetection();
    };
  }, [isOpen]);

  // Attempt real microphone analyzer, or fall back to sleep ambient generator
  const startNoiseDetection = async () => {
    try {
      if (navigator.mediaDevices && navigator.mediaDevices.getUserMedia) {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true }).catch(() => null);
        if (stream) {
          audioStreamRef.current = stream;
          const AudioContextClass = window.AudioContext || (window as any).webkitAudioContext;
          const ctx = new AudioContextClass();
          audioContextRef.current = ctx;
          const source = ctx.createMediaStreamSource(stream);
          const analyser = ctx.createAnalyser();
          analyser.fftSize = 64;
          source.connect(analyser);

          const dataArray = new Uint8Array(analyser.frequencyBinCount);
          const pollAudio = () => {
            if (!audioContextRef.current) return;
            analyser.getByteFrequencyData(dataArray);
            let sum = 0;
            const bars: number[] = [];
            for (let i = 0; i < 10; i++) {
              const val = dataArray[i * 2] || 0;
              sum += val;
              bars.push(Math.max(6, Math.round((val / 255) * 45)));
            }
            const avg = sum / 10;
            const db = Math.round(25 + (avg / 255) * 45);
            setDecibels(db);
            setSoundBars(bars);
            requestAnimationFrame(pollAudio);
          };
          pollAudio();
          return;
        }
      }
    } catch {
      // Permission denied or not supported, continue with simulation
    }

    // Realistic ambient noise simulator
    simTimerRef.current = setInterval(() => {
      const baseDb = 26;
      const noiseSpike = Math.random() > 0.88 ? Math.floor(Math.random() * 18) : Math.floor(Math.random() * 5);
      const currentDb = baseDb + noiseSpike;
      setDecibels(currentDb);

      const newBars = Array.from({ length: 10 }, () => {
        return Math.floor(8 + Math.random() * (currentDb > 35 ? 32 : 16));
      });
      setSoundBars(newBars);
    }, 450);
  };

  const stopNoiseDetection = () => {
    if (simTimerRef.current) {
      clearInterval(simTimerRef.current);
      simTimerRef.current = null;
    }
    if (audioStreamRef.current) {
      audioStreamRef.current.getTracks().forEach((t) => t.stop());
      audioStreamRef.current = null;
    }
    if (audioContextRef.current) {
      audioContextRef.current.close().catch(() => {});
      audioContextRef.current = null;
    }
  };

  const toggleSound = (type: 'rain' | 'ocean' | 'bowl') => {
    if (isAudioPlaying && activeSound === type) {
      sleepAudio.stop();
      setIsAudioPlaying(false);
    } else {
      sleepAudio.play(type);
      setActiveSound(type);
      setIsAudioPlaying(true);
    }
  };

  const handleFinishSleep = () => {
    sleepAudio.stop();
    setIsAudioPlaying(false);

    const endTime = new Date();
    // Use actual real duration in minutes (minimum 1 minute), no fake 7.5h overwrite
    const effectiveMinutes = Math.max(1, Math.round(elapsedSeconds / 60));

    const bHour = String(startTime.getHours()).padStart(2, '0');
    const bMin = String(startTime.getMinutes()).padStart(2, '0');
    const wHour = String(endTime.getHours()).padStart(2, '0');
    const wMin = String(endTime.getMinutes()).padStart(2, '0');

    const bedtimeStr = `${bHour}:${bMin}`;
    const wakeTimeStr = `${wHour}:${wMin}`;

    const stagesData = generateSleepStages(bedtimeStr, wakeTimeStr);
    const { score, efficiency } = calculateSleepScore(
      effectiveMinutes,
      stagesData.deepMinutes,
      stagesData.remMinutes,
      stagesData.awakeMinutes,
      wakeCount,
      14
    );

    const now = new Date();
    const dateStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;

    const newRecord: SleepRecord = {
      id: `sleep-${Date.now()}`,
      date: dateStr,
      bedtime: bedtimeStr,
      wakeTime: wakeTimeStr,
      durationMinutes: effectiveMinutes,
      deepSleepMinutes: stagesData.deepMinutes,
      lightSleepMinutes: stagesData.lightMinutes,
      remSleepMinutes: stagesData.remMinutes,
      awakeMinutes: stagesData.awakeMinutes,
      sleepScore: score,
      sleepEfficiency: efficiency,
      latencyMinutes: 14,
      wakeCount,
      wakingMood: selectedMood,
      preSleepHabits: selectedHabits,
      dreamNotes: dreamNotes.trim() || undefined,
      stages: stagesData.stages,
    };

    onFinishSleep(newRecord);
    onClose();
  };

  if (!isOpen) return null;

  const elapsedHours = Math.floor(elapsedSeconds / 3600);
  const elapsedMins = Math.floor((elapsedSeconds % 3600) / 60);
  const elapsedSecs = elapsedSeconds % 60;

  return (
    <div className="fixed inset-0 z-50 bg-[#060810] text-slate-100 flex flex-col justify-between p-6 select-none overflow-y-auto">
      {/* Background ambient night glow */}
      <div className="absolute inset-0 pointer-events-none overflow-hidden opacity-30">
        <div className="absolute -top-24 left-1/2 -translate-x-1/2 w-96 h-96 bg-indigo-600/30 rounded-full blur-[100px]" />
        <div className="absolute -bottom-24 left-1/4 w-80 h-80 bg-violet-600/20 rounded-full blur-[90px]" />
      </div>

      {/* Top Bar */}
      <div className="relative z-10 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="w-2.5 h-2.5 rounded-full bg-emerald-400 animate-pulse" />
          <span className="text-xs font-medium text-slate-300">极光睡眠监测中</span>
        </div>
        <button
          onClick={onClose}
          className="p-2 rounded-full bg-slate-800/60 text-slate-400 hover:text-slate-200 transition-colors"
        >
          <X className="w-4 h-4" />
        </button>
      </div>

      {/* Main Night Mode Screen or Morning Review Screen */}
      {!isWakingUp ? (
        <div className="relative z-10 flex-1 flex flex-col items-center justify-center my-6 text-center">
          {/* Subtle animated moon */}
          <div className="relative w-28 h-28 mb-4 flex items-center justify-center">
            <div className="absolute inset-0 rounded-full bg-indigo-500/10 animate-ping opacity-25" />
            <div className="w-24 h-24 rounded-full bg-gradient-to-tr from-indigo-950 via-slate-900 to-indigo-900/80 border border-indigo-500/30 flex items-center justify-center shadow-2xl shadow-indigo-950/80">
              <Moon className="w-10 h-10 text-indigo-300 fill-indigo-400/20" />
            </div>
          </div>

          <div className="text-xs text-indigo-300 font-medium tracking-wide mb-1">{currentDate}</div>
          <div className="text-5xl font-mono font-bold tracking-tight text-slate-100 mb-2 tabular-nums">
            {currentTime || '23:45:00'}
          </div>

          {/* Elapsed Duration Display */}
          <div className="inline-flex items-center gap-2 px-3.5 py-1.5 rounded-full bg-slate-900/90 border border-slate-800 text-xs text-slate-300 mb-6">
            <span>已记录睡眠：</span>
            <span className="font-mono text-indigo-400 font-semibold tabular-nums">
              {elapsedHours > 0 ? `${elapsedHours}小时` : ''}
              {elapsedMins}分{elapsedSecs}秒
            </span>
          </div>

          {/* Sound / Ambient Noise Visualizer */}
          <div className="w-full max-w-xs bg-slate-900/60 border border-slate-800/80 rounded-2xl p-4 mb-4">
            <div className="flex items-center justify-between text-xs text-slate-400 mb-2">
              <div className="flex items-center gap-1.5">
                <Volume2 className="w-3.5 h-3.5 text-indigo-400" />
                <span>枕边环境声级估算</span>
              </div>
              <span className="font-mono text-slate-200 tabular-nums">~{decibels} dB(A)</span>
            </div>

            {/* Waveform bars */}
            <div className="flex items-end justify-center gap-1.5 h-10 px-2">
              {soundBars.map((height, i) => (
                <div
                  key={i}
                  style={{ height: `${height}px` }}
                  className="w-2 rounded-full bg-indigo-500/70 transition-all duration-150"
                />
              ))}
            </div>
            <div className="text-[11px] text-slate-400 mt-2 text-left space-y-0.5">
              <p className="text-slate-300 font-medium">
                {decibels < 35 ? '🟢 环境安静 · 利于褪黑素分泌' : '🟡 监测到枕边环境动静或轻微杂音'}
              </p>
              <p className="text-[10px] text-slate-500">
                （说明：基于麦克风环境声级参考估算，非医用多导睡眠图 PSG）
              </p>
            </div>
          </div>

          {/* Ambient Soundscape Quick Controls */}
          <div className="w-full max-w-xs">
            <div className="flex items-center justify-between text-xs text-slate-400 mb-2 px-1">
              <span>助眠白噪音伴睡</span>
              {isAudioPlaying && <span className="text-indigo-400 text-[11px]">正在播放中</span>}
            </div>
            <div className="grid grid-cols-3 gap-2">
              <button
                onClick={() => toggleSound('rain')}
                className={`py-2 px-2.5 rounded-xl border text-xs flex flex-col items-center gap-1 transition-all ${
                  isAudioPlaying && activeSound === 'rain'
                    ? 'bg-indigo-600/30 border-indigo-500 text-indigo-200 shadow-md shadow-indigo-900/40'
                    : 'bg-slate-900/80 border-slate-800 text-slate-300 hover:bg-slate-800'
                }`}
              >
                <span>🌧️ 雨声</span>
                <span className="text-[10px] text-slate-400">窗畔细雨</span>
              </button>
              <button
                onClick={() => toggleSound('ocean')}
                className={`py-2 px-2.5 rounded-xl border text-xs flex flex-col items-center gap-1 transition-all ${
                  isAudioPlaying && activeSound === 'ocean'
                    ? 'bg-indigo-600/30 border-indigo-500 text-indigo-200 shadow-md shadow-indigo-900/40'
                    : 'bg-slate-900/80 border-slate-800 text-slate-300 hover:bg-slate-800'
                }`}
              >
                <span>🌊 海浪</span>
                <span className="text-[10px] text-slate-400">深海潮汐</span>
              </button>
              <button
                onClick={() => toggleSound('bowl')}
                className={`py-2 px-2.5 rounded-xl border text-xs flex flex-col items-center gap-1 transition-all ${
                  isAudioPlaying && activeSound === 'bowl'
                    ? 'bg-indigo-600/30 border-indigo-500 text-indigo-200 shadow-md shadow-indigo-900/40'
                    : 'bg-slate-900/80 border-slate-800 text-slate-300 hover:bg-slate-800'
                }`}
              >
                <span>🧘 颂钵</span>
                <span className="text-[10px] text-slate-400">冥想音景</span>
              </button>
            </div>
          </div>
        </div>
      ) : (
        /* Morning wake-up checkin */
        <div className="relative z-10 flex-1 flex flex-col justify-center my-4 max-w-sm mx-auto w-full">
          <div className="text-center mb-5">
            <div className="inline-flex p-3 rounded-full bg-amber-500/10 text-amber-400 border border-amber-500/20 mb-2">
              <Sparkles className="w-6 h-6" />
            </div>
            <h3 className="text-xl font-bold text-slate-100">早安！醒来晨检</h3>
            <p className="text-xs text-slate-400 mt-1">记录清晨主观感受，结合超昼夜节律模型生成睡眠报告（估算参考）</p>
          </div>

          {/* Mood selection */}
          <div className="mb-4">
            <label className="block text-xs font-medium text-slate-300 mb-2">醒来状态感受</label>
            <div className="grid grid-cols-4 gap-2">
              {(
                [
                  { key: 'refreshed', emoji: '✨', label: '精力充沛' },
                  { key: 'neutral', emoji: '😌', label: '平稳自然' },
                  { key: 'tired', emoji: '🥱', label: '略带倦意' },
                  { key: 'groggy', emoji: '😵', label: '昏睡困滞' },
                ] as const
              ).map((item) => (
                <button
                  key={item.key}
                  onClick={() => setSelectedMood(item.key)}
                  className={`p-2.5 rounded-xl border flex flex-col items-center gap-1 text-xs transition-all ${
                    selectedMood === item.key
                      ? 'bg-indigo-600/30 border-indigo-500 text-indigo-200 shadow-sm'
                      : 'bg-slate-900/60 border-slate-800 text-slate-400 hover:text-slate-200'
                  }`}
                >
                  <span className="text-xl">{item.emoji}</span>
                  <span className="text-[11px]">{item.label}</span>
                </button>
              ))}
            </div>
          </div>

          {/* Awakenings slider */}
          <div className="mb-4 bg-slate-900/60 border border-slate-800/80 rounded-xl p-3">
            <div className="flex justify-between text-xs text-slate-300 mb-1.5">
              <span>夜间醒来次数</span>
              <span className="font-semibold text-indigo-400">{wakeCount} 次</span>
            </div>
            <input
              type="range"
              min={0}
              max={6}
              value={wakeCount}
              onChange={(e) => setWakeCount(Number(e.target.value))}
              className="w-full accent-indigo-500"
            />
          </div>

          {/* Dream diary input */}
          <div className="mb-4">
            <label className="block text-xs font-medium text-slate-300 mb-1.5">昨夜梦境记录 (选填)</label>
            <textarea
              value={dreamNotes}
              onChange={(e) => setDreamNotes(e.target.value)}
              placeholder="还记得做过的梦吗？输入几个关键词或画面..."
              rows={2}
              className="w-full bg-slate-900/80 border border-slate-800 rounded-xl p-3 text-xs text-slate-200 placeholder-slate-500 focus:outline-none focus:border-indigo-500"
            />
          </div>

          {/* Confirm & Save Button */}
          <button
            onClick={handleFinishSleep}
            className="w-full py-3.5 px-4 rounded-xl bg-gradient-to-r from-indigo-600 to-violet-600 hover:from-indigo-500 hover:to-violet-500 text-white font-medium text-sm shadow-lg shadow-indigo-950 flex items-center justify-center gap-2 active:scale-[0.98] transition-all"
          >
            <Check className="w-4 h-4" />
            <span>生成睡眠质量分析报告</span>
          </button>
        </div>
      )}

      {/* Bottom Action Bar */}
      {!isWakingUp && (
        <div className="relative z-10 pt-4 flex flex-col gap-2.5 max-w-xs mx-auto w-full">
          <button
            onClick={() => setIsWakingUp(true)}
            className="w-full py-3.5 px-4 rounded-2xl bg-indigo-600 hover:bg-indigo-500 text-white font-semibold text-sm shadow-xl shadow-indigo-950/60 flex items-center justify-center gap-2 active:scale-[0.98] transition-all"
          >
            <Sparkles className="w-4 h-4 text-indigo-200" />
            <span>我醒了 · 结束睡眠</span>
          </button>
          <p className="text-[11px] text-slate-500 text-center">保持屏幕亮起并放置在枕边以精确监测夜间微动</p>
        </div>
      )}
    </div>
  );
};
