/**
 * 真实月相计算与 SVG 路径生成（纯三角函数，无资源依赖）。
 * 基准：2000-01-06 18:14 UTC 新月；朔望月 29.530588853 天。
 */

const SYNODIC = 29.530588853;
const NEW_MOON_EPOCH_DAYS = Date.UTC(2000, 0, 6, 18, 14) / 86400000;

export interface MoonInfo {
  /** 月龄（天，0=新月，14.77=满月） */
  age: number;
  /** 被照亮比例 0..1 */
  illumination: number;
  /** 是否盈月（新月→满月之间） */
  waxing: boolean;
  /** 八相名称 */
  phaseName: string;
}

export function getMoonInfo(date: Date = new Date()): MoonInfo {
  let age = (date.getTime() / 86400000 - NEW_MOON_EPOCH_DAYS) % SYNODIC;
  if (age < 0) age += SYNODIC;
  const phase = age / SYNODIC; // 0=新月 0.25=上弦 0.5=满月 0.75=下弦
  const illumination = (1 - Math.cos(2 * Math.PI * phase)) / 2;
  const waxing = phase < 0.5;
  const names = ['新月', '娥眉月', '上弦月', '盈凸月', '满月', '亏凸月', '下弦月', '残月'];
  const nameIdx = Math.round(phase * 8) % 8;
  return { age, illumination, waxing, phaseName: names[nameIdx] };
}

/**
 * 生成月面受光区域的 SVG path（viewBox 内以 cx,cy 为圆心、r 为半径）。
 * phase 0..1：0=新月（全暗）0.25=上弦（右半亮）0.5=满月（全亮）0.75=下弦（左半亮）。
 * 算法：受光侧外缘半圆 + 明暗界线椭圆弧（半轴 rx = r·|cos(2π·phase)|）闭合。
 */
export function moonLitPath(cx: number, cy: number, r: number, phase: number): string {
  const twoPi = 2 * Math.PI;
  const waxing = phase <= 0.5;
  const illum = (1 - Math.cos(twoPi * phase)) / 2;
  // 界线椭圆的横向半轴：新月/满月时 = r（半圆界线），弦月时 ≈ 0（直线）
  const rx = Math.max(0.5, r * Math.abs(Math.cos(twoPi * phase)));

  const top = `${cx} ${cy - r}`;
  const bottom = `${cx} ${cy + r}`;

  // 受光侧外缘：盈月亮面在右，亏月在左
  const limbSweep = waxing ? 1 : 0;
  // 界线弧的弯曲方向：凸月时向外鼓（与外缘同侧形成大亮面），娥眉时向内凹
  const termSweep = illum > 0.5 ? (waxing ? 0 : 1) : (waxing ? 1 : 0);

  return `M ${top} A ${r} ${r} 0 0 ${limbSweep} ${bottom} A ${rx} ${r} 0 0 ${termSweep} ${top} Z`;
}
