import { randomBytes, randomInt, randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { Chess, type Color, type Move } from "chess.js";
import { config } from "./config.js";
import { publicName } from "./names.js";

/**
 * Chess duels. Moves, elapsed time and results are decided here, never by a browser. Queue games
 * are free; a game for IMD or $SHIFT is made by the challenge lobby once both stakes are in
 * GameEscrow (createStaked), and its result goes to the escrow.
 */
/** A staked game starts once both players are connected, or this long after it was made. */
export const STAKED_SHOW_MS = 5 * 60_000;
export const CONTROLS = { "3+2": { time: 180_000, increment: 2_000 }, "5+0": { time: 300_000, increment: 0 }, "10+0": { time: 600_000, increment: 0 } };
export type TimeControl = keyof typeof CONTROLS;
/** A free game for two invited players (a Telegram challenge) starts once both are here; it closes unplayed if one never comes within this. */
export const INVITE_SHOW_MS = 5 * 60_000;
/** An open free game stays in the lounge this long after its host's last stream closed (a phone asleep, a tab switch)… */
export const LOUNGE_GRACE_MS = 90_000;
/** …and at most this long in all, waiting for a rival. */
export const LOUNGE_WAIT_MS = 30 * 60_000;
/** Why an open game closed without being played: its host was away past the grace period, or nobody came. */
export type Expired = "away" | "timeout";
/** A wallet asking to play its own open game: said plainly, never a silent wait. */
export class OwnGameError extends Error {
  readonly status = 409;
  constructor() { super("This is your own game: use another wallet or play as a guest."); }
}
/** A lounge request that cannot be met (gone, taken, host away): a clear reason with an HTTP status. */
export class LoungeError extends Error { constructor(readonly status: number, message: string) { super(message); } }
export type Reason = "checkmate" | "stalemate" | "repetition" | "insufficient material" | "50-move rule" | "resignation" | "agreement" | "abandonment" | "timeout";
type Player = { id: string; name: string; wallet: string | null; color: Color; rating: number; moves: number; streams: number; offlineAt: number | null; agent?: boolean; times?: number[] };
type Match = {
  id: string; tc: TimeControl; currency: "FREE" | "IMD" | "SHIFT"; createdAt: number; startedAt: number | null; turnAt: number;
  game: Chess; players: Player[]; clocks: Record<Color, number>; moves: Move[]; version: number;
  done: boolean; winner: string | null; reason: Reason | null; drawOffer: string | null;
  rematch: Set<string>; rematchId: string | null; endedAt: number | null;
  /** A staked game: the escrow match id, the stake shown, when it starts regardless, who hears the result. */
  escrow?: string; stake?: string; showBy?: number; onResult?: (r: { draw: boolean; winner: string | null }) => void;
  /** When the last sharp move was played (a queen or rook taken, or a check): live betting pauses briefly after it. */
  sharpAt?: number;
  /** A staked game whose move times look machine-made (flagFor): for the operator to look at, nothing automatic. */
  flagged?: Flag;
  /** An open game whose host takes any time control: the first rival's sets the clock. */
  any?: boolean;
  /** An open game that closed unplayed, and why: its host is told when they come back. */
  expired?: Expired;
  /** An open game folded into an older one in the same time control: its host's stream follows there. */
  movedTo?: string;
  /** A free game for two invited players: no clock until both are connected (showBy is its deadline). */
  held?: boolean;
};
/** An open free game as the lounge lists it: the host's public name and rating only, never a seat or a wallet. */
export type OpenChess = { id: string; tc: TimeControl; any: boolean; host: { name: string; rating: number; agent?: boolean }; since: number; away: boolean; awayUntil: number | null };
/** Why a staked game was flagged: whose moves, how many, and their mean and spread in ms. */
export type Flag = { game: string; escrow: string; player: string; wallet: string | null; moves: number; meanMs: number; sdMs: number; at: number };
/** Move times are judged over at least this many of a player's moves in a staked game… */
export const FLAG_MOVES = 20;
/** …and flagged when they barely vary: a spread under this share of their mean (people think longer on some moves than others). */
export const FLAG_CV = 0.1;
/** A player's move times flag the game when, over FLAG_MOVES or more moves of at least a second on average, they barely vary. */
export function flagFor(times: number[]): { meanMs: number; sdMs: number } | null {
  if (times.length < FLAG_MOVES) return null;
  const mean = times.reduce((a, b) => a + b, 0) / times.length;
  const sd = Math.sqrt(times.reduce((a, b) => a + (b - mean) ** 2, 0) / times.length);
  // premoves and instant replies (a mean under a second) say nothing about an engine
  return mean >= 1_000 && sd < FLAG_CV * mean ? { meanMs: Math.round(mean), sdMs: Math.round(sd) } : null;
}
type Rating = { key: string; name: string; rating: number; games: number; wins: number; at: number };
type NightResult = { key: string; at: number; win: boolean };
type Boards = { ratings: Rating[]; results: NightResult[] };
/** A finished game; `keys` are the players' profile keys (a wallet, or a Telegram player's tg:<pid>) for the gaming profiles, `rated` when it counted for Elo. */
export type ChessEvent = { kind: "result"; white: string; black: string; winner: string | null; reason: Reason; moves: number; tc: TimeControl; keys: [string | null, string | null]; rated: boolean; won: Color | null };
const arcade: ((e: ChessEvent) => void)[] = [];
export const onChess = (f: (e: ChessEvent) => void) => { arcade.push(f); };
const opposite = (c: Color): Color => c === "w" ? "b" : "w";
/** A display name by the shared rule (names.ts): not one of ours however it is spelled, nothing the community guard deletes. */
export function cleanName(name: string): string {
  return publicName(name, { max: 18 }) ?? "Night crew";
}
const keyOf = (p: Pick<Player, "name" | "wallet">) => JSON.stringify([p.name.toLowerCase(), p.wallet?.toLowerCase() ?? ""]);

/** Separate stores also let tests run complete games without touching the live board. */
export class ChessGames {
  private matches = new Map<string, Match>();
  private waiting = new Map<TimeControl, Set<string>>();
  private listeners = new Map<string, Set<() => void>>();
  private boards: Boards = { ratings: [], results: [] };
  private flagList: Flag[] = [];
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
  private create(tc: TimeControl, players: Player[], staked?: Pick<Match, "currency" | "escrow" | "stake" | "showBy" | "onResult" | "held">): Match {
    const now = this.now();
    const m: Match = { ...staked, id: randomBytes(10).toString("hex"), tc, currency: staked?.currency ?? "FREE", createdAt: now, startedAt: null, turnAt: now, game: new Chess(), players,
      clocks: { w: CONTROLS[tc].time, b: CONTROLS[tc].time }, moves: [], version: 0, done: false, winner: null, reason: null, drawOffer: null, rematch: new Set(), rematchId: null, endedAt: null };
    this.matches.set(m.id, m);
    if (players.length === 2 && !m.escrow && !m.held) this.start(m);
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
  /**
   * A free game for exactly two invited players (a challenge accepted in Telegram): both seats made
   * now, each given only to its own player. The clock starts once both are connected; if one never
   * comes within INVITE_SHOW_MS the game closes unplayed (no result, no rating).
   */
  invite(tc: TimeControl, a: { name: string; wallet: string | null }, b: { name: string; wallet: string | null }): { id: string; seats: [string, string] } {
    if (!Object.hasOwn(CONTROLS, tc)) throw new Error("Choose 3+2, 5+0 or 10+0");
    if (this.matches.size >= 10_000) throw new Error("The arcade is full. Try again shortly.");
    const pa = this.newPlayer(a.name, a.wallet, false), pb = this.newPlayer(b.name, b.wallet, false);
    pb.color = opposite(pa.color);
    const m = this.create(tc, [pa, pb], { currency: "FREE", held: true, showBy: this.now() + INVITE_SHOW_MS });
    return { id: m.id, seats: [pa.id, pb.id] };
  }
  private start(m: Match) { m.startedAt = this.now() + 5_000; m.turnAt = m.startedAt; this.emit(m); }
  /** A free game waiting for its second player. */
  private isOpen(m: Match) { return !m.done && !m.startedAt && !m.escrow && m.players.length === 1; }
  /** Its host is here (an open stream) and it has not waited too long: a rival may sit down now. */
  private joinable(m: Match) { return this.isOpen(m) && m.players[0]!.streams > 0 && this.now() - m.createdAt <= LOUNGE_WAIT_MS; }
  /** A person's own open game (the same wallet): never a game against themselves, and always said. Agents of one owner just wait apart. */
  private own(m: Match, wallet: string | null, agent: boolean) { return !agent && !m.players[0]!.agent && this.sameWallet(m, wallet); }
  /** The same wallet as a person and as its own agent is no game either, but no error: each waits for someone else. */
  private sameWallet(m: Match, wallet: string | null) { const w = m.players[0]?.wallet; return !!wallet && !!w && w.toLowerCase() === wallet.toLowerCase(); }
  private unlist(m: Match) { for (const line of this.waiting.values()) line.delete(m.id); }
  private newPlayer(name: string, wallet: string | null, agent: boolean): Player {
    const p: Player = { id: randomUUID(), name: cleanName(name), wallet, color: randomInt(2) ? "w" : "b", rating: 1200, moves: 0, streams: 0, offlineAt: this.now(), ...(agent ? { agent: true } : {}) };
    p.rating = this.rating(p);
    return p;
  }
  /** The rival sits down: the other colour, the host's clock (the rival's, for a host who takes any), then the countdown. */
  private seat(m: Match, p: Player, tc: TimeControl | "any") {
    if (m.any && tc !== "any" && tc !== m.tc) { m.tc = tc; m.clocks = { w: CONTROLS[tc].time, b: CONTROLS[tc].time }; }
    m.any = false;
    p.color = opposite(m.players[0]!.color); m.players.push(p); this.unlist(m); this.start(m);
  }
  /** Open games, oldest first: the longest wait is served first. */
  private openGames() {
    return [...this.waiting.values()].flatMap((line) => [...line]).map((id) => this.matches.get(id)).filter((m): m is Match => !!m && this.isOpen(m)).sort((a, b) => a.createdAt - b.createdAt);
  }
  /**
   * Find a rival, or open a game in the lounge. `tc` "any" plays whoever waits in any time control
   * (on their clock), else opens a 3+2 game that the next rival of any time control takes on theirs.
   * A wallet that already has an open game is told so, instead of waiting on itself. `agent` marks
   * an AI player (the arena's), shown as such to spectators.
   */
  queue(name: string, wallet: string | null, tc: TimeControl | "any", agent = false) {
    if (tc !== "any" && !Object.hasOwn(CONTROLS, tc)) throw new Error("Choose 3+2, 5+0 or 10+0");
    if (this.matches.size >= 10_000) throw new Error("The arcade is full. Try again shortly.");
    const open = this.openGames();
    if (open.some((m) => this.own(m, wallet, agent))) throw new OwnGameError();
    const p = this.newPlayer(name, wallet, agent);
    for (const m of open) {
      if (!this.joinable(m) || this.sameWallet(m, wallet)) continue;
      if (tc !== "any" && !m.any && m.tc !== tc) continue;
      this.seat(m, p, tc);
      return { match: this.view(m, p.id), player: p.id };
    }
    const m = this.create(tc === "any" ? "3+2" : tc, [p]);
    if (tc === "any") m.any = true;
    const line = this.waiting.get(m.tc) ?? new Set<string>();
    this.waiting.set(m.tc, line); line.add(m.id);
    return { match: this.view(m, p.id), player: p.id };
  }
  /**
   * Sit down at one open game from the lounge, by its id. The same checks as the queue: not your own
   * wallet's, still open, its host here. The wallet's own open game elsewhere is closed first.
   */
  join(id: string, name: string, wallet: string | null, agent = false) {
    const m = this.matches.get(id);
    if (!m || m.escrow) throw new LoungeError(404, "This game is not in the lounge any more.");
    if (m.startedAt || m.players.length > 1) throw new LoungeError(409, "Someone else just took this game. Pick another one.");
    if (m.done) throw new LoungeError(410, m.expired === "timeout" ? "This game waited too long and closed." : "This game has closed.");
    if (this.sameWallet(m, wallet)) throw new OwnGameError();
    if (m.players[0]!.streams === 0) throw new LoungeError(409, "The host stepped away for a moment. Their game opens again when they are back.");
    if (!this.joinable(m)) throw new LoungeError(410, "This game waited too long and closed.");
    for (const o of this.openGames()) if (this.own(o, wallet, agent)) { o.done = true; o.endedAt = this.now(); this.unlist(o); this.emit(o); }
    const p = this.newPlayer(name, wallet, agent);
    this.seat(m, p, "any");
    return { match: this.view(m, p.id), player: p.id };
  }
  /** Close an open game from the lounge: by its host's seat token, or by the signed-in wallet that opened it. */
  cancel(id: string, me: string | null, wallet: string | null) {
    const m = this.matches.get(id);
    if (!m || !this.isOpen(m)) throw new LoungeError(404, "This game is not open any more.");
    const host = m.players[0]!;
    if (!(me && host.id === me) && !this.sameWallet(m, wallet)) throw new LoungeError(403, "Only the player who opened this game can close it.");
    m.done = true; m.endedAt = this.now(); this.unlist(m); this.emit(m);
  }
  /**
   * The lounge's free games: each open one (its host's name and rating, since when it waits, away
   * while the host's stream is gone within the grace period) and how many wait per time control (hosts who are here).
   * `mine` lists the ids the signed-in wallet opened; no wallet or seat leaves here.
   */
  lounge(wallet: string | null = null): { open: OpenChess[]; waiting: Record<TimeControl | "any", number>; mine: string[] } {
    const waiting: Record<TimeControl | "any", number> = { "3+2": 0, "5+0": 0, "10+0": 0, any: 0 };
    const open: OpenChess[] = [], mine: string[] = [];
    for (const m of this.openGames()) {
      const host = m.players[0]!, away = host.streams === 0;
      // a host who is away is listed, not counted: nobody can sit down there right now
      if (!away) waiting[m.any ? "any" : m.tc]++;
      if (this.sameWallet(m, wallet)) mine.push(m.id);
      if (open.length < 100) open.push({ id: m.id, tc: m.tc, any: !!m.any, host: { name: host.name, rating: host.rating, ...(host.agent ? { agent: true } : {}) }, since: m.createdAt, away, awayUntil: away && host.offlineAt !== null ? host.offlineAt + LOUNGE_GRACE_MS : null });
    }
    return { open, waiting, mine };
  }
  /**
   * Two open games that could be one (the same time control, or a host who takes any; different
   * wallets; both hosts here): the newer host moves to the older table and their stream follows
   * (movedTo), so two players never wait apart for each other. An agent's table never moves.
   */
  private fold() {
    const open = this.openGames().filter((m) => this.joinable(m));
    for (let i = 0; i < open.length; i++) {
      const a = open[i]!;
      for (let j = i + 1; j < open.length && this.isOpen(a); j++) {
        const b = open[j]!, mover = b.players[0]!;
        if (!this.isOpen(b) || mover.agent || this.sameWallet(a, mover.wallet)) continue;
        if (a.tc !== b.tc && !a.any && !b.any) continue;
        // a host who takes any plays on the other's clock
        const tc: TimeControl | "any" = a.any && !b.any ? b.tc : "any";
        b.done = true; b.endedAt = this.now(); b.movedTo = a.id; this.unlist(b);
        this.seat(a, mover, tc); this.emit(b);
      }
    }
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
      waitingSince: m.createdAt, any: !!m.any, expired: m.expired ?? null, movedTo: m.movedTo ?? null,
      players: m.players.map((p) => ({ name: p.name, color: p.color, rating: p.rating, you: p.id === me, connected: p.streams > 0 })) };
  }
  get(id: string, me: string, compact = false) { const m = this.match(id); this.player(m, me); this.check(m); return this.view(m, me, compact); }
  listen(id: string, me: string, f: () => void): () => void {
    const m = this.match(id), p = this.player(m, me);
    const set = this.listeners.get(id) ?? new Set(); set.add(f); this.listeners.set(id, set);
    p.streams++; p.offlineAt = null;
    if ((m.escrow || m.held) && !m.startedAt && !m.done && m.players.every((x) => x.streams > 0)) this.start(m); else this.emit(m);
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
  /**
   * What live betting needs beyond the spectator view, never sent to a browser: whether the game is
   * staked, both players' wallets (no bets from them), and the last sharp move.
   */
  betInfo(id: string): { escrow: string | null; wallets: { w: string | null; b: string | null }; sharpAt: number | null; flagged: Flag | null; drawOffer: boolean } {
    const m = this.match(id), by = (c: Color) => m.players.find((p) => p.color === c)?.wallet?.toLowerCase() ?? null;
    return { escrow: m.escrow ?? null, wallets: { w: by("w"), b: by("b") }, sharpAt: m.sharpAt ?? null, flagged: m.flagged ?? null, drawOffer: !!m.drawOffer };
  }
  /** Staked games flagged for machine-like move times, newest first: for the operator, never acted on automatically. */
  flags(): Flag[] { return [...this.flagList].reverse(); }
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
    m.done = true; m.endedAt = this.now(); this.unlist(m); this.emit(m);
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
    const took = this.now() - m.turnAt;
    m.clocks[p.color] = Math.max(0, m.clocks[p.color] - took) + CONTROLS[m.tc].increment;
    m.turnAt = this.now(); m.moves.push(move); p.moves++; if (m.drawOffer !== p.id) m.drawOffer = null;
    if (m.escrow) this.time(m, p, took);
    if (move.captured === "q" || move.captured === "r" || m.game.isCheck()) m.sharpAt = this.now();
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
  /** A staked game keeps each player's move times; machine-even ones flag the game once (no automatic action). */
  private time(m: Match, p: Player, took: number) {
    (p.times ??= []).push(took);
    if (m.flagged || p.agent) return;
    const f = flagFor(p.times);
    if (!f) return;
    m.flagged = { game: m.id, escrow: m.escrow!, player: p.name, wallet: p.wallet, moves: p.times.length, ...f, at: this.now() };
    this.flagList.push(m.flagged);
    if (this.flagList.length > 200) this.flagList.shift();
    console.warn(`chess fair play: staked game ${m.id} (escrow ${m.escrow}) flagged, ${p.name} ${p.wallet ?? ""} moved ${p.times.length} times at ${f.meanMs} ± ${f.sdMs} ms`);
  }
  private end(m: Match, winner: Color | null, reason: Reason) {
    if (m.done) return;
    m.clocks = this.clocks(m); m.done = true; m.reason = reason; m.endedAt = this.now(); m.drawOffer = null;
    m.winner = m.players.find((p) => p.color === winner)?.id ?? null;
    const rated = m.players.every((p) => p.moves >= 2);
    if (rated) this.record(m);
    const white = m.players.find((p) => p.color === "w")!, black = m.players.find((p) => p.color === "b")!;
    for (const f of arcade) try { f({ kind: "result", white: white.name, black: black.name, winner: m.winner === white.id ? white.name : m.winner === black.id ? black.name : null, reason, moves: m.moves.length, tc: m.tc, keys: [white.agent ? null : white.wallet, black.agent ? null : black.wallet], rated, won: winner }); } catch (err) { console.error("chess arcade", err); }
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
      // an invited game whose second player never came: closed unplayed, kept an hour so both are told
      if (m.held && !m.startedAt && !m.done && m.showBy !== undefined && this.now() >= m.showBy) { m.done = true; m.expired = "away"; m.endedAt = this.now(); this.emit(m); }
      // a staked game not started by its deadline: played by whoever came, a draw if nobody did
      if (m.escrow && !m.startedAt && !m.done && m.showBy !== undefined && this.now() >= m.showBy) {
        if (m.players.some((p) => p.streams > 0)) this.start(m);
        else { m.startedAt = this.now(); this.end(m, null, "abandonment"); }
      }
      this.check(m);
      if (!m.done && m.startedAt) this.emit(m);
      // an open game whose host is gone past the grace period, or that waited too long: closed, and kept
      // an hour so a host who comes back is told why
      if (this.isOpen(m)) {
        const host = m.players[0]!;
        const expired: Expired | null = this.now() - m.createdAt > LOUNGE_WAIT_MS ? "timeout" : host.streams === 0 && host.offlineAt !== null && this.now() - host.offlineAt > LOUNGE_GRACE_MS ? "away" : null;
        if (expired) { m.done = true; m.expired = expired; m.endedAt = this.now(); this.unlist(m); this.emit(m); }
      }
      if ((!m.startedAt && !m.done && this.now() - m.createdAt > LOUNGE_WAIT_MS + 60_000) || (m.endedAt !== null && this.now() - m.endedAt > 3_600_000)) {
        m.done = true; this.emit(m); this.unlist(m); this.matches.delete(m.id); this.listeners.delete(m.id);
      }
    }
    this.fold();
  }
}
export const chess = new ChessGames();
setInterval(() => chess.tick(), 250).unref();
