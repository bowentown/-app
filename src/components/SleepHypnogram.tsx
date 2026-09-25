import React from 'react';
import { SleepRecord, SleepStage } from '../types/sleep';

interface SleepHypnogramProps {
  record: SleepRecord;
}

const STAGE_CONFIG: Record<SleepStage, { label: string; color: string; yOffset: number; height: number }> = {
  awake: { label: '清醒', color: '#f87171', yOffset: 10, height: 18 },
  rem: { label: 'REM (快速眼动)', color: '#818cf8', yOffset: 45, height: 22 },
  light: { label: '浅睡', color: '#38bdf8', yOffset: 85, height: 24 },
  deep: { label: '深睡', color: '#6366f1', yOffset: 125, height: 26 },
};

export const SleepHypnogram: React.FC<SleepHypnogramProps> = ({ record }) => {
  const stages = record.stages || [];
  const totalMin = record.durationMinutes + record.awakeMinutes;

  const deepPercent = totalMin > 0 ? Math.round((record.deepSleepMinutes / totalMin) * 100) : 0;
  const remPercent = totalMin > 0 ? Math.round((record.remSleepMinutes / totalMin) * 100) : 0;
  const lightPercent = totalMin > 0 ? Math.round((record.lightSleepMinutes / totalMin) * 100) : 0;
  const awakePercent = totalMin > 0 ? Math.round((record.awakeMinutes / totalMin) * 100) : 0;

  // Pre-calculate SVG stage blocks
  const startX = 40;
  const usableWidth = 355;
  let currentX = startX;
  const renderedBlocks = stages.map((st, i) => {
    const width = Math.max(3, (st.durationMinutes / totalMin) * usableWidth);
    const stageCfg = STAGE_CONFIG[st.stage] || STAGE_CONFIG.light;
    const rectY =
      st.stage === 'awake' ? 10 : st.stage === 'rem' ? 44 : st.stage === 'light' ? 76 : 108;
    const rectX = currentX;
    currentX += width;

    return (
      <g key={i}>
        <rect
          x={rectX}
          y={rectY}
          width={width}
          height={16}
          rx="3"
          fill={stageCfg.color}
          opacity={0.88}
        >
          <title>{`${stageCfg.label}: ${st.durationMinutes}分钟 (${st.startTime}-${st.endTime})`}</title>
        </rect>
        {i < stages.length - 1 && (
          <line
            x1={rectX + width}
            y1={rectY + 8}
            x2={rectX + width}
            y2={
              stages[i + 1].stage === 'awake'
                ? 18
                : stages[i + 1].stage === 'rem'
                ? 52
                : stages[i + 1].stage === 'light'
                ? 84
                : 116
            }
            stroke="#64748b"
            strokeWidth="1.2"
          />
        )}
      </g>
    );
  });

  return (
    <div className="w-full space-y-3">
      <div className="flex items-center justify-between mb-2 text-xs">
        <div>
          <span className="font-black text-white text-sm">90分钟脑波睡眠周期分布</span>
          <span className="text-slate-300 font-mono ml-2 font-bold">
            {record.bedtime} - {record.wakeTime}
          </span>
        </div>
        <span className="font-mono text-emerald-300 bg-emerald-950 px-2.5 py-0.5 rounded-lg border border-emerald-600 font-bold">
          综合效率 {record.sleepEfficiency}%
        </span>
      </div>

      {/* SVG Timeline Chart */}
      <div className="relative w-full h-36 select-none bg-[#090d1a] rounded-2xl p-2.5 border border-slate-700/80 shadow-inner">
        {/* Stage Y-axis labels */}
        <div className="absolute left-2.5 top-2.5 bottom-6 flex flex-col justify-between text-[10px] text-slate-400 font-semibold pointer-events-none z-10">
          <span className="text-rose-400">清醒</span>
          <span className="text-indigo-300">REM</span>
          <span className="text-sky-300">浅睡</span>
          <span className="text-indigo-400 font-bold">深睡</span>
        </div>

        {/* Timeline SVG */}
        <svg className="w-full h-full" viewBox="0 0 400 130" preserveAspectRatio="none">
          {/* Horizontal guideline levels */}
          <line x1="38" y1="18" x2="395" y2="18" stroke="#334155" strokeDasharray="3 3" strokeWidth="0.8" />
          <line x1="38" y1="52" x2="395" y2="52" stroke="#334155" strokeDasharray="3 3" strokeWidth="0.8" />
          <line x1="38" y1="84" x2="395" y2="84" stroke="#334155" strokeDasharray="3 3" strokeWidth="0.8" />
          <line x1="38" y1="116" x2="395" y2="116" stroke="#334155" strokeDasharray="3 3" strokeWidth="0.8" />

          {/* Render stage blocks */}
          {stages.length > 0 && renderedBlocks}
        </svg>

        {/* Time X-axis */}
        <div className="absolute left-10 right-2 bottom-1 flex justify-between text-[10px] text-slate-300 font-mono font-medium">
          <span>{record.bedtime}</span>
          <span>{getMidpointTime(record.bedtime, record.wakeTime)}</span>
          <span>{record.wakeTime}</span>
        </div>
      </div>

      {/* Stage Percentage Bar */}
      <div className="mt-3">
        <div className="h-2.5 w-full bg-slate-800 rounded-full overflow-hidden flex border border-slate-700">
          <div style={{ width: `${deepPercent}%` }} className="bg-indigo-500 h-full" title={`深睡: ${deepPercent}%`} />
          <div style={{ width: `${lightPercent}%` }} className="bg-sky-400 h-full" title={`浅睡: ${lightPercent}%`} />
          <div style={{ width: `${remPercent}%` }} className="bg-indigo-300 h-full" title={`REM: ${remPercent}%`} />
          <div style={{ width: `${awakePercent}%` }} className="bg-rose-400 h-full" title={`清醒: ${awakePercent}%`} />
        </div>

        {/* Breakdown Legend */}
        <div className="grid grid-cols-4 gap-2 mt-3 text-center text-xs">
          <div className="p-2 rounded-xl bg-[#0f172a] border border-slate-700/60 shadow-inner">
            <div className="flex items-center justify-center gap-1">
              <span className="w-2 h-2 rounded-full bg-indigo-500" />
              <span className="text-xs text-slate-300 font-medium">深睡</span>
            </div>
            <span className="font-bold text-white mt-0.5 block tabular-nums text-sm">{record.deepSleepMinutes}分</span>
            <span className="text-[10px] text-indigo-300 font-mono font-medium">{deepPercent}% (目标&gt;18%)</span>
          </div>

          <div className="p-2 rounded-xl bg-[#0f172a] border border-slate-700/60 shadow-inner">
            <div className="flex items-center justify-center gap-1">
              <span className="w-2 h-2 rounded-full bg-sky-400" />
              <span className="text-xs text-slate-300 font-medium">浅睡</span>
            </div>
            <span className="font-bold text-white mt-0.5 block tabular-nums text-sm">{record.lightSleepMinutes}分</span>
            <span className="text-[10px] text-sky-300 font-mono font-medium">{lightPercent}%</span>
          </div>

          <div className="p-2 rounded-xl bg-[#0f172a] border border-slate-700/60 shadow-inner">
            <div className="flex items-center justify-center gap-1">
              <span className="w-2 h-2 rounded-full bg-indigo-300" />
              <span className="text-xs text-slate-300 font-medium">REM</span>
            </div>
            <span className="font-bold text-white mt-0.5 block tabular-nums text-sm">{record.remSleepMinutes}分</span>
            <span className="text-[10px] text-indigo-300 font-mono font-medium">{remPercent}% (目标&gt;20%)</span>
          </div>

          <div className="p-2 rounded-xl bg-[#0f172a] border border-slate-700/60 shadow-inner">
            <div className="flex items-center justify-center gap-1">
              <span className="w-2 h-2 rounded-full bg-rose-400" />
              <span className="text-xs text-slate-300 font-medium">清醒</span>
            </div>
            <span className="font-bold text-white mt-0.5 block tabular-nums text-sm">{record.awakeMinutes}分</span>
            <span className="text-[10px] text-rose-300 font-mono font-medium">{awakePercent}%</span>
          </div>
        </div>
      </div>
    </div>
  );
};

function getMidpointTime(bedtime: string, wakeTime: string): string {
  const [bH, bM] = bedtime.split(':').map(Number);
  const [wH, wM] = wakeTime.split(':').map(Number);
  let bMin = bH * 60 + bM;
  let wMin = wH * 60 + wM;
  if (wMin <= bMin) wMin += 24 * 60;
  const midMin = Math.round((bMin + wMin) / 2) % (24 * 60);
  const h = String(Math.floor(midMin / 60)).padStart(2, '0');
  const m = String(midMin % 60).padStart(2, '0');
  return `${h}:${m}`;
}
