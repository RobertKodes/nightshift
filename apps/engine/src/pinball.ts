import { createHash, createHmac, randomBytes, randomUUID } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { parseAbi } from "viem";
import { eth } from "./chain.js";
import { config } from "./config.js";
import { publicName, walletHandle } from "./names.js";
import { savedName } from "./players.js";
import { LOUNGE_GRACE_MS, LOUNGE_WAIT_MS, LoungeError, OwnGameError, type Expired } from "./chess.js";
import { ATTACK_DELAY, type Attack, type Input, type Landing, MAX_TICKS, SEGMENTS, Table, replay, segmentOf } from "./pinball/engine.js";

/**
 * Space Pinball duels: two players, the same luck, the same table, played at the same time, and what
 * each earns lands on the other's table (meteors, gravity surges). Each player streams their inputs
 * while they play and the server plays both tables with them on its own copies, with the very
 * engine the browser runs: only the attacks those copies send reach the rival, and each player says
 * where each one landed on their table (checked against what was really sent). The result is the
 * replay of each table with its inputs and those landings. A duel found through the queue is free;
 * a duel for IMD or $SHIFT is made by the challenge lobby (games-routes.ts) once both stakes are in
 * GameEscrow, for exactly those two wallets (createStaked), and its verdict goes to the escrow.
 */
export type Currency = "FREE" | "IMD" | "SHIFT";
/** An attack a table really sent (found by the server's copy) and the tick it is due on the rival's. */
type Sent = { kind: Attack; tick: number; due: number };
/** A game as the server plays it: the inputs streamed so far, stepped on its own Table. */
type Stream = { table: Table; log: Input[]; at: number; tick: number; seen: number };
/**
 * A game's luck as the server deals it: one salt per segment (0.5 s) of game time, HMAC(LUCK_KEY,
 * deal, segment), and the commitment to all of them (sha256), shown from the start. A player gets
 * each salt only shortly before their own stream reaches its segment (revealed()); everybody gets
 * them all once the game is settled, so the replay can be checked against the commitment.
 */
type Deal = { salts: number[]; hash: string };
type Player = {
  id: string; key: string; name: string; wallet: string | null; avatar: string | null; watching: number;
  /** An AI player (the arena's), shown as such to spectators. */
  agent?: boolean;
  x: number; y: number; s: Stream;
  /** What this table sent, found by the server: only these are relayed. */
  sent: Sent[];
  /** The rival's attacks as they landed here: number in the rival's `sent` → tick. */
  landed: Map<number, number>;
  /** Why this player's stream stopped counting (late, ahead of the clock, out of order). */
  broken: string | null;
  inputs: Input[] | null; solo: number | null; score: number | null; stats?: Record<string, number>; finishedAt?: number;
  /** How many salts this player's page says it holds: its frames carry the ones after those. */
  have: number;
};
export type Match = {
  id: string; deal: Deal; currency: Currency; stake: number; createdAt: number; startedAt: number | null;
  /** Both players were connected when the countdown ended: the luck starts coming out and the game is on. */
  go: boolean;
  /** Changes when a player joins or leaves, so each stream sends the faces again. */
  roster: number;
  players: Player[]; winner: string | null; draw: boolean; done: boolean; void: string | null;
  /** A staked duel: the escrow match id, when it starts without a missing player, and who hears the verdict. */
  escrow?: string; showBy?: number; onResult?: (r: { draw: boolean; winner: string | null }) => void;
  /** An open duel: since when its host has had no stream (null while connected); the lounge's grace period counts from it. */
  awayAt?: number | null;
  /** An open duel that closed unplayed, and why; or the older table its host was moved to (fold). */
  expired?: Expired; movedTo?: string;
};
/** An open free duel as the lounge lists it: the host's public name and face only. */
export type OpenPinball = { id: string; host: { name: string; avatar: string | null; agent?: boolean }; since: number; away: boolean; awayUntil: number | null };

const matches = new Map<string, Match>();
const listeners = new Map<string, Set<() => void>>();
/**
 * A staked duel starts only once both players are connected (both see the countdown). If they have
 * not both been at the table within this long after it was made, it is void: both stakes go back.
 */
export const STAKED_SHOW_MS = 15 * 60_000;
/** Why a staked duel was void before it started. */
export const STAKED_VOID = "You were not both at the table within 15 minutes: the duel is void and both stakes go back.";

/** Ticks per second. */
const TPS = 240;
/** Streamed inputs may run this far ahead of the server's clock (1 s)… */
const LOOKAHEAD = TPS;
/** …and arrive no later than this (2 s): a game is played as it happens, not worked out and sent later. */
const LAG = 2 * TPS;
/** A relayed attack may land up to this long (2 s) after it was due, for a slow link. */
const WINDOW = 2 * TPS;
/** A duel waits this long past the longest game for a missing log. */
const GRACE_MS = 30_000;
/** A finished game's log must arrive within this long of its end on the server's clock. */
const FINISH_MS = 10_000;
const clockTick = (startedAt: number) => Math.floor(((Date.now() - startedAt) * TPS) / 1000);
const GAME_MS = (MAX_TICKS / TPS) * 1000;
/**
 * A segment's salt goes out once the player's stream is committed (no input can be added any more)
 * to within this many ticks (0.75 s) of its start: enough for the page to have it before it gets
 * there on a 250 ms post cadence and an ordinary link, so a client never knows the luck more than
 * LUCK_LEAD + SEGMENT ticks (1.25 s) past what it can still change. The old whole-game seed let a
 * bot play out every future of the table before choosing its inputs.
 */
