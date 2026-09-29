import React, { useState, useEffect } from 'react';
import {
  ChevronDown,
  RotateCcw,
  Sliders,
  Sun,
  Moon,
  ShieldCheck,
  Palette,
  CheckCircle2,
  Download,
  Upload,
  Fish,
} from 'lucide-react';
import { UserProfile, CustomAlarmSetting, CustomAIConfig, SleepRecord, SleepStageSegment } from '../types/sleep';
import { AlarmManager } from './AlarmManager';
import { CustomAISettingsModal } from './CustomAISettingsModal';
import { createPortal } from 'react-dom';
import { APP_THEMES, ThemeConfig } from '../utils/themeStyles';

// 主题切换时同步切换桌面图标（原生 activity-alias 启停；Web 环境跳过）
function switchLauncherIcon(themeId: string) {
  try {
    const cap = (window as any).Capacitor;
    if (cap?.isNativePlatform?.() && cap.Plugins?.GemmaLLM) {
      cap.Plugins.GemmaLLM.setLauncherIcon({ theme: themeId });
    }
  } catch {
    // 图标切换失败不影响主题应用
  }
}
import { getActiveModelLabel } from '../utils/localLlmEngine';
import { toLocalDateString } from '../utils/dateUtils';
import {
  buildPetSayLines,
  getBubbleEvery,
  isPetEnabled,
  isPetNative,
  petOpenPermissionSettings,
  petPermissionGranted,
  setBubbleEvery,
  startPet,
  syncPet,
  stopPet,
} from '../utils/petOverlay';


// 逐条清洗在 utils/recordSanitize.ts——启动加载路径共用同一条防线
import { sanitizeRecord } from '../utils/recordSanitize';

interface SettingsTabProps {
  records: SleepRecord[];
  userProfile: UserProfile;
  onUpdateProfile: (updated: Partial<UserProfile>) => void;
  onResetDemoData: () => void;
  onImportRecords?: (imported: SleepRecord[]) => void;
  theme: ThemeConfig;
}

