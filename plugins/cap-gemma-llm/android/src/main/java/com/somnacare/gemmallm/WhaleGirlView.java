package com.somnacare.gemmallm;

import android.content.Context;
import android.graphics.Canvas;
import android.graphics.LinearGradient;
import android.graphics.Paint;
import android.graphics.Path;
import android.graphics.RadialGradient;
import android.graphics.RectF;
import android.graphics.Shader;
import android.os.SystemClock;
import android.view.View;

/**
 * 鲸鱼娘：Canvas 手绘的 Q 版鲸鱼女仆桌宠。
 *
 * 画法沿用本作既有的"纯代码绘制"路线（与 {@code BedtimeOverlayService.MoonView} 同源）——
 * 不引入任何外部美术资源，因此没有 Live2D Cubism Core 这类专有组件的分发授权问题，
 * 也不必在 CI 里额外搬运素材。
 *
 * 动画全部由一个相位 t 推导，没有逐帧状态机：
 * - 呼吸：身体 Y 向 ±1.5% 缩放 + 头部 1px 上下浮沉
 * - 摆尾：尾鳍绕根部 ±10° 摆动
 * - 发丝：两侧长发 ±1.5° 剪切摆动（相位错开，避免机械同步）
 * - 眨眼：每 3.4s 一次、持续 130ms 的闭合
 * - 开心：点击后 1.6s 内眉毛上扬 + 嘴型变成微笑弧 + 头顶冒一颗小水珠
 * - 困倦：深夜时眼神下垂、闭眼频率变高、冒 "z"
 *
 * 帧率封顶 30fps：悬浮窗常驻在别的应用之上，省电优先于顺滑。
 */
public class WhaleGirlView extends View {

    // ---- 调色板（海盐蓝 + 女仆白，与应用深色主题同调）----
    private static final int C_HAIR_LIGHT = 0xFFE4F4FC;
    private static final int C_HAIR = 0xFFC3E3F5;
    private static final int C_HAIR_SHADE = 0xFF8FC4E0;
    private static final int C_SKIN = 0xFFFFEDE3;
    private static final int C_SKIN_SHADE = 0xFFF6D3C6;
    private static final int C_DRESS = 0xFF2F4F8C;
    private static final int C_DRESS_SHADE = 0xFF22406F;
    private static final int C_APRON = 0xFFFFFFFF;
    private static final int C_APRON_SHADE = 0xFFDCEBF4;
    private static final int C_RIBBON = 0xFF6FB7D9;
    private static final int C_INK = 0xFF2B3A55;
    private static final int C_IRIS = 0xFF2E6FA8;
    private static final int C_BLUSH = 0xFFFF9FB4;
    private static final int C_GLOW = 0x4480D8F0;

    private static final float TWO_PI = (float) (Math.PI * 2);

    private final Paint p = new Paint(Paint.ANTI_ALIAS_FLAG);
    private final Paint stroke = new Paint(Paint.ANTI_ALIAS_FLAG);
    private final Path path = new Path();
    private final RectF r = new RectF();
    private final long t0 = SystemClock.uptimeMillis();

    /** 归一化单位：所有绘制坐标按 100x100 的虚拟画布给出，再按 u 缩放到实际像素。 */
    private float u = 1f;
    private float cx = 0f, cy = 0f;

    /** 0 = 平静，1 = 开心（点击后自动回落）。 */
    private float cheer = 0f;
    /** 0 = 精神，1 = 困倦（深夜由 Service 推入）。 */
    private float drowsy = 0f;
    private boolean paused;

    private final Runnable frame = new Runnable() {
        @Override public void run() {
            if (paused) return;
            invalidate();
            postDelayed(this, 33); // ~30fps
        }
    };

    public WhaleGirlView(Context c) {
        super(c);
        setLayerType(View.LAYER_TYPE_HARDWARE, null);
        stroke.setStyle(Paint.Style.STROKE);
        stroke.setStrokeCap(Paint.Cap.ROUND);
        stroke.setStrokeJoin(Paint.Join.ROUND);
    }

    public void start() {
        paused = false;
        removeCallbacks(frame);
        post(frame);
    }

    public void stop() {
        paused = true;
        removeCallbacks(frame);
    }

    /** 点击时的开心反馈。 */
    public void cheer() {
        cheer = 1f;
        invalidate();
    }

