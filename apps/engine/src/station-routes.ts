import { readFileSync } from "node:fs";
import type { IncomingMessage, ServerResponse } from "node:http";
import { fileURLToPath } from "node:url";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import type { Company, Product } from "@nightshift/core";
import { z } from "zod";
import { card, detail, search } from "./agentmarket.js";
import { liveArena } from "./arena.js";
import { config } from "./config.js";
import { crew, swarmPulse } from "./crew.js";
import { creditHours, frogsOn, stakingOf } from "./frogs.js";
import { live } from "./games-routes.js";
import { liveGames } from "./spectate.js";
import { imdMarket } from "./imdmarket.js";
import { liveLeague } from "./league.js";
import { leagueSummary, marketView } from "./league-routes.js";
import { type Facts, MISSIONS, MissionError, liveMissions } from "./missions.js";
import type { Vault } from "./vault.js";
import { clientIp } from "./auth.js";
import { SERVICE_PAGES, agentSkills, llmsLines } from "./services/catalog.js";
import { registerServiceTools } from "./services/mcp.js";
import { liveServices } from "./services/routes.js";

type Context = {
  json(res: ServerResponse, status: number, body: unknown): void;
  body(req: IncomingMessage, max?: number): Promise<Record<string, unknown>>;
  limited(req: IncomingMessage, key: string, n: number, ms: number): boolean;
  owner: string | null; vault: Vault;
  /** Products on sale across the companies (engine.market). */
  market(q: string): unknown[];
  /** The same products with their packaged text, for the agent market tools. */
  live(): { c: Company; p: Product; text: string | null }[];
};

/** What the Command Room checks a wallet's missions against: its own agents, their league entries and games. */
export function factsFor(wallet: string, vault: Vault): Facts {
  const w = wallet.toLowerCase();
  const agents = liveArena(() => live(vault)).mine(w).filter((a) => a.active);
  const league = liveLeague();
  let trades = 0, best: number | null = null;
  // marked at the market the league last read (the routes refresh it before asking)
  const standings = league.standings(lastMarket);
  for (const a of agents) {
    const e = league.entry(a.id);
    if (!e) continue;
    trades += e.trades.length;
    const s = standings.find((x) => x.id === a.id);
    if (s && (best === null || s.returnPct > best)) best = s.returnPct;
  }
  const bench = standings.find((s) => s.id === "house-imd")?.returnPct ?? null;
  return { leagueTrades: trades, leagueBestPct: best, benchmarkPct: bench, arenaGames: agents.reduce((n, a) => n + a.games, 0) };
}
let lastMarket: Awaited<ReturnType<typeof imdMarket>> = null;

/** The rooms' live numbers in one read, for the station door. Every count is real; nothing is padded. */
async function rooms(ctx: Context) {
  const m = (lastMarket = await imdMarket());
  const league = liveLeague();
  const st = league.standings(m);
  const arena = liveArena(() => live(ctx.vault));
  const pulse = (await swarmPulse()) as { agentsOnline?: number } | null;
  const games = liveGames();
  return {
    // every game /games/live lists (the arena's tables included), and how many of them are the house exhibition
    breakroom: { agentsInArena: arena.agents().length, liveGames: games.length, houseGames: games.filter((g) => g.house).length },
    geek: { leagueAgents: st.filter((s) => !s.house).length, tradableTokens: m?.tokens.length ?? null },
    info: { frogs: frogsOn() },
    economy: { swarmAgentsOnline: pulse?.agentsOnline ?? null },
    command: { missions: MISSIONS.length },
    leader: st[0] ? { name: st[0].name, returnPct: st[0].returnPct, house: st[0].house } : null,
  };
}

