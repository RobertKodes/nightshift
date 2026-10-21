import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { type Address, type Hex } from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { beforeAll, describe, expect, it } from "vitest";
import type * as BetsModule from "./bets.js";
import type * as EscrowModule from "./escrow.js";
import type { fakeBetChain as FakeBetChain } from "./bets.fake.js";
import type { fakeChain as FakeChain } from "./escrow.fake.js";
import type { Lobby as LobbyT } from "./games-routes.js";
import type * as PokerModule from "./poker.js";
import type { HousePoker as HousePokerT } from "./housegame.js";
import type { Prizes as PrizesT } from "./prizes.js";
import { commitOf, dealPlan, deckOrder } from "./poker/deck.js";

let P: typeof PokerModule, E: typeof EscrowModule, B: typeof BetsModule, fakeChain: typeof FakeChain, fakeBetChain: typeof FakeBetChain, Lobby: typeof LobbyT, HousePoker: typeof HousePokerT, Prizes: typeof PrizesT;
beforeAll(async () => {
  process.env.DATA_DIR = mkdtempSync(join(tmpdir(), "poker-test-"));
  P = await import("./poker.js");
  E = await import("./escrow.js");
  B = await import("./bets.js");
  ({ fakeChain } = await import("./escrow.fake.js"));
  ({ fakeBetChain } = await import("./bets.fake.js"));
  ({ Lobby } = await import("./games-routes.js"));
  ({ HousePoker } = await import("./housegame.js"));
  ({ Prizes } = await import("./prizes.js"));
});

type View = ReturnType<PokerModule.PokerGames["get"]>;
type Strategy = (v: View) => { kind: "fold" | "check" | "call" | "raise"; to?: number } | null;
const W1 = "0x1111111111111111111111111111111111111111" as Address, W2 = "0x2222222222222222222222222222222222222222" as Address, W3 = "0x3333333333333333333333333333333333333333" as Address;
/** Shoves every hand: all-in when it may raise, else calls. */
const shove: Strategy = (v) => (v.legal!.raise ? { kind: "raise", to: v.legal!.raise.max } : v.legal!.check ? { kind: "check" } : { kind: "call" });
/** Checks or calls everything. */
const passive: Strategy = (v) => (v.legal!.check ? { kind: "check" } : { kind: "call" });

function rng(seed: number) { let s = seed >>> 0; return () => { s = (s + 0x6d2b79f5) >>> 0; let t = s; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4_294_967_296; }; }
/** A card room on its own clock, stepped 250 ms at a time as the server's tick is. */
function room(start = Date.UTC(2026, 9, 21, 12)) {
  let now = start;
  const games = new P.PokerGames(null, () => now, rng(7));
  const step = (ms: number) => { for (let t = 0; t < ms; t += 250) { now += 250; games.tick(); } };
  return { games, step, now: () => now, set: (t: number) => { now = t; } };
}
/**
 * Plays a match: every 250 ms each seat with a strategy sends its seed for the next hand and acts
 * when the hand waits on it. Stops when the match is over or after `limit` ms.
 */
function drive(r: ReturnType<typeof room>, id: string, seats: { player: string; play: Strategy | null; seed?: string }[], limit = 3_600_000, until?: (v: View) => boolean) {
  for (let t = 0; t < limit; t += 250) {
    r.step(250);
    for (const s of seats) {
      const v = r.games.get(id, s.player);
      if (v.done) return v;
      if (until?.(v)) return v;
      if (v.next && !v.next.seedSent && s.seed !== undefined) r.games.seed(id, s.player, v.next.n, `${s.seed}-${v.next.n}`);
      if (s.play && v.legal) { const a = s.play(v); if (a) r.games.act(id, s.player, a); }
    }
  }
  return r.games.get(id, seats[0]!.player);
}
/** Two players in a free queue match, both at the table. */
function duel(r: ReturnType<typeof room>, names = ["Pearl", "Onyx"], wallets: (string | null)[] = [W1, W2]) {
  const a = r.games.queue(names[0]!, wallets[0]!), offA = r.games.listen(a.match.id, a.player, () => {});
  const b = r.games.queue(names[1]!, wallets[1]!), offB = r.games.listen(b.match.id, b.player, () => {});
  expect(b.match.id).toBe(a.match.id);
  const seatOf = (p: string) => r.games.get(a.match.id, p).you!;
  return { id: a.match.id, a: a.player, b: b.player, offA, offB, seatOf };
}