    /** 深夜困倦态（0f 精神 ~ 1f 困）。 */
    public void setDrowsy(float v) {
        drowsy = Math.max(0f, Math.min(1f, v));
        invalidate();
    }

    @Override
    protected void onDetachedFromWindow() {
        super.onDetachedFromWindow();
        removeCallbacks(frame);
    }

    @Override
    protected void onSizeChanged(int w, int h, int ow, int oh) {
        super.onSizeChanged(w, h, ow, oh);
        u = Math.min(w, h) / 100f;
        cx = w / 2f;
        cy = h / 2f;
    }

    // ================= 绘制 =================

    @Override
    protected void onDraw(Canvas c) {
        if (u <= 0f) return;
        float now = (SystemClock.uptimeMillis() - t0) / 1000f;

        // 开心回落：1.6s 内从 1 衰减到 0
        cheer = Math.max(0f, cheer - 0.0125f);

        float breath = (float) Math.sin(now * TWO_PI / 3.2f);          // 呼吸
        float bob = (float) Math.sin(now * TWO_PI / 2.8f);             // 浮沉
        float wag = (float) Math.sin(now * TWO_PI / 1.15f);            // 摆尾
        float swayL = (float) Math.sin(now * TWO_PI / 2.4f);
        float swayR = (float) Math.sin(now * TWO_PI / 2.4f + 1.1f);    // 相位错开

        // 眨眼：每 3.4s 一次，闭眼 130ms（困倦时周期缩短到 2.2s）
        float period = 3.4f - drowsy * 1.2f;
        float ph = now % period;
        float eyeOpen = (ph < 0.13f && ph > 0.04f) ? 0.08f : 1f;
        if (drowsy > 0.5f && (now % 7.0f) < 0.13f) eyeOpen = 0.08f;      // 偶发长眨

        // 绘制坐标以画布顶端为原点，而窗口是"高 > 宽"，不居中角色会整体偏上、底部留白
        c.save();
        c.translate(0, (getHeight() - 100f * u) / 2f);

        drawGlow(c);
        c.save();
        c.translate(0, bob * 1.1f * u);
        drawTail(c, wag);
        drawHairBack(c, swayL, swayR);
        drawBody(c, breath);
        drawArms(c, breath);
        drawHead(c);
        drawFace(c, eyeOpen);
        drawHeaddress(c);
        c.restore();
        c.restore();

        if (cheer > 0.02f) drawSpout(c, now);
        if (drowsy > 0.35f) drawZ(c, now);
    }

    /** 角色背后的柔光，让她在任意壁纸上都读得出来。 */
    private void drawGlow(Canvas c) {
        float rad = 36f * u;
        p.reset();
        p.setAntiAlias(true);
        p.setShader(new RadialGradient(cx, cy + 4f * u, rad,
                new int[]{C_GLOW, 0x0080D8F0}, null, Shader.TileMode.CLAMP));
        c.drawCircle(cx, cy + 4f * u, rad, p);
        p.setShader(null);
    }

    /** 鲸尾：在身体后方的扇形尾鳍，绕根部摆动。 */
    private void drawTail(Canvas c, float wag) {
        float ty = 88f;
        c.save();
        c.translate(cx, ty * u);
        c.rotate(wag * 10f);
        c.translate(-cx, -ty * u);

        p.reset();
        p.setAntiAlias(true);
        p.setShader(new LinearGradient(0, (ty - 6) * u, 0, (ty + 14) * u,
                C_HAIR_LIGHT, C_HAIR_SHADE, Shader.TileMode.CLAMP));
        path.reset();
        path.moveTo(cx, (ty - 4f) * u);
        path.quadTo(cx - 13f * u, (ty - 9f) * u, cx - 20f * u, (ty - 3f) * u);
        path.quadTo(cx - 14f * u, (ty + 2f) * u, cx - 17f * u, (ty + 9f) * u);
        path.quadTo(cx - 9f * u, (ty + 6f) * u, cx, (ty + 5f) * u);
        path.quadTo(cx + 9f * u, (ty + 6f) * u, cx + 17f * u, (ty + 9f) * u);
        path.quadTo(cx + 14f * u, (ty + 2f) * u, cx + 20f * u, (ty - 3f) * u);
        path.quadTo(cx + 13f * u, (ty - 9f) * u, cx, (ty - 4f) * u);
        path.close();
        c.drawPath(path, p);
        p.setShader(null);

        // 尾鳍分缝
        stroke.setColor(0x55708FB0);
        stroke.setStrokeWidth(1.1f * u);
        c.drawLine(cx, (ty - 2f) * u, cx, (ty + 4f) * u, stroke);
        c.restore();
    }

