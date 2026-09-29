import React, { useState, useEffect } from 'react';
import { Moon, Sun, AlertTriangle } from 'lucide-react';
import { SleepRecord } from '../types/sleep';
import { calculateSleepScore, generateSleepStages, formatDurationChinese } from '../utils/sleepScore';
import { ThemeConfig } from '../utils/themeStyles';
import { useModalA11y } from '../utils/modalA11y';

interface OneTapSleepTrackerProps {
  /** 到点提醒'好的'后的开始监测信号（时间戳 ms，变化即开始记录） */
  startSignal?: number;
  onSaveRecord: (record: SleepRecord) => void;
  theme: ThemeConfig;
  targetDurationHours?: number;
}

export const OneTapSleepTracker: React.FC<OneTapSleepTrackerProps> = ({ onSaveRecord, startSignal, theme, targetDurationHours }) => {
  const [sleepStartTime, setSleepStartTime] = useState<number | null>(() => {
    const saved = localStorage.getItem('somnacare_bedtime_start');
    return saved ? Number(saved) : null;
  });

  const [elapsedMinutes, setElapsedMinutes] = useState(0);
  const [showSummaryModal, setShowSummaryModal] = useState(false);
  const [completedRecord, setCompletedRecord] = useState<SleepRecord | null>(null);
  const summaryModalA11y = useModalA11y(!!showSummaryModal, () => setShowSummaryModal(false), '睡眠完成小结');
  const [sessionTruncated, setSessionTruncated] = useState(false);

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

  // 到点提醒'好的'触发：与手点 CTA 等效的开始记录
  useEffect(() => {
    if (!startSignal) return;
    const now = Date.now();
    setSleepStartTime(now);
    localStorage.setItem('somnacare_bedtime_start', String(now));
  }, [startSignal]);

  const handleStartSleep = () => {
    const now = Date.now();
    setSleepStartTime(now);
    localStorage.setItem('somnacare_bedtime_start', String(now));
  };

  const handleWakeUp = () => {
    if (!sleepStartTime) return;

    const wakeDate = new Date();

    // 会话时长上限 16 小时：忘记结束的会话（如放了几天）不产生多天时长的荒谬记录；
    // 截断时入睡时刻按"醒来 − 16h"反推，保证分期推演窗口与记录时长一致
    const rawDurationMinutes = Math.max(1, Math.round((wakeDate.getTime() - sleepStartTime) / 60000));
    const exactDurationMinutes = Math.min(960, rawDurationMinutes);
    const sessionTruncated = rawDurationMinutes > 960;
    const effectiveStart = new Date(wakeDate.getTime() - exactDurationMinutes * 60000);

    const bedtimeStr = `${String(effectiveStart.getHours()).padStart(2, '0')}:${String(
      effectiveStart.getMinutes()
    ).padStart(2, '0')}`;
    const wakeTimeStr = `${String(wakeDate.getHours()).padStart(2, '0')}:${String(
      wakeDate.getMinutes()
    ).padStart(2, '0')}`;

    // 启发式潜伏期：生成与评分必须用同一个值，否则分期图与记录字段互相矛盾
    const latencyEst = exactDurationMinutes < 15 ? 2 : 12;
    const wakeCountEst = exactDurationMinutes < 15 ? 0 : 1;
    const generated = generateSleepStages(bedtimeStr, wakeTimeStr, latencyEst, wakeCountEst);

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

    // 统一语义：durationMinutes = 纯睡眠（卧床窗 − 觉醒段），与手动补录/演示数据一致
    const sleepMinutes = Math.max(1, exactDurationMinutes - awakeMin);
    const { score, efficiency } = calculateSleepScore(
      sleepMinutes,
      deepMin,
      remMin,
      awakeMin,
      wakeCountEst,
      latencyEst,
      Math.round((targetDurationHours || 8) * 60)
    );

    // 短会话（<90 分钟）构建与字段一致的简单分段（长会话沿用节律推演分段，
    // 各分段总和 = durationMinutes + awakeMinutes）
    const fmtClock = (base: Date, min: number) => {
      const d = new Date(base.getTime() + min * 60000);
      return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
    };
    const stagesForRecord =
      exactDurationMinutes < 90
        ? [
            { stage: 'awake' as const, startTime: fmtClock(effectiveStart, 0), endTime: fmtClock(effectiveStart, awakeMin), durationMinutes: awakeMin },
            { stage: 'deep' as const, startTime: fmtClock(effectiveStart, awakeMin), endTime: fmtClock(effectiveStart, awakeMin + deepMin), durationMinutes: deepMin },
            { stage: 'light' as const, startTime: fmtClock(effectiveStart, awakeMin + deepMin), endTime: fmtClock(effectiveStart, exactDurationMinutes), durationMinutes: lightMin },
          ]
        : generated.stages;

    // 本地日期（此前 toISOString 是 UTC：早 6-9 点醒来会落到 UTC 前一天，跨夜记录互相覆盖）
    const nowLocal = new Date();
    const recordDate = `${nowLocal.getFullYear()}-${String(nowLocal.getMonth() + 1).padStart(2, '0')}-${String(nowLocal.getDate()).padStart(2, '0')}`;

    const newRecord: SleepRecord = {
      id: `onetap-${Date.now()}`,
      date: recordDate,
      bedtime: bedtimeStr,
      wakeTime: wakeTimeStr,
      durationMinutes: sleepMinutes,
      deepSleepMinutes: deepMin,
      lightSleepMinutes: lightMin,
      remSleepMinutes: remMin,
      awakeMinutes: awakeMin,
      sleepScore: score,
      sleepEfficiency: efficiency,
      // 一键就寝没有输入入口，这个潜伏期是按总时长的启发式估算，如实标注
      latencyMinutes: exactDurationMinutes < 15 ? 2 : 12,
      latencyEstimated: true,
      wakeCount: exactDurationMinutes < 15 ? 0 : 1,
      wakingMood: exactDurationMinutes < 30 ? 'tired' : 'refreshed',
      preSleepHabits: [],
      stages: stagesForRecord,
    };

    localStorage.removeItem('somnacare_bedtime_start');
    setSleepStartTime(null);
    setCompletedRecord(newRecord);
    setSessionTruncated(sessionTruncated);
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
                  <p className={`text-xs ${theme.textMuted} mt-0.5`}>记录真实作息起止点</p>
                </div>
              </div>
            </div>

            <button
              type="button"
              onClick={handleStartSleep}
              className={`w-full py-3.5 px-5 rounded-2xl ${theme.accentBg} ${theme.accentFg} font-black text-xs tracking-wider flex items-center justify-center gap-2 active:scale-[0.99] transition-all cursor-pointer shadow-lg animate-cta-breathe`}
            >
              <span>开始夜间监测</span>
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
        <div ref={summaryModalA11y.ref} {...summaryModalA11y.dialogProps} className="fixed inset-0 z-[100] bg-black/95 flex items-center justify-center p-4">
          <div className={`${theme.cardBg} border-2 ${theme.accentBorder} rounded-3xl w-full max-w-sm p-6 text-white shadow-2xl text-center`}>
            <div className={`text-sm font-bold ${theme.accentText} mb-1`}>
              {completedRecord.durationMinutes < 30 ? '记录完毕 · 微睡眠/短时记录' : '晨安！恭喜完成睡眠'}
            </div>

            <h3 className="text-2xl font-black tracking-tight text-white mb-2">
              本次睡眠评定 {completedRecord.sleepScore} 分
            </h3>

            {sessionTruncated && (
              <div className="mb-4 text-xs text-amber-300 bg-amber-950/60 p-2.5 rounded-xl border border-amber-500/40 flex items-center gap-1.5 text-left">
                <AlertTriangle className="w-4 h-4 shrink-0 text-amber-400" />
                <span>监测会话超过 16 小时，已按 16 小时记录（可能是忘记点"已醒来"）。</span>
              </div>
            )}

            {completedRecord.durationMinutes < 30 && (
              <div className="mb-4 text-xs text-amber-300 bg-amber-950/60 p-2.5 rounded-xl border border-amber-500/40 flex items-center gap-1.5 text-left">
                <AlertTriangle className="w-4 h-4 shrink-0 text-amber-400" />
                <span>记录时长为 {completedRecord.durationMinutes} 分钟，按你实际开始/结束时间计算，未做拉长。</span>
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
                <span className={`text-base font-black font-mono ${theme.accentText}`}>
                  {completedRecord.sleepEfficiency}%
                </span>
              </div>
            </div>

            <button
              type="button"
              onClick={() => setShowSummaryModal(false)}
              className={`w-full py-3 rounded-xl ${theme.accentBg} ${theme.accentFg} font-black text-sm transition-colors cursor-pointer shadow-lg`}
            >
              确定并查看详情
            </button>
          </div>
        </div>
      )}
    </>
  );
};
