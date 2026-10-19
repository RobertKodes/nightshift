import { EventEmitter } from "node:events";
import { mkdtempSync } from "node:fs";
import type { IncomingMessage, ServerResponse } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { ChessGames, LOUNGE_GRACE_MS, LOUNGE_WAIT_MS } from "./chess.js";

const W1 = "0x1111111111111111111111111111111111111111", W2 = "0x2222222222222222222222222222222222222222";
function room() {
  let now = 1_000_000;
  const games = new ChessGames(null, () => now);
  return { games, advance: (ms: number) => { now += ms; games.tick(); } };
}

describe("lounge: free chess", () => {
  it("lists every open game with its host, rating and wait, and counts per time control, never a seat or a wallet", () => {
    const { games } = room();
    const a = games.queue("Pearl", W1, "3+2"), offA = games.listen(a.match.id, a.player, () => {});
    const b = games.queue("Onyx", null, "5+0"), offB = games.listen(b.match.id, b.player, () => {});
    const l = games.lounge();
    expect(l.open.map((g) => [g.id, g.tc, g.host.name, g.host.rating, g.away])).toEqual([[a.match.id, "3+2", "Pearl", 1200, false], [b.match.id, "5+0", "Onyx", 1200, false]]);
    expect(l.waiting).toEqual({ "3+2": 1, "5+0": 1, "10+0": 0, any: 0 });
    expect(l.mine).toEqual([]);
    expect(games.lounge(W1.toUpperCase().replace("0X", "0x")).mine).toEqual([a.match.id]);
    const text = JSON.stringify(l);
    expect(text).not.toContain(a.player); expect(text).not.toContain(b.player); expect(text).not.toContain(W1);
    offA(); offB();
  });
  it("joins one open game by its id, whatever its time control, and takes it out of the lounge", () => {
    const { games } = room();
    const a = games.queue("Pearl", null, "10+0"); games.listen(a.match.id, a.player, () => {});
    const other = games.queue("Onyx", null, "3+2"); games.listen(other.match.id, other.player, () => {});
    const j = games.join(a.match.id, "Jade", W2);
    expect(j.match).toMatchObject({ id: a.match.id, tc: "10+0", status: "countdown", clocks: { w: 600_000, b: 600_000 } });
    expect(j.match.you).not.toBe(games.get(a.match.id, a.player).you);
    expect(games.lounge().open.map((g) => g.id)).toEqual([other.match.id]);
    expect(() => games.join(a.match.id, "Late", null)).toThrow(/Someone else just took this game/);
    expect(() => games.join("ffff", "Nobody", null)).toThrow(/not in the lounge/);
  });
  it("plays anyone across time controls, on the host's clock", () => {
    const { games } = room();
    const a = games.queue("Rapid host", null, "10+0"); games.listen(a.match.id, a.player, () => {});
    const any = games.queue("Anyone", null, "any");
    expect(any.match).toMatchObject({ id: a.match.id, tc: "10+0", status: "countdown" });
    // nobody waits: an "any" game opens, and the next rival's time control sets its clock
    const host = games.queue("Any host", null, "any"); games.listen(host.match.id, host.player, () => {});
    expect(host.match).toMatchObject({ status: "waiting", any: true });
    expect(games.lounge().waiting.any).toBe(1);
    const blitz = games.queue("Blitz", null, "5+0");
    expect(blitz.match).toMatchObject({ id: host.match.id, tc: "5+0", clocks: { w: 300_000, b: 300_000 }, any: false });
  });
  it("refuses a wallet its own game, by queue and by id, with a clear reason", () => {
    const { games } = room();
    const a = games.queue("Pearl", W1, "3+2"); games.listen(a.match.id, a.player, () => {});
    expect(() => games.queue("Pearl again", W1, "3+2")).toThrow("This is your own game: use another wallet or play as a guest.");
    expect(() => games.queue("Pearl again", W1, "any")).toThrow(/your own game/);
    try { games.join(a.match.id, "Pearl again", W1.toUpperCase().replace("0X", "0x")); expect.unreachable(); } catch (e) { expect((e as { status: number }).status).toBe(409); expect((e as Error).message).toMatch(/your own game/); }
    // a guest, or another wallet, plays it
    expect(games.join(a.match.id, "Guest", null).match.status).toBe("countdown");
  });
  it("keeps an open game through the grace period after the host's stream drops, then closes it and tells the host", () => {
    const { games, advance } = room();
    const a = games.queue("Sleepy", null, "3+2");
    let off = games.listen(a.match.id, a.player, () => {});
    off(); advance(LOUNGE_GRACE_MS - 30_000);
    expect(games.lounge().open[0]).toMatchObject({ id: a.match.id, away: true });
    expect(games.lounge().open[0]!.awayUntil).toBeGreaterThan(1_000_000);
    // nobody sits down at an empty chair, and nobody is paired with it
    expect(() => games.join(a.match.id, "Rival", null)).toThrow(/stepped away/);
    const elsewhere = games.queue("Rival", null, "3+2");
    expect(elsewhere.match.id).not.toBe(a.match.id);
    games.leave(elsewhere.match.id, elsewhere.player);
    // the phone wakes up: the game is open again, at its place
    off = games.listen(a.match.id, a.player, () => {});
    advance(LOUNGE_GRACE_MS + 10_000);
    expect(games.get(a.match.id, a.player)).toMatchObject({ status: "waiting", expired: null });
    off(); advance(LOUNGE_GRACE_MS + 1_000);
    expect(games.get(a.match.id, a.player)).toMatchObject({ done: true, expired: "away" });
    expect(games.lounge().open).toEqual([]);
    expect(() => games.join(a.match.id, "Rival", null)).toThrow(/closed/);
  });
  it("closes a game nobody joined within the wait limit", () => {
    const { games, advance } = room();
    const a = games.queue("Patient", null, "10+0"); games.listen(a.match.id, a.player, () => {});
    advance(LOUNGE_WAIT_MS + 1_000);
    expect(games.get(a.match.id, a.player)).toMatchObject({ done: true, expired: "timeout" });
  });
  it("folds two waiting players in the same time control into one game, and cancels by token or wallet", () => {
    const { games, advance } = room();
    const a = games.queue("First", null, "5+0"); let offA = games.listen(a.match.id, a.player, () => {});
    offA();
    const b = games.queue("Second", null, "5+0"); games.listen(b.match.id, b.player, () => {});
    expect(b.match.id).not.toBe(a.match.id);
    offA = games.listen(a.match.id, a.player, () => {});
    advance(250);
    expect(games.get(b.match.id, b.player)).toMatchObject({ movedTo: a.match.id });
    expect(games.get(a.match.id, b.player)).toMatchObject({ status: "countdown" });
    const c = games.queue("Mine", W1, "3+2");
    expect(() => games.cancel(c.match.id, "wrong", W2)).toThrow(/Only the player/);
    games.cancel(c.match.id, null, W1);
    expect(games.get(c.match.id, c.player).done).toBe(true);
    offA();
  });
});

