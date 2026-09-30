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

import java.util.Random;

/**
 * 鲸鱼娘精灵图动画视图。
 *
 * 素材与播放参数取自 whale-girl-plus（署名链与使用限制见 assets/pet/NOTICE.md）：
 * 每张 sheet 横向等分帧、单帧 256×256 RGBA 透明背景，fps/帧数/播放模式来自上游
 * manifest.json。
 *
 * 状态分四类，优先级从高到低：拖拽 drag > 播报 talking > 庆祝 cheer > 困倦 sleep
 * > 待机 idle。待机时由 {@link ambientTick} 随机插入小动作（歪头/喝茶/看书/
 * 抱枕头/吃东西/玩耍/散步/工作…），每段几秒后回到 idle，避免"只会眨眼"。
 */
public class WhaleGirlView extends View {
    private static final String DIR_DEFAULT = "pet/";
    private static final String DIR_SPORT = "pet-sport/";
    private static final long TICK_MS = 33; // ~30fps 重绘节拍
    private static final long BLINK_CYCLE_MS = 3400;
    // 小动作节奏：待机歇 25-60s 才来一段，一段播 6-12s——切换太频繁会显得怪异不流畅
    private static final int IDLE_PAUSE_MIN = 25000;
    private static final int IDLE_PAUSE_VAR = 35000;
    private static final int AMBIENT_MIN = 6000;
    private static final int AMBIENT_VAR = 6000;

    /** 一个状态的素材与播放参数（参数抄自上游 manifest.json）。 */
    private static final class Anim {
        final Bitmap sheet;
        final int frames;
        final long frameMs;
        final boolean blink;
        final boolean pingpong;
        /** 上游的 motion 字段：think=float（上下漂），wait=wiggle（小幅摇摆）。 */
        final boolean floatMotion;
        final boolean wiggleMotion;

        Anim(Bitmap sheet, int frames, int fps, String playback, String motion) {
            this.sheet = sheet;
            this.frames = Math.max(1, frames);
            this.frameMs = Math.max(80, 1000L / Math.max(1, fps));
            this.blink = "blink".equals(playback);
            this.pingpong = "pingpong".equals(playback);
            this.floatMotion = "float".equals(motion);
            this.wiggleMotion = "wiggle".equals(motion);
        }
    }

    private final Paint paint = new Paint(Paint.ANTI_ALIAS_FLAG | Paint.FILTER_BITMAP_FLAG);
    private final Handler main = new Handler(Looper.getMainLooper());
    private final Random rng = new Random();
    private final Rect src = new Rect();
    private final RectF dst = new RectF();

    private final Anim idle, joy, celebrate, sleep, drag, welcome;
    private final Anim headtilt, wait, think, reading, tea, pillow, eat, play, walk, party, working, nap;
    private final Anim[] ambient;   // 待机小动作池
    private final Anim[] cheers;    // 庆祝池

    private Anim current;
    private long stateSince;
    private long cheerUntil;        // 庆祝播到这个时刻
    private long ambientUntil;      // 小动作播到这个时刻
    private boolean pendingCheer;   // 点她时若在做小动作：等这一段播完再庆祝（不打断更自然）
    private boolean talking;
    private float drowsy;
    private boolean dragging;
    private boolean running;
    private boolean resumed;        // 小动作调度是否在跑

    private final Runnable tick = new Runnable() {
        @Override public void run() {
            if (!running) return;
            invalidate();
            main.postDelayed(this, TICK_MS);
        }
    };

    private final Runnable ambientTick = new Runnable() {
        @Override public void run() {
            if (!resumed || ambient.length == 0) return;
            long now = System.currentTimeMillis();
            if (now >= ambientUntil) {
                if (dragging || talking) {
                    ambientUntil = now + 5000;   // 拖拽/说话由各自的收尾逻辑接管
                } else if (current != idle && current != sleep) {
                    // 欢迎/小动作/庆祝播完 → 回待机，长歇一段随机时长再出发
                    pick(idle);
                    ambientUntil = now + IDLE_PAUSE_MIN + rng.nextInt(IDLE_PAUSE_VAR);
                } else if (drowsy > 0.5f) {
                    ambientUntil = now + 15000;  // 深夜困倦时不折腾，安静睡觉
                } else if (pendingCheer) {
                    // 用户点过她：小动作这一段已播完，现在兑现庆祝
                    pendingCheer = false;
                    if (cheers.length > 0) {
                        pick(cheers[rng.nextInt(cheers.length)]);
                        cheerUntil = now + 1800;
                    }
                    // 庆祝完后较短间隔接小动作（用户刚互动过，不要太冷清）
                    ambientUntil = now + 8000 + rng.nextInt(8000);
                } else {
                    // 待机歇够了 → 随机来一段小动作
                    Anim next = ambient[rng.nextInt(ambient.length)];
                    if (next != null) {
                        pick(next);
                        ambientUntil = now + AMBIENT_MIN + rng.nextInt(AMBIENT_VAR);
                    }
                }
            }
            main.postDelayed(this, 500);
        }
    };

    private final String dir;

