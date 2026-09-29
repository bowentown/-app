package com.somnacare.gemmallm;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.IntentFilter;
import android.graphics.PixelFormat;
import android.graphics.Typeface;
import android.graphics.drawable.GradientDrawable;
import android.os.Build;
import android.os.IBinder;
import android.provider.Settings;
import android.util.TypedValue;
import android.view.Gravity;
import android.view.MotionEvent;
import android.view.View;
import android.view.ViewConfiguration;
import android.view.WindowManager;
import android.widget.FrameLayout;
import android.widget.LinearLayout;
import android.widget.TextView;

/**
 * 鲸鱼娘桌宠悬浮窗：常驻其他应用之上，把五个分区压缩成一张速览卡。
 *
 * 两个独立窗口而不是一个大窗口：
 * - {@code petWindow}  只有角色，可拖拽，边缘吸附；尺寸小，不挡内容
 * - {@code panelWindow} 点角色才出现，贴着角色摆放；FLAG_WATCH_OUTSIDE_TOUCH
 *   让"点到卡外"能收到 ACTION_OUTSIDE 自动收起
 *
 * 之所以全部原生绘制、不过 WebView：应用已有 MediaPipe 端侧推理占用 WebView 内存预算，
 * 再挂一个 WebView 悬浮窗会重演此前的进程崩溃；且数据在 localStorage，原生也读不到，
 * 折中方案是 Web 侧把少量"文案快照"推入 SharedPreferences，原生只读快照。
 *
 * 触摸可达性：本服务是前台服务，满足 Android 12+ "可信触摸"豁免，
 * 因此角色窗可以正常接收事件而不必把窗口整体不透明度抬到 0.78。
 */
public class PetOverlayService extends Service {

    public static final String ACTION_START = "com.somnacare.gemmallm.pet.START";
    public static final String ACTION_STOP = "com.somnacare.gemmallm.pet.STOP";

    private static final String CHANNEL_ID = "somnacare-pet";
    private static final int NOTIFICATION_ID = 20260930;

    private static final String PREFS = "somnacare_prefs";
    // Web 侧推送的文案快照（原生只读，不反向解析业务数据）
    static final String K_STATUS = "pet_status";
    static final String K_ROW_TODAY = "pet_row_today";
    static final String K_ROW_SUB = "pet_row_sub";
    // 女仆播报词库（\n 分隔多条，逐条轮播）；K_BUBBLE_EVERY = 每 N 次点击播报 1 次
    static final String K_PET_SAY = "pet_say";
    static final String K_BUBBLE_EVERY = "pet_bubble_every";
    // 拉起 App 时要落的分区，由 Web 侧写入、App 读取后清除
    static final String K_PENDING_TAB = "somnacare_pending_tab";

    private static final int COLLAPSED_W_DP = 104;
    private static final int COLLAPSED_H_DP = 122;
    private static final int PANEL_W_DP = 264;
    private static final int PANEL_MAX_H_DP = 380;
    private static final int SNAP_MS = 200;

    private WindowManager wm;
    private FrameLayout petRoot;
    private FrameLayout panelRoot;
    private WhaleGirlView whale;
    private WindowManager.LayoutParams petParams;
    private final android.os.Handler main = new android.os.Handler(android.os.Looper.getMainLooper());

    private boolean expanded;
    private int touchSlop;
    private WindowManager.LayoutParams panelLp;

    // ---- 女仆播报气泡（与速览卡是两个窗口、两种动画）----
    private FrameLayout bubbleRoot;
    private WindowManager.LayoutParams bubbleLp;
    private boolean bubbleShown;
    private int tapCount;
    private int sayIdx;
    private final Runnable bubbleHide = new Runnable() {
        @Override public void run() { hideBubble(); }
    };

    // ---- 拖拽状态 ----
    private int downRawX, downRawY, downWinX, downWinY;
    private boolean dragging;

    private final BroadcastReceiver screenReceiver = new BroadcastReceiver() {
        @Override public void onReceive(Context c, Intent i) {
            boolean on = !Intent.ACTION_SCREEN_OFF.equals(i.getAction());
            if (whale != null) {
                if (on) whale.start(); else whale.stop();
            }
        }
    };

    @Override
    public IBinder onBind(Intent intent) {
        return null;
    }

