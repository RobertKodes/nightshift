import { Chess, type Color, type Move } from "chess.js";
import { type ChessGames, chess } from "./chess.js";
import { config } from "./config.js";
import { type PokerGames, poker } from "./poker.js";
import { liveGames } from "./spectate.js";

/**
 * The house exhibition: one NIGHT CHESS game always on between two house bots, so the lounge and
 * /games/live are never empty. Frog #7 sits at every table, against another named frog; they play
 * with the practice bot's rules (apps/web/src/chess/practice.ts, ported here: material and checks
 * first, with room for a mistake) and think like a person (quick in the opening, longer in the
 * middlegame, quicker when the clock runs low). A fresh game starts a minute after one ends.
 *
 * Watchable like any live game, labelled HOUSE. It is never rated, staked or bet on (chess.ts keeps
 * it away from the boards and the arcade), and it steps aside when the server is busy: past
 * HOUSE_GAMES_MAX_REAL real games it stops at once and waits until the tables are quieter.
 * Space Pinball has no house table: a duel is replayed tick by tick from each player's streamed
 * inputs, and a bot would have to stream and verify both sides at 240 ticks a second.
 */
export const HOUSE_STAR = "Frog #7";
export const HOUSE_RIVALS = ["Frog #1", "Frog #2", "Frog #13", "Frog #42", "Frog #77"];
/** Between the end of one exhibition and the start of the next. */
export const HOUSE_GAP_MS = 60_000;

const VALUE: Record<string, number> = { p: 1, n: 3, b: 3, r: 5, q: 9, k: 0 };
/** The practice bot's taste: captures by value, mate first, checks and promotions. */
const score = (m: Move) => (m.captured ? (VALUE[m.captured] ?? 0) * 2 : 0) + (m.san.includes("#") ? 1000 : m.san.includes("+") ? 2 : 0) + (m.promotion ? 10 : 0);
/** The move a house bot plays in this position (null: none left). */
export function houseMove(fen: string, random: () => number = Math.random): Move | null {
  const moves = new Chess(fen).moves({ verbose: true });
  let best: Move | null = null, top = -Infinity;
  for (const m of moves) { const s = score(m) + random() * 3; if (s > top) { top = s; best = m; } }
  return best;
}
/** How long a house bot thinks before this move, like a person: never longer than its clock allows. */
export function thinkMs(ply: number, move: Move, clockMs: number, random: () => number = Math.random): number {
  const base = ply < 10 ? 900 + random() * 1_600 : 1_800 + random() * 5_200;
  const quick = move.captured || move.san.includes("+") ? 0.6 : 1;
  return Math.round(Math.max(400, Math.min(base * quick, clockMs / 25)));
}

type Plan = { ply: number; move: Move; at: number };
export type HouseOptions = {
  games?: ChessGames; now?: () => number; random?: () => number;
  /** Real games being played now (every live game that is not a house exhibition). */
  realGames?: () => number;
  /** Past this many real games the exhibition stops. */
  maxReal?: () => number;
  /** Seconds between steps; tests step by hand. */
  everyMs?: number;
};

