/**
 * State & action abstraction shared by CFR, Deep CFR and RL agents
 * (both during offline training and live play).
 *
 * Card abstraction:
 *  - Preflop: 169 canonical hands -> 20 percentile buckets (vs uniform random).
 *  - Postflop: approximate hand-strength heuristic (made-hand percentile +
 *    draw bonuses) -> 10 buckets.
 *
 * Action abstraction: 4 symbolic actions
 *  f = fold, c = check/call, h = aggressive ~half-ish, p = aggressive ~pot-ish.
 *  Raises are capped at 3 per street to bound the abstract game tree.
 */

import { cardRank, cardSuit } from './cards';
import { evaluate, unpackScore } from './evaluator';
import type { Action, GameState, LegalAction, PlayerState } from './engine';
import { positionClass, totalPot } from './engine';
import { PREFLOP_BUCKET } from './preflop-table.generated';

export const ABSTRACT_ACTIONS = ['f', 'c', 'h', 'p'] as const;
export type AbstractChar = (typeof ABSTRACT_ACTIONS)[number];

export const MAX_RAISES_PER_STREET = 3;
export const PREFLOP_BUCKETS = 20;
export const POSTFLOP_BUCKETS = 10;

/** Canonical preflop index (0..168): pairs 0-12, suited 13-90, offsuit 91-168. */
export function canonicalPreflopIndex(hole: number[]): number {
  const r1 = Math.max(cardRank(hole[0]), cardRank(hole[1]));
  const r2 = Math.min(cardRank(hole[0]), cardRank(hole[1]));
  if (r1 === r2) return r1;
  const pair = (r1 * (r1 - 1)) / 2 + r2;
  return (hole[0] & 3) === (hole[1] & 3) ? 13 + pair : 13 + 78 + pair;
}

export function preflopBucket(hole: number[]): number {
  return PREFLOP_BUCKET[canonicalPreflopIndex(hole)];
}

/** Cumulative percentile midpoints of 5-card made-hand categories. */
const CAT_BASE = [0.09, 0.39, 0.72, 0.86, 0.905, 0.945, 0.975, 0.993, 0.9995];
const CAT_WIDTH = [0.30, 0.33, 0.12, 0.035, 0.03, 0.02, 0.012, 0.004, 0.0004];

/**
 * Approximate current hand strength in [0,1): made-hand percentile adjusted
 * for draws. Fast and deterministic (no Monte Carlo) so it can run inside
 * training traversals millions of times.
 */
export function approxHandStrength(hole: number[], board: number[]): number {
  const score = evaluate([...hole, ...board]);
  const { category, tiebreaks } = unpackScore(score);
  let s = CAT_BASE[category] + ((tiebreaks[0] + 1) / 14) * CAT_WIDTH[category];

  // Draw detection (only meaningful before the river)
  if (board.length < 5) {
    const all = [...hole, ...board];
    const suitCounts = [0, 0, 0, 0];
    for (const c of all) suitCounts[cardSuit(c)]++;
    const flushDraw = suitCounts.some((n) => n === 4);
    if (flushDraw) s += 0.09;

    // Straight draw: check distinct rank runs using bit mask of ranks
    const mask = (() => {
      let m = 0;
      for (const c of all) m |= 1 << cardRank(c);
      return m;
    })();
    let bestRun = 0;
    for (let start = 0; start <= 9; start++) {
      let run = 0;
      for (let k = 0; k < 5; k++) if (mask & (1 << (start + k))) run++;
      if (run > bestRun) bestRun = run;
    }
    // Wheel window (A,2,3,4,5)
    const wheel = ((mask >> 12) & 1) + (mask & 0xf);
    if (wheel > bestRun) bestRun = wheel;
    if (bestRun === 4) s += 0.06; // open-ended
    else if (bestRun === 3) s += 0.025; // gutshot-ish
  }
  return Math.min(0.999, s);
}

export function postflopBucket(hole: number[], board: number[]): number {
  return Math.floor(approxHandStrength(hole, board) * POSTFLOP_BUCKETS);
}

/** Card-abstraction bucket for a player's hole cards in the given state. */
export function handBucket(state: GameState, seat: number): number {
  const p = state.players[seat];
  if (state.stage === 'preflop') return preflopBucket(p.hole);
  return postflopBucket(p.hole, state.board);
}

/** Abstract action chars available to the current actor. */
export function legalAbstractActions(state: GameState, legal: LegalAction): AbstractChar[] {
  const chars: AbstractChar[] = [];
  if (legal.toCall > 0) chars.push('f');
  chars.push('c');
  const raiseOk =
    legal.canRaise &&
    state.raisesThisStreet < MAX_RAISES_PER_STREET &&
    legal.maxRaiseTo > state.currentBet;
  if (raiseOk) {
    chars.push('h');
    chars.push('p');
  }
  return chars;
}

function roundChips(x: number): number {
  return Math.max(0, Math.round(x));
}

/**
 * Map an abstract action char to a concrete legal engine action.
 * Must be deterministic so training and live play agree.
 */