    @Override
    public void onCreate() {
        super.onCreate();
        wm = (WindowManager) getSystemService(Context.WINDOW_SERVICE);
        touchSlop = ViewConfiguration.get(this).getScaledTouchSlop();
        ensureChannel();
        startForegroundCompat("点鲸鱼娘打开速览卡");
        IntentFilter f = new IntentFilter();
        f.addAction(Intent.ACTION_SCREEN_OFF);
        f.addAction(Intent.ACTION_SCREEN_ON);
        if (Build.VERSION.SDK_INT >= 33) {
            registerReceiver(screenReceiver, f, Context.RECEIVER_NOT_EXPORTED);
        } else {
            registerReceiver(screenReceiver, f);
        }
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        if (intent != null && ACTION_STOP.equals(intent.getAction())) {
            stopSelf();
            return START_NOT_STICKY;
        }
        if (!Settings.canDrawOverlays(this)) {
            stopSelf();
            return START_NOT_STICKY;
        }
        if (petRoot == null) {
            showPet();
        } else {
            // 幂等重启：刷新一次文案快照即可，不重建窗口
            refreshPanel();
        }
        return START_STICKY;
    }

    // ================= 角色窗 =================

    private void showPet() {
        try {
            android.content.SharedPreferences sp = getSharedPreferences(PREFS, Context.MODE_PRIVATE);

            petRoot = new FrameLayout(this);
            whale = new WhaleGirlView(this);
            petRoot.addView(whale, new FrameLayout.LayoutParams(
                    FrameLayout.LayoutParams.MATCH_PARENT, FrameLayout.LayoutParams.MATCH_PARENT));
            whale.start();

            petParams = new WindowManager.LayoutParams(
                    dp(COLLAPSED_W_DP), dp(COLLAPSED_H_DP),
                    WindowManager.LayoutParams.TYPE_APPLICATION_OVERLAY,
                    // 只加 NOT_FOCUSABLE：不能抢输入法。刻意不加 FLAG_LAYOUT_NO_LIMITS——
                    // 那个 flag 会把窗口原点推到显示区之外，x/y 就不再是屏幕坐标，
                    // 吸边与贴面板的位置计算会整体偏移。
                    WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE
                            | WindowManager.LayoutParams.FLAG_LAYOUT_IN_SCREEN
                            | WindowManager.LayoutParams.FLAG_HARDWARE_ACCELERATED,
                    PixelFormat.TRANSLUCENT);
            petParams.gravity = Gravity.TOP | Gravity.START;
            petParams.setTitle("鲸鱼娘");
            petParams.x = sp.getInt("pet_x", dp(12));
            petParams.y = sp.getInt("pet_y", dp(260));
            clampToScreen(petParams);

            petRoot.setOnTouchListener(new View.OnTouchListener() {
                @Override public boolean onTouch(View v, MotionEvent e) {
                    return handlePetTouch(e);
                }
            });

            wm.addView(petRoot, petParams);
            main.post(drowsyTick);
        } catch (Exception e) {
            petRoot = null;
            whale = null;
            stopSelf();
        }
    }

    private boolean handlePetTouch(MotionEvent e) {
        switch (e.getActionMasked()) {
            case MotionEvent.ACTION_DOWN:
                downRawX = (int) e.getRawX();
                downRawY = (int) e.getRawY();
                downWinX = petParams.x;
                downWinY = petParams.y;
                dragging = false;
                return true;
            case MotionEvent.ACTION_MOVE: {
                int dx = (int) e.getRawX() - downRawX;
                int dy = (int) e.getRawY() - downRawY;
                if (!dragging && Math.hypot(dx, dy) > touchSlop) {
                    dragging = true;
                    if (whale != null) whale.setDragging(true);
                }
                if (dragging) {
                    // 拖到面板开着时先收面板，避免角色与卡片错位
                    if (expanded) collapsePanel();
                    petParams.x = downWinX + dx;
                    petParams.y = downWinY + dy;
                    clampToScreen(petParams);
                    safeUpdate(petRoot, petParams);
                }
                return true;
            }
            case MotionEvent.ACTION_UP:
                if (dragging) {
                    if (whale != null) whale.setDragging(false);
                    dockToEdge();
                } else if (whale != null) {
                    whale.cheer();
                    if (bubbleShown) {
                        hideBubble();   // 播报期间再点：先收气泡，不叠加面板
                    } else {
                        tapCount++;
                        int every = getSharedPreferences(PREFS, Context.MODE_PRIVATE)
                                .getInt(K_BUBBLE_EVERY, 8);
                        if (every > 0 && tapCount % every == 0) showBubble();
                        else togglePanel();
                    }
                }
                return true;
            case MotionEvent.ACTION_CANCEL:
                if (dragging) {
                    if (whale != null) whale.setDragging(false);
                    dockToEdge();
                }
                return true;
            default:
                return true;
        }
    }

