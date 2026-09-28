package com.somnacare.gemmallm;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Context;
import android.content.Intent;
import android.graphics.PixelFormat;
import android.os.Build;
import android.os.IBinder;
import android.provider.Settings;
import android.view.Gravity;
import android.view.View;
import android.view.WindowManager;

/**
 * 全局护眼滤镜前台服务（参考"夜间护眼"类应用的核心机制）：
 * 在所有应用之上叠加两层不可触摸、可穿透输入的悬浮窗——
 *   1) 暖色滤镜层：可调色温 + 强度（减蓝光）
 *   2) 减光层：纯黑 + 透明度（软件减光）
 *
 * 性能与稳定性关键：
 * - 参数更新走"原地更新"（ setBackgroundColor 改预乘 ARGB ），绝不销毁重建窗口，
 *   拖动滑杆时无闪烁、无窗口抖动；
 * - 输入穿透：FLAG_NOT_TOUCHABLE | FLAG_NOT_FOCUSABLE（不用 FLAG_LAYOUT_NO_LIMITS，
 *   部分国产 ROM 上该 flag 会有系统手势/输入异常）；
 * - 前台通知三级降级 + 全量 try/catch，任何失败都不允许带崩进程。
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
        try {
            String action = intent != null ? intent.getAction() : ACTION_APPLY;
            if (ACTION_STOP.equals(action)) {
                removeOverlayInternal();
                stopForeground(STOP_FOREGROUND_REMOVE);
                stopSelf();
                return START_NOT_STICKY;
            }

            String warmColor = intent != null ? intent.getStringExtra(EXTRA_WARM_COLOR) : null;
            float warmAlpha = intent != null ? clamp01(intent.getFloatExtra(EXTRA_WARM_ALPHA, 0f)) : 0f;
            float dimAlpha = intent != null ? clamp01(intent.getFloatExtra(EXTRA_DIM_ALPHA, 0f)) : 0f;

            startForegroundCompat();
            applyOverlay(this, warmColor, warmAlpha, dimAlpha);
        } catch (Exception ignored) {
            // 服务内任何异常都不允许带崩应用进程
        }
        return START_NOT_STICKY;
    }

    private static float clamp01(float v) {
        return Math.min(1f, Math.max(0f, v));
    }

    /** 颜色 + 透明度 → 预乘进 ARGB 的 int（避免 View.setAlpha 触发离屏合成） */
    private static int argb(float alpha, int rgb) {
        int a = Math.round(clamp01(alpha) * 255f);
        return (a << 24) | (rgb & 0x00FFFFFF);
    }

    private static int parseSafe(String hex, int fallbackRgb) {
        if (hex == null || hex.length() < 7 || !hex.startsWith("#")) return fallbackRgb;
        try {
            return android.graphics.Color.parseColor(hex) & 0x00FFFFFF;
        } catch (Exception e) {
            return fallbackRgb;
        }
    }

    /** 应用（或原地更新）两层滤镜。静态方法：插件可在服务存活前直接调用。 */
    public static void applyOverlay(Context context, String warmColorHex, float warmAlpha, float dimAlpha) {
        if (!Settings.canDrawOverlays(context)) return;
        try {
            WindowManager wm = (WindowManager) context.getSystemService(Context.WINDOW_SERVICE);
            if (wm == null) return;
            windowManager = wm;

            int warmArgb = argb(clamp01(warmAlpha), parseSafe(warmColorHex, 0xFFB26B));
            int dimArgb = argb(clamp01(dimAlpha), 0x000000);

            // 暖色层：存在则原地更新，缺失则创建，透明则移除（零窗口抖动）
            if (warmAlpha > 0.005f) {
                if (warmLayer != null) {
                    warmLayer.setBackgroundColor(warmArgb);
                } else {
                    warmLayer = buildLayer(context, wm, warmArgb);
                    if (warmLayer == null && dimLayer == null) return;
                }
            } else if (warmLayer != null) {
                removeViewSafe(warmLayer);
                warmLayer = null;
            }

            // 减光层
            if (dimAlpha > 0.005f) {
                if (dimLayer != null) {
                    dimLayer.setBackgroundColor(dimArgb);
                } else {
                    dimLayer = buildLayer(context, wm, dimArgb);
                }
            } else if (dimLayer != null) {
                removeViewSafe(dimLayer);
                dimLayer = null;
            }
        } catch (Exception ignored) {
            // 悬浮窗应用失败不抛出，保持进程存活
        }
    }

    private static View buildLayer(Context context, WindowManager wm, int argbColor) {
        try {
            View v = new View(context);
            v.setBackgroundColor(argbColor);
            WindowManager.LayoutParams lp = new WindowManager.LayoutParams(
                    WindowManager.LayoutParams.MATCH_PARENT,
                    WindowManager.LayoutParams.MATCH_PARENT,
                    WindowManager.LayoutParams.TYPE_APPLICATION_OVERLAY,
                    WindowManager.LayoutParams.FLAG_NOT_TOUCHABLE
                            | WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE
                            | WindowManager.LayoutParams.FLAG_LAYOUT_IN_SCREEN
                            | WindowManager.LayoutParams.FLAG_HARDWARE_ACCELERATED,
                    PixelFormat.TRANSLUCENT);
            lp.gravity = Gravity.TOP | Gravity.START;
            wm.addView(v, lp);
            return v;
        } catch (Exception e) {
            return null;
        }
    }

    private static void removeViewSafe(View v) {
        if (windowManager == null || v == null) return;
        try {
            windowManager.removeView(v);
        } catch (Exception ignored) {
        }
    }

    /** 移除滤镜层（保留服务/通知）。 */
    public static void removeOverlay(Context context) {
        removeOverlayInternal();
    }

    private static void removeOverlayInternal() {
        removeViewSafe(warmLayer);
        removeViewSafe(dimLayer);
        warmLayer = null;
        dimLayer = null;
    }

    /** 前台通知：三级降级（specialUse 类型 → 普通前台 → 仅通知），确保不抛异常。 */
    private void startForegroundCompat() {
        try {
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
                    .setSmallIcon(android.R.drawable.ic_menu_close_clear_cancel)
                    .setContentTitle("护眼滤镜运行中")
                    .setContentText("极光睡眠正在为屏幕减蓝光")
                    .addAction(new Notification.Action.Builder(
                            null, "关闭护眼", stopPi).build())
                    .setOngoing(true)
                    .setOnlyAlertOnce(true)
                    .build();

            if (Build.VERSION.SDK_INT >= 34) {
                try {
                    startForeground(NOTIFICATION_ID, notif,
                            android.content.pm.ServiceInfo.FOREGROUND_SERVICE_TYPE_SPECIAL_USE);
                    return;
                } catch (Exception ignored) {
                }
            }
            try {
                startForeground(NOTIFICATION_ID, notif);
            } catch (Exception ignored) {
            }
        } catch (Exception ignored) {
            // 通知构建失败也不允许崩溃；滤镜层照常工作
        }
    }

    @Override
    public void onDestroy() {
        // 服务销毁时兜底移除滤镜，避免残留色层
        try {
            removeOverlayInternal();
        } catch (Exception ignored) {
        }
        super.onDestroy();
    }
}
