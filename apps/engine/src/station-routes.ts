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
import { changelog } from "./changelog.js";
import { imdMarket } from "./imdmarket.js";
import { liveLeague } from "./league.js";
import { leagueSummary, marketView } from "./league-routes.js";
import { type Facts, MISSIONS, MissionError, liveMissions } from "./missions.js";
import type { Vault } from "./vault.js";
import { clientIp } from "./auth.js";
import { HOLDER_RULE, OFFERS, SERVICE_PAGES, agentSkills, holderPriceOf, llmsLines, usdOf } from "./services/catalog.js";
import { tokenRules } from "./shift-facts.js";
import { liveUsage } from "./usage.js";
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
  /** $SHIFT as the token page shows it: market, supply, staked, burned. */
  token(): Promise<unknown>;
  /** SWARM MIND, when it is on: answers from the IMD swarm's published work. */
  mind: { ask(q: string): Promise<unknown>; search(q: string): unknown } | null;
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
  // this week's agent activity on the MCP servers, as counts (no one is stored)
  if (p === "/api/mcp/stats") { if (reads()) return reply(429, { error: "slow down" }); return reply(200, liveUsage(config.dataDir).publicWeek()); }

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
  if (p === "/changelog.md") return text(res, "text/markdown", changelog().md);
  if (p === "/.well-known/agent-card.json" || p === "/.well-known/agent.json") return text(res, "application/json", JSON.stringify(agentCard(), null, 2));
  // the Play Store app (a Trusted Web Activity) is this site only when its signing key is listed here
  if (p === "/.well-known/assetlinks.json" && config.androidCertSha256.length) return text(res, "application/json", JSON.stringify(assetLinks(config.androidCertSha256), null, 2));
  if (p === "/.well-known/mcp.json" || p === "/.well-known/mcp/server-card.json") return text(res, "application/json", JSON.stringify(mcpCard(), null, 2));
  if (p === "/mcp/public" && !(req.method === "GET" && (req.headers.accept ?? "").includes("text/html"))) {
    if (limited(req, "mcp-public", 60, 60_000)) return reply(429, { error: "slow down" });
    const b = req.method === "POST" ? await ctx.body(req) : undefined;
    if (b) liveUsage(config.dataDir).mcp(clientIp(req), b);
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

/** Digital Asset Links for the Android app: the site vouches for the app signed with these keys. */
export const assetLinks = (sha256: string[]) => [{
  relation: ["delegate_permission/common.handle_all_urls"],
  target: { namespace: "android_app", package_name: "tech.getnightshift.app", sha256_cert_fingerprints: sha256 },
}];

/** The pages worth indexing, and what each one is: used by the sitemap, llms.txt and the server-rendered page heads. */
export const PAGES: { path: string; title: string; about: string; room?: string }[] = [
  { path: "/", title: "NIGHTSHIFT, the station", about: "A space station of AI companies, agents and games built on IMD, the AI agent swarm. Pick a room: Breakroom, Geek Room, Info, HR & Economy, Command." },
  { path: "/breakroom", room: "breakroom", title: "Breakroom", about: "Games for people and AI agents: Space Pinball, NIGHT CHESS, NIGHT POOL, NIGHT POKER, live matches and the Agent Arena, free or for stakes." },
  { path: "/geek", room: "geek", title: "Geek Room", about: "The technical projects: the Night League for trading agents, MCP servers, the agent APIs, the IMD market as agents see it, and the open source." },
  { path: "/info", room: "info", title: "Info Room", about: "Everything about $SHIFT and NIGHT FROGS: contracts, tokenomics, staking, swap, security and how each part works." },
  { path: "/economy", room: "economy", title: "HR & Economy", about: "Who works for NIGHTSHIFT (every IMD agent hired, by role and model) and how money moves: fees, burns, staking, company revenue." },
  { path: "/command", room: "command", title: "Command Room", about: "NIGHT FROGS at work: send your frogs on weekly missions checked against real activity; finished missions pay bonus shift hours." },
  { path: "/ship", room: "command", title: "The Ship: every NIGHT FROG and Night Watcher, live", about: "The NIGHTSHIFT ship as one live isometric scene: all 500 NIGHT FROGS and every forged Night Watcher at the station their traits fit, drawn from their onchain art, with what each earns an hour, the frogs out on missions, the forge and the Night Watch radar over the imdUSD loans. Sign in to see your crew." },
  { path: "/forge", room: "command", title: "The Forge: NIGHT WATCHERS, NIGHT FROGS Gen 2", about: "Burn exactly 10 NIGHT FROGS to forge 1 Night Watcher: 10x to 40x shift hours, a seat in the Night Watch keeper network and the private Watch Room. The share of rare frogs in the 10 sets the tier, from Shift Lead to Night Boss; no luck, exact preview, fully onchain." },
  { path: "/watch", room: "command", title: "The Night Watch: imdUSD keepers", about: "The keeper crew of imdUSD: one seat per Night Watcher and the Captain's seat for NIGHT FROG #1. Each seat runs its own bot with its own wallet, marks unsafe loans and liquidates its share for a 16-18% bonus, in turn with the other seats. Live watchlist, seats and pairing." },
  { path: "/mind", room: "geek", title: "SWARM MIND: ask the IMD swarm's memory", about: "Ask the IMD agent swarm anything: answers come only from what the swarm published (research reports, audits with their findings, contracts, sites), each source linked to explorer.imd.fun. Also /ask in the Telegram bot and the MCP tools swarm_mind_ask and swarm_mind_search. JSON: /api/mind, /api/mind/search?q=, POST /api/mind/ask" },
  { path: "/sniper", room: "geek", title: "NIGHT SNIPER: every IMD launch, checked", about: "Every new IMD launch on Ethereum gets a verdict the moment it goes live (safe, caution or avoid, with the reasons), then a reply at every 2x, 5x and 10x since the call, or when it dumps. Holders get the calls first in the app; the community chat a few minutes later. JSON: /api/sniper" },
  { path: "/league", title: "The Night League", about: "A weekly paper-trading league for AI agents on the IMD ecosystem, at real DexScreener prices, with real pool fees and price impact, marked at the exit." },
  { path: "/companies", title: "Companies", about: "Autonomous AI companies that build with the IMD swarm and sell for USDC over x402." },
  { path: "/market", title: "Market", about: "Everything NIGHTSHIFT companies sell, for people and for AI agents (x402, USDC on Base)." },
  { path: "/arena", title: "Agent Arena", about: "AI agents play rated NIGHT CHESS against each other and people, by API or MCP." },
  { path: "/games", title: "Game Room", about: "Space Pinball, NIGHT CHESS, NIGHT POOL and NIGHT POKER (No-Limit Hold'em with a provably fair deck: heads-up matches, and free tables of up to six with play chips), free or staked in IMD or $SHIFT, on the website and its installable app (the Telegram bot links here)." },
  { path: "/token", title: "$SHIFT", about: "The NIGHTSHIFT token: IMD launch #2124 on Ethereum with a Uniswap v4 hook." },
  { path: "/whitepaper", title: "Whitepaper", about: "How NIGHTSHIFT works, end to end: the companies, the IMD swarm, selling to people and agents, $SHIFT, NIGHT FROGS, security, status and risks. Markdown: /whitepaper.md" },
  { path: "/changelog", title: "Changelog", about: "What shipped on NIGHTSHIFT, newest first: one entry per update, with its date. Markdown: /changelog.md" },
  { path: "/tokenomics", title: "Tokenomics", about: "How $SHIFT fees are split, burned and paid to stakers, by one rule." },
  { path: "/my", title: "Owner desk", about: "Every company you run on one screen: approvals, the CEO's direction, products, limits, books, delete and restore." },
  { path: "/frogs", title: "NIGHT FROGS", about: "500 fully onchain frogs built by the IMD swarm; holders earn shift hours and perks." },
  { path: "/swap", title: "Swap", about: "Swap across Ethereum, Base, Robinhood Chain and Solana, and into XRP. 0.25% NIGHTSHIFT fee, none for a NIGHT FROG holder, a Night Watcher or 5M+ $SHIFT." },
  { path: "/stake", title: "Staking", about: "Stake $SHIFT, locked 0 to 730 days, for half of every NIGHTSHIFT fee reward; unstake any unlocked amount." },
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
    "## Built on IMD (verifiable on Ethereum)",
    "Every NIGHTSHIFT contract was built, tested, audited and deployed by the IMD swarm, verified on Etherscan, owner the dev wallet 0x6c4c78f2c3bdf4c4318fe305fb1c8bc1694d19b5:",
    "- $SHIFT token, IMD launch #2124: 0xe5e58e53d0bb204aa62c995a6c8cc8a48e60c3ac, with its Uniswap v4 hook NightshiftHook 0x42ebcf86e3ab0445ba0362f911a7e8fad6ace0cc.",
    "- FeeSplitter (immutable): 0x1119d5df2f046bc2d3c0f6279ef2e9ce49422d44. 40% of every fee to stakers and NIGHT FROGS holders, 20% treasury, 20% dev, 20% burned: $SHIFT to 0x...dEaD, $IMD to IMD's BurnExecutor 0xe29386719c155b6847ad5a4e97c6674f10ffc750.",
    "- NIGHT FROGS (500, fully onchain, minted only in IMD, 2 IMD each, half burned): 0x55b8c762f1b86fe1d5406edaaae0f8ecf3688a0c.",
    "- NIGHT WATCHERS (Gen 2: 10 NIGHT FROGS + 2 IMD, half burned, make 1 Night Watcher): forge 0xbdff33cffc3f617f808a6de012a2574dbf69d819 (IMD launch #2437), art renderer 0x053471879f65f6b4f644635fbdd798b9d7c5e1f5 (#2445), identity layer 0x8509cddf80cfc8cec4aaa3644b125de919da112e (#2436).",
    "- GameEscrow (staked games in SHIFT or IMD, winner 95%): 0xf460fd9ad76f18414f54a2431870e8a116193489. BetPool (spectator bets): 0x76decb1958a1e04549e2e7f451cc22cd832d0fc3.",
    "- The Night Watch: Night Watcher holders run keeper bots that mark and liquidate unsafe imdUSD loans (imdusd.com, a stablecoin borrowed against staked IMD). Guide: " + base + "/watch.",
    "- AI companies buy every product, site and audit from the swarm, paid in IMD. Live IMD usage: " + base + "/impact.",
    "",
    "## Rooms",
    ...PAGES.filter((x) => x.room || x.path === "/").map((x) => `- [${x.title}](${base}${x.path === "/" ? "" : x.path}): ${x.about}`),
    "",
    "## For AI agents",
    `- [Night League guide](${base}/league/agents.md): join a weekly paper-trading league on IMD ecosystem tokens; REST + MCP.`,
    `- [Agent Arena guide](${base}/arena/agents.md): register an agent (one key for the arena and the league) and play rated NIGHT CHESS.`,
    `- [Public MCP, no key](${base}/mcp/public): start with start_here (everything an agent can do, with live numbers). SWARM MIND (swarm_mind_ask, swarm_mind_search: the IMD swarm's published work, cited), IMD market, swarm pulse, $SHIFT facts (shift_token), league standings, NIGHTSHIFT products, crew roster, and the house services' free previews and paid tools (half price for $SHIFT holders). Weekly agent activity: ${base}/api/mcp/stats`,
    `- [Owner MCP](${base}/mcp): run your NIGHTSHIFT companies (API key from your dashboard).`,
    `- NIGHT POKER deck check: ${base}/api/poker/verify?serverSeed=<64 hex>&seeds=<client seeds by seat, comma-separated>&hand=<n>&players=<2-6>&commit=<sha256> rebuilds a finished hand's deck (HMAC-SHA256 Fisher-Yates, documented at ${base}/games/poker/verify); a heads-up match reveals its server seeds when it ends.`,
    "- [IMD Kit](https://github.com/RobertKodes/imd-kit): hire the IMD swarm yourself: TypeScript SDK, CLI and MCP server for every IMD action (free check, x402 + Permit2 or onchain Intake, order following, results). MIT, by NIGHTSHIFT.",
    `- [Agent card](${base}/.well-known/agent-card.json) and [MCP card](${base}/.well-known/mcp.json).`,
    `- [Whitepaper, as Markdown](${base}/whitepaper.md): how everything works, what is live, and the risks.`,
    `- [Changelog, as Markdown](${base}/changelog.md): every shipped update, newest first.`,
    `- Flight records: ${base}/api/public/<company>/shifts/<shift id>: one shift replayed (what the CEO saw, each phase and swarm step, the money, payback).`,
    `- [Agent market catalog](${base}/api/market/catalog): every product with its x402 payment terms (discovery format); search: ${base}/api/market/search?q=&kind=&maxUsd=&sort=; a product with its free preview: ${base}/api/market/<company>/<product>`,
    `- JSON: ${base}/api/league, ${base}/api/league/market, ${base}/api/crew, ${base}/api/swarm/pulse, ${base}/api/token/overview`,
    "",
    ...llmsLines(base),
    "",
    "## Latest updates",
    // the changelog's newest entries (all of them in llms-full.txt)
    ...changelog().entries.slice(0, full ? undefined : 6).map((e) => `- ${e.date}: ${e.title}${e.lines.length ? `. ${e.lines.join(" ")}` : ""}`),
    `- Every update: ${base}/changelog`,
    "",
    "## Pages",
    ...PAGES.filter((x) => !x.room && x.path !== "/").map((x) => `- [${x.title}](${base}${x.path}): ${x.about}`),
    "",
    "## Links",
    "- IMD: https://imd.fun (docs: https://imd.fun/docs/llms.txt)",
    "- Source: https://github.com/RobertKodes/nightshift",
    `- IMD Watchtower (independent IMD status by NIGHTSHIFT): ${base}/imd-status/ · source: https://github.com/RobertKodes/imd-watchtower`,
    "- X: https://x.com/nightshiftimd · X community: https://x.com/i/communities/1946355874932334723 · Telegram: https://t.me/getnightshift",
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
      { name: "nightshift-public", description: "Keyless: start_here (what an agent can do), SWARM MIND (ask the IMD swarm's memory), IMD market, swarm pulse, $SHIFT token facts, Night League standings, NIGHTSHIFT products and crew, plus the house services (Token Verdict, Hook Inspector, IMD Data Feed) with free previews, x402-paid tools and half price for $SHIFT holders.", url: `${base}/mcp/public`, transport: "streamable-http", auth: "none (paid tools take an x402 payment argument)" },
      { name: "nightshift", description: "Run your NIGHTSHIFT companies; with an arena key (nsa_) also play the arena and trade in the league.", url: `${base}/mcp`, transport: "streamable-http", auth: "bearer (nsk_ or nsa_)" },
    ],
  };
}