    /** 松手后横向吸附到最近的屏幕边缘，再持久化位置。 */
    private void dockToEdge() {
        final int targetX;
        DisplayInfo di = displayInfo();
        int left = dp(4);
        int right = di.width - dp(COLLAPSED_W_DP) - dp(4);
        targetX = (petParams.x + dp(COLLAPSED_W_DP) / 2) < di.width / 2 ? left : right;
        petParams.x = targetX;
        clampToScreen(petParams);
        safeUpdate(petRoot, petParams);
        getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit()
                .putInt("pet_x", petParams.x)
                .putInt("pet_y", petParams.y)
                .apply();
    }

    // ================= 速览面板 =================

    private void togglePanel() {
        if (expanded) collapsePanel(); else expandPanel();
    }

    private void expandPanel() {
        if (panelRoot != null) {
            panelRoot.setVisibility(View.VISIBLE);
            refreshPanel();
            placePanel(panelRoot);
            safeUpdate(panelRoot, panelLp);
            expanded = true;
            return;
        }
        try {
            panelRoot = buildPanel();
            panelLp = new WindowManager.LayoutParams(
                    dp(PANEL_W_DP), WindowManager.LayoutParams.WRAP_CONTENT,
                    WindowManager.LayoutParams.TYPE_APPLICATION_OVERLAY,
                    WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE
                            | WindowManager.LayoutParams.FLAG_WATCH_OUTSIDE_TOUCH
                            | WindowManager.LayoutParams.FLAG_LAYOUT_IN_SCREEN,
                    PixelFormat.TRANSLUCENT);
            panelLp.gravity = Gravity.TOP | Gravity.START;
            panelLp.setTitle("鲸鱼娘速览");
            panelRoot.measure(
                    View.MeasureSpec.makeMeasureSpec(dp(PANEL_W_DP), View.MeasureSpec.AT_MOST),
                    View.MeasureSpec.makeMeasureSpec(dp(PANEL_MAX_H_DP), View.MeasureSpec.AT_MOST));
            placePanel(panelRoot);
            wm.addView(panelRoot, panelLp);
            panelRoot.setAlpha(0f);
            panelRoot.setTranslationY(dp(10));
            panelRoot.animate().alpha(1f).translationY(0f).setDuration(170).start();
            expanded = true;
        } catch (Exception e) {
            panelRoot = null;
        }
    }

    private void collapsePanel() {
        expanded = false;
        final FrameLayout v = panelRoot;
        panelRoot = null;
        if (v == null) return;
        try {
            v.animate().alpha(0f).translationY(dp(8)).setDuration(140)
                    .withEndAction(() -> {
                        try { wm.removeView(v); } catch (Exception ignored) { }
                    }).start();
        } catch (Exception e) {
            try { wm.removeView(v); } catch (Exception ignored) { }
        }
    }

