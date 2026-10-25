import type { IncomingMessage, ServerResponse } from "node:http";
import { isAddr } from "../services/evm.js";
import { WatchtowerError } from "./observe.js";
import { type Watchtower, anonKeyOf } from "./watchtower.js";

/**
 * Watchtower's free and management routes. The paid ones (a check at $0.05, a 7-day hourly
 * watch at $1.00) go through the x402 services router, which calls wt.check() and
 * wt.startWatch(). A free sample is keyed by a salted daily hash of the IP: the IP is never kept.
 */
export type WatchtowerRouteCtx = {
  json(res: ServerResponse, status: number, body: unknown): void;
  body(req: IncomingMessage): Promise<Record<string, unknown>>;
  limited(req: IncomingMessage, key: string, n: number, ms: number): boolean;
  /** The signed-in wallet, if any. */
  owner: string | null;
  ip: string;
  wt: Watchtower;
};

const WATCH_ID = /^w_[0-9a-f]{16}$/;
const header = (req: IncomingMessage, n: string) => { const v = req.headers[n]; return Array.isArray(v) ? v[0] : v; };

/** Answers /api/watchtower/{info, sample, watches/:id, watches/:id/stop, unsubscribe}; false for anything else. */
export async function watchtowerRoutes(req: IncomingMessage, res: ServerResponse, p: string, ctx: WatchtowerRouteCtx): Promise<boolean> {
  if (!p.startsWith("/api/watchtower/")) return false;
  const seg = p.split("/").filter(Boolean); // api watchtower …
  const q = new URL(req.url ?? p, "http://localhost").searchParams;
  const method = req.method ?? "GET";
  const reads = method === "GET" || method === "HEAD";
  const send = (status: number, body: unknown) => { ctx.json(res, status, body); return true; };
  const slow = () => send(429, { error: "Slow down: too many requests from this address. Try again in a minute." });
  try {
    if (seg.length === 3 && seg[2] === "info") {
      if (!reads) return send(405, { error: "GET only" });
      if (ctx.limited(req, "wt-free", 120, 60_000)) return slow();
      return send(200, ctx.wt.info());
    }
    if (seg.length === 3 && seg[2] === "sample") {
      if (!reads) return send(405, { error: "GET only" });
      if (ctx.limited(req, "wt-sample", 20, 60_000)) return slow();
      const address = q.get("address") ?? "";
      if (!isAddr(address)) return send(400, { error: "address must be 0x followed by 40 hex characters (an ERC-20 token or a Uniswap v4 hook on Ethereum mainnet)." });
      const kind = q.get("kind") || undefined;
      if (kind !== undefined && kind !== "token" && kind !== "hook") return send(400, { error: "kind must be token or hook." });
      return send(200, await ctx.wt.sample(address, anonKeyOf(ctx.ip, ctx.wt.now()), kind));
    }
    if (seg[2] === "watches" && seg[3] && (seg.length === 4 || (seg.length === 5 && seg[4] === "stop"))) {
      if (ctx.limited(req, "wt-watch", 60, 60_000)) return slow();
      if (!WATCH_ID.test(seg[3])) return send(404, { error: "No such watch." });
      res.setHeader("Cache-Control", "no-store");
      if (seg.length === 4) {
        if (!reads) return send(405, { error: "GET only" });
        return send(200, ctx.wt.getWatch(seg[3], { owner: ctx.owner ?? undefined, token: header(req, "x-watch-token") }));
      }
      if (method !== "POST") return send(405, { error: "POST only" });
      const body = await ctx.body(req).catch(() => ({} as Record<string, unknown>));
      const token = header(req, "x-watch-token") ?? (typeof body.token === "string" ? body.token : undefined);
      return send(200, { ok: true, watch: ctx.wt.stopWatch(seg[3], { owner: ctx.owner ?? undefined, token }) });
    }
    if (seg.length === 3 && seg[2] === "unsubscribe") {
      if (!reads && method !== "POST") return send(405, { error: "GET or POST" });
      if (ctx.limited(req, "wt-watch", 60, 60_000)) return slow();
      const token = q.get("token") ?? "";
      const done = token ? ctx.wt.unsubscribe(token) : null;
      if (!done) return send(404, { error: "This unsubscribe link is not valid." });
      return send(200, { ok: true, watch: done.id, message: "Alerts are off for this watch. Monitoring continues until the watch is stopped or its term ends." });
    }
    return false;
  } catch (e) {
    const st = (e as { status?: unknown }).status;
    if (typeof st === "number") return send(st, { error: (e as Error).message, ...(e instanceof WatchtowerError ? e.extra : {}) });
    console.error("watchtower", e);
    return send(503, { error: "A data source did not answer. Nothing was recorded; try again in a minute." });
  }
}
