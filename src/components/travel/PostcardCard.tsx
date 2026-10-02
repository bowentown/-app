import React, { useState } from 'react';
import type { TravelPostcard } from '../../types/travel';
import { getPostcardById } from '../../data/travelPostcards';
import { Sparkles, RotateCw } from 'lucide-react';
import { TRIP_ENERGY_TARGET } from '../../services/travelService';

interface Props {
  postcardId?: string;
  postcard?: TravelPostcard;
  className?: string;
}

export const PostcardCard: React.FC<Props> = ({ postcardId, postcard: initialPostcard, className = '' }) => {
  const [isFlipped, setIsFlipped] = useState(false);
  const card = initialPostcard || (postcardId ? getPostcardById(postcardId) : undefined);

  if (!card) {
    return (
      <div className={`p-4 rounded-2xl bg-[#0f172a] border border-[#1e293b] text-center text-[#94a3b8] text-xs ${className}`}>
        💌 未找到明信片数据
      </div>
    );
  }

  return (
    <div
      className={`relative w-full max-w-[280px] mx-auto select-none ${className}`}
      style={{ perspective: 1000 }}
    >
      <button
        type="button"
        aria-label={`翻转明信片：${card.country} ${card.title}`}
        onClick={() => setIsFlipped((prev) => !prev)}
        className="w-full text-left relative focus:outline-none cursor-pointer block"
      >
        <div
          className="relative w-full aspect-[3/4] rounded-2xl transition-transform duration-500 shadow-xl"
          style={{
            transformStyle: 'preserve-3d',
            transform: isFlipped ? 'rotateY(180deg)' : 'rotateY(0deg)',
          }}
        >
          {/* 正面：拍立得全彩照片。翻到背面时从无障碍树隐藏——
              backface-visibility 只是视觉属性，读屏仍会念到两张脸 */}
          <div
            aria-hidden={isFlipped}
            className="absolute inset-0 rounded-2xl overflow-hidden bg-[#0f172a] border-4 border-white/90 p-2 flex flex-col justify-between shadow-2xl"
            style={{
              backfaceVisibility: 'hidden',
              WebkitBackfaceVisibility: 'hidden',
            }}
          >
            {/* 照片主体：插画本身已是完整明信片设计（自带邮戳与手写地名），
                此前叠加的邮戳药丸与底部地点条是重复遮盖——尤其左下/右上压住
                画面主体，观感很差。信息移到白色留白区与卡片背面 */}
            <div className="relative w-full flex-1 rounded-xl overflow-hidden bg-[#020617] flex items-center justify-center">
              <img
                src={card.imageUrl}
                alt={`${card.country} ${card.title}`}
                loading="lazy"
                className="w-full h-full object-cover"
              />
            </div>

            {/* 拍立得底部白色手写留白区域：地点与伴手礼两行，不遮画 */}
            <div className="pt-2 px-1 space-y-0.5">
              <div className="flex items-center justify-between gap-2">
                <span className="text-[10px] font-black text-[#1e293b] tracking-tight truncate">
                  {card.country} · {card.title}
                </span>
                <span className="text-[9px] text-[#64748b] font-medium flex items-center gap-0.5 shrink-0">
                  <RotateCw className="w-2.5 h-2.5" />
                  翻面
                </span>
              </div>
              <div className="text-[10px] font-bold text-[#1e293b] flex items-center gap-1 truncate">
                <Sparkles className="w-3 h-3 text-[#f59e0b] fill-amber-500 shrink-0" />
                <span className="truncate">{card.souvenir.name}</span>
              </div>
            </div>
          </div>

          {/* 反面：复古旅行手写信纸 + 大肥鱼日记 */}
          <div
            aria-hidden={!isFlipped}
            className="absolute inset-0 rounded-2xl overflow-hidden bg-[#fffbeb] border-4 border-amber-100/90 p-4 flex flex-col justify-between shadow-2xl text-[#1e293b]"
            style={{
              backfaceVisibility: 'hidden',
              WebkitBackfaceVisibility: 'hidden',
              transform: 'rotateY(180deg)',
            }}
          >
            {/* 明信片顶部：邮政线与邮票 */}
            <div className="flex items-start justify-between border-b border-amber-200/80 pb-2">
              <div className="space-y-0.5">
                <p className="text-[10px] font-black text-[#78350f] tracking-wider">POSTCARD · 梦境漫游</p>
                <p className="text-[9px] text-[#b45309]">TO: 世界上最好的鱼片</p>
              </div>
              <div className="w-9 h-11 border border-dashed border-amber-500/60 bg-amber-100/60 rounded flex flex-col items-center justify-center p-0.5 text-center">
                <span className="text-sm leading-none">🐋</span>
                <span className="text-[7px] text-[#92400e] font-bold scale-90">{TRIP_ENERGY_TARGET}pt</span>
              </div>
            </div>

            {/* 中间：手写体日记 */}
            <div className="flex-1 py-3 flex items-center">
              <p className="text-[11px] leading-relaxed text-[#451a03] font-medium whitespace-pre-wrap">
                “{card.text}”
              </p>
            </div>

            {/* 底部：伴手礼徽章与署名 */}
            <div className="border-t border-amber-200/80 pt-2 flex items-center justify-between">
              <div className="flex items-center gap-1.5 bg-amber-200/60 px-2 py-1 rounded-lg">
                <span className="text-sm">{card.souvenir.emoji}</span>
                <span className="text-[9px] font-bold text-[#78350f]">{card.souvenir.name}</span>
              </div>
              <div className="text-right">
                <p className="text-[9px] text-[#92400e] font-bold">蓝色大肥鱼 亲笔 🐾</p>
                <p className="text-[8px] text-amber-600/80">点击再次翻转</p>
              </div>
            </div>
          </div>
        </div>
      </button>
    </div>
  );
};
