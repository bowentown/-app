/**
 * 护栏：旧 WebView 颜色兼容（oklch / in oklab 零残留）。
 *
 * 背景：Tailwind v4 默认调色板是 oklch()，渐变工具类带 "in oklab" 插值，
 * 两者都需要 Chrome 111+。项目目标用户多为国内安卓，WebView 版本经常
 * 落后；旧内核上 CSS 变量不做取值校验，oklch 代入 background-color 的
 * 那一刻失效 → 背景透明（文字则继承父色，偏色不易察觉）——
 * 第 12 轮真机上"信封/弹窗/按钮背景全消失"就是这个根因。
 *
 * 修法（本护栏守护的现状）：
 *  - index.css 的 @theme 把全部用到的调色板覆盖为字面 hex；
 *  - 同名渐变工具类在后文重新声明 --tw-gradient-position（无 in oklab）。
 *
 * 判定（对构建产物，不看源码）：
 *  1. 全产物零 oklch( ；
 *  2. 每个 .bg-gradient-to-* 选择器取【最后一次】出现的规则（层叠生效者），
 *     其声明不得含 in oklab。
 *
 * 方法论约束：护栏必须能反向验证——构造含 oklch 的假产物必须报红。
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const DIST = join(fileURLToPath(new URL('../dist', import.meta.url)), 'assets');

const cssFiles = readdirSync(DIST).filter((f) => f.endsWith('.css')).map((f) => join(DIST, f));
if (cssFiles.length === 0) {
  console.error('✗ verify-no-oklch：dist/assets 下没有 CSS 产物（先 npm run build）');
  process.exit(1);
}

let failures = 0;
for (const file of cssFiles) {
  const css = readFileSync(file, 'utf-8');

  // 1) 零 oklch
  const oklchCount = (css.match(/oklch\(/g) || []).length;
  if (oklchCount > 0) {
    failures++;
    console.error(`✗ ${file.split('/').pop()}：残留 ${oklchCount} 处 oklch(（旧内核解析失败 → 背景透明）`);
    const sample = css.indexOf('oklch(');
    console.error('   首处上下文:', css.slice(Math.max(0, sample - 80), sample + 40).replace(/\n/g, ' '));
  }

  // 2) 渐变工具类按层叠取最后一条规则，不得含 in oklab
  const dirs = new Set([...css.matchAll(/\.bg-gradient-to-([a-z]+)\{/g)].map((m) => m[1]));
  for (const dir of dirs) {
    const selector = `.bg-gradient-to-${dir}{`;
    const last = css.lastIndexOf(selector);
    if (last === -1) continue;
    const block = css.slice(last, css.indexOf('}', last) + 1);
    if (block.includes('in oklab')) {
      failures++;
      console.error(`✗ ${file.split('/').pop()}：.bg-gradient-to-${dir} 最终生效声明仍含 in oklab（index.css 的覆盖未生效或顺序不对）`);
    }
  }
}

// 反向自检：含 oklch 的假产物必须被检出
const selfTestOk = (() => {
  const fake = '.x{background-color:var(--color-a)} .y{--c:oklch(50% 0 0)}';
  return (fake.match(/oklch\(/g) || []).length > 0;
})();
if (!selfTestOk) {
  failures++;
  console.error('✗ verify-no-oklch：自检失败（构造的 oklch 未被检出）');
}

if (failures > 0) {
  console.error('   处理：新增用色走 bg-[#hex] 字面值，或扩充 index.css 的 @theme 覆盖');
  process.exit(1);
}
console.log(`✓ verify-no-oklch：构建产物零 oklch、渐变插值全部兼容旧内核（${cssFiles.length} 个 CSS 文件）`);
