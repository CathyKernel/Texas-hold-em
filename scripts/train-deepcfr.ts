/**
 * Train the Deep CFR miniature:
 *  1. Run ES-MCCFR traversals; reservoir-sample (features, advantage) pairs.
 *  2. Train a small MLP (14 -> 32 -> 4) to predict counterfactual advantages.
 *  3. Validate with held-out correlation.
 * Output: public/ai/deepcfr-model.json
 */
import { seededRng } from '../src/lib/poker/cards';
import { AbstractGame, standardTrainingConfig } from '../src/lib/poker/training/abstract-game';
import { createTables, mccfrWalk, ReservoirBuffer } from '../src/lib/poker/training/mccfr';

const WALK_BUDGET_MS = Number(process.argv[2] ?? 60_000);
const TRAIN_BUDGET_MS = Number(process.argv[3] ?? 120_000);
const HIDDEN = 32;
const BATCH = 128;
const LR = 0.02;
const MOMENTUM = 0.9;
const BUFFER_CAP = 60_000;
const SEED = 777001;

// ---------- Phase 1: collect advantage samples ----------
const rng = seededRng(SEED);
const tables = createTables(6);
const buffer = new ReservoirBuffer(BUFFER_CAP, seededRng(SEED + 1));
const start = Date.now();
let iter = 0;
let advSum = 0;
let advSqSum = 0;
let advCount = 0;

while (Date.now() - start < WALK_BUDGET_MS) {
  const game = new AbstractGame(standardTrainingConfig(6, Math.floor(rng() * 6)), rng);
  game.start();
  mccfrWalk(game, iter % 6, tables, rng, 1, (sample) => {
    for (let a = 0; a < 4; a++) {
      if (sample.mask[a]) {
        advSum += sample.adv[a];
        advSqSum += sample.adv[a] * sample.adv[a];
        advCount++;
      }
    }
    buffer.push(sample);
  });
  iter++;
}
const advMean = advSum / advCount;
const advStd = Math.sqrt(Math.max(1e-9, advSqSum / advCount - advMean * advMean));
console.log(`collected ${buffer.seen} node visits, buffer ${buffer.data.length}, iter ${iter}, adv mean ${advMean.toFixed(1)} std ${advStd.toFixed(1)}`);

// ---------- Phase 2: train the advantage network ----------
const data = buffer.data;
const nVal = Math.floor(data.length * 0.05);
const val = data.slice(0, nVal);
const train = data.slice(nVal);

const F = 14;
const w1: number[][] = Array.from({ length: HIDDEN }, () => Array.from({ length: F }, () => (rng() * 2 - 1) * Math.sqrt(1 / F)));
const b1: number[] = new Array(HIDDEN).fill(0);
const w2: number[][] = Array.from({ length: 4 }, () => Array.from({ length: HIDDEN }, () => (rng() * 2 - 1) * Math.sqrt(1 / HIDDEN)));
const b2: number[] = new Array(4).fill(0);
const vw1 = w1.map((r) => r.map(() => 0));
const vb1 = b1.map(() => 0);
const vw2 = w2.map((r) => r.map(() => 0));
const vb2 = b2.map(() => 0);

function forwardSample(f: number[]): { hidden: number[]; out: number[] } {
  const hidden = new Array(HIDDEN).fill(0);
  for (let h = 0; h < HIDDEN; h++) {
    let z = b1[h];
    for (let i = 0; i < F; i++) z += w1[h][i] * f[i];
    hidden[h] = Math.tanh(z);
  }
  const out = new Array(4).fill(0);
  for (let a = 0; a < 4; a++) {
    let z = b2[a];
    for (let h = 0; h < HIDDEN; h++) z += w2[a][h] * hidden[h];
    out[a] = z;
  }
  return { hidden, out };
}

function lossOn(set: typeof data): { mse: number; corr: number } {
  let mse = 0;
  let n = 0;
  let sx = 0, sy = 0, sxx = 0, syy = 0, sxy = 0;
  for (const s of set) {
    const { out } = forwardSample(s.features);
    for (let a = 0; a < 4; a++) {
      if (!s.mask[a]) continue;
      const t = s.adv[a] / advStd;
      const d = out[a] - t;
      mse += d * d;
      n++;
      sx += out[a]; sy += t; sxx += out[a] * out[a]; syy += t * t; sxy += out[a] * t;
    }
  }
  const cov = sxy / n - (sx / n) * (sy / n);
  const vx = sxx / n - (sx / n) * (sx / n);
  const vy = syy / n - (sy / n) * (sy / n);
  const corr = Math.sqrt(vx * vy) > 0 ? cov / Math.sqrt(vx * vy) : 0;
  return { mse: mse / n, corr };
}

