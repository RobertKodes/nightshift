import { randomBytes, randomUUID } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { config } from "./config.js";
import { type Attack, type Input, MAX_TICKS, duelReplay, replay } from "./pinball/engine.js";

/**
 * Space Pinball duels: two players, one seed, the same table, played at the same time, and what
 * each earns lands on the other's table (meteors, gravity surges). The live view is relayed for
 * show; the result is the server's own lockstep replay of both players' inputs with the very
 * engine the browser runs, attacks included. Stakes in IMD or $SHIFT are held by an escrow
 * contract (not live yet): until it is, every duel is free.
 */
export type Currency = "FREE" | "IMD" | "SHIFT";
type Shot = { kind: Attack; tick: number };
type Player = {
  id: string; name: string; wallet: string | null; avatar: string | null;
  live: number; tick: number; x: number; y: number; attacks: Shot[];
  inputs: Input[] | null; solo: number | null; score: number | null; stats?: Record<string, number>; finishedAt?: number;
};
export type Match = {
  id: string; seed: number; currency: Currency; stake: number; createdAt: number; startedAt: number | null;
  players: Player[]; winner: string | null; draw: boolean; done: boolean;
};

const matches = new Map<string, Match>();
const waiting = new Map<string, string>(); // queue key → match id
const listeners = new Map<string, Set<(m: Match) => void>>();
const STAKES: Record<Currency, number[]> = { FREE: [0], IMD: [1, 5, 10, 25], SHIFT: [100_000, 500_000, 1_000_000, 5_000_000] };
/** Escrow not deployed yet: stakes are accepted only as FREE until it is. */
export const STAKES_LIVE = false;

type Score = { name: string; score: number; at: number };
/** Every verified duel score worth keeping: the best 200, kept across restarts. */
const boardFile = () => join(config.dataDir, "pinball.json");
let scores: Score[] = (() => { try { return existsSync(boardFile()) ? (JSON.parse(readFileSync(boardFile(), "utf8")) as Score[]) : []; } catch { return []; } })();
function record(list: Score[]): void {
  scores = [...scores, ...list.filter((s) => s.score > 0)].sort((x, y) => y.score - x.score).slice(0, 200);
  try { writeFileSync(boardFile(), JSON.stringify(scores)); } catch (e) { console.error("pinball board", e); }
}

const emit = (m: Match) => { for (const f of listeners.get(m.id) ?? []) f(m); };
const view = (m: Match, me?: string) => ({
  id: m.id, seed: m.seed, currency: m.currency, stake: m.stake, startedAt: m.startedAt, now: Date.now(), done: m.done, draw: m.draw, winner: m.winner,
  players: m.players.map((p) => ({ name: p.name, avatar: p.avatar, live: p.live, tick: p.tick, x: p.x, y: p.y, attacks: p.attacks, score: p.score, solo: p.solo, stats: p.stats ?? null, you: p.id === me, finished: p.inputs !== null })),
});

export function listen(id: string, f: (m: Match) => void): () => void {
  const s = listeners.get(id) ?? new Set();
  s.add(f); listeners.set(id, s);
  return () => s.delete(f);
}

/** Join the queue for a currency and stake; pairs with whoever waits there, else opens a match. */
export function queue(name: string, wallet: string | null, currency: Currency, stake: number, avatar: string | null): { match: ReturnType<typeof view>; player: string } {
  if (!STAKES[currency]?.includes(stake)) throw new Error("unknown stake");
  if (currency !== "FREE" && !STAKES_LIVE) throw new Error("Stakes open when the escrow contract is live. Play a free duel meanwhile.");
  const clean = name.replace(/[^\w .-]/g, "").slice(0, 18) || "Night crew";
  // only our own art or an onchain frog image may be shown to the other player
  const face = avatar && (/^\/games\/pinball\/frog-\d\.webp$/.test(avatar) || /^data:image\/svg\+xml;base64,[A-Za-z0-9+/=]{100,200000}$/.test(avatar)) ? avatar : null;
  const key = `${currency}:${stake}`;
  const pid = randomUUID();
  const fresh = (): Player => ({ id: pid, name: clean, wallet, avatar: face, live: 0, tick: 0, x: 558, y: 860, attacks: [], inputs: null, solo: null, score: null });
  const open = waiting.get(key);
  const m = open ? matches.get(open) : undefined;
  if (m && !m.startedAt && m.players.length === 1 && Date.now() - m.createdAt < 10 * 60_000 && (listeners.get(m.id)?.size ?? 0) > 0) {
    m.players.push(fresh());
    m.startedAt = Date.now() + 6_000; // the VS screen and a countdown, the same for both
    waiting.delete(key);
    emit(m);
    return { match: view(m, pid), player: pid };
  }
  const id = randomBytes(5).toString("hex");
  const nm: Match = { id, seed: randomBytes(4).readUInt32BE(0), currency, stake, createdAt: Date.now(), startedAt: null, players: [fresh()], winner: null, draw: false, done: false };
  matches.set(id, nm);
  waiting.set(key, id);
  return { match: view(nm, pid), player: pid };
}

