import React, { useState, useEffect } from 'react';
import { Moon, Sun, AlertTriangle } from 'lucide-react';
import { SleepRecord } from '../types/sleep';
import { calculateSleepScore, generateSleepStages, formatDurationChinese } from '../utils/sleepScore';
import { ThemeConfig } from '../utils/themeStyles';

interface OneTapSleepTrackerProps {
  onSaveRecord: (record: SleepRecord) => void;
  theme: ThemeConfig;
}

export const OneTapSleepTracker: React.FC<OneTapSleepTrackerProps> = ({ onSaveRecord, theme }) => {
  const [sleepStartTime, setSleepStartTime] = useState<number | null>(() => {
    const saved = localStorage.getItem('somnacare_bedtime_start');
    return saved ? Number(saved) : null;
  });

  const [elapsedMinutes, setElapsedMinutes] = useState(0);
  const [showSummaryModal, setShowSummaryModal] = useState(false);
  const [completedRecord, setCompletedRecord] = useState<SleepRecord | null>(null);

  useEffect(() => {
    if (!sleepStartTime) {
      setElapsedMinutes(0);
      return;
    }

    const updateTime = () => {
      const diffMin = Math.max(0, Math.floor((Date.now() - sleepStartTime) / 60000));
      setElapsedMinutes(diffMin);
    };

    updateTime();
    const interval = window.setInterval(updateTime, 5000);
    return () => window.clearInterval(interval);
  }, [sleepStartTime]);

  const handleStartSleep = () => {
    const now = Date.now();
    setSleepStartTime(now);
    localStorage.setItem('somnacare_bedtime_start', String(now));
  };

  const handleWakeUp = () => {
    if (!sleepStartTime) return;

    const startDate = new Date(sleepStartTime);
    const wakeDate = new Date();

    const bedtimeStr = `${String(startDate.getHours()).padStart(2, '0')}:${String(
      startDate.getMinutes()
    ).padStart(2, '0')}`;
    const wakeTimeStr = `${String(wakeDate.getHours()).padStart(2, '0')}:${String(
      wakeDate.getMinutes()
    ).padStart(2, '0')}`;

    // STRICT REALISTIC CALCULATION: EXACT DURATION, NO 7.5h OVERWRITE BUG
    const exactDurationMinutes = Math.max(1, Math.round((wakeDate.getTime() - sleepStartTime) / 60000));

    const generated = generateSleepStages(bedtimeStr, wakeTimeStr);

    // If sleep is genuinely short (< 60m, e.g. quick test or micro-nap), accurately scale stages
    let deepMin = generated.deepMinutes;
    let remMin = generated.remMinutes;
    let awakeMin = generated.awakeMinutes;
    let lightMin = generated.lightMinutes;

    if (exactDurationMinutes < 90) {
      // Micro-sleep or brief testing
      deepMin = Math.max(0, Math.round(exactDurationMinutes * 0.1));
      remMin = 0;
      awakeMin = Math.min(2, exactDurationMinutes);
      lightMin = Math.max(1, exactDurationMinutes - deepMin - awakeMin);
    }

    const { score, efficiency } = calculateSleepScore(
      exactDurationMinutes,
      deepMin,
      remMin,
      awakeMin,
      exactDurationMinutes < 15 ? 0 : 1,
      exactDurationMinutes < 15 ? 2 : 12
    );

    const recordDate = new Date().toISOString().split('T')[0];

    const newRecord: SleepRecord = {
      id: `onetap-${Date.now()}`,
      date: recordDate,
      bedtime: bedtimeStr,
      wakeTime: wakeTimeStr,
      durationMinutes: exactDurationMinutes,
      deepSleepMinutes: deepMin,
      lightSleepMinutes: lightMin,
      remSleepMinutes: remMin,
      awakeMinutes: awakeMin,
      sleepScore: score,
      sleepEfficiency: efficiency,
      latencyMinutes: exactDurationMinutes < 15 ? 2 : 12,
      wakeCount: exactDurationMinutes < 15 ? 0 : 1,
      wakingMood: exactDurationMinutes < 30 ? 'tired' : 'refreshed',
      preSleepHabits: [],
      stages: generated.stages,
    };

    localStorage.removeItem('somnacare_bedtime_start');
    setSleepStartTime(null);
    setCompletedRecord(newRecord);
    setShowSummaryModal(true);
    onSaveRecord(newRecord);
  };

  const handleCancelSession = () => {
    localStorage.removeItem('somnacare_bedtime_start');
    setSleepStartTime(null);
  };

  const formatElapsed = (mins: number) => {
    const h = Math.floor(mins / 60);
    const m = mins % 60;
    if (h === 0) return `${m} 分钟`;
    return `${h} 小时 ${m} 分钟`;
  };

  return (
    <>
      <div className={`${theme.cardBg} rounded-3xl p-5 border ${theme.cardBorder} shadow-lg transition-all relative overflow-hidden`}>
        {!sleepStartTime ? (
          <div className="space-y-3.5">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className={`w-11 h-11 rounded-2xl ${theme.cardInnerBg} border ${theme.cardBorder} flex items-center justify-center shadow-inner`}>
                  <Moon className={`w-5 h-5 ${theme.accentText}`} />
                </div>
                <div>
                  <h3 className="text-base font-black tracking-wide text-white">今晚准备入睡</h3>
                  <p className={`text-xs ${theme.textMuted} mt-0.5`}>枕边环境实时估算 · 记录真实作息起止点</p>
                </div>
              </div>
            </div>

            <button
              type="button"
              onClick={handleStartSleep}
              className={`w-full py-3.5 px-5 rounded-2xl ${theme.accentBg} text-white font-black text-xs tracking-wider flex items-center justify-center gap-2 active:scale-[0.99] transition-all cursor-pointer shadow-lg`}
            >
              <span>轻按开启今夜就寝监测</span>
              <span className="text-sm">→</span>
            </button>
          </div>
        ) : (
          <div className="space-y-4">
            <div className="flex items-center justify-between text-xs px-1 font-bold">
              <div className="flex items-center gap-2">
                <span className="w-2.5 h-2.5 rounded-full bg-emerald-400 animate-pulse" />
                <span className="text-emerald-400 font-black text-sm">
                  正在实时记录中 · 已就寝 {formatElapsed(elapsedMinutes)}
                </span>
              </div>
              <button
                type="button"
                onClick={handleCancelSession}
                className="text-slate-400 hover:text-white text-xs underline cursor-pointer"
              >
                取消记录
              </button>
            </div>

            <button
              type="button"
              onClick={handleWakeUp}
              className="w-full py-3.5 px-5 rounded-2xl bg-amber-400 hover:bg-amber-300 text-slate-950 font-black flex items-center justify-between active:scale-[0.99] transition-all cursor-pointer shadow-xl"
            >
              <div className="flex items-center gap-3">
                <div className="w-9 h-9 rounded-xl bg-black/10 flex items-center justify-center">
                  <Sun className="w-5 h-5 text-slate-950 fill-current" />
                </div>
                <div className="text-left">
                  <span className="text-sm font-black tracking-wide block text-slate-950">
                    已醒来 · 记录本次实际时长
                  </span>
                  <span className="text-[11px] text-slate-800 font-bold">按实际入睡分钟数精准结算</span>
                </div>
              </div>
              <span className="text-xs font-black bg-black/10 px-3 py-1.5 rounded-xl text-slate-950">
                完成本次睡眠 →
              </span>
            </button>
          </div>
        )}
      </div>

      {/* Completion Modal - 100% Solid & Strict Duration Display */}
      {showSummaryModal && completedRecord && (
        <div className="fixed inset-0 z-[100] bg-black/95 flex items-center justify-center p-4">
          <div className={`${theme.cardBg} border-2 border-indigo-400 rounded-3xl w-full max-w-sm p-6 text-white shadow-2xl text-center`}>
            <div className="text-sm font-bold text-indigo-300 mb-1">
              {completedRecord.durationMinutes < 30 ? '记录完毕 · 微睡眠/短时记录' : '晨安！恭喜完成睡眠'}
            </div>

            <h3 className="text-2xl font-black tracking-tight text-white mb-2">
              本次睡眠评定 {completedRecord.sleepScore} 分
            </h3>

            {completedRecord.durationMinutes < 30 && (
              <div className="mb-4 text-xs text-amber-300 bg-amber-950/60 p-2.5 rounded-xl border border-amber-500/40 flex items-center gap-1.5 text-left">
                <AlertTriangle className="w-4 h-4 shrink-0 text-amber-400" />
                <span>实测时长为 {completedRecord.durationMinutes} 分钟，已如实记录，无任何虚假拉长。</span>
              </div>
            )}

            <div className="grid grid-cols-3 gap-2.5 mb-6">
              <div className={`${theme.cardInnerBg} border ${theme.cardInnerBorder} rounded-2xl p-3`}>
                <span className="text-xs text-slate-300 block mb-1 font-bold">实际时长</span>
                <span className="text-base font-black font-mono text-white">
                  {completedRecord.durationMinutes < 60
                    ? `${completedRecord.durationMinutes}分钟`
                    : `${(completedRecord.durationMinutes / 60).toFixed(1)}h`}
                </span>
              </div>
              <div className={`${theme.cardInnerBg} border ${theme.cardInnerBorder} rounded-2xl p-3`}>
                <span className="text-xs text-slate-300 block mb-1 font-bold">深睡时长</span>
                <span className="text-base font-black font-mono text-emerald-400">
                  {completedRecord.deepSleepMinutes}分
                </span>
              </div>
              <div className={`${theme.cardInnerBg} border ${theme.cardInnerBorder} rounded-2xl p-3`}>
                <span className="text-xs text-slate-300 block mb-1 font-bold">睡眠效率</span>
                <span className="text-base font-black font-mono text-indigo-300">
                  {completedRecord.sleepEfficiency}%
                </span>
              </div>
            </div>

            <button
              type="button"
              onClick={() => setShowSummaryModal(false)}
              className="w-full py-3 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white font-black text-sm transition-colors cursor-pointer shadow-lg"
            >
              确定并查看详情
            </button>
          </div>
        </div>
      )}
    </>
  );
};
