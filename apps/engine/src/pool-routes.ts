import type { IncomingMessage, ServerResponse } from "node:http";
import { clientIp } from "./auth.js";
import { type PoolGames, type Rules, pool } from "./pool.js";

type Context = {
  json(res: ServerResponse, status: number, body: unknown): void;
  body(req: IncomingMessage, max?: number): Promise<Record<string, unknown>>;
  limited(req: IncomingMessage, key: string, n: number, ms: number): boolean;
  owner: string | null; url: URL;
  /** Tests pass their own tables; the server uses the live ones. */
  games?: PoolGames;
};
const streams = new Map<string, number>();
let total = 0;

/**
 * A live stream of one table for one seat. A shot's keyframes go out once (the frame after the
 * shot); later frames carry the shot without them. One pending snapshot survives a slow reader.
 */
function stream(req: IncomingMessage, res: ServerResponse, ctx: Context, games: PoolGames, id: string, player: string): boolean {
  const first = games.get(id, player);
  const ip = clientIp(req);
  if ((streams.get(ip) ?? 0) >= 4 || total >= 2_000) { ctx.json(res, 429, { error: "Too many live connections" }); return true; }
  streams.set(ip, (streams.get(ip) ?? 0) + 1); total++;
  res.writeHead(200, { "Content-Type": "text/event-stream", "Cache-Control": "no-cache, no-transform", Connection: "keep-alive", "X-Accel-Buffering": "no" });
  let closed = false, blocked = false, pending = false, sent = first.last?.n ?? -1;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let off = () => {};
  const close = () => {
    if (closed) return; closed = true; clearTimeout(timer); clearInterval(ping); off();
    res.off("drain", drain); res.off("close", close); res.off("error", close);
    const n = (streams.get(ip) ?? 1) - 1; if (n) streams.set(ip, n); else streams.delete(ip); total--;
    res.end();
  };
  const write = (data: string) => {
    if (closed) return;
    if (res.writableLength > 512 * 1024 || res.destroyed) { close(); return; }
    try { blocked = !res.write(data); } catch { close(); }
  };
  const flush = () => {
    timer = undefined;
    if (closed || !pending) return;
    if (blocked) { if (res.writableLength > 512 * 1024) close(); return; }
    pending = false;
    try { const v = games.get(id, player, sent); sent = Math.max(sent, v.last?.n ?? -1); write(`data: ${JSON.stringify(v)}\n\n`); } catch { close(); }
  };
  const schedule = () => { pending = true; if (!timer && !closed) timer = setTimeout(flush, 40); };
  const drain = () => { blocked = false; flush(); };
  const ping = setInterval(() => { if (blocked) close(); else write(": ping\n\n"); }, 20_000);
  res.on("drain", drain); res.on("close", close); res.on("error", close);
  write(`data: ${JSON.stringify(first)}\n\n`);
  if (!closed) off = games.listen(id, player, schedule);
  return true;
}

const RULES = new Set(["wpa", "quick"]);
/** /api/pool/*: the queue, a table's state and stream, and every action at it. Identity is the private seat token. */
export async function poolRoutes(req: IncomingMessage, res: ServerResponse, p: string, ctx: Context): Promise<boolean> {
  if (!p.startsWith("/api/pool/")) return false;
  const { json, body, limited, owner, url } = ctx;
  const games = ctx.games ?? pool;
  const reply = (status: number, value: unknown) => { json(res, status, value); return true; };
  try {
    if (p === "/api/pool/board" && req.method === "GET") return reply(200, games.board());
    if (p === "/api/pool/queue" && req.method === "POST") {
      if (limited(req, "pool-queue", 20, 600_000)) return reply(429, { error: "Too many searches. Try again shortly." });
      const b = await body(req, 2_000), rules = String(b.rules ?? "wpa");
      if (!RULES.has(rules)) return reply(400, { error: "Choose WPA or quick rules" });
      return reply(200, games.queue(String(b.name ?? ""), owner, rules as Rules));
    }
    const state = /^\/api\/pool\/match\/([a-f0-9]{1,40})$/.exec(p);
    if (state && req.method === "GET") {
      const since = Number(url.searchParams.get("since") ?? -1);
      return reply(200, games.get(state[1]!, url.searchParams.get("player") ?? "", Number.isInteger(since) ? since : -1));
    }
    const route = /^\/api\/pool\/match\/([a-f0-9]{1,40})\/(events|shot|aim|decide|resign|leave|rematch|emote)$/.exec(p);
    if (!route) return reply(404, { error: "No such pool route" });
    const id = route[1]!, action = route[2]!;
    if (action === "events") {
      if (req.method !== "GET") return reply(405, { error: "Method not allowed" });
      return stream(req, res, ctx, games, id, url.searchParams.get("player") ?? "");
    }
    if (req.method !== "POST") return reply(405, { error: "Method not allowed" });
    // the aim streams while a player lines up a shot: its own, larger budget
    const budget = action === "aim" ? ["pool-aim", 900] : action === "shot" ? ["pool-shot", 90] : ["pool-action", 60];
    if (limited(req, budget[0] as string, budget[1] as number, 60_000)) return reply(429, { error: "Slow down" });
    const b = await body(req, 4_000), player = String(b.player ?? "");
    if (action === "shot") return reply(200, games.shot(id, player, b));
    if (action === "aim") { games.aim(id, player, b); return reply(200, { ok: true }); }
    if (action === "decide") return reply(200, games.decide(id, player, String(b.choice ?? "")));
    if (action === "resign") return reply(200, games.resign(id, player));
    if (action === "rematch") return reply(200, games.rematch(id, player));
    if (action === "emote") { games.emote(id, player, String(b.emote ?? "")); return reply(200, { ok: true }); }
    games.leave(id, player); return reply(200, { ok: true });
  } catch (err) {
    const status = (err as { status?: unknown }).status;
    return reply(typeof status === "number" ? status : 400, { error: (err as Error).message.split("\n")[0] });
  }
}
