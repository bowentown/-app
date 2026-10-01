import React, { useState } from 'react';
import type { TravelPostcard } from '../../types/travel';
import { getPostcardById } from '../../data/travelPostcards';
import { Sparkles, MapPin, RotateCw } from 'lucide-react';
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
      <div className={`p-4 rounded-2xl bg-slate-900 border border-slate-800 text-center text-slate-400 text-xs ${className}`}>
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
          {/* 正面：拍立得全彩照片 + 邮戳 */}
          <div
            className="absolute inset-0 rounded-2xl overflow-hidden bg-slate-900 border-4 border-white/90 p-2 flex flex-col justify-between shadow-2xl"
            style={{
              backfaceVisibility: 'hidden',
              WebkitBackfaceVisibility: 'hidden',
            }}
          >
            {/* 照片主体 */}
            <div className="relative w-full flex-1 rounded-xl overflow-hidden bg-slate-950 flex items-center justify-center">
              <img
                src={card.imageUrl}
                alt={`${card.country} ${card.title}`}
                loading="lazy"
                className="w-full h-full object-cover"
              />
              {/* 红色文艺邮戳 */}
              <div className="absolute top-2 right-2 px-2 py-1 rounded-full border border-rose-500/80 bg-rose-950/60 backdrop-blur-xs text-[9px] font-black text-rose-300 tracking-widest rotate-6 shadow-sm flex items-center gap-1">
                <span>🏮</span>
                <span>{card.stampName}</span>
              </div>

              {/* 底部渐变半透明地点名 */}
              <div className="absolute bottom-0 inset-x-0 bg-gradient-to-t from-black/80 via-black/40 to-transparent p-2.5 pt-6 flex items-end justify-between">
                <div>
                  <div className="flex items-center gap-1 text-[10px] text-sky-300 font-bold">
                    <MapPin className="w-3 h-3 text-sky-400" />
                    <span>{card.country}</span>
                    <span className="text-white/40">·</span>
                    <span className="text-white/80">{card.continentLabel}</span>
                  </div>
                  <h4 className="text-xs font-black text-white leading-tight drop-shadow-sm mt-0.5">
                    {card.title}
                  </h4>
                </div>
              </div>
            </div>

            {/* 拍立得底部白色手写留白区域 */}
            <div className="pt-2 px-1 flex items-center justify-between">
              <span className="text-[10px] font-bold text-slate-800 tracking-tight flex items-center gap-1">
                <Sparkles className="w-3 h-3 text-amber-500 fill-amber-500" />
                {card.souvenir.name}
              </span>
              <span className="text-[9px] text-slate-500 font-medium flex items-center gap-0.5 hover:text-sky-600 transition-colors">
                <RotateCw className="w-2.5 h-2.5" />
                点击翻面
              </span>
            </div>
          </div>

          {/* 反面：复古旅行手写信纸 + 大肥鱼日记 */}
          <div
            className="absolute inset-0 rounded-2xl overflow-hidden bg-amber-50 border-4 border-amber-100/90 p-4 flex flex-col justify-between shadow-2xl text-slate-800"
            style={{
              backfaceVisibility: 'hidden',
              WebkitBackfaceVisibility: 'hidden',
              transform: 'rotateY(180deg)',
            }}
          >
            {/* 明信片顶部：邮政线与邮票 */}
            <div className="flex items-start justify-between border-b border-amber-200/80 pb-2">
              <div className="space-y-0.5">
                <p className="text-[10px] font-black text-amber-900 tracking-wider">POSTCARD · 梦境漫游</p>
                <p className="text-[9px] text-amber-700">TO: 世界上最好的鱼片</p>
              </div>
              <div className="w-9 h-11 border border-dashed border-amber-500/60 bg-amber-100/60 rounded flex flex-col items-center justify-center p-0.5 text-center">
                <span className="text-sm leading-none">🐋</span>
                <span className="text-[7px] text-amber-800 font-bold scale-90">{TRIP_ENERGY_TARGET}pt</span>
              </div>
            </div>

            {/* 中间：手写体日记 */}
            <div className="flex-1 py-3 flex items-center">
              <p className="text-[11px] leading-relaxed text-amber-950 font-medium whitespace-pre-wrap">
                “{card.text}”
              </p>
            </div>

            {/* 底部：伴手礼徽章与署名 */}
            <div className="border-t border-amber-200/80 pt-2 flex items-center justify-between">
              <div className="flex items-center gap-1.5 bg-amber-200/60 px-2 py-1 rounded-lg">
                <span className="text-sm">{card.souvenir.emoji}</span>
                <span className="text-[9px] font-bold text-amber-900">{card.souvenir.name}</span>
              </div>
              <div className="text-right">
                <p className="text-[9px] text-amber-800 font-bold">蓝色大肥鱼 亲笔 🐾</p>
                <p className="text-[8px] text-amber-600/80">点击再次翻转</p>
              </div>
            </div>
          </div>
        </div>
      </button>
    </div>
  );
};