describe("lounge: free pinball", () => {
  let pb: typeof import("./pinball.js");
  beforeAll(async () => {
    vi.useFakeTimers();
    process.env.DATA_DIR = mkdtempSync(join(tmpdir(), "lounge-test-"));
    pb = await import("./pinball.js");
  });
  afterAll(() => { vi.useRealTimers(); });
  it("lists open duels, joins one by id, refuses the same wallet and closes after the grace period", async () => {
    const a = await pb.queue("Comet", W1, "FREE", 0, null), off = pb.listen(a.match.id, a.player, () => {});
    expect(pb.lounge().open.find((g) => g.id === a.match.id)).toMatchObject({ host: { name: "Comet" }, away: false });
    await expect(pb.queue("Comet again", W1, "FREE", 0, null)).rejects.toThrow(/your own game/);
    await expect(pb.joinOpen(a.match.id, "Comet again", W1, null)).rejects.toThrow(/your own game/);
    const j = await pb.joinOpen(a.match.id, "Nova", W2, null);
    expect(j.match.id).toBe(a.match.id);
    expect(j.match.startedAt).not.toBeNull();
    off();
    const h = await pb.queue("Drifter", null, "FREE", 0, null), offH = pb.listen(h.match.id, h.player, () => {});
    offH();
    vi.advanceTimersByTime(LOUNGE_GRACE_MS - 10_000);
    expect(pb.lounge().open.find((g) => g.id === h.match.id)).toMatchObject({ away: true });
    await expect(pb.joinOpen(h.match.id, "Rival", null, null)).rejects.toThrow(/stepped away/);
    vi.advanceTimersByTime(15_000);
    expect(pb.get(h.match.id, h.player)).toMatchObject({ done: true, expired: "away" });
    expect(pb.get(h.match.id, h.player)!.void).toMatch(/away for more than 90 seconds/);
  });
});