    /** 后发：两侧长发，构成"鲸尾"般的发梢轮廓。 */
    private void drawHairBack(Canvas c, float swayL, float swayR) {
        p.reset();
        p.setAntiAlias(true);
        p.setShader(new LinearGradient(0, 30f * u, 0, 92f * u,
                C_HAIR, C_HAIR_SHADE, Shader.TileMode.CLAMP));
        // 左
        c.save();
        c.translate(cx - 24f * u, 30f * u);
        c.rotate(swayL * 1.6f);
        c.translate(-(cx - 24f * u), -30f * u);
        path.reset();
        path.moveTo(cx - 30f * u, 34f * u);
        path.quadTo(cx - 36f * u, 60f * u, cx - 28f * u, 88f * u);
        path.quadTo(cx - 19f * u, 76f * u, cx - 18f * u, 40f * u);
        path.close();
        c.drawPath(path, p);
        c.restore();
        // 右
        c.save();
        c.translate(cx + 24f * u, 30f * u);
        c.rotate(swayR * 1.6f);
        c.translate(-(cx + 24f * u), -30f * u);
        path.reset();
        path.moveTo(cx + 30f * u, 34f * u);
        path.quadTo(cx + 36f * u, 60f * u, cx + 28f * u, 88f * u);
        path.quadTo(cx + 19f * u, 76f * u, cx + 18f * u, 40f * u);
        path.close();
        c.drawPath(path, p);
        c.restore();
        p.setShader(null);
    }

    /** 身体：女仆连衣裙（深海蓝 + 白围裙）。breath 驱动 Y 向呼吸缩放。 */
    private void drawBody(Canvas c, float breath) {
        p.reset();
        p.setAntiAlias(true);
        p.setShader(new LinearGradient(0, 60f * u, 0, 94f * u,
                C_DRESS, C_DRESS_SHADE, Shader.TileMode.CLAMP));
        path.reset();
        path.moveTo(cx - 15f * u, 62f * u);
        path.quadTo(cx - 24f * u, 78f * u, cx - 23f * u, 93f * u);
        path.lineTo(cx + 23f * u, 93f * u);
        path.quadTo(cx + 24f * u, 78f * u, cx + 15f * u, 62f * u);
        path.close();
        c.save();
        c.translate(cx, 62f * u);
        c.scale(1f, 1f + breath * 0.015f);
        c.translate(-cx, -62f * u);
        c.drawPath(path, p);

        // 白围裙
        p.setShader(new LinearGradient(0, 70f * u, 0, 93f * u,
                C_APRON, C_APRON_SHADE, Shader.TileMode.CLAMP));
        path.reset();
        path.moveTo(cx - 12f * u, 72f * u);
        path.quadTo(cx - 17f * u, 84f * u, cx - 16f * u, 93f * u);
        path.lineTo(cx + 16f * u, 93f * u);
        path.quadTo(cx + 17f * u, 84f * u, cx + 12f * u, 72f * u);
        path.close();
        c.drawPath(path, p);
        p.setShader(null);

        // 围裙胸口的小鲸鱼标记
        p.setColor(0xFF8FC4E0);
        c.drawCircle(cx, 80f * u, 2.6f * u, p);
        path.reset();
        path.moveTo(cx - 5f * u, 78.4f * u);
        path.quadTo(cx, 76.4f * u, cx + 5f * u, 78.4f * u);
        path.lineTo(cx, 81.4f * u);
        path.close();
        c.drawPath(path, p);
        c.restore();

        // 领结
        p.setColor(C_RIBBON);
        c.drawCircle(cx - 4.4f * u, 64.6f * u, 3.1f * u, p);
        c.drawCircle(cx + 4.4f * u, 64.6f * u, 3.1f * u, p);
        p.setColor(0xFF4E93B4);
        c.drawCircle(cx, 65.2f * u, 1.5f * u, p);
    }

