import type { IncomingMessage, ServerResponse } from "node:http";
import { chess, type TimeControl } from "./chess.js";

type Context = {
  json(res: ServerResponse, status: number, body: unknown): void;
  body(req: IncomingMessage, max?: number): Promise<Record<string, unknown>>;
  limited(req: IncomingMessage, key: string, n: number, ms: number): boolean;
  owner: string | null; url: URL;
};
const streams = new Map<string, number>();
let total = 0;
const clientIp = (req: IncomingMessage) => {
  const peer = (req.socket.remoteAddress ?? "?").replace(/^::ffff:/, "");
  const proxy = /^(127\.|10\.|172\.(1[6-9]|2\d|3[01])\.|192\.168\.|::1$)/.test(peer);
  return proxy ? (req.headers["x-forwarded-for"] as string | undefined)?.split(",")[0]?.trim() || peer : peer;
};

/** Call before the server's API fallback. Identity comes from the private player token. */
export async function chessRoutes(req: IncomingMessage, res: ServerResponse, p: string, ctx: Context): Promise<boolean> {
  if (!p.startsWith("/api/chess/")) return false;
  const { json, body, limited, owner, url } = ctx;
  const reply = (status: number, value: unknown) => { json(res, status, value); return true; };
  try {
    if (p === "/api/chess/board" && req.method === "GET") return reply(200, chess.board());
    if (p === "/api/chess/queue" && req.method === "POST") {
      if (limited(req, "chess-queue", 20, 600_000)) return reply(429, { error: "Too many searches. Try again shortly." });
      const b = await body(req, 2_000);
      return reply(200, chess.queue(String(b.name ?? ""), owner, String(b.tc ?? "3+2") as TimeControl));
    }
    const state = /^\/api\/chess\/match\/([a-f0-9]+)$/.exec(p);
    if (state && req.method === "GET") return reply(200, chess.get(state[1]!, url.searchParams.get("player") ?? ""));
    const route = /^\/api\/chess\/match\/([a-f0-9]+)\/(events|move|resign|draw|leave|rematch)$/.exec(p);
    if (!route) return reply(404, { error: "No such chess route" });
    const id = route[1]!, action = route[2]!;
    if (action === "events" && req.method === "GET") {
      const player = url.searchParams.get("player") ?? "", first = chess.get(id, player);
      const ip = clientIp(req);
      if ((streams.get(ip) ?? 0) >= 4 || total >= 2_000) return reply(429, { error: "Too many live connections" });
      streams.set(ip, (streams.get(ip) ?? 0) + 1); total++;
      res.writeHead(200, { "Content-Type": "text/event-stream", "Cache-Control": "no-cache, no-transform", Connection: "keep-alive", "X-Accel-Buffering": "no" });
      let closed = false, blocked = false, pending = false;
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
        if (res.writableLength > 256 * 1024 || res.destroyed) { close(); return; }
        try { blocked = !res.write(data); } catch { close(); }
      };
      // One pending snapshot survives a slow consumer; no unbounded queue of old moves.
      const flush = () => {
        timer = undefined;
        if (closed || !pending) return;
        if (blocked) { if (res.writableLength > 256 * 1024) close(); return; }
        pending = false;
        try { write(`data: ${JSON.stringify(chess.get(id, player, true))}\n\n`); } catch { close(); }
      };
      const schedule = () => { pending = true; if (!timer && !closed) timer = setTimeout(flush, 30); };
      const drain = () => { blocked = false; flush(); };
      const ping = setInterval(() => { if (blocked) close(); else write(": ping\n\n"); }, 20_000);
      res.on("drain", drain); res.on("close", close); res.on("error", close);
      write(`data: ${JSON.stringify(first)}\n\n`);
      if (!closed) off = chess.listen(id, player, schedule);
      return true;
    }
    if (req.method !== "POST" || action === "events") return reply(405, { error: "Method not allowed" });
    if (limited(req, action === "move" ? "chess-move" : "chess-action", action === "move" ? 120 : 40, 60_000)) return reply(429, { error: "Slow down" });
    const b = await body(req, 2_000), player = String(b.player ?? "");
    if (action === "move") return reply(200, chess.move(id, player, String(b.from ?? ""), String(b.to ?? ""), b.promotion === undefined ? undefined : String(b.promotion)));
    if (action === "resign") return reply(200, chess.resign(id, player));
    if (action === "draw") return reply(200, chess.draw(id, player, String(b.action ?? "offer")));
    if (action === "rematch") return reply(200, chess.rematch(id, player));
    chess.leave(id, player); return reply(200, { ok: true });
  } catch (err) { return reply(400, { error: (err as Error).message }); }
}
