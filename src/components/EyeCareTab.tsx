import React, { useEffect, useState } from 'react';
import { Eye, Sun, Moon, Clock, ShieldCheck, Info, CheckCircle2 } from 'lucide-react';
import { UserProfile, EyeCareConfig, DEFAULT_EYE_CARE } from '../types/sleep';
import { ThemeConfig } from '../utils/themeStyles';
import {
  isEyeCareNative,
  eyeCarePermissionGranted,
  eyeCareOpenPermissionSettings,
  eyeCareInAppStyles,
  isInEyeCareWindow,
  applyEyeCare,
  stopEyeCareNow,
} from '../utils/eyeCare';

interface EyeCareTabProps {
  userProfile: UserProfile;
  onUpdateProfile: (updated: Partial<UserProfile>) => void;
  onToast: (msg: string) => void;
  theme: ThemeConfig;
}

const PRESETS: { id: EyeCareConfig['preset']; name: string; desc: string; color: string }[] = [
  { id: 'soft', name: '柔和暖黄', desc: '轻度减蓝光', color: '#FFD180' },
  { id: 'amber', name: '月夜琥珀', desc: '睡前推荐', color: '#FFB26B' },
  { id: 'maple', name: '深夜枫红', desc: '深度夜间', color: '#FF8A65' },
];

const cfgOf = (p: UserProfile): EyeCareConfig => p.eyeCare ?? DEFAULT_EYE_CARE;

