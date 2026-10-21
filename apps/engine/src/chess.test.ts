import { EventEmitter } from "node:events";
import type { IncomingMessage, ServerResponse } from "node:http";
import { describe, expect, it, vi } from "vitest";
import { Chess } from "chess.js";
import { ChessGames, cleanName, flagFor } from "./chess.js";
import { chessRoutes } from "./chess-routes.js";

function duel(tc: "3+2" | "5+0" | "10+0" = "3+2", sameName = false) {
  let now = 1_000_000;
  const games = new ChessGames(null, () => now);
  const a = games.queue("Pearl", null, tc);
  const offA = games.listen(a.match.id, a.player, () => {});
  const b = games.queue(sameName ? "Pearl" : "Obsidian", null, tc);
  const offB = games.listen(b.match.id, b.player, () => {});
  const white = a.match.you === "w" ? a.player : b.player, black = white === a.player ? b.player : a.player;
  now += 5_000;
  const move = (from: string, to: string, promotion?: string) => games.move(a.match.id, games.get(a.match.id, white).turn === "w" ? white : black, from, to, promotion);
  return { games, id: a.match.id, white, black, move, advance: (ms: number) => { now += ms; games.tick(); }, offA, offB };
}

describe("night chess", () => {
  it("only pairs a waiting player with an open stream in the same time control", () => {
    const games = new ChessGames(null);
    const a = games.queue("A", null, "3+2"), b = games.queue("B", null, "3+2");
    expect(b.match.id).not.toBe(a.match.id);
    const off = games.listen(a.match.id, a.player, () => {});
    expect(games.queue("C", null, "5+0").match.id).not.toBe(a.match.id);
    expect(games.queue("D", null, "3+2").match.id).toBe(a.match.id);
    off();
  });
  it("refuses illegal and out-of-turn moves without changing the position", () => {
    const d = duel(), fen = d.games.get(d.id, d.white).fen;
    expect(() => d.move("e2", "e5")).toThrow("Illegal move");
    expect(() => d.games.move(d.id, d.black, "e7", "e5")).toThrow("rival's turn");
    expect(d.games.get(d.id, d.white).fen).toBe(fen);
  });
  it("ends scholar's mate with white as the winner and updates Elo", () => {
    const d = duel();
    for (const [from, to] of [["e2", "e4"], ["e7", "e5"], ["f1", "c4"], ["b8", "c6"], ["d1", "h5"], ["g8", "f6"], ["h5", "f7"]]) d.move(from!, to!);
    expect(d.games.get(d.id, d.white)).toMatchObject({ done: true, reason: "checkmate", winner: "w", winnerIsYou: true });
    expect(d.games.get(d.id, d.black).winnerIsYou).toBe(false);
    expect(d.games.board().best.map((r) => r.rating)).toEqual([1212, 1188]);
    expect(d.games.board().board[0]).toMatchObject({ games: 1, wins: 1 });
  });
  it("flags a timeout on the interval and refuses a late move", () => {
    const d = duel("5+0"); d.advance(300_001);
    expect(d.games.get(d.id, d.black)).toMatchObject({ reason: "timeout", winnerIsYou: true, clocks: { w: 0, b: 300_000 } });
    expect(() => d.move("e2", "e4")).toThrow("ended");
    expect(d.games.board().best).toHaveLength(0);
  });
  it("applies elapsed time and increment only to a legal move", () => {
    const d = duel(); d.advance(1_000); d.move("e2", "e4");
    expect(d.games.get(d.id, d.white).clocks).toEqual({ w: 181_000, b: 180_000 });
  });
  it("uses player identity for resignation even when names match", () => {
    const d = duel("3+2", true);
    expect(d.games.resign(d.id, d.white)).toMatchObject({ reason: "resignation", winnerIsYou: false });
    expect(d.games.get(d.id, d.black).winnerIsYou).toBe(true);
  });
  it("requires the rival to accept a draw", () => {
    const d = duel(); d.games.draw(d.id, d.white, "offer");
    expect(() => d.games.draw(d.id, d.white, "accept")).toThrow("No draw offer");
    expect(d.games.draw(d.id, d.black, "accept")).toMatchObject({ done: true, reason: "agreement", winner: null });
  });
  it("detects threefold repetition from authoritative history", () => {
    const d = duel();
    for (let i = 0; i < 2; i++) { d.move("g1", "f3"); d.move("g8", "f6"); d.move("f3", "g1"); d.move("f6", "g8"); }
    expect(d.games.get(d.id, d.white).reason).toBe("repetition");
  });
  it("abandons only after disconnect grace and supports reconnecting", () => {
    const d = duel(); d.offA(); d.offB(); d.advance(44_999);
    expect(d.games.get(d.id, d.white).done).toBe(false);
    d.advance(2);
    expect(d.games.get(d.id, d.black)).toMatchObject({ reason: "abandonment", winnerIsYou: true });
  });
  it("requires both rematch requests and swaps colours", () => {
    const d = duel(); d.games.resign(d.id, d.white);
    expect(d.games.rematch(d.id, d.white).rematchId).toBeNull();
    const next = d.games.rematch(d.id, d.black).rematchId!;
    expect(d.games.get(next, d.white)).toMatchObject({ you: "b", status: "countdown", ply: 0 });
  });
  it("cleans names and reserves official identities", () => {
    expect(cleanName("NIGHTSHIFT")).toBe("Night crew");
    expect(cleanName("admin")).toBe("Night crew");
    expect(cleanName("<Pearl!>")).toBe("Pearl");
    // the audit's bypasses: the shared rule (names.ts) reads them as they look
    for (const n of ["IMD Official", "imd team", "Admin Support", "NIGHTSHIFT Team", "nightshiftt", "i.m.d", "lMD"]) expect(cleanName(n), n).toBe("Night crew");
    expect(cleanName("Night Rook")).toBe("Night Rook");
  });
  it("keeps one board row per wallet, whatever names it used, and never shows the shared default name", async () => {
    const { mkdtempSync, writeFileSync } = await import("node:fs"), { join } = await import("node:path"), { tmpdir } = await import("node:os");
    const file = join(mkdtempSync(join(tmpdir(), "chess-board-")), "chess.json"), now = Date.now();
    const w = "0xabcdef0123456789abcdef0123456789abcdef01";
    writeFileSync(file, JSON.stringify({ ratings: [
      { key: JSON.stringify(["pearl", w]), name: "Pearl", rating: 1210, games: 2, wins: 1, at: now - 5_000 },
      { key: JSON.stringify(["pearl night", w]), name: "Pearl Night", rating: 1230, games: 1, wins: 1, at: now - 1_000 },
      { key: JSON.stringify(["night crew", "0x1111111111111111111111111111111111111111"]), name: "Night crew", rating: 1250, games: 3, wins: 2, at: now },
      { key: JSON.stringify(["night crew", ""]), name: "Night crew", rating: 1300, games: 9, wins: 6, at: now },
    ], results: [] }));
    const best = new ChessGames(file).board().best;
    expect(best.map((r) => r.name)).toEqual(["Frog-1111", "Pearl Night"]);
    expect(best[1]).toMatchObject({ rating: 1230, games: 3, wins: 2 });
  });
  it("flags a staked game whose move times barely vary, and does nothing else (fair play)", () => {
    const play = (gap: (i: number) => number) => {
      let now = 1_000_000;
      const games = new ChessGames(null, () => now);
      const t = games.createStaked({ escrow: `0x${"ab".repeat(32)}`, tc: "10+0", currency: "IMD", stake: "1", a: { wallet: "0x1111111111111111111111111111111111111111", name: "Pearl" }, b: { wallet: "0x2222222222222222222222222222222222222222", name: "Onyx" }, onResult: () => {} });
      const [pa, pb] = Object.values(t.seats) as [string, string];
      games.listen(t.id, pa, () => {}); games.listen(t.id, pb, () => {});
      now += 10_000; // the staked countdown
      for (let i = 0; i < 44; i++) {
        const v = games.get(t.id, pa), me = v.turn === v.you ? pa : pb;
        const moves = new Chess(v.fen).moves({ verbose: true }), m = moves[(i * 7) % moves.length]!;
        now += gap(i);
        const r = games.move(t.id, me, m.from, m.to, m.promotion);
        if (r.done) break;
      }
      return games;
    };
    // an engine on a fixed think time: 2 s a move, give or take 50 ms
    const bot = play((i) => 2_000 + (i % 3) * 50);
    expect(bot.flags()).toHaveLength(1);
    expect(bot.flags()[0]).toMatchObject({ escrow: `0x${"ab".repeat(32)}`, moves: 20 });
    expect(bot.betInfo(bot.flags()[0]!.game).flagged).not.toBeNull();
    // a person: quick moves and long thinks
    expect(play((i) => [1_200, 6_500, 2_300, 14_000, 3_100, 900, 8_000][i % 7]!).flags()).toEqual([]);
    expect(flagFor(Array(19).fill(2_000))).toBeNull();
    expect(flagFor(Array(20).fill(300))).toBeNull(); // premoves say nothing
    expect(flagFor(Array(20).fill(2_000))).toMatchObject({ meanMs: 2_000, sdMs: 0 });
  });
  it("holds both clocks during the countdown and refuses an early move", () => {
    let now = 1_000_000;
    const games = new ChessGames(null, () => now), a = games.queue("A", null, "3+2");
    games.listen(a.match.id, a.player, () => {});
    const b = games.queue("B", null, "3+2"), white = b.match.you === "w" ? b.player : a.player;
    now += 4_999;
    expect(games.get(a.match.id, white).clocks).toEqual({ w: 180_000, b: 180_000 });
    expect(() => games.move(a.match.id, white, "e2", "e4")).toThrow("not started");
  });
  it("checks timeout on a move without waiting for the timer", () => {
    let now = 1_000_000;
    const games = new ChessGames(null, () => now), a = games.queue("A", null, "5+0");
    games.listen(a.match.id, a.player, () => {});
    const b = games.queue("B", null, "5+0"), white = b.match.you === "w" ? b.player : a.player;
    now += 305_001;
    expect(() => games.move(a.match.id, white, "e2", "e4")).toThrow("ended");
    expect(games.get(a.match.id, white).reason).toBe("timeout");
  });
  it("reconnects a disconnected player without resetting their clock", () => {
    const d = duel();d.offA();d.offB();d.advance(40_000);
    d.games.listen(d.id, d.white, () => {});d.advance(10_000);
    expect(d.games.get(d.id, d.white)).toMatchObject({ done: false, clocks: { w: 130_000 } });
  });
  it("does not expose either private player token or wallet to the rival", () => {
    const d = duel(), view = JSON.stringify(d.games.get(d.id, d.white));
    expect(view).not.toContain(d.white);expect(view).not.toContain(d.black);expect(view).not.toContain("wallet");
  });
  it("handles en passant and castling through the same move validator", () => {
    const ep = duel();
    for(const [from,to] of [["e2","e4"],["a7","a6"],["e4","e5"],["d7","d5"],["e5","d6"]])ep.move(from!,to!);
    expect(ep.games.get(ep.id,ep.white).lastMove).toMatchObject({ captured: "p", flags: "e" });
    const castle = duel();
    for(const [from,to] of [["e2","e4"],["e7","e5"],["g1","f3"],["b8","c6"],["f1","c4"],["g8","f6"],["e1","g1"]])castle.move(from!,to!);
    expect(castle.games.get(castle.id,castle.white).lastMove?.san).toBe("O-O");
  });
  it("records played games with matching display names without confusing the winner", () => {
    const d = duel("3+2", true);
    for(const [from,to] of [["e2","e4"],["e7","e5"],["f1","c4"],["b8","c6"],["d1","h5"],["g8","f6"],["h5","f7"]])d.move(from!,to!);
    expect(d.games.get(d.id,d.white).winnerIsYou).toBe(true);
    expect(d.games.get(d.id,d.black).winnerIsYou).toBe(false);
    expect(d.games.board().best[0]).toMatchObject({ rating: 1200, games: 2, wins: 1 });
  });
});

