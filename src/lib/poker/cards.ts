/**
 * Card representation and deck utilities for Texas Hold'em.
 * A card is an integer 0..51: rank = card >> 2 (0 = Deuce, 12 = Ace), suit = card & 3.
 * Suits: 0 = Spades, 1 = Hearts, 2 = Diamonds, 3 = Clubs.
 */

export const NUM_RANKS = 13;
export const NUM_SUITS = 4;
export const DECK_SIZE = 52;

export const RANK_CHARS = ['2', '3', '4', '5', '6', '7', '8', '9', 'T', 'J', 'Q', 'K', 'A'] as const;
export const SUIT_CHARS = ['s', 'h', 'd', 'c'] as const;
export const SUIT_SYMBOLS = ['\u2660', '\u2665', '\u2666', '\u2663'] as const;

export function cardRank(card: number): number {
  return card >> 2;
}

export function cardSuit(card: number): number {
  return card & 3;
}

export function rankChar(rank: number): string {
  return RANK_CHARS[rank];
}

/** e.g. card 50 => "As" */
export function cardStr(card: number): string {
  return RANK_CHARS[card >> 2] + SUIT_CHARS[card & 3];
}

/** "As" => 50 */
export function cardFromStr(s: string): number {
  const r = RANK_CHARS.indexOf(s[0].toUpperCase() as (typeof RANK_CHARS)[number]);
  const su = SUIT_CHARS.indexOf(s[1].toLowerCase() as (typeof SUIT_CHARS)[number]);
  return r * 4 + su;
}

export function makeDeck(): number[] {
  const deck: number[] = [];
  for (let c = 0; c < 52; c++) deck.push(c);
  return deck;
}

/** Fisher-Yates with injectable RNG (deterministic for training). */
export function shuffle<T>(arr: T[], rng: () => number): T[] {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    const tmp = arr[i];
    arr[i] = arr[j];
    arr[j] = tmp;
  }
  return arr;
}

/** Mulberry32 seeded RNG — small, fast, deterministic. */
export function seededRng(seed: number): () => number {
  let a = seed >>> 0;
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function suitsAreFlush(cards: number[]): boolean {
  const s = cards[0] & 3;
  for (let i = 1; i < cards.length; i++) if ((cards[i] & 3) !== s) return false;
  return true;
}
