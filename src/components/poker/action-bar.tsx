'use client';

import { useMemo, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Slider } from '@/components/ui/slider';
import { getLegalActions, totalPot, type Action, type GameState, type LegalAction } from '@/lib/poker/engine';
import { cn } from '@/lib/utils';

function round5(x: number) {
  return Math.max(0, Math.round(x / 5) * 5);
}

function RaiseControls({
  legal,
  pot,
  currentBet,
  onAct,
  resetKey,
}: {
  legal: LegalAction;
  pot: number;
  currentBet: number;
  onAct: (action: Action) => void;
  resetKey: string;
}) {
  const min = legal.minRaiseTo;
  const max = legal.maxRaiseTo;
  const [raiseTo, setRaiseTo] = useState(() => {
    void resetKey;
    return Math.min(Math.max(legal.minRaiseTo, round5(pot * 0.66)), legal.maxRaiseTo);
  });

  const presets = useMemo(() => {
    const list: { label: string; to: number }[] = [{ label: 'Min', to: legal.minRaiseTo }];
    if (legal.isBet) {
      list.push({ label: '\u00BD Pot', to: round5(pot * 0.5) });
      list.push({ label: '\u00BE Pot', to: round5(pot * 0.75) });
      list.push({ label: 'Pot', to: round5(pot) });
    } else {
      list.push({ label: '2.5\u00D7', to: round5(currentBet * 2.5) });
      list.push({ label: '3\u00D7', to: round5(currentBet * 3) });
    }
    list.push({ label: 'All-in', to: legal.maxRaiseTo });
    return list
      .filter((p) => p.to >= legal.minRaiseTo && p.to <= legal.maxRaiseTo)
      .filter((p, i, arr) => arr.findIndex((q) => q.to === p.to) === i);
  }, [legal, pot, currentBet]);

  const raiseLabel = legal.isBet
    ? raiseTo >= max
      ? 'Bet ALL-IN'
      : `Bet ${raiseTo.toLocaleString()}`
    : raiseTo >= max
      ? `Raise ALL-IN ${max}`
      : `Raise to ${raiseTo.toLocaleString()}`;

  return (
    <div className="flex-1 min-w-0">
      <div className="flex items-center gap-2 mb-1">
        <Slider
          value={[raiseTo]}
          min={min}
          max={max}
          step={5}
          onValueChange={(v) => setRaiseTo(v[0])}
          className="flex-1"
          aria-label="Bet or raise amount"
        />
        <span className="text-xs text-slate-500 font-mono w-[92px] text-right hidden sm:block">
          {min}–{max}
        </span>
      </div>
      <div className="flex gap-1.5 flex-wrap">
        {presets.map((p) => (
          <button
            key={p.label}
            onClick={() => setRaiseTo(p.to)}
            className={cn(
              'text-[11px] font-semibold px-2.5 py-1 rounded-md border transition-colors',
              raiseTo === p.to
                ? 'border-amber-400 bg-amber-500/20 text-amber-200'
                : 'border-white/10 bg-slate-800/60 text-slate-400 hover:border-amber-400/40 hover:text-amber-200',
            )}
          >
            {p.label}
          </button>
        ))}
        <Button
          className="ml-auto h-9 px-5 bg-gradient-to-b from-amber-400 to-amber-600 text-slate-950 hover:from-amber-300 hover:to-amber-500 font-bold"
          onClick={() => onAct({ type: 'raise', to: raiseTo })}
        >
          {raiseLabel}
        </Button>
      </div>
    </div>
  );
}

export function ActionBar({
  state,
  humanTurn,
  onAct,
  actingName,
}: {
  state: GameState;
  humanTurn: boolean;
  onAct: (action: Action) => void;
  actingName: string | null;
}) {
  const legal = humanTurn ? getLegalActions(state) : null;
  const pot = totalPot(state);
  const me = state.players[0];
  const toCall = legal?.toCall ?? 0;
  const requiredEquity = toCall > 0 ? toCall / (pot + toCall) : 0;

  if (state.stage === 'idle') {
    return (
      <div className="h-[132px] sm:h-[124px] flex items-center justify-center text-slate-500 text-sm rounded-xl border border-white/5 bg-slate-950/40">
        No hand in progress
      </div>
    );
  }

  if (!humanTurn) {
    return (
      <div className="h-[132px] sm:h-[124px] flex flex-col items-center justify-center gap-1 rounded-xl border border-white/5 bg-slate-950/40">
        {state.stage === 'handover' ? (
          <span className="text-slate-400 text-sm">Hand complete — dealing next…</span>
        ) : actingName ? (
          <>
            <span className="flex items-center gap-2 text-amber-200/90 text-sm font-medium">
              <span className="h-2 w-2 rounded-full bg-amber-400 animate-pulse" />
              {actingName} is <span className="thinking-dots">thinking</span>
            </span>
            <span className="text-slate-600 text-xs">each bot runs its own decision algorithm</span>
          </>
        ) : (
          <span className="text-slate-500 text-sm">…</span>
        )}
      </div>
    );
  }

  const callLabel = toCall === 0 ? 'Check' : toCall >= me.stack ? `Call ALL-IN ${me.stack}` : `Call ${toCall}`;

  return (
    <div className="rounded-xl border border-amber-500/20 bg-gradient-to-b from-slate-900/90 to-slate-950/95 p-3 sm:p-4 shadow-lg">
      <div className="flex flex-wrap items-center gap-2 mb-2.5">
        <span className="text-xs text-slate-400">
          Pot <span className="text-amber-200 font-mono font-bold">{pot.toLocaleString()}</span>
        </span>
        {toCall > 0 && (
          <span className="text-xs text-slate-400">
            · calling <span className="text-slate-200 font-mono">{toCall}</span> needs{' '}
            <span className="text-emerald-300 font-mono font-bold">{(requiredEquity * 100).toFixed(1)}%</span> equity
          </span>
        )}
        {toCall === 0 && <span className="text-xs text-slate-400">· free check available</span>}
        <span className="ml-auto text-xs text-slate-500">
          your stack <span className="text-slate-300 font-mono">{me.stack.toLocaleString()}</span>
        </span>
      </div>

      <div className="flex flex-col sm:flex-row gap-3">
        <div className="flex gap-2 sm:w-[340px]">
          <Button
            variant="outline"
            className={cn('flex-1 h-12 border-red-500/40 text-red-300 hover:bg-red-500/10 hover:text-red-200 font-semibold', toCall === 0 && 'opacity-60')}
            onClick={() => onAct({ type: 'fold' })}
          >
            Fold
          </Button>
          <Button
            className="flex-1 h-12 bg-emerald-600 hover:bg-emerald-500 text-white font-semibold"
            onClick={() => onAct(toCall === 0 ? { type: 'check' } : { type: 'call' })}
          >
            {callLabel}
          </Button>
        </div>

        {legal?.canRaise ? (
          <RaiseControls
            key={`${state.handNo}-${state.stage}-${legal.minRaiseTo}-${legal.maxRaiseTo}`}
            legal={legal}
            pot={pot}
            currentBet={state.currentBet}
            onAct={onAct}
            resetKey={`${state.handNo}-${state.stage}-${legal.minRaiseTo}`}
          />
        ) : (
          <div className="flex-1 flex items-center justify-center text-xs text-slate-500 border border-dashed border-white/10 rounded-lg">
            raising unavailable — betting not reopened
          </div>
        )}
      </div>
    </div>
  );
}
