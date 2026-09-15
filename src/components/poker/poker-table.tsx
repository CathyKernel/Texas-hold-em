'use client';

import { cn } from '@/lib/utils';
import { positionLabel, totalPot, type GameState, type ShowdownInfo } from '@/lib/poker/engine';
import { Seat } from './seat';
import { PlayingCard } from './playing-card';
import { AnimatePresence, motion } from 'framer-motion';

// Responsive seat placement: percentage centers via arbitrary Tailwind values.
// On narrow screens side seats pull inward so plates never cross the viewport edge.
const SEAT_CLS = [
  'left-1/2 top-[86%] max-sm:top-[80%]',
  'left-[10%] top-[66%] max-sm:left-[17%]',
  'left-[13%] top-[20%] max-sm:left-[21%]',
  'left-1/2 top-[5%]',
  'left-[87%] top-[20%] max-sm:left-[79%]',
  'left-[90%] top-[66%] max-sm:left-[83%]',
];

const BET_POS = [
  { x: 50, y: 73 },
  { x: 24, y: 62 },
  { x: 25, y: 30 },
  { x: 50, y: 16 },
  { x: 75, y: 30 },
  { x: 76, y: 62 },
];

const BTN_POS = [
  { x: 37, y: 79 },
  { x: 21, y: 55 },
  { x: 23, y: 33 },
  { x: 37, y: 13 },
  { x: 63, y: 13 },
  { x: 79, y: 55 },
];

const STREET_NAMES: Record<string, string> = {
  preflop: 'PRE-FLOP',
  flop: 'FLOP',
  turn: 'TURN',
  river: 'RIVER',
  showdown: 'SHOWDOWN',
  handover: 'SHOWDOWN',
  idle: '',
};

const STREET_SUB: Record<string, string> = {
  preflop: 'Hole cards dealt',
  flop: '3 community cards',
  turn: '4th street',
  river: 'Final card · last betting round',
  showdown: 'Best 5 of 7 wins',
};

