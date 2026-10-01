import React, { useState } from 'react';
import { X, Lock, Compass, Sparkles, ChevronRight, Gift } from 'lucide-react';
import type { ContinentType, TravelPostcard } from '../../types/travel';

// 大洲标签：ready 与否由 ART_READY_CONTINENTS 驱动——补齐插画后把大洲加进
// 数组即可，标签自动从「筹备中」变为计数，无需改这里
const CONTINENT_TABS: { key: Exclude<TabFilter, 'all'>; emoji: string; label: string }[] = [
  { key: 'asia', emoji: '🌸', label: '亚洲' },
  { key: 'europe', emoji: '🏰', label: '欧洲' },
  { key: 'americas', emoji: '🗽', label: '美洲' },
  { key: 'africa', emoji: '🦁', label: '非洲' },
];
import { ALL_POSTCARDS, ART_READY_CONTINENTS, TRIP_POOL } from '../../data/travelPostcards';
import { getTravelProgress, loadTravelState, TRIP_ENERGY_TARGET } from '../../services/travelService';
import { useModalA11y } from '../../utils/modalA11y';
import { PostcardCard } from './PostcardCard';

interface Props {
  onClose: () => void;
}

type TabFilter = 'all' | ContinentType;

export const TravelCodexModal: React.FC<Props> = ({ onClose }) => {
  const modalA11y = useModalA11y(true, onClose, '大肥鱼的漫游图鉴');
  const [tab, setTab] = useState<TabFilter>('all');
  const [selectedCard, setSelectedCard] = useState<TravelPostcard | null>(null);
  const [tipMessage, setTipMessage] = useState<string | null>(null);

  const travelState = loadTravelState();
  const unlockedSet = new Set(travelState.unlockedCardIds);

  // 进度只统计插画已就绪的大洲——此前分母是全部 50 张（只有亚洲有图），
  // 达成率永远停在 36%
  const { unlockedCount, totalCount, percentage } = getTravelProgress();
  const totalCards = totalCount;

  const filteredCards = (tab === 'all' ? TRIP_POOL : ALL_POSTCARDS.filter((c) => c.continent === tab)).filter(
    (c) => ART_READY_CONTINENTS.includes(c.continent)
  );

  // 未开放大洲：不进图鉴（进去全是永远抽不到的锁卡），点击给出解释
  const handleContinentTab = (c: Exclude<TabFilter, 'all'>) => {
    if (ART_READY_CONTINENTS.includes(c)) {
      setTab(c);
      return;
    }
    const label = c === 'europe' ? '欧洲' : c === 'americas' ? '美洲' : '非洲';
    setTipMessage(`🗺️ ${label}旅行插画筹备中，敬请期待大肥鱼的下一波远行～`);
    setTimeout(() => setTipMessage(null), 3500);
  };

  const handleCardClick = (card: TravelPostcard) => {
    if (unlockedSet.has(card.id)) {
      setSelectedCard(card);
      setTipMessage(null);
    } else {
      setTipMessage(`【${card.continentLabel} · No.${String(card.index).padStart(2, '0')}】尚未探索。今晚按时睡眠积攒能量，大肥鱼就会去这里旅行啦！`);
      setTimeout(() => setTipMessage(null), 3500);
    }
  };

  return (
    <div
      ref={modalA11y.ref}
      {...modalA11y.dialogProps}
      className="fixed inset-0 z-[95] flex flex-col bg-slate-950 text-slate-100"
      style={{ backgroundColor: '#020617' }}
    >
      {/* 顶栏 */}
      <div className="shrink-0 flex items-center justify-between px-4 pt-3 pb-2.5 border-b border-slate-800/80 bg-slate-950/80 backdrop-blur-md">
        <div className="flex items-center gap-2.5">
          <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-indigo-500 to-sky-500 flex items-center justify-center text-lg shadow-md">
            🗺️
          </div>
          <div>
            <h2 className="text-xs font-black text-white leading-tight">大肥鱼的漫游图鉴</h2>
            <p className="text-[9px] text-slate-400">
              已收集 {unlockedCount} / {totalCards} 张 · 达成率 {percentage}%
            </p>
          </div>
        </div>

        <button
          type="button"
          aria-label="关闭图鉴"
          onClick={onClose}
          className="w-8 h-8 rounded-full bg-slate-800/80 border border-slate-700 text-slate-300 hover:text-white flex items-center justify-center cursor-pointer active:scale-90 transition-transform"
        >
          <X className="w-4 h-4" />
        </button>
      </div>

      {/* 概览区：能量进度 + 伴手礼宝库 */}
      <div className="shrink-0 p-4 border-b border-slate-800/60 bg-gradient-to-b from-slate-900/60 to-transparent space-y-3">
        {/* 能量条 */}
        <div className="bg-slate-900/80 border border-slate-800 rounded-2xl p-3 flex items-center justify-between gap-3">
          <div className="space-y-1 flex-1">
            <div className="flex items-center justify-between text-[10px]">
              <span className="font-bold text-sky-300 flex items-center gap-1">
                <Compass className="w-3.5 h-3.5 text-sky-400" />
                梦境旅行能量
              </span>
              <span className="font-mono text-slate-400">
                <strong className="text-sky-300 text-xs">{travelState.currentEnergy}</strong> / {TRIP_ENERGY_TARGET} 分
              </span>
            </div>
            <div className="h-2 rounded-full bg-slate-800 overflow-hidden">
              <div
                className="h-full rounded-full bg-gradient-to-r from-sky-500 via-indigo-500 to-purple-500 transition-all duration-500"
                style={{ width: `${Math.min(100, Math.round((travelState.currentEnergy / TRIP_ENERGY_TARGET) * 100))}%` }}
              />
            </div>
          </div>
          <div className="shrink-0 text-right pl-2 border-l border-slate-800">
            <p className="text-[9px] text-slate-400">旅行出发</p>
            <p className="text-xs font-black text-amber-300">{travelState.totalTrips} 次</p>
          </div>
        </div>

        {/* 大洲分类标签 */}
        <div className="flex items-center gap-1.5 overflow-x-auto pb-1 no-scrollbar">
          <button
            type="button"
            onClick={() => setTab('all')}
            className={`px-3 py-1.5 rounded-xl text-[10px] font-bold shrink-0 transition-colors cursor-pointer ${
              tab === 'all'
                ? 'bg-sky-500 text-white shadow-sm'
                : 'bg-slate-900/80 text-slate-400 hover:text-slate-200 border border-slate-800'
            }`}
          >
            全部 ({unlockedCount}/{totalCards})
          </button>
          {CONTINENT_TABS.map(({ key, emoji, label }) => {
            const ready = ART_READY_CONTINENTS.includes(key);
            const poolCount = ALL_POSTCARDS.filter((c) => c.continent === key).length;
            const got = ALL_POSTCARDS.filter((c) => c.continent === key && unlockedSet.has(c.id)).length;
            const active = tab === key;
            return (
              <button
                key={key}
                type="button"
                onClick={() => handleContinentTab(key)}
                className={`px-3 py-1.5 rounded-xl text-[10px] font-bold shrink-0 transition-colors cursor-pointer ${
                  active
                    ? 'bg-sky-500 text-white shadow-sm'
                    : 'bg-slate-900/80 text-slate-400 hover:text-slate-200 border border-slate-800'
                }`}
              >
                {emoji} {label}
                {ready ? ` (${got}/${poolCount})` : ' · 筹备中'}
              </button>
            );
          })}
        </div>

        {tipMessage && (
          <div className="p-2 rounded-xl bg-indigo-950/70 border border-indigo-700/50 text-[10px] text-indigo-200 flex items-center gap-1.5 animate-fadeIn">
            <Sparkles className="w-3.5 h-3.5 text-indigo-400 shrink-0" />
            <span>{tipMessage}</span>
          </div>
        )}
      </div>

      {/* 明信片网格区（50 槽位） */}
      <div className="flex-1 overflow-y-auto p-4">
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
          {filteredCards.map((card) => {
            const isUnlocked = unlockedSet.has(card.id);
            const stars = travelState.goldStars[card.id] || 0;

            return (
              <button
                key={card.id}
                type="button"
                aria-label={`查看明信片：No.${card.index} ${isUnlocked ? card.title : '未解锁'}`}
                onClick={() => handleCardClick(card)}
                className={`relative aspect-[3/4] rounded-2xl p-2 text-left flex flex-col justify-between overflow-hidden cursor-pointer transition-transform active:scale-95 ${
                  isUnlocked
                    ? 'bg-slate-900 border-2 border-slate-700/80 hover:border-sky-500/80 shadow-lg'
                    : 'bg-slate-900/40 border border-slate-800/80 opacity-60'
                }`}
              >
                {/* 缩略图 or 锁孔剪影 */}
                {isUnlocked ? (
                  <div className="relative w-full flex-1 rounded-xl overflow-hidden bg-slate-950">
                    <img
                      src={card.imageUrl}
                      alt={card.title}
                      loading="lazy"
                      className="w-full h-full object-cover"
                    />
                    {stars > 0 && (
                      <span className="absolute top-1 right-1 px-1.5 py-0.5 rounded-full bg-amber-500/90 text-[8px] font-black text-slate-950">
                        ★ {stars + 1}
                      </span>
                    )}
                  </div>
                ) : (
                  <div className="w-full flex-1 rounded-xl bg-slate-950/80 border border-slate-800/50 flex flex-col items-center justify-center gap-1.5 text-slate-600">
                    <Lock className="w-5 h-5" />
                    <span className="text-[9px] font-mono font-bold tracking-wider">LOCKED</span>
                  </div>
                )}

                {/* 底部信息栏 */}
                <div className="pt-2 px-0.5 space-y-0.5">
                  <div className="flex items-center justify-between text-[8px]">
                    <span className="font-mono text-slate-400">No.{String(card.index).padStart(2, '0')}</span>
                    <span className="text-slate-400">{card.country}</span>
                  </div>
                  <p className="text-[10px] font-bold text-white truncate">
                    {isUnlocked ? card.title : '待探索梦境'}
                  </p>
                  {isUnlocked && (
                    <p className="text-[8px] text-amber-300/90 flex items-center gap-1 truncate">
                      <span>{card.souvenir.emoji}</span>
                      <span>{card.souvenir.name}</span>
                    </p>
                  )}
                </div>
              </button>
            );
          })}

          {/* 更多大洲占位：诚实的"敬请期待"，而不是永远抽不到的锁卡 */}
          <div
            aria-hidden
            className="aspect-[3/4] rounded-2xl border border-dashed border-slate-700/70 bg-slate-900/30 flex flex-col items-center justify-center gap-1.5 text-slate-500"
          >
            <Compass className="w-5 h-5" />
            <span className="text-[9px] font-bold">更多大洲</span>
            <span className="text-[8px]">插画筹备中</span>
          </div>
        </div>
      </div>

      {/* 伴手礼藏宝盒展示 */}
      {travelState.souvenirInventory.length > 0 && (
        <div className="shrink-0 px-4 py-2 border-t border-slate-800/80 bg-slate-900/60 flex items-center justify-between text-[10px]">
          <div className="flex items-center gap-1.5 text-slate-400">
            <Gift className="w-3.5 h-3.5 text-amber-400" />
            <span>伴手礼行囊：</span>
            <span className="font-bold text-amber-300">{travelState.souvenirInventory.length} 件特产</span>
          </div>
          <span className="text-[9px] text-slate-500">点击卡片背面可重温手写日记</span>
        </div>
      )}

      {/* 详情放大模态层（3D 翻转卡片） */}
      {selectedCard && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label={`明信片详情：${selectedCard.title}`}
          tabIndex={-1}
          className="fixed inset-0 z-[100] bg-black/85 backdrop-blur-md flex flex-col items-center justify-center p-4 animate-fadeIn"
        >
          <div className="w-full max-w-xs space-y-4">
            <div className="flex items-center justify-between text-white">
              <div className="flex items-center gap-1.5 text-xs font-bold text-sky-300">
                <span>🏮</span>
                <span>{selectedCard.country} · {selectedCard.title}</span>
              </div>
              <button
                type="button"
                aria-label="关闭详情"
                onClick={() => setSelectedCard(null)}
                className="w-7 h-7 rounded-full bg-white/10 hover:bg-white/20 text-white flex items-center justify-center cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <PostcardCard postcard={selectedCard} />

            <div className="text-center pt-2">
              <button
                type="button"
                onClick={() => setSelectedCard(null)}
                className="px-4 py-1.5 rounded-full bg-white/10 text-white text-xs font-bold hover:bg-white/20 cursor-pointer"
              >
                收回图鉴相册
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
