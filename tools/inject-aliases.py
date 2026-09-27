#!/usr/bin/env python3
"""CI 工具：将主入口 LAUNCHER 意图移至 4 个 activity-alias（主题换图标机制）。
用法：python3 tools/inject-aliases.py <manifest路径>
- 移除 MainActivity 的 LAUNCHER intent-filter
- 注入 4 个 activity-alias（midnight 启用，其余停用），各绑定主题图标
"""
import re
import sys

MANIFEST = sys.argv[1] if len(sys.argv) > 1 else 'android/app/src/main/AndroidManifest.xml'
PKG = 'com.somnacare.sleep'
THEMES = (
    ('midnight', 'Midnight', 'true'),
    ('pure_dark', 'PureDark', 'false'),
    ('warm_amber', 'WarmAmber', 'false'),
    ('serene_blue', 'SereneBlue', 'false'),
)

src = open(MANIFEST, encoding='utf-8').read()

# 1) MainActivity 移除 LAUNCHER intent-filter（桌面入口改由 alias 承载）
pat = re.compile(
    r'(<activity\b[^>]*android:name="\.MainActivity"[^>]*>)'
    r'\s*<intent-filter>\s*'
    r'<action android:name="android\.intent\.action\.MAIN"\s*/>\s*'
    r'<category android:name="android\.intent\.category\.LAUNCHER"\s*/>\s*'
    r'</intent-filter>'
)
src, n = pat.subn(r'\1', src)
if n != 1:
    raise SystemExit(f'ERROR: MainActivity LAUNCHER intent-filter 匹配数={n}，预期 1')

# 2) 注入 4 个 activity-alias（</application> 前）
aliases = ''
for theme_id, suffix, enabled in THEMES:
    aliases += (
        f'<activity-alias android:name="{PKG}.MainActivity{suffix}" '
        f'android:enabled="{enabled}" android:exported="true" '
        f'android:icon="@mipmap/ic_launcher_{theme_id}" '
        f'android:roundIcon="@mipmap/ic_launcher_round_{theme_id}" '
        f'android:label="极光睡眠" android:targetActivity=".MainActivity">'
        '<intent-filter>'
        '<action android:name="android.intent.action.MAIN" />'
        '<category android:name="android.intent.category.LAUNCHER" />'
        '</intent-filter>'
        '</activity-alias>'
    )
src = src.replace('</application>', aliases + '</application>', 1)

open(MANIFEST, 'w', encoding='utf-8').write(src)
print(f'✓ 已注入 {len(THEMES)} 个 activity-alias')
