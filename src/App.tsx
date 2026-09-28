import React, { useState, useEffect, useRef } from 'react';
import {
  Moon,
  CheckCircle2,
} from 'lucide-react';
import { SleepRecord, UserProfile, DEFAULT_EYE_CARE } from './types/sleep';
import { getInitialSleepLogs } from './utils/sleepScore';
import { TodayTab } from './components/TodayTab';
import { TrendsTab } from './components/TrendsTab';
import { AIAdvicePanel } from './components/AIAdvicePanel';
import { SettingsTab } from './components/SettingsTab';
import { EyeCareTab } from './components/EyeCareTab';
import { BottomNavBar, NavTab } from './components/BottomNavBar';
import { ActiveSleepModal } from './components/ActiveSleepModal';
import { ManualLogModal } from './components/ManualLogModal';
import { APP_THEMES } from './utils/themeStyles';
import { isNativePlatform, syncAlarmsToNative } from './utils/nativeAlarmScheduler';
import { applyEyeCare, eyeCareInAppStyles, isInEyeCareWindow } from './utils/eyeCare';
import { LaunchSplash } from './components/LaunchSplash';
import { BedtimeReminder, BedtimeReminderPhase } from './components/BedtimeReminder';

export const App: React.FC = () => {
  const [activeTab, setActiveTab] = useState<NavTab>('today');
  const [isActiveSleepOpen, setIsActiveSleepOpen] = useState(false);
  const [isManualLogOpen, setIsManualLogOpen] = useState(false);
  const [toastMessage, setToastMessage] = useState<string | null>(null);
  const [bedtimeReminder, setBedtimeReminder] = useState<BedtimeReminderPhase | null>(null);
  const [sleepStartSignal, setSleepStartSignal] = useState(0);
  const TAB_ORDER: NavTab[] = ['today', 'trends', 'coach', 'eyecare', 'settings'];
  const trackRef = useRef<HTMLDivElement>(null);
  const idxRef = useRef(0);
  const dragRef = useRef<{
    x0: number; y0: number; base: number; locked: 'h' | 'y' | null; skip: boolean;
    w: number; lastX: number; lastT: number; v: number;
  } | null>(null);

  // Persistence for user logs: Empty by default for new users, prevents overwriting corrupt data
  const [records, setRecords] = useState<SleepRecord[]>(() => {
    const saved = localStorage.getItem('somnacare_sleep_records');
    if (saved) {
      try {
        const parsed = JSON.parse(saved);
        if (Array.isArray(parsed)) return parsed;
      } catch (e) {
        console.error('Failed to parse saved records, backing up corrupted key:', e);
        localStorage.setItem('somnacare_sleep_records_backup_corrupted', saved);
        return [];
      }
    }
    // New user starts with empty clean diary by default (can explicitly load demo data in Settings)
    return [];
  });

  // User Profile configuration
  const [userProfile, setUserProfile] = useState<UserProfile>(() => {
    const saved = localStorage.getItem('somnacare_user_profile');
    if (saved) {
      try {
        const parsedProfile = JSON.parse(saved) as UserProfile;
        // 老默认闹钟名对称化：工作日 → 周内（仅迁移未改过名的默认项）
        if (Array.isArray(parsedProfile?.alarms)) {
          parsedProfile.alarms = parsedProfile.alarms.map((a) =>
            a.label === '工作日温和唤醒' ? { ...a, label: '周内温和唤醒' } : a
          );
        }
        // 老配置补齐护眼分区默认值
        if (!parsedProfile.eyeCare) {
          parsedProfile.eyeCare = DEFAULT_EYE_CARE;
        }
        return parsedProfile;
      } catch (e) {
        console.error('Failed to parse profile', e);
      }
    }
    return {
      name: '体验用户',
      age: 28,
      targetBedtime: '23:30',
      targetWakeTime: '07:30',
      targetDurationHours: 8,
      smartAlarmEnabled: true,
      smartWakeWindowMinutes: 20,
      soundDetectionSensitivity: 'medium',
      themeColor: 'midnight',
      brightnessLevel: 100,
      warmthFilter: false,
      alarms: [
        {
          id: 'alarm-1',
          time: '07:30',
          label: '周内温和唤醒',
          enabled: true,
          repeatDays: [1, 2, 3, 4, 5],
          tone: 'gentle_chime',
          vibrate: true,
          smartWakeEnabled: true,
          smartWakeWindowMinutes: 20,
        },
        {
          id: 'alarm-2',
          time: '08:30',
          label: '周末舒缓起床',
          enabled: false,
          repeatDays: [6, 7],
          tone: 'aurora_melody',
          vibrate: true,
          smartWakeEnabled: true,
          smartWakeWindowMinutes: 20,
        },
      ],
      aiConfig: {
        provider: 'deepseek',
        deepseekModel: 'deepseek-flash',
        systemPersona:
          '你是一位资深临床睡眠医学与生物钟节律顾问。以温暖关切、科学严谨的语气为用户答疑，重点指导如何提升深度睡眠质量。',
      },
    };
  });

  useEffect(() => {
    localStorage.setItem('somnacare_sleep_records', JSON.stringify(records));
  }, [records]);

  useEffect(() => {
    localStorage.setItem('somnacare_user_profile', JSON.stringify(userProfile));
  }, [userProfile]);

  // APK 启动时无条件同步一次闹钟到原生 AlarmManager（重启/重装后打开即恢复调度）
  useEffect(() => {
    if (isNativePlatform()) {
      syncAlarmsToNative(userProfile.alarms || []);
    }
  }, []);

  // 作息目标到点提醒：目标就寝时刻起 15 分钟内、当日未提醒、且未在监测中 → 全屏提醒
  useEffect(() => {
    const check = () => {
      if (bedtimeReminder || isNativePlatform()) return; // 原生端由悬浮窗提醒（跨应用）
      if (!userProfile.bedtimeReminderEnabled) return;
      try {
        if (localStorage.getItem('somnacare_bedtime_start')) return;
        const today = `${new Date().getFullYear()}-${String(new Date().getMonth() + 1).padStart(2, '0')}-${String(new Date().getDate()).padStart(2, '0')}`;
        if (localStorage.getItem('somnacare_reminder_fired') === today) return;
        const [th, tm] = (userProfile.targetBedtime || '23:30').split(':').map(Number);
        const now = new Date();
        const nowMin = now.getHours() * 60 + now.getMinutes();
        const targetMin = th * 60 + tm;
        if (nowMin >= targetMin && nowMin <= targetMin + 15) {
          localStorage.setItem('somnacare_reminder_fired', today);
          setBedtimeReminder('ask');
        }
      } catch {
        // ignore
      }
    };
    check();
    const t = setInterval(check, 20_000);
    return () => clearInterval(t);
  }, [userProfile.targetBedtime, userProfile.bedtimeReminderEnabled, bedtimeReminder]);

  // 原生：开启提醒时按目标重排精确闹钟；关闭即取消。悬浮"好的"经冷启动标记或事件接续
  const runGoodPath = () => {
    try {
      if (localStorage.getItem('somnacare_bedtime_start')) return;
      const now = Date.now();
      localStorage.setItem('somnacare_bedtime_start', String(now));
      setSleepStartSignal(now);
      setActiveTab('today');
      showToast('晚安💤');
    } catch {
      // ignore
    }
  };
  useEffect(() => {
    if (!isNativePlatform()) return;
    try {
      const cap = (window as any).Capacitor;
      if (userProfile.bedtimeReminderEnabled) {
        cap.Plugins?.GemmaLLM?.bedtimeReminderSchedule?.({ time: userProfile.targetBedtime });
      } else {
        cap.Plugins?.GemmaLLM?.bedtimeReminderCancel?.();
      }
      cap.Plugins?.GemmaLLM?.bedtimeAutoStartConsume?.().then((res: any) => {
        if (res?.consume) runGoodPath();
      });
      cap.Plugins?.GemmaLLM?.addListener?.('bedtimeGood', () => runGoodPath());
    } catch {
      // ignore
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userProfile.targetBedtime, userProfile.bedtimeReminderEnabled]);

  // 护眼滤镜：打开 App 时按配置/定时窗口自动启停，之后每 30 秒轮询一次
  const eyeCareCfg = userProfile.eyeCare ?? DEFAULT_EYE_CARE;
  useEffect(() => {
    void applyEyeCare(eyeCareCfg);
    const t = setInterval(() => void applyEyeCare(eyeCareCfg), 30_000);
    return () => clearInterval(t);
  }, [eyeCareCfg]);

  // 分区滑动轨道：跟手拖拽 + 方向锁 + 边缘橡皮筋，松手按位移/速度吸附
  const paneW = () => trackRef.current?.parentElement?.clientWidth || window.innerWidth;
  const setTrack = (px: number, animate: boolean) => {
    const el = trackRef.current;
    if (!el) return;
    el.style.transition = animate ? 'transform 300ms cubic-bezier(0.22,1,0.36,1)' : 'none';
    el.style.transform = `translateX(${px}px)`;
  };
  const setTrackIdx = (idx: number) => setTrack(-idx * paneW(), true);

  const handleTouchStart = (e: React.TouchEvent) => {
    const t = e.touches[0];
    const el = e.target as HTMLElement;
    const skip = !!el.closest('input, textarea, [data-no-swipe]');
    dragRef.current = {
      x0: t.clientX, y0: t.clientY,
      base: -idxRef.current * paneW(),
      locked: null, skip, w: paneW(),
      lastX: t.clientX, lastT: performance.now(), v: 0,
    };
    if (!skip && trackRef.current) trackRef.current.style.transition = 'none';
  };
  const handleTouchMove = (e: React.TouchEvent) => {
    const d = dragRef.current;
    if (!d || d.skip) return;
    const t = e.touches[0];
    const dx = t.clientX - d.x0;
    const dy = t.clientY - d.y0;
    if (!d.locked) {
      if (Math.abs(dx) < 8 && Math.abs(dy) < 8) return;
      d.locked = Math.abs(dx) > Math.abs(dy) ? 'h' : 'y';
    }
    if (d.locked !== 'h') return;
    let offset = d.base + dx;
    const min = -(TAB_ORDER.length - 1) * d.w;
    if (offset > 0) offset = offset * 0.3;
    if (offset < min) offset = min + (offset - min) * 0.3;
    const el = trackRef.current;
    if (el) {
      el.style.transition = 'none';
      el.style.transform = `translateX(${offset}px)`;
    }
    const now = performance.now();
    d.v = (t.clientX - d.lastX) / Math.max(1, now - d.lastT);
    d.lastX = t.clientX;
    d.lastT = now;
  };
  const handleTouchEnd = (e: React.TouchEvent) => {
    const d = dragRef.current;
    dragRef.current = null;
    if (!d || d.skip) return;
    const t = e.changedTouches[0];
    const dx = t.clientX - d.x0;
    let idx = idxRef.current;
    if (d.locked === 'h' && (Math.abs(dx) > d.w * 0.22 || Math.abs(d.v) > 0.45)) {
      idx = Math.max(0, Math.min(TAB_ORDER.length - 1, idxRef.current + (dx < 0 ? 1 : -1)));
    }
    if (idx !== idxRef.current) {
      setActiveTab(TAB_ORDER[idx]); // effect 吸附
    } else {
      setTrackIdx(idx); // 回弹
    }
  };

  // activeTab 变化（含底栏点击与滑动吸附）→ 轨道带缓动滑到目标页
  useEffect(() => {
    idxRef.current = TAB_ORDER.indexOf(activeTab);
    const el = trackRef.current;
    if (el) {
      el.style.transition = 'transform 300ms cubic-bezier(0.22,1,0.36,1)';
      el.style.transform = `translateX(${-idxRef.current * (100 / TAB_ORDER.length)}%)`;
    }
  }, [activeTab]);

  const showToast = (msg: string) => {
    setToastMessage(msg);
    setTimeout(() => setToastMessage(null), 3200);
  };

  const handleSaveActiveSleep = (newRecord: SleepRecord) => {
    setRecords((prev) => {
      const filtered = prev.filter((r) => r.date !== newRecord.date);
      return [newRecord, ...filtered].sort(
        (a, b) => new Date(b.date).getTime() - new Date(a.date).getTime()
      );
    });
    showToast(`🌙 记录已保存！本次睡眠记录时长 ${newRecord.durationMinutes < 60 ? `${newRecord.durationMinutes}分钟` : `${(newRecord.durationMinutes / 60).toFixed(1)}小时`}`);
  };

  const handleSaveManualRecord = (newRecord: SleepRecord) => {
    setRecords((prev) => {
      const filtered = prev.filter((r) => r.date !== newRecord.date);
      return [newRecord, ...filtered].sort(
        (a, b) => new Date(b.date).getTime() - new Date(a.date).getTime()
      );
    });
    showToast(`📝 睡眠记录已保存！综合健康得分 ${newRecord.sleepScore} 分`);
  };

  const handleResetDemoData = () => {
    const initial = getInitialSleepLogs();
    setRecords(initial);
    showToast('已重置恢复 7 天真实睡眠示例数据');
  };

  const handleDeleteRecord = (id: string) => {
    setRecords((prev) => prev.filter((r) => r.id !== id));
    showToast('已删除该条睡眠数据');
  };

  // Obtain active theme config (card, text, page all linked)
  const currentTheme = APP_THEMES[userProfile.themeColor as keyof typeof APP_THEMES] || APP_THEMES.midnight;

  return (
    <div
      className={`h-[100dvh] w-full theme-${currentTheme.id} ${currentTheme.pageBg} ${currentTheme.textPrimary} ${currentTheme.selectionBg} relative flex flex-col overflow-hidden transition-colors duration-300`}
    >
      {/* 品牌氛围：页首背后的主题色极光带（呼应开屏动画） */}
      <div aria-hidden className="pointer-events-none absolute top-0 left-0 right-0 h-44 overflow-hidden">
        <div
          className="absolute -top-28 left-1/2 -translate-x-1/2 w-[130%] h-56 blur-3xl opacity-[0.2]"
          style={{ background: `linear-gradient(100deg, transparent 12%, ${currentTheme.accentHex} 38%, transparent 52%, #8b5cf6 66%, transparent 84%)` }}
        />
      </div>
      <LaunchSplash theme={currentTheme} />
      {/* 夜间护眼：原生端由系统悬浮窗全局生效，应用内不再叠加（避免双重滤镜）；
          Web/PWA 端回退为应用内滤镜层 */}
      {!isNativePlatform() && (eyeCareCfg.enabled
        ? (() => {
            const inWindow = isInEyeCareWindow(eyeCareCfg);
            if (!inWindow) return null;
            const { warm, dim } = eyeCareInAppStyles(eyeCareCfg);
            return (
              <>
                <div className="fixed inset-0 z-[70] pointer-events-none" style={{ background: warm, mixBlendMode: 'multiply' }} />
                <div className="fixed inset-0 z-[70] pointer-events-none" style={{ background: dim }} />
              </>
            );
          })()
        : (
          <>
            {userProfile.warmthFilter && (
              <div className="fixed inset-0 z-[70] pointer-events-none" style={{ background: 'rgba(255,147,41,0.10)', mixBlendMode: 'multiply' }} />
            )}
            {userProfile.brightnessLevel < 100 && (
              <div className="fixed inset-0 z-[70] pointer-events-none" style={{ background: `rgba(0,0,0,${((100 - userProfile.brightnessLevel) / 100) * 0.55})` }} />
            )}
          </>
        ))}
      {/* 作息目标到点提醒（Web/PWA 端；APK 端由原生悬浮窗跨应用弹出） */}
      {!isNativePlatform() && bedtimeReminder && (
        <BedtimeReminder
          theme={currentTheme}
          phase={bedtimeReminder}
          onGood={() => setBedtimeReminder('good')}
          onIgnore={() => setBedtimeReminder('ignore')}
          onDone={(finalPhase) => {
            if (finalPhase === 'good') {
              const now = Date.now();
              localStorage.setItem('somnacare_bedtime_start', String(now));
              setSleepStartSignal(now);
              setActiveTab('today');
              showToast('晚安💤');
            }
            setBedtimeReminder(null);
          }}
        />
      )}

      {/* Toast Notification */}
      {toastMessage && (
        <div className={`fixed top-5 left-1/2 -translate-x-1/2 z-[90] px-5 py-3 rounded-2xl ${currentTheme.accentBg.split(' ')[0]} text-white text-xs font-black shadow-2xl flex items-center gap-2.5 animate-bounce border border-white/10`}>
          <CheckCircle2 className="w-5 h-5 text-white/90" />
          <span>{toastMessage}</span>
        </div>
      )}

      {/* Main Content Area: Natural Vertical Page Scroll (Header flows with content) */}
      <div className="w-full flex-1 max-w-lg mx-auto flex flex-col min-h-0">
        {/* Scrollable Mobile Header */}
        <header className={`px-5 pt-5 pb-3.5 flex items-center justify-between border-b ${currentTheme.cardBorder} shrink-0`}>
          <div className="flex items-center gap-2.5">
            <div
              className="w-9 h-9 rounded-2xl text-white flex items-center justify-center shadow-md"
              style={{ background: `linear-gradient(135deg, ${currentTheme.accentHex}, ${currentTheme.accentHex}55)` }}
            >
              <Moon className="w-5 h-5 fill-white/50" />
            </div>
            <h1 className="text-xl font-black tracking-tight text-white">
              极光睡眠
            </h1>
          </div>

          <div className="flex items-center gap-2">
            <span className={`text-xs ${currentTheme.textPrimary} font-bold ${currentTheme.cardBg} px-3.5 py-1.5 rounded-full border ${currentTheme.cardBorder} shadow-md`}>
              {new Date().toLocaleDateString('zh-CN', { month: 'numeric', day: 'numeric', weekday: 'short' })}
            </span>
          </div>
        </header>

        {/* 分区滑动轨道：五分区常驻，跟手拖拽 + 吸附过渡（滑动丝滑的关键） */}
        <main className="flex-1 min-h-0 overflow-hidden">
          <div
            ref={trackRef}
            className="flex h-full"
            style={{ width: `${TAB_ORDER.length * 100}%` }}
            onTouchStart={handleTouchStart}
            onTouchMove={handleTouchMove}
            onTouchEnd={handleTouchEnd}
            onTouchCancel={handleTouchEnd}
          >
            {TAB_ORDER.map((id) => (
              <div
                key={id}
                className="h-full overflow-y-auto no-scrollbar"
                style={{ width: `${100 / TAB_ORDER.length}%` }}
              >
                <div className="p-4 space-y-4 pb-32">
                  {id === 'today' && (
                    <TodayTab
                      records={records}
                      userProfile={userProfile}
                      onOpenActiveSleep={() => setIsActiveSleepOpen(true)}
                      onOpenManualLog={() => setIsManualLogOpen(true)}
                      onUpdateProfile={(updated) => setUserProfile((prev) => ({ ...prev, ...updated }))}
                      startSignal={sleepStartSignal}
                      onNavigateToTrends={() => setActiveTab('trends')}
                      onSaveRecord={handleSaveManualRecord}
                      theme={currentTheme}
                    />
                  )}

                  {id === 'trends' && (
                    <TrendsTab
                      records={records}
                      onDeleteRecord={handleDeleteRecord}
                      theme={currentTheme}
                    />
                  )}

                  {id === 'coach' && (
                    <AIAdvicePanel records={records} userProfile={userProfile} theme={currentTheme} />
                  )}

                  {id === 'eyecare' && (
                    <EyeCareTab
                      userProfile={userProfile}
                      onUpdateProfile={(updated) => setUserProfile((prev) => ({ ...prev, ...updated }))}
                      onToast={showToast}
                      theme={currentTheme}
                    />
                  )}

                  {id === 'settings' && (
                    <SettingsTab
                      records={records}
                      userProfile={userProfile}
                      onUpdateProfile={(updated) => setUserProfile((prev) => ({ ...prev, ...updated }))}
                      onResetDemoData={handleResetDemoData}
                      onImportRecords={(imported) => {
                        setRecords(imported);
                        showToast(`已成功导入 ${imported.length} 条睡眠记录`);
                      }}
                      theme={currentTheme}
                    />
                  )}
                </div>
              </div>
            ))}
          </div>
        </main>
      </div>

      {/* Bottom Navigation: Permanently fixed at screen bottom with theme styles */}
      <BottomNavBar
        activeTab={activeTab}
        onChangeTab={setActiveTab}
        theme={currentTheme}
      />

      {/* Floating Active Sleep Modal (Live Bedside Monitor) */}
      <ActiveSleepModal
        isOpen={isActiveSleepOpen}
        onClose={() => setIsActiveSleepOpen(false)}
        onFinishSleep={handleSaveActiveSleep}
        theme={currentTheme}
        targetDurationHours={userProfile.targetDurationHours}
      />

      {/* Manual Sleep Log Modal */}
      <ManualLogModal
        isOpen={isManualLogOpen}
        onClose={() => setIsManualLogOpen(false)}
        onSaveRecord={handleSaveManualRecord}
        theme={currentTheme}
        targetDurationHours={userProfile.targetDurationHours}
      />
    </div>
  );
};

export default App;