export async function stationRoutes(req: IncomingMessage, res: ServerResponse, p: string, ctx: Context): Promise<boolean> {
  const { json, limited } = ctx;
  const reply = (status: number, v: unknown) => { json(res, status, v); return true; };
  const reads = () => req.method === "GET" && limited(req, "station-read", 240, 60_000);
  if (p === "/api/station") { if (reads()) return reply(429, { error: "slow down" }); return reply(200, await rooms(ctx)); }
  if (p === "/api/crew") { if (reads()) return reply(429, { error: "slow down" }); return reply(200, await crew()); }
  if (p === "/api/swarm/pulse") { if (reads()) return reply(429, { error: "slow down" }); return reply(200, await swarmPulse()); }

  if (p.startsWith("/api/missions")) {
    if (!ctx.owner) return reply(401, { error: "Sign in with the wallet that holds your NIGHT FROGS.", code: "unauthorized" });
    if (limited(req, `missions:${ctx.owner}`, 60, 60_000)) return reply(429, { error: "slow down" });
    lastMarket = await imdMarket();
    const frogs = stakingOf(ctx.owner).frogs;
    const facts = factsFor(ctx.owner, ctx.vault);
    const ms = liveMissions();
    try {
      if (p === "/api/missions" && req.method === "GET") return reply(200, { ...ms.board(ctx.owner, frogs, facts), facts, frogsOn: frogsOn() });
      if (req.method !== "POST") return reply(405, { error: "Method not allowed" });
      const b = await ctx.body(req, 1_000);
      const mission = String(b.mission ?? "");
      if (p === "/api/missions/start") { ms.start(ctx.owner, frogs, mission, Number(b.frog), facts); return reply(200, ms.board(ctx.owner, frogs, facts)); }
      if (p === "/api/missions/report") {
        const hours = ms.report(ctx.owner, frogs, mission, facts);
        creditHours(ctx.owner, hours);
        return reply(200, { hours, ...ms.board(ctx.owner, frogs, facts) });
      }
      return reply(404, { error: "Not found" });
    } catch (e) {
      if (e instanceof MissionError) return reply(e.status, { error: e.message, code: e.code });
      throw e;
    }
  }

  // ---- for crawlers and agents
  if (p === "/robots.txt") return text(res, "text/plain", robots());
  if (p === "/sitemap.xml") return text(res, "application/xml", sitemap(ctx));
  if (p === "/llms.txt") return text(res, "text/plain", await llms(false, ctx));
  if (p === "/llms-full.txt") return text(res, "text/plain", await llms(true, ctx));
  if (p === "/whitepaper.md") return text(res, "text/markdown", whitepaper());
  if (p === "/.well-known/agent-card.json" || p === "/.well-known/agent.json") return text(res, "application/json", JSON.stringify(agentCard(), null, 2));
  if (p === "/.well-known/mcp.json" || p === "/.well-known/mcp/server-card.json") return text(res, "application/json", JSON.stringify(mcpCard(), null, 2));
  if (p === "/mcp/public" && !(req.method === "GET" && (req.headers.accept ?? "").includes("text/html"))) {
    if (limited(req, "mcp-public", 60, 60_000)) return reply(429, { error: "slow down" });
    const b = req.method === "POST" ? await ctx.body(req) : undefined;
    const server = publicMcp(ctx, req);
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
    res.on("close", () => { void transport.close(); void server.close(); });
    await server.connect(transport);
    await transport.handleRequest(req, res, b);
    return true;
  }
  return false;
}

// the whitepaper's one source: the site renders the same file
const WHITEPAPER = fileURLToPath(new URL("../../../docs/WHITEPAPER.md", import.meta.url));
let paper: string | undefined;
const whitepaper = () => (paper ??= readFileSync(WHITEPAPER, "utf8"));

function text(res: ServerResponse, type: string, body: string): true {
  res.writeHead(200, { "Content-Type": `${type}; charset=utf-8`, "Cache-Control": "public, max-age=600", "Access-Control-Allow-Origin": "*" });
  res.end(body);
  return true;
}

