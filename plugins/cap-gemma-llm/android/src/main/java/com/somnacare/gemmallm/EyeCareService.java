package com.somnacare.gemmallm;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Context;
import android.content.Intent;
import android.graphics.Color;
import android.graphics.PixelFormat;
import android.os.Build;
import android.os.IBinder;
import android.provider.Settings;
import android.view.Gravity;
import android.view.View;
import android.view.WindowManager;

/**
 * 全局护眼滤镜前台服务（参考主流"夜间护眼"类应用的实现机制）：
 * 在所有应用之上叠加两层不可触摸的悬浮窗——
 *   1) 暖色滤镜层：可调色温颜色 + 强度（减蓝光）
 *   2) 减光层：纯黑 + 透明度（软件减光）
 * 前台通知保证进程不被后台回收，通知带"关闭护眼"快捷动作。
 * 滤镜参数由 JS 侧经 GemmaLLM 插件下发（start/update 均走 ACTION_APPLY）。
 */
public class EyeCareService extends Service {

    public static final String ACTION_APPLY = "com.somnacare.gemmallm.eyecare.APPLY";
    public static final String ACTION_STOP = "com.somnacare.gemmallm.eyecare.STOP";
    public static final String EXTRA_WARM_COLOR = "warmColor"; // #RRGGBB
    public static final String EXTRA_WARM_ALPHA = "warmAlpha"; // 0.0 - 1.0
    public static final String EXTRA_DIM_ALPHA = "dimAlpha";   // 0.0 - 1.0

    private static final String CHANNEL_ID = "somnacare-eyecare";
    private static final int NOTIFICATION_ID = 20260928;

    private static View warmLayer;
    private static View dimLayer;
    private static WindowManager windowManager;

    @Override
    public IBinder onBind(Intent intent) {
        return null;
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        String action = intent != null ? intent.getAction() : null;
        if (ACTION_STOP.equals(action)) {
            removeOverlay(this);
            stopForeground(STOP_FOREGROUND_REMOVE);
            stopSelf();
            return START_NOT_STICKY;
        }

        // ACTION_APPLY / 首次启动：应用参数并确保前台通知
        String warmColor = intent != null ? intent.getStringExtra(EXTRA_WARM_COLOR) : null;
        float warmAlpha = intent != null ? intent.getFloatExtra(EXTRA_WARM_ALPHA, 0f) : 0f;
        float dimAlpha = intent != null ? intent.getFloatExtra(EXTRA_DIM_ALPHA, 0f) : 0f;
        startForegroundCompat();
        applyOverlay(this, warmColor, warmAlpha, dimAlpha);
        return START_STICKY;
    }

    /** 应用（或更新）两层滤镜。静态方法：插件在服务存活前也可直接调用。 */
    public static void applyOverlay(Service service, String warmColorHex, float warmAlpha, float dimAlpha) {
        if (!Settings.canDrawOverlays(service)) return;
        WindowManager wm = (WindowManager) service.getSystemService(Context.WINDOW_SERVICE);
        if (wm == null) return;
        windowManager = wm;

        int warmColor = parseSafe(warmColorHex, 0xFFB26B);
        // 先移除旧层，再按新参数重建（简单可靠，切换参数时无闪烁问题可忽略）
        removeOverlayInternal();

        if (warmAlpha > 0.005f) {
            warmLayer = buildLayer(service, wm, (255 << 24) | (Color.red(warmColor) << 16)
                    | (Color.green(warmColor) << 8) | Color.blue(warmColor),
                    Math.min(0.6f, Math.max(0f, warmAlpha)));
        }
        if (dimAlpha > 0.005f) {
            dimLayer = buildLayer(service, wm, 0xFF000000, Math.min(0.7f, Math.max(0f, dimAlpha)));
        }
    }

    private static View buildLayer(Service service, WindowManager wm, int color, float alpha) {
        View v = new View(service);
        v.setBackgroundColor(color);
        v.setAlpha(alpha);
        WindowManager.LayoutParams lp = new WindowManager.LayoutParams(
                WindowManager.LayoutParams.MATCH_PARENT,
                WindowManager.LayoutParams.MATCH_PARENT,
                WindowManager.LayoutParams.TYPE_APPLICATION_OVERLAY,
                WindowManager.LayoutParams.FLAG_NOT_TOUCHABLE
                        | WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE
                        | WindowManager.LayoutParams.FLAG_LAYOUT_IN_SCREEN
                        | WindowManager.LayoutParams.FLAG_LAYOUT_NO_LIMITS
                        | WindowManager.LayoutParams.FLAG_HARDWARE_ACCELERATED,
                PixelFormat.TRANSLUCENT);
        lp.gravity = Gravity.TOP | Gravity.START;
        try {
            wm.addView(v, lp);
        } catch (Exception ignored) {
            return null;
        }
        return v;
    }

    /** 移除滤镜层（保留服务）。 */
    public static void removeOverlay(Context context) {
        removeOverlayInternal();
    }

    private static void removeOverlayInternal() {
        if (windowManager != null) {
            if (warmLayer != null) {
                try { windowManager.removeView(warmLayer); } catch (Exception ignored) {}
                warmLayer = null;
            }
            if (dimLayer != null) {
                try { windowManager.removeView(dimLayer); } catch (Exception ignored) {}
                dimLayer = null;
            }
        }
    }

    private void startForegroundCompat() {
        NotificationManager nm = (NotificationManager) getSystemService(NOTIFICATION_SERVICE);
        if (nm != null && nm.getNotificationChannel(CHANNEL_ID) == null) {
            NotificationChannel ch = new NotificationChannel(CHANNEL_ID, "护眼滤镜",
                    NotificationManager.IMPORTANCE_LOW);
            ch.setDescription("护眼滤镜运行时常驻通知");
            ch.setShowBadge(false);
            nm.createNotificationChannel(ch);
        }

        Intent stopIntent = new Intent(this, EyeCareService.class).setAction(ACTION_STOP);
        PendingIntent stopPi = PendingIntent.getService(this, 1, stopIntent,
                PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);

        Notification.Builder builder = Build.VERSION.SDK_INT >= 26
                ? new Notification.Builder(this, CHANNEL_ID)
                : new Notification.Builder(this);
        Notification notif = builder
                .setSmallIcon(getApplicationInfo().icon)
                .setContentTitle("护眼滤镜运行中")
                .setContentText("极光睡眠正在为屏幕减蓝光 · 点按关闭")
                .setContentIntent(stopPi)
                .addAction(new Notification.Action.Builder(
                        null, "关闭护眼", stopPi).build())
                .setOngoing(true)
                .setOnlyAlertOnce(true)
                .build();

        if (Build.VERSION.SDK_INT >= 34) {
            try {
                startForeground(NOTIFICATION_ID, notif,
                        android.content.pm.ServiceInfo.FOREGROUND_SERVICE_TYPE_SPECIAL_USE);
            } catch (Exception e) {
                startForeground(NOTIFICATION_ID, notif);
            }
        } else {
            startForeground(NOTIFICATION_ID, notif);
        }
    }

    private static int parseSafe(String hex, int fallback) {
        if (hex == null || hex.length() < 7 || !hex.startsWith("#")) return fallback;
        try {
            return Color.parseColor(hex);
        } catch (Exception e) {
            return fallback;
        }
    }

    @Override
    public void onDestroy() {
        // 服务销毁时兜底移除滤镜，避免残留色层
        removeOverlayInternal();
        super.onDestroy();
    }
}
