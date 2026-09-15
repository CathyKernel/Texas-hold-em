/**
 * CFR agent: plays the average strategy ("blueprint") produced offline by
 * external-sampling MCCFR self-play on the abstracted game. This mirrors how
 * Libratus/Pluribus deploy precomputed GTO blueprints. Mixed strategies are
 * sampled faithfully, so the bot genuinely randomizes.
 */

import { handBucket, infosetKey, legalAbstractActions, mapAbstractAction, ABSTRACT_ACTIONS, type AbstractChar } from '../abstraction';
import { cardStr } from '../cards';
import { positionClass, streetKey } from '../engine';
import type { AgentDecision, DecisionContext, PokerAgent } from './types';

export type BlueprintTable = Record<string, number[]>;
export interface CfrBlueprint {
  meta: {
    iterations: number;
    seconds: number;
    infosets: number;
    trainedAt: string;
    abstraction: string;
  };
  /** Population-average strategy (summed strategy mass across training slots) */
  pooled?: BlueprintTable;
  players?: BlueprintTable[];
}

const ACTION_LABELS = ['Fold', 'Check/Call', 'Raise ~½', 'Raise ~Pot'];

export function createCfrAgent(blueprint: CfrBlueprint | null, tableIndex: number): PokerAgent {
  return {
    type: 'cfr',
    name: 'The Game Theorist',
    tagline: 'MCCFR equilibrium blueprint (mixed strategies)',
    algorithm: 'Counterfactual Regret Minimization',
    description:
      'Plays the average strategy profile computed offline by external-sampling Monte Carlo CFR self-play over an abstracted version of the game (20 preflop / 10 postflop hand buckets, 4 abstract actions, raise cap). Regret matching during training drives the strategy toward a Nash equilibrium of the abstract game, and at the table the blueprint is sampled exactly — including its bluffs and traps.',
    decide(ctx: DecisionContext): AgentDecision {
      const { state, legal, seat, seq, rng } = ctx;
      const chars = legalAbstractActions(state, legal);
      const key = infosetKey(positionClass(state, seat), streetKey(state), handBucket(state, seat), seq);
      let probs: number[] | null = null;
      const table = blueprint.pooled ?? blueprint.players?.[tableIndex] ?? null;
      if (table) {
        const row = table[key];
        if (row) probs = row;
      }
      let dist: number[];
      if (probs) {
        // Mask to legal actions and renormalize
        let total = 0;
        const masked = chars.map((ch) => {
          const v = probs![ABSTRACT_ACTIONS.indexOf(ch)] ?? 0;
          total += v;
          return v;
        });
        dist = total > 0 ? masked.map((v) => v / total) : chars.map(() => 1 / chars.length);
      } else {
        dist = chars.map(() => 1 / chars.length);
      }
      let x = rng();
      let pick = chars[chars.length - 1];
      for (let i = 0; i < chars.length; i++) {
        x -= dist[i];
        if (x <= 0) {
          pick = chars[i];
          break;
        }
      }
      const streetName = streetKey(state);
      const bucket = handBucket(state, seat);
      const bucketMax = state.stage === 'preflop' ? 20 : 10;
      const probsDisplay = chars.map((ch, i) => ({
        label: ACTION_LABELS[ABSTRACT_ACTIONS.indexOf(ch)],
        p: dist[i],
      }));
      return {
        action: mapAbstractAction(state, legal, pick),
        abstractChar: pick,
        rationale:
          (probs
            ? `Equilibrium blueprint (${streetName}, bucket ${bucket + 1}/${bucketMax}, ${positionClass(state, seat)}): `
            : `Unvisited infoset (${streetName}, bucket ${bucket + 1}/${bucketMax}) — falling back to uniform: `) +
          probsDisplay.map((d) => `${d.label} ${(d.p * 100).toFixed(0)}%`).join(', ') +
          (state.stage === 'preflop' ? `. Hole: ${state.players[seat].hole.map(cardStr).join('')}` : ''),
        metrics: { bucket, nActions: chars.length },
        probs: probsDisplay,
      };
    },
  };
}
