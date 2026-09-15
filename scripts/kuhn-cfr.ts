/**
 * Kuhn poker (3-card, J<Q<K, ante 1, bet 1) solved by vanilla CFR.
 * Verifies: P1 game value = -1/18, and the one-parameter equilibrium family.
 * Run: bun run scripts/kuhn-cfr.ts
 */

// Information set tree for Kuhn poker:
// P1 acts first: check (k) or bet (b).
//  - P1 bets -> P2: fold (f) or call (c). Terminal.
//  - P1 checks -> P2: check or bet.
//      - P2 checks -> showdown for pot 2.
//      - P2 bets -> P1: fold or call. Terminal.
// Cards dealt uniformly from 6 permutations.

type Action = 'k' | 'b' | 'f' | 'c';

interface Node {
  kind: 'chance' | 'p1' | 'p2' | 'terminal';
  // chance: deal cards; p1/p2: infoset key; terminal: payoff to P1
  children?: Map<Action, Node>;
  infoset?: string; // e.g. "p1:J" or "p1:J:kb" (history after check-bet)
  pot?: number;
  p1Card?: number;
  p2Card?: number;
  folded?: -1 | 0 | 1 | 2; // who folded: 1 or 2 (0 = none)
}

function terminal(p1Card: number, p2Card: number, pot: number, folded: number): Node {
  // Payoff to P1 in units of chips relative to start (each anted 1).
  if (folded === 2) return { kind: 'terminal', p1Card, p2Card, pot, folded, } as Node;
  return { kind: 'terminal', p1Card, p2Card, pot, folded } as Node;
}

/** Payoff to P1 given terminal node data. */
function payoffP1(n: { p1Card: number; p2Card: number; pot: number; folded: number }): number {
  const { p1Card, p2Card, pot, folded } = n;
  if (folded === 2) return pot - 1; // P2 folded: P1 wins pot; P1 invested 1
  if (folded === 1) return -1; // P1 folded: loses ante
  const win = p1Card > p2Card;
  const invested = pot / 2;
  return win ? pot - invested : -invested;
}

// Build the game tree given dealt cards.
function buildTree(c1: number, c2: number): Node {
  // Round 1: P1 k or b
  const root: Node = { kind: 'p1', infoset: `p1:${c1}` };
  const children = new Map<Action, Node>();

  // P1 bets -> P2 fold/call
  const afterBet: Node = { kind: 'p2', infoset: `p2:${c2}:b` };
  afterBet.children = new Map<Action, Node>([
    ['f', terminal(c1, c2, 2, 2)],
    ['c', terminal(c1, c2, 4, 0)],
  ]);
  children.set('b', afterBet);

  // P1 checks -> P2 k or b
  const afterCheck: Node = { kind: 'p2', infoset: `p2:${c2}:k` };
  const afterCheckChildren = new Map<Action, Node>();
  afterCheckChildren.set('k', terminal(c1, c2, 2, 0));
  // P2 bets -> P1 fold or call
  const afterCheckBet: Node = { kind: 'p1', infoset: `p1:${c1}:kb` };
  afterCheckBet.children = new Map<Action, Node>([
    ['f', terminal(c1, c2, 2, 1)],
    ['c', terminal(c1, c2, 4, 0)],
  ]);
  afterCheckChildren.set('b', afterCheckBet);
  afterCheck.children = afterCheckChildren;
  children.set('k', afterCheck);

  root.children = children;
  return root;
}

const CARDS = [0, 1, 2]; // J=0, Q=1, K=2
const deals: [number, number][] = [];
for (const a of CARDS) for (const b of CARDS) if (a !== b) deals.push([a, b]);

// CFR: regrets and strategies per infoset, actions [first, second] where the
// action order per node kind: p1 root: [k, b]; p2 nodes: [k/f, b/c]; p1 kb: [f, c].
const ACTIONS: Record<string, string[]> = {
  p1root: ['k', 'b'],
  p2b: ['f', 'c'],
  p2k: ['k', 'b'],
  p1kb: ['f', 'c'],
};

function nodeType(n: Node): keyof typeof ACTIONS {
  if (n.kind === 'p1') return n.infoset!.includes(':kb') ? 'p1kb' : 'p1root';
  return n.infoset!.includes(':b') ? 'p2b' : 'p2k';
}

const regret = new Map<string, number[]>();
const stratSum = new Map<string, number[]>();

