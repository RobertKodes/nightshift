import { existsSync, readFileSync } from "node:fs";
import type { IncomingMessage, ServerResponse } from "node:http";
import { WatchError, authKeeper, holderSeats, jobsFor, pair, watchStatus } from "./nightwatch.js";

/**
 * The Night Watch: the public page's status, a wallet's seats, the seat owner's pairing, the bots' job poll,
 * and the bot itself: /nightwatch/install.sh fetches these same files, so a holder sets up with one command.
 */
type Context = {
  json(res: ServerResponse, status: number, body: unknown): void;
  body(req: IncomingMessage, max?: number): Promise<Record<string, unknown>>;
  limited(req: IncomingMessage, key: string, n: number, ms: number): boolean;
  url: URL;
};

const BOT = new URL("../../../nightwatch/", import.meta.url);
/** The files the installer downloads; nothing else in the folder is served. */
export const BOT_FILES = ["install.sh", "bot.mjs", "lib/chain.mjs", "lib/coordinator.mjs", "lib/plan.mjs", "package.json", "package-lock.json", ".env.example", "nightwatch.service", "README.md", "test/plan.test.mjs", "vps-setup.sh", "cloud-init.yaml", "test/vps.test.mjs"];

const header = (req: IncomingMessage, k: string) => { const v = req.headers[k]; return Array.isArray(v) ? v[0] : v; };

export async function watchRoutes(req: IncomingMessage, res: ServerResponse, p: string, ctx: Context): Promise<boolean> {
  if (p.startsWith("/nightwatch/") && req.method === "GET") {
    const f = p.slice("/nightwatch/".length);
    const file = new URL(f, BOT);
    if (!BOT_FILES.includes(f) || !existsSync(file)) { ctx.json(res, 404, { error: "not found" }); return true; }
    res.writeHead(200, { "content-type": f.endsWith(".json") ? "application/json; charset=utf-8" : "text/plain; charset=utf-8", "cache-control": "public, max-age=300", "x-content-type-options": "nosniff" });
    res.end(readFileSync(file));
    return true;
  }
  if (!p.startsWith("/api/watch") || p.startsWith("/api/watchtower")) return false;
  const { json } = ctx;
  if (ctx.limited(req, "watch", 240, 60_000)) { json(res, 429, { error: "slow down" }); return true; }
  try {
    if (p === "/api/watch" && req.method === "GET") { json(res, 200, await watchStatus()); return true; }
    if (p === "/api/watch/holder" && req.method === "GET") { json(res, 200, await holderSeats(ctx.url.searchParams.get("address") ?? "")); return true; }
    if (p === "/api/watch/pair" && req.method === "POST") {
      if (ctx.limited(req, "watch-pair", 10, 60_000)) { json(res, 429, { error: "slow down" }); return true; }
      const s = await pair(await ctx.body(req, 4_000));
      json(res, 200, { watcher: s.watcher, keeper: s.keeper });
      return true;
    }
    if (p === "/api/watch/jobs" && req.method === "GET") {
      const keeper = await authKeeper(header(req, "x-keeper"), header(req, "x-ts"), header(req, "x-sig"));
      if (ctx.limited(req, `watch-jobs:${keeper}`, 30, 60_000)) { json(res, 429, { error: "poll at most every few seconds" }); return true; }
      json(res, 200, jobsFor(keeper));
      return true;
    }
    json(res, 404, { error: "not found" });
  } catch (e) {
    if (e instanceof WatchError) json(res, e.status, { error: e.message });
    else { console.error("watch", (e as Error).message); json(res, 502, { error: "The chain did not answer; try again in a minute." }); }
  }
  return true;
}
