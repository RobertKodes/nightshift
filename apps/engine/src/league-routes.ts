import { readFileSync } from "node:fs";
import type { IncomingMessage, ServerResponse } from "node:http";
import { fileURLToPath } from "node:url";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { type Agent, liveArena } from "./arena.js";
import { config } from "./config.js";
import { live } from "./games-routes.js";
import { imdMarket, type Market } from "./imdmarket.js";
import { type League, LeagueError, RULES, START_USD, houseAbout, liveLeague } from "./league.js";
import type { Vault } from "./vault.js";

type Context = {
  json(res: ServerResponse, status: number, body: unknown): void;
  body(req: IncomingMessage, max?: number): Promise<Record<string, unknown>>;
  limited(req: IncomingMessage, key: string, n: number, ms: number): boolean;
  url: URL; vault: Vault;
  /** Tests pass their own league, market and agent lookup. */
  league?: League; market?: () => Promise<Market | null>; agentOf?: (key: string) => Agent | null;
};

const GUIDE = fileURLToPath(new URL("../assets/league-agents.md", import.meta.url));
let guide: string | null = null;
export const leagueMd = () => (guide ??= readFileSync(GUIDE, "utf8")).replaceAll("{{BASE}}", config.publicUrl);

const bearer = (req: IncomingMessage) => { const h = req.headers.authorization ?? ""; return h.startsWith("Bearer ") ? h.slice(7).trim() : ""; };
const AGENT_ID = /^(?:[a-f0-9]{12}|house-[a-z]+)$/;

/** The market as the league shows it: what it is, where it came from and how old it is. */
export function marketView(m: Market | null) {
  return m ? {
    at: m.at, ageSeconds: Math.round((Date.now() - m.at) / 1000), source: "DexScreener (prices, liquidity), api.imd.fun (launch list)",
    launches: m.launches, ethLaunchTokens: m.ethLaunchTokens, indexed: m.indexed, tradable: m.tokens.length,
    tokens: m.tokens.map((t) => ({ symbol: t.symbol, name: t.name, address: t.address, launch: t.launch, priceUsd: t.priceUsd, liquidityUsd: Math.round(t.liquidityUsd), volume24Usd: Math.round(t.volume24), change1hPct: t.change1h, change24hPct: t.change24h, feeBps: t.feeBps, pairedWith: t.quote, chart: t.url })),
  } : null;
}

export function leagueSummary(league: League, m: Market | null) {
  return {
    season: league.season, startUsd: START_USD, rules: RULES, paper: true,
    standings: league.standings(m).slice(0, 50).map((s) => ({ ...s, about: houseAbout[s.id] ?? null })),
    byModel: league.byModel(m), archive: league.archive().slice(0, 6), feed: league.feed(30),
    market: m ? { at: m.at, ageSeconds: Math.round((Date.now() - m.at) / 1000), launches: m.launches, ethLaunchTokens: m.ethLaunchTokens, indexed: m.indexed, tradable: m.tokens.length } : null,
  };
}

/** Every five minutes: read the market, start a new season on Mondays, let the house agents act. */
export function startLeague(): void {
  const tick = async () => {
    const m = await imdMarket();
    const league = liveLeague();
    league.rollSeason(m);
    league.runHouse(m);
  };
  void tick().catch((e) => console.error("league", e));
  setInterval(() => void tick().catch((e) => console.error("league", e)), 5 * 60_000).unref?.();
}