    /** 双臂：贴身的小圆，随呼吸轻微反向摆动。 */
    private void drawArms(Canvas c, float breath) {
        p.reset();
        p.setAntiAlias(true);
        p.setColor(C_SKIN);
        float lift = breath * 0.8f;
        c.drawCircle(cx - 17.5f * u, (76f + lift) * u, 4.6f * u, p);
        c.drawCircle(cx + 17.5f * u, (76f - lift) * u, 4.6f * u, p);
        // 袖口
        p.setColor(C_APRON);
        c.drawCircle(cx - 17.5f * u, (73.4f + lift) * u, 3.6f * u, p);
        c.drawCircle(cx + 17.5f * u, (73.4f - lift) * u, 3.6f * u, p);
    }

    /** 头部：圆脸 + 刘海。 */
    private void drawHead(Canvas c) {
        p.reset();
        p.setAntiAlias(true);
        // 脸
        p.setShader(new RadialGradient(cx - 6f * u, 34f * u, 32f * u,
                C_SKIN, C_SKIN_SHADE, Shader.TileMode.CLAMP));
        c.drawCircle(cx, 40f * u, 25f * u, p);
        p.setShader(null);

        // 刘海：齐刘海 + 两侧短鬓
        p.setShader(new LinearGradient(0, 12f * u, 0, 44f * u,
                C_HAIR_LIGHT, C_HAIR, Shader.TileMode.CLAMP));
        path.reset();
        path.moveTo(cx - 25f * u, 40f * u);
        path.arcTo(cx - 27f * u, 10f * u, cx + 27f * u, 10f * u, false);
        path.lineTo(cx + 25f * u, 40f * u);
        // 齐刘海下缘：三段微弧，避免"锅盖头"
        path.quadTo(cx + 16f * u, 32f * u, cx + 8f * u, 36f * u);
        path.quadTo(cx, 30f * u, cx - 8f * u, 36f * u);
        path.quadTo(cx - 16f * u, 32f * u, cx - 25f * u, 40f * u);
        path.close();
        c.drawPath(path, p);
        p.setShader(null);
    }

    /** 五官：眼睛（含眨眼与困倦）、腮红、嘴。 */
    private void drawFace(Canvas c, float eyeOpen) {
        float lid = eyeOpen;
        // 困倦：眼型整体下垂 1.2px
        float lidDy = drowsy * 1.2f * u;
        for (int s = -1; s <= 1; s += 2) {
            float ex = cx + s * 8.6f * u;
            float ey = 42.2f * u + lidDy;
            if (lid < 0.3f) {
                // 闭眼：一条向下的弧
                stroke.setColor(C_INK);
                stroke.setStrokeWidth(1.5f * u);
                path.reset();
                path.moveTo(ex - 4.2f * u, ey - 0.4f * u);
                path.quadTo(ex, ey + 2.6f * u, ex + 4.2f * u, ey - 0.4f * u);
                c.drawPath(path, stroke);
                continue;
            }
            // 眼白
            p.reset();
            p.setAntiAlias(true);
            p.setColor(0xFFFFFFFF);
            r.set(ex - 5f * u, ey - 5.4f * lid * u, ex + 5f * u, ey + 5.4f * lid * u);
            c.drawOval(r, p);
            // 虹膜（开心时瞳孔上移，显得雀跃）
            float iy = ey + (cheer - 0.5f) * 1.2f * u;
            p.setShader(new LinearGradient(0, iy - 4.5f * u, 0, iy + 4.5f * u,
                    C_IRIS, 0xFF7FC4E8, Shader.TileMode.CLAMP));
            c.drawCircle(ex, iy, 4.1f * u, p);
            p.setShader(null);
            // 高光
            p.setColor(0xFFFFFFFF);
            c.drawCircle(ex - 1.4f * u, iy - 1.6f * u, 1.5f * u, p);
            // 上眼线
            stroke.setColor(C_INK);
            stroke.setStrokeWidth(1.7f * u);
            path.reset();
            path.moveTo(ex - 5f * u, ey - 4.2f * lid * u);
            path.quadTo(ex, ey - 6.6f * lid * u, ex + 5f * u, ey - 4.2f * lid * u);
            c.drawPath(path, stroke);
        }

        // 腮红
        p.setColor(0x44FF9FB4);
        c.drawCircle(cx - 15f * u, 48.5f * u, 3.6f * u, p);
        c.drawCircle(cx + 15f * u, 48.5f * u, 3.6f * u, p);

        // 嘴：平静为小 "ω"，开心为上扬弧
        stroke.setColor(C_INK);
        stroke.setStrokeWidth(1.4f * u);
        path.reset();
        float my = 51.6f * u;
        if (cheer > 0.25f) {
            path.moveTo(cx - 3.4f * u, my);
            path.quadTo(cx, my + 3.4f * u, cx + 3.4f * u, my);
        } else {
            path.moveTo(cx - 2.4f * u, my);
            path.quadTo(cx, my + 2.2f * u, cx + 2.4f * u, my);
        }
        c.drawPath(path, stroke);
    }

