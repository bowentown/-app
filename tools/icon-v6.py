#!/usr/bin/env python3
"""极光睡眠 · 启动图标生成器 v6（弯刀新月 + 水面镜像倒影 + 繁星）
输出：图标 512、全密度 mipmap（legacy/round/前景）、PWA、maskable、品牌启动屏
用法：python3 tools/icon-v6.py
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
    # 缩小用盒式平均，放大用最近邻（均不会越界或除零）
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

# ===== 几何：弯刀月牙整体缩放 0.82，落进自适应安全圆 =====
SC = 0.82
CCX, CCY = 256, 266
def sc(v, base): return base + (v - base) * SC

C1X, C1Y, R1 = sc(235, CCX), sc(218, CCY), 155 * SC   # 主圆
C2X, C2Y, R2 = sc(345, CCX), sc(168, CCY), 142 * SC   # 咬合圆（开口朝右上）
WATERLINE = sc(396, CCY)                               # 水面线
STARS = tuple((sc(sx, CCX), sc(sy, CCY), sr * SC, sa) for sx, sy, sr, sa in
              ((92,74,2.6,0.9),(180,44,2.0,0.7),(300,36,2.8,0.85),(408,66,2.2,0.8),
               (452,140,2.0,0.55),(66,140,1.9,0.5),(252,72,1.7,0.55)))
# 倒影线（7 条，镜像月牙，随深度变短变淡变碎）
RIPPLE_LINES = tuple(
    dict(y=sc(y, CCY), comp=1.5 + i * 0.55, wave=(2.0 + i * 0.8) * SC, fade=(0.85 - i * 0.11) * 0.9)
    for i, y in enumerate((402, 413, 425, 438, 452, 466, 480))
)

# ===== 渲染 =====
def crescent(x, y):
    d1 = math.sqrt((x - C1X) ** 2 + (y - C1Y) ** 2)
    d2 = math.sqrt((x - C2X) ** 2 + (y - C2Y) ** 2)
    return d1 <= R1 and d2 > R2

LIT_LO = (168, 230, 255); LIT_MID = (96, 190, 245); LIT_HI = (37, 99, 235)
TOP = (6, 11, 26); BOT = (3, 6, 15)

rows = []
for y in range(S):
    row = [None] * S
    ty = y / S
    base_r = lerp(TOP[0], BOT[0], ty); base_g = lerp(TOP[1], BOT[1], ty); base_b = lerp(TOP[2], BOT[2], ty)
    for x in range(S):
        r, g, b = base_r, base_g, base_b
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
        # 繁星（柔光点）
        for sx, sy, sr, sa in STARS:
            dxs, dys = x - sx, y - sy
            dd = math.sqrt(dxs * dxs + dys * dys)
            if dd < sr * 3.2:
                f = math.exp(-(dd * dd) / (2 * sr * 0.8 * sr * 0.8)) * sa
                r += (255 - r) * f; g += (255 - g) * f; b += (255 - b) * f
        # 暗角
        vx, vy = (x / S - 0.5) * 2, (y / S - 0.5) * 2
        vig = 1 - 0.30 * (vx * vx + vy * vy)
        r *= vig; g *= vig; b *= vig
        row[x] = (clamp(r, 0, 255), clamp(g, 0, 255), clamp(b, 0, 255))
    rows.append(row)

# ===== 第二遍：水面镜像倒影线（细波浪线，镜像月牙采样）=====
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
print('✓ 图标 v6 全套输出完成')