    private FrameLayout buildPanel() {
        android.content.SharedPreferences sp = getSharedPreferences(PREFS, Context.MODE_PRIVATE);

        FrameLayout root = new FrameLayout(this);
        // 上浅下深的靛蓝渐变 + 描边 + 投影，卡片才有"浮起"的体积感
        GradientDrawable bg = new GradientDrawable(
                GradientDrawable.Orientation.TOP_BOTTOM,
                new int[]{0xFF1A2542, 0xFF0A0F1E});
        bg.setCornerRadius(dp(26));
        bg.setStroke(dp(1), 0x2EFFFFFF);
        root.setBackground(bg);
        root.setPadding(dp(15), dp(14), dp(15), dp(14));
        root.setElevation(dp(12));
        // 点到卡外 → 收起
        root.setOnTouchListener(new View.OnTouchListener() {
            @Override public boolean onTouch(View v, MotionEvent e) {
                if (e.getActionMasked() == MotionEvent.ACTION_OUTSIDE) collapsePanel();
                return false;
            }
        });

        LinearLayout col = new LinearLayout(this);
        col.setOrientation(LinearLayout.VERTICAL);
        root.addView(col, new FrameLayout.LayoutParams(
                FrameLayout.LayoutParams.MATCH_PARENT, FrameLayout.LayoutParams.WRAP_CONTENT));

        col.addView(header(sp), lpv(0, 11));

        // 今晚卡：大值一行 + 小字副行，排版规整；整卡可点进 App
        LinearLayout card = card();
        View todayRow = row("\u25F4", 0xFF7FD8FF, "今晚", "today",
                sp.getString(K_ROW_TODAY, "目标 23:30"));
        todayRow.setOnClickListener(v -> openApp("today"));
        card.addView(todayRow, lpv(0, 0));
        TextView sub = text(sp.getString(K_ROW_SUB, "记得早点休息"), 10.5f, 0xFF8798AE, false);
        sub.setTag(K_ROW_SUB);
        LinearLayout.LayoutParams subLp = new LinearLayout.LayoutParams(-1, -2);
        subLp.leftMargin = dp(44);   // 与行内文字对齐：padding 8 + 图标 26 + 间距 10
        subLp.bottomMargin = dp(9);
        card.addView(sub, subLp);
        col.addView(card, lpv(0, 0));

        // 护眼滤镜：就地开关，单独成卡
        LinearLayout actionCard = card();
        View eyeRow = row("\u25D1", 0xFFB9A6FF, "护眼滤镜", "eyecare", eyeValue());
        eyeRow.setOnClickListener(v -> {
            toggleEyeCare((TextView) eyeRow.findViewWithTag("eyecare"));
            if (whale != null) whale.cheer();
        });
        actionCard.addView(eyeRow, lpv(0, 0));
        col.addView(actionCard, lpv(0, 0));

        return root;
    }

    /** 面板摆位：优先贴角色左右不遮挡的一侧；放不下就挪到角色上/下方，绝不盖住角色。 */
    private void placePanel(View v) {
        DisplayInfo di = displayInfo();
        int pw = v.getMeasuredWidth() > 0 ? v.getMeasuredWidth() : dp(PANEL_W_DP);
        int ph = v.getMeasuredHeight() > 0 ? v.getMeasuredHeight() : dp(PANEL_MAX_H_DP);
        int wx = petParams.x, wy = petParams.y;
        int ww = dp(COLLAPSED_W_DP), wh = dp(COLLAPSED_H_DP);
        int gap = dp(8), m = dp(4);
        int leftRoom = wx - gap - m;
        int rightRoom = di.width - (wx + ww) - gap - m;
        int px, py;
        if (leftRoom >= pw || rightRoom >= pw) {
            // 左右都能放时选更宽的一侧；垂直方向面板中心对齐角色中心
            boolean goLeft = leftRoom >= pw && (rightRoom < pw || leftRoom >= rightRoom);
            px = goLeft ? wx - pw - gap : wx + ww + gap;
            py = wy + wh / 2 - ph / 2;
        } else {
            // 屏幕放不下左右（窄屏）→ 放角色下方，不够再放上方；水平与角色对齐
            px = wx + ww / 2 - pw / 2;
            boolean belowOk = wy + wh + gap + ph <= di.height - m;
            py = belowOk ? wy + wh + gap : wy - ph - gap;
        }
        panelLp.x = Math.max(m, Math.min(px, di.width - pw - m));
        panelLp.y = Math.max(m, Math.min(py, di.height - ph - m));
    }

    // ================= 女仆播报气泡 =================

