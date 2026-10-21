import type { IncomingMessage, ServerResponse } from "node:http";
import { clientIp } from "./auth.js";
import { type ChessGames, type TimeControl, chess } from "./chess.js";
import * as pinball from "./pinball.js";
import { type PoolGames, pool } from "./pool.js";
import { type PokerGames, poker } from "./poker.js";
import { type LiveGame, liveGames } from "./spectate.js";

/**
 * The Game Room lounge: one feed of everything there is to join or watch. Every free game waiting
 * for a rival (both games, with its host's public name, rating and since when it waits), how many
 * wait per time control, the open staked challenges from the escrow lobby, and the games being
 * played now. Joining sits you down at one open game by its id; "play anyone" takes whoever waits,
 * in any time control. The feed carries names and ratings only: never a wallet or a seat token.
 */
export type OpenGame = {
  game: "chess" | "pinball" | "pool" | "poker"; id: string; tc: TimeControl | null; any: boolean; rules?: string;
  host: { name: string; rating: number | null; avatar?: string | null; agent?: boolean; level?: number };
  since: number; away: boolean; awayUntil: number | null;
};
export type Lounge = {
  now: number; open: OpenGame[];
  waiting: { chess: Record<TimeControl | "any", number>; pinball: number; pool: number; poker: number };
  challenges: unknown[]; live: LiveGame[];
  /** The open games the signed-in wallet opened (another tab, a lost page): shown as its own, with Cancel. */
  mine: { game: "chess" | "pinball" | "pool" | "poker"; id: string }[];
};
type Pinball = Pick<typeof pinball, "lounge" | "queue" | "joinOpen" | "cancel">;
type Pool = Pick<PoolGames, "lounge" | "queue" | "join" | "cancel">;
type Poker = Pick<PokerGames, "lounge" | "queue" | "join" | "cancel">;
export type Sources = { chess: ChessGames; pinball: Pinball; pool?: Pool; poker?: Poker; challenges: () => unknown[]; live: () => LiveGame[] };
const defaults = (challenges: () => unknown[]): Sources => ({ chess, pinball, pool, poker, challenges, live: liveGames });

/** The lounge as one wallet (or a guest, null) sees it. */
export function lounge(src: Sources, wallet: string | null = null): Lounge {
  const c = src.chess.lounge(wallet), p = src.pinball.lounge(wallet), q = src.pool?.lounge(wallet) ?? { open: [], waiting: 0, mine: [] }, k = src.poker?.lounge(wallet) ?? { open: [], waiting: 0, mine: [] };
  const open: OpenGame[] = [
    ...c.open.map((g) => ({ game: "chess" as const, ...g })),
    ...p.open.map((g) => ({ game: "pinball" as const, id: g.id, tc: null, any: false, host: { name: g.host.name, rating: null, avatar: g.host.avatar, ...(g.host.agent ? { agent: true } : {}) }, since: g.since, away: g.away, awayUntil: g.awayUntil })),
    ...q.open.map((g) => ({ game: "pool" as const, id: g.id, tc: null, any: false, rules: g.rules, host: g.host, since: g.since, away: g.away, awayUntil: g.awayUntil })),
    ...k.open.map((g) => ({ game: "poker" as const, id: g.id, tc: null, any: false, host: g.host, since: g.since, away: g.away, awayUntil: g.awayUntil })),
  ].sort((a, b) => a.since - b.since);
  let challenges: unknown[] = [];
  try { challenges = src.challenges().slice(0, 30); } catch { /* the escrow lobby is optional here */ }
  return {
    now: Date.now(), open, waiting: { chess: c.waiting, pinball: p.waiting, pool: q.waiting, poker: k.waiting }, challenges, live: src.live().slice(0, 30),
    mine: [...c.mine.map((id) => ({ game: "chess" as const, id })), ...p.mine.map((id) => ({ game: "pinball" as const, id })), ...q.mine.map((id) => ({ game: "pool" as const, id })), ...k.mine.map((id) => ({ game: "poker" as const, id }))],
  };
}

type Context = {
  json(res: ServerResponse, status: number, body: unknown): void;
  body(req: IncomingMessage, max?: number): Promise<Record<string, unknown>>;
  limited(req: IncomingMessage, key: string, n: number, ms: number): boolean;
  owner: string | null;
  /** The escrow lobby's open challenges (games-routes.ts), or the whole set of sources (tests). */
  challenges?: () => unknown[]; sources?: Sources;
};

/** Lounge streams per IP and in all: a page needs one. */
const PER_IP = 3, TOTAL = 2_000;
const perIp = new Map<string, number>();
let total = 0;
/** Each open stream: its wallet and how to send it a frame. One shared timer builds the frames. */
const subscribers = new Set<{ wallet: string | null; src: Sources; last: string; send(v: Lounge): void }>();
let timer: ReturnType<typeof setInterval> | null = null;
/** At most one frame a second, and only when something changed (the clock alone is no change). */
function pump() {
  if (!subscribers.size) { if (timer) clearInterval(timer); timer = null; return; }
  const shared = new Map<Sources, Lounge>();
  for (const s of subscribers) {
    let v: Lounge;
    try { v = s.wallet ? lounge(s.src, s.wallet) : shared.get(s.src) ?? lounge(s.src); } catch { continue; }
    if (!s.wallet) shared.set(s.src, v);
    const key = JSON.stringify({ ...v, now: 0 });
    if (key === s.last) continue;
    s.last = key; s.send(v);
  }
}
export const loungeStreams = () => ({ total, subscribers: subscribers.size });

