import { describe, expect, it } from "vitest";
import { ChessGames, onChess } from "./chess.js";
import { HOUSE_GAP_MS, HOUSE_STAR, HouseChess, houseMove, thinkMs } from "./housegame.js";

/** A house loop on its own board and clock, stepped by hand. */
function setup(real = 0, max = 3) {
  let now = 5_000_000;
  const games = new ChessGames(null, () => now);
  const load = { real };
  const house = new HouseChess({ games, now: () => now, random: () => 0.5, realGames: () => load.real, maxReal: () => max });
  /** Runs the loop for `ms` in 250 ms steps, as the server's ticks would. */
  const run = (ms: number) => { for (let t = 0; t < ms; t += 250) { now += 250; games.tick(); house.step(); } };
  return { games, house, load, run, at: () => now };
}

describe("the house exhibition", () => {
  it("plays the practice bot's move: mate first, then the biggest capture", () => {
    // the scholar's mate rather than any other capture
    expect(houseMove("r1bqkb1r/pppp1ppp/2n2n2/4p2Q/2B1P3/8/PPPP1PPP/RNB1K1NR w KQkq - 4 4", () => 0)?.san).toBe("Qxf7#");
    expect(houseMove("4k3/8/8/3q4/8/8/3R4/4K3 w - - 0 1", () => 0)?.san).toBe("Rxd5");
    expect(houseMove("7k/5Q2/6K1/8/8/8/8/8 b - - 0 1")).toBeNull();
  });

  it("thinks like a person: quick in the opening, longer later, never past its clock", () => {
    const quiet = houseMove("rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1", () => 0.5)!;
    expect(thinkMs(2, quiet, 180_000, () => 0.5)).toBe(1_700);
    expect(thinkMs(30, quiet, 180_000, () => 0.5)).toBe(4_400);
    expect(thinkMs(30, quiet, 20_000, () => 0.5)).toBe(800);
  });

  it("starts a game between Frog #7 and a named frog, plays it out, never rated, staked or bet on, and starts the next a minute later", () => {
    const { games, house, run } = setup();
    const told: unknown[] = [];
    onChess((e) => { if ([e.white, e.black].includes(HOUSE_STAR)) told.push(e); });
    house.step();
    const id = house.current!;
    expect(id).toBeTruthy();
    const live = games.live().find((m) => m.id === id)!;
    expect(live.house).toBe(true);
    expect(live.currency).toBe("FREE");
    expect(live.stake).toBeNull();
    expect(live.players.map((p) => p.name)).toContain(HOUSE_STAR);
    expect(() => games.betInfo(id)).toThrow(/house/);
    expect(games.watchView(id).house).toBe(true);
    // it is in no lounge: nobody can sit down at it
    expect(games.lounge().open).toHaveLength(0);
    // the 5-second countdown, then the first move after a short think
    run(8_000);
    expect(games.watchView(id).ply).toBeGreaterThan(0);
    // two greedy bots finish within a game's clocks
    for (let i = 0; i < 2_400 && !games.watchView(id).done; i++) run(1_000);
    const end = games.watchView(id);
    expect(end.done).toBe(true);
    expect(end.reason).not.toBe("paused");
    expect(games.board().best).toHaveLength(0);
    expect(told).toHaveLength(0);
    expect(() => games.rematch(id, "")).toThrow();
    run(1_000);
    expect(house.current).toBeNull();
    run(HOUSE_GAP_MS - 3_000);
    expect(house.current).toBeNull();
    run(3_000);
    expect(house.current).not.toBeNull();
    expect(house.current).not.toBe(id);
  });

  it("steps aside at once when real games pass the limit, and comes back when they drop", () => {
    const { games, house, load, run } = setup(0, 3);
    house.step();
    const id = house.current!;
    run(8_000);
    load.real = 4;
    run(250);
    expect(house.paused).toBe(true);
    expect(house.current).toBeNull();
    const v = games.watchView(id);
    expect(v.done).toBe(true);
    expect(v.reason).toBe("paused");
    expect(v.winner).toBeNull();
    expect(games.live().some((m) => m.house)).toBe(false);
    // still busy: no new game, however long it lasts
    run(HOUSE_GAP_MS * 3);
    expect(house.current).toBeNull();
    load.real = 3;
    run(250);
    expect(house.paused).toBe(false);
    expect(house.current).not.toBeNull();
  });

  it("start and stop: the loop runs on its own timer, and stopping ends the game on the table", () => {
    const { games, house } = setup();
    house.start(10_000);
    expect(house.running).toBe(true);
    house.step();
    const id = house.current!;
    house.stop();
    expect(house.running).toBe(false);
    expect(house.current).toBeNull();
    expect(games.watchView(id).reason).toBe("paused");
  });
});