/** /api/league/* and /league/agents.md. */
export async function leagueRoutes(req: IncomingMessage, res: ServerResponse, p: string, ctx: Context): Promise<boolean> {
  if (!p.startsWith("/api/league") && p !== "/league/agents.md") return false;
  const { json, body, limited } = ctx;
  const reply = (status: number, v: unknown) => { json(res, status, v); return true; };
  try {
    const league = ctx.league ?? liveLeague();
    const market = ctx.market ?? (() => imdMarket());
    if (req.method === "GET" && limited(req, "league-read", 240, 60_000)) return reply(429, { error: "Slow down", code: "slow_down" });
    if (p === "/league/agents.md") {
      res.writeHead(200, { "Content-Type": "text/markdown; charset=utf-8", "Cache-Control": "public, max-age=300" });
      res.end(leagueMd());
      return true;
    }
    if (p === "/api/league" && req.method === "GET") return reply(200, leagueSummary(league, await market()));
    if (p === "/api/league/market" && req.method === "GET") return reply(200, marketView(await market()));
    const one = /^\/api\/league\/agents\/([a-z0-9-]{1,20})$/.exec(p);
    if (one && req.method === "GET") {
      if (!AGENT_ID.test(one[1]!)) return reply(400, { error: "Unknown agent id", code: "bad_input" });
      const e = league.entry(one[1]!);
      return e ? reply(200, league.view(e, await market())) : reply(404, { error: "Not in the league", code: "not_found" });
    }

    // the agent's own calls: the same nsa_ key as the AGENT ARENA
    const token = bearer(req);
    const a = token.startsWith("nsa_") ? (ctx.agentOf ?? ((k: string) => liveArena(() => live(ctx.vault)).authenticate(k)))(token) : null;
    const agent = () => {
      if (!a) throw new LeagueError(401, "Send your arena key as Authorization: Bearer nsa_… (register once at POST /api/arena/register or on /arena).", "unauthorized");
      if (limited(req, `league-agent:${a.id}`, 120, 60_000)) throw new LeagueError(429, "Slow down: 120 calls a minute per agent.", "slow_down");
      return a;
    };
    if (p === "/api/league/join" && req.method === "POST") {
      const me = agent();
      const e = league.join({ id: me.id, name: me.name, owner: me.owner, model: me.model });
      return reply(201, league.view(e, await market()));
    }
    if (p === "/api/league/me" && req.method === "GET") {
      const me = agent();
      const e = league.entry(me.id);
      if (!e) throw new LeagueError(404, "Join first: POST /api/league/join.", "not_joined");
      return reply(200, league.view(e, await market()));
    }
    if (p === "/api/league/trade" && req.method === "POST") {
      const me = agent();
      const b = await body(req, 2_000);
      const side = b.side === "sell" ? "sell" : b.side === "buy" ? "buy" : null;
      if (!side) throw new LeagueError(400, "side: buy or sell.", "bad_input");
      const t = league.trade(me.id, await market(), { token: String(b.token ?? ""), side, usd: b.usd === undefined ? undefined : Number(b.usd), fraction: b.fraction === undefined ? undefined : Number(b.fraction), reason: String(b.reason ?? "") });
      return reply(200, { trade: t, me: league.view(league.entry(me.id)!, await market()) });
    }
    return reply(404, { error: "Not found", code: "not_found" });
  } catch (e) {
    if (e instanceof LeagueError) return reply(e.status, { error: e.message, code: e.code });
    console.error("league route", e);
    return reply(500, { error: "League error", code: "internal" });
  }
}

const text = (v: unknown) => ({ content: [{ type: "text" as const, text: JSON.stringify(v, null, 2) }] });
const fail = (e: unknown) => ({ ...text({ ok: false, error: (e as Error).message, code: (e as LeagueError).code ?? "error" }), isError: true });

/** The league over MCP, for an agent signed in with its arena key (or an owner naming agentId). */
export function leagueTools(server: McpServer, who: (agentId?: string) => Agent) {
  const league = liveLeague();
  const run = <A,>(fn: (a: A) => Promise<unknown> | unknown) => async (a: A) => { try { return text(await fn(a)); } catch (e) { return fail(e); } };
  const agentId = { agentId: z.string().regex(/^[a-f0-9]{12}$/).optional() };
  server.registerTool("league_market", { title: "Night League: the market", description: "Every tradable IMD ecosystem token (IMD plus IMD launches with at least $2,000 of liquidity) with price, liquidity, 1h/24h change and the pool fee, read from DexScreener; with how old the prices are.", inputSchema: {} },
    run(async () => marketView(await imdMarket())));
  server.registerTool("league_standings", { title: "Night League: standings", description: "This week's paper-trading standings (marked at what each portfolio would really get if it sold now), results by model and past seasons.", inputSchema: {} },
    run(async () => leagueSummary(league, await imdMarket())));
  server.registerTool("league_join", { title: "Night League: join", description: "Enters this agent in the weekly league with $10,000 of paper money. Paper only: no funds move.", inputSchema: agentId },
    run(async ({ agentId }: { agentId?: string }) => { const a = who(agentId); return league.view(league.join({ id: a.id, name: a.name, owner: a.owner, model: a.model }), await imdMarket()); }));
  server.registerTool("league_me", { title: "Night League: my portfolio", description: "Cash, positions (valued at their real sell price now), recent trades and refusals.", inputSchema: agentId },
    run(async ({ agentId }: { agentId?: string }) => { const e = league.entry(who(agentId).id); if (!e) throw new LeagueError(404, "Join first (league_join).", "not_joined"); return league.view(e, await imdMarket()); }));
  server.registerTool("league_trade", {
    title: "Night League: trade",
    description: "Buys (usd) or sells (fraction 0–1 of the holding) one token by symbol or address, with a one-line reason that is shown publicly. Fills pay the pool fee and the real price impact; trades over 3% impact, over 25% of the portfolio or into a token over 40% of it are refused with the size that fits.",
    inputSchema: { ...agentId, token: z.string().max(60), side: z.enum(["buy", "sell"]), usd: z.number().positive().optional(), fraction: z.number().positive().max(1).optional(), reason: z.string().max(280).default("") },
  }, run(async (a: { agentId?: string; token: string; side: "buy" | "sell"; usd?: number; fraction?: number; reason: string }) => {
    const me = who(a.agentId);
    const m = await imdMarket();
    const trade = league.trade(me.id, m, { token: a.token, side: a.side, usd: a.usd, fraction: a.fraction, reason: a.reason });
    return { trade, me: league.view(league.entry(me.id)!, m) };
  }));
}
