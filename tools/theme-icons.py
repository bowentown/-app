#!/usr/bin/env python3
"""极光睡眠 · 四主题启动图标生成器
按 App 四主题月色渲染 4 套启动图标（legacy + 自适应前景），
并同步刷新默认（midnight）mipmap、PWA 图标与品牌启动屏。
用法：python3 tools/theme-icons.py
"""
import math, struct, zlib, os, random

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
def write_png_rgba(path, w, h, rows):
    raw = b''
    for row in rows:
        raw += b'\x00' + bytes(int(clamp(c, 0, 255)) for px in row for c in px)
    def chunk(t, d): return struct.pack('>I', len(d)) + t + d + struct.pack('>I', zlib.crc32(t + d) & 0xffffffff)
    png = b'\x89PNG\r\n\x1a\n' + chunk(b'IHDR', struct.pack('>IIBBBBB', w, h, 8, 6, 0, 0, 0)) + chunk(b'IDAT', zlib.compress(raw, 9)) + chunk(b'IEND', b'')
    open(path, 'wb').write(png)
def area_resize(img, sw, sh, tw, th):
    out = []; xr, yr = sw / tw, sh / th
    for ty in range(th):
        row = []
        for tx in range(tw):
            acc = [0.0, 0.0, 0.0]; n = 0
            for sy in range(int(ty * yr), min(sh, int((ty + 1) * yr))):
                for sx in range(int(tx * xr), min(sw, int((tx + 1) * xr))):
                    px = img[sy][sx]; acc[0] += px[0]; acc[1] += px[1]; acc[2] += px[2]; n += 1
            row.append((acc[0] / n, acc[1] / n, acc[2] / n))
        out.append(row)
    return out

# ===== 月亮几何（四主题共用）=====
C1X, C1Y, R1 = 235, 218, 155
C2X, C2Y, R2 = 345, 168, 142
WATERLINE = 396
STARS = ((92,74,2.6,0.9),(180,44,2.0,0.7),(300,36,2.8,0.85),(408,66,2.2,0.8),(452,140,2.0,0.55),(66,140,1.9,0.5),(252,72,1.7,0.55),(376,26,1.6,0.45))

# ===== 四主题月色调板 =====
# bg_top/bg_bot 背景 · lo/mid/hi 月牙受光渐变（下亮→上深）· refl 倒影色 · star 星色
PALETTES = {
    'midnight':    dict(bg_top=(6,11,26),   bg_bot=(3,6,15),   lo=(168,230,255), mid=(96,190,245), hi=(37,99,235),   refl=(148,224,255), star=(255,255,255), glow=(120,140,255)),
    'pure_dark':   dict(bg_top=(2,2,3),     bg_bot=(0,0,0),    lo=(241,245,249), mid=(148,163,184), hi=(71,85,105),   refl=(214,222,235), star=(255,255,255), glow=(90,100,120)),
    'warm_amber':  dict(bg_top=(26,17,11),  bg_bot=(5,3,2),    lo=(255,247,224), mid=(252,211,77), hi=(245,158,11),  refl=(252,211,120), star=(255,240,200), glow=(200,140,60)),
    'serene_blue': dict(bg_top=(4,20,31),   bg_bot=(2,8,13),   lo=(204,251,241), mid=(45,212,191), hi=(13,148,136),  refl=(153,246,228), star=(230,255,250), glow=(45,180,170)),
}

