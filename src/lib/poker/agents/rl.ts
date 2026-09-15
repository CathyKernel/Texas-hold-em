/**
 * RL agent: tabular Q-learning trained offline by self-play against a mixed
 * opponent pool (rule-based bots, a random bot, and the CFR blueprint).
 * Reward = chip delta per hand; updates propagate backwards over the agent's
 * decision sequence with discounting. At the table it plays near-greedy.
 */

import { ABSTRACT_ACTIONS, handBucket, infosetKey, legalAbstractActions, mapAbstractAction } from '../abstraction';
import { positionClass, streetKey } from '../engine';
import type { AgentDecision, DecisionContext, PokerAgent } from './types';

export type QTable = Record<string, number[]>;

export interface RlPolicy {
  meta: {
    episodes: number;
    seconds: number;
    states: number;
    finalAvgReward: number;
    finalEpsilon: number;
    trainedAt: string;
    opponents: string;
  };
  q: QTable;
}

const ACTION_LABELS = ['Fold', 'Check/Call', 'Raise ~½', 'Raise ~Pot'];

export function createRlAgent(policy: RlPolicy | null, epsilon = 0.03): PokerAgent {
  return {
    type: 'rl',
    name: 'The Self-Taught',
    tagline: 'Q-learning from self-play chip rewards',
    algorithm: 'Reinforcement Learning (Q-learning)',
    description:
      'Trained by tabular Q-learning over the same abstracted state space: at every decision it scores each abstract action with Q(s,a), learned from hand-by-hand chip rewards (discounted, propagated backwards over its decisions) while playing against a pool of rule-based, random and CFR-blueprint opponents. It discovered aggression thresholds, position play, and discipline by trial and error — no poker knowledge was hand-coded.',
    decide(ctx: DecisionContext): AgentDecision {
      const { state, legal, seat, seq, rng } = ctx;
      const chars = legalAbstractActions(state, legal);
      const key = infosetKey(positionClass(state, seat), streetKey(state), handBucket(state, seat), seq);
      const qRow = policy?.q[key] ?? null;

      let pickIdx = Math.floor(rng() * chars.length);
      if (qRow && rng() > epsilon) {
        let bestV = -Infinity;
        for (let i = 0; i < chars.length; i++) {
          const v = qRow[ABSTRACT_ACTIONS.indexOf(chars[i])] ?? 0;
          if (v > bestV) {
            bestV = v;
            pickIdx = i;
          }
        }
      }
      const pick = chars[pickIdx];
      const probsDisplay = chars.map((ch, i) => ({
        label: ACTION_LABELS[ABSTRACT_ACTIONS.indexOf(ch)],
        p: i === pickIdx ? 1 : 0,
      }));
      const qDisplay = qRow ? chars.map((ch) => qRow[ABSTRACT_ACTIONS.indexOf(ch)] ?? 0) : null;
      const bucket = handBucket(state, seat);
      const bucketMax = state.stage === 'preflop' ? 20 : 10;
      return {
        action: mapAbstractAction(state, legal, pick),
        abstractChar: pick,
        rationale:
          (qDisplay
            ? `Learned Q-values: ${chars.map((ch, i) => `${ACTION_LABELS[ABSTRACT_ACTIONS.indexOf(ch)]} ${qDisplay![i].toFixed(0)}`).join(', ')} — argmax ${ACTION_LABELS[ABSTRACT_ACTIONS.indexOf(pick)]}`
            : `Unseen state (${streetKey(state)}, bucket ${bucket + 1}/${bucketMax}) — exploring randomly`) +
          (rng() < 0 ? '' : ` (bucket ${bucket + 1}/${bucketMax}, ${positionClass(state, seat)}, ε=${epsilon})`),
        metrics: qDisplay
          ? Object.fromEntries(chars.map((ch, i) => [ACTION_LABELS[ABSTRACT_ACTIONS.indexOf(ch)], qDisplay![i]]))
          : undefined,
        probs: probsDisplay,
      };
    },
  };
}
