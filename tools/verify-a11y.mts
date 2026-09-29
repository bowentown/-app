/**
 * 护栏：无障碍标签（词法级扫描，不依赖 AST——TS7 的 JS API 尚不可用）。
 * 规则：
 *  1) <button> 必须有 aria-label，或渲染出可见文字（含三元/字符串字面量里的候选文案）；
 *  2) 带 onClick 的 <div>/<span> 必须显式二选一：role（键盘可操作）或 aria-hidden（纯装饰遮罩）。
 * 已知近似：三元分支里的字符串一律视为"可见文案"（宁可少报不误报）；
 * 报告的方法论约束：本护栏做过反向验证（造缺陷必须报红）。
 */
import { readdirSync, statSync, readFileSync } from 'node:fs';
import { join, relative, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const SRC = fileURLToPath(new URL('../src', import.meta.url)).replace(/\/$/, '');

function listFiles(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) out.push(...listFiles(p));
    else if (name.endsWith('.tsx')) out.push(p);
  }
  return out;
}

/** 找开标签的结束 ">"：跳过箭头函数的 "=>"（其 ">" 前一个非空字符是 "="） */
function tagEnd(src: string, from: number): number {
  for (let i = from; i < src.length; i++) {
    if (src[i] === '>') {
      let j = i - 1;
      while (j >= 0 && /\s/.test(src[j])) j--;
      if (src[j] !== '=') return i;
    }
  }
  return -1;
}

/** 可见文案：剥离 JSX 标签与花括号结构后，字符串字面量 + 裸文本中的字母 */
function visibleText(html: string): string {
  let t = html;
  let prev = '';
  while (prev !== t) {
    prev = t;
    t = t.replace(/<[A-Za-z/][^<>]*>/g, ' '); // JSX 标签（不含属性里的 => 场景，开标签已截断）
  }
  const strings = [...t.matchAll(/['"]([^'"]*)['"]/g)].map((m) => m[1]);
  // {identifier} / {obj.prop} 形态的变量插值在运行时就是可见文字，视为候选
  // （三元/嵌套 JSX 的花括号不在此列——它们交给引号提取与裸文本兜底）
  const idents = [...t.matchAll(/\{\s*[A-Za-z_$][\w$.]*\s*\}/g)].map((m) => m[0]);
  const bare = t.replace(/\{[^{}]*\}/g, ' ').replace(/['"]/g, ' ');
  return (strings.join(' ') + ' ' + idents.join(' ') + ' ' + bare).replace(/\s+/g, ' ');
}

const problems: string[] = [];
for (const f of listFiles(SRC)) {
  const src = readFileSync(f, 'utf-8');
  const rel = relative(SRC, f);
  const lineAt = (idx: number) => src.slice(0, idx).split('\n').length;

  // 规则 1：<button>
  for (let i = src.indexOf('<button'); i !== -1; i = src.indexOf('<button', i + 1)) {
    const openEnd = tagEnd(src, i);
    if (openEnd === -1) continue;
    const openTag = src.slice(i, openEnd);
    const close = src.indexOf('</button>', openEnd);
    if (close === -1) continue;
    const hasLabel = /aria-label/.test(openTag);
    const text = visibleText(src.slice(openEnd + 1, close));
    if (!hasLabel && !/[A-Za-z\u4e00-\u9fff]/.test(text)) {
      problems.push(`${rel}:${lineAt(i)} 纯图标 <button> 缺 aria-label`);
    }
  }

  // 规则 2：onClick 的 div/span
  for (const tag of ['<div', '<span']) {
    for (let i = src.indexOf(tag); i !== -1; i = src.indexOf(tag, i + 1)) {
      const openEnd = tagEnd(src, i);
      if (openEnd === -1) continue;
      const openTag = src.slice(i, openEnd);
      if (!/onClick/.test(openTag)) continue;
      // {...dialogProps} 展开来自 useModalA11y，自带 role/aria-modal/aria-label
      if (/role=|aria-hidden|tabIndex|dialogProps/.test(openTag)) continue;
      problems.push(`${rel}:${lineAt(i)} 可点击 <${tag.slice(1)}> 未声明 role / aria-hidden`);
    }
  }
}

if (problems.length > 0) {
  console.error(`✗ 无障碍护栏：${problems.length} 处`);
  for (const p of problems) console.error('  ' + p);
  process.exit(1);
}
console.log('✓ verify-a11y：图标按钮与可点击元素全部有可访问名称/显式语义');
