import { randomBytes, randomInt, randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { Chess, type Color, type Move } from "chess.js";
import { config } from "./config.js";

/**
 * Chess duels. Moves, elapsed time and results are decided here, never by a browser. Queue games
 * are free; a game for IMD or $SHIFT is made by the challenge lobby once both stakes are in
 * GameEscrow (createStaked), and its result goes to the escrow.
 */
/** A staked game starts once both players are connected, or this long after it was made. */
export const STAKED_SHOW_MS = 5 * 60_000;
export const CONTROLS = { "3+2": { time: 180_000, increment: 2_000 }, "5+0": { time: 300_000, increment: 0 }, "10+0": { time: 600_000, increment: 0 } };
export type TimeControl = keyof typeof CONTROLS;
export type Reason = "checkmate" | "stalemate" | "repetition" | "insufficient material" | "50-move rule" | "resignation" | "agreement" | "abandonment" | "timeout";
type Player = { id: string; name: string; wallet: string | null; color: Color; rating: number; moves: number; streams: number; offlineAt: number | null; agent?: boolean };
type Match = {
  id: string; tc: TimeControl; currency: "FREE" | "IMD" | "SHIFT"; createdAt: number; startedAt: number | null; turnAt: number;
  game: Chess; players: Player[]; clocks: Record<Color, number>; moves: Move[]; version: number;
  done: boolean; winner: string | null; reason: Reason | null; drawOffer: string | null;
  rematch: Set<string>; rematchId: string | null; endedAt: number | null;
  /** A staked game: the escrow match id, the stake shown, when it starts regardless, who hears the result. */
  escrow?: string; stake?: string; showBy?: number; onResult?: (r: { draw: boolean; winner: string | null }) => void;
};
type Rating = { key: string; name: string; rating: number; games: number; wins: number; at: number };
type NightResult = { key: string; at: number; win: boolean };
type Boards = { ratings: Rating[]; results: NightResult[] };
export type ChessEvent = { kind: "result"; white: string; black: string; winner: string | null; reason: Reason; moves: number; tc: TimeControl };
const arcade: ((e: ChessEvent) => void)[] = [];
export const onChess = (f: (e: ChessEvent) => void) => { arcade.push(f); };
const opposite = (c: Color): Color => c === "w" ? "b" : "w";
export function cleanName(name: string): string {
  const clean = name.replace(/[^\w .-]/g, "").trim().slice(0, 18);
  return !clean || /^(nightshift|admin|imd)$/i.test(clean.replace(/[ ._-]/g, "")) ? "Night crew" : clean;
}
const keyOf = (p: Pick<Player, "name" | "wallet">) => JSON.stringify([p.name.toLowerCase(), p.wallet?.toLowerCase() ?? ""]);

/** Separate stores also let tests run complete games without touching the live board. */
export class ChessGames {
  private matches = new Map<string, Match>();
  private waiting = new Map<TimeControl, Set<string>>();
  private listeners = new Map<string, Set<() => void>>();
  private boards: Boards = { ratings: [], results: [] };
  constructor(private file: string | null = join(config.dataDir, "chess.json"), private now = () => Date.now()) {
    try {
      if (file && existsSync(file)) {
        const data = JSON.parse(readFileSync(file, "utf8"));
        if (Array.isArray(data.ratings) && Array.isArray(data.results)) this.boards = data;
      }
    } catch { /* an unreadable board must not keep the arcade offline */ }
  }
  private emit(m: Match) { m.version++; for (const f of this.listeners.get(m.id) ?? []) f(); }
  private player(m: Match, id: string) {
    const p = m.players.find((p) => p.id === id);
    if (!p) throw new Error("No such player");
    return p;
  }
  private match(id: string) { const m = this.matches.get(id); if (!m) throw new Error("No such match"); return m; }
  private rating(p: Pick<Player, "name" | "wallet">) { return this.boards.ratings.find((r) => r.key === keyOf(p))?.rating ?? 1200; }
  private create(tc: TimeControl, players: Player[], staked?: Pick<Match, "currency" | "escrow" | "stake" | "showBy" | "onResult">): Match {
    const now = this.now();
    const m: Match = { ...staked, id: randomBytes(10).toString("hex"), tc, currency: staked?.currency ?? "FREE", createdAt: now, startedAt: null, turnAt: now, game: new Chess(), players,
      clocks: { w: CONTROLS[tc].time, b: CONTROLS[tc].time }, moves: [], version: 0, done: false, winner: null, reason: null, drawOffer: null, rematch: new Set(), rematchId: null, endedAt: null };
    this.matches.set(m.id, m);
    if (players.length === 2 && !m.escrow) this.start(m);
    return m;
  }
  /**
   * A game for a stake held in GameEscrow, for exactly these two wallets. Each attaches with the
   * seat the lobby gives only to that wallet's signed-in session. A player who never comes loses by
   * abandonment on their turn; if neither comes, it is a draw (both stakes go back).
   */
  createStaked(o: { escrow: string; tc: TimeControl; currency: "IMD" | "SHIFT"; stake: string; a: { wallet: string; name: string; agent?: boolean }; b: { wallet: string; name: string; agent?: boolean }; onResult: (r: { draw: boolean; winner: string | null }) => void }): { id: string; seats: Record<string, string> } {
    if (!Object.hasOwn(CONTROLS, o.tc)) throw new Error("Choose 3+2, 5+0 or 10+0");
    const seat = (s: { wallet: string; name: string; agent?: boolean }, color: Color): Player => {
      const p: Player = { id: randomUUID(), name: cleanName(s.name), wallet: s.wallet.toLowerCase(), color, rating: 1200, moves: 0, streams: 0, offlineAt: this.now(), ...(s.agent ? { agent: true } : {}) };
      p.rating = this.rating(p);
      return p;
    };
    const colorA: Color = randomInt(2) ? "w" : "b", a = seat(o.a, colorA), b = seat(o.b, opposite(colorA));
    const m = this.create(o.tc, [a, b], { currency: o.currency, escrow: o.escrow, stake: o.stake, showBy: this.now() + STAKED_SHOW_MS, onResult: o.onResult });
    return { id: m.id, seats: { [a.wallet!]: a.id, [b.wallet!]: b.id } };
  }
  private start(m: Match) { m.startedAt = this.now() + 5_000; m.turnAt = m.startedAt; this.emit(m); }
  /** `agent` marks an AI player (the arena's), shown as such to spectators. */
  queue(name: string, wallet: string | null, tc: TimeControl, agent = false) {
    if (!Object.hasOwn(CONTROLS, tc)) throw new Error("Choose 3+2, 5+0 or 10+0");
    if (this.matches.size >= 10_000) throw new Error("The arcade is full. Try again shortly.");
    const p: Player = { id: randomUUID(), name: cleanName(name), wallet, color: randomInt(2) ? "w" : "b", rating: 1200, moves: 0, streams: 0, offlineAt: this.now(), ...(agent ? { agent: true } : {}) };
    p.rating = this.rating(p);
    const line = this.waiting.get(tc) ?? new Set<string>();
    this.waiting.set(tc, line);
    for (const id of line) {
      const m = this.matches.get(id), rival = m?.players[0];
      if (!m || m.done || m.startedAt || this.now() - m.createdAt > 600_000) { line.delete(id); continue; }
      if (!rival?.streams || (wallet && rival.wallet?.toLowerCase() === wallet.toLowerCase())) continue;
      p.color = opposite(rival.color); m.players.push(p); line.delete(id); this.start(m);
      return { match: this.view(m, p.id), player: p.id };
    }
    const m = this.create(tc, [p]); line.add(m.id);
    return { match: this.view(m, p.id), player: p.id };
  }
  private clocks(m: Match) {
    const clocks = { ...m.clocks };
    if (m.startedAt && !m.done && this.now() >= m.startedAt) clocks[m.game.turn()] = Math.max(0, clocks[m.game.turn()] - (this.now() - m.turnAt));
    return clocks;
  }
  private view(m: Match, me: string, compact = false) {
    const now = this.now();
    return { id: m.id, tc: m.tc, currency: m.currency, stake: m.stake ?? null, escrow: m.escrow ?? null, version: m.version, now, startedAt: m.startedAt,
      status: m.done ? "finished" as const : !m.startedAt ? "waiting" as const : now < m.startedAt ? "countdown" as const : "playing" as const,
      fen: m.game.fen(), turn: m.game.turn(), check: m.game.isCheck(), clocks: this.clocks(m), lastMove: m.moves.at(-1) ?? null,
      ply: m.moves.length, ...(!compact ? { moves: m.moves } : {}), done: m.done, reason: m.reason,
      winner: m.winner ? m.players.find((p) => p.id === m.winner)?.color ?? null : null,
      you: m.players.find((p) => p.id === me)?.color ?? null, winnerIsYou: m.winner === me,
      drawOffer: m.drawOffer ? m.drawOffer === me ? "you" as const : "rival" as const : null,
      rematchRequested: m.rematch.has(me), rivalWantsRematch: m.players.some((p) => p.id !== me && m.rematch.has(p.id)), rematchId: m.rematchId,
      players: m.players.map((p) => ({ name: p.name, color: p.color, rating: p.rating, you: p.id === me, connected: p.streams > 0 })) };
  }
  get(id: string, me: string, compact = false) { const m = this.match(id); this.player(m, me); this.check(m); return this.view(m, me, compact); }
  listen(id: string, me: string, f: () => void): () => void {
    const m = this.match(id), p = this.player(m, me);
    const set = this.listeners.get(id) ?? new Set(); set.add(f); this.listeners.set(id, set);
    p.streams++; p.offlineAt = null;
    if (m.escrow && !m.startedAt && !m.done && m.players.every((x) => x.streams > 0)) this.start(m); else this.emit(m);
    let closed = false;
    return () => { if (closed) return; closed = true; set.delete(f); p.streams = Math.max(0, p.streams - 1); if (!p.streams) p.offlineAt = this.now(); this.emit(m); };
  }
  /**
   * The games being played now, for the spectators' list. Names, colours and ratings only: a seat
   * token never leaves this class except to its own player.
   */
  live() {
    return [...this.matches.values()].filter((m) => !m.done && m.startedAt !== null && m.players.length === 2).map((m) => ({
      id: m.id, tc: m.tc, currency: m.currency, stake: m.stake ?? null, startedAt: m.startedAt!,
      players: [...m.players].sort((a, b) => a.color === "w" ? -1 : b.color === "w" ? 1 : 0).map((p) => ({ name: p.name, color: p.color, rating: p.rating, ...(p.agent ? { agent: true } : {}) })),
    }));
  }
  /** What a spectator sees: the board, both clocks and the moves, as nobody's seat. */
  watchView(id: string, compact = false) {
    const m = this.match(id); this.check(m);
    const v = this.view(m, "", compact);
    return { ...v, escrow: null, you: null, winnerIsYou: false, drawOffer: null, rematchRequested: false, rivalWantsRematch: false, rematchId: null, players: v.players.map((p) => ({ ...p, you: false })) };
  }
  /** A spectator's stream: told of every change, without counting as a player being there. */
  watch(id: string, f: () => void): () => void {
    this.match(id);
    const set = this.listeners.get(id) ?? new Set(); set.add(f); this.listeners.set(id, set);
    return () => { set.delete(f); };
  }
  leave(id: string, me: string) {
    const m = this.match(id); this.player(m, me);
    if (m.escrow) throw new Error("A staked game starts once both players are here, or within 5 minutes. Stay at the table.");
    if (m.startedAt) throw new Error("The rival joined. Resign to leave this game.");
    m.done = true; this.waiting.get(m.tc)?.delete(id); this.emit(m);
  }
  private check(m: Match) {
    if (m.done || !m.startedAt || this.now() < m.startedAt) return;
    const turn = m.game.turn(), p = m.players.find((p) => p.color === turn)!;
    if (this.clocks(m)[turn] <= 0) { this.end(m, opposite(turn), "timeout"); return; }
    if (p.offlineAt !== null && this.now() - Math.max(p.offlineAt, m.turnAt) > 45_000) this.end(m, opposite(turn), "abandonment");
  }
  move(id: string, me: string, from: string, to: string, promotion?: string) {
    const m = this.match(id), p = this.player(m, me); this.check(m);
    if (m.done) throw new Error("The game has ended");
    if (!m.startedAt || this.now() < m.startedAt) throw new Error("The game has not started");
    if (m.game.turn() !== p.color) throw new Error("It is your rival's turn");
    if (!/^[a-h][1-8]$/.test(from) || !/^[a-h][1-8]$/.test(to) || (promotion !== undefined && !/^[qrbn]$/.test(promotion))) throw new Error("Illegal move");
    let move: Move;
    try { move = m.game.move({ from, to, promotion }); } catch { throw new Error("Illegal move"); }
    m.clocks[p.color] = Math.max(0, m.clocks[p.color] - (this.now() - m.turnAt)) + CONTROLS[m.tc].increment;
    m.turnAt = this.now(); m.moves.push(move); p.moves++; if (m.drawOffer !== p.id) m.drawOffer = null;
    if (m.game.isCheckmate()) this.end(m, p.color, "checkmate");
    else if (m.game.isStalemate()) this.end(m, null, "stalemate");
    else if (m.game.isThreefoldRepetition()) this.end(m, null, "repetition");
    else if (m.game.isInsufficientMaterial()) this.end(m, null, "insufficient material");
    else if (m.game.isDraw()) this.end(m, null, "50-move rule");
    else this.emit(m);
    return this.view(m, me);
  }
  resign(id: string, me: string) {
    const m = this.match(id), p = this.player(m, me); this.check(m);
    if (!m.startedAt) throw new Error("No rival yet");
    if (!m.done) this.end(m, opposite(p.color), "resignation");
    return this.view(m, me);
  }
  draw(id: string, me: string, action: string) {
    const m = this.match(id); this.player(m, me); this.check(m);
    if (m.done || !m.startedAt || this.now() < m.startedAt) throw new Error("No active game");
    if (action === "offer") { if (m.drawOffer && m.drawOffer !== me) throw new Error("Your rival already offered a draw"); m.drawOffer = me; }
    else if ((action === "accept" || action === "decline") && m.drawOffer && m.drawOffer !== me) {
      if (action === "accept") this.end(m, null, "agreement"); else m.drawOffer = null;
    } else throw new Error("No draw offer to answer");
    this.emit(m); return this.view(m, me);
  }
  rematch(id: string, me: string) {
    const m = this.match(id); this.player(m, me);
    if (!m.done || !m.startedAt) throw new Error("Finish this game first");
    if (m.escrow) throw new Error("A staked game has no rematch: open a new challenge.");
    if (!m.rematchId) {
      m.rematch.add(me);
      if (m.rematch.size === 2) {
        const next = this.create(m.tc, m.players.map((p) => ({ ...p, color: opposite(p.color), rating: this.rating(p), moves: 0, streams: 0, offlineAt: this.now() })));
        m.rematchId = next.id;
      }
      this.emit(m);
    }
    return this.view(m, me);
  }
  private end(m: Match, winner: Color | null, reason: Reason) {
    if (m.done) return;
    m.clocks = this.clocks(m); m.done = true; m.reason = reason; m.endedAt = this.now(); m.drawOffer = null;
    m.winner = m.players.find((p) => p.color === winner)?.id ?? null;
    if (m.players.every((p) => p.moves >= 2)) this.record(m);
    const white = m.players.find((p) => p.color === "w")!, black = m.players.find((p) => p.color === "b")!;
    for (const f of arcade) try { f({ kind: "result", white: white.name, black: black.name, winner: m.winner === white.id ? white.name : m.winner === black.id ? black.name : null, reason, moves: m.moves.length, tc: m.tc }); } catch (err) { console.error("chess arcade", err); }
    // the server's verdict of a staked game, by wallet, to the escrow (signed there after its own checks)
    if (m.onResult) try { m.onResult({ draw: m.winner === null, winner: m.players.find((p) => p.id === m.winner)?.wallet ?? null }); } catch (err) { console.error("chess stake result", err); }
    this.emit(m);
  }
  private record(m: Match) {
    const [a, b] = m.players as [Player, Player];
    const score = m.winner === a.id ? 1 : m.winner === b.id ? 0 : .5;
    const delta = keyOf(a) === keyOf(b) ? 0 : Math.round(24 * (score - 1 / (1 + 10 ** ((b.rating - a.rating) / 400))));
    for (const [p, d] of [[a, delta], [b, -delta]] as const) {
      const key = keyOf(p), old = this.boards.ratings.find((r) => r.key === key);
      const r = old ?? { key, name: p.name, rating: 1200, games: 0, wins: 0, at: 0 };
      // Apply the match's expected-score change to the latest rating if another game settled first.
      r.rating += d; r.games++; r.wins += Number(m.winner === p.id); r.at = this.now(); p.rating = r.rating;
      if (!old) this.boards.ratings.push(r);
      this.boards.results.push({ key, at: this.now(), win: m.winner === p.id });
    }
    this.boards.results = this.boards.results.filter((r) => r.at > this.now() - 86_400_000);
    if (this.file) try { mkdirSync(dirname(this.file), { recursive: true }); writeFileSync(`${this.file}.tmp`, JSON.stringify(this.boards)); renameSync(`${this.file}.tmp`, this.file); } catch (err) { console.error("chess board", err); }
  }
  board() {
    const rows = [...this.boards.ratings].sort((a, b) => b.rating - a.rating || b.wins - a.wins);
    const publicRow = (r: Rating) => ({ name: r.name, rating: r.rating, games: r.games, wins: r.wins });
    return { best: rows.slice(0, 10).map(publicRow), board: rows.filter((r) => this.boards.results.some((g) => g.key === r.key && g.at > this.now() - 86_400_000)).slice(0, 10).map((r) => {
      const games = this.boards.results.filter((g) => g.key === r.key && g.at > this.now() - 86_400_000);
      return { ...publicRow(r), games: games.length, wins: games.filter((g) => g.win).length };
    }) };
  }
  tick() {
    for (const m of this.matches.values()) {
      // a staked game not started by its deadline: played by whoever came, a draw if nobody did
      if (m.escrow && !m.startedAt && !m.done && m.showBy !== undefined && this.now() >= m.showBy) {
        if (m.players.some((p) => p.streams > 0)) this.start(m);
        else { m.startedAt = this.now(); this.end(m, null, "abandonment"); }
      }
      this.check(m);
      if (!m.done && m.startedAt) this.emit(m);
      if ((!m.startedAt && this.now() - m.createdAt > 600_000) || (m.endedAt !== null && this.now() - m.endedAt > 3_600_000)) {
        m.done = true; this.emit(m); this.waiting.get(m.tc)?.delete(m.id); this.matches.delete(m.id); this.listeners.delete(m.id);
      }
    }
  }
}
export const chess = new ChessGames();
setInterval(() => chess.tick(), 250).unref();
