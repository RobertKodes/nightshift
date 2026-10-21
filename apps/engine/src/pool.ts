import { randomBytes, randomInt, randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { LOUNGE_GRACE_MS, LOUNGE_WAIT_MS, LoungeError, OwnGameError, type Expired } from "./chess.js";
import { config } from "./config.js";
import { publicName, walletHandle } from "./names.js";
import { type Ball, type Frame, HEAD_Y, POCKETED, type Shot, STILL, fits, isInt, simulate, validShot } from "./pool/physics.js";
import { type Call, type Choice, type Options, QUICK, type Rack, type Seat, type Verdict, WPA, badCall, decide as rulesDecide, defaultChoice, newRack, onEight, standing, summarize, targets, timeFoul, judge } from "./pool/rules.js";

/**
 * NIGHT POOL duels: 8-ball for two players, the WPA rules, on a table the server alone plays. A
 * player sends a shot (aim, power, where the tip strikes, the cue's elevation, the call, the cue
 * ball if it is in hand); the server checks it, simulates it with the deterministic physics
 * (pool/physics.ts), judges it with the rules (pool/rules.ts) and sends both players and every
 * spectator the same keyframes to replay, the verdict and the next turn. Nothing a browser says
 * about where a ball went is ever read. Queue games are free and rated (Elo); a game for IMD or
 * $SHIFT is made by the challenge lobby once both stakes are in GameEscrow (createStaked), and its
 * result goes to the escrow. Built like NIGHT CHESS (chess.ts): the same lounge, seats, reconnects
 * and spectators.
 */
export type Rules = "wpa" | "quick";
const OPTIONS: Record<Rules, Options> = { wpa: WPA, quick: QUICK };
/** The shot clock: per shot, a little more with the cue ball in hand, more for the break; a choice after the break has its own. */
export const SHOT_MS = 40_000, IN_HAND_MS = 50_000, BREAK_MS = 50_000, DECIDE_MS = 25_000;
/** How long the server lets a shot's replay run before the next shot's clock starts (a long tail is played faster). */
export const REPLAY_MS = 12_000;
/** A free game: a player away (no open stream) this long on their own turn loses by abandonment. */
export const AWAY_MS = 45_000;
/**
 * A staked game starts only once both players are connected (both see the countdown). If they have
 * not both been at the table within this long after it was made, it is void: both stakes go back.
 */
export const STAKED_SHOW_MS = 15 * 60_000;
/** A staked game's countdown, from both players at the table to the break's clock. */
export const STAKED_COUNTDOWN_MS = 10_000;
/** A staked game: each player's reconnection time on their own turns, for the whole game; past it they lose by abandonment (void if they never shot). */
export const STAKED_GRACE_MS = 2 * 60_000;
/** Emotes a player may send: one every few seconds; each is shown this long. */
export const EMOTE_GAP_MS = 2_500, EMOTE_SHOW_MS = 5_000;
/** "void": a staked game nobody can fairly lose (the players were never both there, or the loser never took a shot): a draw, both stakes go back. */
export type Reason = "rack" | "resignation" | "abandonment" | "fouls" | "void";
/** What a player brings to the table (locker.ts): item ids and serials, and what their profile shows. Cosmetic only. */
export type Look = {
  cue: string; cloth: string; table: string; balls: string; frame: string; banner: string; title: string; effect: string; emotes: string[];
  serials?: Record<string, number>; level?: number; avatar?: string | null;
  /** The aim guide's length, as a share of the standard one (cue stats: at most +12%, and none in staked games). */
  guide?: number;
};
export const PLAIN_LOOK: Look = { cue: "cue-crew", cloth: "cloth-night", table: "table-shift", balls: "balls-classic", frame: "frame-none", banner: "banner-shift", title: "title-rookie", effect: "effect-sparks", emotes: ["emote-gg", "emote-nice"] };
type Player = {
  id: string; name: string; wallet: string | null; rating: number; streams: number; offlineAt: number | null; seen: boolean;
  shots: number; potted: number; look: Look; agent?: boolean;
  /** The reconnection time a staked game's player has used on their own turns. */
  graceUsed?: number;
};
type ShotRecord = { n: number; seat: Seat; at: number; shot: Shot; call: Call; start: Ball[]; frames: Frame[]; duration: number; verdict: Verdict; replayMs: number };
type Match = {
  id: string; rules: Rules; currency: "FREE" | "IMD" | "SHIFT"; createdAt: number; startedAt: number | null;
  players: Player[]; rack: Rack; version: number;
  /** When the current turn's clock starts (after the last shot's replay), and how long it runs. */
  turnAt: number; clockMs: number;
  last: ShotRecord | null; shotN: number;
  log: { n: number; seat: Seat; text: string; foul: string | null; at: number }[];
  done: boolean; winner: string | null; reason: Reason | null; endedAt: number | null;
  rematch: Set<string>; rematchId: string | null;
  aim: { seat: Seat; aim: number; power: number; spinX: number; spinY: number; elevation: number; cue: { x: number; y: number } | null; at: number } | null;
  emotes: { seat: Seat; id: string; at: number }[];
  escrow?: string; stake?: string; showBy?: number; onResult?: (r: { draw: boolean; winner: string | null }) => void;
  expired?: Expired; movedTo?: string;
  /** When the last pocketed ball or foul happened: live betting pauses briefly after it. */
  swingAt?: number;
  /** Seats that dropped the 8 on a break (for the badge). */
  eightBreak: Set<Seat>;
};
export type OpenPool = { id: string; rules: Rules; host: { name: string; rating: number; agent?: boolean; level?: number }; since: number; away: boolean; awayUntil: number | null };
type Rating = { key: string; name: string; rating: number; games: number; wins: number; at: number };
type Boards = { ratings: Rating[]; results: { key: string; at: number; win: boolean }[] };
/** A finished game, for the profiles (XP, badges) and the community: by profile key (a wallet, or tg:<pid>). */
export type PoolEvent = {
  id: string; rules: Rules; staked: boolean; reason: Reason; rated: boolean;
  players: { key: string | null; name: string; result: "win" | "loss"; potted: number; shots: number; rating: number; change: number; broke: boolean; ranOut: boolean; eightOnBreak: boolean; cleanSheet: boolean; agent?: boolean }[];
};
const ended: ((e: PoolEvent) => void)[] = [];
export const onPool = (f: (e: PoolEvent) => void) => { ended.push(f); };
export function cleanName(name: string, wallet?: string | null): string { return publicName(name, { max: 18 }) ?? walletHandle(wallet) ?? "Night crew"; }
const keyOf = (p: Pick<Player, "name" | "wallet">) => JSON.stringify([p.name.toLowerCase(), p.wallet?.toLowerCase() ?? ""]);
const other = (s: Seat): Seat => (s === 0 ? 1 : 0);

/** The shot a client posts, checked field by field. */
export type ShotInput = { aim?: unknown; power?: unknown; spinX?: unknown; spinY?: unknown; elevation?: unknown; call?: unknown; cue?: unknown };
function parseCall(v: unknown): Call {
  if (v === null || v === undefined) return null;
  if (v === "safety") return "safety";
  const c = v as { ball?: unknown; pocket?: unknown };
  if (typeof v !== "object" || !isInt(c.ball, 1, 15) || !isInt(c.pocket, 0, 5)) throw new LoungeError(400, "Call one ball (1–15) and one pocket (0–5), or a safety.");
  return { ball: c.ball, pocket: c.pocket };
}
function parseShot(i: ShotInput): Shot {
  const s = { aim: i.aim, power: i.power, spinX: i.spinX ?? 0, spinY: i.spinY ?? 0, elevation: i.elevation ?? 0 } as Shot;
  if (!validShot(s)) throw new LoungeError(400, "That shot is outside the limits: aim 0–359999, power 0–1000, the tip within half a radius of the centre, elevation 0–60°.");
  return s;
}

/** Separate stores let tests play complete games without touching the live board. */
export class PoolGames {
  private matches = new Map<string, Match>();
  private listeners = new Map<string, Set<() => void>>();
  private boards: Boards = { ratings: [], results: [] };
  constructor(private file: string | null = join(config.dataDir, "pool.json"), private now = () => Date.now(), private looks: (key: string | null, staked: boolean) => Look = () => PLAIN_LOOK, private seed = () => randomInt(2 ** 31)) {
    try {
      if (file && existsSync(file)) {
        const d = JSON.parse(readFileSync(file, "utf8"));
        if (Array.isArray(d.ratings) && Array.isArray(d.results)) this.boards = d;
      }
    } catch { /* an unreadable board must not keep the tables closed */ }
  }
  /** Profiles and cosmetics plug in here (locker.ts): a player's look by profile key. */
  setLooks(f: (key: string | null, staked: boolean) => Look): void { this.looks = f; }
  private emit(m: Match) { m.version++; for (const f of this.listeners.get(m.id) ?? []) f(); }
  private match(id: string) { const m = this.matches.get(id); if (!m) throw new LoungeError(404, "No such table"); return m; }
  private player(m: Match, id: string) { const p = m.players.find((x) => x.id === id); if (!p) throw new LoungeError(404, "No such player"); return p; }
  private seatOf(m: Match, p: Player): Seat { return m.players.indexOf(p) === 0 ? 0 : 1; }
  private rating(p: Pick<Player, "name" | "wallet">) { return this.boards.ratings.find((r) => r.key === keyOf(p))?.rating ?? 1200; }
  private newPlayer(name: string, wallet: string | null, agent = false, staked = false): Player {
    const look = this.safeLook(wallet, staked);
    // a guest (no profile) gets one of the crew frogs at random
    if (!look.avatar) look.avatar = `/games/pinball/frog-${randomInt(5)}.webp`;
    const p: Player = { id: randomUUID(), name: cleanName(name, wallet), wallet: wallet ? wallet.toLowerCase() : null, rating: 1200, streams: 0, offlineAt: this.now(), seen: false, shots: 0, potted: 0, look, ...(agent ? { agent: true } : {}) };
    p.rating = this.rating(p);
    return p;
  }
  private safeLook(key: string | null, staked: boolean): Look { try { return { ...this.looks(key ? key.toLowerCase() : null, staked) }; } catch { return { ...PLAIN_LOOK }; } }
  private create(rules: Rules, players: Player[], staked?: Pick<Match, "currency" | "escrow" | "stake" | "showBy" | "onResult">): Match {
    const now = this.now();
    const m: Match = { ...staked, id: randomBytes(10).toString("hex"), rules, currency: staked?.currency ?? "FREE", createdAt: now, startedAt: null, players,
      rack: newRack(this.seed(), randomInt(2) as Seat), version: 0, turnAt: now, clockMs: BREAK_MS, last: null, shotN: 0, log: [],
      done: false, winner: null, reason: null, endedAt: null, rematch: new Set(), rematchId: null, aim: null, emotes: [], eightBreak: new Set() };
    this.matches.set(m.id, m);
    if (players.length === 2 && !m.escrow) this.start(m);
    return m;
  }
  /** The lag (1.2) decided by lot: a short countdown, then the breaker's clock. */
  private start(m: Match) { m.startedAt = this.now() + (m.escrow ? STAKED_COUNTDOWN_MS : 5_000); m.turnAt = m.startedAt; m.clockMs = BREAK_MS; this.emit(m); }
  /** How long a player has been away on their own turn (0: here, not their turn, or the turn's clock has not started). */
  private away(m: Match, p: Player) {
    const now = this.now(), r = m.rack;
    if (m.done || !m.startedAt || now < m.startedAt || now < m.turnAt || p.offlineAt === null || m.players[r.decision ? r.decision.by : r.turn] !== p) return 0;
    return Math.max(0, now - Math.max(p.offlineAt, m.turnAt));
  }
  /** How long a player may be away on their turn: what is left of a staked game's grace, else the free game's limit. */
  private allowance(m: Match, p: Player) { return m.escrow ? Math.max(0, STAKED_GRACE_MS - (p.graceUsed ?? 0)) : AWAY_MS; }
  /** A staked game: time away on one's own turn is booked against the grace when the player is back, or when the turn passes. */
  private book(m: Match, p: Player | undefined) { if (m.escrow && p) p.graceUsed = (p.graceUsed ?? 0) + this.away(m, p); }
  private isOpen(m: Match) { return !m.done && !m.startedAt && !m.escrow && m.players.length === 1; }
  private joinable(m: Match) { return this.isOpen(m) && m.players[0]!.streams > 0 && this.now() - m.createdAt <= LOUNGE_WAIT_MS; }
  private sameWallet(m: Match, wallet: string | null) { const w = m.players[0]?.wallet; return !!wallet && !!w && w.toLowerCase() === wallet.toLowerCase(); }
  private own(m: Match, wallet: string | null, agent: boolean) { return !agent && !m.players[0]!.agent && this.sameWallet(m, wallet); }
  private openGames() { return [...this.matches.values()].filter((m) => this.isOpen(m)).sort((a, b) => a.createdAt - b.createdAt); }
  private seat(m: Match, p: Player) { m.players.push(p); this.start(m); }

  /**
   * Find a rival, or open a table in the lounge: the longest wait on the same rules is served first.
   * A wallet with an open table of its own is told so, instead of waiting on itself.
   */
  queue(name: string, wallet: string | null, rules: Rules = "wpa", agent = false) {
    if (!Object.hasOwn(OPTIONS, rules)) throw new LoungeError(400, "Choose WPA or quick rules");
    if (this.matches.size >= 10_000) throw new LoungeError(503, "The pool hall is full. Try again shortly.");
    const open = this.openGames();
    if (open.some((m) => this.own(m, wallet, agent))) throw new OwnGameError();
    const p = this.newPlayer(name, wallet, agent);
    for (const m of open) {
      if (!this.joinable(m) || this.sameWallet(m, wallet) || m.rules !== rules) continue;
      this.seat(m, p);
      return { match: this.view(m, p.id), player: p.id };
    }
    const m = this.create(rules, [p]);
    return { match: this.view(m, p.id), player: p.id };
  }
  /** Sit down at one open table from the lounge, by its id (the queue's checks). */
  join(id: string, name: string, wallet: string | null, agent = false) {
    const m = this.matches.get(id);
    if (!m || m.escrow) throw new LoungeError(404, "This table is not in the lounge any more.");
    if (m.startedAt || m.players.length > 1) throw new LoungeError(409, "Someone else just took this table. Pick another one.");
    if (m.done) throw new LoungeError(410, m.expired === "timeout" ? "This table waited too long and closed." : "This table has closed.");
    if (this.sameWallet(m, wallet)) throw new OwnGameError();
    if (m.players[0]!.streams === 0) throw new LoungeError(409, "The host stepped away for a moment. Their table opens again when they are back.");
    if (!this.joinable(m)) throw new LoungeError(410, "This table waited too long and closed.");
    for (const o of this.openGames()) if (this.own(o, wallet, agent)) { o.done = true; o.endedAt = this.now(); this.emit(o); }
    const p = this.newPlayer(name, wallet, agent);
    this.seat(m, p);
    return { match: this.view(m, p.id), player: p.id };
  }
  cancel(id: string, me: string | null, wallet: string | null) {
    const m = this.matches.get(id);
    if (!m || !this.isOpen(m)) throw new LoungeError(404, "This table is not open any more.");
    if (!(me && m.players[0]!.id === me) && !this.sameWallet(m, wallet)) throw new LoungeError(403, "Only the player who opened this table can close it.");
    m.done = true; m.endedAt = this.now(); this.emit(m);
  }
  /** The lounge: each open table (its host's public name, rating and level only), how many wait, and the wallet's own. */
  lounge(wallet: string | null = null): { open: OpenPool[]; waiting: number; mine: string[] } {
    const open: OpenPool[] = [], mine: string[] = [];
    let waiting = 0;
    for (const m of this.openGames()) {
      const host = m.players[0]!, away = host.streams === 0;
      if (!away) waiting++;
      if (this.sameWallet(m, wallet)) mine.push(m.id);
      if (open.length < 100) open.push({ id: m.id, rules: m.rules, host: { name: host.name, rating: host.rating, ...(host.look.level ? { level: host.look.level } : {}), ...(host.agent ? { agent: true } : {}) }, since: m.createdAt, away, awayUntil: away && host.offlineAt !== null ? host.offlineAt + LOUNGE_GRACE_MS : null });
    }
    return { open, waiting, mine };
  }
  /**
   * A game for a stake held in GameEscrow, for exactly these two wallets: WPA rules, the lot
   * decides the break. It starts once both are connected (after a countdown); if they are not both
   * there within STAKED_SHOW_MS it is void (both stakes go back). Away on one's turn, a player has
   * STAKED_GRACE_MS in all to come back; one who never took a shot never loses a stake that way.
   */
  createStaked(o: { escrow: string; currency: "IMD" | "SHIFT"; stake: string; a: { wallet: string; name: string; agent?: boolean }; b: { wallet: string; name: string; agent?: boolean }; onResult: (r: { draw: boolean; winner: string | null }) => void }): { id: string; seats: Record<string, string> } {
    const a = this.newPlayer(o.a.name, o.a.wallet, o.a.agent, true), b = this.newPlayer(o.b.name, o.b.wallet, o.b.agent, true);
    const m = this.create("wpa", [a, b], { currency: o.currency, escrow: o.escrow, stake: o.stake, showBy: this.now() + STAKED_SHOW_MS, onResult: o.onResult });
    return { id: m.id, seats: { [a.wallet!]: a.id, [b.wallet!]: b.id } };
  }

  // ---- the table

  private replayMs(duration: number) { return Math.min(duration * 1000, REPLAY_MS) + 700; }
  private clockFor(r: Rack) { return r.decision ? DECIDE_MS : r.phase === "break" ? BREAK_MS : r.inHand !== "none" ? IN_HAND_MS : SHOT_MS; }
  private status(m: Match) {
    const now = this.now();
    return m.done ? "finished" as const : !m.startedAt ? "waiting" as const : now < m.startedAt ? "countdown" as const : "playing" as const;
  }
  /** The whole view of a table for one seat (or nobody's: a spectator). `since` is the last shot the reader has the keyframes of. */
  private view(m: Match, me: string, since = -1) {
    const now = this.now(), r = m.rack, st = standing(r), mine = m.players.find((p) => p.id === me);
    const you = mine ? this.seatOf(m, mine) : null;
    const last = m.last ? { n: m.last.n, seat: m.last.seat, at: m.last.at, call: m.last.call, duration: m.last.duration, replayMs: m.last.replayMs, verdict: m.last.verdict, shot: m.last.shot,
      ...(m.last.n > since ? { start: m.last.start, frames: m.last.frames } : {}) } : null;
    return {
      id: m.id, rules: m.rules, currency: m.currency, stake: m.stake ?? null, escrow: m.escrow ?? null, version: m.version, now, startedAt: m.startedAt, status: this.status(m),
      balls: r.balls, turn: r.turn, breaker: r.breaker, phase: r.phase, groups: r.groups, inHand: r.inHand, fouls: r.fouls, decision: r.decision, racks: r.racks,
      targets: m.done ? [] : targets(r), onEight: [onEight(r, 0), onEight(r, 1)], left: st.left, headY: HEAD_Y,
      clock: { turnAt: m.turnAt, ms: m.clockMs, deadline: m.turnAt + m.clockMs },
      last, log: m.log.slice(-14),
      aim: m.aim && m.aim.seat !== you && !m.done ? m.aim : null,
      emotes: m.emotes.filter((e) => now - e.at < EMOTE_SHOW_MS),
      done: m.done, reason: m.reason, rackReason: r.reason,
      winner: m.winner ? this.seatOf(m, this.player(m, m.winner)) : null, winnerIsYou: !!me && m.winner === me,
      you, rematchRequested: m.rematch.has(me), rivalWantsRematch: m.players.some((p) => p.id !== me && m.rematch.has(p.id)), rematchId: m.rematchId,
      waitingSince: m.createdAt, expired: m.expired ?? null, movedTo: m.movedTo ?? null, showBy: m.showBy ?? null,
      players: m.players.map((p, i) => {
        // away on their own turn: when they lose by abandonment, for both to see; a staked game's grace left
        const away = this.away(m, p), out = p.offlineAt !== null && !m.done && !!m.startedAt && now >= m.startedAt && now >= m.turnAt && m.players[r.decision ? r.decision.by : r.turn] === p;
        return { name: p.name, seat: i as Seat, rating: p.rating, you: p.id === me, connected: p.streams > 0, group: r.groups[i as Seat], shots: p.shots, potted: p.potted, look: p.look, ...(p.agent ? { agent: true } : {}),
          awayUntil: out ? now - away + this.allowance(m, p) : null, grace: m.escrow ? Math.max(0, this.allowance(m, p) - away) : null };
      }),
    };
  }
  get(id: string, me: string, since = -1) { const m = this.match(id); this.player(m, me); this.check(m); return this.view(m, me, since); }
  /** What a spectator sees: the table, both players and every shot, as nobody's seat. */
  watchView(id: string, since = -1) {
    const m = this.match(id); this.check(m);
    const v = this.view(m, "", since);
    return { ...v, escrow: null, you: null, winnerIsYou: false, rematchRequested: false, rivalWantsRematch: false, rematchId: null, aim: m.aim && !m.done ? m.aim : null };
  }
  listen(id: string, me: string, f: () => void): () => void {
    const m = this.match(id), p = this.player(m, me);
    const set = this.listeners.get(id) ?? new Set(); set.add(f); this.listeners.set(id, set);
    this.check(m);
    if (!p.streams) this.book(m, p);
    p.streams++; p.offlineAt = null; p.seen = true;
    if (m.escrow && !m.startedAt && !m.done && m.players.every((x) => x.streams > 0)) this.start(m); else this.emit(m);
    let closed = false;
    return () => { if (closed) return; closed = true; set.delete(f); p.streams = Math.max(0, p.streams - 1); if (!p.streams) p.offlineAt = this.now(); this.emit(m); };
  }
  watch(id: string, f: () => void): () => void {
    this.match(id);
    const set = this.listeners.get(id) ?? new Set(); set.add(f); this.listeners.set(id, set);
    return () => { set.delete(f); };
  }
  /** The tables being played now, for the spectators' list: names, ratings and levels only. */
  live() {
    return [...this.matches.values()].filter((m) => !m.done && m.startedAt !== null && m.players.length === 2).map((m) => ({
      id: m.id, rules: m.rules, currency: m.currency, stake: m.stake ?? null, startedAt: m.startedAt!,
      players: m.players.map((p) => ({ name: p.name, rating: p.rating, ...(p.agent ? { agent: true } : {}) })),
    }));
  }
  /** What live betting needs, never sent to a browser: the stake, both wallets, the standing, a shot still rolling. */
  betInfo(id: string) {
    const m = this.match(id); this.check(m);
    const st = standing(m.rack), now = this.now();
    return {
      escrow: m.escrow ?? null, currency: m.currency, stake: m.stake ?? "0", status: this.status(m), names: m.players.map((p) => p.name) as [string, string?],
      wallets: m.players.map((p) => p.wallet) as (string | null)[], connected: m.players.map((p) => p.streams > 0), left: st.left, eight: st.eight,
      groups: m.rack.groups, turn: m.rack.turn, phase: m.rack.phase, shots: m.shotN, rolling: now < m.turnAt, swingAt: m.swingAt ?? null, deciding: !!m.rack.decision,
      pocketed: m.rack.balls.filter((b) => b.id > 0 && b.s === POCKETED).length,
      done: m.done, winner: m.winner ? this.seatOf(m, this.player(m, m.winner)) : null, draw: m.done && !m.winner, reason: m.reason,
    };
  }

  private mustPlay(m: Match, p: Player) {
    this.check(m);
    if (m.done) throw new LoungeError(409, "The game has ended.");
    if (!m.startedAt || this.now() < m.startedAt) throw new LoungeError(409, "The game has not started.");
    if (this.seatOf(m, p) !== m.rack.turn && !(m.rack.decision && m.rack.decision.by === this.seatOf(m, p))) throw new LoungeError(409, "It is your rival's turn.");
    if (this.now() < m.turnAt) throw new LoungeError(409, "The balls are still rolling.");
  }
  /**
   * A shot. Checked (the turn, the clock, the limits, the call, the cue ball placed where the rules
   * allow and touching nothing), then simulated and judged here. Returns the table with the shot's
   * keyframes for the replay.
   */
  shot(id: string, me: string, input: ShotInput) {
    const m = this.match(id), p = this.player(m, me);
    this.mustPlay(m, p);
    const r = m.rack, seat = this.seatOf(m, p), o = OPTIONS[m.rules];
    if (r.decision) throw new LoungeError(409, "Choose first: " + (r.decision.kind === "illegal-break" ? "accept the table or re-rack." : "spot the 8-ball or break again."));
    const shot = parseShot(input), call = parseCall(input.call);
    const bad = badCall(r, call, o);
    if (bad) throw new LoungeError(400, bad);
    const start = r.balls.map((b) => ({ ...b }));
    const cue = start.find((b) => b.id === 0)!;
    if (r.inHand !== "none") {
      const c = input.cue as { x?: unknown; y?: unknown } | undefined;
      const x = Number(c?.x), y = Number(c?.y);
      if (!c || !Number.isFinite(x) || !Number.isFinite(y)) throw new LoungeError(400, "Place the cue ball: it is in hand.");
      const q = { x: Math.round(x * 10_000) / 10_000, y: Math.round(y * 10_000) / 10_000 };
      if (r.inHand === "kitchen" && !(q.y < HEAD_Y)) throw new LoungeError(400, "The cue ball goes behind the head string (in the kitchen).");
      if (!fits(start, 0, q.x, q.y)) throw new LoungeError(400, "The cue ball must sit on the cloth without touching another ball.");
      Object.assign(cue, { x: q.x, y: q.y, vx: 0, vy: 0, wx: 0, wy: 0, wz: 0, s: STILL });
    } else if (cue.s === POCKETED) throw new LoungeError(409, "The cue ball is not on the table.");
    const result = simulate(start, shot);
    const before: Rack = { ...r, balls: start };
    const { rack, verdict } = judge(before, call, result.balls, summarize(start, result.frames), o);
    m.shotN++;
    const replayMs = this.replayMs(result.duration);
    m.last = { n: m.shotN, seat, at: this.now(), shot, call, start, frames: result.frames, duration: result.duration, verdict, replayMs };
    m.log.push({ n: m.shotN, seat, text: verdict.text, foul: verdict.foul, at: this.now() });
    if (m.log.length > 40) m.log.shift();
    this.book(m, p);
    p.shots++; p.potted += verdict.pocketed.filter((id) => id !== 8 && (rack.groups[seat] === null || this.groupHas(rack.groups[seat]!, id))).length;
    if (verdict.foul || verdict.pocketed.length) m.swingAt = this.now();
    if (rack.decision?.kind === "eight-break" || rack.decision?.kind === "eight-break-foul") m.eightBreak.add(seat);
    m.rack = rack; m.aim = null;
    m.turnAt = this.now() + replayMs; m.clockMs = this.clockFor(rack);
    if (rack.phase === "over" && rack.winner !== null) this.end(m, rack.winner, "rack");
    else this.emit(m);
    return this.view(m, me);
  }
  private groupHas(g: "solids" | "stripes", id: number) { return g === "solids" ? id >= 1 && id <= 7 : id >= 9 && id <= 15; }
  /** The shooter's aim as they line up (shown to the rival and to spectators, live): cosmetic, never used to play. */
  aim(id: string, me: string, input: ShotInput) {
    const m = this.match(id), p = this.player(m, me);
    if (m.done || !m.startedAt || this.now() < m.turnAt || this.seatOf(m, p) !== m.rack.turn || m.rack.decision) return;
    const s = { aim: input.aim, power: input.power ?? 0, spinX: input.spinX ?? 0, spinY: input.spinY ?? 0, elevation: input.elevation ?? 0 } as Shot;
    if (!validShot(s)) return;
    const c = input.cue as { x?: unknown; y?: unknown } | undefined;
    const cue = m.rack.inHand !== "none" && c && Number.isFinite(Number(c.x)) && Number.isFinite(Number(c.y)) ? { x: Number(c.x), y: Number(c.y) } : null;
    m.aim = { seat: this.seatOf(m, p), ...s, cue, at: this.now() };
    this.emit(m);
  }
  /** The choice the rules gave this player after a break (accept, re-rack, spot the 8). */
  decide(id: string, me: string, choice: string) {
    const m = this.match(id), p = this.player(m, me);
    this.mustPlay(m, p);
    const d = m.rack.decision;
    if (!d || d.by !== this.seatOf(m, p)) throw new LoungeError(409, "There is no choice for you to make.");
    if (!["accept", "rebreak", "rebreak-other", "spot"].includes(choice)) throw new LoungeError(400, "That is not one of the options.");
    try { this.choose(m, choice as Choice); } catch (e) { throw new LoungeError(400, (e as Error).message); }
    return this.view(m, me);
  }
  private choose(m: Match, choice: Choice) {
    const d = m.rack.decision!, racks = m.rack.racks;
    this.book(m, m.players[d.by]);
    m.rack = rulesDecide(m.rack, d.by, choice);
    const what = choice === "accept" ? "accepts the table" : choice === "spot" ? "spots the 8-ball" : choice === "rebreak" ? "re-racks and breaks" : "re-racks; the breaker breaks again";
    m.log.push({ n: m.shotN, seat: d.by, text: `${m.players[d.by]?.name ?? "Player"} ${what}.`, foul: null, at: this.now() });
    if (m.rack.racks !== racks) m.last = null;
    m.turnAt = this.now(); m.clockMs = this.clockFor(m.rack);
    this.emit(m);
  }
  resign(id: string, me: string) {
    const m = this.match(id), p = this.player(m, me); this.check(m);
    if (!m.startedAt) throw new LoungeError(409, "No rival yet");
    if (!m.done) this.end(m, other(this.seatOf(m, p)), "resignation");
    return this.view(m, me);
  }
  leave(id: string, me: string) {
    const m = this.match(id); this.player(m, me);
    if (m.escrow) throw new LoungeError(409, "A staked game starts once both players are at the table; if you are not both here within 15 minutes it is void and both stakes go back. Stay at the table.");
    if (m.startedAt) throw new LoungeError(409, "The rival joined. Resign to leave this game.");
    m.done = true; m.endedAt = this.now(); this.emit(m);
  }
  rematch(id: string, me: string) {
    const m = this.match(id); this.player(m, me);
    if (!m.done || !m.startedAt) throw new LoungeError(409, "Finish this game first");
    if (m.escrow) throw new LoungeError(409, "A staked game has no rematch: open a new challenge.");
    if (!m.rematchId) {
      m.rematch.add(me);
      if (m.rematch.size === 2) {
        const next = this.create(m.rules, m.players.map((p) => ({ ...p, rating: this.rating(p), streams: 0, offlineAt: this.now(), seen: false, shots: 0, potted: 0, look: this.safeLook(p.wallet, false) })));
        // the other player breaks the next rack (1.3, alternating)
        next.rack = newRack(this.seed(), other(m.rack.breaker));
        m.rematchId = next.id;
      }
      this.emit(m);
    }
    return this.view(m, me);
  }
  /** An emote from the player's own set (owned in the locker), shown to the table for a few seconds. */
  emote(id: string, me: string, emote: string) {
    const m = this.match(id), p = this.player(m, me);
    if (!p.look.emotes.includes(emote)) throw new LoungeError(403, "That emote is not in your set.");
    const seat = this.seatOf(m, p), lastAt = m.emotes.filter((e) => e.seat === seat).at(-1)?.at ?? 0;
    if (this.now() - lastAt < EMOTE_GAP_MS) throw new LoungeError(429, "One emote at a time.");
    m.emotes.push({ seat, id: emote, at: this.now() });
    if (m.emotes.length > 8) m.emotes.shift();
    this.emit(m);
  }

  // ---- clocks, abandonment, the end

  private check(m: Match) {
    if (m.done || !m.startedAt || this.now() < m.startedAt || this.now() < m.turnAt) return;
    const r = m.rack, seat = r.decision ? r.decision.by : r.turn, p = m.players[seat]!;
    if (p.streams === 0 && p.offlineAt !== null && this.away(m, p) > this.allowance(m, p)) { this.end(m, other(seat), "abandonment"); return; }
    if (this.now() < m.turnAt + m.clockMs) return;
    if (r.decision) { this.choose(m, defaultChoice(r.decision)); return; }
    this.book(m, p);
    // the shot clock ran out: a standard foul (3.14), the cue ball in hand to the opponent
    const { rack, verdict } = timeFoul(r, OPTIONS[m.rules]);
    m.log.push({ n: m.shotN, seat, text: verdict.text, foul: "time", at: this.now() });
    m.rack = rack; m.aim = null; m.swingAt = this.now();
    m.turnAt = this.now(); m.clockMs = this.clockFor(rack);
    if (rack.phase === "over" && rack.winner !== null) this.end(m, rack.winner, "fouls"); else this.emit(m);
  }
  private end(m: Match, winner: Seat | null, reason: Reason) {
    if (m.done) return;
    // a staked game is never lost by a player who never took a shot (away from the start, or only out of time): void, both stakes go back
    if (m.escrow && winner !== null && (reason === "abandonment" || reason === "fouls") && m.players[other(winner)]?.shots === 0) { winner = null; reason = "void"; }
    m.done = true; m.reason = reason; m.endedAt = this.now(); m.aim = null;
    m.winner = winner === null ? null : m.players[winner]?.id ?? null;
    if (reason === "rack" && m.rack.reason?.startsWith("Three fouls")) m.reason = "fouls";
    const rated = m.players.length === 2 && m.players.every((p) => p.seen) && m.shotN >= 2;
    const before = m.players.map((p) => p.rating);
    if (rated) this.record(m);
    const r = m.rack;
    // a break and run: the breaker won the rack and the opponent never came to the table
    const ranOut = reason === "rack" && winner !== null && r.breaker === winner && m.log.every((l) => l.seat === winner);
    for (const f of ended) try {
      f({ id: m.id, rules: m.rules, staked: !!m.escrow, reason: m.reason!, rated, players: m.players.map((p, i) => ({
        key: p.wallet, name: p.name, result: m.winner === p.id ? "win" : "loss", potted: p.potted, shots: p.shots, rating: p.rating, change: p.rating - before[i]!,
        broke: r.breaker === i, ranOut: ranOut && m.winner === p.id, eightOnBreak: m.eightBreak.has(i as Seat),
        cleanSheet: m.winner === p.id && reason === "rack" && standing(r).left[other(i as Seat)] === 7 && r.groups[other(i as Seat)] !== null,
        ...(p.agent ? { agent: true } : {}),
      })) });
    } catch (e) { console.error("pool event", e); }
    // the server's verdict of a staked game, by wallet, to the escrow (signed there after its own checks)
    if (m.onResult) try { m.onResult({ draw: m.winner === null, winner: m.players.find((p) => p.id === m.winner)?.wallet ?? null }); } catch (e) { console.error("pool stake result", e); }
    this.emit(m);
  }
  private record(m: Match) {
    const [a, b] = m.players as [Player, Player];
    const score = m.winner === a.id ? 1 : m.winner === b.id ? 0 : 0.5;
    const delta = keyOf(a) === keyOf(b) ? 0 : Math.round(24 * (score - 1 / (1 + 10 ** ((b.rating - a.rating) / 400))));
    for (const [p, d] of [[a, delta], [b, -delta]] as const) {
      const key = keyOf(p), old = this.boards.ratings.find((r) => r.key === key);
      const r = old ?? { key, name: p.name, rating: 1200, games: 0, wins: 0, at: 0 };
      r.rating += d; r.games++; r.wins += Number(m.winner === p.id); r.at = this.now(); p.rating = r.rating;
      if (!old) this.boards.ratings.push(r);
      this.boards.results.push({ key, at: this.now(), win: m.winner === p.id });
    }
    this.boards.results = this.boards.results.filter((r) => r.at > this.now() - 86_400_000);
    if (this.file) try { mkdirSync(dirname(this.file), { recursive: true }); writeFileSync(`${this.file}.tmp`, JSON.stringify(this.boards)); renameSync(`${this.file}.tmp`, this.file); } catch (err) { console.error("pool board", err); }
  }
  board() {
    const rows = [...this.boards.ratings].sort((a, b) => b.rating - a.rating || b.wins - a.wins);
    const pub = (r: Rating) => ({ name: r.name, rating: r.rating, games: r.games, wins: r.wins });
    const night = this.now() - 86_400_000;
    return { best: rows.slice(0, 10).map(pub), board: rows.filter((r) => this.boards.results.some((g) => g.key === r.key && g.at > night)).slice(0, 10).map((r) => {
      const games = this.boards.results.filter((g) => g.key === r.key && g.at > night);
      return { ...pub(r), games: games.length, wins: games.filter((g) => g.win).length };
    }) };
  }
  /** Two open tables that could be one (same rules, different wallets, both hosts here): the newer host moves to the older table. */
  private fold() {
    const open = this.openGames().filter((m) => this.joinable(m));
    for (let i = 0; i < open.length; i++) {
      const a = open[i]!;
      for (let j = i + 1; j < open.length && this.isOpen(a); j++) {
        const b = open[j]!, mover = b.players[0]!;
        if (!this.isOpen(b) || mover.agent || this.sameWallet(a, mover.wallet) || a.rules !== b.rules) continue;
        b.done = true; b.endedAt = this.now(); b.movedTo = a.id;
        this.seat(a, mover); this.emit(b);
      }
    }
  }
  tick() {
    for (const m of this.matches.values()) {
      // a staked game whose players were never both at the table by its deadline: void, both stakes go back
      if (m.escrow && !m.startedAt && !m.done && m.showBy !== undefined && this.now() >= m.showBy) { m.startedAt = this.now(); this.end(m, null, "void"); }
      this.check(m);
      if (this.isOpen(m)) {
        const host = m.players[0]!;
        const expired: Expired | null = this.now() - m.createdAt > LOUNGE_WAIT_MS ? "timeout" : host.streams === 0 && host.offlineAt !== null && this.now() - host.offlineAt > LOUNGE_GRACE_MS ? "away" : null;
        if (expired) { m.done = true; m.expired = expired; m.endedAt = this.now(); this.emit(m); }
      }
      if ((!m.startedAt && !m.done && this.now() - m.createdAt > LOUNGE_WAIT_MS + 60_000) || (m.endedAt !== null && this.now() - m.endedAt > 3_600_000)) {
        m.done = true; this.emit(m); this.matches.delete(m.id); this.listeners.delete(m.id);
      }
    }
    this.fold();
  }
}
export const pool = new PoolGames();
setInterval(() => pool.tick(), 250).unref();
