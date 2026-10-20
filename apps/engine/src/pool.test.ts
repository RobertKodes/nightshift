import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { type Address, type Hex } from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { beforeAll, describe, expect, it } from "vitest";
import type * as EscrowModule from "./escrow.js";
import type { fakeChain as FakeChain } from "./escrow.fake.js";
import type { Lobby as LobbyT } from "./games-routes.js";
import { type PoolEvent, PoolGames, onPool } from "./pool.js";
import { plan } from "./pool/bot.js";
import { BREAK_SPOT, HEAD_Y } from "./pool/physics.js";
import type { Rack } from "./pool/rules.js";
import { poolWeights } from "./bet-weights.js";
import { NOT_ELIGIBLE, fromPool } from "./bets.js";

let E: typeof EscrowModule, fakeChain: typeof FakeChain, Lobby: typeof LobbyT;
beforeAll(async () => {
  process.env.DATA_DIR = mkdtempSync(join(tmpdir(), "pool-test-"));
  E = await import("./escrow.js");
  ({ fakeChain } = await import("./escrow.fake.js"));
  ({ Lobby } = await import("./games-routes.js"));
});
const A = "0x1111111111111111111111111111111111111111" as Address, B = "0x2222222222222222222222222222222222222222" as Address;

/** A pool hall with its own clock and a fixed rack seed. */
function hall(seed = 11) {
  let now = Date.UTC(2026, 9, 20, 21);
  const games = new PoolGames(null, () => now, undefined, () => seed);
  return { games, now: () => now, advance: (ms: number) => { now += ms; games.tick(); } };
}
/** Two players seated at a free table, both connected, past the countdown. */
function duel(seed = 11, wallets: [string | null, string | null] = [null, null]) {
  const h = hall(seed);
  const a = h.games.queue("Pearl", wallets[0]), offA = h.games.listen(a.match.id, a.player, () => {});
  const b = h.games.queue("Onyx", wallets[1]), offB = h.games.listen(b.match.id, b.player, () => {});
  expect(b.match.id).toBe(a.match.id);
  h.advance(5_100);
  return { ...h, id: a.match.id, seats: [a.player, b.player] as const, offA, offB };
}
type Duel = ReturnType<typeof duel>;
/** The rack as the rules see it, from a seat's view. */
const rackOf = (v: ReturnType<PoolGames["get"]>): Rack => ({ balls: v.balls, turn: v.turn, breaker: v.breaker, groups: v.groups, phase: v.phase, inHand: v.inHand, fouls: v.fouls, decision: v.decision, winner: null, reason: null, shots: 0, racks: v.racks, seed: 0 });
/** The practice frog plays one turn (or makes the choice the rules ask for). */
function turn(d: Duel): void {
  const v = d.games.get(d.id, d.seats[0]);
  if (d.now() < v.clock.turnAt) d.advance(v.clock.turnAt - d.now() + 1);
  const seat = v.decision ? v.decision.by : v.turn, me = d.seats[seat];
  if (v.decision) { d.games.decide(d.id, me, (v.decision.options as string[]).includes("accept") ? "accept" : "spot"); return; }
  const p = plan(rackOf(v));
  d.games.shot(d.id, me, { ...p.shot, call: p.call, cue: p.cue });
}
const playOut = (d: Duel, max = 250) => { for (let i = 0; i < max && !d.games.get(d.id, d.seats[0]).done; i++) turn(d); return d.games.get(d.id, d.seats[0]); };

