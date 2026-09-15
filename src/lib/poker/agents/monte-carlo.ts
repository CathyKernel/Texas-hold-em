/**
 * Monte Carlo agent: estimates its equity in real time by simulating random
 * runouts (opponent hole cards sampled uniformly from unseen cards), then
 * compares equity to pot odds. Pure sampling-based decision making.
 */

import { makeDeck, shuffle } from '../cards';
import { evaluate } from '../evaluator';
import { totalPot, type Action } from '../engine';
import type { AgentDecision, DecisionContext, PokerAgent } from './types';

export interface MCEquityResult {
  equity: number;
  sims: number;
  stdErr: number;
  win: number;
  tie: number;
}

/**
 * Monte Carlo equity estimate of `hole` against `nOpp` random hands given
 * the current board. Runs until `budgetMs` or `maxSims`.
 */
export function monteCarloEquity(
  hole: number[],
  board: number[],
  nOpp: number,
  rng: () => number,
  maxSims = 1500,
  budgetMs = 220,
): MCEquityResult {
  const start = Date.now();
  const known = new Set([...hole, ...board]);
  const unseen = makeDeck().filter((c) => !known.has(c));
  let win = 0;
  let tie = 0;
  let sims = 0;
  while (sims < maxSims && (sims === 0 || Date.now() - start < budgetMs)) {
    shuffle(unseen, rng);
    const need = 2 * nOpp + (5 - board.length);
    // Opponent hands + remaining board come from the shuffled prefix
    let idx = 0;
    const fullBoard = board.slice();
    while (fullBoard.length < 5) fullBoard.push(unseen[idx++]);
    const myScore = evaluate([...hole, ...fullBoard]);
    let best = -1;
    let ties = 0;
    for (let o = 0; o < nOpp; o++) {
      const oScore = evaluate([unseen[idx++], unseen[idx++], ...fullBoard]);
      if (oScore > best) {
        best = oScore;
        ties = 1;
      } else if (oScore === best) {
        ties++;
      }
    }
    if (myScore > best) win += 1;
    else if (myScore === best) tie += 1 / (ties + 1);
    sims++;
  }
  const equity = (win + tie) / sims;
  const stdErr = Math.sqrt(Math.max(1e-9, equity * (1 - equity)) / sims);
  return { equity, sims, stdErr, win: win / sims, tie: tie / sims };
}

function clampRaise(state: { currentBet: number; minRaiseTo: number }, legal: { minRaiseTo: number; maxRaiseTo: number }, to: number): Action | null {
  const max = legal.maxRaiseTo;
  const min = Math.min(legal.minRaiseTo, max);
  let t = Math.round(to / 5) * 5;
  if (t > max) t = max;
  if (t < min) t = min;
  if (t <= state.currentBet) return null;
  return { type: 'raise', to: t };
}

export function createMonteCarloAgent(maxSims = 1500, budgetMs = 220): PokerAgent {
  return {
    type: 'montecarlo',
    name: 'The Simulator',
    tagline: 'Live Monte Carlo equity rollouts vs pot odds',
    algorithm: 'Monte Carlo Simulation',
    description:
      'At every decision it deals thousands of random opponent hands and board runouts from the unseen cards, measuring its equity empirically. It calls when simulated equity clears the pot-odds hurdle, raises when equity dominates, and folds otherwise. The panel shows its equity estimate with the standard error of the mean.',
    decide(ctx: DecisionContext): AgentDecision {
      const { state, legal, seat, rng } = ctx;
      const p = state.players[seat];
      const nOpp = Math.max(1, state.players.filter((q) => q.status === 'in' || q.status === 'allin').length - 1);
      const res = monteCarloEquity(p.hole, state.board, nOpp, rng, maxSims, budgetMs);
      const pot = totalPot(state);
      const toCall = legal.toCall;
      const required = toCall > 0 ? toCall / (pot + toCall) : 0;
      const r = rng();
      const metrics: Record<string, number> = {
        equity: res.equity,
        stdErr: res.stdErr,
        sims: res.sims,
        requiredEquity: required,
        opponents: nOpp,
      };

      if (toCall === 0) {
        const raiseGate = 0.66 + 0.05 * (nOpp - 1);
        if (res.equity > raiseGate) {
          const act = clampRaise(state, legal, pot * 0.75);
          if (act) {
            return {
              action: act,
              abstractChar: 'p',
              rationale: `Monte Carlo equity ${(res.equity * 100).toFixed(1)}% ± ${(res.stdErr * 100).toFixed(1)} over ${res.sims} rollouts vs ${nOpp} — dominant hand, betting ~3/4 pot.`,
              metrics,
            };
          }
        }
        if (res.equity > 0.5 && r < 0.55) {
          const act = clampRaise(state, legal, pot * 0.5);
          if (act) {
            return {
              action: act,
              abstractChar: 'h',
              rationale: `Equity ${(res.equity * 100).toFixed(1)}% ± ${(res.stdErr * 100).toFixed(1)} (${res.sims} rollouts) — ahead of the field, betting half pot.`,
              metrics,
            };
          }
        }
        return {
          action: { type: 'check' },
          abstractChar: 'c',
          rationale: `Equity ${(res.equity * 100).toFixed(1)}% ± ${(res.stdErr * 100).toFixed(1)} (${res.sims} rollouts) — not enough edge to bet, checking.`,
          metrics,
        };
      }

      const safety = 0.04 + 0.02 * Math.min(3, nOpp);
      if (res.equity > 0.74 && state.raisesThisStreet < 2 && r < 0.55) {
        const act = clampRaise(state, legal, state.currentBet * 2.4);
        if (act) {
          return {
            action: act,
            abstractChar: 'h',
            rationale: `Simulated equity ${(res.equity * 100).toFixed(1)}% vs ${nOpp} opponents — raising for value.`,
            metrics,
          };
        }
      }
      if (res.equity >= required + safety) {
        return {
          action: { type: 'call' },
          abstractChar: 'c',
          rationale: `Equity ${(res.equity * 100).toFixed(1)}% ± ${(res.stdErr * 100).toFixed(1)} beats required ${(required * 100).toFixed(1)}% + safety margin — calling.`,
          metrics,
        };
      }
      if (required < 0.18 && res.equity >= required - 0.02 && r < 0.6) {
        return {
          action: { type: 'call' },
          abstractChar: 'c',
          rationale: `Equity ${(res.equity * 100).toFixed(1)}% is borderline vs ${(required * 100).toFixed(1)}% needed, but the price is small — calling one bet.`,
          metrics,
        };
      }
      return {
        action: { type: 'fold' },
        abstractChar: 'f',
        rationale: `Equity ${(res.equity * 100).toFixed(1)}% ± ${(res.stdErr * 100).toFixed(1)} falls below the ${(required * 100).toFixed(1)}% required by pot odds — folding.`,
        metrics,
      };
    },
  };
}
