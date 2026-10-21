/**
 * NIGHT POKER's cards: 0..51, rank = card >> 2 (0 = deuce … 12 = ace), suit = card & 3 (clubs,
 * diamonds, hearts, spades). The unshuffled deck is 2c 2d 2h 2s 3c … As, the order the provably
 * fair shuffle (deck.ts) starts from; the browser's verify tool uses the same order.
 */
export type Card = number;
export const RANKS = "23456789TJQKA";
export const SUITS = "cdhs";
export const rankOf = (c: Card) => c >> 2;
export const suitOf = (c: Card) => c & 3;
/** "As", "Td", "2c". */
export const cardText = (c: Card) => `${RANKS[rankOf(c)]}${SUITS[suitOf(c)]}`;
export function parseCard(s: string): Card {
  const r = RANKS.indexOf(s[0]?.toUpperCase() ?? ""), t = SUITS.indexOf(s[1]?.toLowerCase() ?? "");
  if (s.length !== 2 || r < 0 || t < 0) throw new Error(`Not a card: ${s}`);
  return (r << 2) | t;
}
export const parseCards = (s: string): Card[] => s.trim().split(/\s+/).filter(Boolean).map(parseCard);
export const freshDeck = (): Card[] => Array.from({ length: 52 }, (_, i) => i);