const LUCK_LEAD = 180;
/** The key the salts are drawn with: this process's own, never stored or sent (matches live in memory only). */
const LUCK_KEY = randomBytes(32);
function deal(id: string): Deal {
  const nonce = randomBytes(8).toString("hex");
  const salts = Array.from({ length: SEGMENTS }, (_, k) => createHmac("sha256", LUCK_KEY).update(`${id}:${nonce}:${k}`).digest().readUInt32BE(0));
  return { salts, hash: createHash("sha256").update(salts.join(",")).digest("hex") };
}
/** The first tick a stream can no longer change: after its last input, what it reported played, what the server stepped, what is too late. */
const committed = (s: Stream, clock: number) => Math.max(0, s.tick, (s.log.at(-1)?.[0] ?? -1) + 1, s.table.tick, clock - LAG);
/** The salts a player may hold now: every segment starting no later than LUCK_LEAD past where their stream is committed. */
const revealed = (d: Deal, s: Stream, clock: number) => d.salts.slice(0, Math.min(SEGMENTS, segmentOf(committed(s, clock) + LUCK_LEAD) + 1));
/** The salts from `have` on, as a frame or a reply carries them. */
const luckFrom = (salts: number[], have: unknown) => { const from = Math.min(salts.length, Number.isInteger(have) && (have as number) > 0 ? (have as number) : 0); return { from, salts: salts.slice(from) }; };

type Score = { name: string; score: number; at: number };
/**
 * Every verified score worth keeping: the best 200, kept across restarts (the owner keeps the scores
 * from before the audit fixes on the same boards).
 */
const boardFile = () => join(config.dataDir, "pinball.json");
/** What the arcade tells the community chat: every verified result, flagged when it tops a board. */
export type ArcadeEvent =
  | { kind: "duel"; a: Score; b: Score; winner: string | null; draw: boolean; record: boolean; tonightTop: boolean; keys?: [string | null, string | null] }
  | { kind: "solo"; run: Score; record: boolean; tonightTop: boolean; wallet?: string | null };
const arcade: ((e: ArcadeEvent) => void)[] = [];
export const onArcade = (f: (e: ArcadeEvent) => void) => { arcade.push(f); };
const tell = (e: ArcadeEvent) => { for (const f of arcade) try { f(e); } catch (err) { console.error("arcade", err); } };
/** Below this a result is never called a record in the community chat. */
const ANNOUNCE_MIN = 20_000;
/** Would this score be the new best, all-time and tonight? Read before it is recorded. */
function tops(kind: "duel" | "solo", score: number): { record: boolean; tonightTop: boolean } {
  const l = boards[kind], night = Date.now() - 86_400_000;
  const tonight = l.filter((s) => s.at > night)[0]?.score ?? 0;
  const big = score >= ANNOUNCE_MIN;
  return { record: big && score > (l[0]?.score ?? 0), tonightTop: big && score > tonight };
}

type Boards = { duel: Score[]; solo: Score[] };
let boards: Boards = (() => {
  try {
    const d = existsSync(boardFile()) ? JSON.parse(readFileSync(boardFile(), "utf8")) : {};
    const b = Array.isArray(d) ? { duel: d as Score[], solo: [] as Score[] } : { duel: (d.duel ?? []) as Score[], solo: (d.solo ?? []) as Score[] }; // the first file held duels only
    return { duel: best(b.duel), solo: best(b.solo) };
  } catch { return { duel: [], solo: [] }; }
})();
/** One spot per name (case-insensitive): it keeps that player's best score and when it was set. */
function best(l: Score[]): Score[] {
  const by = new Map<string, Score>();
  for (const s of l) { const k = s.name.trim().toLowerCase(), o = by.get(k); if (!o || s.score > o.score) by.set(k, s); }
  return [...by.values()].sort((x, y) => y.score - x.score).slice(0, 200);
}
function record(list: Score[], kind: keyof Boards = "duel"): void {
  boards[kind] = best([...boards[kind], ...list.filter((s) => s.score > 0)]);
  try { writeFileSync(boardFile(), JSON.stringify(boards)); } catch (e) { console.error("pinball board", e); }
}

/** A display name: letters, digits, space . - _, nothing the community guard would delete, and not one of ours (names.ts). */
export function cleanName(name: string, wallet?: string | null): string {
  // a signed-in player plays under the name saved on their wallet
  return savedName(wallet) ?? publicName(name, { max: 18 }) ?? walletHandle(wallet) ?? "Night crew";
}

/** NIGHT FROGS on Ethereum. */
const FROGS = (config.nft.address || "0x55b8c762f1b86fe1d5406edaaae0f8ecf3688a0c") as `0x${string}`;
const FROG_ABI = parseAbi(["function ownerOf(uint256) view returns (address)", "function tokenURI(uint256) view returns (string)"]);
const ART = /^\/games\/pinball\/frog-[0-4]\.webp$/;
/** The face shown to the other player: one of our own frogs, or a NIGHT FROG the signed-in wallet holds (checked on chain). */
async function face(avatar: string | null, wallet: string | null): Promise<string | null> {
  if (!avatar) return null;
  if (ART.test(avatar)) return avatar;
  const id = /^frog:(\d{1,5})$/.exec(avatar)?.[1];
  if (!id || !wallet) return null;
  const owner = await eth.readContract({ address: FROGS, abi: FROG_ABI, functionName: "ownerOf", args: [BigInt(id)] }).catch(() => null);
  return owner && owner.toLowerCase() === wallet.toLowerCase() ? `/api/pinball/frog/${Number(id)}` : null;
}
const images = new Map<number, string>();
/** A NIGHT FROG's own onchain image (SVG), read from its tokenURI once and kept. */
export async function frogImage(id: number): Promise<string | null> {
  if (!Number.isInteger(id) || id < 0 || id > 99_999) return null;
  const hit = images.get(id);
  if (hit) return hit;
  const uri = await eth.readContract({ address: FROGS, abi: FROG_ABI, functionName: "tokenURI", args: [BigInt(id)] }).catch(() => null);
  const data = (u: string, type: string) => !u.startsWith(`data:${type}`) ? null : u.slice(0, u.indexOf(",")).endsWith(";base64") ? Buffer.from(u.slice(u.indexOf(",") + 1), "base64").toString("utf8") : decodeURIComponent(u.slice(u.indexOf(",") + 1));
  try {
    const meta = uri ? data(uri, "application/json") : null;
    const image = meta ? JSON.parse(meta).image : null;
    const svg = typeof image === "string" ? data(image, "image/svg+xml") : null;
    if (!svg || svg.length > 300_000 || !svg.includes("<svg")) return null;
    if (images.size >= 600) images.clear();
    images.set(id, svg);
    return svg;
  } catch { return null; }
}