function stream(req: IncomingMessage, res: ServerResponse, ctx: Context, src: Sources): boolean {
  const ip = clientIp(req);
  if ((perIp.get(ip) ?? 0) >= PER_IP || total >= TOTAL) { ctx.json(res, 429, { error: "Too many live connections" }); return true; }
  perIp.set(ip, (perIp.get(ip) ?? 0) + 1); total++;
  res.writeHead(200, { "Content-Type": "text/event-stream", "Cache-Control": "no-cache, no-transform", Connection: "keep-alive", "X-Accel-Buffering": "no" });
  let closed = false, blocked = false;
  const sub = {
    wallet: ctx.owner, src, last: "",
    // a reader that does not keep up misses frames (the next one has everything), and is dropped past the limit
    send: (v: Lounge) => { if (blocked) { sub.last = ""; return; } write(`data: ${JSON.stringify(v)}\n\n`); },
  };
  const close = () => {
    if (closed) return; closed = true; clearInterval(ping); subscribers.delete(sub);
    res.off("drain", drain); res.off("close", close); res.off("error", close);
    const n = (perIp.get(ip) ?? 1) - 1; if (n > 0) perIp.set(ip, n); else perIp.delete(ip);
    total--;
    res.end();
  };
  const write = (data: string) => {
    if (closed) return;
    if (res.writableLength > 256 * 1024 || res.destroyed) { close(); return; }
    try { blocked = !res.write(data); } catch { close(); }
  };
  const drain = () => { blocked = false; };
  const ping = setInterval(() => { if (blocked) close(); else write(": ping\n\n"); }, 20_000);
  res.on("drain", drain); res.on("close", close); res.on("error", close);
  const first = lounge(src, ctx.owner);
  sub.last = JSON.stringify({ ...first, now: 0 });
  write(`data: ${JSON.stringify(first)}\n\n`);
  if (!closed) { subscribers.add(sub); timer ??= setInterval(pump, 1_000); timer.unref?.(); }
  return true;
}

const GAMES = new Set(["chess", "pinball", "pool", "poker"]);
const ID = /^[a-f0-9]{1,40}$/;

/** /api/games/lounge, …/events, …/join, …/any, …/cancel. Call from the games routes, before their own limiter. */
export async function loungeRoutes(req: IncomingMessage, res: ServerResponse, p: string, ctx: Context): Promise<boolean> {
  if (p !== "/api/games/lounge" && !p.startsWith("/api/games/lounge/")) return false;
  const { json, body, limited, owner } = ctx;
  const src = ctx.sources ?? defaults(ctx.challenges ?? (() => []));
  const reply = (status: number, value: unknown) => { json(res, status, value); return true; };
  try {
    if (p === "/api/games/lounge" || p === "/api/games/lounge/events") {
      if (req.method !== "GET") return reply(405, { error: "Method not allowed" });
      if (p.endsWith("/events")) {
        if (limited(req, "games-lounge-events", 30, 60_000)) return reply(429, { error: "slow down" });
        return stream(req, res, ctx, src);
      }
      if (limited(req, "games-lounge", 120, 60_000)) return reply(429, { error: "slow down" });
      return reply(200, lounge(src, owner));
    }
    if (req.method !== "POST") return reply(405, { error: "Method not allowed" });
    const action = p.slice("/api/games/lounge/".length);
    if (!["join", "any", "cancel"].includes(action)) return reply(404, { error: "No such lounge route" });
    // the same budget as the queues: joining is finding a rival
    if (limited(req, action === "cancel" ? "lounge-cancel" : "lounge-join", action === "cancel" ? 30 : 20, action === "cancel" ? 60_000 : 600_000)) return reply(429, { error: "Too many tries. Try again shortly." });
    const b = await body(req, 2_000);
    const game = String(b.game ?? ""), name = String(b.name ?? ""), avatar = typeof b.avatar === "string" ? b.avatar : null;
    if (!GAMES.has(game)) return reply(400, { error: "Choose chess, pinball, pool or poker" });
    if (game === "pool" && !src.pool) return reply(404, { error: "No pool tables here" });
    if (game === "poker" && !src.poker) return reply(404, { error: "No poker tables here" });
    if (action === "any") {
      if (game === "chess") return reply(200, { game, ...src.chess.queue(name, owner, "any") });
      if (game === "pool") return reply(200, { game, ...src.pool!.queue(name, owner, b.rules === "quick" ? "quick" : "wpa") });
      if (game === "poker") return reply(200, { game, ...src.poker!.queue(name, owner) });
      return reply(200, { game, ...await src.pinball.queue(name, owner, "FREE", 0, avatar) });
    }
    const id = String(b.id ?? "");
    if (!ID.test(id)) return reply(404, { error: "No such game" });
    if (action === "join") {
      if (game === "chess") return reply(200, { game, ...src.chess.join(id, name, owner) });
      if (game === "pool") return reply(200, { game, ...src.pool!.join(id, name, owner) });
      if (game === "poker") return reply(200, { game, ...src.poker!.join(id, name, owner) });
      return reply(200, { game, ...await src.pinball.joinOpen(id, name, owner, avatar) });
    }
    const player = typeof b.player === "string" && b.player ? b.player : null;
    if (game === "chess") src.chess.cancel(id, player, owner); else if (game === "pool") src.pool!.cancel(id, player, owner); else if (game === "poker") src.poker!.cancel(id, player, owner); else src.pinball.cancel(id, player, owner);
    return reply(200, { ok: true });
  } catch (err) {
    const status = (err as { status?: unknown }).status;
    return reply(typeof status === "number" ? status : 400, { error: (err as Error).message.split("\n")[0] });
  }
}
