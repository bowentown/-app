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
import android.graphics.Typeface;
import android.graphics.drawable.GradientDrawable;
import android.os.Build;
import android.os.IBinder;
import android.provider.Settings;
import android.util.TypedValue;
import android.view.Gravity;
import android.view.View;
import android.view.WindowManager;
import android.widget.Button;
import android.widget.LinearLayout;
import android.widget.TextView;

/**
 * 作息目标到点的全局悬浮提醒服务（用户在其他应用或桌面时也能弹出）。
 * 视觉：深空渐变底 + 月亮 + "夜深喽，该睡了"（应要求不含品牌标语），
 * 入场淡入 + 缩放动画。
 * "好的" → 关闭提醒、启动应用并携带自动开始监测标记（JS 侧经
 * bedtimeAutoStartConsume / bedtimeGood 事件接续）；
 * "无视" → 仅关闭提醒，不做任何变化。
 */
public class BedtimeOverlayService extends Service {

    private static final String CHANNEL_ID = "somnacare-bedtime";
    private static final int NOTIFICATION_ID = 20260929;
    private static View overlay;
    private static WindowManager wmRef;

    @Override
    public IBinder onBind(Intent intent) {
        return null;
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        try {
            startForegroundCompat();
            showOverlay();
        } catch (Exception ignored) {
        }
        return START_NOT_STICKY;
    }

    private int dp(float v) {
        return Math.round(v * getResources().getDisplayMetrics().density);
    }

    private void showOverlay() {
        if (!Settings.canDrawOverlays(this)) {
            fallbackNotification();
            stopSelf();
            return;
        }
        if (overlay != null) return; // 已在显示

        WindowManager wm = (WindowManager) getSystemService(Context.WINDOW_SERVICE);
        if (wm == null) return;
        wmRef = wm;

        LinearLayout root = new LinearLayout(this);
        root.setOrientation(LinearLayout.VERTICAL);
        root.setGravity(Gravity.CENTER);
        GradientDrawable bg = new GradientDrawable(GradientDrawable.Orientation.TOP_BOTTOM,
                new int[]{0xF2060B1A, 0xF203060F});
        root.setBackground(bg);
        root.setPadding(dp(28), dp(28), dp(28), dp(28));

        TextView moon = new TextView(this);
        moon.setText("🌙");
        moon.setTextSize(TypedValue.COMPLEX_UNIT_SP, 76);
        moon.setGravity(Gravity.CENTER);
        moon.setScaleX(0.5f);
        moon.setScaleY(0.5f);
        root.addView(moon);

        TextView msg = new TextView(this);
        msg.setText("夜深喽，该睡了");
        msg.setTextColor(Color.WHITE);
        msg.setTextSize(TypedValue.COMPLEX_UNIT_SP, 24);
        msg.setTypeface(Typeface.DEFAULT_BOLD);
        msg.setGravity(Gravity.CENTER);
        msg.setPadding(0, dp(30), 0, 0);
        root.addView(msg);

        LinearLayout row = new LinearLayout(this);
        row.setOrientation(LinearLayout.HORIZONTAL);
        row.setGravity(Gravity.CENTER);
        row.setPadding(0, dp(40), 0, 0);

        Button ok = new Button(this);
        ok.setText("好的");
        ok.setTextColor(0xFF0B1220);
        ok.setTextSize(TypedValue.COMPLEX_UNIT_SP, 15);
        ok.setTypeface(Typeface.DEFAULT_BOLD);
        ok.setAllCaps(false);
        GradientDrawable okBg = new GradientDrawable(GradientDrawable.Orientation.LEFT_RIGHT,
                new int[]{0xFF38BDF8, 0xFF3B82F6});
        okBg.setCornerRadius(dp(18));
        ok.setBackground(okBg);
        ok.setPadding(dp(36), dp(12), dp(36), dp(12));
        LinearLayout.LayoutParams okLp = new LinearLayout.LayoutParams(
                LinearLayout.LayoutParams.WRAP_CONTENT, LinearLayout.LayoutParams.WRAP_CONTENT);
        okLp.setMargins(dp(8), 0, dp(8), 0);
        ok.setLayoutParams(okLp);
        row.addView(ok);

        Button ignore = new Button(this);
        ignore.setText("无视");
        ignore.setTextColor(0xFFCBD5E1);
        ignore.setTextSize(TypedValue.COMPLEX_UNIT_SP, 15);
        ignore.setTypeface(Typeface.DEFAULT_BOLD);
        ignore.setAllCaps(false);
        GradientDrawable igBg = new GradientDrawable();
        igBg.setColor(0x14000000);
        igBg.setCornerRadius(dp(18));
        igBg.setStroke(dp(1), 0x26FFFFFF);
        ignore.setBackground(igBg);
        ignore.setPadding(dp(36), dp(12), dp(36), dp(12));
        LinearLayout.LayoutParams igLp = new LinearLayout.LayoutParams(
                LinearLayout.LayoutParams.WRAP_CONTENT, LinearLayout.LayoutParams.WRAP_CONTENT);
        igLp.setMargins(dp(8), 0, dp(8), 0);
        ignore.setLayoutParams(igLp);
        row.addView(ignore);

        root.addView(row);
        root.setAlpha(0f);

        WindowManager.LayoutParams lp = new WindowManager.LayoutParams(
                WindowManager.LayoutParams.MATCH_PARENT,
                WindowManager.LayoutParams.MATCH_PARENT,
                WindowManager.LayoutParams.TYPE_APPLICATION_OVERLAY,
                WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE
                        | WindowManager.LayoutParams.FLAG_LAYOUT_IN_SCREEN,
                PixelFormat.TRANSLUCENT);
        lp.gravity = Gravity.TOP | Gravity.START;

        try {
            wm.addView(root, lp);
            overlay = root;
            root.animate().alpha(1f).setDuration(360).start();
            moon.animate().scaleX(1f).scaleY(1f).setDuration(600).setStartDelay(120).start();
        } catch (Exception e) {
            overlay = null;
            fallbackNotification();
            stopSelf();
            return;
        }

        ok.setOnClickListener(v -> {
            try {
                // 记录标记（冷启动路径）+ 拉起应用（热启动路径：经 onNewIntent → bedtimeGood 事件）
                getSharedPreferences("somnacare_prefs", Context.MODE_PRIVATE)
                        .edit().putBoolean("auto_start_sleep", true).apply();
                Intent launch = getPackageManager().getLaunchIntentForPackage(getPackageName());
                if (launch != null) {
                    launch.putExtra("somnacare_auto_start_sleep", true);
                    launch.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                    startActivity(launch);
                }
            } catch (Exception ignored) {
            }
            dismiss();
        });
        ignore.setOnClickListener(v -> dismiss());
    }