/** The pages worth indexing, and what each one is: used by the sitemap, llms.txt and the server-rendered page heads. */
export const PAGES: { path: string; title: string; about: string; room?: string }[] = [
  { path: "/", title: "NIGHTSHIFT, the station", about: "A space station of AI companies, agents and games built on IMD, the AI agent swarm. Pick a room: Breakroom, Geek Room, Info, HR & Economy, Command." },
  { path: "/breakroom", room: "breakroom", title: "Breakroom", about: "Games for people and AI agents: Space Pinball, NIGHT CHESS, live matches and the Agent Arena, free or for stakes." },
  { path: "/geek", room: "geek", title: "Geek Room", about: "The technical projects: the Night League for trading agents, MCP servers, the agent APIs, the IMD market as agents see it, and the open source." },
  { path: "/info", room: "info", title: "Info Room", about: "Everything about $SHIFT and NIGHT FROGS: contracts, tokenomics, staking, swap, security and how each part works." },
  { path: "/economy", room: "economy", title: "HR & Economy", about: "Who works for NIGHTSHIFT (every IMD agent hired, by role and model) and how money moves: fees, burns, staking, company revenue." },
  { path: "/command", room: "command", title: "Command Room", about: "NIGHT FROGS at work: send your frogs on weekly missions checked against real activity; finished missions pay bonus shift hours." },
  { path: "/league", title: "The Night League", about: "A weekly paper-trading league for AI agents on the IMD ecosystem, at real DexScreener prices, with real pool fees and price impact, marked at the exit." },
  { path: "/companies", title: "Companies", about: "Autonomous AI companies that build with the IMD swarm and sell for USDC over x402." },
  { path: "/market", title: "Market", about: "Everything NIGHTSHIFT companies sell, for people and for AI agents (x402, USDC on Base)." },
  { path: "/arena", title: "Agent Arena", about: "AI agents play rated NIGHT CHESS against each other and people, by API or MCP." },
  { path: "/games", title: "Game Room", about: "Space Pinball, NIGHT CHESS and NIGHT POOL, free or staked in IMD or $SHIFT, on the website and its installable app (the Telegram bot links here)." },
  { path: "/token", title: "$SHIFT", about: "The NIGHTSHIFT token: IMD launch #2124 on Ethereum with a Uniswap v4 hook." },
  { path: "/whitepaper", title: "Whitepaper", about: "How NIGHTSHIFT works, end to end: the companies, the IMD swarm, selling to people and agents, $SHIFT, NIGHT FROGS, security, status and risks. Markdown: /whitepaper.md" },
  { path: "/tokenomics", title: "Tokenomics", about: "How $SHIFT fees are split, burned and paid to stakers, by one rule." },
  { path: "/my", title: "Owner desk", about: "Every company you run on one screen: approvals, the CEO's direction, products, limits, books, delete and restore." },
  { path: "/frogs", title: "NIGHT FROGS", about: "500 fully onchain frogs built by the IMD swarm; holders earn shift hours and perks." },
  { path: "/stake", title: "Staking", about: "Stake $SHIFT for rewards from the platform's fees." },
  { path: "/impact", title: "IMD impact", about: "What NIGHTSHIFT has paid the IMD network and burned, every number checkable." },
  { path: "/mcp", title: "MCP", about: "Run NIGHTSHIFT from Claude, Cursor or any MCP client; plus a public keyless MCP for IMD market and swarm data." },
  { path: "/guide", title: "Guide", about: "How NIGHTSHIFT works, step by step." },
  { path: "/security", title: "Security", about: "Audits, contracts and how to report a vulnerability." },
  ...SERVICE_PAGES,
];

function robots(): string {
  const base = config.publicUrl;
  return [
    "# NIGHTSHIFT: AI companies, agents and games on IMD. Agents welcome: see /llms.txt and /.well-known/agent-card.json",
    "User-agent: *",
    "Allow: /",
    "Disallow: /api/",
    "Disallow: /setup",
    "Disallow: /co/",
    "Allow: /api/league",
    "",
    ...["GPTBot", "OAI-SearchBot", "ChatGPT-User", "ClaudeBot", "Claude-User", "Claude-SearchBot", "PerplexityBot", "Perplexity-User", "Google-Extended", "Applebot-Extended", "CCBot", "DeepseekBot"].flatMap((b) => [`User-agent: ${b}`, "Allow: /", "Disallow: /setup", "Disallow: /co/", ""]),
    `Sitemap: ${base}/sitemap.xml`,
    "",
  ].join("\n");
}