def render_theme(P):
    """渲染单主题 512 画布，返回 rows（0-255 RGB）"""
    random.seed(hash(theme_seed(P)) & 0xffff)
    noise = [(random.random() - 0.5) * 9 for _ in range(S * S)]
    ni = 0
    rows = []
    for y in range(S):
        row = [None] * S
        ty = y / S
        base_r = lerp(P['bg_top'][0], P['bg_bot'][0], ty)
        base_g = lerp(P['bg_top'][1], P['bg_bot'][1], ty)
        base_b = lerp(P['bg_top'][2], P['bg_bot'][2], ty)
        for x in range(S):
            r, g, b = base_r, base_g, base_b
            if crescent(x, y):
                d1 = math.sqrt((x - C1X) ** 2 + (y - C1Y) ** 2)
                tt = clamp((y - (C1Y - R1)) / (2 * R1), 0, 1)
                if tt < 0.45:
                    k = tt / 0.45
                    cr, cg, cb = lerp(P['hi'][0], P['mid'][0], k), lerp(P['hi'][1], P['mid'][1], k), lerp(P['hi'][2], P['mid'][2], k)
                else:
                    k = (tt - 0.45) / 0.55
                    cr, cg, cb = lerp(P['mid'][0], P['lo'][0], k), lerp(P['mid'][1], P['lo'][1], k), lerp(P['mid'][2], P['lo'][2], k)
                edge = smooth(R1, R1 - 7, d1)
                d2 = math.sqrt((x - C2X) ** 2 + (y - C2Y) ** 2)
                edge2 = smooth(R2, R2 + 6, d2)
                m = edge * edge2
                r = lerp(r, cr, m); g = lerp(g, cg, m); b = lerp(b, cb, m)
            else:
                d1 = math.sqrt((x - C1X) ** 2 + (y - C1Y) ** 2)
                if d1 <= R1 + 46:
                    gl = smooth(R1 + 46, R1, d1) * 0.15
                    r += (120 - r) * gl; g += (200 - g) * gl; b += (255 - b) * gl
            # 水面镜像倒影：细波浪线（采样月牙，随深度衰减）
            if y >= WATERLINE:
                depth = (y - WATERLINE) / (S - WATERLINE)
                src_y = WATERLINE - (y - WATERLINE) / 1.5
                if 0 <= src_y < S:
                    x_off = math.sin(y * 0.13 + 1.1) * (2 + depth * 9) + math.sin(y * 0.047 + 0.6) * (1.5 + depth * 6)
                    sx = int(x + x_off)
                    if 0 <= sx < S and crescent(sx, int(src_y)):
                        fade = (1 - depth * 0.9) * 0.7
                        r = lerp(r, P['refl'][0], fade); g = lerp(g, P['refl'][1], fade); b = lerp(b, P['refl'][2], fade)
            # 繁星
            st = P['star']
            for sx, sy, sr, sa in STARS:
                dxs, dys = x - sx, y - sy
                dd = math.sqrt(dxs * dxs + dys * dys)
                if dd < sr * 3.2:
                    f = math.exp(-(dd * dd) / (2 * sr * 0.8 * sr * 0.8)) * sa
                    r += (st[0] - r) * f; g += (st[1] - g) * f; b += (st[2] - b) * f
            # 暗角 + 噪点
            vx, vy = (x / S - 0.5) * 2, (y / S - 0.5) * 2
            vig = 1 - 0.32 * (vx * vx + vy * vy)
            r *= vig; g *= vig; b *= vig
            r += noise[ni]; g += noise[ni]; b += noise[ni]; ni += 1
            row[x] = (clamp(r, 0, 255), clamp(g, 0, 255), clamp(b, 0, 255))
        rows.append(row)
    return rows

def theme_seed(P):
    return P['bg_top'][0] + P['lo'][1] * 7 + P['hi'][2] * 13

def crescent(x, y):
    d1 = math.sqrt((x - C1X) ** 2 + (y - C1Y) ** 2)
    d2 = math.sqrt((x - C2X) ** 2 + (y - C2Y) ** 2)
    return d1 <= R1 and d2 > R2

# ===== 生成四主题图标集 =====
DENSITIES_LEGACY = (('mdpi', 48), ('hdpi', 72), ('xhdpi', 96), ('xxhdpi', 144), ('xxxhdpi', 192))
DENSITIES_FG = (('mdpi', 108), ('hdpi', 162), ('xhdpi', 216), ('xxhdpi', 324), ('xxxhdpi', 432))

for theme_id, P in PALETTES.items():
    rows = render_theme(P)
    out = f'native-resources/themes/{theme_id}'
    for d, size in DENSITIES_LEGACY:
        write_png_rgb(f'{out}/mipmap-{d}/ic_launcher_{theme_id}.png', size, size, area_resize(rows, S, S, size, size))
        write_png_rgb(f'{out}/mipmap-{d}/ic_launcher_round_{theme_id}.png', size, size, area_resize(rows, S, S, size, size))
    for d, size in DENSITIES_FG:
        write_png_rgb(f'{out}/mipmap-{d}/ic_launcher_foreground_{theme_id}.png', size, size, area_resize(rows, S, S, size, size))
    print(f'✓ {theme_id}: 15 个图标')

# ===== 自适应图标 XML（每主题一份，引用独立前景与底色）=====
os.makedirs('native-resources/adaptive', exist_ok=True)
bg_colors = {
    'midnight': '#060B1A', 'pure_dark': '#000000',
    'warm_amber': '#1A110B', 'serene_blue': '#04141F',
}
for theme_id in PALETTES:
    xml = (
        '<?xml version="1.0" encoding="utf-8"?>\n'
        '<adaptive-icon xmlns:android="http://schemas.android.com/apk/res/android">\n'
        f'    <background android:drawable="@color/somnacare_icon_bg_{theme_id}" />\n'
        f'    <foreground android:drawable="@mipmap/ic_launcher_foreground_{theme_id}" />\n'
        '</adaptive-icon>\n'
    )
    open(f'native-resources/adaptive/ic_launcher_{theme_id}.xml', 'w').write(xml)
print('✓ 自适应 XML ×4')