    private void dismiss() {
        try {
            if (overlay != null && wmRef != null) {
                overlay.animate().alpha(0f).setDuration(220).start();
                View v = overlay;
                // 动画结束后移除
                new android.os.Handler(android.os.Looper.getMainLooper()).postDelayed(() -> {
                    try {
                        wmRef.removeView(v);
                    } catch (Exception ignored) {
                    }
                    overlay = null;
                    stopForeground(STOP_FOREGROUND_REMOVE);
                    stopSelf();
                }, 240);
                return;
            }
            stopForeground(STOP_FOREGROUND_REMOVE);
            stopSelf();
        } catch (Exception ignored) {
        }
    }

    /** 无悬浮窗权限时的兜底：普通高优先级通知（点击拉起应用）。 */
    private void fallbackNotification() {
        try {
            NotificationManager nm = (NotificationManager) getSystemService(NOTIFICATION_SERVICE);
            if (nm != null && nm.getNotificationChannel(CHANNEL_ID) == null) {
                NotificationChannel ch = new NotificationChannel(CHANNEL_ID, "就寝提醒",
                        NotificationManager.IMPORTANCE_HIGH);
                nm.createNotificationChannel(ch);
            }
            Intent launch = getPackageManager().getLaunchIntentForPackage(getPackageName());
            PendingIntent pi = launch != null
                    ? PendingIntent.getActivity(this, 3002, launch,
                            PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE)
                    : null;
            Notification.Builder builder = Build.VERSION.SDK_INT >= 26
                    ? new Notification.Builder(this, CHANNEL_ID)
                    : new Notification.Builder(this);
            Notification notif = builder
                    .setSmallIcon(android.R.drawable.ic_lock_idle_alarm)
                    .setContentTitle("夜深喽，该睡了")
                    .setContentText("距你的作息目标就寝时间已到")
                    .setContentIntent(pi)
                    .setAutoCancel(true)
                    .build();
            nm.notify(NOTIFICATION_ID + 1, notif);
        } catch (Exception ignored) {
        }
    }

    private void startForegroundCompat() {
        try {
            NotificationManager nm = (NotificationManager) getSystemService(NOTIFICATION_SERVICE);
            if (nm != null && nm.getNotificationChannel(CHANNEL_ID) == null) {
                NotificationChannel ch = new NotificationChannel(CHANNEL_ID, "就寝提醒",
                        NotificationManager.IMPORTANCE_LOW);
                ch.setShowBadge(false);
                nm.createNotificationChannel(ch);
            }
            Notification.Builder builder = Build.VERSION.SDK_INT >= 26
                    ? new Notification.Builder(this, CHANNEL_ID)
                    : new Notification.Builder(this);
            Notification notif = builder
                    .setSmallIcon(android.R.drawable.ic_lock_idle_alarm)
                    .setContentTitle("就寝提醒待确认")
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
        }
    }

    @Override
    public void onDestroy() {
        try {
            if (overlay != null && wmRef != null) {
                wmRef.removeView(overlay);
            }
        } catch (Exception ignored) {
        }
        overlay = null;
        super.onDestroy();
    }
}
