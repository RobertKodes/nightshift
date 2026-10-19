import { EventEmitter } from "node:events";
import { mkdtempSync } from "node:fs";
import type { IncomingMessage, ServerResponse } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

class Stream extends EventEmitter {
  statusCode = 0; writableLength = 0; destroyed = false; blocked = false; ended = false;
  chunks: string[] = [];
  writeHead(status: number) { this.statusCode = status; return this; }
  write(chunk: string) { this.chunks.push(chunk); return !this.blocked; }
  end(chunk?: string) { if (chunk) this.chunks.push(chunk); this.ended = true; return this; }
  frames() { return this.chunks.filter((c) => c.startsWith("data: ")).map((c) => JSON.parse(c.slice(6))); }
}

describe("spectator mode", () => {
  let sp: typeof import("./spectate.js"), ch: typeof import("./chess.js"), pb: typeof import("./pinball.js");
  const open: Stream[] = [];
  beforeAll(async () => {
    vi.useFakeTimers();
    vi.setSystemTime(Date.UTC(2026, 9, 19, 12));
    process.env.DATA_DIR = mkdtempSync(join(tmpdir(), "spectate-test-"));
    [sp, ch, pb] = await Promise.all([import("./spectate.js"), import("./chess.js"), import("./pinball.js")]);
  });
  afterAll(() => { for (const s of open) s.emit("close"); vi.useRealTimers(); });

  async function request(path: string, method = "GET", ip = "spectator", rateLimited = false) {
    const stream = new Stream();
    const req = { method, headers: {}, socket: { remoteAddress: ip } } as unknown as IncomingMessage;
    const handled = await sp.spectateRoutes(req, stream as unknown as ServerResponse, path, {
      limited: () => rateLimited, json: (res, status, body) => { res.writeHead(status); res.end(JSON.stringify(body)); },
    });
    if (stream.statusCode === 200 && !stream.ended) open.push(stream);
    return { stream, handled, json: () => JSON.parse(stream.chunks[0] ?? "{}") };
  }
  /** Two players on the shared chess board, both connected, past the countdown. */
  function chessDuel(names: [string, string]) {
    const a = ch.chess.queue(names[0], null, "10+0"); ch.chess.listen(a.match.id, a.player, () => {});
    const b = ch.chess.queue(names[1], null, "10+0", true); ch.chess.listen(b.match.id, b.player, () => {});
    expect(b.match.id).toBe(a.match.id);
    vi.advanceTimersByTime(5_100);
    const white = a.match.you === "w" ? a.player : b.player;
    return { id: a.match.id, white, black: white === a.player ? b.player : a.player };
  }

  it("leaves other routes alone and lists only games being played", async () => {
    expect((await request("/api/games/escrow")).handled).toBe(false);
    expect((await request("/api/chess/match/abc/move")).handled).toBe(false);
    const waiting = ch.chess.queue("Lonely", null, "3+2");
    const d = chessDuel(["Pearl", "Owl agent"]);
    const { games } = (await request("/api/games/live")).json();
    const g = games.find((x: { id: string }) => x.id === d.id);
    expect(g).toMatchObject({ game: "chess", stake: { currency: "FREE", amount: 0 }, watch: `/games/chess?watch=${d.id}`, viewers: 0 });
    expect(g.players.map((p: { name: string }) => p.name).sort()).toEqual(["Owl agent", "Pearl"]);
    expect(g.players.find((p: { name: string }) => p.name === "Owl agent").agent).toBe(true);
    expect(games.some((x: { id: string }) => x.id === waiting.match.id)).toBe(false);
    expect(JSON.stringify(games)).not.toContain(d.white);
    expect((await request("/api/games/live", "GET", "x", true)).stream.statusCode).toBe(429);
  });

  it("streams a chess game read-only: no seat token, no moves, counted viewers", async () => {
    const d = chessDuel(["Moon", "Violet"]);
    const s = (await request(`/api/chess/match/${d.id}/watch`)).stream;
    expect(s.statusCode).toBe(200);
    const first = s.frames()[0];
    expect(first).toMatchObject({ id: d.id, spectating: true, viewers: 1, you: null, winnerIsYou: false, status: "playing", moves: [] });
    expect(first.players.every((p: { you: boolean }) => !p.you)).toBe(true);
    for (const verb of ["POST", "PUT", "DELETE"]) expect((await request(`/api/chess/match/${d.id}/watch`, verb)).stream.statusCode).toBe(405);
    ch.chess.move(d.id, d.white, "e2", "e4");
    vi.advanceTimersByTime(35);
    const patch = s.frames().at(-1);
    expect(patch).toMatchObject({ ply: 1, spectating: true });
    expect(patch.lastMove.san).toBe("e4");
    expect(patch.moves).toBeUndefined();
    const all = s.chunks.join("");
    expect(all).not.toContain(d.white); expect(all).not.toContain(d.black);
    expect(sp.liveGames().find((g) => g.id === d.id)?.viewers).toBe(1);
    s.emit("close");
    expect(sp.viewersOf("chess", d.id)).toBe(0);
    expect((await request("/api/chess/match/ffff/watch")).stream.statusCode).toBe(404);
  });

  it("caps spectators per match and per IP", async () => {
    const d = chessDuel(["Cap A", "Cap B"]);
    const path = `/api/chess/match/${d.id}/watch`, mine: Stream[] = [];
    for (let i = 0; i < 6; i++) mine.push((await request(path, "GET", "one-ip")).stream);
    expect(mine.every((s) => s.statusCode === 200)).toBe(true);
    expect((await request(path, "GET", "one-ip")).stream.statusCode).toBe(429);
    for (let i = 6; i < sp.MAX_VIEWERS; i++) mine.push((await request(path, "GET", `ip-${i}`)).stream);
    expect(sp.viewersOf("chess", d.id)).toBe(sp.MAX_VIEWERS);
    const full = await request(path, "GET", "late");
    expect(full.stream.statusCode).toBe(429);
    expect(full.json().error).toContain("full");
    for (const s of mine) s.emit("close");
    expect(sp.viewersOf("chess", d.id)).toBe(0);
  });

  it("streams both pinball tables without the seed until the duel is settled", async () => {
    const A = await pb.queue("Alice", null, "FREE", 0, null); pb.listen(A.match.id, A.player, () => {});
    const B = await pb.queue("Bob", null, "FREE", 0, null); pb.listen(B.match.id, B.player, () => {});
    const id = A.match.id;
    vi.advanceTimersByTime(6_000);
    expect(pb.get(id, A.player)!.seed).not.toBeNull();
    const s = (await request(`/api/pinball/match/${id}/watch`)).stream;
    expect(s.statusCode).toBe(200);
    const first = s.frames()[0];
    expect(first).toMatchObject({ id, seed: null, spectating: true, viewers: 1, winnerIsYou: false });
    expect(first.players).toHaveLength(2);
    expect(first.players.every((p: { you: boolean; score: null }) => !p.you && p.score === null)).toBe(true);
    pb.progress(id, A.player, { inputs: [], tick: 10, x: 300, y: 400 });
    vi.advanceTimersByTime(300);
    const next = s.frames().at(-1);
    expect(next.seed).toBeNull();
    expect(next.players.find((p: { name: string }) => p.name === "Alice")).toMatchObject({ x: 300, y: 400 });
    const all = s.chunks.join("");
    expect(all).not.toContain(A.player); expect(all).not.toContain(B.player);
    expect(sp.liveGames().find((g) => g.id === id)).toMatchObject({ game: "pinball", watch: `/games/pinball?watch=${id}`, viewers: 1, stake: { currency: "FREE", amount: 0 } });
    expect((await request(`/api/pinball/match/${id}/watch`, "POST")).stream.statusCode).toBe(405);
    // the watch path takes nothing: a progress post from a spectator has no seat to land on
    expect(() => pb.progress(id, "", { inputs: [[1, 1, 0, 0]] })).not.toThrow();
    expect(pb.get(id, A.player)!.players.every((p) => p.live === 0)).toBe(true);
    s.emit("close");
    expect(sp.viewersOf("pinball", id)).toBe(0);
  });
});
