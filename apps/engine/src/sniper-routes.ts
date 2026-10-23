import type { IncomingMessage, ServerResponse } from "node:http";
import { TOPICS, type Topic, parseSub, publicKey, subscribe, subscribed, unsubscribe } from "./push.js";
import { type Sniper, publicCall, sniperStats } from "./sniper.js";
import type { Dex } from "./sniper-dex.js";
import { holds, quotePrices } from "./sniper-live.js";
import { IMD_TOKEN } from "./services/imd.js";
import { NATIVE } from "./services/v4pool.js";
import { config } from "./config.js";

type Helpers = {
  json: (res: ServerResponse, status: number, body: unknown) => void;
  body: (req: IncomingMessage) => Promise<Record<string, unknown>>;
  limited: (req: IncomingMessage, key: string, max: number, windowMs: number) => boolean;
  /** The signed-in wallet (session cookie), if any. */
  owner: string | null;
  sniper: Sniper | null;
  dex: Dex | null;
};

/**
 * NIGHT SNIPER's reads and the app's notification sign-up:
 * GET /api/sniper (calls, newest first; holders see them the moment they are made),
 * GET /api/push/key, POST /api/push/subscribe | /api/push/unsubscribe | /api/push/status.
 */
export async function sniperRoutes(req: IncomingMessage, res: ServerResponse, p: string, h: Helpers): Promise<boolean> {
  if (p === "/api/sniper" && req.method === "GET") {
    if (h.limited(req, "sniper", 120, 60_000)) { h.json(res, 429, { error: "slow down" }); return true; }
    const holder = h.owner ? await holds(h.owner).catch(() => false) : false;
    const calls = h.sniper?.calls(holder) ?? [];
    const usdOf = await quotePrices([NATIVE, IMD_TOKEN, ...calls.map((c) => c.pool?.quote).filter((q): q is `0x${string}` => Boolean(q))]);
    h.json(res, 200, {
      live: Boolean(h.sniper), holder, delayMinutes: Math.round(config.sniperDelayMs / 60_000),
      /** Calls holders can already see and this visitor cannot yet. */
      hidden: holder ? 0 : (h.sniper?.calls(true).length ?? 0) - calls.length,
      stats: sniperStats(calls),
      calls: calls.slice(0, 100).map((c) => publicCall(c, usdOf, h.sniper!.historyOf(c))),
      launchers: (h.sniper?.launchers(holder) ?? []).slice(0, 50),
      indexed: h.sniper?.indexed() ?? 0,
    });
    return true;
  }
  if (p === "/api/sniper/dex" && req.method === "GET") {
    if (h.limited(req, "sniper", 120, 60_000)) { h.json(res, 429, { error: "slow down" }); return true; }
    const url = new URL(req.url ?? "/", "http://x");
    const holder = h.owner ? await holds(h.owner).catch(() => false) : false;
    const usdOf = await quotePrices([NATIVE, IMD_TOKEN, ...(h.dex?.quotes() ?? [])]);
    const sort = (["mcap", "new", "move", "safe"] as const).find((s) => s === url.searchParams.get("sort")) ?? "mcap";
    const view = h.dex?.view({ sort, q: url.searchParams.get("q")?.slice(0, 64) ?? "", limit: 150, hideNewerThan: holder ? undefined : Date.now() - config.sniperDelayMs },
      usdOf);
    h.json(res, 200, { live: Boolean(h.dex), holder, ...(view ?? { count: 0, tokens: [], nfts: [], verdicts: 0 }) });
    return true;
  }
  if (p === "/api/push/key" && req.method === "GET") { h.json(res, 200, { key: publicKey() }); return true; }
  if (p.startsWith("/api/push/") && req.method === "POST") {
    if (h.limited(req, "push", 30, 60_000)) { h.json(res, 429, { error: "slow down" }); return true; }
    const b = await h.body(req).catch(() => ({} as Record<string, unknown>));
    const sub = parseSub(b.subscription);
    if (!sub) { h.json(res, 400, { error: "not a push subscription" }); return true; }
    if (p === "/api/push/subscribe") {
      const topics = (Array.isArray(b.topics) ? b.topics : TOPICS).filter((t): t is Topic => TOPICS.includes(t as Topic));
      subscribe(sub, h.owner, topics.length ? topics : TOPICS);
      h.json(res, 200, { ok: true, holder: h.owner ? await holds(h.owner).catch(() => false) : false });
      return true;
    }
    if (p === "/api/push/unsubscribe") { h.json(res, 200, { ok: unsubscribe(sub.endpoint) }); return true; }
    if (p === "/api/push/status") { const s = subscribed(sub.endpoint); h.json(res, 200, { subscribed: Boolean(s), topics: s?.topics ?? [] }); return true; }
  }
  return false;
}
