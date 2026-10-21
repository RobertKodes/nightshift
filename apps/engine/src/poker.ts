import { randomBytes, randomInt, randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { LOUNGE_GRACE_MS, LOUNGE_WAIT_MS, LoungeError, OwnGameError, type Expired } from "./chess.js";
import { config } from "./config.js";
import { publicName, walletHandle } from "./names.js";
import type { Look } from "./pool.js";
import { botAction, thinkMs } from "./poker/bot.js";
import type { Card } from "./poker/cards.js";
import { cleanSeed, commitOf, deckOrder, newServerSeed } from "./poker/deck.js";
import { type Action, Hand, type LogLine, type Pot, PokerError, type Result } from "./poker/hand.js";

/**
 * NIGHT POKER heads-up: a Sit & Go for two, No-Limit Texas Hold'em, 100 big blinds each, the
 * blinds rising every few minutes, until one player has every chip. The server deals, keeps the
 * stacks, the clocks and the pots (poker/hand.ts), and is the only place the deck exists: a
 * player's browser gets its own two cards and nothing else that is hidden; a spectator gets the
 * cards shown at a showdown. Each hand's deck is provably fair (poker/deck.ts): committed before
 * the deal, shuffled with both players' own seeds, every server seed revealed when the match ends.
 *
 * Queue games are free and rated (Elo, as NIGHT CHESS); practice is against Frog #7, played here
 * by the server (poker/bot.ts), never rated; a house exhibition is two frogs (never rated, staked or
 * bet on). A game for IMD or $SHIFT is made by the challenge lobby once both stakes are in
 * GameEscrow (createStaked), with the staked games' rules: it starts only once both players are at
 * the table, each has 2 minutes in all to reconnect on their own turns, and a player who never
 * acted never loses a stake (void, both stakes back). Built like NIGHT CHESS and NIGHT POOL: the
 * same lounge, seats, reconnects, spectators and profiles.
 */
export const START_STACK = 2_000;
/** Small and big blind per level; the last level stays. */
export const LEVELS: readonly (readonly [number, number])[] = [[10, 20], [15, 30], [20, 40], [30, 60], [40, 80], [50, 100], [60, 120], [80, 160], [100, 200], [150, 300], [200, 400], [300, 600], [400, 800], [500, 1_000], [750, 1_500], [1_000, 2_000]];
/** The blinds go up every LEVEL_MS of play (a new level starts with the next hand). */
export const LEVEL_MS = 3 * 60_000;
/** The shot clock: per action; past it the player's time bank runs, then a check (or a fold). */
export const ACTION_MS = 20_000;
export const BANK_MS = 45_000, BANK_ADD_MS = 5_000, BANK_EVERY = 5, BANK_MAX_MS = 60_000;
/** Between hands: the result stays up this long (longer after a showdown); each street of an all-in run-out turns this long after the last. */
export const HAND_GAP_MS = 2_500, SHOWDOWN_MS = 5_000, RUNOUT_MS = 1_400;
/** A free game: a player away (no open stream) this long in all on their own turns loses by abandonment. */
export const AWAY_MS = 45_000;
/** Staked: the start waits for both players (void if they are not both here within this long); a 10 s countdown; 2 minutes in all to reconnect. */
export const STAKED_SHOW_MS = 15 * 60_000, STAKED_COUNTDOWN_MS = 10_000, STAKED_GRACE_MS = 2 * 60_000;
export const EMOTE_GAP_MS = 2_500, EMOTE_SHOW_MS = 5_000;
/** The house frog in practice and exhibitions, and its rivals. */
export const FROG = "Frog #7";
/** "busted": one player has every chip. "void": a staked game nobody can fairly lose. "paused": a house exhibition stepped aside. */
export type Reason = "busted" | "resignation" | "abandonment" | "void" | "paused";
const PLAIN: Look = { cue: "cue-crew", cloth: "cloth-night", table: "table-shift", balls: "balls-classic", frame: "frame-none", banner: "banner-shift", title: "title-rookie", effect: "effect-sparks", emotes: ["emote-gg", "emote-nice", "emote-oops"] };
type Seat = 0 | 1;
const other = (s: Seat): Seat => (s === 0 ? 1 : 0);

type Player = {
  id: string; name: string; wallet: string | null; rating: number; streams: number; offlineAt: number | null; seen: boolean; look: Look;
  agent?: boolean;
  /** A house frog: the server plays it, it is never away. */
  bot?: boolean;
  /** Actions the player chose (not the clock's); a staked player with none never loses the stake. */
  acted: number; timeouts: number;
  /** The time bank, and the reconnection time used on the player's own turns. */
  bank: number; graceUsed: number;
  /** The client seed this player's browser sent, by hand number. */
  seeds: Map<number, string>;
};
/** A finished (or cut-off) hand as the history keeps it: the seed is shown once the match is over. */
type HandRecord = {
  n: number; button: Seat; blinds: [number, number]; commit: string; serverSeed: string; clientSeeds: string[];
  stacks: [number, number]; board: Card[]; hole: [Card[], Card[]]; shown: Seat[]; log: LogLine[];
  pots: Pot[]; won: { [seat: number]: number }; uncalled: Result["uncalled"]; hands: Result["hands"]; showdown: boolean; at: number; cut?: boolean;
};
type Match = {
  id: string; currency: "FREE" | "IMD" | "SHIFT"; createdAt: number; startedAt: number | null; players: Player[]; version: number;
  stacks: [number, number]; button: Seat; level: number;
  hand: Hand | null;
  /** The hand on the table: its seeds and when it started. */
  cur: { n: number; serverSeed: string; commit: string; seeds: string[]; at: number; stacks: [number, number] } | null;
  /** The next hand, committed (its server seed secret until the match ends) and dealt at dealAt. */
  next: { n: number; serverSeed: string; commit: string; dealAt: number } | null;
  /** When the player to act's clock started. */
  turnAt: number;
  /** A finished hand's pacing: the board as it was when the betting closed, when each card after it turns, when the result shows, when the next hand comes. */
  reveal: { from: number; at: number; resultAt: number; nextAt: number } | null;
  history: HandRecord[];
  /** A house frog's next action (the bot thinks before acting). */
  plan: { n: number; at: number; action: Action; seat: Seat; key: string } | null;
  done: boolean; winner: string | null; reason: Reason | null; endedAt: number | null; bustAt: number | null;
  rematch: Set<string>; rematchId: string | null;
  emotes: { seat: Seat; id: string; at: number }[];
  escrow?: string; stake?: string; showBy?: number; onResult?: (r: { draw: boolean; winner: string | null }) => void;
  expired?: Expired; movedTo?: string;
  practice?: boolean; house?: boolean;
  /** When a big pot changed hands: live betting pauses briefly after it. */
  swingAt?: number;
  /** What the last stream frame showed, so a change is told once. */
  stamp: string;
};
export type OpenPoker = { id: string; host: { name: string; rating: number; agent?: boolean; level?: number }; since: number; away: boolean; awayUntil: number | null };
type Rating = { key: string; name: string; rating: number; games: number; wins: number; at: number };
type Boards = { ratings: Rating[]; results: { key: string; at: number; win: boolean }[] };
/** A finished match, for the profiles (XP), the weekly prizes and the community: by profile key (a wallet). */
export type PokerEvent = {
  id: string; staked: boolean; reason: Reason; rated: boolean; hands: number;
  players: { key: string | null; name: string; result: "win" | "loss" | "draw"; rating: number; change: number; agent?: boolean }[];
};
const ended: ((e: PokerEvent) => void)[] = [];
export const onPoker = (f: (e: PokerEvent) => void) => { ended.push(f); };
export function cleanName(name: string, wallet?: string | null): string { return publicName(name, { max: 18 }) ?? walletHandle(wallet) ?? "Night crew"; }
const keyOf = (p: Pick<Player, "name" | "wallet">) => (p.wallet ? `w:${p.wallet.toLowerCase()}` : `n:${p.name.toLowerCase()}`);
const STREET_CARDS = { preflop: 0, flop: 3, turn: 4, river: 5 } as const;
/** The pots of a hand being played, when an all-in has made more than one. */
export function sidePots(h: Hand): { amount: number; eligible: number[] }[] {
  if (!h.players.some((p) => p.allIn)) return [];
  const pots = h.pots().filter((p) => p.eligible.length > 1).map((p) => ({ amount: p.amount, eligible: p.eligible }));
  return pots.length > 1 ? pots : [];
}

export class PokerGames {
  private matches = new Map<string, Match>();
  private listeners = new Map<string, Set<() => void>>();
  private boards: Boards = { ratings: [], results: [] };
  constructor(private file: string | null = join(config.dataDir, "poker.json"), private now = () => Date.now(), private random: () => number = Math.random,
    private looks: (key: string | null, staked: boolean) => Look = () => PLAIN) {
    try {
      if (file && existsSync(file)) {
        const d = JSON.parse(readFileSync(file, "utf8"));
        if (Array.isArray(d.ratings) && Array.isArray(d.results)) this.boards = d;
      }
    } catch { /* an unreadable board must not keep the tables closed */ }
  }
  /** Profiles and cosmetics plug in here (locker.ts): a player's emotes and face by profile key. */
  setLooks(f: (key: string | null, staked: boolean) => Look): void { this.looks = f; }
  private emit(m: Match) { m.version++; for (const f of this.listeners.get(m.id) ?? []) f(); }
  private match(id: string) { const m = this.matches.get(id); if (!m) throw new LoungeError(404, "No such table"); return m; }
  private player(m: Match, id: string) { const p = m.players.find((x) => x.id === id); if (!p) throw new LoungeError(404, "No such player"); return p; }
  private seatOf(m: Match, p: Player): Seat { return m.players.indexOf(p) === 0 ? 0 : 1; }
  private rating(p: Pick<Player, "name" | "wallet">) { return this.boards.ratings.find((r) => r.key === keyOf(p))?.rating ?? 1200; }
  private safeLook(key: string | null, staked: boolean): Look { try { return { ...this.looks(key ? key.toLowerCase() : null, staked) }; } catch { return { ...PLAIN }; } }
  private newPlayer(name: string, wallet: string | null, agent = false, staked = false): Player {
    const look = this.safeLook(wallet, staked);
    if (!look.avatar) look.avatar = `/games/pinball/frog-${randomInt(5)}.webp`;
    const p: Player = { id: randomUUID(), name: cleanName(name, wallet), wallet: wallet ? wallet.toLowerCase() : null, rating: 1200, streams: 0, offlineAt: this.now(), seen: false, look,
      acted: 0, timeouts: 0, bank: BANK_MS, graceUsed: 0, seeds: new Map(), ...(agent ? { agent: true } : {}) };
    p.rating = this.rating(p);
    return p;
  }
  private frog(name: string): Player {
    const n = /#(\d+)/.exec(name)?.[1];
    return { id: randomUUID(), name, wallet: null, rating: 1200, streams: 1, offlineAt: null, seen: true, bot: true, acted: 0, timeouts: 0, bank: BANK_MS, graceUsed: 0, seeds: new Map(),
      look: { ...PLAIN, avatar: n ? `/api/pinball/frog/${Number(n)}-128.png` : null } };
  }
  private create(players: Player[], o: Partial<Pick<Match, "currency" | "escrow" | "stake" | "showBy" | "onResult" | "practice" | "house">> = {}): Match {
    const now = this.now(), seed = newServerSeed();
    const m: Match = { ...o, id: randomBytes(10).toString("hex"), currency: o.currency ?? "FREE", createdAt: now, startedAt: null, players, version: 0,
      stacks: [START_STACK, START_STACK], button: randomInt(2) as Seat, level: 0, hand: null, cur: null,
      next: { n: 1, serverSeed: seed, commit: commitOf(seed), dealAt: Infinity }, turnAt: now, reveal: null, history: [], plan: null,
      done: false, winner: null, reason: null, endedAt: null, bustAt: null, rematch: new Set(), rematchId: null, emotes: [], stamp: "" };
    this.matches.set(m.id, m);
    if (players.length === 2 && !m.escrow) this.start(m);
    return m;
  }
  /** A short countdown (10 s staked, 5 s free, 3 s practice), then the first hand: the button decided by lot. */
  private start(m: Match) {
    m.startedAt = this.now() + (m.escrow ? STAKED_COUNTDOWN_MS : m.practice ? 3_000 : 5_000);
    m.next!.dealAt = m.startedAt; m.turnAt = m.startedAt;
    this.emit(m);
  }

  // ---- seats: the queue, the lounge, practice, the house, stakes

  private isOpen(m: Match) { return !m.done && !m.startedAt && !m.escrow && m.players.length === 1; }
  private joinable(m: Match) { return this.isOpen(m) && m.players[0]!.streams > 0 && this.now() - m.createdAt <= LOUNGE_WAIT_MS; }
  private sameWallet(m: Match, wallet: string | null) { const w = m.players[0]?.wallet; return !!wallet && !!w && w.toLowerCase() === wallet.toLowerCase(); }
  private own(m: Match, wallet: string | null, agent: boolean) { return !agent && !m.players[0]!.agent && this.sameWallet(m, wallet); }
  private openGames() { return [...this.matches.values()].filter((m) => this.isOpen(m)).sort((a, b) => a.createdAt - b.createdAt); }
  private seat(m: Match, p: Player) { m.players.push(p); this.start(m); }

  /** Find a rival (the longest wait first), or open a table in the lounge. A wallet with an open table of its own is told so. */
  queue(name: string, wallet: string | null, agent = false) {
    if (this.matches.size >= 10_000) throw new LoungeError(503, "The card room is full. Try again shortly.");
    const open = this.openGames();
    if (open.some((m) => this.own(m, wallet, agent))) throw new OwnGameError();
    const p = this.newPlayer(name, wallet, agent);
    for (const m of open) {
      if (!this.joinable(m) || this.sameWallet(m, wallet)) continue;
      this.seat(m, p);
      return { match: this.view(m, p.id), player: p.id };
    }
    const m = this.create([p]);
    return { match: this.view(m, p.id), player: p.id };
  }
  /** Sit down at one open table from the lounge, by its id (the queue's checks). */
  join(id: string, name: string, wallet: string | null, agent = false) {
    const m = this.matches.get(id);
    if (!m || m.escrow || m.practice || m.house) throw new LoungeError(404, "This table is not in the lounge any more.");
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
  lounge(wallet: string | null = null): { open: OpenPoker[]; waiting: number; mine: string[] } {
    const open: OpenPoker[] = [], mine: string[] = [];
    let waiting = 0;
    for (const m of this.openGames()) {
      const host = m.players[0]!, away = host.streams === 0;
      if (!away) waiting++;
      if (this.sameWallet(m, wallet)) mine.push(m.id);
      if (open.length < 100) open.push({ id: m.id, host: { name: host.name, rating: host.rating, ...(host.look.level ? { level: host.look.level } : {}), ...(host.agent ? { agent: true } : {}) }, since: m.createdAt, away, awayUntil: away && host.offlineAt !== null ? host.offlineAt + LOUNGE_GRACE_MS : null });
    }
    return { open, waiting, mine };
  }
  /** Practice against Frog #7, played by the server with what its seat sees: never rated, never listed. */
  practice(name: string, wallet: string | null) {
    if (this.matches.size >= 10_000) throw new LoungeError(503, "The card room is full. Try again shortly.");
    const p = this.newPlayer(name, wallet);
    const m = this.create([p, this.frog(FROG)], { practice: true });
    return { match: this.view(m, p.id), player: p.id };
  }
  /** A house exhibition: two frogs heads-up, played by the server. Never rated, staked or bet on; listed as HOUSE. */
  createHouse(a: string, b: string): { id: string } {
    const m = this.create([this.frog(a), this.frog(b)], { house: true });
    return { id: m.id };
  }
  /** Ends a house exhibition now (the server is busy): no winner, reason "paused". */
  stopHouse(id: string): void {
    const m = this.matches.get(id);
    if (m?.house && !m.done) { if (!m.startedAt) m.startedAt = this.now(); this.end(m, null, "paused"); }
  }
  isHouse(id: string): boolean { return !!this.matches.get(id)?.house; }
  /**
   * A match for a stake held in GameEscrow, for exactly these two wallets. It starts once both are
   * connected (after a countdown); if they are not both there within STAKED_SHOW_MS it is void.
   */
  createStaked(o: { escrow: string; currency: "IMD" | "SHIFT"; stake: string; a: { wallet: string; name: string; agent?: boolean }; b: { wallet: string; name: string; agent?: boolean }; onResult: (r: { draw: boolean; winner: string | null }) => void }): { id: string; seats: { [wallet: string]: string } } {
    const a = this.newPlayer(o.a.name, o.a.wallet, o.a.agent, true), b = this.newPlayer(o.b.name, o.b.wallet, o.b.agent, true);
    const m = this.create([a, b], { currency: o.currency, escrow: o.escrow, stake: o.stake, showBy: this.now() + STAKED_SHOW_MS, onResult: o.onResult });
    return { id: m.id, seats: { [a.wallet!]: a.id, [b.wallet!]: b.id } };
  }

  // ---- the hands

  private playing(m: Match) { return !m.done && !!m.startedAt && this.now() >= m.startedAt; }
  private inPlay(m: Match) { return !!m.hand && m.hand.street !== "done"; }
  /** The seat to act now, if a hand waits on someone. */
  private turn(m: Match): Seat | null {
    const h = m.hand;
    return h && h.street !== "done" && h.toAct !== null ? (h.players[h.toAct]!.seat as Seat) : null;
  }
  private deal(m: Match) {
    const nx = m.next!, now = this.now();
    m.level = Math.min(LEVELS.length - 1, Math.floor((now - m.startedAt!) / LEVEL_MS));
    const [sb, bb] = LEVELS[m.level]!;
    const seeds = m.players.map((p) => (p.bot ? "" : p.seeds.get(nx.n) ?? ""));
    for (const p of m.players) for (const k of p.seeds.keys()) if (k <= nx.n) p.seeds.delete(k);
    m.hand = new Hand({ n: nx.n, seats: [{ seat: 0, stack: m.stacks[0] }, { seat: 1, stack: m.stacks[1] }], button: m.button, sb, bb, deck: deckOrder(nx.serverSeed, seeds, nx.n) });
    m.cur = { n: nx.n, serverSeed: nx.serverSeed, commit: nx.commit, seeds, at: now, stacks: [...m.stacks] };
    m.next = null; m.reveal = null; m.turnAt = now; m.plan = null;
    if (m.hand.street === "done") this.handOver(m);
  }
  /** A hand is over: the stacks, the pacing of what is still to be shown, the history, the next hand committed (or the match over). */
  private handOver(m: Match) {
    const h = m.hand!, r = h.result!, now = this.now(), c = m.cur!;
    m.stacks = [h.player(0)!.stack, h.player(1)!.stack];
    const from = h.runout === null ? h.board.length : STREET_CARDS[h.runout];
    const steps = h.runout === null ? 0 : [3, 4, 5].filter((k) => k > from).length;
    const resultAt = now + steps * RUNOUT_MS + (r.showdown ? 600 : 0);
    m.reveal = { from, at: now, resultAt, nextAt: resultAt + (r.showdown ? SHOWDOWN_MS : HAND_GAP_MS) };
    m.history.push({ n: c.n, button: m.button, blinds: [h.sb, h.bb], commit: c.commit, serverSeed: c.serverSeed, clientSeeds: c.seeds, stacks: c.stacks, board: [...h.board],
      hole: [h.player(0)!.hole, h.player(1)!.hole], shown: r.shown as Seat[], log: [...h.log], pots: r.pots, won: r.won, uncalled: r.uncalled, hands: r.hands, showdown: r.showdown, at: now });
    if (m.history.length > 400) m.history.shift();
    if (h.pot() >= Math.min(...c.stacks) / 2) m.swingAt = resultAt;
    m.plan = null;
    if (m.stacks[0] === 0 || m.stacks[1] === 0) { m.bustAt = resultAt; return; }
    m.button = other(m.button);
    // the time bank grows a little every few hands
    if (m.history.length % BANK_EVERY === 0) for (const p of m.players) p.bank = Math.min(BANK_MAX_MS, p.bank + BANK_ADD_MS);
    const seed = newServerSeed();
    m.next = { n: c.n + 1, serverSeed: seed, commit: commitOf(seed), dealAt: m.reveal.nextAt };
  }
  /** How long the player to act has been away on this turn (0: here, not their turn, or nothing to play). */
  private away(m: Match, p: Player) {
    const t = this.turn(m);
    if (p.bot || t === null || m.players[t] !== p || p.offlineAt === null || !this.playing(m)) return 0;
    return Math.max(0, this.now() - Math.max(p.offlineAt, m.turnAt));
  }
  /** What is left of a player's reconnection time: 2 minutes in all staked, 45 seconds free. */
  private allowance(m: Match, p: Player) { return Math.max(0, (m.escrow ? STAKED_GRACE_MS : AWAY_MS) - p.graceUsed); }
  private book(m: Match, p: Player | undefined) { if (p) p.graceUsed += this.away(m, p); }
  /** The deadline of the turn on the table: the shot clock, then the bank. */
  private deadline(m: Match) { const t = this.turn(m); return t === null ? null : m.turnAt + ACTION_MS + m.players[t]!.bank; }

  /** One action by a seat. `chosen`: the player's own (not the clock's), which is what makes a staked game playable to its end. */
  private apply(m: Match, seat: Seat, a: Action, chosen: boolean) {
    const p = m.players[seat]!, now = this.now(), took = now - m.turnAt;
    this.book(m, p);
    if (took > ACTION_MS) p.bank = Math.max(0, p.bank - (took - ACTION_MS));
    try { m.hand!.act(seat, a); } catch (e) { throw new LoungeError(e instanceof PokerError ? 409 : 400, (e as Error).message); }
    if (chosen) p.acted++; else p.timeouts++;
    m.turnAt = now; m.plan = null;
    if (m.hand!.street === "done") this.handOver(m);
    this.emit(m);
  }
  private mustPlay(m: Match, p: Player) {
    this.check(m);
    if (m.done) throw new LoungeError(409, "The match has ended.");
    if (!this.playing(m)) throw new LoungeError(409, "The match has not started.");
    if (!this.inPlay(m)) throw new LoungeError(409, "The next hand is being dealt.");
    if (this.turn(m) !== this.seatOf(m, p)) throw new LoungeError(409, "It is your rival's turn.");
  }
  /** Fold, check, call, or raise to an amount (a bet when nothing was bet yet). */
  act(id: string, me: string, input: { kind?: unknown; to?: unknown }) {
    const m = this.match(id), p = this.player(m, me);
    if (p.bot) throw new LoungeError(403, "That seat is the house's.");
    this.mustPlay(m, p);
    const kind = String(input.kind ?? "");
    if (!["fold", "check", "call", "raise"].includes(kind)) throw new LoungeError(400, "Fold, check, call or raise.");
    const to = kind === "raise" ? Number(input.to) : undefined;
    if (kind === "raise" && !Number.isInteger(to)) throw new LoungeError(400, "Say how much to raise to, in chips.");
    this.apply(m, this.seatOf(m, p), { kind: kind as Action["kind"], ...(to !== undefined ? { to } : {}) }, true);
    return this.view(m, me);
  }
  /** The player's own seed for the next hand: any 1-64 letters, digits, - or _, sent once, before that hand is dealt. */
  seed(id: string, me: string, hand: unknown, seed: unknown) {
    const m = this.match(id), p = this.player(m, me), s = cleanSeed(seed);
    if (!s) throw new LoungeError(400, "A seed is 1 to 64 letters, digits, - or _.");
    if (!m.next || m.next.n !== Number(hand)) throw new LoungeError(409, "That hand is already dealt (or not committed yet).");
    if (!p.seeds.has(m.next.n)) { p.seeds.set(m.next.n, s); this.emit(m); }
    return { hand: m.next.n, seed: p.seeds.get(m.next.n)! };
  }
  emote(id: string, me: string, emote: string) {
    const m = this.match(id), p = this.player(m, me);
    if (!p.look.emotes.includes(emote)) throw new LoungeError(403, "That emote is not in your set.");
    const seat = this.seatOf(m, p), lastAt = m.emotes.filter((e) => e.seat === seat).at(-1)?.at ?? 0;
    if (this.now() - lastAt < EMOTE_GAP_MS) throw new LoungeError(429, "One emote at a time.");
    m.emotes.push({ seat, id: emote, at: this.now() });
    if (m.emotes.length > 8) m.emotes.shift();
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
    if (m.escrow) throw new LoungeError(409, "A staked match starts once both players are at the table; if you are not both here within 15 minutes it is void and both stakes go back. Stay at the table.");
    if (m.startedAt && !m.done) throw new LoungeError(409, "The match is on. Leave the table to give it up.");
    m.done = true; m.endedAt ??= this.now(); this.emit(m);
  }
  rematch(id: string, me: string) {
    const m = this.match(id); this.player(m, me);
    if (!m.done || !m.startedAt) throw new LoungeError(409, "Finish this match first");
    if (m.escrow) throw new LoungeError(409, "A staked match has no rematch: open a new challenge.");
    if (m.house || m.practice) throw new LoungeError(409, m.house ? "A house exhibition has no rematch." : "Start a new practice match.");
    if (!m.rematchId) {
      m.rematch.add(me);
      if (m.rematch.size === 2) {
        const next = this.create(m.players.map((p) => ({ ...p, rating: this.rating(p), streams: 0, offlineAt: this.now(), seen: false, acted: 0, timeouts: 0, bank: BANK_MS, graceUsed: 0, seeds: new Map(), look: this.safeLook(p.wallet, false) })));
        m.rematchId = next.id;
      }
      this.emit(m);
    }
    return this.view(m, me);
  }

  // ---- clocks, the house frog, abandonment, the end

  private check(m: Match) {
    const now = this.now();
    if (m.done || !this.playing(m)) return;
    if (m.bustAt !== null) {
      if (now >= m.bustAt) this.end(m, m.stacks[0] > 0 ? 0 : 1, "busted");
      return;
    }
    if (!this.inPlay(m)) { if (m.next && now >= m.next.dealAt) { this.deal(m); this.emit(m); } return; }
    const seat = this.turn(m)!, p = m.players[seat]!;
    if (!p.bot && p.streams === 0 && p.offlineAt !== null && this.away(m, p) > this.allowance(m, p)) { this.end(m, other(seat), "abandonment"); return; }
    if (p.bot) { try { this.think(m, seat); } catch (e) { console.error("poker frog", (e as Error).message); } return; }
    if (now >= this.deadline(m)!) {
      // out of time: a check when it is free, else a fold
      const l = m.hand!.legal()!;
      this.apply(m, seat, l.check ? { kind: "check" } : { kind: "fold" }, false);
    }
  }
  /** The house frog acts on what its seat sees, after thinking like a person. */
  private think(m: Match, seat: Seat) {
    const h = m.hand!, me = h.player(seat)!, key = `${h.n}:${h.log.length}`, now = this.now();
    if (!m.plan || m.plan.key !== key) {
      const legal = h.legal()!;
      const view = { hole: me.hole, board: [...h.board], street: h.street as Exclude<typeof h.street, "done">, pot: h.pot(), bet: me.bet, stack: me.stack, currentBet: h.currentBet, bb: h.bb, opponents: h.inHand().length - 1, legal };
      m.plan = { n: h.n, seat, key, action: botAction(view, this.random), at: now + thinkMs(view, this.random) };
      return;
    }
    if (now < m.plan.at) return;
    const a = m.plan.action;
    try { this.apply(m, seat, a, true); } catch { this.apply(m, seat, h.legal()!.check ? { kind: "check" } : { kind: "fold" }, true); }
  }
  private end(m: Match, winner: Seat | null, reason: Reason) {
    if (m.done) return;
    // a staked match is never lost by a player who never chose an action (away from the start, or only timed out): void, both stakes go back
    if (m.escrow && winner !== null && (reason === "abandonment" || reason === "busted") && m.players[other(winner)]!.acted === 0) { winner = null; reason = "void"; }
    const now = this.now();
    // a hand cut off by the end (abandonment, resignation) goes in the history as it stood, so its seed is shown too
    if (this.inPlay(m) && m.cur) {
      const h = m.hand!;
      m.history.push({ n: m.cur.n, button: m.button, blinds: [h.sb, h.bb], commit: m.cur.commit, serverSeed: m.cur.serverSeed, clientSeeds: m.cur.seeds, stacks: m.cur.stacks, board: [...h.board],
        hole: [h.player(0)!.hole, h.player(1)!.hole], shown: [], log: [...h.log], pots: [], won: {}, uncalled: null, hands: {}, showdown: false, at: now, cut: true });
      m.hand = null;
    }
    m.done = true; m.reason = reason; m.endedAt = now; m.next = null; m.plan = null;
    m.winner = winner === null ? null : m.players[winner]!.id;
    if (m.house || m.practice) { this.emit(m); return; }
    const rated = m.players.length === 2 && m.players.every((p) => p.seen && p.acted >= 1) && m.history.length >= 2;
    const before = m.players.map((p) => p.rating);
    if (rated) this.record(m);
    for (const f of ended) try {
      f({ id: m.id, staked: !!m.escrow, reason, rated, hands: m.history.length, players: m.players.map((p, i) => ({
        key: p.wallet, name: p.name, result: m.winner === null ? "draw" : m.winner === p.id ? "win" : "loss", rating: p.rating, change: p.rating - before[i]!, ...(p.agent ? { agent: true } : {}),
      })) });
    } catch (e) { console.error("poker event", e); }
    // the server's verdict of a staked match, by wallet, to the escrow (signed there after its own checks)
    if (m.onResult) try { m.onResult({ draw: m.winner === null, winner: m.players.find((p) => p.id === m.winner)?.wallet ?? null }); } catch (e) { console.error("poker stake result", e); }
    this.emit(m);
  }
  private record(m: Match) {
    const [a, b] = m.players as [Player, Player];
    const score = m.winner === a.id ? 1 : m.winner === b.id ? 0 : 0.5;
    const delta = keyOf(a) === keyOf(b) ? 0 : Math.round(24 * (score - 1 / (1 + 10 ** ((b.rating - a.rating) / 400))));
    for (const [p, d] of [[a, delta], [b, -delta]] as const) {
      const key = keyOf(p), old = this.boards.ratings.find((r) => r.key === key);
      const r = old ?? { key, name: p.name, rating: 1200, games: 0, wins: 0, at: 0 };
      r.rating += d; r.games++; r.wins += Number(m.winner === p.id); r.at = this.now(); r.name = p.name; p.rating = r.rating;
      if (!old) this.boards.ratings.push(r);
      this.boards.results.push({ key, at: this.now(), win: m.winner === p.id });
    }
    this.boards.results = this.boards.results.filter((r) => r.at > this.now() - 86_400_000);
    if (this.file) try { mkdirSync(dirname(this.file), { recursive: true }); writeFileSync(`${this.file}.tmp`, JSON.stringify(this.boards)); renameSync(`${this.file}.tmp`, this.file); } catch (err) { console.error("poker board", err); }
  }
  board() {
    const rows = this.boards.ratings.filter((r) => !/^\s*(night crew)?\s*$/i.test(r.name)).sort((a, b) => b.rating - a.rating || b.wins - a.wins);
    const pub = (r: Rating) => ({ name: r.name, rating: r.rating, games: r.games, wins: r.wins });
    const night = this.now() - 86_400_000;
    return { best: rows.slice(0, 10).map(pub), board: rows.filter((r) => this.boards.results.some((g) => g.key === r.key && g.at > night)).slice(0, 10).map((r) => {
      const games = this.boards.results.filter((g) => g.key === r.key && g.at > night);
      return { ...pub(r), games: games.length, wins: games.filter((g) => g.win).length };
    }) };
  }

  // ---- what each reader sees

  private status(m: Match) { const now = this.now(); return m.done ? "finished" as const : !m.startedAt ? "waiting" as const : now < m.startedAt ? "countdown" as const : "playing" as const; }
  /**
   * The table for one seat (`me`), or for a spectator (me = ""). Hole cards: your own, and the ones
   * turned up at a showdown or an all-in (only once the run-out shows them). Server seeds: only once
   * the match is over (each hand's commitment is shown from before its deal).
   */
  private view(m: Match, me: string) {
    const now = this.now(), mine = m.players.find((p) => p.id === me), you = mine ? this.seatOf(m, mine) : null;
    const h = m.hand, rv = m.reveal, over = !!h && h.street === "done";
    const showResult = over && !!rv && now >= rv.resultAt;
    // the board as far as it is shown: during a run-out the cards turn one street at a time
    let boardShown = h?.board.length ?? 0;
    if (h && over && rv) { boardShown = rv.from; [3, 4, 5].filter((k) => k > rv.from).forEach((k, i) => { if (now >= rv.at + (i + 1) * RUNOUT_MS) boardShown = k; }); }
    // the cards still in at a showdown turn up at once (an all-in's before its run-out)
    const shown = over && h.result ? h.result.shown : [];
    const turn = this.turn(m), legal = turn !== null && turn === you && !m.done ? h!.legal() : null;
    const hand = h ? {
      n: h.n, street: h.street, button: h.button, sb: h.sb, bb: h.bb, sbSeat: h.sbSeat, bbSeat: h.bbSeat,
      board: h.board.slice(0, boardShown), currentBet: h.currentBet, minRaise: h.minRaise,
      pot: over ? (showResult ? 0 : h.result!.pots.reduce((n, p) => n + p.amount, 0)) : h.pot(),
      // side pots while the hand is on: only once someone is all-in (an unmatched bet is no pot)
      pots: over ? (showResult ? h.result!.pots : []) : sidePots(h),
      seats: h.players.map((p) => ({
        seat: p.seat, bet: over ? 0 : p.bet, folded: p.folded, allIn: p.allIn,
        // stacks show the result only once it is shown
        stack: over && !showResult ? p.stack - (h.result!.won[p.seat] ?? 0) : p.stack,
        cards: p.seat === you || shown.includes(p.seat) ? p.hole : null,
      })),
      toAct: turn, commit: m.cur?.commit ?? null,
      result: showResult ? { pots: h.result!.pots, won: h.result!.won, uncalled: h.result!.uncalled, showdown: h.result!.showdown,
        hands: Object.fromEntries(Object.entries(h.result!.hands).filter(([s]) => shown.includes(Number(s)))) } : null,
      log: h.log, runout: h.runout,
    } : null;
    const dl = this.deadline(m);
    return {
      id: m.id, currency: m.currency, stake: m.stake ?? null, escrow: m.escrow ?? null, version: m.version, now, startedAt: m.startedAt, status: this.status(m),
      practice: !!m.practice, house: !!m.house, level: m.level, levelAt: m.startedAt ? m.startedAt + (m.level + 1) * LEVEL_MS : null, nextBlinds: LEVELS[Math.min(LEVELS.length - 1, m.level + 1)],
      blinds: LEVELS[m.level], startStack: START_STACK,
      hand, you, legal,
      clock: turn === null || dl === null ? null : { seat: turn, turnAt: m.turnAt, actionMs: ACTION_MS, deadline: dl },
      next: m.next ? { n: m.next.n, commit: m.next.commit, dealAt: Number.isFinite(m.next.dealAt) ? m.next.dealAt : null, seedSent: !!mine?.seeds.has(m.next.n) } : null,
      history: m.history.slice(-30).reverse().map((r) => this.recordView(r, you, m.done)),
      emotes: m.emotes.filter((e) => now - e.at < EMOTE_SHOW_MS),
      done: m.done, reason: m.reason,
      winner: m.winner ? this.seatOf(m, this.player(m, m.winner)) : null, winnerIsYou: !!me && m.winner === me,
      rematchRequested: m.rematch.has(me), rivalWantsRematch: m.players.some((p) => p.id !== me && m.rematch.has(p.id)), rematchId: m.rematchId,
      waitingSince: m.createdAt, expired: m.expired ?? null, movedTo: m.movedTo ?? null, showBy: m.showBy ?? null,
      players: m.players.map((p, i) => {
        const away = this.away(m, p), out = !p.bot && p.offlineAt !== null && turn === i && this.playing(m);
        return { seat: i as Seat, name: p.name, rating: p.rating, you: p.id === me, connected: p.bot || p.streams > 0, bot: !!p.bot, avatar: p.look.avatar ?? null, level: p.look.level ?? null,
          emotes: p.id === me ? p.look.emotes : [], bank: p.bank, ...(p.agent ? { agent: true } : {}),
          awayUntil: out ? now - away + this.allowance(m, p) : null, grace: m.escrow ? Math.max(0, this.allowance(m, p) - away) : null };
      }),
    };
  }
  /** One hand of the history: hole cards are the reader's own and the shown ones; seeds once the match is over. */
  private recordView(r: HandRecord, you: Seat | null, over: boolean) {
    return { n: r.n, button: r.button, blinds: r.blinds, stacks: r.stacks, board: r.board, log: r.log, pots: r.pots, won: r.won, uncalled: r.uncalled, showdown: r.showdown, at: r.at, cut: !!r.cut,
      hole: r.hole.map((c, s) => (s === you || r.shown.includes(s as Seat) ? c : null)), shown: r.shown,
      hands: Object.fromEntries(Object.entries(r.hands).filter(([s]) => r.shown.includes(Number(s) as Seat))),
      commit: r.commit, serverSeed: over ? r.serverSeed : null, clientSeeds: r.clientSeeds };
  }
  get(id: string, me: string) { const m = this.match(id); this.player(m, me); this.check(m); return this.view(m, me); }
  /** What a spectator sees: the table as nobody's seat (no hole card until it is shown). */
  watchView(id: string) {
    const m = this.match(id);
    if (m.practice) throw new LoungeError(404, "Practice tables are private.");
    this.check(m);
    return { ...this.view(m, ""), escrow: null, rematchRequested: false, rivalWantsRematch: false, rematchId: null };
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
    const m = this.match(id);
    if (m.practice) throw new LoungeError(404, "Practice tables are private.");
    const set = this.listeners.get(id) ?? new Set(); set.add(f); this.listeners.set(id, set);
    return () => { set.delete(f); };
  }
  /** The matches being played now, for the spectators' list: names and ratings only (practice is private). */
  live() {
    return [...this.matches.values()].filter((m) => !m.done && m.startedAt !== null && m.players.length === 2 && !m.practice).map((m) => ({
      id: m.id, currency: m.currency, stake: m.stake ?? null, startedAt: m.startedAt!, ...(m.house ? { house: true } : {}), hands: m.history.length,
      players: m.players.map((p) => ({ name: p.name, rating: p.rating, ...(p.agent ? { agent: true } : {}), ...(p.bot ? { bot: true } : {}) })),
    }));
  }
  /**
   * What live betting needs, never sent to a browser, and nothing a hole card could change: the
   * stake, both wallets, the chips behind, the blinds, whether an all-in or a showdown is on.
   */
  betInfo(id: string) {
    const m = this.match(id); this.check(m);
    if (m.house || m.practice) throw new Error("No betting on a house or practice table");
    const h = m.hand, now = this.now(), [, bb] = LEVELS[m.level]!;
    const over = !!h && h.street === "done";
    return {
      escrow: m.escrow ?? null, currency: m.currency, stake: m.stake ?? "0", status: this.status(m), names: m.players.map((p) => p.name) as [string, string?],
      wallets: m.players.map((p) => p.wallet), connected: m.players.map((p) => p.streams > 0),
      chips: [...(m.cur?.stacks ?? m.stacks)] as [number, number], total: 2 * START_STACK, bb, level: m.level, hands: m.history.length,
      allIn: !!h && !over && h.players.some((p) => p.allIn), showing: over && !!m.reveal && now < m.reveal.nextAt, swingAt: m.swingAt ?? null,
      done: m.done, winner: m.winner ? this.seatOf(m, this.player(m, m.winner)) : null, draw: m.done && !m.winner, reason: m.reason,
    };
  }
  /** Two open tables (different wallets, both hosts here) become one: the newer host moves to the older table. */
  private fold() {
    const open = this.openGames().filter((m) => this.joinable(m));
    for (let i = 0; i < open.length; i++) {
      const a = open[i]!;
      for (let j = i + 1; j < open.length && this.isOpen(a); j++) {
        const b = open[j]!, mover = b.players[0]!;
        if (!this.isOpen(b) || mover.agent || this.sameWallet(a, mover.wallet)) continue;
        b.done = true; b.endedAt = this.now(); b.movedTo = a.id;
        this.seat(a, mover); this.emit(b);
      }
    }
  }
  tick() {
    for (const m of this.matches.values()) {
      // a staked match whose players were never both at the table by its deadline: void, both stakes go back
      if (m.escrow && !m.startedAt && !m.done && m.showBy !== undefined && this.now() >= m.showBy) { m.startedAt = this.now(); this.end(m, null, "void"); }
      const before = m.version;
      this.check(m);
      // the moments a frame changes without an action: a run-out card, the result, the countdown's end
      const v = m.hand && m.reveal ? `${m.hand.n}:${[1, 2, 3].filter((i) => this.now() >= m.reveal!.at + i * RUNOUT_MS).length}:${this.now() >= m.reveal.resultAt}` : "";
      const stamp = `${this.status(m)}:${v}`;
      if (stamp !== m.stamp) { m.stamp = stamp; if (m.version === before) this.emit(m); }
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
export const poker = new PokerGames();
setInterval(() => poker.tick(), 250).unref();
