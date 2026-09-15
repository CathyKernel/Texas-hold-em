'use client';

import { cn } from '@/lib/utils';
import { RANK_CHARS, SUIT_SYMBOLS, cardRank, cardSuit } from '@/lib/poker/cards';

const SIZES = {
  xs: 'w-7 h-10 text-[10px]',
  sm: 'w-9 h-[3.25rem] text-xs',
  md: 'w-11 h-16 text-sm',
  lg: 'w-14 h-20 text-base',
} as const;

export function PlayingCard({
  card,
  hidden,
  size = 'md',
  dimmed,
  delay = 0,
  className,
}: {
  card?: number;
  hidden?: boolean;
  size?: keyof typeof SIZES;
  dimmed?: boolean;
  delay?: number;
  className?: string;
}) {
  const base = cn(
    'relative select-none shrink-0 rounded-md shadow-md border border-black/20 flex items-center justify-center',
    SIZES[size],
    dimmed && 'opacity-40 grayscale',
    className,
  );
  if (hidden || card === undefined) {
    return (
      <div className={cn(base, 'card-back')} aria-label="face-down card">
        <div className="absolute inset-[3px] rounded-[4px] border border-amber-200/30 overflow-hidden">
          <div className="absolute inset-0 opacity-40 diamond-pattern" />
        </div>
      </div>
    );
  }
  const rank = RANK_CHARS[cardRank(card)];
  const suit = SUIT_SYMBOLS[cardSuit(card)];
  const red = cardSuit(card) === 1 || cardSuit(card) === 2;
  return (
    <div
      className={cn(base, 'bg-gradient-to-b from-white to-slate-100 card-face', red ? 'text-red-600' : 'text-slate-900')}
      style={delay ? { animation: `cardIn 260ms ease-out ${delay}ms both` } : undefined}
      aria-label={`${rank} of ${suit}`}
    >
      <div className="absolute top-0.5 left-1 font-bold leading-none tracking-tight">{rank}</div>
      <div className="absolute top-1 right-1 font-bold leading-none tracking-tight">{suit}</div>
      <span className="text-xl leading-none font-semibold">{suit}</span>
      <div className="absolute bottom-0.5 right-1 font-bold leading-none tracking-tight rotate-180">{rank}</div>
    </div>
  );
}