function regretMatch(key: string, nA: number): number[] {
  const r = regret.get(key);
  const pos = new Array(nA).fill(0);
  let s = 0;
  for (let i = 0; i < nA; i++) {
    const v = r ? Math.max(0, r[i]) : 0;
    pos[i] = v;
    s += v;
  }
  if (s <= 0) return new Array(nA).fill(1 / nA);
  return pos.map((v) => v / s);
}

/** cfr(node, reach1, reach2) returns expected utility for P1.
 * updatePlayer: whose regrets to update (alternating updates). */
function cfr(n: Node, reach1: number, reach2: number, updatePlayer: 1 | 2): number {
  if (n.kind === 'terminal') return payoffP1(n as never);
  const key = n.infoset!;
  const type = nodeType(n);
  const acts = ACTIONS[type];
  const nA = acts.length;
  const sigma = regretMatch(key, nA);
  const isP1 = n.kind === 'p1';

  // accumulate average strategy weighted by own reach
  const ss = stratSum.get(key) ?? new Array(nA).fill(0);
  const w = isP1 ? reach1 : reach2;
  for (let i = 0; i < nA; i++) ss[i] += w * sigma[i];
  stratSum.set(key, ss);

  const vals = new Array(nA).fill(0);
  let nodeVal = 0;
  for (let i = 0; i < nA; i++) {
    const child = n.children!.get(acts[i] as Action)!;
    vals[i] = cfr(child, isP1 ? reach1 * sigma[i] : reach1, isP1 ? reach2 : reach2 * sigma[i], updatePlayer);
    nodeVal += sigma[i] * vals[i];
  }
  if ((isP1 ? 1 : 2) === updatePlayer) {
    const r = regret.get(key) ?? new Array(nA).fill(0);
    const opp = isP1 ? reach2 : reach1; // counterfactual weight: opponent reach
    // Zero-sum: P2's utility is -u1, so P2's action regret is the NEGATIVE of
    // the P1-utility difference.
    const sign = isP1 ? 1 : -1;
    for (let i = 0; i < nA; i++) r[i] += opp * sign * (vals[i] - nodeVal);
    regret.set(key, r);
  }
  return nodeVal;
}

const rng = (() => {
  let s = 123456789;
  return () => {
    s = (1103515245 * s + 12345) % 2147483648;
    return s / 2147483648;
  };
})();

const ITER = 200_000;
let valueSum = 0;
let valueCount = 0;
for (let t = 0; t < ITER; t++) {
  // Vanilla CFR: enumerate ALL six deals (chance weight 1/6 folded into the
  // counterfactual reach), alternating the updating player each iteration.
  const updatePlayer: 1 | 2 = (t % 2 === 0 ? 1 : 2);
  let iterVal = 0;
  for (const [c1, c2] of deals) {
    iterVal += (1 / 6) * cfr(buildTree(c1, c2), 1, 1, updatePlayer);
  }
  // Track value under the CURRENT profile every 100 iterations (for display)
  if (t % 100 === 0) {
    valueSum += iterVal;
    valueCount++;
  }
}
const gameValue = valueSum / Math.max(1, valueCount);
console.log(`P1 expected value after ${ITER} iters: ${gameValue.toFixed(6)} (theory: ${(-1 / 18).toFixed(6)})`);

console.log('\nAverage strategy (rounded):');
for (const [key, ss] of [...stratSum.entries()].sort()) {
  const type = key.startsWith('p1') ? (key.includes(':kb') ? 'p1kb' : 'p1root') : key.includes(':b') ? 'p2b' : 'p2k';
  const acts = ACTIONS[type];
  const total = ss.reduce((a, b) => a + b, 0);
  const avg = ss.map((v) => v / total);
  const card = key.split(':')[1] === '0' ? 'J' : key.split(':')[1] === '1' ? 'Q' : 'K';
  const hist = key.includes(':kb') ? ' (after check, facing bet)' : key.includes(':b') ? ' (facing bet)' : '';
  console.log(`  ${key.startsWith('p1') ? 'P1' : 'P2'} ${card}${hist}: ${acts.map((a, i) => `${a}=${avg[i].toFixed(3)}`).join(' ')}`);
}

