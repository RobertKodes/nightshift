import type { IncomingMessage, ServerResponse } from "node:http";
import { clientIp } from "../auth.js";
import { liveBus } from "./bus.js";
import { liveSpotlight, SpotlightError } from "./spotlight.js";

type Context = {
  json(res: ServerResponse, status: number, value: unknown): void;
  body(req: IncomingMessage, max?: number): Promise<Record<string, unknown>>;
  limited(req: IncomingMessage, key: string, max: number, windowMs: number): boolean;
  owner: string | null;
};

/** Active connections, released on close, abort or a slow reader. */
export class StreamLimits {
  #ips = new Map<string, number>();
  #total = 0;
  constructor(readonly max = 2000, readonly perIp = 6) {}
  acquire(ip: string): { status: 429 | 503; release?: never } | { status: 200; release(): void } {
    if (this.#total >= this.max) return { status: 503 };
    if ((this.#ips.get(ip) ?? 0) >= this.perIp) return { status: 429 };
    this.#total++; this.#ips.set(ip, (this.#ips.get(ip) ?? 0) + 1);
    let held = true;
    return { status: 200, release: () => {
      if (!held) return;
      held = false; this.#total--;
      const n = (this.#ips.get(ip) ?? 1) - 1;
      if (n) this.#ips.set(ip, n); else this.#ips.delete(ip);
    } };
  }
  get total() { return this.#total; }
}
export const streamLimits = new StreamLimits();

export async function liveRoutes(req: IncomingMessage, res: ServerResponse, p: string, ctx: Context): Promise<boolean> {
  if (!p.startsWith("/api/live/")) return false;
  const reply = (status: number, value: unknown) => { ctx.json(res, status, value); return true; };
  if (req.method === "GET" && p === "/api/live/state") {
    if (ctx.limited(req, "live-state", 120, 60_000)) return reply(429, { error: "Try again shortly." });
    res.setHeader("Cache-Control", "no-store");
    return reply(200, { ...liveBus.snapshot(), spotlight: liveSpotlight().view() });
  }
  if (req.method === "GET" && p === "/api/live/stream") {
    if (ctx.limited(req, "live-connect", 30, 60_000)) return reply(429, { error: "Reconnect shortly." });
    const slot = streamLimits.acquire(clientIp(req));
    if (slot.status !== 200) { res.setHeader("Retry-After", "20"); return reply(slot.status, { error: "The stream is full. Reconnect shortly." }); }
    let closed = false;
    let timer: ReturnType<typeof setInterval> | undefined;
    let slow: ReturnType<typeof setTimeout> | undefined;
    let off = () => {};
    const close = () => {
      if (closed) return;
      closed = true; slot.release(); off(); if (timer) clearInterval(timer); if (slow) clearTimeout(slow);
      res.off("drain", drain);
      res.off("close", close); res.off("error", close); req.off("aborted", close);
    };
    const drain = () => { if (slow) clearTimeout(slow); slow = undefined; };
    res.on("drain", drain);
    res.once("close", close); res.once("error", close); req.once("aborted", close);
    const write = (s: string) => {
      if (closed) return;
      try {
        if (res.writableLength > 256 * 1024) { close(); res.destroy(); return; }
        if (!res.write(s) && !slow) { slow = setTimeout(() => { close(); res.destroy(); }, 15_000); slow.unref(); }
      } catch { close(); res.destroy(); }
    };
    try {
      res.writeHead(200, { "Content-Type": "text/event-stream", "Cache-Control": "no-cache, no-transform", Connection: "keep-alive", "X-Accel-Buffering": "no" });
      res.flushHeaders();
      write(`retry: 5000\nevent: ready\ndata: ${JSON.stringify({ ...liveBus.snapshot(), spotlight: liveSpotlight().view() })}\n\n`);
      const last = String(req.headers["last-event-id"] ?? new URL(req.url ?? "/", "http://local").searchParams.get("since") ?? "").slice(0, 80);
      const events = liveBus.recent(200), index = events.findIndex((e) => e.id === last);
      if (last && index >= 0) for (const e of events.slice(index + 1)) write(`id: ${e.id}\nevent: live\ndata: ${JSON.stringify(e)}\n\n`);
      if (!closed) {
        off = liveBus.on((e) => write(`id: ${e.id}\nevent: live\ndata: ${JSON.stringify(e)}\n\n`));
        timer = setInterval(() => write(": keepalive\n\n"), 20_000); timer.unref();
      }
    } catch { close(); res.destroy(); }
    return true;
  }
  if (req.method === "POST" && p === "/api/live/spotlight") {
    if (!ctx.owner) return reply(401, { error: "Sign in with your wallet first." });
    if (ctx.limited(req, "live-spotlight", 6, 60_000)) return reply(429, { error: "Try again in a minute." });
    // Browsers submitting with a session must come from this host. Non-browser signed sessions may omit Origin.
    if (req.headers.origin) {
      try { if (new URL(req.headers.origin).host !== req.headers.host) return reply(403, { error: "Submit from the NIGHTSHIFT site." }); }
      catch { return reply(403, { error: "Invalid origin." }); }
    }
    try {
      const b = await ctx.body(req, 2000);
      return reply(202, await liveSpotlight().enqueue(ctx.owner, b.kind, b.target));
    } catch (e) {
      if (e instanceof SpotlightError) return reply(e.status, { error: e.message });
      return reply(503, { error: "Spotlight could not accept this entry. Try again shortly." });
    }
  }
  return reply(404, { error: "Not found." });
}
