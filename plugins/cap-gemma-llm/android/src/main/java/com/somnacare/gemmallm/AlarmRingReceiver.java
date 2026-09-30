package com.somnacare.gemmallm;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;

/**
 * 闹钟精确到点广播：拉起 {@link AlarmRingService} 持续响铃。
 * 由 GemmaLLMPlugin.alarmRingSchedule 按用户闹钟表用 AlarmManager
 * setExactAndAllowWhileIdle 逐条调度（与 Capacitor 通知互相独立——
 * 通知负责横幅，本服务负责"不关就一直响"的声音与振动）。
 */
public class AlarmRingReceiver extends BroadcastReceiver {
    @Override
    public void onReceive(Context context, Intent intent) {
        try {
            Intent svc = new Intent(context, AlarmRingService.class);
            svc.putExtra("label", intent.getStringExtra("label"));
            svc.putExtra("time", intent.getStringExtra("time"));
            if (android.os.Build.VERSION.SDK_INT >= 26) {
                context.startForegroundService(svc);
            } else {
                context.startService(svc);
            }
        } catch (Exception ignored) {
        }
    }
}
