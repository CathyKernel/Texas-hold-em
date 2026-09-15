/**
 * External-sampling Monte Carlo CFR (ES-MCCFR), multi-player.
 *
 * On each iteration one traverser is fixed; the walk enumerates ALL of the
 * traverser's abstract actions at its own decision points (computing their
 * counterfactual values by recursion) while OPPONENT actions and chance are
 * sampled. Regret increments are unweighted (opponent reach is sampled);
 * the average strategy accumulator is weighted by the traverser's own reach.
 *
 * onTraverserNode lets the Deep CFR collector record (features, advantage)
 * samples at every traverser visit.
 */

import { ABSTRACT_ACTIONS, stateFeatures, type AbstractChar } from '../abstraction';
import { seededRng } from '../cards';
import type { AbstractGame } from './abstract-game';

export interface MCCFRTables {
  regret: Map<string, Float64Array>[];
  strategySum: Map<string, Float64Array>[];
}

export function createTables(nPlayers: number): MCCFRTables {
  return {
    regret: Array.from({ length: nPlayers }, () => new Map<string, Float64Array>()),
    strategySum: Array.from({ length: nPlayers }, () => new Map<string, Float64Array>()),
  };
}

export function regretMatching(
  regrets: Float64Array | undefined,
  chars: AbstractChar[],
): number[] {
  const pos = new Array(chars.length).fill(0);
  let sum = 0;
  for (let i = 0; i < chars.length; i++) {
    const r = regrets ? regrets[ABSTRACT_ACTIONS.indexOf(chars[i])] : 0;
    if (r > 0) {
      pos[i] = r;
      sum += r;
    }
  }
  if (sum <= 0) return new Array(chars.length).fill(1 / chars.length);
  return pos.map((p) => p / sum);
}

export function sampleIndex(probs: number[], rng: () => number): number {
  let x = rng();
  let acc = 0;
  for (let i = 0; i < probs.length; i++) {
    acc += probs[i];
    if (x <= acc) return i;
  }
  return probs.length - 1;
}

export interface TraverserNodeSample {
  key: string;
  features: number[];
  adv: number[]; // length 4, entries for illegal actions are 0
  mask: number[]; // 1 = legal
  chars: AbstractChar[];
}

export type NodeCollector = (sample: TraverserNodeSample) => void;

/** One full traversal. Returns the traverser's payoff for the sampled hand. */
export function mccfrWalk(
  game: AbstractGame,
  traverser: number,
  tables: MCCFRTables,
  rng: () => number,
  reach: number,
  onTraverserNode?: NodeCollector,
): number {
  if (game.over()) return game.payoff(traverser);

  const legal = game.legal();
  if (!legal) throw new Error('walk reached non-terminal state without actor');
  const seat = game.state.actor!;
  const chars = game.chars(legal);

  if (seat === traverser) {
    const key = game.key();
    const sigma = regretMatching(tables.regret[traverser].get(key), chars);

    let r = tables.regret[traverser].get(key);
    if (!r) {
      r = new Float64Array(ABSTRACT_ACTIONS.length);
      tables.regret[traverser].set(key, r);
    }
    let s = tables.strategySum[traverser].get(key);
    if (!s) {
      s = new Float64Array(ABSTRACT_ACTIONS.length);
      tables.strategySum[traverser].set(key, s);
    }
    // Average strategy: own reach weighted
    for (let i = 0; i < chars.length; i++) {
      s[ABSTRACT_ACTIONS.indexOf(chars[i])] += reach * sigma[i];
    }

    const values = new Array<number>(chars.length).fill(0);
    let nodeValue = 0;
    for (let i = 0; i < chars.length; i++) {
      const child = game.clone();
      child.act(chars[i]);
      values[i] = mccfrWalk(child, traverser, tables, rng, reach * sigma[i], onTraverserNode);
      nodeValue += sigma[i] * values[i];
    }

    const adv = new Array(ABSTRACT_ACTIONS.length).fill(0);
    const mask = new Array(ABSTRACT_ACTIONS.length).fill(0);
    for (let i = 0; i < chars.length; i++) {
      const idx = ABSTRACT_ACTIONS.indexOf(chars[i]);
      const a = values[i] - nodeValue;
      // CFR+ style: clamp cumulative regrets at zero (faster convergence)
      r[idx] = Math.max(0, r[idx] + a);
      adv[idx] = a;
      mask[idx] = 1;
    }

    onTraverserNode?.({
      key,
      features: stateFeatures(game.state, seat),
      adv,
      mask,
      chars,
    });

    return nodeValue;
  } else {
    // Opponent: sample one action from their current strategy
    const key = game.key();
    const sigma = regretMatching(tables.regret[seat].get(key), chars);
    const i = sampleIndex(sigma, rng);
    game.act(chars[i]);
    return mccfrWalk(game, traverser, tables, rng, reach, onTraverserNode);
  }
}

/** Simple reservoir buffer for Deep CFR advantage samples. */
export class ReservoirBuffer {
  data: TraverserNodeSample[] = [];
  seen = 0;
  constructor(
    public cap: number,
    private rng: () => number = seededRng(777),
  ) {}
  push(x: TraverserNodeSample) {
    this.seen++;
    if (this.data.length < this.cap) {
      this.data.push(x);
    } else {
      const j = Math.floor(this.rng() * this.seen);
      if (j < this.cap) this.data[j] = x;
    }
  }
}

/** Average strategy of a player as a plain JSON-friendly map. */
export function averageStrategyTable(
  tables: MCCFRTables,
  player: number,
  minMass = 1e-6,
): Record<string, number[]> {
  const out: Record<string, number[]> = {};
  const sum = tables.strategySum[player];
  for (const [key, s] of sum) {
    let total = 0;
    for (let i = 0; i < s.length; i++) total += s[i];
    if (total < minMass) continue;
    out[key] = Array.from(s, (v) => Math.round((v / total) * 1000) / 1000);
  }
  return out;
}
