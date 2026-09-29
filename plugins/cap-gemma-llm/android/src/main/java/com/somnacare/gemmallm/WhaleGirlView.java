package com.somnacare.gemmallm;

import android.content.Context;
import android.graphics.Bitmap;
import android.graphics.BitmapFactory;
import android.graphics.Canvas;
import android.graphics.Paint;
import android.graphics.Rect;
import android.graphics.RectF;
import android.os.Handler;
import android.os.Looper;
import android.view.View;

/**
 * 鲸鱼娘精灵图动画视图。
 *
 * 素材与播放参数取自 whale-girl-plus（署名链与使用限制见 assets/pet/NOTICE.md）：
 * 每张 sheet 横向等分帧、单帧 256×256 RGBA 透明背景，fps/帧数/播放模式来自上游
 * manifest.json。这里只实现悬浮窗用到的 6 个状态。
 *
 * 之前一版是 Canvas 手绘，观感达不到角色应有的水平，改用现成精灵图。
 */
public class WhaleGirlView extends View {
    private static final String DIR = "pet/";
    private static final long TICK_MS = 33; // ~30fps 重绘节拍
    private static final long BLINK_CYCLE_MS = 3400;

    /** 一个状态的素材与播放参数（参数抄自上游 manifest.json）。 */
    private static final class Anim {
        final Bitmap sheet;
        final int frames;
        final long frameMs;
        final boolean blink;

        Anim(Bitmap sheet, int frames, int fps, String playback) {
            this.sheet = sheet;
            this.frames = Math.max(1, frames);
            this.frameMs = Math.max(80, 1000L / Math.max(1, fps));
            this.blink = "blink".equals(playback);
        }
    }

    private final Paint paint = new Paint(Paint.ANTI_ALIAS_FLAG | Paint.FILTER_BITMAP_FLAG);
    private final Handler main = new Handler(Looper.getMainLooper());
    private final Rect src = new Rect();
    private final RectF dst = new RectF();

    private final Anim idle;
    private final Anim joy;
    private final Anim celebrate;
    private final Anim sleep;
    private final Anim drag;
    private final Anim welcome;

    private Anim current;
    private long stateSince;
    private long cheerUntil;
    private float drowsy;
    private boolean dragging;
    private boolean running;
    private final Runnable tick = new Runnable() {
        @Override public void run() {
            if (!running) return;
            invalidate();
            main.postDelayed(this, TICK_MS);
        }
    };

    public WhaleGirlView(Context c) {
        super(c);
        idle = load(c, "idle", 3, 2, "blink");
        joy = load(c, "joy", 2, 5, "loop");
        celebrate = load(c, "celebrate", 3, 4, "loop");
        sleep = load(c, "sleep", 2, 1, "loop");
        drag = load(c, "drag", 1, 5, "loop");
        welcome = load(c, "welcome", 2, 3, "loop");
        current = welcome != null ? welcome : idle;
        stateSince = System.currentTimeMillis();
    }

    private static Anim load(Context c, String name, int frames, int fps, String playback) {
        try {
            Bitmap b = BitmapFactory.decodeStream(c.getAssets().open(DIR + name + ".png"));
            if (b == null) return null;
            return new Anim(b, frames, fps, playback);
        } catch (Exception e) {
            return null;
        }
    }

    public void start() {
        if (running) return;
        running = true;
        main.postDelayed(tick, TICK_MS);
    }

    public void stop() {
        running = false;
        main.removeCallbacks(tick);
    }

    /** 庆祝：点角色、开关注护眼时播一小段 celebrate 再回常态。 */
    public void cheer() {
        pick(celebrate != null ? celebrate : (joy != null ? joy : idle));
        cheerUntil = System.currentTimeMillis() + 1600;
    }

    /** 深夜 23:00–06:00 传入 >0.5，白天传 0。 */
    public void setDrowsy(float d) {
        drowsy = d;
        if (!dragging && cheerUntil == 0) {
            pick(drowsy > 0.5f && sleep != null ? sleep : idle);
        }
    }

    /** 拖拽中切"被拎起来"姿势，松手恢复。 */
    public void setDragging(boolean d) {
        dragging = d;
        if (d) {
            pick(drag);
        } else {
            cheerUntil = 0;
            pick(drowsy > 0.5f && sleep != null ? sleep : idle);
        }
    }

    private void pick(Anim a) {
        if (a == null || a == current) return;
        current = a;
        stateSince = System.currentTimeMillis();
        invalidate();
    }

    @Override
    protected void onDraw(Canvas c) {
        super.onDraw(c);
        Anim a = current;
        if (a == null || a.sheet == null || a.sheet.isRecycled()) return;
        long now = System.currentTimeMillis();

        // 庆祝到点回落常态；拖拽优先级最高，打断庆祝
        if (cheerUntil != 0 && now > cheerUntil && !dragging) {
            cheerUntil = 0;
            pick(drowsy > 0.5f && sleep != null ? sleep : idle);
            a = current;
        }

        int w = getWidth(), h = getHeight();
        if (w == 0 || h == 0) return;

        int fw = a.sheet.getWidth() / a.frames;
        int fh = a.sheet.getHeight();
        int idx = frameIndex(a, now - stateSince);
        src.set(idx * fw, 0, (idx + 1) * fw, fh);

        // 帧是正方形、窗口高>宽：按宽定边、垂直居中
        float side = Math.min(w, h) * 0.97f;
        float cx = w / 2f, cy = h / 2f;

        c.save();
        if (dragging) {
            // 被拎起：轻微左右晃 + 上移一点
            float t = (now % 900) / 900f;
            c.rotate((float) Math.sin(t * Math.PI * 2) * 5f, cx, cy + side * 0.3f);
            c.translate(0, -side * 0.04f);
        } else {
            // 待机呼吸：整体 ±1.5% 的缓慢浮动，让画面一直"活着"
            float t = (now % 2600) / 2600f;
            c.translate(0, (float) Math.sin(t * Math.PI * 2) * side * 0.015f);
        }
        dst.set(cx - side / 2f, cy - side / 2f, cx + side / 2f, cy + side / 2f);
        c.drawBitmap(a.sheet, src, dst, paint);
        c.restore();
    }

    /** 按播放模式算当前帧号。 */
    private static int frameIndex(Anim a, long elapsed) {
        if (a.blink) {
            // idle 的 blink：大部分时间第 0 帧，周期尾端把眨眼帧放出来
            long hold = BLINK_CYCLE_MS - 2 * a.frameMs;
            long ph = elapsed % BLINK_CYCLE_MS;
            if (ph < hold) return 0;
            return Math.min(a.frames - 1, 1 + (int) ((ph - hold) / a.frameMs));
        }
        return (int) ((elapsed / a.frameMs) % a.frames);
    }

    @Override
    protected void onDetachedFromWindow() {
        stop();
        super.onDetachedFromWindow();
    }
}
