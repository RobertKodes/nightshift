import type { IncomingMessage, ServerResponse } from "node:http";
import { type Deals, DealsError, liveDeals } from "./deals.js";
import type { Vault } from "./vault.js";

type Context = {
  json(res: ServerResponse, status: number, body: unknown): void;
  body(req: IncomingMessage, max?: number): Promise<Record<string, unknown>>;
  limited(req: IncomingMessage, key: string, max: number, windowMs: number): boolean;
  vault: Vault;
  deals?: Deals;
};

const failure = (e: unknown) => e instanceof DealsError ? { status: e.status, body: { error: e.message, code: e.code } }
  : e instanceof SyntaxError ? { status: 400, body: { error: "The body must be JSON.", code: "bad_json" } }
    : { status: 503, body: { error: "The deals could not be read from Ethereum right now. Try again shortly.", code: "unavailable" } };

/** Token Deals: the cards, one deal with its buys, the desk's settings and the holder pass. */
export async function dealRoutes(req: IncomingMessage, res: ServerResponse, p: string, ctx: Context): Promise<boolean> {
  if (!p.startsWith("/api/deals")) return false;
  const reply = (code: number, body: unknown, cache = "no-store") => { res.setHeader("Cache-Control", cache); ctx.json(res, code, body); return true; };
  const deals = ctx.deals ?? liveDeals(ctx.vault);
  try {
    if (req.method === "GET" && p === "/api/deals") return reply(200, { ...(await deals.config()), deals: await deals.list() }, "public, max-age=15");
    if (req.method === "GET" && p === "/api/deals/config") return reply(200, await deals.config(), "public, max-age=60");
    const one = /^\/api\/deals\/(\d{1,9})$/.exec(p);
    if (req.method === "GET" && one) return reply(200, await deals.one(Number(one[1])), "public, max-age=15");
    if (req.method === "POST" && p === "/api/deals/pass") {
      if (ctx.limited(req, "deals-pass", 20, 60_000)) return reply(429, { error: "Too many requests. Wait a minute.", code: "rate_limited" });
      return reply(200, await deals.pass((await ctx.body(req, 1_000)).recipient));
    }
    return reply(404, { error: "not found", code: "not_found" });
  } catch (e) {
    const f = failure(e);
    return reply(f.status, f.body);
  }
}