// ---- Brute-force verification of the BR values over all pure strategies ----
// P1 infosets: 3 root (J,Q,K) + 3 kb = 6 binary choices -> 64 pure strategies.
// Same for P2: 3 facing-bet + 3 after-check -> 64 pure strategies.
const p1Sets = ['p1:0', 'p1:1', 'p1:2', 'p1:0:kb', 'p1:1:kb', 'p1:2:kb'];
const p2Sets = ['p2:0:b', 'p2:1:b', 'p2:2:b', 'p2:0:k', 'p2:1:k', 'p2:2:k'];

function bits(n: number): number[] {
  return [n & 1, (n >> 1) & 1, (n >> 2) & 1, (n >> 3) & 1, (n >> 4) & 1, (n >> 5) & 1];
}

const avg = (key: string): number[] => {
  const type = key.startsWith('p1') ? (key.includes(':kb') ? 'p1kb' : 'p1root') : key.includes(':b') ? 'p2b' : 'p2k';
  const acts = ACTIONS[type];
  const ss = stratSum.get(key);
  if (!ss) return new Array(acts.length).fill(1 / acts.length);
  const t = ss.reduce((a, b) => a + b, 0);
  return ss.map((v) => v / t);
};

/** Exact EV of average-vs-average profile (behavioral, perfect recall). */
function profileValue(): number {
  let total = 0;
  for (const [c1, c2] of deals) {
    const tree = buildTree(c1, c2);
    function walk(n: Node): number {
      if (n.kind === 'terminal') return payoffP1(n as never);
      const s = avg(n.infoset!);
      const type = nodeType(n);
      const acts = ACTIONS[type];
      let v = 0;
      for (let i = 0; i < acts.length; i++) v += s[i] * walk(n.children!.get(acts[i] as Action)!);
      return v;
    }
    total += (1 / 6) * walk(tree);
  }
  return total;
}

/** BR1 by brute force: best pure P1 strategy vs P2's behavioral average. */
function bruteBR1(): number {
  // P2's average is behavioral; P1's pure strategy EV = sum over deals with
  // P2 mixing. Enumerate P2's pure realization? Behavioral mixing requires
  // expectation over P2's randomness: enumerate all 64 P2 pure profiles with
  // their probabilities... simpler: walk the tree with P2 avg and P1 pure.
  let best = -Infinity;
  for (let mask = 0; mask < 64; mask++) {
    const b = bits(mask);
    let total = 0;
    for (const [c1, c2] of deals) {
      const tree = buildTree(c1, c2);
      function walk(n: Node): number {
        if (n.kind === 'terminal') return payoffP1(n as never);
        const type = nodeType(n);
        const acts = ACTIONS[type];
        if (n.kind === 'p1') {
          const idx = b[p1Sets.indexOf(n.infoset!)];
          return walk(n.children!.get(acts[idx] as Action)!);
        }
        const s = avg(n.infoset!);
        let v = 0;
        for (let i = 0; i < acts.length; i++) v += s[i] * walk(n.children!.get(acts[i] as Action)!);
        return v;
      }
      total += (1 / 6) * walk(tree);
    }
    best = Math.max(best, total);
  }
  return best;
}

/** BR2 by brute force: best pure P2 strategy (minimizing P1's EV) vs P1's avg. */
function bruteBR2(): number {
  let best = Infinity;
  for (let mask = 0; mask < 64; mask++) {
    const b = bits(mask);
    let total = 0;
    for (const [c1, c2] of deals) {
      const tree = buildTree(c1, c2);
      function walk(n: Node): number {
        if (n.kind === 'terminal') return payoffP1(n as never);
        const type = nodeType(n);
        const acts = ACTIONS[type];
        if (n.kind === 'p2') {
          const idx = b[p2Sets.indexOf(n.infoset!)];
          return walk(n.children!.get(acts[idx] as Action)!);
        }
        const s = avg(n.infoset!);
        let v = 0;
        for (let i = 0; i < acts.length; i++) v += s[i] * walk(n.children!.get(acts[i] as Action)!);
        return v;
      }
      total += (1 / 6) * walk(tree);
    }
    best = Math.min(best, total);
  }
  return best;
}

console.log(`\n[brute force] avg-vs-avg profile value: ${profileValue().toFixed(6)} (theory: ${(-1 / 18).toFixed(6)})`);
const bbr1 = bruteBR1();
const bbr2 = bruteBR2();
console.log(`[brute force] BR1 = ${bbr1.toFixed(6)}, BR2min = ${bbr2.toFixed(6)}, exploitability = ${(0.5 * (bbr1 - bbr2)).toFixed(6)}`);