class Stream extends EventEmitter {
  statusCode = 0; writableLength = 0; destroyed = false; blocked = false; ended = false;
  chunks: string[] = [];
  writeHead(status: number) { this.statusCode = status; return this; }
  write(chunk: string) { this.chunks.push(chunk); return !this.blocked; }
  end(chunk?: string) { if(chunk)this.chunks.push(chunk);this.ended = true;return this; }
}
async function request(path: string, method = "GET", input: Record<string, unknown> = {}, stream = new Stream(), rateLimited = false) {
  const url = new URL(path, "http://chess.test"), req = { method, headers: {}, socket: { remoteAddress: "chess-tests" } } as IncomingMessage;
  const handled = await chessRoutes(req, stream as unknown as ServerResponse, url.pathname, {
    owner: null, url, limited: () => rateLimited, body: async () => input,
    json: (res, status, body) => { res.writeHead(status);res.end(JSON.stringify(body)); },
  });
  return { stream, handled, json: () => JSON.parse(stream.chunks[0] ?? "{}") };
}

describe("chess routes", () => {
  it("leaves other APIs alone and rate-limits queues and moves", async () => {
    expect((await request("/api/other")).handled).toBe(false);
    expect((await request("/api/chess/queue","POST",{},new Stream(),true)).stream.statusCode).toBe(429);
    expect((await request("/api/chess/match/a/move","POST",{},new Stream(),true)).stream.statusCode).toBe(429);
  });
  it("requires a player token and releases the four-stream IP cap on close", async () => {
    const r = (await request("/api/chess/queue","POST",{name:"Streams",tc:"5+0"})).json();
    const path = `/api/chess/match/${r.match.id}/events?player=${r.player}`, open:Stream[] = [];
    try {
      expect((await request(`/api/chess/match/${r.match.id}/events?player=wrong`)).stream.statusCode).toBe(400);
      for(let i=0;i<4;i++){const s=(await request(path)).stream;open.push(s);expect(s.statusCode).toBe(200);}
      expect((await request(path)).stream.statusCode).toBe(429);
      open[0]!.emit("close");
      const next=(await request(path)).stream;open.push(next);expect(next.statusCode).toBe(200);
    } finally {for(const s of open)s.emit("close");}
  });
  it("sends a full state before coalesced compact updates", async () => {
    vi.useFakeTimers();let stream:Stream | undefined;
    try {
      const a=(await request("/api/chess/queue","POST",{name:"Snapshot A",tc:"10+0"})).json();
      stream=(await request(`/api/chess/match/${a.match.id}/events?player=${a.player}`)).stream;
      const first=JSON.parse(stream.chunks[0]!.slice(6));expect(first.moves).toEqual([]);expect(first.now).toBeTypeOf("number");
      const b=(await request("/api/chess/queue","POST",{name:"Snapshot B",tc:"10+0"})).json();expect(b.match.id).toBe(a.match.id);
      vi.advanceTimersByTime(35);
      const patch=JSON.parse(stream.chunks.at(-1)!.slice(6));expect(patch.status).toBe("countdown");expect(patch.moves).toBeUndefined();expect(patch.you).toBe(first.you);
    } finally {stream?.emit("close");vi.useRealTimers();}
  });
  it("closes a stream over the backpressure limit", async () => {
    vi.useFakeTimers();let stream:Stream | undefined;
    try {
      const a=(await request("/api/chess/queue","POST",{name:"Slow reader",tc:"3+2"})).json();
      stream=(await request(`/api/chess/match/${a.match.id}/events?player=${a.player}`)).stream;
      stream.blocked=true;stream.writableLength=300_000;
      await request("/api/chess/queue","POST",{name:"Rival",tc:"3+2"});vi.advanceTimersByTime(35);
      expect(stream.ended).toBe(true);
    } finally {stream?.emit("close");vi.useRealTimers();}
  });
});