describe("a heads-up match", () => {
  it("deals from a committed deck: own cards only, nothing hidden to a spectator, every hand rebuilt from its seeds once the match is over", () => {
    const r = room(), d = duel(r);
    const before = r.games.get(d.id, d.a);
    expect(before).toMatchObject({ status: "countdown", hand: null, blinds: [10, 20], startStack: 2_000 });
    const commit = before.next!.commit;
    expect(commit).toMatch(/^[0-9a-f]{64}$/);
    // both browsers send a seed for hand 1 before it is dealt; a second one is ignored
    r.games.seed(d.id, d.a, 1, "pearl-seed"); r.games.seed(d.id, d.b, 1, "onyx-seed");
    expect(r.games.seed(d.id, d.a, 1, "another")).toEqual({ hand: 1, seed: "pearl-seed" });
    expect(() => r.games.seed(d.id, d.a, 2, "early")).toThrow(/already dealt|not committed/);
    expect(() => r.games.seed(d.id, d.a, 1, "bad seed!")).toThrow(/1 to 64/);
    r.step(5_250);
    const v = r.games.get(d.id, d.a), w = r.games.watchView(d.id);
    expect(v.hand!.n).toBe(1);
    expect(v.hand!.commit).toBe(commit);
    const mine = v.hand!.seats.find((s) => s.seat === v.you)!, theirs = v.hand!.seats.find((s) => s.seat !== v.you)!;
    expect(mine.cards).toHaveLength(2);
    expect(theirs.cards).toBeNull();
    expect(w.hand!.seats.every((s) => s.cards === null)).toBe(true);
    expect(w.you).toBeNull(); expect(w.legal).toBeNull();
    // no server seed while the match is on
    expect(v.history).toHaveLength(0);
    const end = drive(r, d.id, [{ player: d.a, play: shove, seed: "pearl" }, { player: d.b, play: shove, seed: "onyx" }]);
    expect(end).toMatchObject({ done: true, reason: "busted" });
    const stacks = end.hand!.seats.map((s) => s.stack).sort((x, y) => x - y);
    expect(stacks).toEqual([0, 4_000]);
    expect(end.winnerIsYou).toBe(end.winner === end.you);
    // every hand: its commitment opens to the revealed seed, and the deck from the seeds deals exactly the cards played
    expect(end.history.length).toBeGreaterThan(0);
    for (const h of end.history) {
      expect(commitOf(h.serverSeed!)).toBe(h.commit);
      const deck = deckOrder(h.serverSeed!, h.clientSeeds, h.n), plan = dealPlan(2);
      const first = h.button === 0 ? 1 : 0; // the seat after the button gets the first card
      const dealt = (seat: number) => { const i = seat === first ? 0 : 1; return [deck[plan.hole[i]![0]], deck[plan.hole[i]![1]]]; };
      if (h.hole[end.you!]) expect(h.hole[end.you!]).toEqual(dealt(end.you!));
      expect(h.board).toEqual([...plan.flop, plan.turn, plan.river].slice(0, h.board.length).map((i) => deck[i]));
    }
    expect(end.history.at(-1)!.clientSeeds.sort()).toEqual(["onyx-seed", "pearl-seed"]);
    // a shown hand is shown to the rail too
    const shown = end.history.find((h) => h.showdown)!;
    expect(r.games.watchView(d.id).history.find((h) => h.n === shown.n)!.hole.every((c) => c !== null)).toBe(true);
  });

  it("moves the button every hand (the button posts the small blind), and raises the blinds every three minutes", () => {
    const r = room(), d = duel(r);
    const seen: { n: number; button: number; sbSeat: number; blinds: [number, number] }[] = [];
    drive(r, d.id, [{ player: d.a, play: passive }, { player: d.b, play: passive }], P.LEVEL_MS + 60_000, (v) => {
      const h = v.hand;
      if (h && !seen.some((s) => s.n === h.n)) seen.push({ n: h.n, button: h.button, sbSeat: h.sbSeat, blinds: [h.sb, h.bb] });
      return false;
    });
    expect(seen.length).toBeGreaterThan(10);
    for (let i = 1; i < seen.length; i++) expect(seen[i]!.button).toBe(1 - seen[i - 1]!.button);
    for (const s of seen) expect(s.sbSeat).toBe(s.button);
    expect(seen[0]!.blinds).toEqual([10, 20]);
    expect(seen.at(-1)!.blinds).toEqual([15, 30]);
    const v = r.games.get(d.id, d.a);
    expect(v.nextBlinds).toEqual([20, 40]);
  });

  it("runs a shot clock: 20 s, then the time bank, then a check when it is free or a fold", () => {
    const r = room(), d = duel(r);
    r.step(5_250);
    let v = r.games.get(d.id, d.a);
    const actor = v.hand!.toAct === v.you ? d.a : d.b, other = actor === d.a ? d.b : d.a;
    expect(r.games.get(d.id, actor).clock).toMatchObject({ actionMs: 20_000, deadline: r.now() + 20_000 + 45_000 - 250 });
    r.step(40_000);
    // still the same turn: the bank runs after the shot clock
    expect(r.games.get(d.id, actor).legal).not.toBeNull();
    r.step(25_250);
    v = r.games.get(d.id, actor);
    // the small blind faced the big blind: folded by the clock, its bank gone
    expect(v.history[0]!.log.at(-1)).toMatchObject({ kind: "fold" });
    expect(v.players[v.you!]!.bank).toBe(0);
    // the next hand: the other is on the button and limps; the first player, out of bank, checks by the clock after 20 s
    r.step(3_000);
    const o = r.games.get(d.id, other);
    if (o.legal) r.games.act(d.id, other, { kind: "call" });
    r.step(19_000);
    expect(r.games.get(d.id, actor).legal?.check).toBe(true);
    r.step(1_250);
    expect(r.games.get(d.id, actor).hand!.log.at(-1)).toMatchObject({ kind: "check" });
  });

  it("gives a free match's player 45 s in all away on their own turns, then the rival wins by abandonment", () => {
    const r = room(), d = duel(r);
    r.step(5_250);
    const v = r.games.get(d.id, d.a);
    const away = v.hand!.toAct === v.you ? d.offA : d.offB, stayer = away === d.offA ? d.b : d.a;
    away();
    r.step(30_000);
    expect(r.games.get(d.id, stayer).players.find((p) => !p.you)).toMatchObject({ connected: false });
    expect(r.games.get(d.id, stayer).players.find((p) => !p.you)!.awayUntil).toBeGreaterThan(r.now());
    r.step(16_000);
    expect(r.games.get(d.id, stayer)).toMatchObject({ done: true, reason: "abandonment", winnerIsYou: true });
  });

  it("rates a finished match like chess, and tells the profiles and the prizes who won", () => {
    const r = room(), d = duel(r);
    const told: PokerModule.PokerEvent[] = [];
    P.onPoker((e) => { if (e.id === d.id) told.push(e); });
    const end = drive(r, d.id, [{ player: d.a, play: shove }, { player: d.b, play: shove }]);
    expect(told).toHaveLength(1);
    const e = told[0]!;
    expect(e).toMatchObject({ staked: false, reason: "busted" });
    expect(e.rated).toBe(end.history.length >= 2);
    if (e.rated) {
      expect(e.players.map((p) => p.change).reduce((x, y) => x + y, 0)).toBe(0);
      expect(r.games.board().best.map((b) => b.name).sort()).toEqual(["Onyx", "Pearl"]);
    }
    expect(e.players.map((p) => p.key).sort()).toEqual([W1.toLowerCase(), W2.toLowerCase()]);
    expect(e.players.filter((p) => p.result === "win")).toHaveLength(1);
  });

  it("opens a table in the lounge, never against the same wallet, and folds two waiting tables into one", () => {
    const r = room();
    const a = r.games.queue("Pearl", W1); r.games.listen(a.match.id, a.player, () => {});
    expect(() => r.games.queue("Pearl again", W1)).toThrow(/your own game/);
    expect(r.games.lounge(W1)).toMatchObject({ waiting: 1, mine: [a.match.id] });
    expect(r.games.lounge().open[0]).toMatchObject({ id: a.match.id, host: { name: "Pearl", rating: 1200 } });
    expect(() => r.games.join(a.match.id, "Me", W1)).toThrow(/your own game/);
    const b = r.games.join(a.match.id, "Onyx", W2);
    expect(b.match.id).toBe(a.match.id);
    expect(r.games.lounge().open).toHaveLength(0);
    expect(() => r.games.join(a.match.id, "Late", W3)).toThrow(/Someone else/);
  });
});

