package com.somnacare.gemmallm;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;

/**
 * 开机完成：重排睡前提醒闹钟。
 * AlarmManager 的闹钟不跨重启存活，此前 RECEIVE_BOOT_COMPLETED 权限声明了
 * 却没有接收器——重启后到点提醒永久失效，直到用户手动打开一次 App。
 * 启用标志由 bedtimeReminderSchedule/Cancel 在每次 App 启动时同步进 prefs。
 */
public class BootReceiver extends BroadcastReceiver {
    @Override
    public void onReceive(Context context, Intent intent) {
        if (!Intent.ACTION_BOOT_COMPLETED.equals(intent.getAction())) return;
        try {
            android.content.SharedPreferences sp =
                    context.getSharedPreferences("somnacare_prefs", Context.MODE_PRIVATE);
            if (sp.getBoolean("bedtime_reminder_on", false)) {
                GemmaLLMPlugin.scheduleBedtimeAlarm(context);
            }
        } catch (Exception ignored) {
        }
    }
}
