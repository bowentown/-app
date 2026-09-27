#!/usr/bin/env python3
"""极光睡眠 · 启动图标生成器 v7（弯刀新月 + 极光帘幕 + 有意图的繁星）
输出：图标 512、全密度 mipmap（legacy/round/前景）、PWA、maskable、品牌启动屏
用法：python3 tools/icon-v7.py
"""
import math, struct, zlib, os
import random as rnd

S = 512
def lerp(a, b, t): return a + (b - a) * t
def clamp(v, lo, hi): return max(lo, min(hi, v))
def smooth(a, b, x):
    t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t)

def write_png_rgb(path, w, h, rows):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    raw = b''.join(b'\x00' + bytes(int(c) for px in row for c in px) for row in rows)
    def chunk(t, d): return struct.pack('>I', len(d)) + t + d + struct.pack('>I', zlib.crc32(t + d) & 0xffffffff)
    png = b'\x89PNG\r\n\x1a\n' + chunk(b'IHDR', struct.pack('>IIBBBBB', w, h, 8, 2, 0, 0, 0)) + chunk(b'IDAT', zlib.compress(raw, 9)) + chunk(b'IEND', b'')
    open(path, 'wb').write(png)
def area_resize(img, sw, sh, tw, th):
    # 缩小用盒式平均，放大用最近邻（均不越界、不除零）
    out = []
    if tw <= sw and th <= sh:
        xr, yr = sw / tw, sh / th
        for ty in range(th):
            sy0, sy1 = int(ty * yr), min(sh, int((ty + 1) * yr))
            row = []
            for tx in range(tw):
                sx0, sx1 = int(tx * xr), min(sw, int((tx + 1) * xr))
                acc = [0.0, 0.0, 0.0]; n = 0
                for sy in range(sy0, sy1):
                    for sx in range(sx0, sx1):
                        px = img[sy][sx]; acc[0] += px[0]; acc[1] += px[1]; acc[2] += px[2]; n += 1
                row.append((acc[0] / n, acc[1] / n, acc[2] / n))
            out.append(row)
        return out
    for ty in range(th):
        sy = min(sh - 1, int(ty * sh / th))
        src = img[sy]
        row = []
        for tx in range(tw):
            sx = min(sw - 1, int(tx * sw / tw))
            row.append(src[sx])
        out.append(row)
    return out

# ===== 几何：弯刀月牙缩放 0.82 落进安全圆 =====
SC = 0.82
CCX, CCY = 256, 266
def sc(v, base): return base + (v - base) * SC

C1X, C1Y, R1 = sc(235, CCX), sc(218, CCY), 155 * SC
C2X, C2Y, R2 = sc(345, CCX), sc(168, CCY), 142 * SC
WATERLINE = sc(396, CCY)
LIT_LO = (168, 230, 255); LIT_MID = (96, 190, 245); LIT_HI = (37, 99, 235)
TOP = (6, 11, 26); BOT = (3, 6, 15)

def crescent(x, y):
    d1 = math.sqrt((x - C1X) ** 2 + (y - C1Y) ** 2)
    d2 = math.sqrt((x - C2X) ** 2 + (y - C2Y) ** 2)
    return d1 <= R1 and d2 > R2

# ===== 极光帘幕：弯曲带 + 垂直光柱纹理（青绿→紫，饱和）=====
# 带：沿从左下到右上的弧线，高斯横截面，两层（核心亮 + 外围晕）
AUR_P0 = (-60, 470)          # 弧线起点
AUR_D = (1.0, -0.62)         # 弧线方向（右上）
AUR_DN = math.sqrt(AUR_D[0]**2 + AUR_D[1]**2)
AUR_D = (AUR_D[0]/AUR_DN, AUR_D[1]/AUR_DN)
AUR_LEN = 700
AUR_CORE_SIGMA = 30
AUR_GLOW_SIGMA = 85
AUR_CURVE = 46               # 弧线弯曲幅度