export const SettingsTab: React.FC<SettingsTabProps> = ({
  records,
  userProfile,
  onUpdateProfile,
  onResetDemoData,
  onImportRecords,
  theme,
}) => {
  const [themeOpen, setThemeOpen] = useState(false);
  const [isAIConfigOpen, setIsAIConfigOpen] = useState(false);

  // 大肥鱼桌宠
  const petNative = isPetNative();
  const [petOn, setPetOn] = useState(() => isPetEnabled());
  const [petGranted, setPetGranted] = useState(true);
  const [petBusy, setPetBusy] = useState(false);
  const [petEvery, setPetEvery] = useState(() => getBubbleEvery());

  useEffect(() => {
    if (!petNative) return;
    void petPermissionGranted().then(setPetGranted);
  }, [petNative]);

  // 大肥鱼的傲娇播报词，随数据实时预览
  const petSay = buildPetSayLines(records, userProfile);

  // 播报频率改动后立即推给桌宠（开着的话）
  const handlePetEveryChange = (next: number) => {
    const v = Math.max(1, Math.min(20, next));
    setPetEvery(v);
    setBubbleEvery(v);
    if (petOn) void syncPet(records, userProfile);
  };

  const handlePetToggle = async (next: boolean) => {
    if (!petNative) return;
    setPetBusy(true);
    try {
      if (next) {
        const res = await startPet(records, userProfile);
        if (res.needPermission) {
          setPetGranted(false);
          setPetOn(false);
          return;
        }
        setPetOn(res.ok);
        if (res.ok) setPetGranted(true);
      } else {
        await stopPet();
        setPetOn(false);
      }
    } finally {
      setPetBusy(false);
    }
  };

  const handleExportJSON = () => {
    const dataStr = 'data:text/json;charset=utf-8,' + encodeURIComponent(JSON.stringify(records, null, 2));
    const downloadAnchor = document.createElement('a');
    downloadAnchor.setAttribute('href', dataStr);
    downloadAnchor.setAttribute('download', `somnacare-sleep-backup-${toLocalDateString()}.json`);
    document.body.appendChild(downloadAnchor);
    downloadAnchor.click();
    downloadAnchor.remove();
  };

  const handleImportFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (event) => {
      try {
        const parsed: unknown = JSON.parse(event.target?.result as string);
        if (!Array.isArray(parsed)) throw new Error('not-array');
        // 逐条清洗：此前只校验 Array.isArray，导入 [1,2,3] 会让首页直接崩
        const cleaned = parsed
          .map((r) => sanitizeRecord(r))
          .filter((r): r is SleepRecord => r !== null);
        if (cleaned.length === 0) {
          alert('导入失败：文件里没有可识别的睡眠记录');
          return;
        }
        if (onImportRecords) {
          onImportRecords(cleaned);
          if (cleaned.length < parsed.length) {
            alert(`已导入 ${cleaned.length} 条记录，另有 ${parsed.length - cleaned.length} 条格式无效已跳过`);
          }
        }
      } catch {
        alert('导入失败：不是合法的睡眠备份 JSON 文件');
      }
    };
    reader.readAsText(file);
  };

  return (
    <div className={`space-y-4 pb-28 ${theme.textPrimary}`}>
      {/* 1. Theme Color Palette Section（默认折叠，点头部展开） */}
      <div className={`${theme.cardBg} rounded-3xl p-5 border ${theme.cardBorder} shadow-xl space-y-3.5`}>
        <button
          type="button"
          onClick={() => setThemeOpen(!themeOpen)}
          className="w-full flex items-center justify-between pb-2.5 border-b border-slate-700/60 cursor-pointer"
        >
          <div className="flex items-center gap-2.5">
            <div className={`w-8 h-8 rounded-xl ${theme.cardInnerBg} ${theme.accentText} flex items-center justify-center border ${theme.cardBorder}`}>
              <Palette className="w-4 h-4" />
            </div>
            <div>
              <h3 className="text-sm font-bold text-white tracking-wide">界面主题</h3>
            </div>
          </div>
          <span className="flex items-center gap-2 text-[11px] font-bold text-slate-400">
            {APP_THEMES[(userProfile.themeColor || 'midnight') as keyof typeof APP_THEMES]?.name}
            <ChevronDown className={`w-4 h-4 transition-transform ${themeOpen ? 'rotate-180' : ''}`} />
          </span>
        </button>

        {themeOpen && (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5 pt-1">
          {Object.values(APP_THEMES).map((t) => {
            const isSelected = (userProfile.themeColor || 'midnight') === t.id;
            return (
              <button
                key={t.id}
                type="button"
                onClick={() => {
                  onUpdateProfile({ themeColor: t.id as any });
                  switchLauncherIcon(t.id);
                }}
                className={`p-3.5 rounded-2xl border text-left transition-all relative cursor-pointer ${
                  isSelected
                    ? `${theme.accentBorder} ${theme.cardInnerBg} shadow-lg ring-1 ${theme.accentRing}/50`
                    : `${theme.cardInnerBg} border-slate-700/70 hover:border-slate-500`
                }`}
              >
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2.5">
                    <span className={`w-4 h-4 rounded-full ${t.pageBg} border-2 border-slate-400 shadow-sm flex items-center justify-center`}>
                      <span className={`w-1.5 h-1.5 rounded-full ${t.dot}`} />
                    </span>
                    <span className="text-xs font-black text-white">{t.name}</span>
                  </div>
                  {isSelected ? (
                    <span className={`text-[11px] font-bold ${theme.accentText}`}>
                      ✓ 使用中
                    </span>
                  ) : (
                    <span className="text-[10px] text-slate-400 font-medium">{t.tag}</span>
                  )}
                </div>
              </button>
            );
          })}
        </div>
        )}
      </div>

      {/* 4. 大肥鱼桌宠悬浮窗 */}
      <div className={`${theme.cardBg} rounded-3xl p-5 border ${theme.cardBorder} shadow-xl space-y-3`}>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="w-9 h-9 rounded-2xl bg-sky-500/20 text-sky-300 flex items-center justify-center border border-sky-400">
              <Fish className="w-5 h-5" />
            </div>
            <div>
              <h3 className="text-sm font-black text-white">大肥鱼桌宠</h3>
              <p className="text-[10px] text-slate-400" aria-live="polite">
                {petNative
                  ? petOn
                    ? '常驻桌面 · 点她看消息或开护眼'
                    : '开启后常驻在其他应用之上'
                  : '网页预览不可用，安装 APK 后生效'}
              </p>
            </div>
          </div>
          {petNative && (
            <label className="relative inline-flex items-center cursor-pointer shrink-0">
              <input
                type="checkbox"
                checked={petOn}
                disabled={petBusy}
                onChange={(e) => void handlePetToggle(e.target.checked)}
                className="sr-only peer"
              />
              <div className="w-11 h-6 bg-slate-600 peer-checked:bg-sky-500 rounded-full transition-colors after:content-[''] after:absolute after:top-0.5 after:left-0.5 after:w-5 after:h-5 after:bg-white after:rounded-full after:transition-transform peer-checked:after:translate-x-5" />
            </label>
          )}
        </div>

        {/* 播报词预览：点「消息」按钮看到的傲娇发言 */}
        <div className="rounded-2xl bg-slate-900/60 border border-slate-700/60 p-3.5 space-y-1.5">
          <p className="text-[10px] font-bold text-sky-300">🐋 蓝色大肥鱼 · 傲娇播报预览</p>
          {petSay.slice(0, 3).map((line, i) => (
            <p key={i} className="text-[11px] text-slate-300 leading-relaxed">{line}</p>
          ))}
        </div>

        {/* 播报频率：每 N 次点击大肥鱼，她自动傲娇播报一次 */}
        <div className="flex items-center justify-between">
          <div className="min-w-0">
            <p className="text-[11px] font-bold text-white">女仆播报频率</p>
            <p className="text-[10px] text-slate-500 leading-relaxed">
              每 {petEvery} 次点她，大肥鱼会自动傲娇播报一次，其余点击弹出「消息 / 护眼」按钮
            </p>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <button
              type="button"
              aria-label="减少播报频率"
              onClick={() => handlePetEveryChange(petEvery - 1)}
              disabled={petEvery <= 1}
              className="w-7 h-7 rounded-lg bg-slate-700/70 text-slate-200 text-sm font-black disabled:opacity-30 cursor-pointer active:scale-90 transition-transform"
            >
              −
            </button>
            <span className="w-6 text-center text-xs font-black text-sky-300">{petEvery}</span>
            <button
              type="button"
              aria-label="增加播报频率"
              onClick={() => handlePetEveryChange(petEvery + 1)}
              disabled={petEvery >= 20}
              className="w-7 h-7 rounded-lg bg-slate-700/70 text-slate-200 text-sm font-black disabled:opacity-30 cursor-pointer active:scale-90 transition-transform"
            >
              ＋
            </button>
          </div>
        </div>

        {petNative && !petGranted && (
          <button
            type="button"
            onClick={() => void petOpenPermissionSettings()}
            className="w-full py-2.5 rounded-xl bg-sky-500/20 border border-sky-400 text-sky-200 text-xs font-bold cursor-pointer active:scale-[0.98] transition-transform"
          >
            需要悬浮窗权限 · 前往系统设置授权
          </button>
        )}
        {petNative && (
          <p className="text-[10px] text-slate-500">
            拖动可挪位置，松手自动吸附到屏幕边缘。点她弹「💬 消息 / 👁 护眼」两个按钮：消息看她头顶冒傲娇播报，护眼就地开关滤镜。
          </p>
        )}
      </div>

      {/* 2. Custom Alarm Clocks (Hardware Web Audio) */}
      <div className={`${theme.cardBg} rounded-3xl p-5 border ${theme.cardBorder} shadow-xl`}>
        <AlarmManager
          alarms={userProfile.alarms || []}
          onUpdateAlarms={(alarms: CustomAlarmSetting[]) => onUpdateProfile({ alarms })}
          theme={theme}
        />
      </div>

      {/* 3. AI Model Selector Entry */}
      <div className={`${theme.cardBg} rounded-3xl p-5 border ${theme.cardBorder} shadow-xl space-y-3`}>
        <div className="flex items-center justify-between pb-3 border-b border-slate-700/60">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-xl bg-violet-600/30 text-violet-300 flex items-center justify-center border border-violet-400">
              <Sliders className="w-4 h-4" />
            </div>
            <div>
              <h3 className="text-sm font-bold text-white">AI 顾问</h3>
              <p className="text-xs text-slate-300">
                当前运行：
                <span className={`${theme.accentText} font-bold ml-1`}>
                  {userProfile.aiConfig?.provider === 'deepseek'
                    ? `DeepSeek (${userProfile.aiConfig.deepseekModel || 'deepseek-flash'})`
                    : userProfile.aiConfig?.provider === 'local_llm'
                    ? `端侧小模型 (${getActiveModelLabel()})`
                    : userProfile.aiConfig?.provider === 'custom_openai'
                    ? '自建 API'
                    : '本地医学规则引擎'}
                </span>
              </p>
            </div>
          </div>

          <button
            type="button"
            onClick={() => setIsAIConfigOpen(true)}
            className={`px-4 py-2 rounded-xl ${theme.accentBg} ${theme.accentFg} font-black text-xs shadow-md active:scale-95 transition-all cursor-pointer whitespace-nowrap`}
          >
            配置与探查
          </button>
        </div>

        <p className="text-xs text-slate-300 font-medium">
          云端直连 · 端侧小模型 · 本地规则引擎，三级自由切换
        </p>
      </div>


      {/* 5. Data Backup, Export & Reset Management */}
      <div className={`${theme.cardBg} rounded-3xl p-5 border ${theme.cardBorder} shadow-xl space-y-3`}>
        <div className="flex items-center justify-between pb-2 border-b border-slate-700/60">
          <div className="flex items-center gap-2">
            <ShieldCheck className="w-4 h-4 text-emerald-400" />
            <span className="text-sm font-bold text-white">数据备份</span>
          </div>
          <span className={`text-[10px] ${theme.textMuted} font-mono`}>共 {records.length} 条记录</span>
        </div>

        <div className="grid grid-cols-2 gap-2.5">
          <button
            type="button"
            onClick={handleExportJSON}
            className={`py-2.5 px-3 rounded-xl ${theme.cardInnerBg} hover:opacity-90 border ${theme.cardBorder} text-white text-xs font-bold flex items-center justify-center gap-1.5 transition-all cursor-pointer shadow`}
          >
            <Download className="w-4 h-4 text-emerald-400" />
            <span>导出 JSON 备份</span>
          </button>

          <label className={`py-2.5 px-3 rounded-xl ${theme.cardInnerBg} hover:opacity-90 border ${theme.cardBorder} text-white text-xs font-bold flex items-center justify-center gap-1.5 transition-all cursor-pointer shadow`}>
            <Upload className={`w-4 h-4 ${theme.accentText}`} />
            <span>导入备份文件</span>
            <input
              type="file"
              accept=".json"
              onChange={handleImportFile}
              className="hidden"
            />
          </label>
        </div>

        <button
          type="button"
          onClick={onResetDemoData}
          className={`w-full py-2.5 rounded-xl ${theme.cardInnerBg} hover:opacity-80 border ${theme.cardInnerBorder} ${theme.textMuted} hover:text-white text-xs font-medium flex items-center justify-center gap-2 transition-all cursor-pointer`}
        >
          <RotateCcw className="w-3.5 h-3.5 opacity-60" />
          <span>恢复示例数据（7天演示）</span>
        </button>
      </div>

      {/* Custom AI Config Modal：fixed 弹窗必须 portal 到 body——外层滑动容器带
          translate3d，fixed 会退化成相对滑动层定位，弹窗就会横跨几个分区 */}
      {createPortal(
        <CustomAISettingsModal
          isOpen={isAIConfigOpen}
          onClose={() => setIsAIConfigOpen(false)}
          config={userProfile.aiConfig || { provider: 'deepseek' }}
          onSaveConfig={(cfg: CustomAIConfig) => onUpdateProfile({ aiConfig: cfg })}
          theme={theme}
        />,
        document.body,
      )}
    </div>
  );
};
