'use client';

import { cn } from '@/lib/utils';
import type { GameState, Street } from '@/lib/poker/engine';

const STEPS: { key: Street | 'showdown'; label: string; cards: number; hint: string }[] = [
  { key: 'preflop', label: 'Pre-flop', cards: 0, hint: 'Hole cards dealt · blinds posted · UTG acts first' },
  { key: 'flop', label: 'Flop', cards: 3, hint: 'Burn 1 · deal 3 community cards · first live seat left of button acts' },
  { key: 'turn', label: 'Turn', cards: 4, hint: 'Burn 1 · deal the 4th community card' },
  { key: 'river', label: 'River', cards: 5, hint: 'Burn 1 · deal the last community card · final betting round' },
  { key: 'showdown', label: 'Showdown', cards: 5, hint: 'Remaining hands revealed · best 5 of 7 wins the pot' },
];

export function StreetProgress({ state, phase }: { state: GameState; phase: 'loading' | 'ready' | 'playing' | 'handover' }) {
  if (state.stage === 'idle' && phase === 'ready') {
    return (
      <div className="rounded-xl border border-white/8 bg-slate-950/50 px-4 py-2.5 text-center text-xs text-slate-500">
        Press <span className="text-amber-300 font-semibold">Deal Hand</span> to shuffle up and deal — the button rotates one seat clockwise each hand.
      </div>
    );
  }

  // current step index
  const stageKey = state.stage === 'handover' ? 'showdown' : state.stage;
  let current = STEPS.findIndex((s) => s.key === stageKey);
  if (state.stage === 'showdown' || state.stage === 'handover') current = STEPS.length - 1;
  const done = state.showdownInfo?.foldWin === true;
  const currentStep = STEPS[Math.max(0, current)];

  return (
    <div className="rounded-xl border border-white/8 bg-slate-950/50 px-3 py-2.5">
      <div className="flex items-center gap-1 sm:gap-1.5">
        {STEPS.map((step, i) => {
          const isCurrent = i === current;
          const isPast = i < current;
          return (
            <div key={step.key} className="flex items-center gap-1 sm:gap-1.5 min-w-0 flex-1">
              <div
                className={cn(
                  'flex items-center justify-center gap-1 rounded-md border px-1.5 py-1 min-w-0 transition-colors',
                  isCurrent
                    ? 'border-amber-400/70 bg-amber-500/15 text-amber-200 shadow-[0_0_12px_-2px_rgba(251,191,36,0.5)]'
                    : isPast
                      ? 'border-emerald-500/40 bg-emerald-500/10 text-emerald-300/90'
                      : 'border-white/8 bg-slate-900/60 text-slate-600',
                )}
              >
                <span className={cn('text-[10px] font-bold tabular-nums shrink-0', isCurrent ? 'text-amber-300' : isPast ? 'text-emerald-400' : 'text-slate-600')}>
                  {i + 1}
                </span>
                <span className="text-[10px] sm:text-[11px] font-semibold truncate">{step.label}</span>
                {step.cards > 0 && (
                  <span className={cn('text-[9px] font-mono shrink-0 hidden sm:inline', isCurrent ? 'text-amber-300/80' : isPast ? 'text-emerald-400/70' : 'text-slate-600')}>
                    {step.cards}c
                  </span>
                )}
              </div>
              {i < STEPS.length - 1 && (
                <div className={cn('h-px flex-1 min-w-[6px] sm:min-w-[10px]', i < current ? 'bg-emerald-500/50' : 'bg-white/10')} />
              )}
            </div>
          );
        })}
      </div>
      <p className="mt-1.5 text-[10px] sm:text-[11px] text-slate-500 text-center leading-tight">
        {done ? (
          <span className="text-slate-400">
            Hand complete — everyone folded, the last aggressor takes the pot without showdown.
          </span>
        ) : (
          currentStep.hint
        )}
        {state.burned.length > 0 && (
          <span className="ml-1.5 text-slate-600 font-mono">· {state.burned.length} burned</span>
        )}
      </p>
    </div>
  );
}