export function mapAbstractAction(state: GameState, legal: LegalAction, ch: AbstractChar): Action {
  if (ch === 'f') {
    if (legal.toCall > 0) return { type: 'fold' };
    return { type: 'check' };
  }
  if (ch === 'c') {
    return legal.toCall === 0 ? { type: 'check' } : { type: 'call' };
  }
  // Aggressive actions h/p
  if (!legal.canRaise || state.raisesThisStreet >= MAX_RAISES_PER_STREET) {
    return legal.toCall === 0 ? { type: 'check' } : { type: 'call' };
  }
  const pot = totalPot(state);
  let to: number;
  if (state.currentBet === 0) {
    if (state.stage === 'preflop') {
      // Opening raise
      to = ch === 'h' ? roundChips(2.5 * state.bb) : roundChips(4 * state.bb);
    } else {
      to = ch === 'h' ? roundChips(0.5 * pot) : roundChips(1.0 * pot);
      to = Math.max(to, state.bb);
    }
  } else if (state.stage === 'preflop' && state.currentBet === state.bb && state.raisesThisStreet === 0) {
    to = ch === 'h' ? roundChips(2.5 * state.bb) : roundChips(4 * state.bb);
  } else {
    // Facing a bet: raise to ~2x / ~2.75x current bet
    to = ch === 'h' ? roundChips(2 * state.currentBet) : roundChips(2.75 * state.currentBet);
  }
  const maxTo = legal.maxRaiseTo;
  const minTo = Math.min(legal.minRaiseTo, maxTo);
  if (to > maxTo) to = maxTo;
  if (to < minTo) to = minTo;
  if (to <= state.currentBet) {
    return legal.toCall === 0 ? { type: 'check' } : { type: 'call' };
  }
  // Keep raise sizes sensible vs blind granularity (round UP so a raise never
  // drops below the minimum after rounding)
  to = Math.ceil(to / 5) * 5;
  if (to > maxTo) to = maxTo;
  if (to < minTo) to = minTo;
  if (to <= state.currentBet) {
    return legal.toCall === 0 ? { type: 'check' } : { type: 'call' };
  }
  return { type: 'raise', to };
}

/**
 * Infer the abstract char of a concrete action (for tracking opponents'
 * abstract action sequences in live play). Use the previous state.
 */
export function inferAbstractChar(prevState: GameState, prevLegal: LegalAction, action: Action): AbstractChar {
  if (action.type === 'fold') return 'f';
  if (action.type === 'check' || action.type === 'call') return 'c';
  const hTarget = concreteTarget(prevState, prevLegal, 'h');
  const pTarget = concreteTarget(prevState, prevLegal, 'p');
  if (hTarget === null || pTarget === null) return 'h';
  const to = action.to;
  return Math.abs(to - hTarget) <= Math.abs(to - pTarget) ? 'h' : 'p';
}

function concreteTarget(state: GameState, legal: LegalAction, ch: AbstractChar): number | null {
  if (!legal.canRaise || state.raisesThisStreet >= MAX_RAISES_PER_STREET) return null;
  const a = mapAbstractAction(state, legal, ch);
  if (a.type !== 'raise') return null;
  return a.to;
}

/**
 * Infoset key: posClass | street | bucket | betting pattern.
 * The pattern compresses the street's abstract action sequence into
 * (raises, calls, folds) counts — a standard betting-pattern abstraction
 * that bounds the infoset space.
 */
export function seqPattern(seq: string): string {
  let r = 0;
  let c = 0;
  let f = 0;
  for (const ch of seq) {
    if (ch === 'f') f++;
    else if (ch === 'c') c++;
    else r++;
  }
  return `r${r}c${c}f${f}`;
}

export function infosetKey(posClass: string, street: string, bucket: number, seq: string): string {
  return `${posClass}|${street}|${bucket}|${seqPattern(seq)}`;
}

export const POS_CLASSES = ['EP', 'MP', 'LP', 'SB', 'BB'] as const;

/** Feature vector for the Deep CFR advantage network. */
export function stateFeatures(state: GameState, seat: number): number[] {
  const p: PlayerState = state.players[seat];
  const streets: string[] = ['preflop', 'flop', 'turn', 'river'];
  const streetIdx = Math.max(0, streets.indexOf(state.stage));
  const f = new Array(14).fill(0);
  f[streetIdx] = 1;
  f[4] = handBucket(state, seat) / (state.stage === 'preflop' ? PREFLOP_BUCKETS - 1 : POSTFLOP_BUCKETS - 1);
  const pot = totalPot(state);
  const toCall = state.currentBet - p.bet;
  f[5] = toCall > 0 ? toCall / (pot + toCall) : 0;
  const effStack = p.stack + p.bet;
  f[6] = pot / Math.max(1, pot + effStack);
  f[7] = state.players.filter((q) => q.status === 'in' || q.status === 'allin').length / state.players.length;
  const pc = positionClass(state, seat);
  const pi = POS_CLASSES.indexOf(pc as (typeof POS_CLASSES)[number]);
  f[8 + Math.max(0, pi)] = 1;
  f[13] = state.raisesThisStreet < MAX_RAISES_PER_STREET && p.stack + p.bet > state.currentBet ? 1 : 0;
  return f;
}

export const FEATURE_DIM = 14;