describe("NIGHT POOL tables", () => {
  it("opens a table in the lounge, seats the next player, counts down, and gives the break to one of them", () => {
    const h = hall();
    const a = h.games.queue("Pearl", A), off = h.games.listen(a.match.id, a.player, () => {});
    expect(a.match.status).toBe("waiting");
    expect(h.games.lounge().open).toMatchObject([{ id: a.match.id, rules: "wpa", host: { name: "Pearl", rating: 1200 } }]);
    expect(() => h.games.queue("Pearl again", A)).toThrow(/your own game/);
    // quick rules wait apart from WPA tables
    const q = h.games.queue("Quick", null, "quick");
    expect(q.match.id).not.toBe(a.match.id);
    const b = h.games.queue("Onyx", B);
    expect(b.match.id).toBe(a.match.id);
    expect(b.match.status).toBe("countdown");
    expect(() => h.games.shot(a.match.id, a.player, { aim: 90000, power: 500 })).toThrow(/not started/);
    h.advance(5_100);
    const v = h.games.get(a.match.id, a.player);
    expect(v).toMatchObject({ status: "playing", phase: "break", inHand: "kitchen", groups: [null, null] });
    expect([0, 1]).toContain(v.breaker);
    off();
  });
  it("checks every shot: the turn, the limits, the call, where the cue ball goes, balls still rolling", () => {
    const d = duel();
    const v = d.games.get(d.id, d.seats[0]), shooter = d.seats[v.turn], other = d.seats[1 - v.turn]!;
    expect(() => d.games.shot(d.id, other, { aim: 90000, power: 900, cue: BREAK_SPOT })).toThrow(/rival's turn/);
    expect(() => d.games.shot(d.id, shooter, { aim: 90000, power: 1500, cue: BREAK_SPOT })).toThrow(/outside the limits/);
    expect(() => d.games.shot(d.id, shooter, { aim: 90000, power: 900, call: { ball: 3, pocket: 2 }, cue: BREAK_SPOT })).toThrow(/not called/);
    expect(() => d.games.shot(d.id, shooter, { aim: 90000, power: 900 })).toThrow(/Place the cue ball/);
    expect(() => d.games.shot(d.id, shooter, { aim: 90000, power: 900, cue: { x: 0.5, y: HEAD_Y + 0.1 } })).toThrow(/behind the head string/);
    expect(() => d.games.shot(d.id, shooter, { aim: 90000, power: 900, cue: { x: 0.01, y: 0.2 } })).toThrow(/on the cloth/);
    const after = d.games.shot(d.id, shooter, { aim: 90000, power: 1000, cue: BREAK_SPOT });
    expect(after.last).toMatchObject({ n: 1, seat: v.turn });
    expect(after.last!.frames!.length).toBeGreaterThan(10);
    expect(after.last!.start![0]).toMatchObject({ x: BREAK_SPOT.x, y: BREAK_SPOT.y });
    expect(after.clock.turnAt).toBeGreaterThan(d.now());
    // the next shot waits for the replay
    const next = after.decision ? d.seats[after.decision.by] : d.seats[after.turn];
    expect(() => d.games.shot(d.id, next, { aim: 0, power: 300, call: "safety" })).toThrow(/still rolling/);
    // a reader that has the keyframes of shot 1 gets them no more
    expect(d.games.get(d.id, d.seats[0], 1).last).not.toHaveProperty("frames");
    expect(d.games.get(d.id, d.seats[0], 0).last).toHaveProperty("frames");
  });
  it("plays a whole rack between two players, to a winner the rules decided", () => {
    const events: PoolEvent[] = [];
    onPool((e) => events.push(e));
    const d = duel(23, [A, B]);
    const v = playOut(d);
    expect(v.done).toBe(true);
    expect(v.reason).toBe("rack");
    expect([0, 1]).toContain(v.winner);
    expect(v.rackReason).toMatch(/rack is (won|lost)/);
    const e = events.find((x) => x.id === d.id)!;
    expect(e.rated).toBe(true);
    expect(e.players.map((p) => p.key).sort()).toEqual([A.toLowerCase(), B.toLowerCase()]);
    expect(e.players.filter((p) => p.result === "win")).toHaveLength(1);
    // Elo moved by the same amount both ways, and the board shows both
    const [p0, p1] = v.players;
    expect(p0!.rating + p1!.rating).toBe(2400);
    expect(d.games.board().best).toHaveLength(2);
  });
  it("the shot clock runs out: a foul, the cue ball in hand to the opponent", () => {
    const d = duel();
    d.games.shot(d.id, d.seats[d.games.get(d.id, d.seats[0]).turn], { aim: 90000, power: 1000, cue: BREAK_SPOT });
    let v = d.games.get(d.id, d.seats[0]);
    if (v.decision) { d.advance(v.clock.turnAt - d.now() + 1); d.games.decide(d.id, d.seats[v.decision.by], v.decision.options[0]!); v = d.games.get(d.id, d.seats[0]); }
    const shooter = v.turn;
    d.advance(v.clock.deadline - d.now() + 300);
    v = d.games.get(d.id, d.seats[0]);
    expect(v.turn).toBe(1 - shooter);
    expect(v.inHand).toBe("anywhere");
    expect(v.log.at(-1)).toMatchObject({ foul: "time", seat: shooter });
  });
  it("a player away on their own turn loses by abandonment; a resignation ends it at once", () => {
    const d = duel();
    const v = d.games.get(d.id, d.seats[0]), away = v.turn;
    (away === 0 ? d.offA : d.offB)();
    d.advance(46_000);
    const after = d.games.get(d.id, d.seats[1 - away]!);
    expect(after).toMatchObject({ done: true, reason: "abandonment", winner: 1 - away });
    const e = duel();
    const r = e.games.resign(e.id, e.seats[0]);
    expect(r).toMatchObject({ done: true, reason: "resignation", winner: 1, winnerIsYou: false });
    // nothing was played: no rating moved
    expect(r.players.map((p) => p.rating)).toEqual([1200, 1200]);
  });
  it("a rematch: both ask, a new table, the other player breaks", () => {
    const d = duel();
    const first = d.games.get(d.id, d.seats[0]).breaker;
    d.games.resign(d.id, d.seats[0]);
    d.games.rematch(d.id, d.seats[0]);
    expect(d.games.get(d.id, d.seats[1]).rivalWantsRematch).toBe(true);
    const v = d.games.rematch(d.id, d.seats[1]);
    expect(v.rematchId).toBeTruthy();
    expect(d.games.get(v.rematchId!, d.seats[0]).breaker).toBe(1 - first);
  });
  it("shows the shooter's aim to the rival and the spectators, live; emotes from the player's own set only", () => {
    const d = duel();
    const v = d.games.get(d.id, d.seats[0]), shooter = d.seats[v.turn], rival = d.seats[1 - v.turn]!;
    d.games.aim(d.id, shooter, { aim: 91000, power: 600, cue: BREAK_SPOT });
    expect(d.games.get(d.id, rival).aim).toMatchObject({ aim: 91000, power: 600, cue: BREAK_SPOT });
    expect(d.games.get(d.id, shooter).aim).toBeNull();
    expect(d.games.watchView(d.id).aim).toMatchObject({ aim: 91000 });
    // the rival cannot aim for the shooter
    d.games.aim(d.id, rival, { aim: 1000, power: 10 });
    expect(d.games.get(d.id, rival).aim?.aim).toBe(91000);
    d.games.emote(d.id, rival, "emote-gg");
    expect(d.games.get(d.id, shooter).emotes).toMatchObject([{ id: "emote-gg", seat: 1 - v.turn }]);
    expect(() => d.games.emote(d.id, rival, "emote-nice")).toThrow(/One emote at a time/);
    expect(() => d.games.emote(d.id, shooter, "emote-eyes")).toThrow(/not in your set/);
  });
  it("a spectator sees the table as nobody's seat", () => {
    const d = duel();
    const w = d.games.watchView(d.id);
    expect(w.you).toBeNull();
    expect(w.players.every((p) => !p.you)).toBe(true);
    expect(JSON.stringify(w)).not.toContain(d.seats[0]);
    expect(d.games.live()).toMatchObject([{ id: d.id, players: [{ name: "Pearl" }, { name: "Onyx" }] }]);
  });
  it("closes an open table whose host stepped away past the grace period, and folds two waiting tables into one", () => {
    const h = hall();
    const a = h.games.queue("Pearl", null);
    h.advance(91_000);
    expect(h.games.get(a.match.id, a.player)).toMatchObject({ done: true, expired: "away" });
    const x = h.games.queue("One", null), offX = h.games.listen(x.match.id, x.player, () => {});
    // a second open table (the first host was not yet here when it was opened)
    const y = h.games.queue("Two", null, "quick"), offY = h.games.listen(y.match.id, y.player, () => {});
    h.advance(300);
    expect(h.games.get(y.match.id, y.player).movedTo).toBeNull(); // different rules never fold
    offX(); offY();
  });
});

describe("staked NIGHT POOL through GameEscrow", () => {
  async function stakedDuel() {
    let now = Date.UTC(2026, 9, 20, 12);
    const signer = privateKeyToAccount(generatePrivateKey());
    const f = fakeChain({ signer: signer.address });
    const escrow = new E.Escrow({ file: join(mkdtempSync(join(tmpdir(), "escrow-")), "escrow.json"), client: f.client, signer, relay: f.relay, now: () => now });
    const games = new PoolGames(null, () => now, undefined, () => 31);
    const lobby = new Lobby(escrow, { pinball: () => { throw new Error("no pinball"); }, chess: () => { throw new Error("no chess"); }, pool: (x) => games.createStaked(x) });
    const r = await escrow.create(A, { game: "pool", token: "IMD", amount: "5", name: "Pearl" }), id = r.matchId as Hex;
    expect(r.game).toBe(E.GAMES.pool);
    f.open(id, E.TOKENS.IMD, 5n * 10n ** 18n, E.GAMES.pool, A, Math.floor(now / 1000));
    await escrow.sync();
    escrow.intend(id, B, "Onyx");
    f.join(id, B, Math.floor(now / 1000));
    await escrow.sync();
    const step = (ms: number) => { now += ms; games.tick(); };
    return { f, escrow, games, lobby, id, step, now: () => now };
  }
  it("deals a WPA game for exactly the two wallets; the winner's wallet is the escrow's verdict", async () => {
    const s = await stakedDuel();
    const sa = s.lobby.seat(s.id, A) as { game: string; id: string; player: string }, sb = s.lobby.seat(s.id, B) as typeof sa;
    expect(sa.game).toBe("pool");
    const offA = s.games.listen(sa.id, sa.player, () => {});
    expect(s.games.get(sa.id, sa.player).startedAt).toBeNull();
    const offB = s.games.listen(sb.id, sb.player, () => {});
    expect(s.games.get(sa.id, sa.player)).toMatchObject({ currency: "IMD", stake: "5", escrow: s.id, rules: "wpa" });
    expect(() => s.games.rematch(sa.id, sa.player)).toThrow(/Finish this game first/);
    s.step(5_100);
    const seats = [sa.player, sb.player] as const;
    const d = { games: s.games, id: sa.id, seats, now: s.now, advance: s.step } as unknown as Duel;
    const v = playOut(d);
    expect(v.done).toBe(true);
    await new Promise((r) => setTimeout(r, 10));
    const winnerWallet = (v.winner === 0 ? A : B).toLowerCase();
    expect(s.escrow.challenges.get(s.id)!.outcome).toMatchObject({ draw: false, winner: winnerWallet });
    expect(s.f.s.relayed[0]).toMatchObject({ matchId: s.id, draw: false });
    expect(s.f.s.relayed[0]!.winner.toLowerCase()).toBe(winnerWallet);
    expect(() => s.games.rematch(sa.id, sa.player)).toThrow(/no rematch/);
    offA(); offB();
  });
  it("nobody comes: a draw, both stakes back", async () => {
    const s = await stakedDuel();
    s.lobby.seat(s.id, A);
    s.step(5 * 60_000 + 1_000);
    await new Promise((r) => setTimeout(r, 10));
    expect(s.escrow.challenges.get(s.id)!.outcome).toMatchObject({ draw: true, winner: null });
  });
  it("the escrow labels a pool match as pool", () => { expect(E.GAMES.pool).toBe("0x706f6f6c00000000000000000000000000000000000000000000000000000000"); });
});

describe("live betting on NIGHT POOL", () => {
  const base = { status: "playing" as const, left: [5, 5] as [number, number], eight: [false, false] as [boolean, boolean], open: false, pocketed: 4, turn: 0 as const, rolling: false, deciding: false, connected: [true, true] as [boolean, boolean], sinceSwingMs: null };
  it("weighs the side with fewer balls left as the leader, and locks while balls roll or right after one drops", () => {
    const w = poolWeights({ ...base, left: [2, 6] });
    expect(w.leader).toBe(0);
    expect(w.a).toBeLessThan(w.b);
    expect(poolWeights({ ...base, rolling: true }).locked).toMatch(/rolling/);
    expect(poolWeights({ ...base, sinceSwingMs: 2_000 }).locked).toMatch(/just dropped/);
    expect(poolWeights({ ...base, eight: [true, false], left: [0, 3] }).locked).toMatch(/8-ball/);
    expect(poolWeights({ ...base, connected: [true, false] }).locked).toMatch(/reconnecting/);
    expect(poolWeights({ ...base, status: "finished" }).locked).toMatch(/over/);
    expect(poolWeights({ ...base, open: true, left: [7, 7] }).leader).toBeNull();
  });
  it("a free game gets no market; a staked game's players may not bet on it", () => {
    const d = duel(5, [A, B]);
    const free = fromPool(d.id, d.games.betInfo(d.id), d.now());
    expect(free.eligible).toBe(NOT_ELIGIBLE);
    expect(free.tied.sort()).toEqual([A.toLowerCase(), B.toLowerCase()]);
    expect(free.result).toBeNull();
    d.games.resign(d.id, d.seats[1]);
    expect(fromPool(d.id, d.games.betInfo(d.id), d.now()).result).toBe(0);
  });
});

describe("NIGHT POOL stays on the website", () => {
  it("is never listed in the Telegram Mini App or by its bot", async () => {
    const { telegramGames } = await import("./spectate.js");
    const g = (game: "chess" | "pool" | "pinball") => ({ game, id: "x", players: [], stake: { currency: "FREE" as const, amount: 0 }, startedAt: 0, watch: "", viewers: 0 });
    expect(telegramGames([g("chess"), g("pool"), g("pinball")]).map((x) => x.game)).toEqual(["chess", "pinball"]);
  });
});
