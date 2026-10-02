/**
 * 每周睡眠分享卡：手写 Canvas 绘制（零依赖，不引 html2canvas——
 * 它对 Tailwind 4 的 oklch/渐变支持不可靠，项目刚清理过这类兼容面）。
 *
 * 隐私红线（此图会发到微信群）：只放聚合后的数字（规律度/平均时长），
 * 不放具体就寝/起床时刻（作息指纹）、不放梦境/心情/习惯、日期只写
 * "近 7 晚"——由 verify-no-claims 护栏与调用方开关共同保障。
 *
 * 插画同源加载（fetch→Blob→createImageBitmap，兜底 Image），不污染 canvas。
 */
import { SleepRecord } from '../types/sleep';
import type { TravelPostcard } from '../types/travel';
import { computeRegularity, RegularityResult } from './sleepRegularity';
import { loadTravelState } from '../services/travelService';
import { getPostcardById, thumbUrlOf } from '../data/travelPostcards';

export const CARD_W = 1080;
export const CARD_H = 1440;

interface LoadedImg {
  el: ImageBitmap | HTMLImageElement;
  w: number;
  h: number;
}

async function loadImage(url: string): Promise<LoadedImg> {
  // 同源 fetch → Blob → createImageBitmap（不经 <img> 解码，杜绝跨域污染）
  try {
    const res = await fetch(url);
    const blob = await res.blob();
    if (typeof createImageBitmap === 'function') {
      const el = await createImageBitmap(blob);
      return { el, w: el.width, h: el.height };
    }
    throw new Error('no createImageBitmap');
  } catch {
    // 老内核兜底：Image + object URL（同源同样不污染）
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve({ el: img, w: img.naturalWidth, h: img.naturalHeight });
      img.onerror = () => reject(new Error('插画加载失败: ' + url));
      img.src = url;
    });
  }
}