/** How long before the start both players get the first salts: just enough to draw the table. */
const SEED_LEAD = 400;
/** Live frames go out at most four times a second per match, however often players post. */
const EMIT_MS = 250;
const emitting = new Map<string, { last: number; timer: ReturnType<typeof setTimeout> | null }>();
function emit(m: Match): void {
  const e = emitting.get(m.id) ?? { last: 0, timer: null };
  emitting.set(m.id, e);
  if (e.timer) return;
  e.timer = setTimeout(() => { e.timer = null; e.last = Date.now(); for (const f of listeners.get(m.id) ?? []) f(); }, Math.max(0, e.last + EMIT_MS - Date.now()));
  e.timer.unref?.();
}
const rivalOf = (m: Match, p: Player) => m.players.find((x) => x !== p);
/**
 * What one player sees. The rival's verified score, stats, finish and where attacks landed on their
 * table stay hidden until the match is settled: nobody plays against a known number. Faces only when
 * asked (a stream's first frame, or after the players changed).
 */
const dealt = (m: Match) => m.go && !m.void && !!m.startedAt && Date.now() >= m.startedAt - SEED_LEAD;
/**
 * `seed` is the commitment to this deal's luck (sha256 of its salts), not the luck itself; `luck` is
 * the salts this player may hold so far, from the number their page says it has.
 */
const view = (m: Match, me?: string, faces = true) => ({
  id: m.id, escrow: m.escrow ?? null, seed: dealt(m) ? m.deal.hash : null, luck: luckOf(m, m.players.find((p) => p.id === me)), currency: m.currency, stake: m.stake, startedAt: m.startedAt, now: Date.now(),
  done: m.done, draw: m.draw, void: m.void, winner: m.players.find((p) => p.id === m.winner)?.name ?? null, winnerIsYou: !!me && m.winner === me,
  waitingSince: m.createdAt, expired: m.expired ?? null, movedTo: m.movedTo ?? null, showBy: m.showBy ?? null,
  players: m.players.map((p) => {
    const mine = p.id === me, open = mine || m.done;
    return {
      key: p.key, name: p.name, ...(faces ? { avatar: p.avatar } : {}), live: p.s.table.score, x: p.x, y: p.y,
      attacks: mine ? [] : p.sent.map((a, n) => ({ n, kind: a.kind, tick: a.tick, at: a.tick + ATTACK_DELAY })),
      score: open ? p.score : null, solo: open ? p.solo : null, stats: open ? p.stats ?? null : null, you: mine, finished: open && p.inputs !== null, connected: p.watching > 0,
      ...(mine && p.broken ? { error: p.broken } : {}),
    };
  }),
});
export type View = ReturnType<typeof view>;
/** A player's salts: none before the deal, then those their stream has reached, and all once the match is settled. */
function luckOf(m: Match, p: Player | undefined): { from: number; salts: number[] } | null {
  if (m.done && !m.void) return luckFrom(m.deal.salts, p?.have ?? 0);
  if (!p || !dealt(m) || m.done) return null;
  return luckFrom(revealed(m.deal, p.s, clockTick(m.startedAt!)), p.have);
}
/**
 * What a spectator sees: both tables as a rival sees them (live score, ball, attacks sent), the
 * verified scores once settled. The luck only after the match is over, so nobody can work out the
 * table ahead of the players (or for one of them).
 */
const watchView = (m: Match) => { const v = view(m); return { ...v, seed: m.done ? m.deal.hash : null, players: v.players.map((p) => ({ ...p, you: false })) }; };
export type WatchView = ReturnType<typeof watchView>;

/** A live stream of one match for one player; the first frame at once. Being connected is being ready. */
export function listen(id: string, me: string | undefined, f: (v: View) => void): () => void {
  const m = matches.get(id);
  if (!m) return () => {};
  const p = m.players.find((x) => x.id === me);
  if (p) p.watching++;
  if (p && isOpen(m) && m.players[0] === p) m.awayAt = null;
  if (m.escrow && !m.startedAt && !m.done && m.players.every((x) => x.watching > 0)) countdown(m);
  let roster = -1;
  const send = () => { const cur = matches.get(id); if (!cur) return; const faces = cur.roster !== roster; roster = cur.roster; f(view(cur, me, faces)); };
  const s = listeners.get(id) ?? new Set();
  s.add(send); listeners.set(id, s);
  send();
  return () => {
    s.delete(send);
    if (!p) return;
    p.watching--;
    // the host of an open duel is away: their game keeps its place for the grace period
    if (!p.watching && isOpen(m) && m.players[0] === p) m.awayAt = Date.now();
  };
}

/** A spectator's stream: the same frames as the players get, without counting as a player being there. */
export function watch(id: string, f: (v: WatchView) => void): (() => void) | null {
  if (!matches.has(id)) return null;
  const send = () => { const cur = matches.get(id); if (cur) f(watchView(cur)); };
  const s = listeners.get(id) ?? new Set();
  s.add(send); listeners.set(id, s);
  send();
  return () => { s.delete(send); };
}
export function getWatch(id: string): WatchView | null { const m = matches.get(id); return m ? watchView(m) : null; }
/**
 * What live betting reads of a duel (bets.ts): its clock, both live scores as the server plays
 * them, which tables are over, who is connected, and the verified verdict once settled. Also the
 * players' wallets (no bets from them); this never goes to a browser.
 */
