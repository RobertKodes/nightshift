import type { IncomingMessage, ServerResponse } from "node:http";
import { clientIp } from "./auth.js";
import { chess } from "./chess.js";
import { getWatch as pinWatchView, live as pinLive, watch as pinWatch } from "./pinball.js";

/**
 * Spectator mode: anyone can watch any game being played right now. The list of live games and a
 * read-only stream per match, of the very frames a rival sees (the pinball seed only once settled).
 * A spectator has no seat: nothing here takes a move or an input, and no seat token is ever sent.
 */
type Context = {
  json(res: ServerResponse, status: number, body: unknown): void;
  limited(req: IncomingMessage, key: string, n: number, ms: number): boolean;
};
export type Game = "chess" | "pinball";
export type LiveGame = {
  game: Game; id: string; players: { name: string; avatar?: string; agent?: boolean }[];
  stake: { currency: "FREE" | "IMD" | "SHIFT"; amount: number }; startedAt: number; watch: string; viewers: number; tc?: string;
};

/** Spectators per match at most, and spectator streams per IP and in all. */
export const MAX_VIEWERS = 200;
const PER_IP = 6, TOTAL = 4_000;
const viewers = new Map<string, number>();
const perIp = new Map<string, number>();
let total = 0;
export const viewersOf = (game: Game, id: string) => viewers.get(`${game}:${id}`) ?? 0;

/** Other boards with live games (the Agent Arena's own tables), listed alongside the public ones. */
const sources: (() => LiveGame[])[] = [];
export const addLiveSource = (fn: () => LiveGame[]) => { sources.push(fn); };

/** Every match in progress across both games, the newest first. */
export function liveGames(): LiveGame[] {
  const games: LiveGame[] = [
    ...sources.flatMap((fn) => { try { return fn(); } catch { return []; } }),
    ...chess.live().map((m) => ({ game: "chess" as const, id: m.id, tc: m.tc, players: m.players.map((p) => ({ name: p.name, ...(p.agent ? { agent: true } : {}) })),
      stake: { currency: m.currency, amount: Number(m.stake ?? 0) || 0 }, startedAt: m.startedAt, watch: `/games/chess?watch=${m.id}`, viewers: viewersOf("chess", m.id) })),
    ...pinLive().map((m) => ({ game: "pinball" as const, id: m.id, players: m.players.map((p) => ({ name: p.name, ...(p.avatar ? { avatar: p.avatar } : {}), ...(p.agent ? { agent: true } : {}) })),
      stake: { currency: m.currency, amount: m.stake }, startedAt: m.startedAt, watch: `/games/pinball?watch=${m.id}`, viewers: viewersOf("pinball", m.id) })),
  ];
  return games.sort((a, b) => b.startedAt - a.startedAt);
}

/**
 * One spectator's SSE stream. Like the players' streams, one pending snapshot survives a slow reader
 * (no queue of old frames) and a reader over the backpressure limit is dropped.
 */
function stream(req: IncomingMessage, res: ServerResponse, ctx: Context, game: Game, id: string, frame: (first: boolean) => unknown, subscribe: (f: () => void) => (() => void) | null): boolean {
  const key = `${game}:${id}`, ip = clientIp(req);
  if ((viewers.get(key) ?? 0) >= MAX_VIEWERS) { ctx.json(res, 429, { error: `This game is full: ${MAX_VIEWERS} spectators already.` }); return true; }
  if ((perIp.get(ip) ?? 0) >= PER_IP || total >= TOTAL) { ctx.json(res, 429, { error: "Too many live connections" }); return true; }
  // counted first, so the opening frame already includes this spectator
  viewers.set(key, (viewers.get(key) ?? 0) + 1);
  let first: unknown;
  try { first = frame(true); } catch { first = null; }
  if (!first) {
    const n = (viewers.get(key) ?? 1) - 1; if (n > 0) viewers.set(key, n); else viewers.delete(key);
    ctx.json(res, 404, { error: "No such game" }); return true;
  }
  perIp.set(ip, (perIp.get(ip) ?? 0) + 1); total++;
  res.writeHead(200, { "Content-Type": "text/event-stream", "Cache-Control": "no-cache, no-transform", Connection: "keep-alive", "X-Accel-Buffering": "no" });
  let closed = false, blocked = false, pending = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let off: () => void = () => {};
  const close = () => {
    if (closed) return; closed = true; clearTimeout(timer); clearInterval(ping); off();
    res.off("drain", drain); res.off("close", close); res.off("error", close);
    const n = (viewers.get(key) ?? 1) - 1; if (n > 0) viewers.set(key, n); else viewers.delete(key);
    const k = (perIp.get(ip) ?? 1) - 1; if (k > 0) perIp.set(ip, k); else perIp.delete(ip);
    total--;
    res.end();
  };
  const write = (data: string) => {
    if (closed) return;
    if (res.writableLength > 256 * 1024 || res.destroyed) { close(); return; }
    try { blocked = !res.write(data); } catch { close(); }
  };
  const flush = () => {
    timer = undefined;
    if (closed || !pending) return;
    if (blocked) { if (res.writableLength > 256 * 1024) close(); return; }
    pending = false;
    let v: unknown;
    try { v = frame(false); } catch { v = null; }
    // the match is gone (expired from memory): the stream has nothing more to show
    if (!v) { close(); return; }
    write(`data: ${JSON.stringify(v)}\n\n`);
  };
  const schedule = () => { pending = true; if (!timer && !closed) timer = setTimeout(flush, 30); };
  const drain = () => { blocked = false; flush(); };
  const ping = setInterval(() => { if (blocked) close(); else write(": ping\n\n"); }, 20_000);
  res.on("drain", drain); res.on("close", close); res.on("error", close);
  write(`data: ${JSON.stringify(first)}\n\n`);
  if (!closed) off = subscribe(schedule) ?? (() => {});
  return true;
}

/** Call before the chess and games routes: GET /api/games/live and the two read-only match streams. */
export async function spectateRoutes(req: IncomingMessage, res: ServerResponse, p: string, ctx: Context): Promise<boolean> {
  if (p === "/api/games/live") {
    if (req.method !== "GET") { ctx.json(res, 405, { error: "Method not allowed" }); return true; }
    if (ctx.limited(req, "games-live", 120, 60_000)) { ctx.json(res, 429, { error: "slow down" }); return true; }
    ctx.json(res, 200, { games: liveGames() });
    return true;
  }
  const route = /^\/api\/(chess|pinball)\/match\/([a-f0-9]{1,40})\/watch$/.exec(p);
  if (!route) return false;
  // a spectator only ever reads
  if (req.method !== "GET") { ctx.json(res, 405, { error: "Spectators cannot play" }); return true; }
  if (ctx.limited(req, "games-watch", 30, 60_000)) { ctx.json(res, 429, { error: "slow down" }); return true; }
  const game = route[1] as Game, id = route[2]!;
  if (game === "chess") {
    // the first frame carries the whole move list; then compact frames, as for the players
    return stream(req, res, ctx, game, id, (first) => ({ ...chess.watchView(id, !first), spectating: true, viewers: viewersOf(game, id) }), (f) => chess.watch(id, f));
  }
  return stream(req, res, ctx, game, id, () => { const v = pinWatchView(id); return v && { ...v, spectating: true, viewers: viewersOf(game, id) }; }, (f) => pinWatch(id, f));
}