def aurora_alpha(x, y):
    vx, vy = x - AUR_P0[0], y - AUR_P0[1]
    t = (vx * AUR_D[0] + vy * AUR_D[1]) / AUR_LEN          # 沿带 0..1+
    if t < -0.05 or t > 1.15:
        return 0.0, 0.0, 0.0
    px_, py_ = AUR_P0[0] + AUR_D[0] * t * AUR_LEN, AUR_P0[1] + AUR_D[1] * t * AUR_LEN
    curve_off = math.sin(t * 2.6) * AUR_CURVE               # 弧线弯曲
    perp = math.sqrt((x - px_ + AUR_D[1]*curve_off) ** 2 + (y - py_ - AUR_D[0]*curve_off) ** 2) \
           if False else abs((x - px_) * (-AUR_D[1]) + (y - py_) * (AUR_D[0])) - curve_off * math.sin(t * 5.0)
    core = math.exp(-(perp * perp) / (2 * AUR_CORE_SIGMA * AUR_CORE_SIGMA))
    glow = math.exp(-(perp * perp) / (2 * AUR_GLOW_SIGMA * AUR_GLOW_SIGMA))
    # 垂直光柱纹理（极光特色）：沿带方向的条纹调制
    ray = 0.72 + 0.28 * math.sin(t * AUR_LEN * 0.045 + math.sin(t * 3.1) * 2.0)
    env = smooth(-0.02, 0.12, t) * smooth(1.02, 0.88, t)     # 两端渐隐
    a_core = core * 0.42 * ray * env
    a_glow = glow * 0.20 * env
    # 颜色：青绿 → 紫 沿带渐变
    ct = clamp(t * 1.2, 0, 1)
    cr = lerp(52, 167, ct); cg = lerp(224, 121, ct); cb = lerp(198, 246, ct)
    return a_core, a_glow, (cr, cg, cb)

# ===== 渲染 =====
rows = []
for y in range(S):
    row = [None] * S
    ty = y / S
    base_r = lerp(TOP[0], BOT[0], ty); base_g = lerp(TOP[1], BOT[1], ty); base_b = lerp(TOP[2], BOT[2], ty)
    for x in range(S):
        r, g, b = base_r, base_g, base_b
        # 极光帘幕（在月牙后方，先绘制）
        a_core, a_glow, (ar, ag, ab) = aurora_alpha(x, y)
        r = lerp(r, ar, min(1, a_core + a_glow)); g = lerp(g, ag, min(1, a_core + a_glow)); b = lerp(b, ab, min(1, a_core + a_glow))
        # 弯刀月牙
        if crescent(x, y):
            d1 = math.sqrt((x - C1X) ** 2 + (y - C1Y) ** 2)
            tt = clamp((y - (C1Y - R1)) / (2 * R1), 0, 1)
            if tt < 0.45:
                k = tt / 0.45
                cr, cg, cb = lerp(LIT_HI[0], LIT_MID[0], k), lerp(LIT_HI[1], LIT_MID[1], k), lerp(LIT_HI[2], LIT_MID[2], k)
            else:
                k = (tt - 0.45) / 0.55
                cr, cg, cb = lerp(LIT_MID[0], LIT_LO[0], k), lerp(LIT_MID[1], LIT_LO[1], k), lerp(LIT_MID[2], LIT_LO[2], k)
            edge = smooth(R1, R1 - 7, d1)
            d2 = math.sqrt((x - C2X) ** 2 + (y - C2Y) ** 2)
            edge2 = smooth(R2, R2 + 6, d2)
            m = edge * edge2
            r = lerp(r, cr, m); g = lerp(g, cg, m); b = lerp(b, cb, m)
        # 暗角
        vx, vy = (x / S - 0.5) * 2, (y / S - 0.5) * 2
        vig = 1 - 0.30 * (vx * vx + vy * vy)
        r *= vig; g *= vig; b *= vig
        row[x] = (clamp(r, 0, 255), clamp(g, 0, 255), clamp(b, 0, 255))
    rows.append(row)

# ===== 水面镜像倒影：细波浪线（镜像月牙，随深度变碎变淡）=====
WATERLINE = sc(396, CCY)
RIPPLE_LINES = tuple(
    dict(y=sc(y, CCY), comp=1.5 + i * 0.55, wave=(2.0 + i * 0.8) * SC, fade=(0.85 - i * 0.11) * 0.9)
    for i, y in enumerate((402, 413, 425, 438, 452, 466, 480))
)
for ln in RIPPLE_LINES:
    yi = int(ln['y']); comp = ln['comp']; wave = ln['wave']; fade = ln['fade']
    src_y = WATERLINE - (yi - WATERLINE) * comp
    if not (0 <= src_y < S):
        continue
    for x in range(S):
        xw = x + math.sin(x * 0.045 + yi * 0.21) * wave
        if crescent(xw, src_y):
            px = rows[yi][x]
            rows[yi][x] = (lerp(px[0], 168, fade), lerp(px[1], 230, fade), lerp(px[2], 255, fade))