describe("Frog #7 and the house", () => {
  it("practice: the frog plays its own seat, is never rated, never listed, never watched", () => {
    const r = room();
    const told: string[] = [];
    P.onPoker((e) => told.push(e.id));
    const p = r.games.practice("Pearl", W1);
    r.games.listen(p.match.id, p.player, () => {});
    expect(p.match.players.map((x) => x.name)).toContain(P.FROG);
    expect(p.match.players.find((x) => x.bot)).toMatchObject({ connected: true });
    expect(r.games.lounge().open).toHaveLength(0);
    expect(r.games.live()).toHaveLength(0);
    expect(() => r.games.watchView(p.match.id)).toThrow(/private/);
    expect(() => r.games.betInfo(p.match.id)).toThrow(/No betting/);
    // the frog acts on its turns within a few seconds
    const frogActs = drive(r, p.match.id, [{ player: p.player, play: passive }], 120_000, (v) => (v.hand?.log ?? []).some((l) => l.seat !== v.you && !["sb", "bb"].includes(l.kind)));
    expect(frogActs.done || (frogActs.hand?.log ?? []).some((l) => l.seat !== frogActs.you)).toBe(true);
    const end = drive(r, p.match.id, [{ player: p.player, play: shove }]);
    expect(end.done).toBe(true);
    expect(r.games.board().best).toHaveLength(0);
    expect(told).not.toContain(p.match.id);
    expect(() => r.games.rematch(p.match.id, p.player)).toThrow(/practice/);
  });

  it("the house exhibition: two frogs to the end, watchable as HOUSE, never rated, staked or bet on, out of the way when the room is busy", () => {
    const r = room(), load = { real: 0 };
    const house = new HousePoker({ games: r.games, now: r.now, realGames: () => load.real, maxReal: () => 3 });
    const told: string[] = [];
    P.onPoker((e) => told.push(e.id));
    house.step();
    const id = house.current!;
    expect(r.games.isHouse(id)).toBe(true);
    expect(r.games.live().find((m) => m.id === id)).toMatchObject({ house: true, currency: "FREE", stake: null });
    expect(() => r.games.betInfo(id)).toThrow(/No betting/);
    expect(r.games.lounge().open).toHaveLength(0);
    expect(r.games.watchView(id).players.every((p) => p.bot)).toBe(true);
    for (let i = 0; i < 4 * 3_600 && !r.games.watchView(id).done; i++) { r.step(1_000); house.step(); }
    const end = r.games.watchView(id);
    expect(end).toMatchObject({ done: true, reason: "busted" });
    expect(told).not.toContain(id);
    expect(r.games.board().best).toHaveLength(0);
    // the next one a minute later; past the limit of real games it stops at once
    r.step(61_000); house.step();
    const next = house.current!;
    expect(next).not.toBe(id);
    load.real = 4; house.step();
    expect(r.games.watchView(next)).toMatchObject({ done: true, reason: "paused", winner: null });
    expect(house.current).toBeNull();
  });
});

