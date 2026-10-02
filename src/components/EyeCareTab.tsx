import React, { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { Eye, MoonStar, BookOpen, Gamepad2, BedDouble, Pipette, Clock, CheckCircle2 } from 'lucide-react';
import { UserProfile, EyeCareConfig, DEFAULT_EYE_CARE } from '../types/sleep';
import { ThemeConfig } from '../utils/themeStyles';
import { useModalA11y } from '../utils/modalA11y';
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

// ===== 场景预设：每个场景是一组（主色调 + 滤镜强度 + 减光），色相彼此区分 =====
// 夜间=暖黄（经典减蓝光）· 阅读=豆沙绿（护眼绿纸感）· 游戏=中性灰（色彩保真只压暗）· 助眠=深橙（最强减蓝+减光）
const SCENES: {
  id: EyeCareConfig['preset'];
  name: string;
  desc: string;
  icon: React.ElementType;
  color: string;
  strength: number;
  dim: number;
}[] = [
  { id: 'night', name: '夜间', desc: '暖黄减蓝', icon: MoonStar, color: '#FFB35C', strength: 50, dim: 15 },
  { id: 'reading', name: '阅读', desc: '豆沙绿纸感', icon: BookOpen, color: '#CDE8CE', strength: 30, dim: 0 },
  { id: 'game', name: '游戏', desc: '中性灰保真', icon: Gamepad2, color: '#D6E0EA', strength: 15, dim: 10 },
  { id: 'sleep', name: '助眠', desc: '深橙低亮', icon: BedDouble, color: '#FF7A50', strength: 75, dim: 30 },
];

// 自定义调色盘精选色点（覆盖暖黄/橙/绿/灰蓝/紫/蓝，与场景色相呼应）
const PALETTE_DOTS = ['#FFE8C2', '#FFC178', '#FF9D57', '#FF7A50', '#CDE8CE', '#D6E0EA', '#C9A0FF', '#9DB4FF'];

// 旧版预设名迁移
const LEGACY_PRESET_MAP: Record<string, EyeCareConfig['preset']> = { soft: 'reading', amber: 'night', maple: 'sleep' };

const hslToHex = (h: number, s: number, l: number): string => {
  const f = (n: number) => {
    const k = (n + h / 30) % 12;
    const c = l - s * Math.min(l, 1 - l) * Math.max(-1, Math.min(k - 3, 9 - k, 1));
    return Math.round(c * 255).toString(16).padStart(2, '0');
  };
  return `#${f(0)}${f(8)}${f(4)}`.toUpperCase();
};
const hexToHue = (hex: string): number => {
  const r = parseInt(hex.slice(1, 3), 16) / 255;
  const g = parseInt(hex.slice(3, 5), 16) / 255;
  const b = parseInt(hex.slice(5, 7), 16) / 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  if (max === min) return 28;
  const d = max - min;
  let h: number;
  if (max === r) h = ((g - b) / d) % 6;
  else if (max === g) h = (b - r) / d + 2;
  else h = (r - g) / d + 4;
  return ((h * 60) % 360 + 360) % 360;
};


export const EyeCareTab: React.FC<EyeCareTabProps> = ({ userProfile, onUpdateProfile, onToast, theme }) => {
  const rawCfg = userProfile.eyeCare ?? DEFAULT_EYE_CARE;
  const cfg: EyeCareConfig = LEGACY_PRESET_MAP[rawCfg.preset]
    ? { ...rawCfg, preset: LEGACY_PRESET_MAP[rawCfg.preset] }
    : rawCfg;
  const native = isEyeCareNative();
  const [granted, setGranted] = useState<boolean>(true);
  const [now, setNow] = useState<Date>(new Date());
  const [hue, setHue] = useState<number>(() => hexToHue(cfg.warmColor));
  const [pickerOpen, setPickerOpen] = useState(false);
  const pickerA11y = useModalA11y(pickerOpen, () => setPickerOpen(false), '护眼滤镜颜色选择');

  const patch = (p: Partial<EyeCareConfig>) => onUpdateProfile({ eyeCare: { ...cfg, ...p } });

  // 权限状态 + 每 30s 轮询（定时窗口自动启停）
  useEffect(() => {
    if (native) {
      eyeCarePermissionGranted().then(setGranted);
    }
    void applyEyeCare(cfg);
    const t = setInterval(() => {
      setNow(new Date());
      void applyEyeCare(cfg);
    }, 30_000);
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

  const statusLine = active
    ? '滤镜生效中'
    : cfg.enabled
      ? '等待定时窗口自动开启'
      : '已关闭';

  return (
    <div className={`space-y-4 pb-28 ${theme.textPrimary}`}>
      {/* 1. 总开关 + 状态 */}
      <div className={`${theme.cardBg} rounded-3xl p-5 border ${theme.cardBorder} shadow-xl space-y-3`}>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="w-9 h-9 rounded-2xl bg-orange-500/20 text-orange-300 flex items-center justify-center border border-orange-400">
              <Eye className="w-5 h-5" />
            </div>
            <div>
              <h3 className="text-sm font-black text-white">护眼滤镜</h3>
              <p className="text-[10px] text-slate-400 flex items-center gap-1" aria-live="polite">
                {active ? <CheckCircle2 className="w-3 h-3 text-emerald-400" /> : null}
                {statusLine}
                {cfg.enabled && cfg.scheduleEnabled ? ` · 定时 ${cfg.start}–${cfg.end}` : ''}
              </p>
            </div>
          </div>
          <label className="relative inline-flex items-center cursor-pointer shrink-0">
            <input
              type="checkbox"
              aria-label="开启或关闭护眼滤镜"
              checked={cfg.enabled}
              onChange={(e) => void handleToggle(e.target.checked)}
              className="sr-only peer"
            />
            <div className="w-11 h-6 bg-slate-600 peer-checked:bg-orange-500 rounded-full transition-colors after:content-[''] after:absolute after:top-0.5 after:left-0.5 after:w-5 after:h-5 after:bg-white after:rounded-full after:transition-transform peer-checked:after:translate-x-5" />
          </label>
        </div>

        {/* 滤镜色预览细条：仅开启时显示（关闭态是条几乎全黑的空条，像坏掉的进度条） */}
        {cfg.enabled && (
          <div
            className="h-2 rounded-full border border-white/5"
            style={{ background: `linear-gradient(90deg, #0b1026, ${styles.warm})` }}
            aria-hidden
          />
        )}

        {native && cfg.enabled && !granted && (
          <button
            type="button"
            onClick={() => {
              void eyeCareOpenPermissionSettings();
              onToast('授权后返回本页，再次打开护眼开关即可');
            }}
            className="w-full py-2.5 rounded-xl bg-orange-500/20 border border-orange-400 text-orange-200 text-xs font-bold cursor-pointer active:scale-[0.98] transition-transform"
          >
            需要悬浮窗权限 · 前往系统设置授权
          </button>
        )}
        {!native && (
          <p className="text-[10px] text-slate-500">网页预览仅应用内生效；安装 APK 后全系统生效</p>
        )}
      </div>

      {/* 2. 场景预设 */}
      <div className={`${theme.cardBg} rounded-3xl p-5 border ${theme.cardBorder} shadow-xl`}>
        <div className="grid grid-cols-4 gap-2.5">
          {SCENES.map((s) => {
            const Icon = s.icon;
            const selected = cfg.preset === s.id;
            return (
              <button
                key={s.id}
                type="button"
                onClick={() => {
                  patch({ preset: s.id, warmColor: s.color, warmStrength: s.strength, dimStrength: s.dim });
                  setHue(hexToHue(s.color));   // 调色盘滑块同步色相：此前选预设后滑块显示过时的角度
                }}
                className={`flex flex-col items-center gap-1.5 rounded-2xl py-3 px-1 border transition-all cursor-pointer active:scale-[0.96] ${
                  selected
                    ? 'border-orange-400/80 bg-orange-500/10 shadow-lg shadow-orange-900/20'
                    : `${theme.cardInnerBg} ${theme.cardInnerBorder} hover:border-white/20`
                }`}
              >
                <div
                  className="w-10 h-10 rounded-2xl flex items-center justify-center border border-white/10"
                  style={{ background: `linear-gradient(135deg, ${s.color}, ${s.color}55)` }}
                >
                  <Icon className="w-5 h-5 text-white/90" />
                </div>
                <span className={`text-xs font-bold ${selected ? 'text-orange-200' : 'text-white'}`}>{s.name}</span>
                <span className="text-[9px] text-slate-400 leading-none">{s.desc}</span>
              </button>
            );
          })}
        </div>
      </div>

      {/* 3. 自定义调色盘 */}
      <div className={`${theme.cardBg} rounded-3xl p-5 border ${theme.cardBorder} shadow-xl space-y-3.5`}>
        <div className="flex items-center justify-between">
          <button
            type="button"
            onClick={() => patch({ preset: 'custom' })}
            className={`flex items-center gap-2 px-3 py-1.5 rounded-xl border text-xs font-bold cursor-pointer transition-all active:scale-95 ${
              cfg.preset === 'custom'
                ? 'border-orange-400/80 bg-orange-500/10 text-orange-200'
                : `${theme.cardInnerBg} ${theme.cardInnerBorder} text-white`
            }`}
          >
            <Pipette className="w-3.5 h-3.5" />
            自定义颜色
          </button>
          <div
            className="w-9 h-9 rounded-2xl border border-white/15 shadow-inner"
            style={{ background: cfg.warmColor }}
            aria-label={`当前颜色 ${cfg.warmColor}`}
          />
        </div>

        {/* 精选色点 */}
        <div data-no-swipe className="flex items-center justify-between gap-2">
          {PALETTE_DOTS.map((c) => (
            <button
              key={c}
              type="button"
              aria-label={`选择颜色 ${c}`}
              onClick={() => {
                setHue(hexToHue(c));
                patch({ preset: 'custom', warmColor: c });
              }}
              className={`w-10 h-10 rounded-full cursor-pointer transition-transform active:scale-90 border ${
                cfg.warmColor.toUpperCase() === c ? 'border-white scale-110 shadow-md' : 'border-white/10'
              }`}
              style={{ background: c }}
            />
          ))}
        </div>

        {/* 打开调色盘（底部弹层，原生滑杆保证可点可拖） */}
        <button
          type="button"
          onClick={() => setPickerOpen(true)}
          className="w-full py-3 rounded-2xl border border-white/15 text-slate-200 text-xs font-bold cursor-pointer active:scale-[0.98] transition-transform flex items-center justify-center gap-2"
        >
          <Pipette className="w-4 h-4" />
          打开调色盘
        </button>
      </div>

      {/* 颜色盘弹层：portal 到 body（祖先链上有 transform，fixed 会失效） */}
      {pickerOpen && createPortal(
        <div ref={pickerA11y.ref} {...pickerA11y.dialogProps} className="fixed inset-0 z-[150] bg-black/60" onClick={() => setPickerOpen(false)}>
          <div
            data-no-swipe
            role="presentation"
            className="absolute bottom-0 left-0 right-0 rounded-t-3xl p-6 pb-9 space-y-5"
            style={{ background: '#101828' }}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-black text-white">调色盘</h3>
              <button
                type="button"
                onClick={() => setPickerOpen(false)}
                className="text-xs text-slate-400 font-bold cursor-pointer px-2 py-1"
              >
                完成
              </button>
            </div>

            <div
              className="w-full h-20 rounded-2xl border border-white/10"
              style={{ background: `linear-gradient(135deg, ${cfg.warmColor}, ${cfg.warmColor}66)` }}
            />

            <div className="space-y-1.5">
              <div className="flex justify-between text-xs font-bold">
                <span className="text-slate-200">色相</span>
                <span className="text-orange-400 font-mono">{Math.round(hue)}°</span>
              </div>
              <input
                type="range"
                min={0}
                max={359}
                step={1}
                value={Math.round(hue)}
                onChange={(e) => {
                  const h = Number(e.target.value);
                  setHue(h);
                  patch({ preset: 'custom', warmColor: hslToHex(h, 0.68, 0.6) });
                }}
                className="w-full accent-orange-500 cursor-pointer h-3 rounded-lg"
                style={{
                  background:
                    'linear-gradient(90deg,#ff8080,#ffc780,#f5ff80,#96ff80,#80ffe0,#80b3ff,#c280ff,#ff80d5,#ff8080)',
                }}
                aria-label="色相"
              />
            </div>

            <div className="grid grid-cols-8 gap-2">
              {PALETTE_DOTS.map((c) => (
                <button
                  key={c}
                  type="button"
                  aria-label={`选择颜色 ${c}`}
                  onClick={() => {
                    setHue(hexToHue(c));
                    patch({ preset: 'custom', warmColor: c });
                  }}
                  className={`w-8 h-8 rounded-xl cursor-pointer transition-transform active:scale-90 border mx-auto ${
                    cfg.warmColor.toUpperCase() === c ? 'border-white scale-105 shadow-md' : 'border-white/10'
                  }`}
                  style={{ background: c }}
                />
              ))}
            </div>

            <button
              type="button"
              onClick={() => setPickerOpen(false)}
              className={`w-full py-3 rounded-2xl ${theme.accentBg} ${theme.accentFg} text-sm font-black cursor-pointer active:scale-[0.98] transition-transform`}
            >
              使用此颜色
            </button>
          </div>
        </div>,
        document.body
      )}

      {/* 4. 强度调节（含自动日变） */}
      <div className={`${theme.cardBg} rounded-3xl p-5 border ${theme.cardBorder} shadow-xl space-y-3.5`}>
        <div className={`${theme.cardInnerBg} border ${theme.cardInnerBorder} rounded-2xl p-3.5 flex items-center justify-between`}>
          <div>
            <span className="text-xs font-bold text-slate-200 block">自动日变</span>
            <span className="text-[10px] text-slate-500">白天自动减弱，19–23 点渐强至满档</span>
          </div>
          <button
            type="button"
            data-no-swipe
            onClick={(e) => {
              e.stopPropagation();
              patch({ auto: !cfg.auto });
            }}
            aria-pressed={!!cfg.auto}
            aria-label="自动日变"
            className="relative inline-flex items-center cursor-pointer shrink-0"
          >
            <span
              className={`block w-10 h-9 rounded-full transition-colors relative ${
                cfg.auto ? 'bg-orange-500' : 'bg-slate-600'
              }`}
            >
              <span
                className={`absolute top-0.5 w-4 h-4 bg-white rounded-full transition-all ${
                  cfg.auto ? 'left-[22px]' : 'left-0.5'
                }`}
              />
            </span>
          </button>
        </div>
        <div className="space-y-1.5">
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
            className="w-full accent-orange-500 cursor-pointer h-11 bg-transparent"
            aria-label="滤镜强度"
          />
        </div>
        <div className="space-y-1.5">
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
            className="w-full accent-slate-400 cursor-pointer h-11 bg-transparent"
            aria-label="屏幕减光"
          />
        </div>
      </div>

      {/* 5. 定时（默认关闭，按需开启） */}
      <div className={`${theme.cardBg} rounded-3xl p-5 border ${theme.cardBorder} shadow-xl space-y-3`}>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Clock className="w-4 h-4 text-indigo-300" />
            <h3 className="text-sm font-bold text-white">定时开启</h3>
          </div>
          <label className="relative inline-flex items-center cursor-pointer shrink-0">
            <input
              type="checkbox"
              aria-label="定时开启或关闭护眼滤镜"
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
              <span className="text-[10px] text-slate-400 block mb-1">开始</span>
              <input
                type="time"
                value={cfg.start}
                onChange={(e) => patch({ start: e.target.value || '22:00' })}
                className={`w-full bg-transparent text-sm font-mono font-bold text-white focus:outline-none ${theme?.focusRing} cursor-pointer`}
                aria-label="定时开始时间"
              />
            </div>
            <div className={`${theme.cardInnerBg} border ${theme.cardInnerBorder} rounded-2xl p-3`}>
              <span className="text-[10px] text-slate-400 block mb-1">结束</span>
              <input
                type="time"
                value={cfg.end}
                onChange={(e) => patch({ end: e.target.value || '07:00' })}
                className={`w-full bg-transparent text-sm font-mono font-bold text-white focus:outline-none ${theme?.focusRing} cursor-pointer`}
                aria-label="定时结束时间"
              />
            </div>
          </div>
        )}
        <p className="text-[10px] text-slate-500">
          {cfg.scheduleEnabled
            ? '到点自动开、出窗自动关，支持跨午夜时段（如 22:00 – 07:00）'
            : '开启后按设定时间段自动开关滤镜'}
        </p>
      </div>
    </div>
  );
};