export function leave(id: string, player: string): void {
  const m = matches.get(id);
  if (m && !m.startedAt && m.players[0]?.id === player) { matches.delete(id); for (const [k, v] of waiting) if (v === id) waiting.delete(k); }
}

export function get(id: string, me?: string) { const m = matches.get(id); return m ? view(m, me) : null; }

/** The live view (score, ball, attacks earned) shown to the other player: never what decides. */
export function progress(id: string, player: string, live: { score?: unknown; tick?: unknown; x?: unknown; y?: unknown; sent?: unknown }): void {
  const m = matches.get(id);
  const p = m?.players.find((x) => x.id === player);
  if (!m || !p || m.done || p.inputs) return;
  const num = (v: unknown, lo: number, hi: number, d: number) => (typeof v === "number" && Number.isFinite(v) ? Math.max(lo, Math.min(hi, v)) : d);
  p.live = Math.floor(num(live.score, 0, 1e9, p.live)); p.tick = Math.floor(num(live.tick, 0, MAX_TICKS, p.tick));
  p.x = num(live.x, 0, 600, p.x); p.y = num(live.y, 0, 920, p.y);
  if (Array.isArray(live.sent)) for (const s of live.sent.slice(0, 20)) {
    const k = (s as Shot)?.kind, t = Math.floor(Number((s as Shot)?.tick));
    if ((k === "meteor" || k === "surge") && t >= 0 && t <= MAX_TICKS && !p.attacks.some((a) => a.tick === t && a.kind === k) && p.attacks.length < 200) p.attacks.push({ kind: k, tick: t });
  }
  emit(m);
}

const cleanInputs = (inputs: unknown): Input[] => {
  if (!Array.isArray(inputs) || inputs.length > 20_000) throw new Error("bad inputs");
  return inputs.filter((x): x is Input => Array.isArray(x) && x.length === 4 && x.every((v) => typeof v === "number") && (x[0] as number) >= 0 && (x[0] as number) <= MAX_TICKS)
    .map((x) => [Math.floor(x[0]), x[1] ? 1 : 0, x[2] ? 1 : 0, x[3] ? 1 : 0] as Input);
};

/** A finished game's inputs. Its own replay is shown at once; the duel result waits for both. */
export function finish(id: string, player: string, inputs: unknown): { solo: number } {
  const m = matches.get(id);
  const p = m?.players.find((x) => x.id === player);
  if (!m || !p) throw new Error("no such match");
  if (p.inputs) return { solo: p.solo ?? 0 };
  if (!m.startedAt || Date.now() < m.startedAt) throw new Error("the match has not started");
  const clean = cleanInputs(inputs);
  // Inputs carry their tick: nobody can send an input from the future of the match clock.
  // Checked before the replay, so a refused finish costs the server nothing.
  const lastTick = clean.reduce((x, i) => Math.max(x, i[0]), 0);
  if (Date.now() - m.startedAt < (lastTick / 240) * 1000 - 3_000) throw new Error("inputs from later than the match has run");
  const r = replay(m.seed, clean);
  p.inputs = clean; p.solo = r.score; p.live = Math.max(p.live, 0); p.finishedAt = Date.now();
  settle(m);
  return { solo: r.score };
}

/** Both done (or one silent past the longest game): the lockstep replay decides. */
function settle(m: Match): void {
  const [a, b] = m.players;
  if (!a || !b || m.done) { emit(m); return; }
  const longest = (m.startedAt ?? 0) + (MAX_TICKS / 240) * 1000 + 120_000;
  if ((!a.inputs || !b.inputs) && Date.now() < longest) { emit(m); return; }
  const r = duelReplay(m.seed, a.inputs ?? [], b.inputs ?? []);
  a.score = a.inputs ? r.scores[0] : 0; b.score = b.inputs ? r.scores[1] : 0;
  a.stats = r.stats[0]; b.stats = r.stats[1];
  m.done = true;
  m.draw = a.score === b.score;
  m.winner = m.draw ? null : a.score > b.score ? a.name : b.name;
  record([a, b].filter((p) => p.inputs).map((p) => ({ name: p.name, score: p.score ?? 0, at: p.finishedAt ?? Date.now() })));
  emit(m);
}

setInterval(() => {
  for (const m of matches.values()) {
    if (!m.done && m.players.length === 2) settle(m);
    if (Date.now() - m.createdAt > 3_600_000) { matches.delete(m.id); listeners.delete(m.id); }
  }
}, 20_000).unref();

/** The boards: tonight's (last 24 hours) and all-time best verified duel scores. */
export function board(): { board: Score[]; best: Score[] } {
  const night = Date.now() - 86_400_000;
  return { board: scores.filter((s) => s.at > night).slice(0, 10), best: scores.slice(0, 10) };
}
export const stakes = () => ({ live: STAKES_LIVE, options: STAKES });