    private void showBubble() {
        if (bubbleShown) return;
        collapsePanel();
        try {
            FrameLayout v = buildBubble(nextSayLine());
            v.setOnTouchListener((vv, e) -> {
                if (e.getActionMasked() == MotionEvent.ACTION_OUTSIDE) hideBubble();
                return false;
            });
            v.setOnClickListener(vv -> hideBubble());
            bubbleLp = new WindowManager.LayoutParams(
                    WindowManager.LayoutParams.WRAP_CONTENT, WindowManager.LayoutParams.WRAP_CONTENT,
                    WindowManager.LayoutParams.TYPE_APPLICATION_OVERLAY,
                    WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE
                            | WindowManager.LayoutParams.FLAG_WATCH_OUTSIDE_TOUCH
                            | WindowManager.LayoutParams.FLAG_LAYOUT_IN_SCREEN,
                    PixelFormat.TRANSLUCENT);
            bubbleLp.gravity = Gravity.TOP | Gravity.START;
            bubbleLp.setTitle("鲸鱼娘播报");

            int bw = dp(240);
            v.measure(View.MeasureSpec.makeMeasureSpec(bw, View.MeasureSpec.AT_MOST),
                    View.MeasureSpec.makeMeasureSpec(0, View.MeasureSpec.UNSPECIFIED));
            bw = Math.max(v.getMeasuredWidth(), dp(140));
            int bh = v.getMeasuredHeight();
            DisplayInfo di = displayInfo();
            int m = dp(4), gap = dp(10);
            int cx = petParams.x + dp(COLLAPSED_W_DP) / 2;
            bubbleLp.x = Math.max(m, Math.min(cx - bw / 2, di.width - bw - m));
            int above = petParams.y - bh - gap;
            if (above >= m) bubbleLp.y = above;
            else bubbleLp.y = Math.max(m, Math.min(
                    petParams.y + dp(COLLAPSED_H_DP) + gap, di.height - bh - m));

            // 尾巴对准角色头顶
            View tail = v.findViewWithTag("pet_tail");
            int tailCx = 0;
            if (tail != null) {
                FrameLayout.LayoutParams tlp = (FrameLayout.LayoutParams) tail.getLayoutParams();
                tlp.leftMargin = Math.max(dp(14), Math.min(cx - bubbleLp.x - dp(6), bw - dp(26)));
                tail.setLayoutParams(tlp);
                tailCx = tlp.leftMargin + dp(6);
            }

            wm.addView(v, bubbleLp);
            bubbleRoot = v;
            bubbleShown = true;
            if (whale != null) whale.setTalking(true);
            // 播报动画：从尾巴处弹出带回弹的放大，与速览卡的滑入区分
            v.setAlpha(0f);
            v.setPivotX(Math.max(dp(1), tailCx));
            v.setPivotY(bh - dp(10));
            v.setScaleX(0.55f);
            v.setScaleY(0.55f);
            v.animate().alpha(1f).scaleX(1f).scaleY(1f).setDuration(230)
                    .setInterpolator(new android.view.animation.OvershootInterpolator(1.7f))
                    .start();
            main.postDelayed(bubbleHide, 7000);
        } catch (Exception e) {
            bubbleRoot = null;
            bubbleShown = false;
        }
    }

    private void hideBubble() {
        main.removeCallbacks(bubbleHide);
        final FrameLayout v = bubbleRoot;
        bubbleRoot = null;
        bubbleShown = false;
        if (whale != null) whale.setTalking(false);
        if (v == null) return;
        try {
            v.animate().alpha(0f).scaleX(0.72f).scaleY(0.72f).setDuration(130)
                    .withEndAction(() -> { try { wm.removeView(v); } catch (Exception ignored) { } })
                    .start();
        } catch (Exception e) {
            try { wm.removeViewImmediate(v); } catch (Exception ignored) { }
        }
    }

    /** 头顶对话气泡：名牌 + 正文 + 指向角色的尾巴。 */
    private FrameLayout buildBubble(String msg) {
        FrameLayout wrap = new FrameLayout(this);
        wrap.setPadding(0, 0, 0, dp(10));   // 给尾巴留出窗口内的空间（窗口会裁掉越界内容）

        View tail = new View(this);
        tail.setTag("pet_tail");
        GradientDrawable tg = new GradientDrawable();
        tg.setColor(0xFF1B2846);
        tg.setCornerRadius(dp(3));
        tail.setBackground(tg);
        tail.setRotation(45f);
        wrap.addView(tail, new FrameLayout.LayoutParams(dp(11), dp(11),
                Gravity.BOTTOM | Gravity.START));

        LinearLayout bubble = new LinearLayout(this);
        bubble.setOrientation(LinearLayout.VERTICAL);
        GradientDrawable bg = new GradientDrawable(
                GradientDrawable.Orientation.TL_BR, new int[]{0xFF2A3C63, 0xFF1B2846});
        bg.setCornerRadius(dp(18));
        bg.setStroke(dp(1), 0x36FFFFFF);
        bubble.setBackground(bg);
        bubble.setPadding(dp(14), dp(11), dp(14), dp(12));

        TextView name = text("鲸鱼娘 · 睡眠女仆", 9.5f, 0xFF7FD8FF, true);
        bubble.addView(name, new LinearLayout.LayoutParams(-2, -2));
        TextView body = text(msg, 12f, 0xFFF2F7FD, false);
        body.setLineSpacing(dp(2.5f), 1f);
        LinearLayout.LayoutParams blp = new LinearLayout.LayoutParams(-2, -2);
        blp.topMargin = dp(5);
        bubble.addView(body, blp);

        wrap.addView(bubble, new FrameLayout.LayoutParams(-2, -2, Gravity.TOP | Gravity.START));
        return wrap;
    }

