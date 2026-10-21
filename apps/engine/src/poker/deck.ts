import { createHash, createHmac, randomBytes } from "node:crypto";
import { type Card, freshDeck } from "./cards.js";

/**
 * The provably fair deck. Before a hand is dealt the server publishes the commitment
 * SHA-256(serverSeed) (the seed as its 64 hex characters, UTF-8). Each player's browser then sends
 * a client seed of its own for that hand. The deck is the unshuffled order (cards.ts) shuffled by
 * Fisher-Yates, from the top card down, with random numbers from an HMAC-SHA256 stream:
 *
 *   block k = HMAC-SHA256(key = serverSeed, message = "nightshift-poker-v1|<hand>|<seed seat 1>,<seed seat 2>,…|<k>")
 *
 * read as big-endian 32-bit numbers, eight per block; for position i (51 down to 1) a number u is
 * drawn until u < 2^32 − (2^32 mod (i + 1)) (no modulo bias), and card i swaps with card u mod (i + 1).
 * A seat that sent no seed counts as an empty one. After the hand the server seed is revealed: anyone
 * can check it against the commitment and rebuild the deck (GET /api/poker/verify, or the verify page,
 * which does the same in the browser with WebCrypto). The server cannot pick the deck (it committed
 * before the client seeds were known) and no player can (the server seed is secret until the end).
 */
export const DECK_VERSION = "nightshift-poker-v1";
export const newServerSeed = (): string => randomBytes(32).toString("hex");
export const commitOf = (serverSeed: string): string => createHash("sha256").update(serverSeed, "utf8").digest("hex");
/** A client seed as the server keeps it: 1 to 64 letters, digits, "-" or "_"; anything else is no seed. */
export const cleanSeed = (s: unknown): string => (typeof s === "string" && /^[A-Za-z0-9_-]{1,64}$/.test(s) ? s : "");

/** The deck of one hand, top card first. */
export function deckOrder(serverSeed: string, clientSeeds: readonly string[], hand: number): Card[] {
  const msg = (k: number) => `${DECK_VERSION}|${hand}|${clientSeeds.map(cleanSeed).join(",")}|${k}`;
  let block = Buffer.alloc(0), at = 0, k = 0;
  const next = () => {
    if (at + 4 > block.length) { block = createHmac("sha256", Buffer.from(serverSeed, "utf8")).update(msg(k++), "utf8").digest(); at = 0; }
    const u = block.readUInt32BE(at); at += 4;
    return u;
  };
  const deck = freshDeck();
  for (let i = 51; i >= 1; i--) {
    const n = i + 1, limit = 2 ** 32 - (2 ** 32 % n);
    let u = next();
    while (u >= limit) u = next();
    const j = u % n;
    [deck[i], deck[j]] = [deck[j]!, deck[i]!];
  }
  return deck;
}

/**
 * Where each card of a dealt hand came from: hole cards go round the table twice, one at a time,
 * from the first seat after the button; then a burn, the flop, a burn, the turn, a burn, the river.
 */
export function dealPlan(players: number) {
  const hole = Array.from({ length: players }, (_, i) => [i, i + players] as [number, number]);
  const b = 2 * players;
  return { hole, burns: [b, b + 4, b + 6], flop: [b + 1, b + 2, b + 3], turn: b + 5, river: b + 7 };
}