export function betState(id: string) {
  const m = matches.get(id);
  if (!m || m.players.length !== 2) return null;
  return {
    startedAt: m.startedAt, go: m.go, durationMs: GAME_MS, done: m.done, draw: m.draw, void: m.void,
    winner: m.done && !m.draw && !m.void ? m.players.findIndex((p) => p.id === m.winner) : -1,
    currency: m.currency, stake: m.stake, escrow: m.escrow ?? null,
    players: m.players.map((p) => ({ name: p.name, agent: !!p.agent, wallet: p.wallet?.toLowerCase() ?? null, score: p.score ?? p.s.table.score, over: p.inputs !== null || p.s.table.over, connected: p.watching > 0, broken: p.broken !== null })),
  };
}
/** The duels being played now (the countdown included), for the spectators' list. No seat ever leaves here. */
export function live() {
  return [...matches.values()].filter((m) => !m.done && !m.void && m.startedAt !== null && m.players.length === 2).map((m) => ({
    id: m.id, currency: m.currency, stake: m.stake, startedAt: m.startedAt!,
    players: m.players.map((p) => ({ name: p.name, avatar: p.avatar, ...(p.agent ? { agent: true } : {}) })),
  }));
}

const stream = (d: Deal): Stream => ({ table: new Table(d.salts), log: [], at: 0, tick: 0, seen: 0 });
const fresh = (id: string, name: string, wallet: string | null, avatar: string | null, d: Deal): Player => ({
  id, key: randomBytes(4).toString("hex"), name, wallet, avatar, watching: 0, x: 558, y: 860, s: stream(d), sent: [], landed: new Map(), broken: null, inputs: null, solo: null, score: null, have: 0,
});

/** The VS screen and a countdown, the same for both. */
function countdown(m: Match): void {
  m.startedAt = Date.now() + 6_000;
  setTimeout(() => ready(m), 6_000 - SEED_LEAD).unref?.();
  emit(m);
}

/**
 * A duel for a stake held in GameEscrow, for exactly these two wallets (the escrow's player A and
 * B). Each attaches with the seat the lobby gives only to that wallet's signed-in session. The luck
 * stays hidden until the start, as in every duel. It starts once both are connected; if they are not
 * both there within STAKED_SHOW_MS it is void. A player who never plays a ball loses no stake: the
 * duel is void (a draw, both stakes back); one who played and stopped scores what the log shows.
 */
export function createStaked(o: { escrow: string; currency: "IMD" | "SHIFT"; stake: number; a: { wallet: string; name: string; agent?: boolean }; b: { wallet: string; name: string; agent?: boolean }; onResult: (r: { draw: boolean; winner: string | null }) => void }): { id: string; seats: Record<string, string> } {
  const id = randomBytes(5).toString("hex"), d = deal(id), pa = randomUUID(), pb = randomUUID();
  const m: Match = {
    id, deal: d, currency: o.currency, stake: o.stake, createdAt: Date.now(), startedAt: null, go: false, roster: 0, winner: null, draw: false, done: false, void: null,
    players: [{ ...fresh(pa, cleanName(o.a.name, o.a.wallet), o.a.wallet, "/games/pinball/frog-0.webp", d), ...(o.a.agent ? { agent: true } : {}) }, { ...fresh(pb, cleanName(o.b.name, o.b.wallet), o.b.wallet, "/games/pinball/frog-3.webp", d), ...(o.b.agent ? { agent: true } : {}) }],
    escrow: o.escrow, showBy: Date.now() + STAKED_SHOW_MS, onResult: o.onResult,
  };
  matches.set(id, m);
  setTimeout(() => {
    if (m.startedAt || m.done) return;
    m.done = true; m.draw = true; m.void = STAKED_VOID;
    try { m.onResult?.({ draw: true, winner: null }); } catch (e) { console.error("pinball stake result", e); }
    emit(m);
  }, STAKED_SHOW_MS).unref?.();
  return { id, seats: { [o.a.wallet.toLowerCase()]: pa, [o.b.wallet.toLowerCase()]: pb } };
}

/** A free duel waiting for its second player. */
const isOpen = (m: Match) => !m.done && !m.startedAt && !m.escrow && m.players.length === 1;
/** Its host is here (an open stream) and it has not waited too long: a rival may sit down now. */
const joinable = (m: Match) => isOpen(m) && m.players[0]!.watching > 0 && Date.now() - m.createdAt <= LOUNGE_WAIT_MS;
const sameWallet = (m: Match, wallet: string | null) => { const w = m.players[0]?.wallet; return !!wallet && !!w && w.toLowerCase() === wallet.toLowerCase(); };
/** A person's own open duel (the same wallet): never a game against themselves, and always said. */
const ownDuel = (m: Match, wallet: string | null, agent: boolean) => !agent && !m.players[0]!.agent && sameWallet(m, wallet);
/** Open duels, oldest first: the longest wait is served first. */
const openDuels = () => [...matches.values()].filter(isOpen).sort((a, b) => a.createdAt - b.createdAt);
/** A player's table made fresh for a deal (a reopened or a folded duel). */
const reset = (p: Player, d: Deal) => Object.assign(p, { s: stream(d), x: 558, y: 860, sent: [], landed: new Map(), broken: null, inputs: null, solo: null, score: null, have: 0 });
/** The rival sits down at an open duel: the VS screen and the countdown for both. */
function sit(m: Match, p: Player): void { m.players.push(p); m.roster++; m.awayAt = null; countdown(m); }

/**
 * Join the free queue: pairs with whoever has waited longest (their host here, not your own wallet),
 * else opens a duel in the lounge. A wallet that already has an open duel is told so, instead of
 * waiting on itself. Staked duels come from the challenge lobby. `agent` marks an AI player.
 */
export async function queue(name: string, wallet: string | null, currency: Currency, stake: number, avatar: string | null, agent = false): Promise<{ match: View; player: string }> {
  if (currency !== "FREE") throw new Error("Duels for IMD or $SHIFT are made through the challenge lobby.");
  stake = 0; // a free duel never carries a stake, whatever an old page sends
  const open = openDuels();
  if (open.some((m) => ownDuel(m, wallet, agent))) throw new OwnGameError();
  const clean = cleanName(name, wallet), pic = await face(avatar, wallet);
  const pid = randomUUID();
  // the face lookup may take a moment: whoever is still open then
  const m = openDuels().find((x) => joinable(x) && !sameWallet(x, wallet));
  if (m) {
    sit(m, { ...fresh(pid, clean, wallet, pic, m.deal), ...(agent ? { agent: true } : {}) });
    return { match: view(m, pid), player: pid };
  }
  const id = randomBytes(5).toString("hex"), d = deal(id);
  const nm: Match = { id, deal: d, currency, stake, createdAt: Date.now(), startedAt: null, go: false, roster: 0, players: [{ ...fresh(pid, clean, wallet, pic, d), ...(agent ? { agent: true } : {}) }], winner: null, draw: false, done: false, void: null, awayAt: Date.now() };
  matches.set(id, nm);
  return { match: view(nm, pid), player: pid };
}

