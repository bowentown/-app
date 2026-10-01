import React, { useEffect, useState } from 'react';
import { Mail, Sparkles, Heart } from 'lucide-react';
import type { TravelPostcard } from '../../types/travel';
import { getPostcardById } from '../../data/travelPostcards';
import { clearPendingArrival } from '../../services/travelService';
import { createPostcardMoment } from '../../utils/petMoments';
import { useModalA11y } from '../../utils/modalA11y';
import { PostcardCard } from './PostcardCard';

interface Props {
  postcardId: string;
  onClose: () => void;
  onOpenMoments?: () => void;
}

export const TripArrivalModal: React.FC<Props> = ({ postcardId, onClose, onOpenMoments }) => {
  const modalA11y = useModalA11y(true, onClose, '大肥鱼寄来明信片');
  const [opened, setOpened] = useState(false);
  const card: TravelPostcard | undefined = getPostcardById(postcardId);

  const handleOpenEnvelope = () => {
    setOpened(true);
    if (card) {
      createPostcardMoment(card);
    }
  };

  // 兜底：即使用户没拆信封就关掉（Esc/稍后再看），旅行也已经发生——
  // 明信片要发进朋友圈。createPostcardMoment 按明信片 id 幂等，不会重发
  useEffect(() => {
    return () => {
      if (card) createPostcardMoment(card);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleFinish = () => {
    clearPendingArrival();
    onClose();
    if (onOpenMoments) {
      onOpenMoments();
    }
  };

  if (!card) return null;

  return (
    <div
      ref={modalA11y.ref}
      {...modalA11y.dialogProps}
      className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-slate-950/90 backdrop-blur-md animate-fadeIn"
      style={{ backgroundColor: 'rgba(2, 6, 23, 0.92)' }}
    >
      <div className="w-full max-w-sm bg-gradient-to-b from-slate-900 to-slate-950 border border-slate-800 rounded-3xl p-5 shadow-2xl flex flex-col items-center text-center space-y-4">
        {/* 顶部标题与徽章 */}
        <div className="space-y-1">
          <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-amber-500/20 border border-amber-500/40 text-amber-300 text-[10px] font-bold">
            <Sparkles className="w-3 h-3 text-amber-400" />
            <span>梦境能量 666 分达成 · 旅途信函</span>
          </div>
          <h3 className="text-base font-black text-white">大肥鱼给你寄回了新明信片！</h3>
          <p className="text-[11px] text-slate-400">
            她在【{card.country} · {card.title}】度过了一个美好的夜晚。
          </p>
        </div>

        {!opened ? (
          /* 未拆信封界面 */
          <div className="py-6 space-y-6 w-full flex flex-col items-center">
            <div className="relative w-36 h-28 bg-amber-100 rounded-2xl shadow-xl border-2 border-amber-300 flex items-center justify-center group transform transition-transform hover:scale-105">
              <div className="absolute top-2 right-2 w-8 h-10 border border-dashed border-rose-400 bg-rose-50/80 rounded flex items-center justify-center text-xs">
                🏮
              </div>
              <Mail className="w-12 h-12 text-amber-700 animate-bounce" />
              <div className="absolute -bottom-2 px-2.5 py-0.5 rounded-full bg-rose-600 text-white text-[9px] font-bold shadow-md">
                来自远方的来信
              </div>
            </div>

            <button
              type="button"
              onClick={handleOpenEnvelope}
              className="w-full py-3 rounded-2xl bg-gradient-to-r from-sky-500 to-indigo-600 hover:from-sky-400 hover:to-indigo-500 text-white text-xs font-bold shadow-lg shadow-sky-500/25 active:scale-95 transition-transform cursor-pointer"
            >
              ✉️ 拆开信封并查看
            </button>
          </div>
        ) : (
          /* 已拆开：展示 3D 拍立得明信片与伴手礼 */
          <div className="w-full space-y-4 animate-fadeIn">
            <PostcardCard postcard={card} />

            <div className="bg-slate-900/90 border border-slate-800 rounded-2xl p-3 text-left flex items-center justify-between">
              <div className="flex items-center gap-2">
                <span className="text-2xl">{card.souvenir.emoji}</span>
                <div>
                  <p className="text-[10px] text-slate-400">大肥鱼带回的伴手礼</p>
                  <p className="text-xs font-bold text-amber-300">{card.souvenir.name}</p>
                </div>
              </div>
              <span className="text-[9px] text-emerald-400 font-bold bg-emerald-950/80 px-2 py-1 rounded-lg border border-emerald-800/60">
                已收入行囊
              </span>
            </div>

            <div className="space-y-2 pt-1">
              <button
                type="button"
                onClick={handleFinish}
                className="w-full py-2.5 rounded-xl bg-sky-600 hover:bg-sky-500 text-white text-xs font-bold flex items-center justify-center gap-1.5 shadow-md active:scale-95 transition-transform cursor-pointer"
              >
                <Heart className="w-3.5 h-3.5 fill-white" />
                收下明信片并去朋友圈点赞
              </button>
              <button
                type="button"
                onClick={() => {
                  clearPendingArrival();
                  onClose();
                }}
                className="w-full py-2 rounded-xl text-slate-400 hover:text-slate-200 text-[11px] font-medium transition-colors cursor-pointer"
              >
                稍后再看
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
