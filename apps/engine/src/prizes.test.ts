import { describe, expect, it } from "vitest";
import { ChessGames } from "./chess.js";
import { HouseChess } from "./housegame.js";
import { seasonStartOf } from "./league.js";
import { HOLD_MS, PER_OPPONENT, Prizes, wirePrizes } from "./prizes.js";

const W = (n: number) => `0x${n.toString(16).padStart(40, "0")}`;
const [A, B, C, D] = [W(0xa), W(0xb), W(0xc), W(0xd)];
const MONDAY = seasonStartOf(Date.UTC(2026, 9, 21, 12)); // Mon 19 Oct 2026, 00:00 UTC
const WEEK = 7 * 86_400_000;

function setup() {
  const clock = { now: MONDAY + 3_600_000 };
  const paid: [string, number][] = [];
  const p = new Prizes(null, { now: () => clock.now, hours: () => [24, 12, 6], credit: (w, h) => paid.push([w, h]) });
  const win = (game: "chess" | "pool", w: string, l: string, rated = true) => { clock.now += 1_000; return p.duel(game, { wallet: w, name: `P${w.slice(-1)}` }, { wallet: l, name: `P${l.slice(-1)}` }, "a", rated); };
  return { p, clock, paid, win };
}

describe("weekly prizes", () => {
  it("ranks rated wins between different signed-in wallets, at most 3 games against the same rival", () => {
    const { p, win } = setup();
    // A beats B five times: only the first three games of the pair count
    for (let i = 0; i < 5; i++) win("chess", A, B);
    win("chess", C, D); win("chess", C, B);
    // never counted: a guest, the same wallet twice, an unrated game
    expect(p.duel("chess", { wallet: null, name: "guest" }, { wallet: D, name: "PD" }, "b", true)).toBe(false);
    expect(win("chess", D, D)).toBe(false);
    expect(win("chess", D, A, false)).toBe(false);
    const board = p.standings("chess");
    expect(board.map((r) => [r.wallet, r.wins, r.opponents])).toEqual([[A, PER_OPPONENT, 1], [C, 2, 2]]);
    // a draw is a game: it uses one of the pair's three
    p.duel("chess", { wallet: C, name: "PC" }, { wallet: D, name: "PD" }, null, true);
    p.duel("chess", { wallet: C, name: "PC" }, { wallet: D, name: "PD" }, null, true);
    win("chess", C, D);
    expect(p.standings("chess").find((r) => r.wallet === C)?.wins).toBe(2);
    expect(p.standings("pool")).toEqual([]);
  });

  it("keeps each signed-in wallet's best verified solo score for Space Pinball", () => {
    const { p } = setup();
    p.solo(A, "PA", 40_000); p.solo(A, "PA", 12_000); p.solo(B, "PB", 55_000);
    expect(p.solo(null, "guest", 99_000)).toBe(false);
    expect(p.solo("ip:1.2.3.4", "guest", 99_000)).toBe(false);
    expect(p.standings("pinball").map((r) => [r.wallet, r.score])).toEqual([[B, 55_000], [A, 40_000]]);
  });

  it("closes the week on Monday 00:00 UTC, holds the hours 48 hours, then adds them once", () => {
    const { p, clock, paid, win } = setup();
    win("chess", A, B); win("chess", A, C); win("chess", B, C);
    win("pool", D, A);
    p.solo(C, "PC", 30_000);
    clock.now = MONDAY + WEEK + 60_000;
    const v = p.view();
    expect(v.week.startedAt).toBe(MONDAY + WEEK);
    expect(v.games.chess).toEqual([]);
    expect(v.last.map((a) => [a.game, a.place, a.hours])).toEqual([["chess", 1, 24], ["chess", 2, 12], ["pool", 1, 24], ["pinball", 1, 24]]);
    expect(v.last.every((a) => a.payAt === MONDAY + WEEK + HOLD_MS && !a.paid)).toBe(true);
    // in the hold: nothing yet
    clock.now = MONDAY + WEEK + HOLD_MS - 1;
    expect(p.payDue()).toEqual([]);
    expect(paid).toEqual([]);
    clock.now = MONDAY + WEEK + HOLD_MS;
    expect(p.payDue()).toHaveLength(4);
    expect(paid).toEqual([[A, 24], [B, 12], [D, 24], [C, 24]]);
    expect(p.payDue()).toEqual([]);
    expect(p.view(A).mine).toEqual([expect.objectContaining({ game: "chess", place: 1, hours: 24, paidAt: MONDAY + WEEK + HOLD_MS })]);
  });

  it("lets the admin void an entry in its hold or on this week's board, never a paid one", () => {
    const { p, clock, paid, win } = setup();
    win("chess", A, B); win("chess", B, C);
    p.void("chess", B);
    expect(p.standings("chess").map((r) => r.wallet)).toEqual([A]);
    clock.now = MONDAY + WEEK + 1;
    expect(p.view().last.map((a) => a.place)).toEqual([1]);
    p.void("chess", A, "shared device");
    clock.now += HOLD_MS;
    expect(p.payDue()).toEqual([]);
    expect(paid).toEqual([]);
    expect(p.view().last[0]).toMatchObject({ voided: true, paid: false });
    // a paid prize stays paid
    win("pool", C, D);
    clock.now = MONDAY + 2 * WEEK + HOLD_MS;
    p.payDue();
    expect(paid).toEqual([[C, 24]]);
    expect(() => p.void("pool", C, "late", MONDAY + WEEK)).toThrow(/already/);
  });

  it("shows names only: no wallet leaves the public view", () => {
    const { p, clock, win } = setup();
    win("chess", A, B); p.solo(C, "PC", 9_000);
    clock.now = MONDAY + WEEK + 1;
    win("pool", A, B);
    const json = JSON.stringify(p.view());
    expect(json).not.toMatch(/0x[0-9a-f]{40}/);
    expect(p.view(A).games.pool[0]).toMatchObject({ name: "Pa", you: true, hours: 24 });
  });

  it("follows real chess games, never the house exhibition", () => {
    let now = 9_000_000;
    const clock = { now: MONDAY + 3_600_000 };
    const p = new Prizes(null, { now: () => clock.now, hours: () => [24, 12, 6], credit: () => {} });
    wirePrizes(p);
    const games = new ChessGames(null, () => now);
    const house = new HouseChess({ games, now: () => now, random: () => 0.5, realGames: () => 0, maxReal: () => 5 });
    house.step();
    const id = house.current!;
    for (let i = 0; i < 4_000 && !games.watchView(id).done; i++) { now += 500; games.tick(); house.step(); }
    expect(games.watchView(id).done).toBe(true);
    expect(p.standings("chess")).toEqual([]);
    // a real rated game between two wallets: fool's mate
    const a = games.queue("Ann", A, "3+2"); games.listen(a.match.id, a.player, () => {});
    const b = games.queue("Bob", B, "3+2"); games.listen(b.match.id, b.player, () => {});
    now += 6_000;
    const white = games.get(a.match.id, a.player).you === "w" ? a : b, black = white === a ? b : a;
    for (const [who, from, to] of [[white, "f2", "f3"], [black, "e7", "e5"], [white, "g2", "g4"], [black, "d8", "h4"]] as const) games.move(a.match.id, who.player, from, to);
    expect(games.get(a.match.id, a.player).reason).toBe("checkmate");
    expect(p.standings("chess").map((r) => [r.wallet, r.wins])).toEqual([[black === a ? A : B, 1]]);
  });
});