    /** 轮播取一条播报词。 */
    private String nextSayLine() {
        android.content.SharedPreferences sp = getSharedPreferences(PREFS, Context.MODE_PRIVATE);
        String[] raw = sp.getString(K_PET_SAY, "").split("\n");
        java.util.List<String> lines = new java.util.ArrayList<>();
        for (String l : raw) {
            l = l.trim();
            if (!l.isEmpty()) lines.add(l);
        }
        if (lines.isEmpty()) return "主人，今晚也要早点休息哦～";
        String line = lines.get(sayIdx % lines.size());
        sayIdx++;
        return line;
    }

    /** 顶部：青色竖条 + 标题 + 右侧状态胶囊。 */    /** 顶部：青色竖条 + 标题 + 右侧状态胶囊。 */
    private View header(android.content.SharedPreferences sp) {
        LinearLayout h = new LinearLayout(this);
        h.setOrientation(LinearLayout.HORIZONTAL);
        h.setGravity(Gravity.CENTER_VERTICAL);

        View bar = new View(this);
        bar.setBackground(pill(0xFF6FD8FF, dp(2)));
        h.addView(bar, new LinearLayout.LayoutParams(dp(3), dp(20)));

        TextView title = text("鲸鱼娘速览", 14.5f, 0xFFFFFFFF, true);
        LinearLayout.LayoutParams tp = new LinearLayout.LayoutParams(0, -2, 1f);
        tp.leftMargin = dp(9);
        h.addView(title, tp);

        TextView status = text(sp.getString(K_STATUS, "陪你到入睡"), 10.5f, 0xFF8FE3FF, true);
        status.setTag(K_STATUS);
        status.setBackground(pill(0x1F6FD8FF, dp(20)));
        status.setPadding(dp(11), dp(4), dp(11), dp(4));
        status.setMaxLines(1);
        h.addView(status, new LinearLayout.LayoutParams(-2, -2));

        return h;
    }

    /** 内层分组卡：比外卡略浅一点的半透明面，两层叠出层次。 */
    private LinearLayout card() {
        LinearLayout c = new LinearLayout(this);
        c.setOrientation(LinearLayout.VERTICAL);
        c.setBackground(pill(0x0FFFFFFF, dp(18)));
        c.setPadding(dp(4), dp(5), dp(4), dp(5));
        return c;
    }

    /** 刷新面板文案（Web 侧推快照后由 ACTION_START 再次进入时调用）。 */
    private void refreshPanel() {
        if (panelRoot == null) return;
        android.content.SharedPreferences sp = getSharedPreferences(PREFS, Context.MODE_PRIVATE);
        setRowValue(panelRoot, K_STATUS, sp.getString(K_STATUS, "陪你到入睡"));
        setRowValue(panelRoot, "today", sp.getString(K_ROW_TODAY, "目标 23:30"));
        setRowValue(panelRoot, K_ROW_SUB, sp.getString(K_ROW_SUB, "记得早点休息"));
        setRowValue(panelRoot, "eyecare", eyeValue());
    }

    private String eyeValue() {
        return EyeCareService.isActive() ? "已开启 · 点此关闭" : "已关闭 · 点此开启";
    }

    private void setRowValue(View root, String tag, String value) {
        View v = root.findViewWithTag(tag);
        if (!(v instanceof TextView)) return;
        TextView tv = (TextView) v;
        tv.setText(value);
        if ("eyecare".equals(tag)) {
            // 开关态用颜色区分，省掉一个真 Switch 的体积
            boolean on = EyeCareService.isActive();
            tv.setTextColor(on ? 0xFF9BE7C4 : 0xFF8593A8);
        }
    }