export function PokerTable({
  state,
  phase,
  actingSeat,
  humanTurn,
  lastActions,
}: {
  state: GameState;
  phase: 'loading' | 'ready' | 'playing' | 'handover';
  actingSeat: number | null;
  humanTurn: boolean;
  lastActions: Record<number, string>;
}) {
  const pot = totalPot(state);
  const sd: ShowdownInfo | null = state.showdownInfo;
  const revealMap = new Map<number, { cards: number[]; handName: string; won: boolean }>();
  if (sd && !sd.foldWin) {
    for (const r of sd.reveal) revealMap.set(r.seat, { cards: r.cards, handName: r.handName, won: r.won });
  }
  const wonMap = new Map<number, number>();
  if (sd) {
    for (const a of sd.totalAward) wonMap.set(a.seat, (wonMap.get(a.seat) ?? 0) + a.amount);
  }
  const showCardsNow = phase === 'handover' && !!sd;

  return (
    <div className="relative w-full aspect-[16/10] min-h-[380px] max-h-[560px] mx-auto select-none table-viewport">
      {/* Felt */}
      <div className="absolute left-[6%] top-[16%] w-[88%] h-[68%] rounded-[50%] felt shadow-2xl border-2 border-amber-600/30">
        <div className="absolute inset-2 rounded-[50%] border border-amber-200/10" />
        {/* Table branding */}
        <div className="absolute left-1/2 top-[16%] -translate-x-1/2 text-center">
          <div className="text-amber-300/25 font-serif text-sm sm:text-base tracking-[0.3em] uppercase">GTO Lab</div>
        </div>
      </div>

      {/* Pot + street label */}
      <div className="absolute left-1/2 top-[38%] -translate-x-1/2 -translate-y-1/2 flex flex-col items-center gap-1.5 z-10 pointer-events-none">
        <div className="text-center">
          <div className="text-[10px] font-bold tracking-[0.25em] text-amber-200/70">{STREET_NAMES[state.stage] ?? ''}</div>
          <div className="text-[9px] text-slate-500">{STREET_SUB[state.stage] ?? ''}</div>
        </div>
        {state.stage !== 'idle' && state.stage !== 'handover' && (
          <div className="flex items-center gap-1.5 bg-slate-950/70 border border-amber-500/30 rounded-full px-3 py-1">
            <span className="chip chip-sm" aria-hidden />
            <span className="text-amber-200 font-mono font-bold text-sm">{pot.toLocaleString()}</span>
            <span className="text-[10px] text-amber-200/60">POT</span>
          </div>
        )}
        {/* Community cards */}
        {state.board.length > 0 && (
          <div className="flex gap-1.5 mt-1">
            {Array.from({ length: 5 }).map((_, i) =>
              i < state.board.length ? (
                <motion.div
                  key={`c${i}`}
                  initial={{ y: -26, opacity: 0, rotate: -8 }}
                  animate={{ y: 0, opacity: 1, rotate: 0 }}
                  transition={{ duration: 0.28, delay: 0.03 * i }}
                >
                  <PlayingCard card={state.board[i]} size="md" />
                </motion.div>
              ) : (
                <div key={`e${i}`} className="w-11 h-16 rounded-md border border-dashed border-white/10 board-slot" />
              ),
            )}
          </div>
        )}
      </div>

      {/* Seats */}
      {state.players.map((p, seat) => {
        if (p.status === 'busted' && phase !== 'handover') return null;
        const rev = showCardsNow ? revealMap.get(seat) : undefined;
        return (
          <div key={seat} className={cn('absolute -translate-x-1/2 -translate-y-1/2 z-10', SEAT_CLS[seat])}>
            <Seat
              player={p}
              posLabel={positionLabel(state, seat)}
              isActor={actingSeat === seat}
              isThinking={actingSeat === seat && seat !== 0}
              lastAction={lastActions[seat] ?? null}
              revealCards={rev?.cards}
              handName={rev?.handName}
              wonAmount={showCardsNow ? wonMap.get(seat) : undefined}
              isHuman={p.isHuman}
              compact={seat !== 0}
            />
          </div>
        );
      })}

      {/* Bets */}
      {state.players.map((p, seat) => {
        if (p.bet <= 0) return null;
        const pos = BET_POS[seat];
        return (
          <div key={`b${seat}`} className="absolute -translate-x-1/2 -translate-y-1/2 z-10" style={{ left: `${pos.x}%`, top: `${pos.y}%` }}>
            <div className="flex items-center gap-1.5 bg-slate-950/70 border border-white/15 rounded-full px-2.5 py-1 shadow-md bet-chip">
              <span className="chip chip-sm" aria-hidden />
              <span className={cn('font-mono font-bold text-xs', p.status === 'allin' ? 'text-red-300' : 'text-slate-100')}>
                {p.bet.toLocaleString()}
              </span>
            </div>
          </div>
        );
      })}

      {/* Dealer button */}
      {state.stage !== 'idle' && (
        <div
          className="absolute -translate-x-1/2 -translate-y-1/2 z-10"
          style={{ left: `${BTN_POS[state.button].x}%`, top: `${BTN_POS[state.button].y}%` }}
          title="Dealer button — rotates one seat each hand; small blind sits directly left"
        >
          <div className="w-6 h-6 rounded-full bg-white shadow-md border-2 border-slate-300 flex items-center justify-center text-[10px] font-black text-slate-800">
            D
          </div>
        </div>
      )}

      {/* Showdown summary — per-pot breakdown */}
      <AnimatePresence>
        {showCardsNow && sd && (
          <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }}
            className="absolute left-1/2 top-[54%] -translate-x-1/2 z-30 w-[76%] max-w-lg pointer-events-none"
          >
            <div className="rounded-xl bg-slate-950/92 border border-amber-500/40 shadow-xl px-4 py-3 backdrop-blur">
              <div className="text-center text-[10px] font-bold tracking-[0.25em] text-amber-300 mb-1.5">
                {sd.foldWin ? 'POT AWARDED — ALL FOLDED' : 'SHOWDOWN RESULT'}
              </div>
              {sd.pots.map((potResult, i) => (
                <div key={i} className="flex items-center justify-between text-xs py-0.5 gap-2">
                  <span className="text-slate-300 truncate">
                    <span className={cn('font-semibold', i === 0 ? 'text-amber-200/90' : 'text-orange-200/90')}>
                      {sd.pots.length > 1 ? (i === 0 ? 'Main pot' : `Side pot ${i}`) : 'Pot'}
                    </span>
                    {sd.pots.length > 1 && (
                      <span className="text-slate-500 hidden sm:inline">
                        {' '}({potResult.eligibleSeats
                          .map((s) => (s === 0 ? 'You' : state.players[s].name))
                          .join(', ')})
                      </span>
                    )}
                    {' — '}
                    {potResult.winnerSeats.map((s) => (s === 0 ? 'You' : state.players[s].name)).join(' & ')}
                  </span>
                  <span className="text-yellow-300 font-mono font-bold whitespace-nowrap">
                    {potResult.amount.toLocaleString()}
                    {!sd.foldWin && <span className="text-slate-500 font-normal"> · {potResult.handName}</span>}
                  </span>
                </div>
              ))}
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Idle overlay */}
      {phase === 'ready' && (
        <div className="absolute inset-0 flex items-center justify-center z-30">
          <div className="text-slate-400 text-sm bg-slate-950/60 rounded-full px-4 py-2 border border-white/10">
            Press <span className="text-amber-300 font-semibold">Deal Hand</span> to begin
          </div>
        </div>
      )}
    </div>
  );
}