async function pokerDuel(o: { stake?: string; relay?: boolean } = {}) {
  let now = Date.UTC(2026, 9, 21, 12);
  const signer = privateKeyToAccount(generatePrivateKey());
  const f = fakeChain({ signer: signer.address });
  const escrow = new E.Escrow({ file: join(mkdtempSync(join(tmpdir(), "escrow-")), "escrow.json"), client: f.client, signer, relay: f.relay, now: () => now });
  const games = new P.PokerGames(null, () => now, rng(3));
  const lobby = new Lobby(escrow, { pinball: () => { throw new Error("no pinball"); }, chess: () => { throw new Error("no chess"); }, pool: () => { throw new Error("no pool"); }, poker: (x) => games.createStaked(x) });
  const c = await escrow.create(W1, { game: "poker", token: "IMD", amount: o.stake ?? "5", name: "Pearl" }), id = c.matchId as Hex;
  expect(c.game).toBe(E.GAMES.poker);
  f.open(id, E.TOKENS.IMD, BigInt(Number(o.stake ?? "5")) * 10n ** 18n, E.GAMES.poker, W1, Math.floor(now / 1000));
  await escrow.sync();
  escrow.intend(id, W2, "Onyx");
  f.join(id, W2, Math.floor(now / 1000));
  await escrow.sync();
  const sa = lobby.seat(id, W1) as { game: string; id: string; player: string }, sb = lobby.seat(id, W2) as typeof sa;
  const r = { games, step: (ms: number) => { for (let t = 0; t < ms; t += 250) { now += 250; games.tick(); } }, now: () => now, set: (t: number) => { now = t; } };
  return { f, escrow, lobby, games, id, sa, sb, r, signer };
}
const settle = () => new Promise((res) => setTimeout(res, 10));

