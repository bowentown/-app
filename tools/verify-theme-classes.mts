/**
 * 护栏：主题契约完整性。四套主题必须槽位一一对齐、非空，且
 * accentFg 槽位存在（对比度契约，见 verify-contrast）。
 * accentBg 槽位禁止携带 text-white——前景色必须走 accentFg。
 */
import { APP_THEMES } from '../src/utils/themeStyles.ts';

const themes = Object.entries(APP_THEMES);
if (themes.length === 0) throw new Error('APP_THEMES 为空');

const refKeys = Object.keys(themes[0][1]).sort();
const problems: string[] = [];
for (const [name, theme] of themes) {
  const keys = Object.keys(theme).sort();
  if (keys.join(',') !== refKeys.join(',')) {
    problems.push(`${name}: 槽位与其他主题不一致（${keys.length} vs ${refKeys.length}）`);
  }
  for (const [k, v] of Object.entries(theme)) {
    if (typeof v !== 'string' || v.trim() === '') problems.push(`${name}.${k}: 空值`);
  }
  if (!('accentFg' in theme)) problems.push(`${name}: 缺 accentFg 槽位`);
  if (theme.accentBg.includes('text-white')) problems.push(`${name}.accentBg: 携带 text-white（前景色必须走 accentFg）`);
}
if (problems.length > 0) {
  console.error('✗ 主题契约违规：');
  for (const p of problems) console.error('  ' + p);
  process.exit(1);
}
console.log(`✓ verify-theme-classes：${themes.length} 套主题 × ${refKeys.length} 槽位全部对齐`);