    public WhaleGirlView(Context c, String skin) {
        super(c);
        this.dir = "sakura".equals(skin) ? DIR_SPORT : DIR_DEFAULT;
        idle      = load("idle", 3, 2, "blink", null);
        joy       = load("joy", 2, 5, "loop", null);
        celebrate = load("celebrate", 3, 4, "loop", null);
        sleep     = load("sleep", 2, 1, "loop", null);
        drag      = load("drag", 1, 5, "loop", "tilt");
        welcome   = load("welcome", 2, 3, "loop", null);

        headtilt  = load("headtilt", 2, 2, "loop", null);
        wait      = load("wait", 1, 2, "loop", "wiggle");
        think     = load("think", 1, 2, "loop", "float");
        reading   = load("reading", 2, 2, "loop", null);
        tea       = load("tea", 3, 2, "loop", null);
        pillow    = load("pillow", 2, 1, "loop", null);
        eat       = load("eat", 3, 8, "loop", null);
        play      = load("play", 3, 4, "loop", null);
        walk      = load("walk", 3, 6, "pingpong", null);
        party     = load("party", 3, 4, "loop", null);
        working   = load("working", 3, 3, "loop", null);
        nap       = load("nap", 2, 1, "loop", null);

        ambient = buildPool(headtilt, wait, think, reading, tea, pillow, eat, play, walk, working, nap);
        cheers = buildPool(celebrate, party, joy);

        current = welcome != null ? welcome : idle;
        stateSince = System.currentTimeMillis();
        ambientUntil = stateSince + 6000;   // 先让 welcome 播完再进待机节奏
    }

    private static Anim[] buildPool(Anim... list) {
        int n = 0;
        for (Anim a : list) if (a != null) n++;
        Anim[] out = new Anim[n];
        int i = 0;
        for (Anim a : list) if (a != null) out[i++] = a;
        return out;
    }

    private Anim load(String name, int frames, int fps, String playback, String motion) {
        try (java.io.InputStream in = getContext().getAssets().open(dir + name + ".png")) {
            Bitmap b = BitmapFactory.decodeStream(in);
            if (b == null) return null;
            return new Anim(b, frames, fps, playback, motion);
        } catch (OutOfMemoryError e) {
            // 低内存设备解码 256×256 × 18 张可能 OOM：缺一张比崩进程好
            return null;
        } catch (Exception e) {
            return null;
        }
    }

    public void start() {
        if (running) return;
        running = true;
        resumed = true;
        main.postDelayed(tick, TICK_MS);
        main.postDelayed(ambientTick, 500);
    }

    public void stop() {
        running = false;
        resumed = false;
        main.removeCallbacks(tick);
        main.removeCallbacks(ambientTick);
    }

    /** 庆祝：点角色、开关注护眼时随机来一段，播约 1.8s 回常态。 */
    public void cheer() {
        if (cheers.length == 0) return;
        // 正在做小动作时不打断：标记 pending，等这一段完整播完再庆祝
        if (current != idle && current != sleep && ambientUntil > System.currentTimeMillis()) {
            pendingCheer = true;
            return;
        }
        pick(cheers[rng.nextInt(cheers.length)]);
        cheerUntil = System.currentTimeMillis() + 1800;
    }

    /** 深夜 23:00–06:00 传入 >0.5，白天传 0。 */
    public void setDrowsy(float d) {
        drowsy = d;
        if (!dragging && !talking && cheerUntil == 0) {
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
            ambientUntil = 0;
            pick(talking ? headtilt : (drowsy > 0.5f && sleep != null ? sleep : idle));
        }
    }

    /** 播报顾问内容时的说话神态（歪头），结束传 false。 */
    public void setTalking(boolean t) {
        talking = t;
        if (!dragging) {
            if (t) {
                pick(headtilt != null ? headtilt : idle);
            } else {
                pick(drowsy > 0.5f && sleep != null ? sleep : idle);
                ambientUntil = System.currentTimeMillis() + IDLE_PAUSE_MIN;
            }
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

        if (!dragging && !talking) {
            // 庆祝到点回落常态
            if (cheerUntil != 0 && now > cheerUntil) {
                cheerUntil = 0;
                ambientUntil = 0;
                pick(drowsy > 0.5f && sleep != null ? sleep : idle);
                a = current;
            } else if (ambientUntil == 0 && a != idle && a != sleep
                    && a != celebrate && a != party && a != joy) {
                // 小动作被外部打断后落到未知状态 → 归位
                pick(drowsy > 0.5f && sleep != null ? sleep : idle);
                a = current;
            }
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
        } else if (a.wiggleMotion) {
            float t = (now % 1400) / 1400f;
            c.rotate((float) Math.sin(t * Math.PI * 2) * 3.5f, cx, cy + side * 0.35f);
        } else {
            float t = (now % 2600) / 2600f;
            // think=float 漂得更明显些；其余状态保留 ±1.5% 的呼吸浮动
            float amp = a.floatMotion ? 0.045f : 0.015f;
            c.translate(0, (float) Math.sin(t * Math.PI * 2) * side * amp);
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
        if (a.pingpong && a.frames > 2) {
            long period = (2L * a.frames - 2) * a.frameMs;
            int i = (int) ((elapsed % period) / a.frameMs);
            return i < a.frames ? i : 2 * a.frames - 2 - i;
        }
        return (int) ((elapsed / a.frameMs) % a.frames);
    }

    @Override
    protected void onDetachedFromWindow() {
        stop();
        super.onDetachedFromWindow();
    }
}