    /**
     * 一行速览：图标块 + 左标签 + 右值，整行可点。
     * 除护眼是就地开关外，其余四行都是"带着目标分区拉起 App"。
     */
    private View row(String glyph, int chipColor, String label, String tab, String value) {
        LinearLayout line = new LinearLayout(this);
        line.setOrientation(LinearLayout.HORIZONTAL);
        line.setGravity(Gravity.CENTER_VERTICAL);
        line.setPadding(dp(8), dp(8), dp(10), dp(8));
        line.setBackground(ripple(dp(14), 0x00000000));

        TextView ic = text(glyph, 11.5f, chipColor, true);
        ic.setGravity(Gravity.CENTER);
        ic.setBackground(pill(chipColor & 0x33FFFFFF, dp(8)));
        line.addView(ic, new LinearLayout.LayoutParams(dp(26), dp(26)));

        TextView l = text(label, 12.5f, 0xFF93A2B8, false);
        LinearLayout.LayoutParams lp = new LinearLayout.LayoutParams(0, -2, 0.5f);
        lp.leftMargin = dp(10);
        line.addView(l, lp);

        TextView v = text(value, 11.5f, 0xFFE6F0FA, true);
        v.setTag(tab);
        v.setGravity(Gravity.RIGHT | Gravity.CENTER_VERTICAL);
        v.setMaxLines(1);
        v.setEllipsize(android.text.TextUtils.TruncateAt.END);
        line.addView(v, new LinearLayout.LayoutParams(0, -2, 1.0f));

        if (!"eyecare".equals(tab)) {
            line.setOnClickListener(click -> openApp(tab));
        }
        return line;
    }

    // ================= 动作 =================

