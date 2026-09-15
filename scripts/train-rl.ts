/**
 * Train the RL agent: tabular Q-learning self-play against a mixed opponent
 * pool (rule-based, random, and a CFR blueprint bot). Terminal chip-delta
 * rewards are discounted and propagated backwards over each hand's decisions.
 * Output: public/ai/rl-policy.json
 */
import { seededRng } from '../src/lib/poker/cards';
import { ABSTRACT_ACTIONS, type AbstractChar } from '../src/lib/poker/abstraction';
import { AbstractGame, standardTrainingConfig } from '../src/lib/poker/training/abstract-game';
import { ruleDecideChar } from '../src/lib/poker/agents/rule-based';
import type { CfrBlueprint } from '../src/lib/poker/agents/cfr';

const TIME_BUDGET_MS = Number(process.argv[2] ?? 150_000);
const MAX_EPISODES = 300_000;
const GAMMA = 0.9;
const SEED = 31337;
const LEARNER = 0;
// Opponent pool at seats 1..5
const OPPONENTS: ('rule' | 'random' | 'cfr')[] = ['rule', 'rule', 'random', 'rule', 'cfr'];
const CFR_TABLE_INDEX = 4;

const rng = seededRng(SEED);
const blueprint: CfrBlueprint = await Bun.file('public/ai/cfr-blueprint.json').json();
const cfrTable = blueprint.pooled ?? blueprint.players?.[CFR_TABLE_INDEX];
if (!cfrTable) throw new Error('CFR blueprint table missing — run scripts/train-cfr.ts first');

const Q = new Map<string, number[]>();

function cfrOpponentChar(game: AbstractGame): AbstractChar {
  const legal = game.legal()!;
  const chars = game.chars(legal);
  const row = cfrTable[game.key()];
  if (!row) return chars[Math.floor(rng() * chars.length)];
  let total = 0;
  const masked = chars.map((ch) => {
    const v = row[ABSTRACT_ACTIONS.indexOf(ch)] ?? 0;
    total += v;
    return v;
  });
  if (total <= 0) return chars[Math.floor(rng() * chars.length)];
  let x = rng() * total;
  for (let i = 0; i < chars.length; i++) {
    x -= masked[i];
    if (x <= 0) return chars[i];
  }
  return chars[chars.length - 1];
}

const start = Date.now();
let episode = 0;
let rewardWindow: number[] = [];
const avgCurve: { episode: number; avgReward: number }[] = [];
let qUpdates = 0;

while (Date.now() - start < TIME_BUDGET_MS && episode < MAX_EPISODES) {
  const eps = Math.max(0.03, 0.25 * (1 - episode / 180_000));
  const alpha = Math.max(0.02, 0.12 * (1 - episode / 240_000));

  const game = new AbstractGame(standardTrainingConfig(6, Math.floor(rng() * 6)), rng);
  game.start();
  const history: { key: string; charIdx: number }[] = [];

  while (!game.over()) {
    const legal = game.legal();
    if (!legal) break;
    const seat = game.state.actor!;
    if (seat === LEARNER) {
      const chars = game.chars(legal);
      const key = game.key();
      let qRow = Q.get(key);
      if (!qRow) {
        qRow = [0, 0, 0, 0];
        Q.set(key, qRow);
      }
      let pickIdx: number;
      if (rng() < eps) {
        pickIdx = Math.floor(rng() * chars.length);
      } else {
        let best = -Infinity;
        pickIdx = 0;
        for (let i = 0; i < chars.length; i++) {
          const v = qRow[ABSTRACT_ACTIONS.indexOf(chars[i])];
          if (v > best) {
            best = v;
            pickIdx = i;
          }
        }
      }
      game.act(chars[pickIdx]);
      history.push({ key, charIdx: ABSTRACT_ACTIONS.indexOf(chars[pickIdx]) });
    } else {
      const kind = OPPONENTS[seat - 1];
      let ch: AbstractChar;
      if (kind === 'rule') {
        ch = ruleDecideChar(game.state, legal, seat, rng).char;
      } else if (kind === 'random') {
        const chars = game.chars(legal);
        ch = chars[Math.floor(rng() * chars.length)];
      } else {
        ch = cfrOpponentChar(game);
      }
      game.act(ch);
    }
  }

  // Backward Q update over the learner's decisions
  const reward = game.payoff(LEARNER);
  let G = reward;
  for (let t = history.length - 1; t >= 0; t--) {
    const { key, charIdx } = history[t];
    const qRow = Q.get(key)!;
    qRow[charIdx] += alpha * (G - qRow[charIdx]);
    qUpdates++;
    G *= GAMMA;
  }

  rewardWindow.push(reward);
  if (rewardWindow.length > 10_000) rewardWindow.shift();
  episode++;
  if (episode % 20_000 === 0) {
    const avg = rewardWindow.reduce((a, b) => a + b, 0) / rewardWindow.length;
    avgCurve.push({ episode, avgReward: Math.round(avg * 10) / 10 });
    console.log(`episode ${episode} | ${((Date.now() - start) / 1000).toFixed(0)}s | states ${Q.size} | avg reward (10k window) ${avg.toFixed(2)} | eps ${eps.toFixed(3)} alpha ${alpha.toFixed(3)}`);
  }
}

const elapsed = (Date.now() - start) / 1000;
const finalAvg = rewardWindow.reduce((a, b) => a + b, 0) / Math.max(1, rewardWindow.length);

// Round the Q table for compactness
const q: Record<string, number[]> = {};
for (const [k, row] of Q) {
  q[k] = row.map((v) => Math.round(v * 10) / 10);
}

const policy = {
  meta: {
    episodes: episode,
    seconds: Math.round(elapsed),
    states: Q.size,
    finalAvgReward: Math.round(finalAvg * 100) / 100,
    finalEpsilon: Math.max(0.03, 0.25 * (1 - episode / 180_000)),
    trainedAt: new Date().toISOString(),
    opponents: `6-max pool: seats 1-5 = ${OPPONENTS.join(', ')}; learner=Q-learning(γ=${GAMMA}), terminal chip reward, backward discounted updates; ${qUpdates} updates`,
  },
  learningCurve: avgCurve,
  q,
};

await Bun.write('public/ai/rl-policy.json', JSON.stringify(policy));
const size = (await Bun.file('public/ai/rl-policy.json').arrayBuffer()).byteLength / 1024;
console.log(`\nRL policy: ${episode} episodes in ${elapsed.toFixed(0)}s, ${Q.size} states, final avg reward ${finalAvg.toFixed(2)}, file ${size.toFixed(0)} KB`);
console.log('learning curve:', JSON.stringify(avgCurve));