/**
 * Sit down at one open duel from the lounge, by its id: the same checks as the queue (not your own
 * wallet's, still open, its host here). The wallet's own open duel elsewhere is closed first.
 */
export async function joinOpen(id: string, name: string, wallet: string | null, avatar: string | null): Promise<{ match: View; player: string }> {
  const check = () => {
    const m = matches.get(id);
    if (!m || m.escrow) throw new LoungeError(404, "This duel is not in the lounge any more.");
    if (m.startedAt || m.players.length > 1) throw new LoungeError(409, "Someone else just took this duel. Pick another one.");
    if (m.done) throw new LoungeError(410, m.expired === "timeout" ? "This duel waited too long and closed." : "This duel has closed.");
    if (sameWallet(m, wallet)) throw new OwnGameError();
    if (m.players[0]!.watching === 0) throw new LoungeError(409, "The host stepped away for a moment. Their duel opens again when they are back.");
    if (!joinable(m)) throw new LoungeError(410, "This duel waited too long and closed.");
    return m;
  };
  check();
  const pic = await face(avatar, wallet);
  const m = check();
  for (const o of openDuels()) if (ownDuel(o, wallet, false)) { o.done = true; emit(o); matches.delete(o.id); }
  const pid = randomUUID();
  sit(m, fresh(pid, cleanName(name, wallet), wallet, pic, m.deal));
  return { match: view(m, pid), player: pid };
}

/** Close an open duel from the lounge: by its host's seat token, or by the signed-in wallet that opened it. */
export function cancel(id: string, player: string | null, wallet: string | null): void {
  const m = matches.get(id);
  if (!m || !isOpen(m)) throw new LoungeError(404, "This duel is not open any more.");
  if (!(player && m.players[0]!.id === player) && !sameWallet(m, wallet)) throw new LoungeError(403, "Only the player who opened this duel can close it.");
  m.done = true; emit(m); matches.delete(id);
}

/** The lounge's free duels: each open one and since when it waits (away within the grace period); `mine`, the signed-in wallet's. */
export function lounge(wallet: string | null = null): { open: OpenPinball[]; waiting: number; mine: string[] } {
  const open: OpenPinball[] = [], mine: string[] = [];
  const all = openDuels();
  for (const m of all) {
    const host = m.players[0]!, away = host.watching === 0;
    if (sameWallet(m, wallet)) mine.push(m.id);
    if (open.length < 100) open.push({ id: m.id, host: { name: host.name, avatar: host.avatar, ...(host.agent ? { agent: true } : {}) }, since: m.createdAt, away, awayUntil: away && m.awayAt ? m.awayAt + LOUNGE_GRACE_MS : null });
  }
  return { open, waiting: all.filter((m) => m.players[0]!.watching > 0).length, mine };
}

/**
 * The lounge's upkeep: an open duel whose host is gone past the grace period, or that waited too
 * long, closes (kept for its host to be told why); two open duels whose hosts are both here become
 * one, the newer host moving to the older table (movedTo), so two players never wait apart.
 */
export function sweepOpen(): void {
  const now = Date.now();
  for (const m of openDuels()) {
    const expired: Expired | null = now - m.createdAt > LOUNGE_WAIT_MS ? "timeout" : m.players[0]!.watching === 0 && m.awayAt && now - m.awayAt > LOUNGE_GRACE_MS ? "away" : null;
    if (!expired) continue;
    m.done = true; m.expired = expired;
    m.void = expired === "away" ? "Your duel closed: you were away for more than 90 seconds. Open a new one from the lounge." : "Nobody joined in 30 minutes, so your duel closed. Open a new one from the lounge.";
    emit(m);
  }
  const ready = openDuels().filter(joinable);
  for (let i = 0; i < ready.length; i++) {
    const a = ready[i]!;
    for (let j = i + 1; j < ready.length && isOpen(a); j++) {
      const b = ready[j]!, mover = b.players[0]!;
      if (!isOpen(b) || mover.agent || sameWallet(a, mover.wallet)) continue;
      b.done = true; b.movedTo = a.id;
      // the same player object, on the older table's deal: their open stream still counts them as here
      reset(mover, a.deal);
      sit(a, mover); emit(b);
    }
  }
}
setInterval(sweepOpen, 2_000).unref();

/**
 * The end of the countdown: both players must be connected. If one never came, the match is
 * dissolved; the one who is there waits for a new rival on a fresh deal, or is told so.
 */
function ready(m: Match): void {
  if (m.done || !m.startedAt || m.go) return;
  // a staked duel is played whoever came: a missing player's table simply scores 0
  if (m.escrow) { m.go = true; emit(m); return; }
  const here = m.players.filter((p) => p.watching > 0);
  if (here.length === 2) { m.go = true; emit(m); return; }
  if (here.length === 1) {
    const p = here[0]!;
    m.deal = deal(m.id); m.startedAt = null; m.createdAt = Date.now(); m.roster++; m.awayAt = null;
    // the same player object: its open stream still counts it as connected; the duel is open in the lounge again
    reset(p, m.deal);
    m.players = [p];
  } else { m.void = "Your rival never connected."; m.done = true; }
  emit(m);
}

export function leave(id: string, player: string): void {
  const m = matches.get(id);
  if (m && !m.escrow && !m.startedAt && m.players[0]?.id === player) { m.done = true; emit(m); matches.delete(id); }
}

export function get(id: string, me?: string) { const m = matches.get(id); return m ? view(m, me) : null; }
/** Is this player in this match? */
export const inMatch = (id: string, me: string) => !!matches.get(id)?.players.some((p) => p.id === me);