    /** 把 App 拉起到指定分区：先写 pending tab，再拉起（App 读取后自行清除）。 */
    private void openApp(String tab) {
        try {
            getSharedPreferences(PREFS, Context.MODE_PRIVATE)
                    .edit().putString(K_PENDING_TAB, tab).apply();
            Intent launch = getPackageManager().getLaunchIntentForPackage(getPackageName());
            if (launch != null) {
                launch.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK
                        | Intent.FLAG_ACTIVITY_SINGLE_TOP
                        | Intent.FLAG_ACTIVITY_CLEAR_TOP);
                startActivity(launch);
            }
        } catch (Exception ignored) {
        }
        collapsePanel();
    }

    /**
     * 就地开关护眼滤镜。参数沿用上次应用的值（EyeCareService 已持久化），
     * 因此这里不需要 Web 层参与，也不受定时窗口影响——这是用户显式的手动操作。
     */
    private void toggleEyeCare(TextView valueView) {
        try {
            android.content.SharedPreferences sp = getSharedPreferences(PREFS, Context.MODE_PRIVATE);
            boolean wasOn = sp.getBoolean("eyecare_on", false) || EyeCareService.isActive();
            Intent i = new Intent(this, EyeCareService.class);
            if (wasOn) {
                i.setAction(EyeCareService.ACTION_STOP);
                sp.edit().putBoolean("eyecare_on", false).apply();
                valueView.setText("已关闭 · 点击开启");
            } else {
                i.setAction(EyeCareService.ACTION_APPLY);
                String color = sp.getString("eyecare_color", null);
                float warm = sp.getFloat("eyecare_warm", 0f);
                float dim = sp.getFloat("eyecare_dim", 0f);
                if (color == null || (warm <= 0.005f && dim <= 0.005f)) {
                    // App 端 apply 的真实参数还没落盘（或已被 STOP 清成 0/null）。
                    // 0/0 会让 EyeCareService 不建任何滤镜层 → 看似开启实际没效果。
                    color = "#FFB26B";
                    warm = 0.22f;
                    dim = 0f;
                }
                i.putExtra(EyeCareService.EXTRA_WARM_COLOR, color);
                i.putExtra(EyeCareService.EXTRA_WARM_ALPHA, warm);
                i.putExtra(EyeCareService.EXTRA_DIM_ALPHA, dim);
                sp.edit().putBoolean("eyecare_on", true).apply();
                valueView.setText("已开启 · 点击关闭");
            }
            if (Build.VERSION.SDK_INT >= 26) startForegroundService(i); else startService(i);
        } catch (Exception ignored) {
        }
    }

    /** 深夜更困：23:00-06:00 进入困倦态。每 5 分钟复查一次，跨过就寝点自然过渡。 */
    private final Runnable drowsyTick = new Runnable() {
        @Override public void run() {
            if (whale != null) {
                int h = java.util.Calendar.getInstance().get(java.util.Calendar.HOUR_OF_DAY);
                whale.setDrowsy((h >= 23 || h < 6) ? 0.85f : 0f);
            }
            main.postDelayed(this, 5 * 60 * 1000L);
        }
    };

    // ================= 通用工具 =================

    private static class DisplayInfo {
        int width, height;
    }

    private DisplayInfo displayInfo() {
        DisplayInfo di = new DisplayInfo();
        try {
            android.util.DisplayMetrics dm = getResources().getDisplayMetrics();
            di.width = dm.widthPixels;
            di.height = dm.heightPixels;
        } catch (Exception ignored) {
            di.width = dp(360);
            di.height = dp(800);
        }
        return di;
    }

    private void clampToScreen(WindowManager.LayoutParams lp) {
        DisplayInfo di = displayInfo();
        lp.x = Math.max(0, Math.min(lp.x, di.width - dp(COLLAPSED_W_DP)));
        lp.y = Math.max(0, Math.min(lp.y, di.height - dp(COLLAPSED_H_DP)));
    }

    private void safeUpdate(View v, WindowManager.LayoutParams lp) {
        try { if (v != null) wm.updateViewLayout(v, lp); } catch (Exception ignored) { }
    }

    private int dp(float v) {
        return Math.round(v * getResources().getDisplayMetrics().density);
    }

    private TextView text(String s, float sp, int color, boolean bold) {
        TextView t = new TextView(this);
        t.setText(s);
        t.setTextSize(TypedValue.COMPLEX_UNIT_SP, sp);
        t.setTextColor(color);
        if (bold) t.setTypeface(Typeface.DEFAULT_BOLD);
        return t;
    }

    private LinearLayout.LayoutParams lpv(int topDp, int bottomDp) {
        LinearLayout.LayoutParams p = new LinearLayout.LayoutParams(-1, -2);
        p.topMargin = dp(topDp);
        p.bottomMargin = dp(bottomDp);
        return p;
    }

    /** 纯色圆角块：卡片底、状态胶囊、图标块共用，避免每处各写一份 GradientDrawable。 */
    private android.graphics.drawable.Drawable pill(int color, int radiusDp) {
        GradientDrawable g = new GradientDrawable();
        g.setColor(color);
        g.setCornerRadius(dp(radiusDp));
        return g;
    }

    /** 可点击行的水波纹背景（API 21+ 用 ripple 近似圆角高亮）。 */
    private android.graphics.drawable.Drawable ripple(int radiusDp, int color) {
        GradientDrawable g = new GradientDrawable();
        g.setColor(color);
        g.setCornerRadius(dp(radiusDp));
        android.graphics.drawable.RippleDrawable rd = new android.graphics.drawable.RippleDrawable(
                android.content.res.ColorStateList.valueOf(0x33FFFFFF), g, null);
        return rd;
    }

    private void ensureChannel() {
        try {
            NotificationManager nm = getSystemService(NotificationManager.class);
            if (nm != null && nm.getNotificationChannel(CHANNEL_ID) == null) {
                NotificationChannel ch = new NotificationChannel(
                        CHANNEL_ID, "鲸鱼娘桌宠", NotificationManager.IMPORTANCE_LOW);
                ch.setShowBadge(false);
                nm.createNotificationChannel(ch);
            }
        } catch (Exception ignored) {
        }
    }

    private void startForegroundCompat(String text) {
        try {
            ensureChannel();
            Intent launch = getPackageManager().getLaunchIntentForPackage(getPackageName());
            PendingIntent pi = launch != null
                    ? PendingIntent.getActivity(this, 4, launch,
                            PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE)
                    : null;
            Notification.Builder b = Build.VERSION.SDK_INT >= 26
                    ? new Notification.Builder(this, CHANNEL_ID)
                    : new Notification.Builder(this);
            Notification n = b.setSmallIcon(android.R.drawable.ic_menu_compass)
                    .setContentTitle("鲸鱼娘陪着你")
                    .setContentText(text)
                    .setContentIntent(pi)
                    .setOngoing(true)
                    .setOnlyAlertOnce(true)
                    .build();
            if (Build.VERSION.SDK_INT >= 34) {
                try {
                    startForeground(NOTIFICATION_ID, n,
                            android.content.pm.ServiceInfo.FOREGROUND_SERVICE_TYPE_SPECIAL_USE);
                    return;
                } catch (Exception ignored) { }
            }
            startForeground(NOTIFICATION_ID, n);
        } catch (Exception ignored) {
        }
    }

    @Override
    public void onDestroy() {
        main.removeCallbacks(drowsyTick);
        try { unregisterReceiver(screenReceiver); } catch (Exception ignored) { }
        if (whale != null) whale.stop();
        hideBubble();
        collapsePanel();
        if (petRoot != null) {
            try { wm.removeViewImmediate(petRoot); } catch (Exception ignored) { }
            petRoot = null;
        }
        whale = null;
        super.onDestroy();
    }
}
