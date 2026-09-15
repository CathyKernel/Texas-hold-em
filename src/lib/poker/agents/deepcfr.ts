/**
 * Deep CFR (miniature) agent: a small MLP trained offline on reservoir-sampled
 * (features, counterfactual-advantage) pairs collected during MCCFR traversals.
 * At the table it predicts advantages with the network and applies regret
 * matching to the predictions — the Deep CFR architecture in miniature.
 */

import { ABSTRACT_ACTIONS, legalAbstractActions, mapAbstractAction, stateFeatures, type AbstractChar } from '../abstraction';
import type { AgentDecision, DecisionContext, PokerAgent } from './types';

export interface DeepCfrModel {
  meta: {
    samples: number;
    epochs: number;
    finalLoss: number;
    bufferCapacity: number;
    trainedAt: string;
    architecture: string;
  };
  advStd: number;
  w1: number[][]; // H x 14
  b1: number[]; // H
  w2: number[][]; // 4 x H
  b2: number[]; // 4
}

export function forward(model: DeepCfrModel, features: number[]): number[] {
  const H = model.b1.length;
  const hidden = new Array<number>(H);
  for (let h = 0; h < H; h++) {
    let z = model.b1[h];
    const row = model.w1[h];
    for (let i = 0; i < features.length; i++) z += row[i] * features[i];
    hidden[h] = Math.tanh(z);
  }
  const out = new Array<number>(4);
  for (let a = 0; a < 4; a++) {
    let z = model.b2[a];
    for (let h = 0; h < H; h++) z += model.w2[a][h] * hidden[h];
    out[a] = z * (model.advStd ?? 1);
  }
  return out;
}

const ACTION_LABELS = ['Fold', 'Check/Call', 'Raise ~½', 'Raise ~Pot'];

export function createDeepCfrAgent(model: DeepCfrModel | null): PokerAgent {
  return {
    type: 'deepcfr',
    name: 'The Deep Thinker',
    tagline: 'Neural advantage network + regret matching',
    algorithm: 'Deep CFR (miniature)',
    description:
      'A miniature Deep CFR: during offline MCCFR traversals, (state features, counterfactual advantages) pairs were reservoir-sampled into a replay memory, then a small MLP was trained to predict per-action advantages. Live, the network replaces the tabular regrets: predicted advantages are fed through regret matching (positives normalized) to produce the strategy, which is then sampled. This is the same architecture that powers full-scale Deep CFR agents, shrunk to run in your browser.',
    decide(ctx: DecisionContext): AgentDecision {
      const { state, legal, seat, rng } = ctx;
      const chars = legalAbstractActions(state, legal);
      let dist: number[];
      let advantages: number[] | null = null;
      if (model) {
        const feats = stateFeatures(state, seat);
        const adv = forward(model, feats);
        advantages = adv;
        const pos = chars.map((ch) => Math.max(0, adv[ABSTRACT_ACTIONS.indexOf(ch)]));
        const sum = pos.reduce((a, b) => a + b, 0);
        dist = sum > 0 ? pos.map((v) => v / sum) : chars.map(() => 1 / chars.length);
      } else {
        dist = chars.map(() => 1 / chars.length);
      }
      let x = rng();
      let pick: AbstractChar = chars[chars.length - 1];
      for (let i = 0; i < chars.length; i++) {
        x -= dist[i];
        if (x <= 0) {
          pick = chars[i];
          break;
        }
      }
      const probsDisplay = chars.map((ch, i) => ({
        label: ACTION_LABELS[ABSTRACT_ACTIONS.indexOf(ch)],
        p: dist[i],
      }));
      return {
        action: mapAbstractAction(state, legal, pick),
        abstractChar: pick,
        rationale:
          (advantages
            ? `Neural advantages: ${chars
                .map((ch) => `${ACTION_LABELS[ABSTRACT_ACTIONS.indexOf(ch)]} ${advantages![ABSTRACT_ACTIONS.indexOf(ch)].toFixed(1)}`)
                .join(', ')} → regret-matched strategy `
            : 'Model unavailable — uniform: ') +
          probsDisplay.map((d) => `${d.label} ${(d.p * 100).toFixed(0)}%`).join(', '),
        metrics: advantages
          ? Object.fromEntries(chars.map((ch) => [ACTION_LABELS[ABSTRACT_ACTIONS.indexOf(ch)], advantages![ABSTRACT_ACTIONS.indexOf(ch)]]))
          : undefined,
        probs: probsDisplay,
      };
    },
  };
}
