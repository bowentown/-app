#!/usr/bin/env python3
"""自适应前景 v8：完整复刻 icon-512 认可构图（弯刀月牙+水波+繁星），无极光环。
构图按 FSC 缩放并以内容 bbox 中心对齐画布中心 → 启动器安全圆内完整显示。"""
import math, struct, zlib, os

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

# ===== 构图参数：icon-512 原始坐标 → 居中缩放 =====
SC = 0.82
CCX, CCY = 256, 266
FSC = 0.88                       # 构图整体缩放（安全圆半径169：最远内容点≈164）
CXC, CYC = 267, 267              # 内容 bbox 中心（弯刀+波纹+星核），对齐画布中心
def T(vx, vy): return (256 + (vx - CXC) * FSC, 256 + (vy - CYC) * FSC)

C1X, C1Y = T(256 + (235 - 256) * SC, CCY + (218 - CCY) * SC)
C1R = 155 * SC * FSC
C2X, C2Y = T(256 + (345 - 256) * SC, CCY + (168 - CCY) * SC)
C2R = 142 * SC * FSC
WATERLINE = T(256, CCY + (396 - CCY) * SC)[1]
LIT_LO = (168, 230, 255); LIT_HI = (37, 99, 235)
TOP = (6, 11, 26); BOT = (3, 6, 15)

def crescent(x, y):
    d1 = math.sqrt((x - C1X) ** 2 + (y - C1Y) ** 2)
    d2 = math.sqrt((x - C2X) ** 2 + (y - C2Y) ** 2)
    return d1 <= C1R and d2 > C2R

# ===== 渲染（与 icon-v7 完全同序：底色→月牙→暗角）=====
rows = []
for y in range(S):
    row = [None] * S
    ty = y / S
    base_r = lerp(TOP[0], BOT[0], ty); base_g = lerp(TOP[1], BOT[1], ty); base_b = lerp(TOP[2], BOT[2], ty)
    for x in range(S):
        r, g, b = base_r, base_g, base_b
        if crescent(x, y):
            t = clamp(((x - (C1X - C1R)) + (y - (C1Y - C1R)) * 0.55) / (2 * C1R * 1.35), 0, 1)
            r, g, b = lerp(LIT_LO[0], LIT_HI[0], t), lerp(LIT_LO[1], LIT_HI[1], t), lerp(LIT_LO[2], LIT_HI[2], t)
        vx, vy = (x / S - 0.5) * 2, (y / S - 0.5) * 2
        vig = 1 - 0.30 * (vx * vx + vy * vy)
        r *= vig; g *= vig; b *= vig
        row[x] = (clamp(r, 0, 255), clamp(g, 0, 255), clamp(b, 0, 255))
    rows.append(row)

# ===== 水面镜像倒影（同 icon-v7，坐标经 T 变换）=====
RIPPLE_LINES = tuple(
    dict(y=T(256, CCY + (yy - CCY) * SC)[1], comp=1.5 + i * 0.55, wave=(2.0 + i * 0.8) * SC * FSC, fade=(0.95 - i * 0.09))
    for i, yy in enumerate((402, 413, 425, 438, 452, 466, 480))
)
for ln in RIPPLE_LINES:
    yi = int(ln['y']); comp = ln['comp']; wave = ln['wave']; fade = ln['fade']
    src_y = WATERLINE - (yi - WATERLINE) * comp
    if not (0 <= src_y < S):
        continue
    for x in range(S):
        xw = x + math.sin(x * 0.045 + yi * 0.21) * wave
        if crescent(xw, src_y):
            for dyi, wv in ((0, 1.0), (-1, 0.55), (1, 0.55)):
                yy2 = yi + dyi
                if not (0 <= yy2 < S):
                    continue
                px = rows[yy2][x]
                rows[yy2][x] = (lerp(px[0], 190, fade * wv), lerp(px[1], 240, fade * wv), lerp(px[2], 255, fade * wv))

# ===== 繁星（同 icon-v7 三颗，坐标经 T 变换）=====
def add_sparkle(cx, cy, size, amp):
    for y in range(max(0, int(cy - size * 2.6)), min(S, int(cy + size * 2.6) + 1)):
        for x in range(max(0, int(cx - size * 2.6)), min(S, int(cx + size * 2.6) + 1)):
            dx, dy = abs(x - cx), abs(y - cy)
            d = math.sqrt(dx) + math.sqrt(dy)
            px = rows[y][x]
            if d <= math.sqrt(size) * 1.9:
                f = (1 - d / (math.sqrt(size) * 1.9)) ** 1.6 * amp
                rows[y][x] = (clamp(px[0] + 255 * f, 0, 255), clamp(px[1] + 250 * f, 0, 255), clamp(px[2] + 230 * f, 0, 255))
            elif math.sqrt(dx * dx + dy * dy) < size * 1.2:
                f = math.exp(-(dx * dx + dy * dy) / (2 * 8 * 8)) * amp * 0.5
                rows[y][x] = (clamp(px[0] + 255 * f, 0, 255), clamp(px[1] + 250 * f, 0, 255), clamp(px[2] + 230 * f, 0, 255))

s1x, s1y = T(330, 120); s2x, s2y = T(160, 118); s3x, s3y = T(408, 214)
add_sparkle(s1x, s1y, 24 * FSC, 1.0)
add_sparkle(s2x, s2y, 12 * FSC, 0.55)
add_sparkle(s3x, s3y, 11 * FSC, 0.45)

# ===== 输出：master + 全密度前景 =====
write_png_rgb('native-resources/moon-fg-master.png', S, S, rows)
for d, size in (('mdpi', 108), ('hdpi', 162), ('xhdpi', 216), ('xxhdpi', 324), ('xxxhdpi', 432)):
    write_png_rgb(f'native-resources/mipmap-{d}/ic_launcher_foreground.png', size, size, area_resize(rows, S, S, size, size))
print(f'✓ fg v8 done (FSC={FSC}, C1=({C1X:.0f},{C1Y:.0f}) R{C1R:.0f}, C2=({C2X:.0f},{C2Y:.0f}) R{C2R:.0f}, WL={WATERLINE:.0f})')