/** Inputs exactly as recorded: [tick, left, right, plunger], ticks in order. */
function parseInputs(v: unknown, max: number): Input[] {
  if (!Array.isArray(v) || v.length > max) throw new Error("bad inputs");
  return v.map((x) => {
    if (!Array.isArray(x) || x.length !== 4 || !Number.isInteger(x[0]) || x[0] < 0 || x[0] > MAX_TICKS || ![x[1], x[2], x[3]].every((b) => b === 0 || b === 1)) throw new Error("bad inputs");
    return [x[0], x[1], x[2], x[3]] as Input;
  });
}

/**
 * Takes the inputs streamed since the last post. `from` is where they start in the log, so a post
 * resent after a lost reply is not counted twice. Each new input must come after the last, while
 * the game runs, no more than LOOKAHEAD ahead of the server's clock and no more than LAG behind it,
 * and never before a tick the player already reported played (the luck is revealed on that).
 */
function ingest(s: Stream, chunk: Input[], from: number, clock: number): void {
  if (!Number.isInteger(from) || from < 0 || from > s.log.length) throw new Error("the input stream has a gap");
  chunk.forEach((x, i) => {
    const j = from + i;
    if (j < s.log.length) { if (s.log[j]!.join() !== x.join()) throw new Error("the input stream does not match what was sent before"); return; }
    if (s.table.over) throw new Error("inputs after the game ended");
    if (x[0] <= (s.log.at(-1)?.[0] ?? -1)) throw new Error("inputs out of order");
    if (x[0] > clock + LOOKAHEAD) throw new Error("inputs from later than the game has run");
    if (x[0] < clock - LAG || x[0] < s.table.tick || x[0] < s.tick) throw new Error("inputs sent too late: this game no longer counts");
    s.log.push(x);
  });
}
/** A whole log: what was streamed, then what had not been sent yet (the same rules apply to it). */
function ingestAll(s: Stream, full: Input[], clock: number): void {
  if (full.length < s.log.length || s.log.some((x, i) => x.join() !== full[i]!.join())) throw new Error("the inputs do not match what was streamed during the game");
  ingest(s, full.slice(s.log.length), s.log.length, clock);
}

/** Steps a streamed game up to `to`, the inputs applied exactly as replay() applies them. */
function stepTo(s: Stream, to: number): void {
  const t = s.table;
  while (t.tick < to && !t.over) {
    while (s.at < s.log.length && s.log[s.at]![0] <= t.tick) { const [, l, r, p] = s.log[s.at]!; t.input = { left: l ? 1 : 0, right: r ? 1 : 0, plunger: p ? 1 : 0 }; s.at++; }
    t.step();
  }
}
/** How far a player is: what they reported, or (nothing older can arrive any more) the clock less LAG. */
const reached = (m: Match, p: Player) => p.inputs ? MAX_TICKS : Math.min(MAX_TICKS, Math.max(p.s.tick, clockTick(m.startedAt ?? 0) - LAG));
const land = (p: Player, n: number, kind: Attack, at: number) => { p.landed.set(n, at); p.s.table.receive(kind, at); };

/**
 * Brings both server tables forward. A table steps no further than its player has got, and waits
 * just before an attack due on it until its player says where it landed, or until the window for
 * that has passed: then it lands where it was due. What a table sends is found here, and only that
 * is relayed to the rival.
 */
function advance(m: Match): void {
  if (!m.go || m.players.length < 2) return;
  for (const p of m.players) {
    const o = rivalOf(m, p)!, far = reached(m, p);
    let to = far;
    o.sent.forEach((a, n) => {
      if (p.landed.has(n)) return;
      if (far > a.due + WINDOW) land(p, n, a.kind, a.due);
      else to = Math.min(to, a.due - 1);
    });
    stepTo(p.s, to);
    // due on the rival ATTACK_DELAY later, or just after where the rival is if it is already past that
    for (const ev = p.s.table.events; p.s.seen < ev.length; p.s.seen++) { const e = ev[p.s.seen]!; if (e.send) p.sent.push({ kind: e.send, tick: e.tick, due: Math.max(e.tick + ATTACK_DELAY, reached(m, o) + 1) }); }
  }
}

/**
 * Where the rival's attacks landed on this player's table, as the player says. Each must answer an
 * attack the rival's table really sent, no earlier than it was due to fly, no later than the window
 * allows, and not in the past of the server's copy. Anything else is ignored.
 */
function place(m: Match, p: Player, raw: unknown): void {
  const o = rivalOf(m, p);
  if (!o || !Array.isArray(raw)) return;
  for (const x of raw.slice(0, 64)) {
    const n = Number((x as { n?: unknown })?.n), at = Number((x as { at?: unknown })?.at), a = o.sent[n];
    if (!Number.isInteger(n) || !Number.isInteger(at) || !a || p.landed.has(n)) continue;
    if (at < a.tick + ATTACK_DELAY || at > a.due + WINDOW || at <= p.s.table.tick) continue;
    land(p, n, a.kind, at);
  }
}
/** A player's own game: their inputs and the rival's attacks where they landed. */
const own = (m: Match, p: Player, log = p.inputs ?? p.s.log) => {
  const o = rivalOf(m, p);
  const landings: Landing[] = [...p.landed].map(([n, at]) => ({ kind: o!.sent[n]!.kind, at }));
  return replay(m.deal.salts, log, o ? landings : []);
};

const num = (v: unknown, lo: number, hi: number, d: number) => (typeof v === "number" && Number.isFinite(v) ? Math.max(lo, Math.min(hi, v)) : d);
/** A tick a player reports: never ahead of the clock by more than LOOKAHEAD. */
function report(p: Player, v: unknown, clock: number): void {
  if (!Number.isInteger(v)) return;
  if ((v as number) > clock + LOOKAHEAD) throw new Error("ahead of the match clock");
  p.s.tick = Math.max(p.s.tick, Math.min(MAX_TICKS, v as number));
}