describe("staked NIGHT POKER", () => {
  it("deals a match for exactly the two wallets, starts only once both are at the table, and the escrow signs and relays the winner", async () => {
    const d = await pokerDuel();
    expect(d.sa.game).toBe("poker"); expect(d.sb.id).toBe(d.sa.id);
    expect(() => d.lobby.seat(d.id, W3)).toThrow(/No such match/);
    const offA = d.games.listen(d.sa.id, d.sa.player, () => {});
    d.r.step(60_000);
    expect(d.games.get(d.sa.id, d.sa.player)).toMatchObject({ status: "waiting", startedAt: null, escrow: d.id, currency: "IMD", stake: "5", showBy: expect.any(Number) });
    expect(() => d.games.leave(d.sa.id, d.sa.player)).toThrow(/staked/);
    const offB = d.games.listen(d.sb.id, d.sb.player, () => {});
    expect(d.games.get(d.sa.id, d.sa.player).status).toBe("countdown");
    d.r.step(9_000);
    expect(d.games.get(d.sa.id, d.sa.player).hand).toBeNull();
    const end = drive(d.r as never, d.sa.id, [{ player: d.sa.player, play: shove }, { player: d.sb.player, play: shove }]);
    expect(end).toMatchObject({ done: true, reason: "busted" });
    await settle();
    const ch = d.escrow.challenges.get(d.id)!, winner = end.winnerIsYou ? W1 : W2;
    expect(ch.outcome).toMatchObject({ draw: false, winner: winner.toLowerCase() });
    expect(d.f.s.relayed).toHaveLength(1);
    expect(d.f.s.relayed[0]).toMatchObject({ matchId: d.id, winner, draw: false });
    expect(() => d.games.rematch(d.sa.id, d.sa.player)).toThrow(/no rematch/);
    offA(); offB();
  });

  it("is void when both are not at the table within 15 minutes: both stakes back", async () => {
    const d = await pokerDuel();
    const off = d.games.listen(d.sa.id, d.sa.player, () => {});
    d.r.step(15 * 60_000 + 500);
    expect(d.games.get(d.sa.id, d.sa.player)).toMatchObject({ done: true, reason: "void", winner: null });
    await settle();
    expect(d.escrow.challenges.get(d.id)!.result).toMatchObject({ draw: true });
    expect(d.f.s.relayed[0]).toMatchObject({ draw: true });
    off();
  });

  it("is void when the player away from the first hand never acted, after 2 minutes of reconnection time", async () => {
    const d = await pokerDuel();
    const offA = d.games.listen(d.sa.id, d.sa.player, () => {}), offB = d.games.listen(d.sb.id, d.sb.player, () => {});
    d.r.step(10_250);
    const v = d.games.get(d.sa.id, d.sa.player);
    const actorIsA = v.hand!.toAct === v.you;
    (actorIsA ? offA : offB)();
    // the free match's 45 s are no limit here; the clock folds them and the other plays on
    drive(d.r as never, d.sa.id, [{ player: actorIsA ? d.sb.player : d.sa.player, play: passive }], 3 * 60_000);
    const end = d.games.get(d.sa.id, d.sa.player);
    expect(end).toMatchObject({ done: true, reason: "void", winner: null });
    await settle();
    expect(d.escrow.challenges.get(d.id)!.outcome).toMatchObject({ draw: true, winner: null });
    (actorIsA ? offB : offA)();
  });

  it("counts the 2 minutes in all across turns; past them a player who acted loses by abandonment", async () => {
    const d = await pokerDuel();
    let offA = d.games.listen(d.sa.id, d.sa.player, () => {});
    const offB = d.games.listen(d.sb.id, d.sb.player, () => {});
    // a few hands with both acting
    drive(d.r as never, d.sa.id, [{ player: d.sa.player, play: passive }, { player: d.sb.player, play: passive }], 60_000);
    // A leaves when it is A's turn, 70 s, back; then again, 51 s more: 121 s in all
    const away = (ms: number) => {
      drive(d.r as never, d.sa.id, [{ player: d.sb.player, play: passive }], 60_000, (v) => v.hand?.toAct === v.players.findIndex((p) => !p.you));
      offA();
      for (let t = 0; t < ms; t += 250) { d.r.step(250); const v = d.games.get(d.sb.id, d.sb.player); if (v.done) break; if (v.legal) d.games.act(d.sb.id, d.sb.player, passive(v)!); }
    };
    away(15_000);
    const seen = d.games.get(d.sb.id, d.sb.player).players.find((p) => !p.you)!;
    expect(seen.connected).toBe(false);
    expect(seen.grace).toBeLessThan(2 * 60_000);
    offA = d.games.listen(d.sa.id, d.sa.player, () => {});
    expect(d.games.get(d.sa.id, d.sa.player).done).toBe(false);
    for (let i = 0; i < 10 && !d.games.get(d.sa.id, d.sa.player).done; i++) { away(20_000); if (!d.games.get(d.sa.id, d.sa.player).done) offA = d.games.listen(d.sa.id, d.sa.player, () => {}); }
    const end = d.games.get(d.sb.id, d.sb.player);
    expect(end).toMatchObject({ done: true, reason: "abandonment", winnerIsYou: true });
    await settle();
    expect(d.escrow.challenges.get(d.id)!.outcome).toMatchObject({ draw: false, winner: W2.toLowerCase() });
    offB();
  });

  it("is void when the player who lost every chip never chose an action (only the clock played for them)", async () => {
    const d = await pokerDuel();
    const offA = d.games.listen(d.sa.id, d.sa.player, () => {}), offB = d.games.listen(d.sb.id, d.sb.player, () => {});
    // A sits at the table and never acts; B shoves every hand
    const end = drive(d.r as never, d.sa.id, [{ player: d.sa.player, play: null }, { player: d.sb.player, play: shove }], 6 * 3_600_000);
    expect(end).toMatchObject({ done: true, reason: "void", winner: null });
    await settle();
    expect(d.escrow.challenges.get(d.id)!.outcome).toMatchObject({ draw: true });
    offA(); offB();
  }, 60_000);
});

