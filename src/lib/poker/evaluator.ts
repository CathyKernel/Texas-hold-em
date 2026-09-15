/**
 * 7-card hand evaluator for Texas Hold'em.
 * Score packing: category * 15^5 + ordered tie-breaker ranks.
 * Higher score = better hand. Safe within JS integer range.
 */

import { RANK_CHARS, cardRank, cardSuit } from './cards';

export const CATEGORY_NAMES = [
  'High Card',
  'One Pair',
  'Two Pair',
  'Three of a Kind',
  'Straight',
  'Flush',
  'Full House',
  'Four of a Kind',
  'Straight Flush',
] as const;

const P5 = 15 ** 5; // 759375

function packScore(cat: number, tiebreaks: number[]): number {
  let s = cat * P5;
  for (let i = 0; i < 5; i++) {
    const r = i < tiebreaks.length ? tiebreaks[i] : 0;
    s += r * 15 ** (4 - i);
  }
  return s;
}

/** Evaluate exactly 5 cards. Returns packed score. */
export function evaluate5(cards: number[]): number {
  const counts = new Array(13).fill(0);
  const suitCounts = [0, 0, 0, 0];
  for (const c of cards) {
    counts[cardRank(c)]++;
    suitCounts[cardSuit(c)]++;
  }
  const isFlush = suitCounts.some((s) => s === 5);

  // Straight detection
  let straightHigh = -1;
  const uniq: number[] = [];
  for (let r = 12; r >= 0; r--) if (counts[r] > 0) uniq.push(r);
  if (uniq.length === 5) {
    if (uniq[0] - uniq[4] === 4) straightHigh = uniq[0];
    else if (uniq[0] === 12 && uniq[1] === 3 && uniq[1] - uniq[4] === 3) straightHigh = 3; // wheel A-5
  }

  if (isFlush && straightHigh >= 0) return packScore(8, [straightHigh]);
  if (straightHigh >= 0) return packScore(4, [straightHigh]);

  // Group ranks by count
  const quads: number[] = [];
  const trips: number[] = [];
  const pairs: number[] = [];
  const singles: number[] = [];
  for (let r = 12; r >= 0; r--) {
    if (counts[r] === 4) quads.push(r);
    else if (counts[r] === 3) trips.push(r);
    else if (counts[r] === 2) pairs.push(r);
    else if (counts[r] === 1) singles.push(r);
  }

  if (quads.length) return packScore(7, [quads[0], singles[0] ?? 0]);
  if (trips.length && pairs.length) return packScore(6, [trips[0], pairs[0]]);
  if (isFlush) return packScore(5, uniq.slice(0, 5));
  if (trips.length) return packScore(3, [trips[0], singles[0], singles[1]]);
  if (pairs.length === 2) return packScore(2, [pairs[0], pairs[1], singles[0]]);
  if (pairs.length === 1) return packScore(1, [pairs[0], singles[0], singles[1], singles[2]]);
  return packScore(0, uniq.slice(0, 5));
}

const C74_IDX = (() => {
  // indices of 21 five-card combinations from 7 cards
  const idx: number[][] = [];
  for (let a = 0; a < 7; a++)
    for (let b = a + 1; b < 7; b++)
      for (let c = b + 1; c < 7; c++)
        for (let d = c + 1; d < 7; d++)
          for (let e = d + 1; e < 7; e++) idx.push([a, b, c, d, e]);
  return idx;
})();

const _buf5 = [0, 0, 0, 0, 0];

/** Evaluate best 5-card hand from 6 or 7 cards. Returns packed score. */
export function evaluate(cards: number[]): number {
  if (cards.length === 5) return evaluate5(cards);
  let best = -1;
  const combos = cards.length === 7 ? C74_IDX : null;
  if (combos) {
    for (const [a, b, c, d, e] of combos) {
      _buf5[0] = cards[a];
      _buf5[1] = cards[b];
      _buf5[2] = cards[c];
      _buf5[3] = cards[d];
      _buf5[4] = cards[e];
      const s = evaluate5(_buf5);
      if (s > best) best = s;
    }
    return best;
  }
  // 6 cards: choose 1 to drop
  for (let drop = 0; drop < 6; drop++) {
    let k = 0;
    for (let i = 0; i < 6; i++) if (i !== drop) _buf5[k++] = cards[i];
    const s = evaluate5(_buf5);
    if (s > best) best = s;
  }
  return best;
}

/** Unpack a score into {category, tiebreaks}. */
export function unpackScore(score: number): { category: number; tiebreaks: number[] } {
  const cat = Math.floor(score / P5);
  let rem = score - cat * P5;
  const tb: number[] = [];
  for (let i = 0; i < 5; i++) {
    const p = 15 ** (4 - i);
    const v = Math.floor(rem / p);
    rem -= v * p;
    tb.push(v);
  }
  return { category: cat, tiebreaks: tb };
}

function rankName(r: number): string {
  const names = ['Deuce', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten', 'Jack', 'Queen', 'King', 'Ace'];
  return names[r];
}

function rankPlural(r: number): string {
  const names = ['Deuces', 'Threes', 'Fours', 'Fives', 'Sixes', 'Sevens', 'Eights', 'Nines', 'Tens', 'Jacks', 'Queens', 'Kings', 'Aces'];
  return names[r];
}

/** Human readable description of a 7-card hand's best 5 cards. */
export function describeScore(score: number): string {
  const { category, tiebreaks } = unpackScore(score);
  const t = tiebreaks;
  switch (category) {
    case 8:
      return t[0] === 12 ? 'Royal Flush' : `Straight Flush, ${rankName(t[0])} high`;
    case 7:
      return `Four of a Kind, ${rankPlural(t[0])}`;
    case 6:
      return `Full House, ${rankPlural(t[0])} full of ${rankPlural(t[1])}`;
    case 5:
      return `Flush, ${RANK_CHARS[t[0]]} high`;
    case 4:
      return `Straight, ${rankName(t[0])} high`;
    case 3:
      return `Three of a Kind, ${rankPlural(t[0])}`;
    case 2:
      return `Two Pair, ${rankPlural(t[0])} and ${rankPlural(t[1])}`;
    case 1:
      return `One Pair, ${rankPlural(t[0])}`;
    default:
      return `High Card, ${rankName(t[0])}`;
  }
}
