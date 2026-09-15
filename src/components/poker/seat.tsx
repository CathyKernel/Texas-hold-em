'use client';

import { cn } from '@/lib/utils';
import type { PlayerState } from '@/lib/poker/engine';
import { PlayingCard } from './playing-card';
import { Avatar } from '@/components/ui/avatar';
import { BookOpen, Dices, Scale, BrainCircuit, Repeat, User } from 'lucide-react';

const AI_META: Record<string, { color: string; icon: React.ReactNode; short: string }> = {
  rule: { color: 'bg-emerald-500/15 text-emerald-300 border-emerald-500/40', icon: <BookOpen className="h-4 w-4" />, short: 'RB' },
  montecarlo: { color: 'bg-rose-500/15 text-rose-300 border-rose-500/40', icon: <Dices className="h-4 w-4" />, short: 'MC' },
  cfr: { color: 'bg-amber-500/15 text-amber-300 border-amber-500/40', icon: <Scale className="h-4 w-4" />, short: 'CFR' },
  deepcfr: { color: 'bg-orange-500/15 text-orange-300 border-orange-500/40', icon: <BrainCircuit className="h-4 w-4" />, short: 'D-CFR' },
  rl: { color: 'bg-teal-500/15 text-teal-300 border-teal-500/40', icon: <Repeat className="h-4 w-4" />, short: 'RL' },
};

export function Seat({
  player,
  posLabel,
  isActor,
  isThinking,
  lastAction,
  revealCards,
  wonAmount,
  isHuman,
  compact,
}: {
  player: PlayerState;
  posLabel: string;
  isActor: boolean;
  isThinking: boolean;
  lastAction: string | null;
  revealCards?: number[];
  wonAmount?: number;
  isHuman: boolean;
  compact?: boolean;
}) {
  const meta = isHuman
    ? { color: 'bg-yellow-500/15 text-yellow-200 border-yellow-500/40', icon: <User className="h-4 w-4" />, short: 'YOU' }
    : AI_META[player.aiType] ?? { color: 'bg-slate-500/15 text-slate-300 border-slate-500/40', icon: <BookOpen className="h-4 w-4" />, short: 'AI' };

  const folded = player.status === 'folded';
  const allin = player.status === 'allin';
  const busted = player.status === 'busted';
  const showCards = player.hole.length === 2 && (isHuman || revealCards !== undefined);
  const cards = revealCards ?? player.hole;

  return (
    <div
      className={cn(
        'absolute -translate-x-1/2 -translate-y-1/2 flex flex-col items-center gap-1 transition-opacity duration-300',
        folded && 'opacity-45',
        busted && 'opacity-30',
        wonAmount !== undefined && wonAmount > 0 && 'z-20',
      )}
    >
      {/* Cards */}
      <div className={cn('flex gap-1 items-center', isHuman ? 'mb-0.5' : '')}>
        {showCards ? (
          cards.map((c, i) => (
            <PlayingCard key={i} card={c} size={isHuman ? 'md' : compact ? 'xs' : 'sm'} dimmed={folded} />
          ))
        ) : (
          player.hole.length === 2 && (
            <>
              <PlayingCard hidden size={isHuman ? 'md' : compact ? 'xs' : 'sm'} />
              <PlayingCard hidden size={isHuman ? 'md' : compact ? 'xs' : 'sm'} />
            </>
          )
        )}
      </div>

      {/* Player plate */}
      <div
        className={cn(
          'relative w-32 sm:w-36 rounded-lg border px-2 py-1.5 backdrop-blur-sm',
          'bg-slate-900/85 shadow-lg',
          isActor ? 'border-amber-400 ring-2 ring-amber-400/40 animate-pulse-slow' : 'border-white/10',
          wonAmount !== undefined && wonAmount > 0 && 'border-yellow-400 ring-2 ring-yellow-400/60',
        )}
      >
        <div className="flex items-center gap-1.5">
          <Avatar className={cn('h-7 w-7 border', meta.color)}>
            <span className="scale-90">{meta.icon}</span>
          </Avatar>
          <div className="min-w-0 flex-1">
            <div className="truncate text-[11px] font-semibold text-slate-100 leading-tight">{isHuman ? 'You' : player.name}</div>
            <div className="text-[10px] text-amber-300/90 font-mono leading-tight">
              {player.stack.toLocaleString()} <span className="text-slate-500">chips</span>
            </div>
          </div>
          <span
            className={cn(
              'text-[9px] font-bold px-1 py-0.5 rounded border font-mono shrink-0',
              posLabel.includes('BTN') ? 'bg-amber-400 text-slate-900 border-amber-300' : 'bg-slate-800 text-slate-300 border-slate-600',
            )}
          >
            {posLabel}
          </span>
        </div>

        <div className="flex items-center justify-between mt-1 min-h-[16px]">
          {lastAction ? (
            <span
              className={cn(
                'text-[9px] font-bold tracking-wide px-1.5 py-0.5 rounded font-mono',
                lastAction.startsWith('FOLD')
                  ? 'bg-red-500/20 text-red-300'
                  : lastAction.startsWith('CHECK') || lastAction.startsWith('CALL')
                    ? 'bg-emerald-500/20 text-emerald-300'
                    : 'bg-amber-500/20 text-amber-300',
                lastAction.startsWith('ALL') && 'bg-red-500/30 text-red-200',
              )}
            >
              {lastAction}
            </span>
          ) : (
            <span />
          )}
          {allin && <span className="text-[9px] font-bold text-red-300 tracking-widest">ALL-IN</span>}
          {isThinking && !isActor ? null : null}
        </div>

        {wonAmount !== undefined && wonAmount > 0 && (
          <div className="absolute -top-7 left-1/2 -translate-x-1/2 whitespace-nowrap text-xs font-bold text-yellow-300 bg-slate-950/80 border border-yellow-400/50 rounded-full px-2 py-0.5 animate-bounce-soft">
            +{wonAmount.toLocaleString()}
          </div>
        )}
      </div>

      {isActor && (
        <div className="text-[10px] font-semibold text-amber-300 flex items-center gap-1">
          {isThinking ? (
            <>
              <span className="thinking-dots">thinking</span>
            </>
          ) : isHuman ? (
            'your turn'
          ) : null}
        </div>
      )}
    </div>
  );
}