describe("betting on staked NIGHT POKER", () => {
  const POOL = "0x00000000000000000000000000000000b37b0011" as Address;
  function bets(games: PokerModule.PokerGames, now: () => number) {
    const signer = privateKeyToAccount(generatePrivateKey());
    const f = fakeBetChain({ pool: POOL, signer: signer.address });
    const lookup: BetsModule.Lookup = (game, id) => (game === "poker" ? B.fromPoker(id, games.betInfo(id), now()) : null);
    const pool = new B.Bets({ address: POOL, file: null, client: f.client, signer, lookup, watch: (board, id, cb) => (board === "poker" ? games.watch(id, cb) : null), relaySettle: f.relaySettle, relayCreate: f.relayCreate, now, fromBlock: 30_000_000n });
    return { pool, f };
  }
  it("opens a binary market (A or B wins the match) on a staked heads-up match, never for its players, and decides it from the result", async () => {
    const d = await pokerDuel({ stake: "500" });
    const { pool } = bets(d.games, d.r.now);
    d.games.listen(d.sa.id, d.sa.player, () => {}); d.games.listen(d.sb.id, d.sb.player, () => {});
    // before the first deal: locked
    await expect(pool.ticket(W3, { game: "poker", matchId: d.sa.id, side: "A", token: "IMD", amount: "1" })).rejects.toMatchObject({ status: 409, message: /Waiting for the first hand/ });
    // a hand on, nobody all-in: a ticket for the rail, signed into the poker market
    drive(d.r as never, d.sa.id, [{ player: d.sa.player, play: null }], 20_000, (v) => !!v.hand && v.hand.street === "preflop");
    const t = await pool.ticket(W3, { game: "poker", matchId: d.sa.id, side: "B", token: "IMD", amount: "1" });
    expect(t.ticket.marketId).toBe(B.marketIdOf("poker", d.sa.id, "IMD"));
    expect(t.market.game).toBe(B.BOARDS.poker);
    expect(t.weightBps).toBeGreaterThan(9_000);
    for (const w of [W1, W2]) await expect(pool.ticket(w, { game: "poker", matchId: d.sa.id, side: "A", token: "IMD", amount: "1" })).rejects.toMatchObject({ status: 403 });
    // what betting reads has no card in it
    expect(Object.keys(d.games.betInfo(d.sa.id)).sort()).toEqual(["allIn", "bb", "chips", "connected", "currency", "done", "draw", "escrow", "hands", "level", "names", "reason", "showing", "stake", "status", "swingAt", "total", "wallets", "winner"]);
    // an all-in on the table locks it
    const v = d.games.get(d.sa.id, d.sa.player), actor = v.hand!.toAct === v.you ? d.sa.player : d.sb.player;
    d.games.act(d.sa.id, actor, { kind: "raise", to: d.games.get(d.sa.id, actor).legal!.raise!.max });
    await expect(pool.ticket(W3, { game: "poker", matchId: d.sa.id, side: "A", token: "IMD", amount: "1" })).rejects.toMatchObject({ status: 409, message: /all-in|being shown/ });
    const end = drive(d.r as never, d.sa.id, [{ player: d.sa.player, play: shove }, { player: d.sb.player, play: shove }]);
    for (let i = 0; i < 5; i++) await settle();
    const m = pool.markets.get(B.marketIdOf("poker", d.sa.id, "IMD"))!;
    // side A is the first seat, the creator's
    const aSeat = d.games.get(d.sa.id, d.sa.player).you!;
    expect(m.outcome?.outcome).toBe(end.winner === aSeat ? (aSeat === 0 ? 0 : 1) : aSeat === 0 ? 1 : 0);
  });
  it("gives a free match no market", async () => {
    const r = room(), d = duel(r);
    const { pool } = bets(r.games, r.now);
    r.step(6_000);
    await expect(pool.ticket(W3, { game: "poker", matchId: d.id, side: "A", token: "IMD", amount: "1" })).rejects.toMatchObject({ status: 409, message: B.NOT_ELIGIBLE });
  });
});

