/**
 * 护栏：scale/rotate 独立变换属性的旧内核兼容（第 23 轮）。
 *
 * 背景：Tailwind v4 把 scale-* 和 rotate-* 编译成独立 CSS 属性 `scale:` / `rotate:`
 * （Chrome 104+ 才支持）。Android WebView 90–103 整条丢弃——呼吸引导球静止、
 * 首屏得分环从 3 点钟起画。与 oklch/translate 同一类的"构建产物在老内核静默失效"。
 *
 * 契约：src/index.css 的 `@supports not (scale: 1)` 块为每个用到的
 * scale/rotate 类提供 transform 回退。本护栏对照【构建产物 CSS】强制同步：
 * 产物里出现的每个 scale/rotate 类都必须在兼容块中有同名回退。
 * 方法论约束：护栏必须能反向验证——本文件内自检合成输入。
 */
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));

/** 类选择器 token（保留转义序列，逐 selector 提取首个类名）。 */
const CLASS_TOKEN = /\.((?:\\.|[\w\-\[\].])+)/g;

/**
 * 从 CSS 产物中收集所有"声明了独立 scale:/rotate: 属性"的类名（去转义，
 * 含 active: 等变体前缀）。transition-property 列表里的 "scale" 不算。
 */
export function collectScaleRotateClasses(css: string): string[] {
  const names = new Set<string>();
  const ruleRe = /([^{}]+)\{([^{}]*)\}/g;
  let m: RegExpExecArray | null;
  while ((m = ruleRe.exec(css)) !== null) {
    if (!/(^|[\s;])(scale|rotate):/.test(m[2])) continue;
    for (const sel of m[1].split(',')) {
      CLASS_TOKEN.lastIndex = 0;
      const tok = CLASS_TOKEN.exec(sel.trim());
      if (tok) names.add(tok[1].replace(/\\/g, ''));
    }
  }
  return [...names];
}

/** 收集 index.css 兼容块里覆盖到的类名（去转义）。兼容规则的特征：
 *  声明了 `scale: none`（把 Tailwind 的独立属性关掉，transform 接管）。
 *  注意不能用 "@supports not (scale: 1)" 定位——构建期优化器会整块剪掉。 */
export function collectCompatClasses(css: string): string[] {
  const names = new Set<string>();
  const ruleRe = /([^{}]+)\{([^{}]*)\}/g;
  let m: RegExpExecArray | null;
  while ((m = ruleRe.exec(css)) !== null) {
    if (!/(^|[\s;])scale:\s*none/.test(m[2])) continue;
    for (const sel of m[1].split(',')) {
      CLASS_TOKEN.lastIndex = 0;
      const tok = CLASS_TOKEN.exec(sel.trim());
      if (tok) names.add(tok[1].replace(/\\/g, ''));
    }
  }
  return [...names];
}

/** 返回"产物用到、但 compatCss 里没有回退"的类名。两个参数都应喂
 *  构建产物：本护栏要防的是【回退块本身被优化器剪掉】——用源码当回退
 *  清单会犯"检查对象 ≠ 要保护的对象"的错误（第 24 轮盲区修复）。 */
export function missingCompat(cssWithUsage: string, cssWithCompat: string): string[] {
  const used = collectScaleRotateClasses(cssWithUsage);
  const have = new Set(collectCompatClasses(cssWithCompat));
  return used.filter((n) => !have.has(n));
}

let failures = 0;
const check = (name: string, ok: boolean, detail = '') => {
  console.log(`${ok ? '✓' : '✗'} ${name}${detail ? '  ' + detail : ''}`);
  if (!ok) failures++;
};

// ── 1) 反向自检：合成输入必须能抓住"产物新增类、兼容块没跟上"的回归 ──
// 注意：合成类名必须动态拼出来——字面量会被 Tailwind v4 的源码扫描当成
// 真实类名生成进产物 CSS，护栏就会（正确地）报出它自己制造的回归
{
  const fakeBed = ['scale', '777'].join('-');           // 不是字面量
  const fakeRot = ['hover:rotate', '45'].join('-');
  const fakeRotSel = fakeRot.replace(':', '\\:') + ':hover';
  const fakeDist = `.scale-90{--tw-scale-x:90%;scale:var(--tw-scale-x)} .${fakeBed}{scale:777%} .${fakeRotSel}{rotate:45deg}`;
  const fakeCompat = '.scale-90 { scale: none; transform: scale(.9); }';
  const missing = missingCompat(fakeDist, fakeCompat);
  check('反向自检：坏输入（未覆盖的新类）被抓住',
    missing.includes(fakeBed) && missing.includes(fakeRot) && missing.length === 2,
    JSON.stringify(missing));
  check('反向自检：已覆盖类不误报', missingCompat('.scale-90{scale:90%}', fakeCompat).length === 0);
  // ★ 第 24 轮盲区的反向自检：产物里的回退块被剪掉（这正是本护栏存在的
  // 唯一理由）——此刻产物既是"用方"又是"回退方"，必须报红
  const stripped = '.scale-90{--tw-scale-x:90%;scale:var(--tw-scale-x)}';
  const caught = missingCompat(stripped, stripped);
  check('反向自检：产物回退被优化器剪掉 → 报红', caught.length === 1 && caught[0] === 'scale-90',
    JSON.stringify(caught));
  check('反向自检：transition-property 里的 scale 不算独立属性',
    collectScaleRotateClasses('.a{transition-property:transform,translate,scale,rotate}').length === 0);
}

// ── 2) 真实产物对照（用方与回退方都取自产物）──
{
  const distDir = new URL('../dist/assets', import.meta.url);
  let distCss = '';
  try {
    const files = readdirSync(distDir).filter((f) => f.endsWith('.css'));
    distCss = files.map((f) => readFileSync(new URL(`../dist/assets/${f}`, import.meta.url), 'utf8')).join('\n');
  } catch {
    console.log('○ 未找到 dist/（本地未构建）——跳过产物对照（CI 在 build 之后运行本护栏）');
  }
  if (distCss) {
    const missing = missingCompat(distCss, distCss);
    check('产物中每个 scale/rotate 类都有旧内核 transform 回退（回退取自产物）', missing.length === 0,
      missing.length ? `缺: ${missing.join(', ')}` : `${collectScaleRotateClasses(distCss).length} 个类全部覆盖`);

    // 源码兼容块 ⊆ 产物回退：源码里写了、产物里没了 = 优化器剪掉了
    // （覆盖"被剪的类恰好当前没被使用"的角落——used⊆have 抓不到它）
    const compatCss = readFileSync(new URL('../src/index.css', import.meta.url), 'utf8');
    const srcCompat = collectCompatClasses(compatCss);
    const distCompat = new Set(collectCompatClasses(distCss));
    const strippedFromDist = srcCompat.filter((n) => !distCompat.has(n));
    check('源码兼容块完整进入产物（未被剪掉）', strippedFromDist.length === 0,
      strippedFromDist.length ? `被剪: ${strippedFromDist.join(', ')}` : `${srcCompat.length} 条全部在产物中`);
  }
}

if (failures > 0) {
  console.error(`\n${failures} 项失败——scale/rotate 兼容块与产物不同步`);
  process.exit(1);
}
console.log('\n✓ verify-transform-compat：scale/rotate 旧内核兼容与产物同步');