    /** 女仆头饰：白色荷叶边 + 海蓝蝴蝶结。 */
    private void drawHeaddress(Canvas c) {
        p.reset();
        p.setAntiAlias(true);
        // 荷叶边
        p.setShader(new LinearGradient(0, 12f * u, 0, 28f * u,
                C_APRON, C_APRON_SHADE, Shader.TileMode.CLAMP));
        path.reset();
        path.moveTo(cx - 22f * u, 24f * u);
        path.quadTo(cx - 24f * u, 13f * u, cx - 11f * u, 12.5f * u);
        path.quadTo(cx, 10f * u, cx + 11f * u, 12.5f * u);
        path.quadTo(cx + 24f * u, 13f * u, cx + 22f * u, 24f * u);
        // 下缘：三段扇贝
        path.quadTo(cx + 14f * u, 28.5f * u, cx + 7.3f * u, 24.5f * u);
        path.quadTo(cx, 29.5f * u, cx - 7.3f * u, 24.5f * u);
        path.quadTo(cx - 14f * u, 28.5f * u, cx - 22f * u, 24f * u);
        path.close();
        c.drawPath(path, p);
        p.setShader(null);

        // 蝴蝶结
        float flutter = (float) Math.sin(SystemClock.uptimeMillis() / 1000f * TWO_PI / 1.6f) * 0.6f;
        c.save();
        c.translate(cx + 17f * u, 17.5f * u);
        c.rotate(flutter);
        p.setColor(C_RIBBON);
        c.drawCircle(-4.2f * u, 0f, 3.2f * u, p);
        c.drawCircle(4.2f * u, 0f, 3.2f * u, p);
        p.setColor(0xFF4E93B4);
        c.drawCircle(0f, 0f, 1.6f * u, p);
        c.restore();
    }

    /** 开心时头顶冒出的小水珠（鲸鱼的水喷气）。 */
    private void drawSpout(Canvas c, float now) {
        float k = cheer;
        float rise = (1f - k) * 26f * u;
        float alpha = (int) (255 * Math.min(1f, k * 1.6f));
        p.reset();
        p.setAntiAlias(true);
        p.setColor(withAlpha(C_HAIR_LIGHT, alpha));
        float dx = (float) Math.sin(now * 5f) * 2.4f * u;
        c.drawCircle(cx + 8f * u + dx, 12f * u - rise, 3.1f * u, p);
        c.drawCircle(cx + 14f * u + dx, 19f * u - rise * 0.7f, 1.8f * u, p);
    }

    /** 深夜困倦时冒的 z。 */
    private void drawZ(Canvas c, float now) {
        float k = (now % 2.4f) / 2.4f;
        p.reset();
        p.setAntiAlias(true);
        p.setTextSize(9f * u);
        p.setTypeface(android.graphics.Typeface.DEFAULT_BOLD);
        p.setColor(withAlpha(C_HAIR_LIGHT, (int) (200 * (1f - k) * drowsy)));
        c.drawText("z", cx + 26f * u + k * 6f * u, 26f * u - k * 16f * u, p);
        p.setTextSize(6.5f * u);
        p.setColor(withAlpha(C_HAIR_LIGHT, (int) (160 * (1f - k) * drowsy)));
        c.drawText("z", cx + 32f * u + k * 9f * u, 18f * u - k * 20f * u, p);
    }

    private static int withAlpha(int color, int alpha) {
        return (color & 0x00FFFFFF) | (Math.max(0, Math.min(255, alpha)) << 24);
    }
}