describe("weekly prizes for NIGHT POKER", () => {
  it("ranks the most rated match wins, at most 3 against one rival, wallets only", () => {
    let now = Date.UTC(2026, 9, 21, 12);
    const p = new Prizes(null, { now: () => now, hours: () => [24, 12, 6] });
    const a = { wallet: W1, name: "Pearl" }, b = { wallet: W2, name: "Onyx" }, c = { wallet: W3, name: "Jade" };
    for (let i = 0; i < 5; i++) { p.duel("poker", a, b, "a", true); now += 1_000; }
    p.duel("poker", c, b, "a", true); now += 1_000;
    p.duel("poker", c, a, "a", true); now += 1_000;
    expect(p.duel("poker", c, a, "a", false)).toBe(false); // unrated: never counted
    expect(p.duel("poker", { wallet: null, name: "Guest" }, a, "a", true)).toBe(false);
    expect(p.duel("poker", a, a, "a", true)).toBe(false);
    const board = p.standings("poker");
    expect(board.map((r) => [r.name, r.wins])).toEqual([["Pearl", 3], ["Jade", 2]]);
    expect(p.view().games.poker.map((r) => r.name)).toEqual(["Pearl", "Jade"]);
    expect(p.view().rules[0]).toMatch(/NIGHT POKER/);
  });
});