function roundedPath(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  // 不用 ctx.roundRect（Chrome 99+，旧内核没有）
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

/** cover 模式裁剪绘制（等比填满目标框，居中裁切）。 */
function drawCover(ctx: CanvasRenderingContext2D, img: LoadedImg, x: number, y: number, w: number, h: number) {
  const scale = Math.max(w / img.w, h / img.h);
  const sw = w / scale;
  const sh = h / scale;
  const sx = (img.w - sw) / 2;
  const sy = (img.h - sh) / 2;
  ctx.drawImage(img.el, sx, sy, sw, sh, x, y, w, h);
}

function darken(hex: string, f: number): string {
  const n = parseInt(hex.replace('#', ''), 16);
  const r = Math.round(((n >> 16) & 255) * f);
  const g = Math.round(((n >> 8) & 255) * f);
  const b = Math.round((n & 255) * f);
  return `rgb(${r},${g},${b})`;
}

/** 宠物周报语录：按规律度分档 + 日期哈希确定选取（傲娇，零医疗声称）。 */
export function petWeeklyQuote(regularity: RegularityResult | null, dayKey: number): string {
  const tier = regularity ? regularity.score >= 80 ? 'steady' : regularity.score >= 50 ? 'ok' : 'wild' : 'few';
  const pools: Record<string, string[]> = {
    steady: [
      '稳得像本鱼的睡眠曲线，鱼片也该夸夸自己了。',
      '这种规律度，本鱼看了都想打个盹……哼，是夸你。',
      '连续乖乖睡觉的鱼片，本鱼勉强给个满分。',
    ],
    ok: [
      '比上周稳一点了，本鱼都看在眼里。',
      '起伏有点大哦，本鱼可是会盯着的。',
      '还行，但离本鱼的满分还有一段距离。',
    ],
    wild: [
      '作息飘得像本鱼游泳……哼，说谁呢。',
      '今晚早点睡，本鱼可是要查岗的。',
      '规律这个词，鱼片要不要查查字典？',
    ],
    few: [
      '记录满 3 晚，本鱼才好给你画周报。',
      '先睡满三晚，本鱼把好评攒着呢。',
    ],
  };
  const pool = pools[tier];
  return pool[dayKey % pool.length];
}

export interface WeeklyCardInput {
  records: SleepRecord[];
  accentHex: string;           // 主题强调色（数字/描边跟主题走）
  pageBgHex: string;           // 主题页面底色（从 ThemeConfig.pageBg 提取）
  showRegularity: boolean;
  showDuration: boolean;
  now?: Date;
}

export interface WeeklyCardData {
  blob: Blob;
  dataUrl: string;
  quote: string;
  regularity: RegularityResult | null;
  avgDurationMin: number | null;
}

export async function renderWeeklyCard(input: WeeklyCardInput): Promise<WeeklyCardData> {
  const now = input.now ?? new Date();
  const records = input.records;
  const regularity = computeRegularity(records);
  const avgDurationMin = records.length > 0
    ? Math.round(records.slice(0, 7).reduce((a, r) => a + r.durationMinutes, 0) / Math.min(7, records.length))
    : null;

  const canvas = document.createElement('canvas');
  canvas.width = CARD_W;
  canvas.height = CARD_H;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Canvas 2D 不可用');

  // ── 背景：主题页面色 → 加深渐变 ──
  const bg = input.pageBgHex || '#0B1026';
  const grad = ctx.createLinearGradient(0, 0, 0, CARD_H);
  grad.addColorStop(0, bg);
  grad.addColorStop(1, darken(bg, 0.55));
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, CARD_W, CARD_H);

  // ── 顶部品牌行 ──
  ctx.fillStyle = '#FFFFFF';
  ctx.textAlign = 'center';
  ctx.font = '700 44px system-ui, sans-serif';
  ctx.fillText('🌙 极光睡眠 SomnaCare', CARD_W / 2, 108);

  // ── 插画：已解锁明信片按周数轮换（没解锁回默认自拍）──
  const state = loadTravelState();
  const unlocked: TravelPostcard[] = [];
  for (const id of state.unlockedCardIds) {
    const c = getPostcardById(id);
    if (c) unlocked.push(c);
  }
  const weekKey = Math.floor(now.getTime() / (7 * 86400000));
  const chosen = unlocked.length > 0 ? unlocked[weekKey % unlocked.length] : undefined;
  const imgUrl = chosen ? thumbUrlOf(chosen.imageUrl) : `${import.meta.env.BASE_URL || '/'}whale-selfie.png`;
  const img = await loadImage(imgUrl);

  const ix = 120;
  const iy = 170;
  const iw = CARD_W - 240;
  const ih = 700;
  roundedPath(ctx, ix, iy, iw, ih, 36);
  ctx.save();
  ctx.clip();
  drawCover(ctx, img, ix, iy, iw, ih);
  ctx.restore();
  ctx.strokeStyle = input.accentHex;
  ctx.lineWidth = 4;
  roundedPath(ctx, ix, iy, iw, ih, 36);
  ctx.stroke();

  // 插画下沿地名签（有明信片时）
  if (chosen) {
    ctx.fillStyle = 'rgba(2,6,23,0.72)';
    roundedPath(ctx, ix + 20, iy + ih - 86, 320, 62, 16);
    ctx.fill();
    ctx.fillStyle = '#E2E8F0';
    ctx.textAlign = 'left';
    ctx.font = '700 30px system-ui, sans-serif';
    ctx.fillText(`📍 ${chosen.country}`, ix + 44, iy + ih - 42);
  }

  // ── 数据区：只放聚合数字 ──
  let cy = iy + ih + 130;
  ctx.textAlign = 'center';
  if (input.showRegularity && regularity) {
    ctx.fillStyle = 'rgba(255,255,255,0.65)';
    ctx.font = '500 36px system-ui, sans-serif';
    ctx.fillText('作息规律度（近 7 晚）', CARD_W / 2, cy);
    cy += 96;
    ctx.fillStyle = input.accentHex;
    ctx.font = '900 128px system-ui, sans-serif';
    ctx.fillText(String(regularity.score), CARD_W / 2, cy);
    cy += 66;
    ctx.fillStyle = 'rgba(255,255,255,0.55)';
    ctx.font = '400 28px system-ui, sans-serif';
    ctx.fillText('就寝 ±' + regularity.bedDev + ' 分钟 · 起床 ±' + regularity.wakeDev + ' 分钟 · 按你自己记录的作息计算', CARD_W / 2, cy);
    cy += 90;
  }
  if (input.showDuration && avgDurationMin !== null) {
    ctx.fillStyle = 'rgba(255,255,255,0.65)';
    ctx.font = '500 36px system-ui, sans-serif';
    ctx.fillText('平均睡眠时长', CARD_W / 2, cy);
    cy += 84;
    ctx.fillStyle = '#FFFFFF';
    ctx.font = '900 84px system-ui, sans-serif';
    ctx.fillText(`${Math.floor(avgDurationMin / 60)} 小时 ${avgDurationMin % 60} 分`, CARD_W / 2, cy);
    cy += 90;
  }

  // ── 宠物语录 ──
  const dayKey = Number((now.getFullYear() + '' + (now.getMonth() + 1) + now.getDate()).slice(-4)) + now.getDay();
  const quote = petWeeklyQuote(input.showRegularity ? regularity : null, dayKey);
  ctx.fillStyle = '#FFFFFF';
  ctx.font = '500 40px system-ui, sans-serif';
  const maxW = CARD_W - 280;
  // 手动换行（中文按字符断行）
  const lines: string[] = [];
  let cur = '';
  for (const ch of `「${quote}」`) {
    if (ctx.measureText(cur + ch).width > maxW) { lines.push(cur); cur = ch; }
    else cur += ch;
  }
  lines.push(cur);
  let qy = Math.max(cy + 40, CARD_H - 330);
  for (const line of lines) { ctx.fillText(line, CARD_W / 2, qy); qy += 58; }
  ctx.fillStyle = 'rgba(255,255,255,0.7)';
  ctx.font = '600 34px system-ui, sans-serif';
  ctx.fillText('—— 蓝色大肥鱼 🐋', CARD_W / 2, qy + 16);

  // ── 底部诚实边界 ──
  ctx.fillStyle = 'rgba(255,255,255,0.38)';
  ctx.font = '400 26px system-ui, sans-serif';
  ctx.fillText('数据仅存本机 · 统计为模型估算，非医疗诊断', CARD_W / 2, CARD_H - 74);

  const blob = await new Promise<Blob>((resolve, reject) =>
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('toBlob 失败（canvas 被污染或内核不支持）'))), 'image/jpeg', 0.92)
  );
  const dataUrl = await new Promise<string>((resolve, reject) => {
    const fr = new FileReader();
    fr.onload = () => resolve(String(fr.result));
    fr.onerror = () => reject(new Error('FileReader 失败'));
    fr.readAsDataURL(blob);
  });
  return { blob, dataUrl, quote, regularity, avgDurationMin };
}
