import { existsSync, readFileSync } from "node:fs";
import type { IncomingMessage, ServerResponse } from "node:http";
import { join } from "node:path";
import { writeAtomic } from "./atomic.js";
import { type ChessEvent, onChess } from "./chess.js";
import { config } from "./config.js";
import { creditHours } from "./frogs.js";
import { seasonStartOf } from "./league.js";
import { type ArcadeEvent, onArcade } from "./pinball.js";
import { type PoolEvent, onPool } from "./pool.js";

/**
 * Weekly prizes in shift hours, the same hours soft staking and the Command Room pay (frogs.ts) and
 * the weekly frog pot shares out (frogpot.ts). Each week (Monday 00:00 UTC, the missions' and the
 * league's epoch) the top three of each game get bonus hours: NIGHT CHESS and NIGHT POOL by rated
 * wins, Space Pinball by the best verified solo score. 24, 12 and 6 hours by default (PRIZE_HOURS).
 *
 * Anti-abuse: only wallet-signed players count; only rated games between two different wallets;
 * at most the first 3 games against the same opponent in a week count (their wins included); a
 * house exhibition never reaches here (chess.ts keeps it from the arcade). A week's winners are held
 * 48 hours before their hours are added, and the admin can void an entry from /setup in that time
 * (or during the week, which takes the wallet off that week's board).
 */
export type PrizeGame = "chess" | "pool" | "pinball";
export const PRIZE_GAMES: PrizeGame[] = ["chess", "pool", "pinball"];
export const PER_OPPONENT = 3;
export const HOLD_MS = 48 * 3_600_000;
const WEEK_MS = 7 * 86_400_000;
export const RULES = [
  "Each week (Monday 00:00 UTC) the top 3 in NIGHT CHESS and NIGHT POOL (most rated wins) and Space Pinball (best verified solo score) win bonus shift hours.",
  "Sign in with your wallet to count. Only rated games between different wallets count, at most 3 against the same rival, never house games; hours land 48 hours after the week ends.",
];

type Duel = { at: number; a: string; b: string; winner: string | null };
type Best = { score: number; at: number };
export type Award = { week: number; game: PrizeGame; place: number; wallet: string; name: string; hours: number; result: string; payAt: number; paidAt?: number; voided?: { at: number; reason: string } };
type State = { week: number; duels: { chess: Duel[]; pool: Duel[] }; solo: Record<string, Best>; names: Record<string, string>; voids: { week: number; game: PrizeGame; wallet: string }[]; awards: Award[] };
export type Standing = { wallet: string; name: string; wins?: number; opponents?: number; score?: number; at: number };
export class PrizeError extends Error { constructor(public status: number, message: string) { super(message); } }

const isWallet = (w: unknown): w is string => typeof w === "string" && /^0x[0-9a-fA-F]{40}$/.test(w);
const PLACE = ["1st", "2nd", "3rd"];
export const placeText = (n: number) => PLACE[n - 1] ?? `${n}th`;
const GAME_NAME: Record<PrizeGame, string> = { chess: "NIGHT CHESS", pool: "NIGHT POOL", pinball: "Space Pinball" };

export class Prizes {
  private s: State;
  constructor(private file: string | null, private o: { now?: () => number; hours?: () => number[]; credit?: (wallet: string, hours: number) => void } = {}) {
    const fresh: State = { week: seasonStartOf(this.now()), duels: { chess: [], pool: [] }, solo: {}, names: {}, voids: [], awards: [] };
    let s = fresh;
    try { if (file && existsSync(file)) s = { ...fresh, ...JSON.parse(readFileSync(file, "utf8")) }; } catch { s = fresh; }
    this.s = s;
  }
  private now() { return (this.o.now ?? Date.now)(); }
  private hours() { return (this.o.hours ?? (() => config.prizeHours))(); }
  private save() { if (this.file) writeAtomic(this.file, JSON.stringify(this.s)); }
  get week() { this.roll(); return { startedAt: this.s.week, endsAt: this.s.week + WEEK_MS }; }

  /** A finished duel: counted only when rated, between two different signed-in wallets. */
  duel(game: "chess" | "pool", a: { wallet: string | null; name: string }, b: { wallet: string | null; name: string }, winner: "a" | "b" | null, rated: boolean): boolean {
    if (!rated || !isWallet(a.wallet) || !isWallet(b.wallet)) return false;
    const wa = a.wallet.toLowerCase(), wb = b.wallet.toLowerCase();
    if (wa === wb) return false;
    this.roll();
    this.s.names[wa] = a.name; this.s.names[wb] = b.name;
    this.s.duels[game].push({ at: this.now(), a: wa, b: wb, winner: winner === "a" ? wa : winner === "b" ? wb : null });
    if (this.s.duels[game].length > 50_000) this.s.duels[game].splice(0, 10_000);
    this.save();
    return true;
  }
  /** A verified solo run: the wallet's best of the week is kept. */
  solo(wallet: string | null, name: string, score: number): boolean {
    if (!isWallet(wallet) || !(score > 0)) return false;
    this.roll();
    const w = wallet.toLowerCase(), old = this.s.solo[w];
    this.s.names[w] = name;
    if (!old || score > old.score) this.s.solo[w] = { score, at: this.now() };
    this.save();
    return true;
  }

