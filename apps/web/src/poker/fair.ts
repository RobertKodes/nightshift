/**
 * NIGHT POKER's provably fair deck, rebuilt in the browser with WebCrypto: the same derivation as
 * the server's (apps/engine/src/poker/deck.ts), so anyone can check a finished hand without trusting
 * the server. A test runs both on the same seeds.
 *
 *   commitment = SHA-256(serverSeed)                (the seed as its hex text, UTF-8)
 *   block k    = HMAC-SHA256(serverSeed, "nightshift-poker-v1|<hand>|<client seeds by seat, comma-separated>|<k>")
 *   the deck   = 2c 2d 2h 2s 3c … As, Fisher-Yates from the top card down, each swap drawn from the
 *                blocks as big-endian 32-bit numbers, with no modulo bias.
 */
export const DECK_VERSION = "nightshift-poker-v1";
const RANKS = "23456789TJQKA", SUITS = "cdhs";
export const cardText = (c: number) => `${RANKS[c >> 2]}${SUITS[c & 3]}`;
const enc = new TextEncoder();
const hex = (b: ArrayBuffer) => [...new Uint8Array(b)].map((x) => x.toString(16).padStart(2, "0")).join("");
export const cleanSeed = (s: string) => (/^[A-Za-z0-9_-]{1,64}$/.test(s) ? s : "");

export async function commitOf(serverSeed: string): Promise<string> {
  return hex(await crypto.subtle.digest("SHA-256", enc.encode(serverSeed)));
}

export async function deckOrder(serverSeed: string, clientSeeds: readonly string[], hand: number): Promise<number[]> {
  const key = await crypto.subtle.importKey("raw", enc.encode(serverSeed), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const seeds = clientSeeds.map(cleanSeed).join(",");
  let block = new DataView(new ArrayBuffer(0)), at = 0, k = 0;
  const next = async () => {
    if (at + 4 > block.byteLength) { block = new DataView(await crypto.subtle.sign("HMAC", key, enc.encode(`${DECK_VERSION}|${hand}|${seeds}|${k++}`))); at = 0; }
    const u = block.getUint32(at); at += 4;
    return u;
  };
  const deck = Array.from({ length: 52 }, (_, i) => i);
  for (let i = 51; i >= 1; i--) {
    const n = i + 1, limit = 2 ** 32 - (2 ** 32 % n);
    let u = await next();
    while (u >= limit) u = await next();
    const j = u % n;
    [deck[i], deck[j]] = [deck[j]!, deck[i]!];
  }
  return deck;
}

/** Which deck position each card of a hand came from (deck.ts dealPlan): hole cards twice round from the seat after the button, then burn, flop, burn, turn, burn, river. */
export function dealPlan(players: number) {
  const b = 2 * players;
  return { hole: Array.from({ length: players }, (_, i) => [i, i + players] as [number, number]), burns: [b, b + 4, b + 6], flop: [b + 1, b + 2, b + 3], turn: b + 5, river: b + 7 };
}
