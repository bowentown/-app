import React, { useState, useEffect } from 'react';
import {
  Moon,
  CheckCircle2,
} from 'lucide-react';
import { SleepRecord, UserProfile } from './types/sleep';
import { getInitialSleepLogs } from './utils/sleepScore';
import { TodayTab } from './components/TodayTab';
import { TrendsTab } from './components/TrendsTab';
import { AIAdvicePanel } from './components/AIAdvicePanel';
import { SettingsTab } from './components/SettingsTab';
import { BottomNavBar, NavTab } from './components/BottomNavBar';
import { ActiveSleepModal } from './components/ActiveSleepModal';
import { ManualLogModal } from './components/ManualLogModal';
import { APP_THEMES } from './utils/themeStyles';
import { isNativePlatform, syncAlarmsToNative } from './utils/nativeAlarmScheduler';

export const App: React.FC = () => {
  const [activeTab, setActiveTab] = useState<NavTab>('today');
  const [isActiveSleepOpen, setIsActiveSleepOpen] = useState(false);
  const [isManualLogOpen, setIsManualLogOpen] = useState(false);
  const [toastMessage, setToastMessage] = useState<string | null>(null);

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
        return JSON.parse(saved);
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
          label: '工作日温和唤醒',
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
    showToast(`🌙 记录已保存！本次睡眠实测时长 ${newRecord.durationMinutes < 60 ? `${newRecord.durationMinutes}分钟` : `${(newRecord.durationMinutes / 60).toFixed(1)}小时`}`);
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
      className={`min-h-screen w-full ${currentTheme.pageBg} ${currentTheme.textPrimary} selection:bg-indigo-500/30 relative flex flex-col transition-colors duration-300`}
    >
      {/* Toast Notification */}
      {toastMessage && (
        <div className="fixed top-5 left-1/2 -translate-x-1/2 z-[90] px-5 py-3 rounded-2xl bg-indigo-600 text-white text-xs font-black shadow-2xl flex items-center gap-2.5 animate-bounce border border-indigo-400">
          <CheckCircle2 className="w-5 h-5 text-indigo-200" />
          <span>{toastMessage}</span>
        </div>
      )}

      {/* Main Content Area: Natural Vertical Page Scroll (Header flows with content) */}
      <div className="w-full flex-1 max-w-lg mx-auto flex flex-col">
        {/* Scrollable Mobile Header */}
        <header className={`px-5 pt-5 pb-3.5 flex items-center justify-between border-b ${currentTheme.cardBorder} shrink-0`}>
          <div className="flex items-center gap-2.5">
            <div className="w-9 h-9 rounded-2xl bg-indigo-600 text-white flex items-center justify-center shadow-md">
              <Moon className="w-5 h-5 fill-white/40" />
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

        {/* Tab View Container */}
        <main className="p-4 space-y-4 flex-1">
          {activeTab === 'today' && (
            <TodayTab
              records={records}
              userProfile={userProfile}
              onOpenActiveSleep={() => setIsActiveSleepOpen(true)}
              onOpenManualLog={() => setIsManualLogOpen(true)}
              onNavigateToCoach={() => setActiveTab('coach')}
              onSaveRecord={handleSaveManualRecord}
              theme={currentTheme}
            />
          )}

          {activeTab === 'trends' && (
            <TrendsTab
              records={records}
              onDeleteRecord={handleDeleteRecord}
              theme={currentTheme}
            />
          )}

          {activeTab === 'coach' && (
            <AIAdvicePanel records={records} userProfile={userProfile} theme={currentTheme} />
          )}

          {activeTab === 'settings' && (
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
      />

      {/* Manual Sleep Log Modal */}
      <ManualLogModal
        isOpen={isManualLogOpen}
        onClose={() => setIsManualLogOpen(false)}
        onSaveRecord={handleSaveManualRecord}
        theme={currentTheme}
      />
    </div>
  );
};

export default App;