  private voided(game: PrizeGame, wallet: string, week = this.s.week) { return this.s.voids.some((v) => v.week === week && v.game === game && v.wallet === wallet); }
  /** The week's board for a game, best first (no wallet with nothing to show). */
  standings(game: PrizeGame): Standing[] { this.roll(); return this.rank(game); }
  private rank(game: PrizeGame): Standing[] {
    const name = (w: string) => this.s.names[w] ?? `Frog-${w.slice(2, 6).toUpperCase()}`;
    if (game === "pinball") {
      return Object.entries(this.s.solo).filter(([w]) => !this.voided(game, w))
        .map(([wallet, b]) => ({ wallet, name: name(wallet), score: b.score, at: b.at })).sort((x, y) => y.score! - x.score! || x.at - y.at);
    }
    const pairs = new Map<string, number>(), wins = new Map<string, { n: number; beaten: Set<string>; at: number }>();
    for (const d of [...this.s.duels[game]].sort((x, y) => x.at - y.at)) {
      const key = [d.a, d.b].sort().join(":"), n = pairs.get(key) ?? 0;
      pairs.set(key, n + 1);
      // the 4th game and on against the same opponent counts for nothing
      if (n >= PER_OPPONENT || !d.winner) continue;
      const w = wins.get(d.winner) ?? { n: 0, beaten: new Set<string>(), at: 0 };
      w.n++; w.beaten.add(d.winner === d.a ? d.b : d.a); w.at = d.at;
      wins.set(d.winner, w);
    }
    return [...wins].filter(([w]) => !this.voided(game, w))
      .map(([wallet, w]) => ({ wallet, name: name(wallet), wins: w.n, opponents: w.beaten.size, at: w.at }))
      .sort((x, y) => y.wins! - x.wins! || y.opponents! - x.opponents! || x.at - y.at);
  }

  /** A new week: last week's top three become awards, held HOLD_MS after the week ends; the boards start empty. */
  roll(): Award[] {
    const start = seasonStartOf(this.now());
    if (start <= this.s.week) return [];
    const hours = this.hours(), made: Award[] = [];
    const week = this.s.week;
    // the closing week's boards, read before the new week clears them
    const boards = PRIZE_GAMES.map((g) => [g, this.rank(g)] as const);
    for (const [game, rows] of boards) rows.slice(0, hours.length).forEach((r, i) => {
      if (!(hours[i]! > 0)) return;
      made.push({ week, game, place: i + 1, wallet: r.wallet, name: r.name, hours: hours[i]!, result: game === "pinball" ? `${r.score!.toLocaleString("en-US")} points` : `${r.wins} rated win${r.wins === 1 ? "" : "s"}`, payAt: week + WEEK_MS + HOLD_MS });
    });
    this.s.awards.push(...made);
    this.s.awards = this.s.awards.filter((a) => a.week > start - 26 * WEEK_MS);
    this.s.week = start;
    this.s.duels = { chess: [], pool: [] };
    this.s.solo = {};
    this.s.voids = this.s.voids.filter((v) => v.week >= start);
    this.save();
    return made;
  }

  /** Adds the hours of every award past its hold, once. */
  payDue(): Award[] {
    this.roll();
    const now = this.now(), paid: Award[] = [];
    for (const a of this.s.awards) {
      if (a.paidAt || a.voided || now < a.payAt) continue;
      (this.o.credit ?? creditHours)(a.wallet, a.hours);
      a.paidAt = now;
      paid.push(a);
    }
    if (paid.length) this.save();
    return paid;
  }

  /** The admin voids an entry: an award still in its hold, or a wallet on this week's board. */
  void(game: PrizeGame, wallet: string, reason = "voided by the admin", week?: number): { award: Award | null; week: number } {
    this.roll();
    if (!PRIZE_GAMES.includes(game) || !isWallet(wallet)) throw new PrizeError(400, "Give the game (chess, pool or pinball) and the wallet.");
    const w = wallet.toLowerCase(), wk = week ?? this.s.week;
    const award = this.s.awards.find((a) => a.week === wk && a.game === game && a.wallet === w) ?? (week === undefined ? this.s.awards.filter((a) => a.game === game && a.wallet === w && !a.paidAt && !a.voided).at(-1) : undefined);
    if (award) {
      if (award.paidAt) throw new PrizeError(409, "Those hours were added already: a paid prize cannot be voided.");
      award.voided = { at: this.now(), reason: String(reason).slice(0, 200) };
      this.save();
      return { award, week: award.week };
    }
    if (wk !== this.s.week) throw new PrizeError(404, "No such prize.");
    if (!this.voided(game, w)) this.s.voids.push({ week: wk, game, wallet: w });
    this.save();
    return { award: null, week: wk };
  }