# ===== 繁星：追随月牙开口弧线，1 主星芒 + 2 点缀 =====
def add_sparkle(cx, cy, size, amp):
    for y in range(int(cy - size * 2.6), int(cy + size * 2.6) + 1):
        for x in range(int(cx - size * 2.6), int(cx + size * 2.6) + 1):
            dx, dy = abs(x - cx), abs(y - cy)
            d = math.sqrt(dx) + math.sqrt(dy)
            px = rows[y][x]
            if d <= math.sqrt(size) * 1.9:
                f = (1 - d / (math.sqrt(size) * 1.9)) ** 1.6 * amp
                rows[y][x] = (clamp(px[0] + 255 * f, 0, 255), clamp(px[1] + 250 * f, 0, 255), clamp(px[2] + 230 * f, 0, 255))
            elif math.sqrt(dx * dx + dy * dy) < size * 1.2:
                f = math.exp(-(dx * dx + dy * dy) / (2 * 8 * 8)) * amp * 0.5
                rows[y][x] = (clamp(px[0] + 255 * f, 0, 255), clamp(px[1] + 250 * f, 0, 255), clamp(px[2] + 230 * f, 0, 255))

add_sparkle(330, 120, 24, 1.0)    # 主星芒（月牙开口上方）
add_sparkle(160, 118, 12, 0.55)   # 点缀一
add_sparkle(408, 214, 11, 0.45)   # 点缀二

# ===== 输出 =====
write_png_rgb('native-resources/icon-512.png', S, S, rows)
write_png_rgb('public/pwa-512x512.png', S, S, rows)
write_png_rgb('public/pwa-192x192.png', 192, 192, area_resize(rows, S, S, 192, 192))
small = area_resize(rows, S, S, 400, 400)
canvas = [[(6/255, 11/255, 26/255) for _ in range(512)] for _ in range(512)]
off = (512 - 400) // 2
for y in range(400):
    for x in range(400):
        canvas[off + y][off + x] = small[y][x]
write_png_rgb('public/pwa-maskable-512x512.png', 512, 512, canvas)
write_png_rgb('public/pwa-maskable-192x192.png', 192, 192, area_resize(canvas, 512, 512, 192, 192))

for d, size in (('mdpi', 48), ('hdpi', 72), ('xhdpi', 96), ('xxhdpi', 144), ('xxxhdpi', 192)):
    write_png_rgb(f'native-resources/mipmap-{d}/ic_launcher.png', size, size, area_resize(rows, S, S, size, size))
    write_png_rgb(f'native-resources/mipmap-{d}/ic_launcher_round.png', size, size, area_resize(rows, S, S, size, size))

# 品牌启动屏（构图居中 + 星点）
sml = area_resize(rows, S, S, 620, 620)
SPW, SPH = 1080, 2400
sp = [[(0x07/255, 0x0a/255, 0x12/255) for _ in range(SPW)] for _ in range(SPH)]
ox, oy = (SPW - 620) // 2, int(SPH * 0.40) - 310
for y in range(620):
    for x in range(620):
        px = sml[y][x]
        base = sp[oy + y][ox + x]
        sp[oy + y][ox + x] = (px[0], px[1], px[2], 1.0)
rr = rnd.Random(7)
for _ in range(50):
    sx, sy = int(rr.random() * SPW), int(rr.random() * SPH * 0.7)
    rad = 1.2 + rr.random() * 1.6; amp = 0.2 + rr.random() * 0.4
    for y in range(max(0, sy - 5), min(SPH, sy + 6)):
        for x in range(max(0, sx - 5), min(SPW, sx + 6)):
            d = math.sqrt((x - sx) ** 2 + (y - sy) ** 2)
            f = math.exp(-(d * d) / (2 * rad * rad * 0.35)) * amp
            px = sp[y][x]
            sp[y][x] = (clamp(px[0] + 255 * f, 0, 1), clamp(px[1] + 255 * f, 0, 1), clamp(px[2] + 255 * f, 0, 1))
write_png_rgb('native-resources/splash.png', SPW, SPH, sp)
print('✓ 图标 v7 全套输出完成')
