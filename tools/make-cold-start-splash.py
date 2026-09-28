#!/usr/bin/env python3
"""冷启动背景改为纯深色（#060B1A）：
原生 windowBackground 不再显示静止品牌图，WebView 起来后直接衔接
LaunchSplash 的三段式开屏动画（水滴→月亮→极光），观感连贯。
用法：python3 tools/make-cold-start-splash.py（CI 在 cap add 后调用）
"""
import struct
import zlib

def chunk(t, d):
    return struct.pack('>I', len(d)) + t + d + struct.pack('>I', zlib.crc32(t + d) & 0xffffffff)

w = h = 64
raw = b''.join(b'\x00' + bytes([6, 11, 26]) * w for _ in range(h))
png = (b'\x89PNG\r\n\x1a\n'
       + chunk(b'IHDR', struct.pack('>IIBBBBB', w, h, 8, 2, 0, 0, 0))
       + chunk(b'IDAT', zlib.compress(raw))
       + chunk(b'IEND', b''))

for p in ('android/app/src/main/res/drawable/splash.png',
          'android/app/src/main/res/drawable-night/splash.png'):
    open(p, 'wb').write(png)
print('cold-start splash -> solid dark (#060B1A)')