export class HouseChess {
  #games: ChessGames; #now: () => number; #random: () => number; #real: () => number; #max: () => number;
  #timer: ReturnType<typeof setInterval> | null = null;
  #game: { id: string; seats: Record<Color, string> } | null = null;
  #plan: Plan | null = null;
  /** When the last exhibition ended (or was stopped): the next one waits HOUSE_GAP_MS. */
  #endedAt = -Infinity;
  #round = 0;
  paused = false;
  constructor(o: HouseOptions = {}) {
    this.#games = o.games ?? chess;
    this.#now = o.now ?? Date.now;
    this.#random = o.random ?? Math.random;
    this.#real = o.realGames ?? (() => liveGames().filter((g) => !g.house).length);
    this.#max = o.maxReal ?? (() => config.houseGamesMaxReal);
  }
  /** The exhibition on now, if any. */
  get current(): string | null { return this.#game?.id ?? null; }
  get running(): boolean { return this.#timer !== null; }

  start(everyMs = 500): void {
    if (this.#timer) return;
    this.#timer = setInterval(() => { try { this.step(); } catch (e) { console.error("house chess", (e as Error).message); } }, everyMs);
    this.#timer.unref?.();
  }
  /** Stops the loop and ends the game on the table (no winner). */
  stop(): void {
    if (this.#timer) clearInterval(this.#timer);
    this.#timer = null;
    this.#end();
  }
  #end(): void {
    if (this.#game) this.#games.stopHouse(this.#game.id);
    if (this.#game) this.#endedAt = this.#now();
    this.#game = null; this.#plan = null;
  }

  /** One step: pause under load, start a game when it is time, or let the bot to move think and play. */
  step(): void {
    const now = this.#now();
    if (this.#real() > this.#max()) {
      // real players come first: the exhibition leaves the table at once
      if (this.#game) this.#end();
      this.paused = true;
      return;
    }
    this.paused = false;
    let v: ReturnType<ChessGames["watchView"]> | null = null;
    if (this.#game) { try { v = this.#games.watchView(this.#game.id); } catch { v = null; } }
    if (this.#game && (!v || v.done)) { this.#endedAt = now; this.#game = null; this.#plan = null; v = null; }
    if (!this.#game) {
      if (now - this.#endedAt < HOUSE_GAP_MS) return;
      const rival = HOUSE_RIVALS[this.#round % HOUSE_RIVALS.length]!;
      // Frog #7 takes white and black in turn
      const [w, b] = this.#round % 2 === 0 ? [HOUSE_STAR, rival] : [rival, HOUSE_STAR];
      this.#round++;
      this.#game = this.#games.createHouse(w, b, "3+2");
      return;
    }
    if (!v || v.status !== "playing") return;
    if (!this.#plan || this.#plan.ply !== v.ply) {
      const move = houseMove(v.fen, this.#random);
      if (!move) return;
      this.#plan = { ply: v.ply, move, at: now + thinkMs(v.ply, move, v.clocks[v.turn], this.#random) };
      return;
    }
    if (now < this.#plan.at) return;
    const { move } = this.#plan;
    this.#plan = null;
    this.#games.move(this.#game.id, this.#game.seats[v.turn], move.from, move.to, move.promotion);
  }
}

/**
 * The NIGHT POKER exhibition: Frog #7 heads-up against another frog of the crew, the server playing
 * both seats with the practice frog's strategy (poker/bot.ts), each seeing only its own cards. The
 * same rules as the chess one: watchable as HOUSE, never rated, staked or bet on (poker.ts keeps it
 * from the boards, the arcade and the betting), out of the way past HOUSE_GAMES_MAX_REAL real games,
 * a new match HOUSE_GAP_MS after one ends.
 */
export class HousePoker {
  #games: PokerGames; #now: () => number; #real: () => number; #max: () => number;
  #timer: ReturnType<typeof setInterval> | null = null;
  #id: string | null = null;
  #endedAt = -Infinity;
  #round = 0;
  paused = false;
  constructor(o: Omit<HouseOptions, "games" | "random"> & { games?: PokerGames } = {}) {
    this.#games = o.games ?? poker;
    this.#now = o.now ?? Date.now;
    this.#real = o.realGames ?? (() => liveGames().filter((g) => !g.house).length);
    this.#max = o.maxReal ?? (() => config.houseGamesMaxReal);
  }
  get current(): string | null { return this.#id; }
  start(everyMs = 1_000): void {
    if (this.#timer) return;
    this.#timer = setInterval(() => { try { this.step(); } catch (e) { console.error("house poker", (e as Error).message); } }, everyMs);
    this.#timer.unref?.();
  }
  stop(): void { if (this.#timer) clearInterval(this.#timer); this.#timer = null; this.#end(); }
  #end(): void { if (this.#id) { this.#games.stopHouse(this.#id); this.#endedAt = this.#now(); } this.#id = null; }
  /** One step: step aside under load, notice the end of a match, start the next when it is time. */
  step(): void {
    if (this.#real() > this.#max()) { this.#end(); this.paused = true; return; }
    this.paused = false;
    if (this.#id) {
      let done = true;
      try { done = this.#games.watchView(this.#id).done; } catch { /* gone */ }
      if (!done) return;
      this.#id = null; this.#endedAt = this.#now();
    }
    if (this.#now() - this.#endedAt < HOUSE_GAP_MS) return;
    const rival = HOUSE_RIVALS[this.#round++ % HOUSE_RIVALS.length]!;
    this.#id = this.#games.createHouse(HOUSE_STAR, rival).id;
  }
}

let house: HouseChess | null = null, housePoker: HousePoker | null = null;
/** The live exhibition loops, chess and poker (off with HOUSE_GAMES=0). */
export function startHouseGames(): HouseChess | null {
  if (!config.houseGames) return null;
  house ??= new HouseChess();
  house.start();
  housePoker ??= new HousePoker();
  housePoker.start();
  return house;
}