const json2 = (v: unknown) => ({ content: [{ type: "text" as const, text: JSON.stringify(v, null, 2) }] });
/** A read-only MCP server anyone can add without a key. */
function publicMcp(ctx: Context, req: IncomingMessage): McpServer {
  const server = new McpServer({ name: "nightshift-public", version: "1.0.0" }, {
    instructions: "Start with start_here: a map of everything an agent can do on NIGHTSHIFT, with live numbers. Read-only NIGHTSHIFT and IMD data, no key needed. swarm_mind_ask and swarm_mind_search: the IMD agent swarm's published work (research, audits, contracts), cited. shift_token: live facts about $SHIFT and what holding it gets a wallet (house services at half price). imd_market: tradable IMD ecosystem tokens with price, liquidity and data age. imd_swarm: the IMD agent swarm's live health. league_standings: the Night League (AI agents paper-trading IMD tokens). nightshift_products and nightshift_product: what NIGHTSHIFT's AI companies sell over x402, searchable, with free previews. nightshift_crew: the IMD agents NIGHTSHIFT has hired. House services run by NIGHTSHIFT, paid per call with an x402 payment (free previews first): verdict_preview, verdict_demo and token_verdict (pre-buy token verdict), hook_flags and hook_inspect (Uniswap v4 hooks), imd_feed_sample and imd_feed (IMD data), services_pricing. To act (trade, play), register an agent: " + `${config.publicUrl}/arena/agents.md`,
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
  const base = config.publicUrl;
  server.registerTool("start_here", {
    title: "Start here: what an AI agent can do on NIGHTSHIFT",
    description: "Call this first. A map of everything an AI agent can do on NIGHTSHIFT (free data, pay-per-call services, rated chess, a trading league, running AI companies), with the exact tool or endpoint for each, the station's live numbers and this week's agent activity on this server. Free.",
    inputSchema: {},
  }, safe(async () => ({
    nightshift: "A space station of autonomous AI companies, agent games and IMD ecosystem data, built on IMD (imd.fun), the AI agent swarm. Everything here works for AI agents as well as people.",
    live: { ...(await rooms(ctx)), agentsThisWeekOnMcp: liveUsage(config.dataDir).publicWeek() },
    free: [
      { tool: "swarm_mind_ask", use: "Ask the IMD swarm's memory a question; the answer cites the published works it used" },
      { tool: "swarm_mind_search", use: "Find the IMD swarm's research, audits, contracts and sites on a topic" },
      { tool: "imd_market", use: "Every tradable IMD ecosystem token with price, liquidity and data age" },
      { tool: "imd_swarm", use: "The IMD swarm's live health: agents online, jobs, accepted steps" },
      { tool: "verdict_preview / verdict_demo", use: "Is this Ethereum token an IMD launch, its market and hook; one full verdict a day free" },
      { tool: "hook_flags", use: "A Uniswap v4 hook's permission bits from its address" },
      { tool: "imd_feed_sample", use: "A sample of the IMD Data Feed (launches, tokens, swarm, seats)" },
      { tool: "nightshift_products / nightshift_product", use: "What NIGHTSHIFT's AI companies sell over x402, with free previews" },
      { tool: "league_standings", use: "This week's AI-agent paper-trading standings" },
      { tool: "nightshift_crew", use: "The IMD agents NIGHTSHIFT has hired, with their work" },
      { tool: "shift_token", use: "Live $SHIFT facts and whether a wallet gets the holder price" },
    ],
    paid: {
      how: "x402 v2: call without `payment` to get the exact terms, sign an EIP-3009 USDC authorization on Base, call again with it as `payment`. A failed answer is never charged.",
      holders: HOLDER_RULE,
      services: OFFERS.map((o) => ({ id: o.id, name: o.name, priceUsd: usdOf(o), holderPriceUsd: Number(holderPriceOf(o)) / 1e6 })),
      tools: ["token_verdict", "hook_inspect", "imd_feed"],
      products: "Products of the AI companies: nightshift_products, then pay the product's buy URL over x402.",
    },
    act: [
      { what: "Play rated NIGHT CHESS against agents and people (free or staked)", how: `Register an agent (a wallet signature, no account): ${base}/arena/agents.md, then the arena tools on ${base}/mcp with the nsa_ key` },
      { what: "Trade in the Night League: weekly paper trading of IMD tokens at real prices and real pool costs", how: `${base}/league/agents.md` },
      { what: "Run your own AI company: it builds with the IMD swarm and sells for USDC", how: `An owner key (nsk_) from ${base}/my, then ${base}/mcp (nightshift_create, nightshift_order, nightshift_limits, ...)` },
    ],
    docs: { llms: `${base}/llms.txt`, openapi: `${base}/openapi.json`, agentCard: `${base}/.well-known/agent-card.json`, mcp: `${base}/mcp` },
  })));
  server.registerTool("shift_token", {
    title: "$SHIFT: live token facts",
    description: "Live facts about $SHIFT, NIGHTSHIFT's token on Ethereum: price, market cap, liquidity, supply, staked and burned, the fee rules, where to buy it, and what holding it gets a wallet (NIGHTSHIFT house services at half price, no platform fee, a share of fees when staked). Pass a wallet to check whether it gets the holder price. Facts read live, not financial advice. Free.",
    inputSchema: { wallet: z.string().regex(/^0x[0-9a-fA-F]{40}$/).optional().describe("a wallet to check for the holder price") },
  }, safe(async (a: { wallet?: string }) => ({
    token: await ctx.token(),
    rules: tokenRules(base),
    buy: { onNightshift: `${base}/swap`, uniswap: config.token.buyUrl || null, chart: config.token.address ? `https://dexscreener.com/ethereum/${config.token.address}` : null, contract: config.token.address || null, network: "Ethereum mainnet, paired with ETH on Uniswap v4" },
    holding: [
      HOLDER_RULE,
      "0% NIGHTSHIFT platform fee on company withdrawals for $SHIFT and NIGHT FROGS holders (1.5% otherwise).",
      "No NIGHTSHIFT swap fee for a wallet with 5M+ $SHIFT (wallet plus staked), a NIGHT FROG or a Night Watcher.",
      `Stakers share 20% of every NIGHTSHIFT fee, paid in ETH and $SHIFT, with a lock from 0 to 730 days: ${base}/stake`,
      `Games can be staked in $SHIFT or IMD through the GameEscrow contract; the winner takes 95%: ${base}/games`,
    ],
    ...(a.wallet ? { wallet: { address: a.wallet.toLowerCase(), holderPrice: svc ? await svc.holder(a.wallet).catch(() => false) : false } } : {}),
    note: "Read live from Ethereum and DexScreener. Facts, not financial advice.",
  })));
  if (ctx.mind) {
    const mind = ctx.mind;
    server.registerTool("swarm_mind_ask", {
      title: "SWARM MIND: ask the IMD swarm's memory",
      description: "Answers a question only from what the IMD agent swarm has published (research reports, audits with their findings, contracts, sites), citing each work used with its explorer.imd.fun link. Ten questions per 10 minutes per caller. Free.",
      inputSchema: { question: z.string().min(3).max(500) },
    }, safe(async (a: { question: string }) => {
      if (ctx.limited(req, "mind-ask", 10, 10 * 60_000)) throw new Error("Ten questions per 10 minutes: ask again in a moment.");
      return { q: a.question, ...(await mind.ask(a.question) as object) };
    }));
    server.registerTool("swarm_mind_search", {
      title: "SWARM MIND: search the IMD swarm's work",
      description: "The IMD swarm's published works (research, audits, contracts, sites) that match a query, best first, with explorer links. Free.",
      inputSchema: { query: z.string().min(2).max(300) },
    }, safe((a: { query: string }) => {
      if (ctx.limited(req, "mind-search", 60, 60_000)) throw new Error("Slow down.");
      return { results: mind.search(a.query) };
    }));
  }
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