/**
 * A post during play: the inputs since the last one, where attacks landed, the ball for the rival's
 * minimap, and how many salts the page holds. The reply (and the player's next frame) carries the
 * salts its stream has now reached.
 */
export function progress(id: string, player: string, live: { inputs?: unknown; from?: unknown; tick?: unknown; landed?: unknown; x?: unknown; y?: unknown; have?: unknown }): { luck: { from: number; salts: number[] } | null } {
  const m = matches.get(id);
  const p = m?.players.find((x) => x.id === player);
  // nothing to take before the start (a post from the countdown is simply not needed)
  if (!m || !p || m.done || p.inputs || !m.go || !m.startedAt || Date.now() < m.startedAt) return { luck: m && p ? luckOf(m, p) : null };
  if (p.broken) throw new Error(p.broken);
  const clock = clockTick(m.startedAt);
  try {
    if (clock > MAX_TICKS + LOOKAHEAD) throw new Error("the game is over");
    advance(m);
    const chunk = parseInputs(live.inputs ?? [], 400);
    ingest(p.s, chunk, live.from === undefined ? p.s.log.length : Number(live.from), clock);
    place(m, p, live.landed);
    report(p, live.tick, clock);
  } catch (e) { p.broken = (e as Error).message; emit(m); throw e; }
  p.x = num(live.x, 0, 600, p.x); p.y = num(live.y, 0, 920, p.y);
  p.have = Math.round(num(live.have, 0, SEGMENTS, p.have));
  advance(m);
  emit(m);
  return { luck: luckOf(m, p) };
}

/** A finished game: the whole log (it must be what was streamed), and the last landings. Its own replay is shown at once. */
export function finish(id: string, player: string, body: { inputs?: unknown; landed?: unknown; tick?: unknown }): { solo: number } {
  const m = matches.get(id);
  const p = m?.players.find((x) => x.id === player);
  if (!m || !p) throw new Error("no such match");
  if (p.inputs) return { solo: p.solo ?? 0 };
  if (!m.go || !m.startedAt || Date.now() < m.startedAt) throw new Error("the match has not started");
  if (m.done) throw new Error("the match is over");
  if (p.broken) throw new Error(p.broken);
  const o = rivalOf(m, p)!;
  try {
    const clock = clockTick(m.startedAt);
    const full = parseInputs(body.inputs, 20_000);
    advance(m);
    ingestAll(p.s, full, clock);
    place(m, p, body.landed);
    report(p, body.tick, clock);
    advance(m);
    // attacks due inside this game that were never placed land where they were due; the rest came after it ended
    let r = own(m, p);
    for (let late = o.sent.flatMap((a, n) => (!p.landed.has(n) && a.due <= r.ticks ? [n] : [])); late.length; late = o.sent.flatMap((a, n) => (!p.landed.has(n) && a.due <= r.ticks ? [n] : []))) {
      for (const n of late) land(p, n, o.sent[n]!.kind, o.sent[n]!.due);
      r = own(m, p);
    }
    o.sent.forEach((a, n) => { if (!p.landed.has(n)) land(p, n, a.kind, a.due); });
    // the log comes when the game ends on the server's clock, not before it could have been played, not long after
    const end = (r.ticks / TPS) * 1000, elapsed = Date.now() - m.startedAt;
    if (elapsed < end - 2_000) throw new Error("inputs from later than the match has run");
    if (elapsed > end + FINISH_MS) throw new Error("too late: the game ended on the match clock more than 10 s ago");
    p.inputs = p.s.log; p.solo = r.score; p.finishedAt = Date.now();
  } catch (e) { p.broken = (e as Error).message; emit(m); throw e; }
  advance(m);
  settle(m);
  return { solo: p.solo };
}

/**
 * Both done (or one silent past the longest game): each table is replayed with its inputs and the
 * rival's attacks where they landed. Each landing answers an attack the rival's replay really sent;
 * the server checked that live, and checks it again here until nothing changes.
 */
function settle(m: Match): void {
  const [a, b] = m.players;
  if (!a || !b || m.done || !m.go) { emit(m); return; }
  if ((!a.inputs || !b.inputs) && Date.now() < (m.startedAt ?? 0) + GAME_MS + GRACE_MS) { emit(m); return; }
  advance(m);
  for (const p of [a, b]) { const o = rivalOf(m, p)!; o.sent.forEach((x, n) => { if (!p.landed.has(n)) p.landed.set(n, x.due); }); }
  let r = [own(m, a), own(m, b)];
  for (let round = 0; round < 6; round++) {
    let changed = false;
    for (const [i, p] of [a, b].entries()) {
      const sends = r[i]!.events.filter((e) => e.send), o = rivalOf(m, p)!;
      for (const n of [...o.landed.keys()]) { const s = p.sent[n], e = sends[n]; if (!s || !e || e.send !== s.kind || e.tick !== s.tick) { o.landed.delete(n); changed = true; } }
    }
    if (!changed) break;
    r = [own(m, a), own(m, b)];
  }
  a.score = a.inputs ? r[0]!.score : 0; b.score = b.inputs ? r[1]!.score : 0;
  a.stats = r[0]!.stats; b.stats = r[1]!.stats;
  m.done = true;
  // a staked duel where a player never played a ball (never streamed an input) is void: nobody loses a stake by not being there
  const never = (p: Player) => !p.inputs && p.s.log.length === 0;
  m.draw = a.score === b.score || (!!m.escrow && (never(a) || never(b)));
  m.winner = m.draw ? null : a.score > b.score ? a.id : b.id;
  // a match with one log is no duel: no board, no announcement
  if (a.inputs && b.inputs) {
    const flags = tops("duel", Math.max(a.score, b.score));
    record([a, b].map((p) => ({ name: p.name, score: p.score ?? 0, at: p.finishedAt ?? Date.now() })));
    tell({ kind: "duel", a: { name: a.name, score: a.score, at: Date.now() }, b: { name: b.name, score: b.score, at: Date.now() }, winner: m.players.find((p) => p.id === m.winner)?.name ?? null, draw: m.draw, ...flags, keys: [a.agent ? null : a.wallet?.toLowerCase() ?? null, b.agent ? null : b.wallet?.toLowerCase() ?? null] });
  }
  // the verified verdict of a staked duel, by wallet, to the escrow (signed there after its own checks)
  if (m.onResult) try { m.onResult({ draw: m.draw, winner: m.draw ? null : m.players.find((p) => p.id === m.winner)?.wallet ?? null }); } catch (e) { console.error("pinball stake result", e); }
  emit(m);
}

