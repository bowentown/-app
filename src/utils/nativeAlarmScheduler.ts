import { CustomAlarmSetting } from '../types/sleep';

/**
 * 原生 Android 进程级通知与闹钟调度器 (基于 Capacitor LocalNotifications)
 * - 当在 APK (Capacitor 原生环境) 运行时：调度进程级精确通知，即使应用被杀或息屏，由 Android 系统底层唤醒响铃；
 * - 当在 Web/PWA 环境运行时：保留优雅降级提示，引导安装 APK，同时利用 Web Audio 前台兜底。
 */

interface CapacitorLocalNotificationsPlugin {
  checkPermissions: () => Promise<{ display: string }>;
  requestPermissions: () => Promise<{ display: string }>;
  schedule: (options: { notifications: any[] }) => Promise<any>;
  cancel: (options: { notifications: { id: number }[] }) => Promise<any>;
  getPending: () => Promise<{ notifications: any[] }>;
}

function getCapacitor(): any {
  return (window as any).Capacitor;
}

export function isNativePlatform(): boolean {
  const cap = getCapacitor();
  return !!(cap && typeof cap.isNativePlatform === 'function' && cap.isNativePlatform());
}

export async function requestAlarmPermissions(): Promise<boolean> {
  const cap = getCapacitor();
  if (!isNativePlatform() || !cap?.Plugins?.LocalNotifications) {
    return false;
  }
  try {
    const plugin: CapacitorLocalNotificationsPlugin = cap.Plugins.LocalNotifications;
    const current = await plugin.checkPermissions();
    if (current.display !== 'granted') {
      const res = await plugin.requestPermissions();
      return res.display === 'granted';
    }
    return true;
  } catch (err) {
    console.warn('[NativeAlarm] 权限检查或请求异常:', err);
    return false;
  }
}

/**
 * 为单个闹钟分配稳定的数字 ID（以支持原生 Notification id）
 */
function hashStringToInt(str: string): number {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = (hash << 5) - hash + str.charCodeAt(i);
    hash |= 0;
  }
  return Math.abs(hash) % 1000000;
}

/**
 * 将启用的闹钟集合全量同步到 Android 系统级通知调度队列
 */
export async function syncAlarmsToNative(alarms: CustomAlarmSetting[]): Promise<{ success: boolean; nativeScheduledCount: number }> {
  if (!isNativePlatform()) {
    return { success: false, nativeScheduledCount: 0 };
  }

  const cap = getCapacitor();
  const plugin: CapacitorLocalNotificationsPlugin = cap?.Plugins?.LocalNotifications;
  if (!plugin) {
    return { success: false, nativeScheduledCount: 0 };
  }

  try {
    // 1. 取消已挂起的历史通知，防止重复堆叠
    const pending = await plugin.getPending();
    if (pending?.notifications?.length > 0) {
      await plugin.cancel({
        notifications: pending.notifications.map((n) => ({ id: n.id })),
      });
    }

    const enabledAlarms = alarms.filter((a) => a.enabled);
    if (enabledAlarms.length === 0) {
      return { success: true, nativeScheduledCount: 0 };
    }

    const notificationsToSchedule: any[] = [];

    for (const alarm of enabledAlarms) {
      const [h, m] = alarm.time.split(':').map(Number);
      const baseId = hashStringToInt(alarm.id);

      // 单次闹钟 (无重复日)
      if (!alarm.repeatDays || alarm.repeatDays.length === 0) {
        const targetDate = new Date();
        targetDate.setHours(h, m, 0, 0);
        // 如果今天设定时间已过，推算到明天
        if (targetDate.getTime() <= Date.now()) {
          targetDate.setDate(targetDate.getDate() + 1);
        }

        notificationsToSchedule.push({
          id: baseId,
          title: `⏰ 极光唤醒：${alarm.label || '早晨唤醒'}`,
          body: `现在是 ${alarm.time}，起床时间到啦！愿您今日神采奕奕。`,
          schedule: {
            at: targetDate,
            allowWhileIdle: true,
          },
          extra: { alarmId: alarm.id },
        });
      } else {
        // 重复闹钟 (星期 1-7, 对应 Capacitor weekday 2-7, 1)
        // Capacitor weekday: 1 = Sunday, 2 = Monday, ... 7 = Saturday
        alarm.repeatDays.forEach((isoDay, index) => {
          const capacitorWeekday = isoDay === 7 ? 1 : isoDay + 1;
          notificationsToSchedule.push({
            id: baseId + (index + 1) * 100,
            title: `⏰ 极光唤醒：${alarm.label || '早晨唤醒'}`,
            body: `现在是 ${alarm.time}，起床时间到啦！`,
            schedule: {
              on: {
                weekday: capacitorWeekday,
                hour: h,
                minute: m,
              },
              allowWhileIdle: true,
            },
            extra: { alarmId: alarm.id, isoDay },
          });
        });
      }
    }

    if (notificationsToSchedule.length > 0) {
      await plugin.schedule({ notifications: notificationsToSchedule });
    }

    return { success: true, nativeScheduledCount: notificationsToSchedule.length };
  } catch (err) {
    console.error('[NativeAlarm] 同步原生闹钟失败:', err);
    return { success: false, nativeScheduledCount: 0 };
  }
}
