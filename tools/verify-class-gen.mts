/**
 * 护栏：源码里的类名必须在构建产物 CSS 里真实存在。
 *
 * 背景（第七轮报告§4）：Tailwind 4 只为"以字面量完整出现在源码里"的类名生成 CSS，
 * 于是 17 处缺陷静默失效——不存在的色阶（border-slate-850）、不存在的工具类
 * （pb-safe）、拼接类名（focus:${accentBorder}、${bg}/40、.replace('bg-','accent-')）。
 * 这一类缺陷构建零报错、此前没有任何护栏能拦。
 *
 * 方法：收集 src/**\/*.tsx 的 className 字面量与 themeStyles 槽位值，拆成 token，
 * 与 dist/assets/*.css 求交；"源码有、CSS 没有"即报红。
 * 已知近似：模板表达式里的标识符不算 token（变量类名先在主题槽位里核对）。
 * 运行时机：构建之后（CI 里排在 Build 之后）。
 */
import { readdirSync, statSync, readFileSync } from 'node:fs';
import { join, relative, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const SRC = join(ROOT, 'src');
const DIST = join(ROOT, 'dist', 'assets');

function listFiles(dir: string, ext: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) out.push(...listFiles(p, ext));
    else if (name.endsWith(ext)) out.push(p);
  }
  return out;
}

/** Tailwind 在 CSS 里的转义规则（我们只处理 token 里会出现的字符） */
const escapeForCss = (token: string): string =>
  '.' + token
    .replace(/[:/.\[\]#%&(),'"]/g, (ch) => '\\' + ch);

// ── 收集源码 token ──
const tokens = new Set<string>();
const addChunk = (chunk: string): void => {
  for (const t of chunk.split(/\s+/)) {
    const tok = t.trim();
    // 裸色名（如主题 accentColor 槽位的 indigo-500）不是类名，跳过
    if (/^[a-z]+-\d+$/.test(tok)) continue;
    if (/^[a-z][a-z0-9:\/\[\]#\.\-'"+()%_-]*$/i.test(tok) && tok.length >= 2) tokens.add(tok);
  }
};

for (const f of listFiles(SRC, '.tsx')) {
  const src = readFileSync(f, 'utf-8');
  // className="..." 与 className={'...'}
  for (const m of src.matchAll(/className="([^"]+)"/g)) addChunk(m[1]);
  // className={`...`}：取 ${...} 之外的字符串段
  for (const m of src.matchAll(/className=\{`([^`]+)`\}/g)) {
    addChunk(m[1].replace(/\$\{[^}]*\}/g, ' '));
  }
}
// 主题槽位值（拼接类名的源头都要在这里被核对到）；id/name/tag/desc 是标识符非类名
const themeSrc = readFileSync(join(SRC, 'utils', 'themeStyles.ts'), 'utf-8');
for (const m of themeSrc.matchAll(/(?:bg|text|border|ring|dot|selectionBg|accentBg|accentText|accentRing|accentBorder|focusRing|navBg|navBorder|navActiveBg|navActiveText|navInactiveText|pageBg|cardBg|cardInnerBg|cardInnerBorder): '([^']+)'/g)) {
  addChunk(m[1]);
}

// ── 构建产物 CSS ──
const cssFiles = listFiles(DIST, '.css');
if (cssFiles.length === 0) {
  console.error('✗ verify-class-gen：dist/assets 下没有 CSS——先 npm run build 再跑本护栏');
  process.exit(1);
}
const css = cssFiles.map((f) => readFileSync(f, 'utf-8')).join('\n');

// ── 比对 ──
const missing: string[] = [];
for (const tok of [...tokens].sort()) {
  if (css.includes(escapeForCss(tok))) continue;
  missing.push(tok);
}

if (missing.length > 0) {
  console.error(`✗ verify-class-gen：${missing.length} 个类名在构建产物中不存在（写了也白写）：`);
  for (const t of missing) console.error('  ' + t);
  console.error('  → 改成字面量 / 修正色阶 / 用内联样式；禁止在 className 里对主题槽位做字符串运算');
  process.exit(1);
}
console.log(`✓ verify-class-gen：${tokens.size} 个类名 token 全部在产物 CSS 中生效`);