const t2 = Date.now();
let epoch = 0;
const trainIdx = train.map((_, i) => i);
for (; Date.now() - t2 < TRAIN_BUDGET_MS && epoch < 1000; epoch++) {
  // shuffle
  for (let i = trainIdx.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [trainIdx[i], trainIdx[j]] = [trainIdx[j], trainIdx[i]];
  }
  const lr = LR * (0.5 / (1 + epoch / 50) + 0.5);
  for (let bstart = 0; bstart + BATCH <= train.length; bstart += BATCH) {
    const grads = {
      w1: w1.map((r) => r.map(() => 0)),
      b1: b1.map(() => 0),
      w2: w2.map((r) => r.map(() => 0)),
      b2: b2.map(() => 0),
    };
    for (let bi = 0; bi < BATCH; bi++) {
      const s = train[trainIdx[bstart + bi]];
      const { hidden, out } = forwardSample(s.features);
      const dOut = new Array(4).fill(0);
      for (let a = 0; a < 4; a++) {
        if (!s.mask[a]) continue;
        dOut[a] = (2 * (out[a] - s.adv[a] / advStd)) / BATCH;
      }
      for (let a = 0; a < 4; a++) {
        grads.b2[a] += dOut[a];
        for (let h = 0; h < HIDDEN; h++) grads.w2[a][h] += dOut[a] * hidden[h];
      }
      for (let h = 0; h < HIDDEN; h++) {
        let dz = 0;
        for (let a = 0; a < 4; a++) dz += dOut[a] * w2[a][h];
        dz *= 1 - hidden[h] * hidden[h];
        grads.b1[h] += dz;
        for (let i2 = 0; i2 < F; i2++) grads.w1[h][i2] += dz * s.features[i2];
      }
    }
    const upd = (w: number[], g: number[], v: number[]) => {
      for (let i = 0; i < w.length; i++) {
        v[i] = MOMENTUM * v[i] - lr * g[i];
        w[i] += v[i];
      }
    };
    for (let h = 0; h < HIDDEN; h++) {
      upd(w1[h], grads.w1[h], vw1[h]);
    }
    upd(b1, grads.b1, vb1);
    for (let a = 0; a < 4; a++) {
      upd(w2[a], grads.w2[a], vw2[a]);
    }
    upd(b2, grads.b2, vb2);
  }
  if (epoch % 20 === 0) {
    const v = lossOn(val);
    console.log(`epoch ${epoch} | val MSE ${v.mse.toFixed(4)} | corr ${v.corr.toFixed(3)}`);
  }
}

const vres = lossOn(val);
console.log(`final: epochs ${epoch} | val MSE ${vres.mse.toFixed(4)} | corr ${vres.corr.toFixed(3)}`);

const model = {
  meta: {
    samples: buffer.data.length,
    nodeVisits: buffer.seen,
    epochs: epoch,
    finalLoss: Math.round(vres.mse * 10000) / 10000,
    bufferCapacity: BUFFER_CAP,
    trainedAt: new Date().toISOString(),
    architecture: `MLP ${F}->${HIDDEN}->4 (tanh), masked MSE on standardized advantages, SGD+momentum`,
  },
  advStd,
  w1: w1.map((r) => r.map((x) => Math.round(x * 1e5) / 1e5)),
  b1: b1.map((x) => Math.round(x * 1e5) / 1e5),
  w2: w2.map((r) => r.map((x) => Math.round(x * 1e5) / 1e5)),
  b2: b2.map((x) => Math.round(x * 1e5) / 1e5),
};

await Bun.write('public/ai/deepcfr-model.json', JSON.stringify(model));
const size = (await Bun.file('public/ai/deepcfr-model.json').arrayBuffer()).byteLength / 1024;
console.log(`Deep CFR model saved: ${size.toFixed(0)} KB`);
