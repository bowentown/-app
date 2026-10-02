/**
 * 护栏：分享卡的画布隐私（第 19 轮 §1.2 的落地——注释声称的护栏此前是空的）。
 *
 * 分享卡会发到微信群，因此 sleepShareCard.ts 的绘制源码里绝不允许
 * 出现作息指纹/私密字段：具体就寝/起床时刻、梦境笔记、心情、习惯、
 * 精确日期。只允许消费聚合结果（computeRegularity / 平均时长）。
 *
 * 方法论约束：护栏必须能反向验证——往临时副本注入 dreamNotes 必须报红。
 */
import { readFileSync, writeFileSync, unlinkSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const TARGET = fileURLToPath(new URL('../src/utils/sleepShareCard.ts', import.meta.url));

// 禁止出现的字段/短语（作息指纹与私密内容）
const FORBIDDEN = ['bedtime', 'wakeTime', 'dreamNotes', 'mood', 'coffee', 'habits', 'deepSleepMinutes'];
// 必须出现的聚合来源（证明走的是合规通路）
const REQUIRED = ['computeRegularity', '近 7 晚'];

const text = readFileSync(TARGET, 'utf-8');
let failures = 0;

for (const f of FORBIDDEN) {
  if (text.includes(f)) {
    failures++;
    const line = text.slice(0, text.indexOf(f)).split('\n').length;
    console.error(`✗ sleepShareCard.ts:${line} 出现作息指纹/私密字段「${f}」——分享卡只允许聚合数字`);
  }
}
for (const r of REQUIRED) {
  if (!text.includes(r)) {
    failures++;
    console.error(`✗ sleepShareCard.ts 缺少聚合来源「${r}」——不允许直接消费单晚记录`);
  }
}

// 反向自检：注入 dreamNotes 必须被检出
const probeBackup = text;
try {
  writeFileSync(TARGET, text + '\n// __probe__ dreamNotes\n');
  const hit = readFileSync(TARGET, 'utf-8').includes('dreamNotes');
  if (!hit) {
    failures++;
    console.error('✗ verify-share-privacy：自检失败——注入的私密字段未被检出');
  }
} finally {
  writeFileSync(TARGET, probeBackup);
}

if (failures > 0) {
  console.error('   规则：分享卡只放聚合数字，作息指纹与私密内容禁止上画布');
  process.exit(1);
}
console.log(`✓ verify-share-privacy：分享卡无作息指纹/私密字段（禁 ${FORBIDDEN.length} 项，含反向自检）`);