  /** What /games and each game page show: this week's top three, the countdown, last week's winners. Names only, never a wallet. */
  view(wallet: string | null = null) {
    const week = this.week, hours = this.hours();
    const top = (g: PrizeGame) => this.standings(g).slice(0, 3).map((r, i) => ({ place: i + 1, name: r.name, hours: hours[i] ?? 0, ...(g === "pinball" ? { score: r.score } : { wins: r.wins, opponents: r.opponents }), ...(wallet && r.wallet === wallet.toLowerCase() ? { you: true } : {}) }));
    const lastWeek = this.s.awards.length ? Math.max(...this.s.awards.map((a) => a.week)) : null;
    const last = lastWeek === null ? [] : this.s.awards.filter((a) => a.week === lastWeek).map((a) => ({ game: a.game, place: a.place, name: a.name, hours: a.hours, result: a.result, payAt: a.payAt, paid: !!a.paidAt, voided: !!a.voided }));
    const mine = wallet ? this.s.awards.filter((a) => a.wallet === wallet.toLowerCase()).map((a) => ({ game: a.game, place: a.place, hours: a.hours, result: a.result, week: a.week, payAt: a.payAt, paidAt: a.paidAt ?? null, voided: !!a.voided })).reverse() : [];
    return { on: config.weeklyPrizes, week, now: this.now(), hours, perOpponent: PER_OPPONENT, holdHours: HOLD_MS / 3_600_000, rules: RULES, games: { chess: top("chess"), pool: top("pool"), pinball: top("pinball") }, last, mine };
  }
  /** /setup: the boards with wallets, the awards of the last weeks, what is voided. */
  admin() {
    return { week: this.week, hours: this.hours(), boards: Object.fromEntries(PRIZE_GAMES.map((g) => [g, this.standings(g).slice(0, 10)])),
      awards: [...this.s.awards].reverse().slice(0, 60), voids: this.s.voids.filter((v) => v.week === this.s.week) };
  }
}

let prizes: Prizes | null = null;
export const livePrizes = () => (prizes ??= new Prizes(join(config.dataDir, "prizes.json")));

let wired = false;
/** Follows every finished game into the week's boards, and adds held prizes once their 48 hours are up. Called once at startup. */
export function wirePrizes(p: Prizes = livePrizes()): void {
  if (wired || !config.weeklyPrizes) return;
  wired = true;
  onChess((e: ChessEvent) => { p.duel("chess", { wallet: e.keys[0], name: e.white }, { wallet: e.keys[1], name: e.black }, e.won === "w" ? "a" : e.won === "b" ? "b" : null, e.rated); });
  onPool((e: PoolEvent) => {
    const [a, b] = e.players;
    if (!a || !b || e.players.length !== 2) return;
    // an AI agent plays under its owner's wallet: never a prize seat
    p.duel("pool", { wallet: a.agent ? null : a.key, name: a.name }, { wallet: b.agent ? null : b.key, name: b.name }, a.result === "win" ? "a" : b.result === "win" ? "b" : null, e.rated);
  });
  onArcade((e: ArcadeEvent) => { if (e.kind === "solo") p.solo(e.wallet ?? null, e.run.name, e.run.score); });
  const tick = () => { try { for (const a of p.payDue()) console.log(`weekly prize: +${a.hours} shift hours to ${a.wallet} (${GAME_NAME[a.game]}, ${placeText(a.place)})`); } catch (err) { console.error("prizes", (err as Error).message); } };
  tick();
  setInterval(tick, 60_000).unref();
}

type Context = {
  json(res: ServerResponse, status: number, body: unknown): void;
  limited(req: IncomingMessage, key: string, n: number, ms: number): boolean;
  owner: string | null; url: URL;
};
/** GET /api/games/prizes: this week's prizes (the signed-in wallet's own awards with ?mine=1). Call before the games routes. */
export function prizesRoutes(req: IncomingMessage, res: ServerResponse, p: string, ctx: Context, src: Prizes = livePrizes()): boolean {
  if (p !== "/api/games/prizes") return false;
  if (req.method !== "GET") { ctx.json(res, 405, { error: "Method not allowed" }); return true; }
  if (ctx.limited(req, "games-prizes", 120, 60_000)) { ctx.json(res, 429, { error: "slow down" }); return true; }
  ctx.json(res, 200, src.view(ctx.owner));
  return true;
}