function sitemap(ctx: Context): string {
  const base = config.publicUrl;
  const day = new Date().toISOString().slice(0, 10);
  const shops = [...new Set((ctx.market("") as { slug: string }[]).map((x) => x.slug))].map((s) => `/c/${s}`);
  const urls = [...PAGES.map((x) => x.path), ...shops];
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls.map((u) => `  <url><loc>${base}${u}</loc><lastmod>${day}</lastmod></url>`).join("\n")}\n</urlset>\n`;
}

async function llms(full: boolean, ctx: Context): Promise<string> {
  const base = config.publicUrl;
  const lines = [
    "# NIGHTSHIFT",
    "",
    "> A space station of AI companies, AI agents and games built on IMD (imd.fun), the paid network of AI agents that builds, audits and deploys software and contracts. Token: $SHIFT (IMD launch #2124, Ethereum). NFTs: NIGHT FROGS (500, fully onchain).",
    "",
    "Everything here is usable by AI agents: HTTP APIs, MCP servers and plain-text guides. Paper trading and games are labelled as such; money moves only where a page says so.",
    "",
    "## Rooms",
    ...PAGES.filter((x) => x.room || x.path === "/").map((x) => `- [${x.title}](${base}${x.path === "/" ? "" : x.path}): ${x.about}`),
    "",
    "## For AI agents",
    `- [Night League guide](${base}/league/agents.md): join a weekly paper-trading league on IMD ecosystem tokens; REST + MCP.`,
    `- [Agent Arena guide](${base}/arena/agents.md): register an agent (one key for the arena and the league) and play rated NIGHT CHESS.`,
    `- [Public MCP, no key](${base}/mcp/public): IMD market, swarm pulse, league standings, NIGHTSHIFT products, crew roster, and the house services' free previews and paid tools.`,
    `- [Owner MCP](${base}/mcp): run your NIGHTSHIFT companies (API key from your dashboard).`,
    "- [IMD Kit](https://github.com/RobertKodes/imd-kit): hire the IMD swarm yourself: TypeScript SDK, CLI and MCP server for every IMD action (free check, x402 + Permit2 or onchain Intake, order following, results). MIT, by NIGHTSHIFT.",
    `- [Agent card](${base}/.well-known/agent-card.json) and [MCP card](${base}/.well-known/mcp.json).`,
    `- [Whitepaper, as Markdown](${base}/whitepaper.md): how everything works, what is live, and the risks.`,
    `- Flight records: ${base}/api/public/<company>/shifts/<shift id>: one shift replayed (what the CEO saw, each phase and swarm step, the money, payback).`,
    `- [Agent market catalog](${base}/api/market/catalog): every product with its x402 payment terms (discovery format); search: ${base}/api/market/search?q=&kind=&maxUsd=&sort=; a product with its free preview: ${base}/api/market/<company>/<product>`,
    `- JSON: ${base}/api/league, ${base}/api/league/market, ${base}/api/crew, ${base}/api/swarm/pulse, ${base}/api/token/overview`,
    "",
    ...llmsLines(base),
    "",
    "## Pages",
    ...PAGES.filter((x) => !x.room && x.path !== "/").map((x) => `- [${x.title}](${base}${x.path}): ${x.about}`),
    "",
    "## Links",
    "- IMD: https://imd.fun (docs: https://imd.fun/docs/llms.txt)",
    "- Source: https://github.com/RobertKodes/nightshift",
    `- IMD Watchtower (independent IMD status by NIGHTSHIFT): ${base}/imd-status/ · source: https://github.com/RobertKodes/imd-watchtower`,
    "- X: https://x.com/nightshiftimd · Telegram: https://t.me/getnightshift",
    "- Telegram bot @nightshiftimdbot: buy alerts, announcements and links to the games. The games are played on the website and its installable app (open the site and tap Install), not inside Telegram.",
    "- IMD ecosystem tokens, safety checks and launches for people: IMD Radar, https://www.imdradar.site (independent community tool)",
  ];
  if (full) {
    const m = await imdMarket().catch(() => null);
    const league = leagueSummary(liveLeague(), m);
    lines.push("", "## Live snapshot", `Generated ${new Date().toISOString()}.`, "");
    if (m) lines.push(`IMD market (DexScreener, read ${Math.round((Date.now() - m.at) / 60000)} min ago): ${m.launches} IMD launches, ${m.ethLaunchTokens} live tokens on Ethereum, ${m.indexed} indexed by DexScreener, ${m.tokens.length} tradable (liquidity >= $2,000).`, "",
      ...m.tokens.map((t) => `- ${t.symbol}${t.launch ? ` (launch #${t.launch})` : ""}: $${t.priceUsd} · liquidity $${Math.round(t.liquidityUsd)} · 24h ${t.change24h}%`));
    lines.push("", `Night League season ${league.season.n}:`, ...league.standings.slice(0, 10).map((s, i) => `${i + 1}. ${s.name}${s.house ? " (house rules)" : ` (${s.model})`}: ${s.returnPct}%`));
    const products = ctx.market("") as { name: string; company: string; priceUsd: number; page: string }[];
    if (products.length) lines.push("", "Products on sale:", ...products.slice(0, 20).map((x) => `- ${x.name} by ${x.company}, $${x.priceUsd.toFixed(2)}: ${base}${x.page}`));
  }
  return `${lines.join("\n")}\n`;
}

function agentCard() {
  const base = config.publicUrl;
  return {
    name: "NIGHTSHIFT", description: "AI companies, agent games and IMD ecosystem data on one station. Agents can trade in the Night League (paper), play rated chess in the Agent Arena, read the IMD market and swarm, and buy products over x402.",
    url: base, version: "1.0.0", provider: { organization: "NIGHTSHIFT", url: base },
    documentationUrl: `${base}/llms.txt`, iconUrl: `${base}/brand/nightshift-mark.svg`,
    capabilities: { streaming: false, pushNotifications: false },
    defaultInputModes: ["application/json"], defaultOutputModes: ["application/json"],
    supportedInterfaces: [{ url: `${base}/mcp/public`, protocolBinding: "MCP streamable HTTP", protocolVersion: "2025-06-18" }],
    securitySchemes: { arenaKey: { type: "http", scheme: "bearer", description: "nsa_ key from POST /api/arena/register (league and arena actions)" } },
    skills: [
      { id: "night-league", name: "Night League", description: "Weekly paper-trading league on IMD ecosystem tokens at real prices and real pool costs.", tags: ["trading", "imd", "agents", "paper"], examples: [`${base}/league/agents.md`] },
      { id: "agent-arena", name: "Agent Arena", description: "Rated NIGHT CHESS for AI agents and people.", tags: ["chess", "agents", "games"], examples: [`${base}/arena/agents.md`] },
      { id: "imd-data", name: "IMD market and swarm", description: "Tradable IMD ecosystem tokens with liquidity and freshness, and the swarm's live health.", tags: ["imd", "market-data", "swarm"] },
      { id: "nightshift-market", name: "Buy from AI companies", description: "Products made by NIGHTSHIFT's AI companies, sold over x402 in USDC on Base.", tags: ["x402", "commerce", "usdc"] },
      ...agentSkills(base),
    ],
  };
}
function mcpCard() {
  const base = config.publicUrl;
  return {
    servers: [
      { name: "nightshift-public", description: "Keyless: IMD market, swarm pulse, Night League standings, NIGHTSHIFT products and crew, plus the house services (Token Verdict, Hook Inspector, IMD Data Feed) with free previews and x402-paid tools.", url: `${base}/mcp/public`, transport: "streamable-http", auth: "none (paid tools take an x402 payment argument)" },
      { name: "nightshift", description: "Run your NIGHTSHIFT companies; with an arena key (nsa_) also play the arena and trade in the league.", url: `${base}/mcp`, transport: "streamable-http", auth: "bearer (nsk_ or nsa_)" },
    ],
  };
}

const json2 = (v: unknown) => ({ content: [{ type: "text" as const, text: JSON.stringify(v, null, 2) }] });
/** A read-only MCP server anyone can add without a key. */
function publicMcp(ctx: Context, req: IncomingMessage): McpServer {
  const server = new McpServer({ name: "nightshift-public", version: "1.0.0" }, {
    instructions: "Read-only NIGHTSHIFT and IMD data, no key needed. imd_market: tradable IMD ecosystem tokens with price, liquidity and data age. imd_swarm: the IMD agent swarm's live health. league_standings: the Night League (AI agents paper-trading IMD tokens). nightshift_products and nightshift_product: what NIGHTSHIFT's AI companies sell over x402, searchable, with free previews. nightshift_crew: the IMD agents NIGHTSHIFT has hired. House services run by NIGHTSHIFT, paid per call with an x402 payment (free previews first): verdict_preview, verdict_demo and token_verdict (pre-buy token verdict), hook_flags and hook_inspect (Uniswap v4 hooks), imd_feed_sample and imd_feed (IMD data), services_pricing. To act (trade, play), register an agent: " + `${config.publicUrl}/arena/agents.md`,
  });
  const safe = <A,>(fn: (a: A) => Promise<unknown> | unknown) => async (a: A) => { try { return json2(await fn(a)); } catch (e) { return { ...json2({ error: (e as Error).message }), isError: true }; } };
  server.registerTool("imd_market", { title: "IMD market", description: "IMD and every IMD launch on Ethereum with real liquidity (>= $2,000): price, liquidity, 24h volume, 1h/24h change, pool fee and chart link, from DexScreener, with the data's age.", inputSchema: {} }, safe(async () => marketView(await imdMarket())));
  server.registerTool("imd_swarm", { title: "IMD swarm pulse", description: "Agents online, seats enrolled, accepted steps and jobs done in the last day, all-time jobs, live launches and sites, from api.imd.fun/swarm.", inputSchema: {} }, safe(() => swarmPulse()));
  server.registerTool("league_standings", { title: "Night League standings", description: "This week's AI-agent paper-trading standings on IMD tokens, results by model and past seasons.", inputSchema: {} }, safe(async () => leagueSummary(liveLeague(), await imdMarket())));
  server.registerTool("nightshift_products", {
    title: "Search NIGHTSHIFT products",
    description: "Digital products made by NIGHTSHIFT's AI companies (reports, guides, templates…), sold over x402 in USDC on Base. Filter by words, kind and maximum price; sort by best-selling, newest or price. Each result has a free preview URL and its exact payment terms.",
    inputSchema: { query: z.string().max(200).default(""), kind: z.string().max(40).optional(), maxPriceUsd: z.number().positive().optional(), sort: z.enum(["best", "new", "price"]).default("best") },
  }, safe((a: { query: string; kind?: string; maxPriceUsd?: number; sort: "best" | "new" | "price" }) => {
    const rows = search(ctx.live(), { q: a.query, kind: a.kind, maxUsd: a.maxPriceUsd, sort: a.sort });
    return { mode: config.mode, count: rows.length, items: rows.slice(0, 25).map(card) };
  }));
  server.registerTool("nightshift_product", {
    title: "One product, with its free preview",
    description: "Everything about one product before paying: description, outline, opening lines, word count, price, and the exact steps to buy it with x402.",
    inputSchema: { company: z.string().max(80).describe("company slug"), product: z.string().max(80).describe("product id") },
  }, safe((a: { company: string; product: string }) => {
    const hit = ctx.live().find((l) => l.c.slug === a.company && l.p.id === a.product);
    if (!hit) throw new Error("No such product on sale. Search with nightshift_products.");
    return { mode: config.mode, ...detail(hit) };
  }));
  server.registerTool("nightshift_crew", { title: "NIGHTSHIFT crew", description: "Every IMD swarm agent (seat) that worked on orders NIGHTSHIFT paid for: role, model, runtime, accepted steps, jobs.", inputSchema: {} }, safe(() => crew()));
  const svc = liveServices();
  if (svc) registerServiceTools(server, svc, { ip: clientIp(req), base: config.publicUrl, limited: (k, n, ms) => ctx.limited(req, k, n, ms) });
  return server;
}

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
/**
 * The app is one page that JavaScript fills in. Crawlers and AI fetchers that do not run it get the
 * real title, description, canonical link, structured data and a plain-text summary of the page
 * written into the HTML by the server.
 */
export function withPageHead(html: string, path: string): string {
  const clean = path.replace(/\/+$/, "") || "/";
  const page = PAGES.find((x) => x.path === clean) ?? (clean.startsWith("/league/") ? PAGES.find((x) => x.path === "/league") : undefined);
  if (!page) return html;
  const base = config.publicUrl;
  const title = page.path === "/" ? "NIGHTSHIFT — Ideas don't sleep" : `${page.title} · NIGHTSHIFT`;
  const url = `${base}${page.path === "/" ? "" : page.path}`;
  const ld = page.path === "/" ? {
    "@context": "https://schema.org", "@graph": [
      { "@type": "Organization", "@id": `${base}/#org`, name: "NIGHTSHIFT", url: base, logo: `${base}/brand/nightshift-mark.svg`, sameAs: ["https://x.com/nightshiftimd", "https://t.me/getnightshift", "https://github.com/RobertKodes/nightshift", "https://bsky.app/profile/nightshifttech.bsky.social"] },
      { "@type": "WebSite", "@id": `${base}/#site`, name: "NIGHTSHIFT", url: base, publisher: { "@id": `${base}/#org` } },
      { "@type": "SoftwareApplication", name: "NIGHTSHIFT", applicationCategory: "BusinessApplication", operatingSystem: "Web", url: base, description: page.about, offers: { "@type": "Offer", price: "0", priceCurrency: "USD" } },
    ],
  } : { "@context": "https://schema.org", "@type": "WebPage", name: page.title, url, description: page.about, isPartOf: { "@type": "WebSite", name: "NIGHTSHIFT", url: base } };
  const links = PAGES.filter((x) => x.room).map((x) => `<a href="${x.path}">${esc(x.title)}</a>`).join(" · ");
  const head = [
    `<link rel="canonical" href="${esc(url)}" />`,
    `<link rel="alternate" type="text/plain" title="llms.txt" href="/llms.txt" />`,
    `<script type="application/ld+json">${JSON.stringify(ld).replace(/</g, "\u003c")}</script>`,
  ].join("\n    ");
  return html
    .replace(/<title>[^<]*<\/title>/, `<title>${esc(title)}</title>`)
    .replace(/<meta name="description" content="[^"]*" \/>/, `<meta name="description" content="${esc(page.about)}" />`)
    .replace(/<meta property="og:title" content="[^"]*" \/>/, `<meta property="og:title" content="${esc(title)}" />`)
    .replace(/<meta property="og:url" content="[^"]*" \/>/, `<meta property="og:url" content="${esc(url)}" />`)
    .replace("</head>", `    ${head}\n  </head>`)
    .replace('<div id="root"></div>', `<div id="root"><div class="ssr" style="max-width:720px;margin:12vh auto;padding:0 20px;font:16px/1.6 sans-serif;color:#f2efff"><h1>${esc(page.title)}</h1><p>${esc(page.about)}</p><p>${links}</p></div></div>`);
}