describe("Frog #7's play", () => {
  it("rates hole cards by Chen's formula, and weighs its equity against random hands", async () => {
    const { chen, equity } = await import("./poker/bot.js");
    const { parseCards } = await import("./poker/cards.js");
    const two = (s: string) => parseCards(s) as [number, number];
    expect(chen(two("As Ad"))).toBe(20);
    expect(chen(two("As Ks"))).toBe(12);
    expect(chen(two("Ks Kd"))).toBe(16);
    expect(chen(two("7c 2d"))).toBe(-1);
    expect(chen(two("5h 4h"))).toBe(6);
    const r = rng(5);
    expect(equity(two("As Ad"), [], 1, r, 2_000)).toBeGreaterThan(0.8);
    expect(equity(two("7c 2d"), [], 1, r, 2_000)).toBeLessThan(0.4);
    // the nuts on the river win (or split) every run
    expect(equity(two("Ah Kh"), parseCards("Qh Jh Th 2c 3d"), 1, r, 300)).toBe(1);
  });
  it("raises its best hands, folds its worst to a big raise, value-bets the nuts and gives up air facing a bet", async () => {
    const { botAction } = await import("./poker/bot.js");
    const { parseCards } = await import("./poker/cards.js");
    const two = (s: string) => parseCards(s) as [number, number];
    const quiet = () => 0.99; // no bluff, no float
    const base = { street: "preflop" as const, board: [], pot: 30, bet: 10, stack: 1_990, currentBet: 20, bb: 20, opponents: 1, legal: { fold: true, check: false, call: 10, raise: { min: 40, max: 2_000 }, allIn: 2_000 } };
    expect(botAction({ ...base, hole: two("As Ad") }, quiet).kind).toBe("raise");
    const facing = { ...base, pot: 420, bet: 20, stack: 1_980, currentBet: 400, legal: { fold: true, check: false, call: 380, raise: { min: 780, max: 2_000 }, allIn: 2_000 } };
    expect(botAction({ ...facing, hole: two("7c 2d") }, quiet).kind).toBe("fold");
    const river = { street: "river" as const, board: parseCards("Qh Jh Th 2c 3d"), pot: 400, bet: 0, stack: 1_800, currentBet: 0, bb: 20, opponents: 1, legal: { fold: true, check: true, call: 0, raise: { min: 20, max: 1_800 }, allIn: 1_800 } };
    const nuts = botAction({ ...river, hole: two("Ah Kh") }, () => 0.5);
    expect(nuts.kind).toBe("raise");
    // a bet sized like a person's: a whole number of small blinds
    expect((nuts.to ?? 0) % 10).toBe(0);
    const facingRiver = { ...river, pot: 800, currentBet: 400, legal: { fold: true, check: false, call: 400, raise: { min: 800, max: 1_800 }, allIn: 1_800 } };
    expect(botAction({ ...facingRiver, hole: two("4c 5d") }, quiet).kind).toBe("fold");
  });
});