setInterval(() => {
  for (const m of matches.values()) {
    if (!m.done && m.players.length === 2) settle(m);
    if (Date.now() - m.createdAt > 3_600_000) { matches.delete(m.id); listeners.delete(m.id); emitting.delete(m.id); }
  }
}, 20_000).unref();

/** The boards: tonight's (last 24 hours) and all-time best verified scores, duels and solo runs. */
export function board(): { board: Score[]; best: Score[]; solo: Score[]; soloBest: Score[] } {
  const night = Date.now() - 86_400_000;
  // the old shared default name is nobody's: no row for it (players without a name play under their own handle)
  const named = (l: Score[]) => l.filter((s) => !/^\s*(night crew)?\s*$/i.test(s.name));
  const top = (l: Score[]) => [named(l).filter((s) => s.at > night).slice(0, 10), named(l).slice(0, 10)] as const;
  const [board, best] = top(boards.duel), [solo, soloBest] = top(boards.solo);
  return { board, best, solo, soloBest };
}

/**
 * Solo runs for the solo board. The server deals the luck when the run starts and its clock runs the
 * game; one open run per player (wallet or IP), so nobody shops for a lucky table. The inputs are
 * streamed while the run is played, under the same rules as a duel, each reply carrying the salts the
 * stream has reached; at the end the whole log must be what was streamed and arrive when the game
 * ends: only the replayed score counts, and all the salts come back to check it by.
 */
type Run = { deal: Deal; name: string; who: string; startedAt: number; s: Stream; done: boolean; score?: number };
const runs = new Map<string, Run>();
const openRun = new Map<string, string>(); // who → run id
/** A run is open for the longest game and a little more. */
const RUN_MS = GAME_MS + 15_000;
export function soloStart(name: string, who: string): { id: string; seed: string; luck: { from: number; salts: number[] }; startedAt: number; now: number } {
  const now = Date.now();
  const busy = runs.get(openRun.get(who) ?? "");
  if (busy && !busy.done && now - busy.startedAt < RUN_MS) throw new Error(`Your last run is still open for ${Math.ceil((busy.startedAt + RUN_MS - now) / 1000)} s: finish it, or play this one off the board.`);
  if (runs.size > 5_000) for (const [k, r] of runs) if (now - r.startedAt > RUN_MS) { runs.delete(k); if (openRun.get(r.who) === k) openRun.delete(r.who); }
  const id = randomBytes(6).toString("hex"), d = deal(id), s = stream(d);
  runs.set(id, { deal: d, name: cleanName(name), who, startedAt: now, s, done: false });
  openRun.set(who, id);
  return { id, seed: d.hash, luck: { from: 0, salts: revealed(d, s, 0) }, startedAt: now, now };
}
const liveRun = (id: string): Run => {
  const r = runs.get(id);
  if (!r || r.done) throw new Error("no such run");
  if (Date.now() - r.startedAt > RUN_MS) { r.done = true; throw new Error("this run has expired"); }
  return r;
};
export function soloProgress(id: string, body: { inputs?: unknown; from?: unknown; tick?: unknown; have?: unknown }): { luck: { from: number; salts: number[] } } {
  const r = liveRun(id), clock = clockTick(r.startedAt);
  try {
    if (clock > MAX_TICKS + LOOKAHEAD) throw new Error("the game is over");
    stepTo(r.s, Math.max(r.s.tick, clock - LAG));
    ingest(r.s, parseInputs(body.inputs ?? [], 400), body.from === undefined ? r.s.log.length : Number(body.from), clock);
    if (Number.isInteger(body.tick)) { if ((body.tick as number) > clock + LOOKAHEAD) throw new Error("ahead of the run's clock"); r.s.tick = Math.max(r.s.tick, Math.min(MAX_TICKS, body.tick as number)); }
  } catch (e) { r.done = true; openRun.delete(r.who); throw e; }
  return { luck: luckFrom(revealed(r.deal, r.s, clock), body.have) };
}
export function soloFinish(id: string, inputs: unknown): { score: number; rank: number | null; luck: number[] } {
  const r = liveRun(id);
  r.done = true; openRun.delete(r.who);
  const clock = clockTick(r.startedAt);
  stepTo(r.s, Math.max(r.s.tick, clock - LAG));
  ingestAll(r.s, parseInputs(inputs, 20_000), clock);
  const g = replay(r.deal.salts, r.s.log);
  // the game's own length on the run's clock: not finished before it could have been played, nor long after
  const end = (g.ticks / TPS) * 1000, elapsed = Date.now() - r.startedAt;
  if (elapsed < end - 2_000) throw new Error("inputs from later than the run has lasted");
  if (elapsed > end + FINISH_MS) throw new Error("too late: the game ended more than 10 s ago");
  r.score = g.score;
  const flags = tops("solo", g.score);
  record([{ name: r.name, score: g.score, at: Date.now() }], "solo");
  // the signed-in wallet that played it (an IP-keyed guest run has none), for the weekly prizes
  if (g.score > 0) tell({ kind: "solo", run: { name: r.name, score: g.score, at: Date.now() }, ...flags, wallet: /^0x[0-9a-fA-F]{40}$/.test(r.who) ? r.who.toLowerCase() : null });
  const i = boards.solo.findIndex((s) => s.score === g.score && s.name === r.name);
  return { score: g.score, rank: i >= 0 ? i + 1 : null, luck: r.deal.salts };
}
/** Free duels here; staked duels have their own lobby (GET /api/games/escrow for the limits). */
export const stakes = () => ({ free: true, staked: "/api/games/escrow" });