export const EyeCareTab: React.FC<EyeCareTabProps> = ({ userProfile, onUpdateProfile, onToast, theme }) => {
  const cfg = cfgOf(userProfile);
  const native = isEyeCareNative();
  const [granted, setGranted] = useState<boolean>(true);
  const [now, setNow] = useState<Date>(new Date());

  const patch = (p: Partial<EyeCareConfig>) => onUpdateProfile({ eyeCare: { ...cfg, ...p } });

  // 权限状态 + 每分钟刷新（驱动定时窗口状态显示与自动启停）
  useEffect(() => {
    if (native) {
      eyeCarePermissionGranted().then(setGranted);
    }
    const tick = () => {
      setNow(new Date());
      void applyEyeCare(cfgOf(userProfile));
    };
    void applyEyeCare(cfg);
    const t = setInterval(tick, 30_000);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cfg.enabled, cfg.scheduleEnabled, cfg.start, cfg.end, cfg.warmColor, cfg.warmStrength, cfg.dimStrength]);

  const inWindow = isInEyeCareWindow(cfg, now);
  const active = cfg.enabled && inWindow;
  const styles = eyeCareInAppStyles(cfg);

  const handleToggle = async (next: boolean) => {
    if (next && native) {
      const ok = await eyeCarePermissionGranted();
      setGranted(ok);
      if (!ok) {
        await eyeCareOpenPermissionSettings();
        onToast('请在系统设置中允许"显示在其他应用上层"，返回后再次开启');
        return;
      }
    }
    patch({ enabled: next });
    if (next) {
      const applied = await applyEyeCare({ ...cfg, enabled: true });
      onToast(applied ? '护眼滤镜已开启，全局生效' : '护眼滤镜将在定时窗口内自动生效');
    } else {
      await stopEyeCareNow();
      onToast('护眼滤镜已关闭');
    }
  };

  const handleGrant = async () => {
    await eyeCareOpenPermissionSettings();
    onToast('授权后返回本页，再次打开护眼开关即可');
  };

  const title = active ? '护眼滤镜生效中' : cfg.enabled ? '待定时窗口自动开启' : '护眼滤镜未开启';

  return (
    <div className={`space-y-4 pb-28 ${theme.textPrimary}`}>
      {/* 1. 状态总卡 */}
      <div className={`${theme.cardBg} rounded-3xl p-5 border ${theme.cardBorder} shadow-xl space-y-4`}>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="w-9 h-9 rounded-2xl bg-orange-500/20 text-orange-300 flex items-center justify-center border border-orange-400">
              <Eye className="w-5 h-5" />
            </div>
            <div>
              <h3 className="text-sm font-black text-white">夜间护眼</h3>
              <p className="text-[10px] text-slate-400">
                {native ? '全局悬浮窗滤镜 · 所有应用上方生效' : '网页预览：仅应用内生效，安装 APK 后全局生效'}
              </p>
            </div>
          </div>
          <label className="relative inline-flex items-center cursor-pointer">
            <input
              type="checkbox"
              checked={cfg.enabled}
              onChange={(e) => void handleToggle(e.target.checked)}
              className="sr-only peer"
            />
            <div className="w-11 h-6 bg-slate-600 peer-checked:bg-orange-500 rounded-full transition-colors after:content-[''] after:absolute after:top-0.5 after:left-0.5 after:w-5 after:h-5 after:bg-white after:rounded-full after:transition-transform peer-checked:after:translate-x-5" />
          </label>
        </div>

        <div
          className={`${theme.cardInnerBg} border ${theme.cardInnerBorder} rounded-2xl px-4 py-3 flex items-center gap-3`}
          aria-live="polite"
        >
          {active ? (
            <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
          ) : (
            <Clock className="w-4 h-4 text-slate-400 shrink-0" />
          )}
          <div className="flex-1 min-w-0">
            <span className="text-xs font-bold text-slate-100 block">{title}</span>
            <span className="text-[10px] text-slate-400">
              {cfg.enabled && cfg.scheduleEnabled
                ? `定时 ${cfg.start} – ${cfg.end} · 当前${inWindow ? '窗口内' : '窗口外'}`
                : '手动模式，随开关即时生效'}
            </span>
          </div>
          {/* 滤镜效果预览条 */}
          <div
            className="w-14 h-7 rounded-lg border border-white/10 shrink-0"
            style={{ background: `linear-gradient(90deg, #0b1026, ${styles.warm})` }}
            title="滤镜色预览"
          />
        </div>

        {native && cfg.enabled && !granted && (
          <button
            type="button"
            onClick={() => void handleGrant()}
            className="w-full py-2.5 rounded-xl bg-orange-500/20 border border-orange-400 text-orange-200 text-xs font-bold cursor-pointer active:scale-[0.98] transition-transform"
          >
            需要悬浮窗权限 · 前往系统设置授权
          </button>
        )}
      </div>

      {/* 2. 色温档位 */}
      <div className={`${theme.cardBg} rounded-3xl p-5 border ${theme.cardBorder} shadow-xl space-y-3`}>
        <div className="flex items-center gap-2 pb-2 border-b border-slate-700/60">
          <Sun className="w-4 h-4 text-amber-300" />
          <h3 className="text-sm font-bold text-white">色温档位</h3>
        </div>
        <div className="grid grid-cols-3 gap-2">
          {PRESETS.map((p) => {
            const selected = cfg.preset === p.id;
            return (
              <button
                key={p.id}
                type="button"
                onClick={() => patch({ preset: p.id, warmColor: p.color })}
                className={`rounded-2xl p-3 border text-left transition-all cursor-pointer active:scale-[0.97] ${
                  selected
                    ? 'border-orange-400 bg-orange-500/10'
                    : `${theme.cardInnerBg} ${theme.cardInnerBorder} border-opacity-40`
                }`}
              >
                <div
                  className="w-full h-8 rounded-xl mb-2 border border-white/10"
                  style={{ background: `linear-gradient(135deg, ${p.color}, ${p.color}55)` }}
                />
                <span className="text-[11px] font-bold text-white block">{p.name}</span>
                <span className="text-[9px] text-slate-400">{p.desc}</span>
              </button>
            );
          })}
        </div>

        {/* 强度滑杆 */}
        <div className={`${theme.cardInnerBg} border ${theme.cardInnerBorder} rounded-2xl p-3.5 space-y-2`}>
          <div className="flex justify-between text-xs font-bold">
            <span className="text-slate-200">滤镜强度</span>
            <span className="text-orange-400 font-mono">{cfg.warmStrength}%</span>
          </div>
          <input
            type="range"
            min={10}
            max={90}
            step={5}
            value={cfg.warmStrength}
            onChange={(e) => patch({ warmStrength: Number(e.target.value) })}
            className="w-full accent-orange-500 cursor-pointer h-2 bg-slate-700 rounded-lg"
          />
        </div>

        <div className={`${theme.cardInnerBg} border ${theme.cardInnerBorder} rounded-2xl p-3.5 space-y-2`}>
          <div className="flex justify-between text-xs font-bold">
            <span className="text-slate-200">屏幕减光</span>
            <span className="text-indigo-400 font-mono">{cfg.dimStrength}%</span>
          </div>
          <input
            type="range"
            min={0}
            max={60}
            step={5}
            value={cfg.dimStrength}
            onChange={(e) => patch({ dimStrength: Number(e.target.value) })}
            className="w-full accent-indigo-500 cursor-pointer h-2 bg-slate-700 rounded-lg"
          />
          <p className="text-[10px] text-slate-500">在全系统之上叠加柔和暗层，比手动调低亮度更温和</p>
        </div>
      </div>

      {/* 3. 定时窗口 */}
      <div className={`${theme.cardBg} rounded-3xl p-5 border ${theme.cardBorder} shadow-xl space-y-3`}>
        <div className="flex items-center justify-between pb-2 border-b border-slate-700/60">
          <div className="flex items-center gap-2">
            <Moon className="w-4 h-4 text-indigo-300" />
            <h3 className="text-sm font-bold text-white">定时开关</h3>
          </div>
          <label className="relative inline-flex items-center cursor-pointer">
            <input
              type="checkbox"
              checked={cfg.scheduleEnabled}
              onChange={(e) => patch({ scheduleEnabled: e.target.checked })}
              className="sr-only peer"
            />
            <div className="w-10 h-5 bg-slate-600 peer-checked:bg-indigo-500 rounded-full transition-colors after:content-[''] after:absolute after:top-0.5 after:left-0.5 after:w-4 after:h-4 after:bg-white after:rounded-full after:transition-transform peer-checked:after:translate-x-5" />
          </label>
        </div>

        {cfg.scheduleEnabled && (
          <div className="grid grid-cols-2 gap-2.5">
            <div className={`${theme.cardInnerBg} border ${theme.cardInnerBorder} rounded-2xl p-3`}>
              <span className="text-[10px] text-slate-400 block mb-1">开启时间</span>
              <input
                type="time"
                value={cfg.start}
                onChange={(e) => patch({ start: e.target.value || '22:00' })}
                className="w-full bg-transparent text-sm font-mono font-bold text-white focus:outline-none cursor-pointer"
              />
            </div>
            <div className={`${theme.cardInnerBg} border ${theme.cardInnerBorder} rounded-2xl p-3`}>
              <span className="text-[10px] text-slate-400 block mb-1">关闭时间</span>
              <input
                type="time"
                value={cfg.end}
                onChange={(e) => patch({ end: e.target.value || '07:00' })}
                className="w-full bg-transparent text-sm font-mono font-bold text-white focus:outline-none cursor-pointer"
              />
            </div>
          </div>
        )}
        <p className="text-[10px] text-slate-500 flex items-center gap-1">
          <Info className="w-3 h-3 shrink-0" />
          支持跨午夜时段（如 22:00 – 07:00）；应用在后台时按窗口自动启停
        </p>
      </div>

      {/* 4. 护眼小知识 */}
      <div className={`${theme.cardBg} rounded-3xl p-5 border ${theme.cardBorder} shadow-xl`}>
        <div className="flex items-center gap-2 pb-2.5 border-b border-slate-700/60">
          <ShieldCheck className="w-4 h-4 text-emerald-300" />
          <h3 className="text-sm font-bold text-white">护眼小知识</h3>
        </div>
        <ul className="mt-2.5 space-y-1.5 text-[11px] text-slate-300 leading-relaxed list-none">
          <li>· 暖色滤镜减少短波蓝光，降低夜间对褪黑素分泌的抑制</li>
          <li>· 建议 20-20-20 法则：每 20 分钟看 20 英尺（6 米）外 20 秒</li>
          <li>· 滤镜不能替代暗环境用眼保护，睡前 1 小时调暗屏幕更佳</li>
        </ul>
      </div>
    </div>
  );
};