class Stream extends EventEmitter {
  statusCode = 0; writableLength = 0; destroyed = false; chunks: string[] = [];
  writeHead(status: number) { this.statusCode = status; return this; }
  write(chunk: string) { this.chunks.push(chunk); return true; }
  end(chunk?: string) { if (chunk) this.chunks.push(chunk); return this; }
}

describe("lounge routes", () => {
  it("serves the feed and a stream, and answers a wallet joining its own game with 409", async () => {
    const { loungeRoutes } = await import("./lounge.js");
    const { games } = room();
    const pinball = { lounge: () => ({ open: [], waiting: 0, mine: [] }), queue: async () => { throw new Error("no"); }, joinOpen: async () => { throw new Error("no"); }, cancel: () => {} } as never;
    const sources = { chess: games, pinball, challenges: () => [{ matchId: "0xabc" }], live: () => [] };
    const call = async (path: string, method = "GET", input: Record<string, unknown> = {}, owner: string | null = null) => {
      const s = new Stream(), req = { method, headers: {}, socket: { remoteAddress: "lounge-tests" } } as unknown as IncomingMessage;
      const handled = await loungeRoutes(req, s as unknown as ServerResponse, path, { owner, sources, limited: () => false, body: async () => input, json: (res, status, body) => { res.writeHead(status); res.end(JSON.stringify(body)); } });
      return { handled, s, json: () => JSON.parse(s.chunks[0]!.replace(/^data: /, "")) };
    };
    expect((await call("/api/games/live")).handled).toBe(false);
    const a = games.queue("Pearl", W1, "3+2"); games.listen(a.match.id, a.player, () => {});
    const feed = (await call("/api/games/lounge")).json();
    expect(feed).toMatchObject({ open: [{ game: "chess", id: a.match.id, tc: "3+2", host: { name: "Pearl" } }], waiting: { chess: { "3+2": 1 }, pinball: 0 }, challenges: [{ matchId: "0xabc" }] });
    const own = await call("/api/games/lounge/join", "POST", { game: "chess", id: a.match.id, name: "Me" }, W1);
    expect(own.s.statusCode).toBe(409);
    expect(own.json().error).toBe("This is your own game: use another wallet or play as a guest.");
    const ev = await call("/api/games/lounge/events");
    expect(ev.s.statusCode).toBe(200);
    expect(ev.json().open).toHaveLength(1);
    ev.s.emit("close");
    const ok = await call("/api/games/lounge/join", "POST", { game: "chess", id: a.match.id, name: "Rival" }, W2);
    expect(ok.json()).toMatchObject({ game: "chess", match: { id: a.match.id, status: "countdown" } });
    expect(typeof ok.json().player).toBe("string");
  });
});
