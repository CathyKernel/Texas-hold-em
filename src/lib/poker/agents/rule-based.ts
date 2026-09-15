/**
 * Rule-based agent: classical poker heuristics.
 *
 * Decision inputs:
 *  - Hand strength: preflop equity vs a random hand (precomputed 169-entry
 *    Monte Carlo table) / postflop made-hand percentile with draw bonuses.
 *  - Position: coarse class (EP/MP/LP/SB/BB) shifts open/call thresholds.
 *  - Pot odds: required equity = toCall / (pot + toCall), with a multiway
 *    safety margin. Decides fold / call / raise, plus bet sizing heuristics.
 */

import { approxHandStrength, canonicalPreflopIndex, mapAbstractAction, type AbstractChar } from '../abstraction';
import { positionClass, totalPot, type GameState, type LegalAction } from '../engine';
import { PREFLOP_EQUITY } from '../preflop-table.generated';
import { cardStr } from '../cards';
import type { AgentDecision, DecisionContext, PokerAgent } from './types';

export function handStrengthMetric(state: GameState, seat: number): number {
  const p = state.players[seat];
  if (state.stage === 'preflop') return PREFLOP_EQUITY[canonicalPreflopIndex(p.hole)];
  return approxHandStrength(p.hole, state.board);
}

export interface CharDecision {
  char: AbstractChar;
  rationale: string;
  metrics: Record<string, number>;
}

/** Core abstract-level decision (shared with training opponent pools). */
export function ruleDecideChar(state: GameState, legal: LegalAction, seat: number, rng: () => number): CharDecision {
  const p = state.players[seat];
  const pot = totalPot(state);
  const toCall = legal.toCall;
  const pos = positionClass(state, seat);
  const s = handStrengthMetric(state, seat);
  const opponents = Math.max(1, state.players.filter((q) => q.status === 'in' || q.status === 'allin').length - 1);
  const r = rng();
  const metrics: Record<string, number> = { strength: s, pot: pot, toCall: toCall, opponents };

  // Facing no bet
  if (toCall === 0) {
    if (state.stage === 'preflop') {
      // BB option / SB complete spot
      const openThresh = pos === 'EP' ? 0.53 : pos === 'MP' ? 0.49 : pos === 'LP' ? 0.45 : pos === 'SB' ? 0.48 : 0.43;
      if (s >= openThresh) {
        const strong = s >= 0.62;
        metrics.openThreshold = openThresh;
        return {
          char: strong && r < 0.35 ? 'p' : 'h',
          rationale: `Preflop strength ${(s * 100).toFixed(1)}% (${p.hole.map(cardStr).join('')}) clears the ${pos} open threshold ${(openThresh * 100).toFixed(0)}% — raising for value.`,
          metrics,
        };
      }
      metrics.openThreshold = openThresh;
      return {
        char: 'c',
        rationale: `Preflop strength ${(s * 100).toFixed(1)}% is below the ${pos} open threshold ${(openThresh * 100).toFixed(0)}% — checking.`,
        metrics,
      };
    }
    // Postflop, may check or bet
    if (s >= 0.84) {
      return {
        char: r < 0.4 ? 'p' : 'h',
        rationale: `Made hand at the ${(s * 100).toFixed(1)}th percentile — betting for value on the ${state.stage}.`,
        metrics,
      };
    }
    if (s >= 0.72) {
      return {
        char: 'h',
        rationale: `Strong hand (${(s * 100).toFixed(1)}th percentile) — value betting the ${state.stage}.`,
        metrics,
      };
    }
    if (s >= 0.56) {
      if (r < 0.45) {
        return { char: 'h', rationale: `Decent hand (${(s * 100).toFixed(1)}th percentile) — probing with a half-pot bet.`, metrics };
      }
      return { char: 'c', rationale: `Decent hand (${(s * 100).toFixed(1)}th percentile) — checking to keep the pot small.`, metrics };
    }
    if (pos === 'LP' && s < 0.45 && r < 0.16) {
      return { char: 'h', rationale: `Weak hand (${(s * 100).toFixed(1)}th percentile) but in position — firing a bluff.`, metrics };
    }
    return { char: 'c', rationale: `Weak hand (${(s * 100).toFixed(1)}th percentile) — checking back.`, metrics };
  }

  // Facing a bet
  const required = toCall / (pot + toCall);
  const margin = 0.03 + 0.025 * Math.min(3, opponents);
  const defend = pos === 'SB' || pos === 'BB' ? 0.02 : 0;
  metrics.requiredEquity = required;

  if (state.stage === 'preflop') {
    if (s >= 0.68 && state.raisesThisStreet < 3 && r < 0.55) {
      return {
        char: s >= 0.76 ? 'p' : 'h',
        rationale: `Premium hand (${(s * 100).toFixed(1)}% equity) facing a raise — 3-betting.`,
        metrics,
      };
    }
    if (s >= required + margin - defend) {
      return {
        char: 'c',
        rationale: `Equity ${(s * 100).toFixed(1)}% beats required ${(required * 100).toFixed(1)}% (pot odds) + margin — calling.`,
        metrics,
      };
    }
    if (required < 0.15 && s >= 0.42) {
      return { char: 'c', rationale: `Cheap call (${(required * 100).toFixed(1)}% needed) with ${(s * 100).toFixed(1)}% equity — set-mining / peeling.`, metrics };
    }
    return { char: 'f', rationale: `Equity ${(s * 100).toFixed(1)}% falls short of the ${(required * 100).toFixed(1)}% required by pot odds — folding.`, metrics };
  }

  // Postflop
  if (s >= 0.8 && state.raisesThisStreet < 2 && r < 0.4) {
    return { char: 'h', rationale: `Very strong hand (${(s * 100).toFixed(1)}th percentile) facing a bet — raising.`, metrics };
  }
  if (s >= required + margin - defend) {
    return { char: 'c', rationale: `Hand strength ${(s * 100).toFixed(1)}% covers required ${(required * 100).toFixed(1)}% — calling.`, metrics };
  }
  if (required < 0.22 && s >= required - 0.04 && r < 0.5) {
    return { char: 'c', rationale: `Slightly below direct odds but the price is cheap (${(required * 100).toFixed(1)}%) — calling with implied odds in mind.`, metrics };
  }
  return { char: 'f', rationale: `Hand strength ${(s * 100).toFixed(1)}% vs required ${(required * 100).toFixed(1)}% — folding to the bet.`, metrics };
}

export function createRuleAgent(): PokerAgent {
  return {
    type: 'rule',
    name: 'Professor Rule',
    tagline: 'Classical heuristics: strength + position + pot odds',
    algorithm: 'Rule-Based Expert System',
    description:
      'A hand-crafted expert system. It computes hand strength (preflop equity table / postflop made-hand percentile with draw bonuses), adjusts thresholds by position (EP tighter, LP and blinds looser), and compares its strength against pot-implied required equity to call. Value-bets strong hands, occasionally bluffs in position.',
    decide(ctx: DecisionContext): AgentDecision {
      const { state, legal, seat, rng } = ctx;
      const d = ruleDecideChar(state, legal, seat, rng);
      return {
        action: mapAbstractAction(state, legal, d.char),
        abstractChar: d.char,
        rationale: d.rationale,
        metrics: d.metrics,
      };
    },
  };
}
