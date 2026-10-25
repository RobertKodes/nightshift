import { existsSync, readFileSync, statSync } from "node:fs";
import { type IncomingMessage, type ServerResponse, createServer } from "node:http";
import { gzipSync } from "node:zlib";
import { extname, join, normalize, resolve, sep } from "node:path";
import type { Company, Product } from "@nightshift/core";
import { NameError, saveName, savedName } from "./players.js";
import { attachLastspawn } from "./lastspawn/index.js";
import { fromImd, fromUsdc } from "@nightshift/core";
import { type PaymentPayload, USDC, challenge as challenge402, decodeHeader, encodeHeader, requirement, verifyPayment } from "@nightshift/x402";
import { balances, eth, sales } from "./chain.js";
import { NoGasError, PaymentRefused, PendingError } from "./checkout.js";
import { findPool } from "./v4.js";
import { BOT, liveStats, pageClosed, pageOpened, sawVisitor } from "./live.js";
import { liveUsage } from "./usage.js";
import { liveArena } from "./arena.js";
import { buildCheck } from "./crews/buildcheck.js";
import { crewLedger, crewOperators, crewProfiles, crewSeason } from "./crews/live.js";
import { crewRoutes } from "./crews/routes.js";
import { proof } from "./proof.js";
import { crewHighlights, liveWatchtower } from "./crews/live.js";
import { watchtowerRoutes } from "./watchtower/index.js";
import { Recruiter } from "./recruiter/recruiter.js";
import { blueskyChannel, telegramChannel } from "./recruiter/adapters.js";
import { recruiterRoutes } from "./recruiter/routes.js";
import { chats } from "./community.js";
import { isAdmin as adminReq } from "./admin.js";
import { OwnerStats, liveOwnerStats, setOwnerStats } from "./owner-stats.js";
import { PublicWatch, buildcheckBadge, publicWatchFile } from "./crews/growth.js";
import { imdMarket } from "./imdmarket.js";
import { onCrewEvent } from "./crews/live.js";
import { payerClass } from "./proof.js";
import { telegram } from "./social.js";
import { KEEPER_LOW, KEEPER_RESERVE, burnStatus, keeperAccount, keeperBurnRate, keeperState } from "./keeper.js";
import { type CompanyClaim, rewardsOf } from "./rewards.js";
import { frogPng } from "./frogpng.js";
import { board as pinBoard, frogImage as pinFrogImage, inMatch as pinInMatch, soloFinish as pinSoloFinish, soloProgress as pinSoloProgress, soloStart as pinSoloStart, finish as pinFinish, get as pinGet, leave as pinLeave, listen as pinListen, progress as pinProgress, queue as pinQueue, stakes as pinStakes } from "./pinball.js";
import { claimsOf, epochs, markPosted } from "./frogpot.js";
import { config } from "./config.js";
import type { Engine } from "./engine.js";
import { handleMcp } from "./mcp.js";
import { clientIp, keyAllowed } from "./auth.js";
import { MAX_TICKS } from "./pinball/engine.js";
import { ANNOUNCED, checkSetup, isAdmin, pendingChanges, setupState } from "./admin.js";
import { writeSettings } from "./settings.js";
import { buybacks, checkLaunch, completeContracts, holderStatus, launchBody, launchState, patchLaunch, recordBuyback, recordLaunch, saveVerification, tokenOn, verification } from "./token.js";
import { verifyShift } from "./shift-verify.js";
import { DEV_WALLET, FIRST_BUYER } from "./shift-launch.js";
import { CATALOG, checkOrder, orders, recordOrder } from "./orders.js";
import { burnTotals, marketSnapshot, toCommunity } from "./community.js";
import { chessRoutes } from "./chess-routes.js";
import { chess } from "./chess.js";
import { gamesRoutes, live as gameLobby } from "./games-routes.js";
import { forgeRoutes } from "./forge-routes.js";
import { FORGE_LIVE } from "./forge-news.js";
import { watchRoutes } from "./watch-routes.js";
import { shipRoutes } from "./ship-routes.js";
import { arenaRoutes } from "./arena-routes.js";
import { leagueRoutes } from "./league-routes.js";
import { stationRoutes, withPageHead } from "./station-routes.js";
import { card, catalog, deliveryOf, detail, honestPitch, offerFor, productIdOf, search } from "./agentmarket.js";
import { spectateRoutes } from "./spectate.js";
import { PrizeError, livePrizes, prizesRoutes } from "./prizes.js";
import { poolRoutes } from "./pool-routes.js";
import { pokerRoutes } from "./poker-routes.js";
import { lockerRoutes } from "./locker-routes.js";
import { betsRoutes } from "./bets-routes.js";
import { prices } from "./prices.js";
import { checkOrder as checkSwarmOrder, orders as swarmOrders, placeOrder as placeSwarmOrder } from "./swarm.js";
import { frogStats, frogsOn, stakingBoard, stakingOf } from "./frogs.js";
import { impact } from "./impact.js";
import { flightFor } from "./flight.js";
import { b2bBooks, deskLine, isB2b, marketTotals } from "./b2b.js";
import { connectRoutes, ownerConnectRoutes } from "./connect-routes.js";
import { CHANNELS } from "@nightshift/core";
import { walletConfig } from "./wallet-config.js";
import { swapRoutes } from "./swap.js";
import { launchpadRoutes } from "./launchpad.js";
import { omniRoutes } from "./omni.js";
import { usdc } from "@nightshift/core";
import { erc20Abi, getAddress, parseAbi } from "viem";
import { liveServices, serviceRoutes, useServices } from "./services/routes.js";
import { sniperRoutes } from "./sniper-routes.js";
import { mindRoutes } from "./mind-routes.js";
import { HOUSE_ID, liveHouseServices } from "./services/house.js";
import { catalogItems } from "./services/catalog.js";

/** Open live-event streams, per IP and in all. */
const streams = new Map<string, number>();
let streamsTotal = 0;

/** Open solo pinball runs by IP: fresh wallets do not let one IP hold many seeds. As long as pinball.ts keeps a run open. */
const soloByIp = new Map<string, { id: string; until: number }>();
const SOLO_RUN_MS = (MAX_TICKS / 240) * 1000 + 15_000;
const releaseSolo = (req: IncomingMessage, id: string) => { const ip = clientIp(req); if (soloByIp.get(ip)?.id === id) soloByIp.delete(ip); };

/** A small fixed-window limiter per IP and route; expired windows are swept. */
const hits = new Map<string, { n: number; reset: number }>();
setInterval(() => { const now = Date.now(); for (const [k, h] of hits) if (h.reset < now) hits.delete(k); for (const [k, r] of soloByIp) if (r.until < now) soloByIp.delete(k); }, 60_000).unref();
function limited(req: IncomingMessage, key: string, max: number, windowMs: number): boolean {
  const ip = clientIp(req);
  const k = `${key}:${ip}`;
  const now = Date.now();
  const h = hits.get(k);
  if (!h || h.reset < now) { hits.set(k, { n: 1, reset: now + windowMs }); return false; }
  h.n += 1;
  return h.n > max;
}

const json = (res: ServerResponse, status: number, body: unknown, headers: Record<string, string> = {}) => {
  res.writeHead(status, { "Content-Type": "application/json", ...headers });
  res.end(JSON.stringify(body, (_k, v) => (typeof v === "bigint" ? v.toString() : v)));
};

async function body(req: IncomingMessage, max = 64_000): Promise<Record<string, unknown>> {
  let raw = "";
  for await (const chunk of req) {
    raw += chunk;
    if (raw.length > max) throw new Error("body too large");
  }
  return raw ? JSON.parse(raw) : {};
}

/** The owner view: everything, including tasks, journal, ledger and wallet. */
async function full(engine: Engine, c: Company) {
  const imd = await engine.ledger.balance(`co:${c.id}:imd`, "IMD");
  const held = await engine.ledger.balance(`co:${c.id}:usdc`, "USDC");
  const b = await b2bBooks(engine.ledger, c.id);
  // revenue from people and outside agents; B2B shown apart
  const rev = held - b.soldUsdc + b.boughtUsdc + (c.aiSpentUsdc ?? 0n);
  let spent = 0n;
  for (const t of c.tasks) spent += t.costImd;
  const stats = engine.stats(c);
  const m = engine.store.metricsOf(c.id);
  return {
    ...c,
    chat: undefined,
    tasks: c.tasks.slice(-60),
    journal: c.journal.slice(-150),
    stats,
    pnl: {
      revenueUsd: fromUsdc(rev),
      spentImd: fromImd(spent),
      spentUsd: fromImd(spent) * config.imdUsd,
      profitUsd: fromUsdc(held) - fromImd(spent) * config.imdUsd,
      imdBalance: fromImd(imd),
      b2bSoldUsd: fromUsdc(b.soldUsdc),
      b2bBoughtUsd: fromUsdc(b.boughtUsdc),
      // what the company paid for its CEO's strong model, from its own USDC
      aiUsd: fromUsdc(c.aiSpentUsdc ?? 0n),
    },
    recentSales: m.sales.slice(-20).reverse(),
    holder: tokenOn() ? { symbol: config.token.symbol, ...(await holderStatus(c.owner)), min: config.token.holderMin } : null,
    platformFeeBps: config.platformTreasury ? config.platformFeeBps : 0,
    series: series(m.visits, m.sales.map((s) => ({ at: s.at, usd: Number(s.usdc) / 1e6 }))),
  };
}

/** The owner desk: every company the caller runs, with what needs them, plus the ones they deleted. */
async function desk(engine: Engine, owner: string | null) {
  // without sign-in (a local or demo engine) every unowned company is the caller's to run
  const mineOf = (c: Company) => (owner !== null && c.owner === owner) || (!config.requireAuth && c.owner === null);
  const list = [...engine.store.companies.values()].filter(mineOf).sort((a, b) => b.createdAt - a.createdAt);
  const companies = await Promise.all(list.map(async (c) => {
    let spent = 0n;
    for (const t of c.tasks) spent += t.costImd;
    const held = await engine.ledger.balance(`co:${c.id}:usdc`, "USDC");
    const b = await b2bBooks(engine.ledger, c.id);
    // sales to people and outside agents; what it sold to and bought from other companies is shown apart
    const revenueUsd = fromUsdc(held - b.soldUsdc + b.boughtUsdc + (c.aiSpentUsdc ?? 0n));
    const spentUsd = fromImd(spent) * config.imdUsd;
    const soldUsd = fromUsdc(b.soldUsdc), boughtUsd = fromUsdc(b.boughtUsdc);
    const working = c.tasks.find((t) => ["checking", "ordering", "building"].includes(t.status));
    const last = c.tasks.at(-1);
    const resting = c.restUntil && c.restUntil > Date.now() ? [...c.journal].reverse().find((j) => j.text.startsWith("Saver:") || j.text.startsWith("Skipped ")) : undefined;
    return {
      id: c.id, slug: c.slug, name: c.name, idea: c.idea, mission: c.mission, audience: c.audience, direction: c.direction ?? "",
      status: c.status, cycle: c.cycle, createdAt: c.createdAt, nextShiftAt: c.nextShiftAt, wallet: c.wallet, sim: Boolean(c.sim),
      rest: c.restUntil && c.restUntil > Date.now() ? { until: c.restUntil, why: c.restReason || resting?.text.startsWith("Saver:") ? "saver" as const : "budget" as const, reason: c.restReason ?? null } : null,
      policy: c.policy, site: c.site?.url ?? null, alerts: Boolean(c.notify?.telegram),
      products: c.products.map((x) => ({ id: x.id, name: x.name, pitch: x.pitch, kind: x.kind, status: x.status, priceUsd: fromUsdc(x.priceUsdc), priceByOwner: Boolean(x.priceByOwner), sales: x.sales, revenueUsd: fromUsdc(x.revenueUsdc), b2bSales: x.b2bSales ?? 0, packaged: engine.files.has(c, x), ...studioView(c, x) })),
      pnl: { revenueUsd, spentUsd, profitUsd: revenueUsd + soldUsd - spentUsd - boughtUsd },
      b2b: {
        bought: { count: b.bought, usd: boughtUsd, items: (c.b2b?.bought ?? []).slice(-6).reverse().map(deskLine) },
        sold: { count: b.sold, usd: soldUsd, items: (c.b2b?.sold ?? []).slice(-6).reverse().map(deskLine) },
        usdcUsd: fromUsdc(held > 0n ? held : 0n),
      },
      stats: engine.stats(c),
      working: working ? { id: working.id, title: working.title, status: working.status, activity: working.activity } : null,
      waiting: c.tasks.filter((t) => t.status === "awaiting_approval").map((t) => {
        const pick = t.market?.pick;
        return { id: t.id, cycle: t.cycle, title: t.title, why: t.why, costUsd: pick ? fromUsdc(pick.priceUsdc) : fromImd(t.costImd) * config.imdUsd, ...(pick ? { market: { product: pick.name, company: pick.company, swarmUsd: t.market!.swarmUsd } } : {}) };
      }),
      last: last ? { id: last.id, cycle: last.cycle, title: last.title, status: last.status, at: last.updatedAt } : null,
      connections: engine.connect.desk(c),
      // Gumroad sales are the owner's on Gumroad, in USD: shown apart, never in the USDC revenue above
      gumroad: { sales: c.products.reduce((a, x) => a + (x.gumroad?.sales ?? 0), 0), usd: c.products.reduce((a, x) => a + (x.gumroad?.revenueCents ?? 0), 0) / 100 },
    };
  }));
  const archived = [...engine.store.archived.values()].filter(mineOf).sort((a, b) => b.archivedAt - a.archivedAt)
    .map((c) => ({ id: c.id, slug: c.slug, name: c.name, mission: c.mission, archivedAt: c.archivedAt, products: c.products.length, sales: c.products.reduce((a, x) => a + x.sales, 0) }));
  return { mode: config.mode, requireAuth: config.requireAuth, signedIn: owner !== null, imdUsd: config.imdUsd, bot: Boolean(config.telegramToken), companies, archived };
}

/** The books as CSV: every ledger line that touched the company's accounts, oldest first. */
async function books(engine: Engine, c: Company): Promise<string> {
  const mine = `co:${c.id}:`;
  const rows = [["date", "kind", "memo", "account", "asset", "amount", "chain_tx"]];
  const all = await engine.ledger.store.list(mine);
  for (const x of all) for (const y of x.postings) {
    if (!y.account.startsWith(mine)) continue;
    const dec = y.asset === "IMD" ? 18 : 6;
    const neg = y.amount < 0n;
    const abs = neg ? -y.amount : y.amount;
    const whole = abs / 10n ** BigInt(dec);
    const frac = (abs % 10n ** BigInt(dec)).toString().padStart(dec, "0").replace(/0+$/, "");
    const kind = isB2b(x) ? `${x.kind.replace("b2b", y.amount < 0n ? "b2b_purchase" : "b2b_sale")}` : x.kind;
    rows.push([new Date(x.at).toISOString(), kind, x.memo ?? "", y.account.slice(mine.length), y.asset, `${neg ? "-" : ""}${whole}${frac ? `.${frac}` : ""}`, String((x.ref as { chainTx?: string } | undefined)?.chainTx ?? "")]);
  }
  // quoted, and never read as a formula by a spreadsheet
  const cell = (v: string) => `"${(/^[=+\-@\t\r]/.test(v) && !/^-?\d/.test(v) ? `'${v}` : v).replace(/"/g, '""')}"`;
  return rows.map((r) => r.map(cell).join(",")).join("\r\n") + "\r\n";
}

/** A studio product's facts and the addresses of its listing images. */
const studioView = (c: Company, p: Product) => p.studio ? { format: p.format, studio: { pages: p.studio.pages, links: p.studio.links, files: p.studio.files.filter((f) => f.endsWith(".pdf")), mb: Math.round(p.studio.bytes / 1e5) / 10, year: p.studio.year, images: p.studio.images.map((n) => `${config.publicUrl}/api/studio/${c.slug}/${p.id}/${n}.png`) } } : {};

/** The public view: what a visitor or investor may see. No wallet keys, no drafts. */
function publicView(engine: Engine, c: Company) {
  const m = engine.store.metricsOf(c.id);
  let spent = 0n;
  for (const t of c.tasks) spent += t.costImd;
  const revenue = c.products.reduce((a, p) => a + fromUsdc(p.revenueUsdc), 0);
  const bought = c.b2b?.bought ?? [];
  return {
    slug: c.slug, name: c.name, mission: c.mission, audience: c.audience, createdAt: c.createdAt, wallet: c.wallet, status: c.status, cycle: c.cycle,
    site: c.site?.url ?? null,
    products: c.products.filter((p) => p.status === "live").map((p) => ({ id: p.id, name: p.name, kind: p.kind, pitch: honestPitch(p), delivery: deliveryOf(p.kind), priceUsd: fromUsdc(p.priceUsdc), sales: p.sales, b2bSales: p.b2bSales ?? 0, buyUrl: `${config.publicUrl}/buy/${c.slug}/${p.id}`, ...studioView(c, p) })),
    // sales to people and outside agents; sales to and purchases from other NIGHTSHIFT companies apart
    pnl: { revenueUsd: revenue, spentUsd: fromImd(spent) * config.imdUsd, sales: m.sales.length },
    b2b: {
      sales: c.products.reduce((a, p) => a + (p.b2bSales ?? 0), 0),
      revenueUsd: c.products.reduce((a, p) => a + fromUsdc(p.b2bRevenueUsdc ?? 0n), 0),
      bought: bought.length,
      spentUsd: bought.reduce((a, l) => a + fromUsdc(l.usdc), 0),
    },
    shifts: c.tasks.slice(-12).reverse().map((t) => ({ id: t.id, cycle: t.cycle, kind: t.kind, title: t.title, status: t.status, costUsd: fromImd(t.costImd) * config.imdUsd + fromUsdc(t.costUsdc ?? 0n), ...(t.market?.paid ? { market: true } : {}) })),
    mode: config.mode,
    /** The accounts the owner chose to show: where else to find the company. */
    channels: engine.connect.publicChannels(c),
  };
}

let swarmCache: { at: number; agents: number | null; working: number | null } = { at: 0, agents: null, working: null };
async function landing(engine: Engine) {
  if (Date.now() - swarmCache.at > 30_000) {
    const h = await engine.reads.health().catch(() => null);
    swarmCache = { at: Date.now(), agents: h?.connectedDaemons ?? null, working: h?.workingNow ?? null };
  }
  // Live: demo companies retired from simulation are not shown; their revenue was never real.
  const companies = [...engine.store.companies.values()].filter((c) => (config.mode !== "live" || !c.sim) && !c.house);
  const live = companies.flatMap((c) => c.products.filter((p) => p.status === "live").map((p) => ({ c, p })));
  const since = Date.now() - 24 * 3600_000;
  const featured = [...companies].sort((a, b) => b.products.reduce((x, p) => x + Number(p.revenueUsdc), 0) - a.products.reduce((x, p) => x + Number(p.revenueUsdc), 0))[0];
  const fm = featured ? engine.store.metricsOf(featured.id) : null;
  const kinds = config.requireAuth ? new Set(["result"]) : new Set(["result", "sale", "decision"]);
  const activity = companies
    .flatMap((c) => c.journal.filter((j) => kinds.has(j.kind)).map((j) => ({ at: j.at, kind: j.kind, company: c.name, slug: c.slug, text: j.text.replace(/^\[sim\] /, "") })))
    .sort((a, b) => b.at - a.at)
    .slice(0, 12);
  return {
    mode: config.mode,
    swarm: { agentsOnline: swarmCache.agents, workingNow: swarmCache.working, source: "api.imd.fun/health" },
    companies: companies.length,
    productsLive: live.length,
    featured: featured ? {
      name: featured.name, slug: featured.slug, mission: featured.mission, status: featured.status, shift: featured.cycle,
      product: featured.products.find((p) => p.status === "live")?.name ?? null,
      revenue24hUsd: (fm?.sales ?? []).filter((s) => s.at >= since).reduce((a, s) => a + Number(s.usdc) / 1e6, 0),
      customers: featured.products.reduce((a, p) => a + p.sales, 0),
      working: featured.tasks.some((t) => ["checking", "ordering", "building"].includes(t.status)),
    } : null,
    activity,
  };
}

function series(visits: number[], sales: { at: number; usd: number }[]) {
  const now = Date.now();
  const bucket = config.mode === "sim" ? 60_000 : 3600_000;
  const n = 30;
  const out = Array.from({ length: n }, (_, i) => ({ t: now - (n - 1 - i) * bucket, visits: 0, revenue: 0 }));
  const idx = (at: number) => n - 1 - Math.floor((now - at) / bucket);
  for (const v of visits) { const i = idx(v); if (i >= 0 && i < n) out[i]!.visits += 1; }
  for (const s of sales) { const i = idx(s.at); if (i >= 0 && i < n) out[i]!.revenue += s.usd; }
  return { bucketMs: bucket, points: out };
}

/** On every response: no framing, no sniffing, no full URLs to other sites, HTTPS pinned. */
const BASE_HEADERS: Record<string, string> = {
  "X-Content-Type-Options": "nosniff",
  "X-Frame-Options": "DENY",
  "Referrer-Policy": "strict-origin-when-cross-origin",
  "Permissions-Policy": "camera=(), microphone=(), geolocation=(), payment=(), usb=()",
  "Cross-Origin-Opener-Policy": "same-origin-allow-popups",
  ...(config.publicUrl.startsWith("https://") ? { "Strict-Transport-Security": "max-age=31536000; includeSubDomains; preload" } : {}),
};
/**
 * The app's pages: our own scripts only, and only the hosts the browser really talks to (RPCs, Google
 * Fonts, and the wallet layer: Reown AppKit's relay, wallet list and Verify frame, Coinbase's SDK).
 * Caddy sets the same list in production (docs/wallet/RESEARCH.md).
 */
const CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
  "font-src 'self' data: https://fonts.gstatic.com https://fonts.reown.com",
  "img-src 'self' data: blob: https:",
  "media-src 'self' blob:",
  // the multichain swap (/swap) reads and sends through Robinhood Chain's and a Solana RPC; quotes go through our own /api/swap
  "connect-src 'self' https://ethereum-rpc.publicnode.com https://rpc.mevblocker.io https://eth.drpc.org https://mainnet.base.org https://sepolia.base.org https://rpc.mainnet.chain.robinhood.com https://solana-rpc.publicnode.com wss://relay.walletconnect.com wss://relay.walletconnect.org https://*.walletconnect.com https://*.walletconnect.org https://*.reown.com wss://*.reown.com https://api.web3modal.org https://api.web3modal.com https://rpc.wallet.coinbase.com https://www.walletlink.org wss://www.walletlink.org",
  "frame-src https://verify.walletconnect.com https://verify.walletconnect.org https://secure.walletconnect.com https://secure.walletconnect.org https://secure.reown.com",
  "worker-src 'self'", "manifest-src 'self'", "object-src 'none'", "base-uri 'self'", "form-action 'self'", "frame-ancestors 'none'",
].join("; ");
/**
 * /tg, where the old Telegram Mini App was: the same policy, but Telegram Web may frame it
 * (web.telegram.org, and the older webk/webz hosts). The page only says the Game Room moved to the
 * website and app, or sends a visitor outside Telegram to /games.
 */
export const TG_FRAME_ANCESTORS = "frame-ancestors https://web.telegram.org https://webk.telegram.org https://webz.telegram.org";
const TG_CSP = CSP.replace("frame-ancestors 'none'", TG_FRAME_ANCESTORS);
/** /tg and anything under it, but not files such as /tg/telegram-web-app.js. */
export const isTgPage = (path: string) => /^\/tg(\/[^.]*)?\/?$/.test(path);
/** Telegram's WebApp script (vendored: our CSP allows our own scripts only), first in the page's head: /tg reads Telegram.WebApp.initData to know it is inside Telegram. */
export const withTelegramScript = (html: string) => html.replace("<head>", '<head>\n    <script src="/tg/telegram-web-app.js"></script>');
/** Pages made from company or model text (sim sites): no script at all, whatever they contain. */
const SANDBOX_CSP = "sandbox allow-popups allow-popups-to-escape-sandbox; default-src 'none'; style-src 'unsafe-inline'; img-src https: data:; frame-ancestors 'none'";

/** Browsers send Origin on cross-site POSTs: one from another site never acts with the visitor's session cookie. */
function crossSite(req: IncomingMessage): boolean {
  const origin = req.headers.origin;
  if (!origin || !/(?:^|;\s*)ns_session=/.test(req.headers.cookie ?? "")) return false;
  try { return new URL(origin).host !== req.headers.host && new URL(origin).origin !== new URL(config.publicUrl).origin; } catch { return true; }
}

const MIME: Record<string, string> = { ".html": "text/html; charset=utf-8", ".js": "text/javascript", ".css": "text/css", ".svg": "image/svg+xml", ".png": "image/png", ".ico": "image/x-icon", ".json": "application/json", ".woff2": "font/woff2", ".webp": "image/webp", ".jpg": "image/jpeg", ".mp4": "video/mp4", ".webmanifest": "application/manifest+json", ".txt": "text/plain; charset=utf-8", ".glb": "model/gltf-binary", ".gltf": "model/gltf+json", ".bin": "application/octet-stream" };
/** The game's 3D models, gzipped once and kept: the proxy in front does not compress them, and they shrink by half. */
const gzipped = new Map<string, { at: number; buf: Buffer }>();

/** A file of the built app (dot folders like /.well-known included), else the app's page. HEAD gets the headers only. */
function serveStatic(res: ServerResponse, path: string, head = false, gzipOk = false): boolean {
  if (!existsSync(config.webDist)) return false;
  const safe = normalize(path).replace(/^([/\\])+/, "").replace(/\.\.[/\\]?/g, "");
  let f = resolve(config.webDist, safe);
  // never a file outside the built app, whatever the path says
  if (!f.startsWith(resolve(config.webDist) + sep) || !existsSync(f) || statSync(f).isDirectory()) f = join(config.webDist, "index.html");
  if (!existsSync(f)) return false;
  const type = MIME[extname(f)] ?? "application/octet-stream";
  // the app's page carries this route's title, description and a readable summary for crawlers
  const page = f.endsWith("index.html") && f.startsWith(resolve(config.webDist)), tg = page && isTgPage(path);
  const data = page ? Buffer.from(tg ? withTelegramScript(readFileSync(f, "utf8")) : withPageHead(readFileSync(f, "utf8"), path)) : readFileSync(f);
  if (gzipOk && /\.(glb|gltf|bin)$/.test(f)) {
    const at = statSync(f).mtimeMs; let z = gzipped.get(f);
    if (!z || z.at !== at) { z = { at, buf: gzipSync(data, { level: 6 }) }; gzipped.set(f, z); }
    res.writeHead(200, { "Content-Type": type, "Content-Encoding": "gzip", "Content-Length": z.buf.length, Vary: "Accept-Encoding", "Cache-Control": "public, max-age=3600" });
    res.end(head ? undefined : z.buf);
    return true;
  }
  // inside Telegram Web /tg is framed: no X-Frame-Options there, and its frame-ancestors name Telegram
  if (tg) res.removeHeader("X-Frame-Options");
  res.writeHead(200, { "Content-Type": type, "Content-Length": data.length, ...(type.startsWith("text/html") ? { "Content-Security-Policy": tg ? TG_CSP : CSP, "Cache-Control": "no-cache" } : {}) });
  res.end(head ? undefined : data);
  return true;
}

const SUPPLY = 1_000_000_000;
const DEAD = "0x000000000000000000000000000000000000dEaD";
let stakedCache: { at: number; staked: number } | null = null;
/** How much $SHIFT sits staked in ShiftRewards, read on chain at most every 10 seconds. */
async function stakedNow(): Promise<number | null> {
  if (!stakedCache || Date.now() - stakedCache.at > 10_000) {
    const r = launchState()?.contracts?.rewards as `0x${string}` | undefined;
    const total = r ? await eth.readContract({ address: r, abi: [{ type: "function", name: "totalSupply", stateMutability: "view", inputs: [], outputs: [{ type: "uint256" }] }], functionName: "totalSupply" }).catch(() => null) : null;
    if (total !== null) stakedCache = { at: Date.now(), staked: Number(total / 10n ** 18n) };
  }
  return stakedCache?.staked ?? null;
}
let overviewCache: { at: number; v: unknown } | null = null;
let proofCache: { at: number; v: unknown } | null = null;

let recruiter: Recruiter | null = null;
/**
 * The recruiter, built once with the channels this server has credentials for (none means drafts only).
 * It starts paused the first time: the owner runs a dry run from the dashboard, then unpauses it.
 */
function liveRecruiter(engine: Engine): Recruiter {
  if (recruiter) return recruiter;
  const community = chats()[0];
  return (recruiter = new Recruiter({
    file: join(config.dataDir, "recruiter.json"),
    channels: {
      ...(config.telegramToken && community ? { telegram: telegramChannel(config.telegramToken, community) } : {}),
      ...(config.blueskyHandle && config.blueskyAppPassword ? { bluesky: blueskyChannel(config.blueskyHandle, config.blueskyAppPassword) } : {}),
    },
    notifyOwner: (text) => engine.alert(text, `recruiter-${Date.now()}`),
    highlights: () => crewHighlights(),
    attribution: (refs) => { const t = liveUsage(config.dataDir).tagCounts(); return Object.fromEntries(refs.map((r) => [r, { visits: t[r] ?? 0 }])); },
    settings: { paused: true, postsPerPlatformPerDay: 1 },
  }));
}
/** Everything the token page shows, in one read: market, supply, burns, frogs. */
async function tokenOverview(): Promise<unknown> {
  if (overviewCache && Date.now() - overviewCache.at < 60_000) return overviewCache.v;
  const token = config.token.address as `0x${string}` | "";
  const [m, staked, dead, frogs, burn] = await Promise.all([
    marketSnapshot().catch(() => null),
    stakedNow(),
    token ? eth.readContract({ address: token, abi: erc20Abi, functionName: "balanceOf", args: [DEAD] }).then((v) => Number(v / 10n ** 18n)).catch(() => null) : Promise.resolve(null),
    frogStats().catch(() => null),
    burnStatus(launchState()?.contracts?.splitter).catch(() => null),
  ]);
  const burnedShift = dead ?? 0;
  const v = {
    symbol: config.token.symbol, address: token || null, supply: SUPPLY,
    market: m ? { priceUsd: m.priceUsd, mcap: m.mcap, liquidity: m.liquidity, chart: m.chart } : null,
    staked, stakedPct: staked === null ? null : (staked / SUPPLY) * 100,
    burnedShift, burnedImd: burnTotals().imd,
    circulating: SUPPLY - burnedShift - (staked ?? 0),
    frogs: frogs ? { minted: Number(frogs.minted), max: 500 } : null,
    // the next IMD burn: the splitter's ETH reserve against what the keeper waits for at today's gas price
    burnReserveEth: burn?.reserve != null ? Number(burn.reserve) / 1e18 : null,
    burnAtEth: burn ? Number(burn.at) / 1e18 : null,
    lastBurn: burn?.last ? { at: burn.last.at, tx: burn.last.tx, imd: burn.last.imd != null ? Number(burn.last.imd) : null } : null,
  };
  overviewCache = { at: Date.now(), v };
  return v;
}

/** Every product on sale whose file is packaged, with its text for previews. */
function liveProducts(engine: Engine) {
  return [...engine.store.companies.values()].flatMap((c) => c.products.filter((x) => x.status === "live" && engine.files.has(c, x)).map((x) => ({ c, p: x, text: engine.files.read(c, x) })));
}

export function serve(engine: Engine) {
  // the house services (Token Verdict, Hook Inspector, IMD Data Feed), sold by the NIGHTSHIFT Services house company
  useServices(() => liveHouseServices(engine));
  // built now, not on the first request: Watchtower's watches and the recruiter keep their schedules after a restart
  liveServices();
  setInterval(() => void liveWatchtower()?.tick().catch((e) => console.error("watchtower", (e as Error).message)), 60_000).unref();
  setInterval(() => void liveRecruiter(engine).tick().catch((e) => console.error("recruiter", (e as Error).message)), 60_000).unref();
  // the owner's private stats: a report at 09:00 and 21:00 Bucharest, /stats, and pings as things happen
  const stats = new OwnerStats({
    file: join(config.dataDir, "owner-stats.json"),
    sources: {
      usage: liveUsage(config.dataDir), live: liveStats,
      jobs: (since) => crewLedger().list({ since, limit: 5000 }).map((j) => ({ crew: j.crew, status: j.status, free: j.free, kind: j.kind, paid: j.payment ? { usd: j.payment.usd, class: j.payment.class } : null })),
      operators: () => crewOperators().all(),
      sales: (since) => {
        const all = [...engine.store.companies.values()];
        return all.flatMap((c) => engine.store.metricsOf(c.id).sales.filter((x) => x.at >= since && payerClass(x.payer, c, all, x.sim) === "customer")
          .map((x) => ({ usd: Number(BigInt(x.usdc)) / 1e6, what: c.products.find((p) => p.id === x.productId)?.name ?? c.name, wallet: `${x.payer.slice(0, 6)}…${x.payer.slice(-4)}` })));
      },
      recruiter: () => {
        const d = liveRecruiter(engine).dashboard() as unknown as { state: string; prospects: unknown[]; queue: { status: string }[]; sent: { sent?: { utc?: string } | null }[] };
        const today = new Date().toISOString().slice(0, 10);
        return { state: d.state, prospects: d.prospects.length, waiting: d.queue.filter((q) => q.status === "awaiting_approval").length, sentToday: d.sent.filter((x) => x.sent?.utc?.startsWith(today)).length };
      },
    },
    // the owner's own chat with the bot; the alert chat only if no private chat took it
    send: async (text) => {
      const dms = config.telegramToken ? await Promise.all(config.telegramAdmins.filter((x) => Number(x) > 0).map((id) => telegram(config.telegramToken, id, text).catch(() => false))) : [];
      return dms.some(Boolean) || engine.alert(text.replace(/<[^>]+>/g, ""), `owner-stats-${Date.now()}`);
    },
  });
  setOwnerStats(stats);
  // Watchtower on the IMD market's tokens, in public: real high-severity changes, posted with evidence (3 a day at most)
  const pub = new PublicWatch({
    file: publicWatchFile(),
    tokens: async () => ((await imdMarket())?.tokens ?? []).filter((t) => /^0x[0-9a-fA-F]{40}$/.test(t.address)).map((t) => ({ address: t.address, symbol: t.symbol, launch: t.launch })),
    post: (text, buttons) => toCommunity(text, buttons, "alert"),
  });
  setInterval(() => void pub.tick().catch((e) => console.error("public watch", (e as Error).message)), 10 * 60_000).unref();
  onCrewEvent((e) => stats.onCrewEvent(e));
  setInterval(() => void stats.tick().catch((e) => console.error("owner stats", (e as Error).message)), 60_000).unref();
  const server = createServer(async (req, res) => {
    const url = new URL(req.url ?? "/", config.publicUrl);
    const p = url.pathname;
    const seg = p.split("/").filter(Boolean);
    if (!p.startsWith("/api/admin") && !p.startsWith("/assets/") && !/\.(js|css|png|jpg|webp|svg|mp4|ico|woff2?)$/.test(p)) sawVisitor(clientIp(req), req.headers["user-agent"]);
    for (const [k, v] of Object.entries(BASE_HEADERS)) res.setHeader(k, v);
    if (req.method !== "GET" && req.method !== "HEAD" && crossSite(req)) return json(res, 403, { error: "cross-site request refused" });
    try {
      if (p === "/api/health") return json(res, 200, { ok: true, mode: config.mode, llm: Boolean(engine.llm), imdUsd: config.imdUsdPinned || Date.now() - config.imdUsdAt < 30 * 60_000 ? config.imdUsd : null, salesChainId: config.salesChainId, requireAuth: config.requireAuth, platformFeeBps: config.platformTreasury ? config.platformFeeBps : 0 });

      // ---- the operator's setup dashboard (/setup), behind the admin token
      if (p.startsWith("/api/admin/")) {
        if (limited(req, "admin", 60, 60_000)) return json(res, 429, { error: "slow down" });
        if (!isAdmin(req)) return json(res, 401, { error: "wrong admin token" });
        if (p === "/api/admin/setup" && req.method === "GET") return json(res, 200, await setupState(engine));
        // the weekly prizes: boards with wallets, held awards, and voiding an entry
        if (p === "/api/admin/prizes" && req.method === "GET") return json(res, 200, livePrizes().admin());
        if (p === "/api/admin/prizes/void" && req.method === "POST") {
          const b = await body(req);
          try { livePrizes().void(String(b.game ?? "") as never, String(b.wallet ?? ""), String(b.reason ?? "voided by the admin"), b.week === undefined ? undefined : Number(b.week)); return json(res, 200, livePrizes().admin()); }
          catch (e) { return json(res, e instanceof PrizeError ? e.status : 400, { error: (e as Error).message }); }
        }
        if (p === "/api/admin/setup" && req.method === "POST") {
          const patch = await body(req);
          const err = checkSetup(patch);
          if (err) return json(res, 400, { error: err });
          // Settings that move money or trust are announced, so a leaked admin token cannot act quietly:
          // before they are saved, to the alert chat that runs now (a new chat only applies after a restart).
          const touched = ANNOUNCED.filter((k) => k in patch);
          if (touched.length) await engine.alert(`⚠️ /setup changed: ${touched.join(", ")}. If this was not you, rotate the admin token now.`, `setup-${Date.now()}`);
          writeSettings(patch);
          return json(res, 200, await setupState(engine));
        }
        if (p === "/api/admin/buyback" && req.method === "POST") {
          const b = await body(req);
          const tx = String(b.tx ?? "");
          if (!/^0x[0-9a-fA-F]{64}$/.test(tx)) return json(res, 400, { error: "tx must be a transaction hash" });
          recordBuyback({ at: Date.now(), tx, usd: Number(b.usd) || 0, amount: Number(b.amount) || 0, note: b.note ? String(b.note).slice(0, 200) : undefined });
          return json(res, 200, { ok: true, buybacks: buybacks() });
        }
        if (p === "/api/admin/companies/purge-sim" && req.method === "POST") {
          // The demo companies from before going live: gone for good, with their numbers. Real companies are never touched.
          if (config.mode !== "live") return json(res, 400, { error: "Only in live mode." });
          const gone = [...engine.store.companies.values()].filter((c) => c.sim).map((c) => ({ id: c.id, name: c.name }));
          for (const g of gone) { engine.store.companies.delete(g.id); engine.store.metrics.delete(g.id); }
          engine.store.markDirty(); await engine.store.flush();
          return json(res, 200, { removed: gone, left: engine.store.companies.size });
        }
        if (p === "/api/admin/fairplay" && req.method === "GET") return json(res, 200, { flags: chess.flags() });
        if (p === "/api/admin/swarm" && req.method === "GET") return json(res, 200, { orders: await swarmOrders() });
        if (p === "/api/admin/swarm/check" && req.method === "POST") { const b = await body(req); try { return json(res, 200, await checkSwarmOrder(String(b.key ?? ""))); } catch (e) { return json(res, 400, { error: (e as Error).message }); } }
        // the Forge goes live once the dev wallet connected IMD's art and identity layer to it (setRenderer, once)
        if (p === "/api/admin/forge/open" && req.method === "POST") {
          const F = FORGE_LIVE.forge as `0x${string}`, abi = parseAbi(["function renderer() view returns (address)", "function skin() view returns (address)"]);
          const [r, s] = await Promise.all([eth.readContract({ address: F, abi, functionName: "renderer" }), eth.readContract({ address: F, abi, functionName: "skin" })]);
          if (r.toLowerCase() !== FORGE_LIVE.renderer || s.toLowerCase() !== FORGE_LIVE.skin) return json(res, 409, { error: /^0x0{40}$/.test(r) ? "The forge has no art yet: send setRenderer from the dev wallet first." : `The forge points at another renderer (${r}). Not switching it on.` });
          const first = config.forge.address.toLowerCase() !== F;
          writeSettings({ FORGE_ADDRESS: F });
          config.forge.address = F;
          if (first) void toCommunity(["🔥🐸 <b>THE FORGE IS OPEN</b>", "", "NIGHT FROGS can evolve now. Burn 10 NIGHT FROGS + 2 $IMD (half of it burned) and forge 1 <b>Night Watcher</b>, Gen 2, fully onchain.", "", "I Shift Lead 10x · II Foreman 15x · III Supervisor 20x · IV Chief 30x · V Night Boss 40x (only 4) · and The Captain, a 1 of 1.", "", "You see your exact Night Watcher before you sign. Only 50 will ever exist. Every one is a seat in the Night Watch and opens the private Watch Room."].join("\n"), [[{ text: "🔥 Open the Forge", url: `${config.publicUrl}/forge` }]], "frog");
          return json(res, 200, { ok: true, on: true, address: F });
        }
        if (p === "/api/admin/swarm/placed" && req.method === "POST") {
          const b = await body(req);
          // a payment hash, or the job of an order paid on explorer.imd.fun (its link or id), checked at IMD
          const raw = String(b.tx ?? "").trim(), job = raw.match(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i)?.[0]?.toLowerCase();
          const tx = job ?? raw;
          if (!job && !/^0x[0-9a-fA-F]{64}$/.test(tx)) return json(res, 400, { error: "Paste a payment transaction hash or an IMD job link." });
          if (job && !(await fetch(`https://api.imd.fun/jobs/${job}`, { signal: AbortSignal.timeout(10_000) }).then((r) => r.ok).catch(() => false))) return json(res, 400, { error: "IMD does not know this job." });
          try { placeSwarmOrder(String(b.key ?? ""), tx); return json(res, 200, { orders: await swarmOrders() }); } catch (e) { return json(res, 400, { error: (e as Error).message }); }
        }
        if (p === "/api/admin/token/check" && req.method === "POST") {
          // The launch is fixed (shift-launch.ts): nothing to type, only IMD's free check.
          return json(res, 200, { body: launchBody(), check: await checkLaunch(), dev: DEV_WALLET, firstBuyer: FIRST_BUYER });
        }
        if (p === "/api/admin/token/verify" && req.method === "POST") {
          const l = (await completeContracts()) ?? launchState();
          if (!l?.contracts) return json(res, 400, { error: "Nothing deployed yet." });
          if (l.contracts.hook && !l.pool) { const pool = await findPool(eth, l.contracts.token as `0x${string}`, l.contracts.hook as `0x${string}`).catch(() => null); if (pool) patchLaunch({ pool }); }
          const checks = await verifyShift(l.contracts);
          saveVerification(checks);
          if (!l.open) await engine.relaunchCard(l, checks);
          return json(res, 200, { checks });
        }
        if (p === "/api/admin/token/launched" && req.method === "POST") {
          const b = await body(req);
          if (!/^0x[0-9a-fA-F]{64}$/.test(String(b.tx ?? ""))) return json(res, 400, { error: "tx must be a transaction hash" });
          recordLaunch(String(b.tx), String(b.symbol ?? "TOKEN"));
          void engine.alert(`🪙 ${String(b.symbol)} launch paid: https://etherscan.io/tx/${String(b.tx)}`, "launch-paid");
          return json(res, 200, { ok: true, launch: launchState() });
        }
        if (p === "/api/admin/pause-all" && req.method === "POST") {
          // Before going live: the simulated demo companies stop, so none tries a real order from an empty wallet.
          let n = 0;
          for (const c of engine.store.companies.values()) if (c.status === "active") { engine.setStatus(c, "paused"); n++; }
          return json(res, 200, { paused: n });
        }
        if (p === "/api/admin/test-alert" && req.method === "POST") {
          return json(res, 200, { ok: await engine.alert("Test alert from /setup. Alerts work.", `test-${Date.now()}`) });
        }
        if (p === "/api/admin/orders" && req.method === "GET") {
          return json(res, 200, { catalog: CATALOG.map(({ body: _b, ...c }) => c), orders: orders() });
        }
        if (p === "/api/admin/orders/check" && req.method === "POST") {
          const want = String((await body(req)).id ?? "");
          const c = CATALOG.find((x) => x.id === want);
          if (!c) return json(res, 404, { error: "unknown order" });
          return json(res, 200, { body: c.body, actionId: c.actionId, check: await checkOrder(c) });
        }
        if (p === "/api/admin/orders/paid" && req.method === "POST") {
          const b = await body(req);
          const c = CATALOG.find((x) => x.id === String(b.id ?? ""));
          if (!c || !/^0x[0-9a-fA-F]{64}$/.test(String(b.tx ?? ""))) return json(res, 400, { error: "need a known order and a transaction hash" });
          const o = recordOrder(c, String(b.tx));
          void engine.alert(`🛠 ${c.title} ordered from IMD: https://etherscan.io/tx/${o.tx}`, `order-${o.tx}`);
          return json(res, 200, { ok: true, orders: orders() });
        }
        if (p === "/api/admin/live" && req.method === "GET") return json(res, 200, liveStats());
        if (p === "/api/admin/usage" && req.method === "GET") return json(res, 200, liveUsage(config.dataDir).report(Math.min(90, Math.max(1, Number(url.searchParams.get("days") ?? 30) || 30))));
        // the owner's private stats, sent now (also sent at 09:00 and 21:00 Bucharest, and on /stats)
        if (p === "/api/admin/stats" && req.method === "POST") return json(res, 200, { sent: (await liveOwnerStats()?.sendReport().catch(() => false)) ?? false });
        // the recruiter's owner dashboard: queue, prospects, sends, conversions, pause and stop
        if (p.startsWith("/api/admin/recruiter") && await recruiterRoutes(req, res, p, { json, body, isAdmin: adminReq, recruiter: liveRecruiter(engine) })) return;
        if (p === "/api/admin/keeper" && req.method === "GET") {
          const a = keeperAccount(engine.vault).address;
          const wei = await eth.getBalance({ address: a }).catch(() => null);
          const rate = wei === null ? { perDay: null, daysLeft: null } : keeperBurnRate(wei);
          return json(res, 200, { address: a, eth: (wei ?? 0n).toString(), last: engine.lastKeeper ?? keeperState().last ?? null, perDay: rate.perDay?.toString() ?? null, daysLeft: rate.daysLeft, low: KEEPER_LOW.toString(), reserve: KEEPER_RESERVE.toString() });
        }
        if (p === "/api/admin/keeper/run" && req.method === "POST") return json(res, 200, await engine.keeperRun({ burnDelayMs: 0 }));
        if (p === "/api/admin/frogpot" && req.method === "GET") return json(res, 200, { epochs: epochs() });
        if (p === "/api/admin/frogpot/build" && req.method === "POST") return json(res, 200, { epoch: await engine.frogEpoch() });
        if (p === "/api/admin/frogpot/posted" && req.method === "POST") {
          const b = await body(req);
          if (!/^0x[0-9a-fA-F]{64}$/.test(String(b.tx))) return json(res, 400, { error: "tx must be a transaction hash" });
          markPosted(Number(b.epoch), String(b.token), String(b.tx));
          return json(res, 200, { ok: true });
        }
        if (p === "/api/admin/test-all" && req.method === "POST") {
          return json(res, 200, { ok: true, result: await engine.testAll() });
        }
        if (p === "/api/admin/restart" && req.method === "POST") {
          if (process.env.NIGHTSHIFT_SUPERVISED !== "1") return json(res, 409, { error: "Not running under a supervisor; restart the process yourself to apply." });
          const applies = pendingChanges().filter((k) => ANNOUNCED.includes(k));
          await engine.alert(`⚠️ /setup restart${applies.length ? `, applying: ${applies.join(", ")}` : ""}. If this was not you, rotate the admin token now.`, `restart-${Date.now()}`);
          json(res, 200, { ok: true });
          setTimeout(() => { void engine.store.flush().catch(() => {}).finally(() => process.exit(0)); }, 400);
          return;
        }
        return json(res, 404, { error: "not found" });
      }

      // An API key reaches /mcp and a few reads only; everything that changes state needs the wallet's session.
      const caller = engine.auth.caller(req);
      const owner = caller && (caller.via === "session" || keyAllowed(req.method, p)) ? caller.addr : null;
      // Reads that reach the chain or IMD when their cache is cold: plenty for pages, not for a loop.
      if (["/api/staked", "/api/token/overview", "/api/token", "/api/frogs", "/api/frogs/claims", "/api/frogs/staking", "/api/impact", "/api/landing"].includes(p) && limited(req, "reads", 240, 60_000)) return json(res, 429, { error: "slow down" });

      if ((p === "/api/mind" || p.startsWith("/api/mind/")) && engine.mind && await mindRoutes(req, res, p, { json, body, limited, url, mind: engine.mind, weather: engine.weather, llm: engine.llm, model: config.chatModel })) return;
      if ((p === "/api/sniper" || p.startsWith("/api/sniper/") || p.startsWith("/api/push/")) && await sniperRoutes(req, res, p, { json, body, limited, owner: caller?.via === "session" ? caller.addr : null, sniper: engine.sniper, dex: engine.dex })) return;
      // ---- the landing page's live numbers: real where they can be, labelled where simulated
      if (await serviceRoutes(req, res, p, { url, base: config.publicUrl, ip: clientIp(req), limited })) return;
      if (p === "/api/landing") return json(res, 200, await landing(engine));
      if (p === "/api/impact") return json(res, 200, await impact(engine));
      if (p === "/api/frogs/staking") {
        const w = new URL(req.url ?? "/", config.publicUrl).searchParams.get("wallet") ?? "";
        return json(res, 200, { board: stakingBoard(20), me: /^0x[0-9a-fA-F]{40}$/.test(w) ? stakingOf(w) : null });
      }
      if (await spectateRoutes(req, res, p, { json, limited })) return;
      // the player's name, saved on the signed-in wallet and used in every game
      if (p === "/api/player" && req.method === "GET") return json(res, 200, { name: savedName(owner), signedIn: Boolean(owner) });
      if (p === "/api/player/name" && req.method === "POST") {
        if (!owner) return json(res, 401, { error: "Sign in to save your name on your wallet." });
        if (limited(req, `player-name:${owner}`, 10, 3600_000)) return json(res, 429, { error: "Ten name changes an hour at most." });
        try { return json(res, 200, { name: saveName(owner, (await body(req)).name) }); } catch (e) { return json(res, e instanceof NameError ? 400 : 500, { error: (e as Error).message }); }
      }
      if (p.startsWith("/api/chess/") && await chessRoutes(req, res, p, { json, body, limited, owner, url })) return;
      if (p.startsWith("/api/pool/") && await poolRoutes(req, res, p, { json, body, limited, owner, url })) return;
      if (p.startsWith("/api/poker/") && await pokerRoutes(req, res, p, { json, body, limited, owner, url })) return;
      if (p.startsWith("/api/locker/") && await lockerRoutes(req, res, p, { json, body, limited, owner, url })) return;
      if (p.startsWith("/api/bets/") && await betsRoutes(req, res, p, { json, body, limited, owner, url, vault: engine.vault })) return;
      if (prizesRoutes(req, res, p, { json, limited, owner, url })) return;
      // the multichain swap: NIGHTSHIFT's fee for the signed-in wallet, LI.FI and Relay routes, transfer status
      if (p.startsWith("/api/swap/") && await swapRoutes(req, res, p, { json, body, limited, owner, url })) return;
      if (p.startsWith("/api/launchpad/") && await launchpadRoutes(req, res, p, { json, body, limited, url })) return;
      if (p.startsWith("/api/omni/") && await omniRoutes(req, res, p, { json, limited, url })) return;
      if (p.startsWith("/api/forge") && await forgeRoutes(req, res, p, { json, limited, url, owner })) return;
      if (p.startsWith("/api/ship") && await shipRoutes(req, res, p, { json, limited, url, companies: () => [...engine.store.companies.values()] })) return;
      if (((p.startsWith("/api/watch") && !p.startsWith("/api/watchtower")) || p.startsWith("/nightwatch/")) && await watchRoutes(req, res, p, { json, body, limited, url })) return;
      if (p.startsWith("/api/games/") && await gamesRoutes(req, res, p, { json, body, limited, owner, url, vault: engine.vault })) return;
      if ((p.startsWith("/api/arena/") || p === "/arena/agents.md") && await arenaRoutes(req, res, p, { json, body, limited, owner, url, auth: engine.auth, vault: engine.vault })) return;
      if ((p.startsWith("/api/league") || p === "/league/agents.md") && await leagueRoutes(req, res, p, { json, body, limited, url, vault: engine.vault })) return;
      // ---- the Build & Check README badge: a live quick check, cached 6 hours
      if (p === "/api/crews/buildcheck/badge" && req.method === "GET") {
        if (limited(req, "badge", 120, 60_000)) return json(res, 429, { error: "slow down" });
        const b = await buildcheckBadge(url.searchParams.get("url") ?? "");
        res.writeHead(b.status, { "Content-Type": "image/svg+xml; charset=utf-8", "Cache-Control": "public, max-age=3600", "Content-Security-Policy": "default-src 'none'; style-src 'unsafe-inline'", "Access-Control-Allow-Origin": "*" });
        res.end(b.svg);
        return;
      }
      // ---- the crews: house crews and outside operators, their jobs, the season
      if ((p.startsWith("/api/crews") || p === "/api/season" || p.startsWith("/api/agents/operators")) && await crewRoutes(req, res, p, {
        json, body, limited, ip: clientIp(req), ledger: crewLedger(), operators: crewOperators(), profiles: crewProfiles, season: crewSeason, buildCheck,
        agentFromKey: async (h) => { const a = liveArena(() => gameLobby(engine.vault)).authenticate(String(h ?? "").replace(/^Bearer\s+/i, "").trim()); return a ? { id: a.id, owner: a.owner, name: a.name } : null; },
      })) return;
      // ---- Watchtower's free door: the sample, and the owner's watches
      if (p.startsWith("/api/watchtower/")) {
        const wt = liveWatchtower();
        if (!wt) return json(res, 503, { error: "Watchtower is starting." });
        if (await watchtowerRoutes(req, res, p, { json, body, limited, owner, ip: clientIp(req), wt })) return;
      }
      // ---- the proof page: what actually happened, from the books
      if (p === "/api/proof" && req.method === "GET") {
        if (limited(req, "proof", 60, 60_000)) return json(res, 429, { error: "slow down" });
        if (!proofCache || Date.now() - proofCache.at > 60_000) {
          const ops = crewOperators().all();
          proofCache = { at: Date.now(), v: proof({
            companies: [...engine.store.companies.values()], metrics: (id) => engine.store.metricsOf(id), ledger: await engine.ledger.store.list(),
            usage: liveUsage(config.dataDir).report(90), crews: crewProfiles().map((c) => ({ id: c.id, name: c.name, house: c.operator.kind === "house", metrics: c.metrics })),
            operators: { registered: ops.length, active: ops.filter((o) => o.status === "active").length },
            burns: burnTotals(), imdUsd: config.imdUsd || null, splitter: (launchState()?.contracts?.splitter as string | undefined) ?? null, houseId: HOUSE_ID,
          }) };
        }
        return json(res, 200, proofCache.v);
      }
      if (await stationRoutes(req, res, p, { json, body, limited, owner, vault: engine.vault, market: (q) => engine.market(q), live: () => liveProducts(engine), token: tokenOverview,
        mind: engine.mind ? { ask: (q) => engine.mind!.ask(q, engine.llm, config.chatModel), search: (q) => engine.mind!.search(q, 12) } : null })) return;
      // the owners' connected accounts: OAuth callbacks, Gumroad's sale pings, product covers
      if (p.startsWith("/api/connect/") && await connectRoutes(req, res, p, { json, body, limited, url, connect: engine.connect, owner, find: (x) => engine.get(x) })) return;
      if (p.startsWith("/api/pinball/")) {
        const parts = p.split("/").filter(Boolean); // api pinball …
        if (p === "/api/pinball/stakes") return json(res, 200, pinStakes());
        if (p === "/api/pinball/board") return json(res, 200, pinBoard());
        // a NIGHT FROG's onchain image, the only face from a wallet shown to a rival: never run as a page
        if (parts[2] === "frog" && parts[3] && req.method === "GET") {
          if (limited(req, "pinball-frog", 120, 60_000)) return json(res, 429, { error: "slow down" });
          // the same frog as a PNG, for Telegram photos and link previews
          // and small (…/7-128.png): the face NIGHT POKER's tables show, cheap to paint where the SVG's filters are not
          const pngMatch = /^(\d{1,5})(-128)?\.png$/.exec(parts[3]), pngId = pngMatch?.[1];
          if (pngId) {
            const png = await frogPng(Number(pngId), pngMatch?.[2] ? 128 : 800).catch(() => null);
            if (!png) return json(res, 404, { error: "no such frog" });
            res.writeHead(200, { "Content-Type": "image/png", "Content-Length": png.length, "Cache-Control": "public, max-age=86400", "X-Content-Type-Options": "nosniff" });
            res.end(png);
            return;
          }
          const svg = /^\d{1,5}$/.test(parts[3]) ? await pinFrogImage(Number(parts[3])) : null;
          if (!svg) return json(res, 404, { error: "no such frog" });
          res.writeHead(200, { "Content-Type": "image/svg+xml", "Cache-Control": "public, max-age=86400", "Content-Security-Policy": "default-src 'none'; style-src 'unsafe-inline'; img-src data:; sandbox", "X-Content-Type-Options": "nosniff" });
          res.end(svg);
          return;
        }
        if (p === "/api/pinball/solo" && req.method === "POST") {
          if (limited(req, "pinball-solo", 40, 600_000)) return json(res, 429, { error: "slow down" });
          const b = await body(req);
          // one open run per player, the signed-in wallet else the IP, and one per IP whatever the wallet
          const ip = clientIp(req), held = soloByIp.get(ip);
          if (held && held.until > Date.now()) return json(res, 409, { error: `Your last run is still open for ${Math.ceil((held.until - Date.now()) / 1000)} s: finish it, or play this one off the board.` });
          try {
            const run = pinSoloStart(String(b.name ?? ""), owner ?? `ip:${ip}`);
            soloByIp.set(ip, { id: run.id, until: run.startedAt + SOLO_RUN_MS });
            return json(res, 200, run);
          } catch (e) { return json(res, 409, { error: (e as Error).message }); }
        }
        if (parts[2] === "solo" && parts[3] && parts[4] === "progress" && req.method === "POST") {
          if (limited(req, "pinball-solo-progress", 600, 60_000)) return json(res, 429, { error: "slow down" });
          const b = await body(req, 16_000);
          // a refused input ends the run: the IP is free again
          try { return json(res, 200, { ok: true, ...pinSoloProgress(parts[3], b) }); } catch (e) { releaseSolo(req, parts[3]); return json(res, 400, { error: (e as Error).message }); }
        }
        if (parts[2] === "solo" && parts[3] && parts[4] === "finish" && req.method === "POST") {
          if (limited(req, "pinball-solo-finish", 40, 600_000)) return json(res, 429, { error: "slow down" });
          const b = await body(req, 400_000);
          try { return json(res, 200, pinSoloFinish(parts[3], b.inputs)); } catch (e) { return json(res, 400, { error: (e as Error).message }); } finally { releaseSolo(req, parts[3]); }
        }
        if (p === "/api/pinball/queue" && req.method === "POST") {
          if (limited(req, "pinball-queue", 20, 600_000)) return json(res, 429, { error: "slow down" });
          const b = await body(req);
          try { return json(res, 200, await pinQueue(String(b.name ?? ""), owner, String(b.currency ?? "FREE") as never, Number(b.stake ?? 0), typeof b.avatar === "string" ? b.avatar : null)); } catch (e) { const st = (e as { status?: unknown }).status; return json(res, typeof st === "number" ? st : 400, { error: (e as Error).message }); }
        }
        if (parts[2] === "match" && parts[3]) {
          const id = parts[3];
          if (parts[4] === "events") {
            const me = url.searchParams.get("player") ?? undefined;
            if (!pinGet(id, me) || (me && !pinInMatch(id, me))) return json(res, 404, { error: "no such match" });
            // match streams count against the same per-IP and total caps as the live events
            const ipKey = `pb:${clientIp(req)}`;
            if ((streams.get(ipKey) ?? 0) >= 4 || streamsTotal >= 2000) return json(res, 429, { error: "too many live connections" });
            streams.set(ipKey, (streams.get(ipKey) ?? 0) + 1); streamsTotal++;
            res.writeHead(200, { "Content-Type": "text/event-stream", "Cache-Control": "no-cache", Connection: "keep-alive" });
            // a reader that does not keep up is dropped, and frames wait for the socket to drain instead of piling up
            let blocked = false;
            const send = (v: unknown) => {
              if (res.writableLength > 256_000) { res.destroy(); return; }
              if (blocked) return;
              if (!res.write(`data: ${JSON.stringify(v)}\n\n`)) { blocked = true; res.once("drain", () => { blocked = false; const v = pinGet(id, me); if (v) send(v); }); }
            };
            const off = pinListen(id, me, send);
            const ping = setInterval(() => { if (!blocked) res.write(": ping\n\n"); }, 20_000);
            req.on("close", () => { off(); clearInterval(ping); const n = (streams.get(ipKey) ?? 1) - 1; if (n > 0) streams.set(ipKey, n); else streams.delete(ipKey); streamsTotal--; });
            return;
          }
          // the game streams its inputs four times a second: room for two games, not a flood
          if (parts[4] === "progress" && req.method === "POST") {
            if (limited(req, "pinball-progress", 600, 60_000)) return json(res, 429, { error: "slow down" });
            const b = await body(req, 16_000);
            try { return json(res, 200, { ok: true, ...pinProgress(id, String(b.player ?? ""), b) }); } catch (e) { return json(res, 400, { error: (e as Error).message }); }
          }
          if (parts[4] === "leave" && req.method === "POST") { if (limited(req, "pinball-leave", 30, 60_000)) return json(res, 429, { error: "slow down" }); const b = await body(req, 2_000); pinLeave(id, String(b.player ?? "")); return json(res, 200, { ok: true }); }
          if (parts[4] === "finish" && req.method === "POST") {
            if (limited(req, `pinball-finish:${id}`, 4, 60_000)) return json(res, 429, { error: "slow down" });
            const b = await body(req, 400_000);
            try { return json(res, 200, pinFinish(id, String(b.player ?? ""), b)); } catch (e) { return json(res, 400, { error: (e as Error).message }); }
          }
          const m = pinGet(id, url.searchParams.get("player") ?? undefined);
          return m ? json(res, 200, m) : json(res, 404, { error: "no such match" });
        }
        return json(res, 404, { error: "not found" });
      }
      if (p === "/api/wallet-config") return json(res, 200, walletConfig());
      if (p === "/api/staked") {
        const staked = await stakedNow();
        return json(res, 200, { staked, supply: SUPPLY, pct: staked === null ? null : (staked / SUPPLY) * 100 });
      }
      if (p === "/api/token/overview") return json(res, 200, await tokenOverview());
      if (p === "/api/prices") { const d = await prices(); return d ? json(res, 200, d) : json(res, 503, { error: "No price data right now." }); }
      // ---- what one wallet can claim now, across staking, NIGHT FROGS, staked games and (signed in as it) its companies
      if (seg[0] === "api" && seg[1] === "rewards" && req.method === "GET") {
        const w = seg[2] ?? "";
        if (seg.length !== 3 || !/^0x[0-9a-fA-F]{40}$/.test(w)) return json(res, 400, { error: "GET /api/rewards/<wallet address>" });
        if (limited(req, "rewards", 30, 60_000)) return json(res, 429, { error: "slow down" });
        const me = owner !== null && owner.toLowerCase() === w.toLowerCase();
        const companies = async (): Promise<CompanyClaim[] | null> => {
          if (!me) return null;
          const fee = config.platformTreasury ? config.platformFeeBps : 0;
          const mine = [...engine.store.companies.values()].filter((c) => c.owner === owner && !c.house && !(config.mode === "live" && c.sim));
          const rows = await Promise.all(mine.map(async (c) => ({ id: c.id, slug: c.slug, name: c.name, usd: fromUsdc(await engine.withdrawable(c)), feeBps: fee })));
          return rows.filter((r) => r.usd >= 0.01);
        };
        const r = await rewardsOf(w, { fresh: me && url.searchParams.get("fresh") === "1", games: () => gameLobby(engine.vault).escrow.challenges.values(), companies });
        return json(res, 200, r, { "Cache-Control": "private, max-age=30" });
      }
      if (p === "/api/frogs/claims") {
        const a = url.searchParams.get("address") ?? "";
        if (!/^0x[0-9a-fA-F]{40}$/.test(a)) return json(res, 400, { error: "address" });
        return json(res, 200, { claims: claimsOf(a), rewards: launchState()?.contracts?.rewards ?? null });
      }
      if (p === "/api/frogs") {
        const order = orders().find((o) => o.id === "night-frogs");
        return json(res, 200, {
          on: frogsOn(), address: config.nft.address || null, stats: await frogStats(), extraSlots: config.nft.extraSlots, vrfSub: config.nft.vrfSub || null,
          order: order ? { stage: order.stage, done: Boolean(order.done), error: order.error ?? null, jobId: order.jobId ?? null } : null,
        });
      }
      if (p === "/api/token") {
        const fees = (await Promise.all(["ext:platform", "ext:platform:dev", "ext:platform:treasury"].map((a) => engine.ledger.balance(a, "USDC")))).reduce((a, b) => a + b, 0n);
        const bb = buybacks();
        return json(res, 200, {
          on: tokenOn(), symbol: config.token.symbol, address: config.token.address || null, buyUrl: config.token.buyUrl || null, holderMin: config.token.holderMin,
          platformFeeBps: config.platformTreasury ? config.platformFeeBps : 0, feesCollectedUsd: fromUsdc(fees),
          bought: { usd: bb.reduce((a, b) => a + b.usd, 0), amount: bb.reduce((a, b) => a + b.amount, 0) }, buybacks: bb.slice(0, 50), mode: config.mode,
          launch: launchState(), verification: verification(),
        });
      }
      if (p === "/api/market") return json(res, 200, { mode: config.mode, chainId: config.salesChainId, products: engine.market(url.searchParams.get("q") ?? "") });
      // ---- the market for agents: search with filters, the discovery catalog, one product with its free preview
      if (p.startsWith("/api/market/")) {
        if (limited(req, "market-read", 240, 60_000)) return json(res, 429, { error: "slow down" });
        const live = liveProducts(engine);
        if (p === "/api/market/search") {
          const max = url.searchParams.get("maxUsd");
          const sort = url.searchParams.get("sort");
          const rows = search(live, { q: url.searchParams.get("q") ?? "", kind: url.searchParams.get("kind") ?? undefined, maxUsd: max ? Number(max) : undefined, sort: sort === "price" || sort === "new" ? sort : "best" });
          const shown = [...engine.store.companies.values()].filter((c) => (config.mode !== "live" || !c.sim) && !c.house);
          return json(res, 200, { mode: config.mode, chainId: config.salesChainId, count: rows.length, kinds: [...new Set(live.map((l) => l.p.kind))], items: rows.slice(0, 100).map(card), totals: marketTotals(shown) });
        }
        if (p === "/api/market/catalog") { const c = catalog(live), svc = catalogItems(config.publicUrl, config.salesChainId, engine.store.companies.get(HOUSE_ID)?.wallet ?? null); return json(res, 200, { ...c, count: c.count + svc.length, items: [...svc, ...c.items] }); }
        if (seg[2] && seg[3]) {
          const hit = live.find((l) => l.c.slug === seg[2] && l.p.id === seg[3]);
          return hit ? json(res, 200, { mode: config.mode, ...detail(hit) }) : json(res, 404, { error: "no such product on sale" });
        }
        return json(res, 404, { error: "not found" });
      }

      // ---- sign-in with a wallet
      if (p === "/api/auth/nonce") {
        if (limited(req, "nonce", 30, 60_000)) return json(res, 429, { error: "slow down" });
        const address = url.searchParams.get("address");
        if (!address) return json(res, 400, { error: "address required" });
        const n = engine.auth.nonce();
        return json(res, 200, { nonce: n.nonce, message: n.message(getAddress(address)) });
      }
      if (p === "/api/auth/verify" && req.method === "POST") {
        // a smart wallet's signature is checked on a node: no flood of checks from one address
        if (limited(req, "verify", 30, 60_000)) return json(res, 429, { error: "slow down" });
        const b = await body(req);
        const token = await engine.auth.verify(String(b.address), String(b.nonce), String(b.signature) as `0x${string}`);
        const secure = config.publicUrl.startsWith("https") ? "; Secure" : "";
        // A browser (it sends Origin on every POST) keeps the session in the HttpOnly cookie only, out of reach of page scripts.
        // Scripts and agents (no Origin) also get it in the body, to send as Bearer.
        return json(res, 200, { ...(req.headers.origin ? {} : { token }), address: getAddress(String(b.address)) }, { "Set-Cookie": `ns_session=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=604800${secure}` });
      }
      if (p === "/api/auth/me") return json(res, 200, { address: owner, requireAuth: config.requireAuth });
      if (p === "/api/auth/logout" && req.method === "POST") { engine.auth.revoke(req); return json(res, 200, { ok: true }, { "Set-Cookie": "ns_session=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0" }); }
      // Sign out everywhere: every session of this wallet issued until now stops working, on every device.
      if (p === "/api/auth/logout-all" && req.method === "POST") {
        const me = engine.auth.ownerSession(req);
        if (!me) return json(res, 401, { error: "Sign in with your wallet first." });
        engine.auth.revokeAll(me);
        return json(res, 200, { ok: true }, { "Set-Cookie": "ns_session=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0" });
      }

      // ---- API keys for the MCP endpoint
      if (seg[0] === "api" && seg[1] === "keys") {
        // Keys are managed from a signed-in wallet only: a leaked key cannot mint more keys for itself.
        if (caller?.via === "key") return json(res, 403, { error: "Manage API keys from the dashboard, signed in with your wallet." });
        if (!owner) return json(res, 401, { error: "sign in first" });
        if (req.method === "GET") return json(res, 200, engine.auth.listKeys(owner));
        if (req.method === "POST") {
          if (limited(req, "keys", 10, 3600_000) || limited(req, `keys-owner:${owner}`, 10, 3600_000)) return json(res, 429, { error: "Too many new keys; try again in an hour." });
          const b = await body(req);
          try { return json(res, 201, engine.auth.createKey(owner, String(b.label ?? "MCP"))); } catch (e) { return json(res, 400, { error: (e as Error).message }); }
        }
        if (req.method === "DELETE" && seg[2]) return json(res, engine.auth.revokeKey(owner, seg[2]) ? 200 : 404, { ok: true });
      }

      // ---- NIGHTSHIFT over MCP (streamable HTTP, stateless)
      // A browser opening /mcp wants the page about it, not the protocol endpoint.
      const wantsPage = req.method === "GET" && (req.headers.accept ?? "").includes("text/html");
      if (p === "/mcp" && !wantsPage) {
        // agents call often, but not without limit: per caller and per key
        const key = (req.headers.authorization ?? "").slice(-16) || "anon";
        if (limited(req, "mcp", 120, 60_000) || limited(req, `mcp-key:${key}`, 240, 60_000)) return json(res, 429, { error: "slow down" });
        const b = req.method === "POST" ? await body(req) : undefined;
        if (b) liveUsage(config.dataDir).mcp(clientIp(req), b, "nightshift");
        return await handleMcp(engine, req, res, b);
      }

      // Live events: every task step, journal line and sale, as it happens.
      if (p === "/api/events") {
        const ipKey = clientIp(req);
        if ((streams.get(ipKey) ?? 0) >= 6 || streamsTotal >= 2000) return json(res, 429, { error: "too many live connections" });
        streams.set(ipKey, (streams.get(ipKey) ?? 0) + 1); streamsTotal++; pageOpened();
        req.on("close", () => { const n = (streams.get(ipKey) ?? 1) - 1; if (n > 0) streams.set(ipKey, n); else streams.delete(ipKey); streamsTotal--; pageClosed(); });
        res.writeHead(200, { "Content-Type": "text/event-stream", "Cache-Control": "no-cache", Connection: "keep-alive" });
        res.write(": ok\n\n");
        const only = url.searchParams.get("company");
        const viewer = owner;
        // a reader that does not keep up is dropped, like the game streams: events never pile up in memory
        const send = (data: string) => { if (res.destroyed) return; if (res.writableLength > 256_000) { res.destroy(); return; } res.write(data); };
        const off = engine.on((e) => {
          if (only && e.companyId !== only) return;
          // Other people's companies only say "something changed"; their tasks and log stay private.
          const c = engine.store.companies.get(e.companyId);
          const ev = config.requireAuth && (!viewer || c?.owner !== viewer) ? { type: "company", companyId: e.companyId, payload: null, at: e.at } : e;
          send(`data: ${JSON.stringify(ev, (_k, v) => (typeof v === "bigint" ? v.toString() : v))}\n\n`);
        });
        const ping = setInterval(() => send(": ping\n\n"), 20_000);
        req.on("close", () => { off(); clearInterval(ping); });
        return;
      }

      if (p === "/api/companies" && req.method === "GET") {
        const onlyMine = url.searchParams.get("mine") === "1";
        // Live: retired demo companies stay in their owner's own list only.
        const list = await Promise.all([...engine.store.companies.values()].filter((c) => onlyMine ? owner !== null && c.owner === owner : (config.mode !== "live" || !c.sim) && !c.house).sort((a, b) => b.createdAt - a.createdAt).map(async (c) => {
          const v = publicView(engine, c);
          const working = c.tasks.find((t) => ["checking", "ordering", "building", "awaiting_approval"].includes(t.status));
          return { id: c.id, ...v, nextShiftAt: c.nextShiftAt, working: working ? { title: working.title, status: working.status, activity: working.activity } : null, mine: owner !== null && c.owner === owner };
        }));
        return json(res, 200, list);
      }
      if (p === "/api/my/companies" && req.method === "GET") {
        if (config.requireAuth && !owner) return json(res, 401, { error: "Sign in with your wallet to see your companies." });
        return json(res, 200, await desk(engine, owner));
      }
      if (seg[0] === "api" && seg[1] === "my" && seg[2] === "archived" && seg[3] && seg[4] === "restore" && req.method === "POST") {
        if (config.requireAuth && !owner) return json(res, 401, { error: "Sign in as the owner." });
        if (limited(req, `restore:${owner ?? "anon"}`, 5, 60_000)) return json(res, 429, { error: "slow down" });
        try { const c = await engine.restore(seg[3], owner); return json(res, 200, { ok: true, id: c.id }); } catch (e) { return json(res, 400, { error: (e as Error).message }); }
      }
      if (p === "/api/companies" && req.method === "POST") {
        if (config.requireAuth && !owner) return json(res, 401, { error: "Sign in with your wallet to start a company." });
        if (limited(req, "create", 10, 3600_000)) return json(res, 429, { error: "Too many new companies from here; try again later." });
        const b = await body(req);
        // where the founder came from, as the site saw it on their first visit: a referrer's host or a campaign tag
        const from = String(b.from ?? "").toLowerCase().replace(/[^a-z0-9.:_-]/g, "").slice(0, 60) || undefined;
        const c = await engine.create(String(b.idea ?? ""), (b.policy ?? {}) as never, owner, { via: b.via === "web" ? "web" : "api", ...(from ? { from } : {}) });
        return json(res, 201, { id: c.id, slug: c.slug });
      }
      if (seg[0] === "api" && seg[1] === "companies" && seg[2]) {
        const c = engine.get(seg[2]);
        if (!c) return json(res, 404, { error: "no such company" });
        const action = seg[3];
        if (c.house && action && !["wallet", "books.csv", "withdraw", "shifts"].includes(action)) return json(res, 403, { error: "NIGHTSHIFT Services is run by NIGHTSHIFT: no CEO shifts or settings to change." });
        // The owner's view and every control are the owner's alone once sign-in is on.
        if (config.requireAuth && (!owner || c.owner !== owner)) return json(res, owner ? 403 : 401, { error: owner ? "This company belongs to another wallet." : "Sign in as the owner." });
        if (!action && req.method === "GET") return json(res, 200, { ...(await full(engine, c)), withdrawableUsd: fromUsdc(await engine.withdrawable(c)), isOwner: owner !== null && c.owner === owner });
        if (action === "wallet") {
          if (config.mode === "sim") return json(res, 200, { address: c.wallet, mode: "sim" });
          const b = await balances(c.wallet);
          return json(res, 200, { address: c.wallet, mode: "live", eth: b.eth, imd: b.imd, usdc: b.usdc, saleGas: b.saleGas });
        }
        if (action === "shifts" && seg[4] && req.method === "GET") {
          const f = await flightFor(engine, c, seg[4], true);
          return f ? json(res, 200, f) : json(res, 404, { error: "no such shift" });
        }
        if (action === "books.csv" && req.method === "GET") {
          res.writeHead(200, { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="${c.slug}-books.csv"`, "Cache-Control": "private, no-store" });
          return res.end(await books(engine, c));
        }
        if (action === "products" && seg[4] && seg[5] === "download") {
          const product = c.products.find((x) => x.id === seg[4]);
          if (!product || !engine.files.has(c, product)) return json(res, 409, { error: "Not packaged yet." });
          res.writeHead(302, { Location: engine.files.link(c, product, `owner-${Date.now()}`, 1) });
          return res.end();
        }
        if (action === "chat" && req.method === "GET") return json(res, 200, await engine.chatView(c));
        if (action === "connect") {
          if (await ownerConnectRoutes(req, res, c, seg.slice(4), { json, body, limited, url, connect: engine.connect, owner, find: (x) => engine.get(x) })) return;
          return json(res, 404, { error: "unknown action" });
        }
        if (req.method !== "POST") return json(res, 405, { error: "method" });
        if (action === "shift") {
          if (limited(req, `shift:${c.id}`, 1, 60_000) || limited(req, `shift-owner:${owner ?? "anon"}`, 10, 3600_000)) return json(res, 429, { error: "One shift a minute per company, ten an hour per wallet." });
          await engine.shiftNow(c, true); return json(res, 200, { ok: true });
        }
        if (action === "products" && seg[4] && seg[5] === "price" && req.method === "POST") {
          try { engine.setPrice(c, seg[4], Number((await body(req)).priceUsd)); } catch (e) { return json(res, 400, { error: (e as Error).message }); }
          return json(res, 200, { ok: true });
        }
        if (action === "policy") { engine.setPolicy(c, (await body(req)) as never); return json(res, 200, c.policy); }
        if (action === "alerts" && !seg[4]) {
          if (limited(req, `alerts:${c.id}`, 5, 60_000)) return json(res, 429, { error: "slow down" });
          try { return json(res, 200, await engine.alertLink(c)); } catch (e) { return json(res, 400, { error: (e as Error).message }); }
        }
        if (action === "alerts" && seg[4] === "off") { engine.alertsOff(c); return json(res, 200, { ok: true }); }
        if (action === "commission") {
          if (limited(req, `commission:${c.id}`, 3, 60_000)) return json(res, 429, { error: "slow down" });
          try { const t = await engine.commission(c, await body(req)); return json(res, 200, { ok: true, taskId: t.id, status: t.status, error: t.error }); } catch (e) { return json(res, 400, { error: (e as Error).message }); }
        }
        if (action === "chat" && !seg[4]) {
          if (limited(req, `chat:${c.id}`, 6, 60_000)) return json(res, 429, { error: "Give the CEO a moment: six messages a minute." });
          try { return json(res, 200, { lines: await engine.chat(c, (await body(req)).text) }); } catch (e) { return json(res, 400, { error: (e as Error).message }); }
        }
        if (action === "chat" && seg[4] === "act") {
          if (limited(req, `chat-act:${c.id}`, 6, 60_000)) return json(res, 429, { error: "slow down" });
          const b = await body(req);
          try { return json(res, 200, await engine.chatAct(c, String(b.line ?? ""), String(b.action ?? ""))); } catch (e) { return json(res, 400, { error: (e as Error).message }); }
        }
        if (action === "profile") {
          try { engine.updateProfile(c, await body(req)); } catch (e) { return json(res, 400, { error: (e as Error).message }); }
          return json(res, 200, { ok: true });
        }
        if (action === "products" && seg[4] && !seg[5]) {
          try { engine.editProduct(c, seg[4], await body(req)); } catch (e) { return json(res, 400, { error: (e as Error).message }); }
          return json(res, 200, { ok: true });
        }
        if (action === "delete") {
          if (limited(req, `delete:${c.id}`, 2, 60_000)) return json(res, 429, { error: "slow down" });
          // a signed-in owner deletes their own; a local engine without sign-in deletes unowned demos only
          if (config.requireAuth ? !owner || c.owner !== owner : c.owner !== null && c.owner !== owner) return json(res, 403, { error: "Only the company's owner can delete it." });
          const b = await body(req);
          if (String(b.confirm ?? "").trim().toLowerCase() !== c.name.trim().toLowerCase()) return json(res, 400, { error: "Type the company's name to confirm." });
          try { await engine.archive(c); } catch (e) { return json(res, 400, { error: (e as Error).message }); }
          return json(res, 200, { ok: true });
        }
        if (action === "withdraw") {
          const b = await body(req);
          if (limited(req, `withdraw:${c.id}`, 3, 60_000)) return json(res, 429, { error: "slow down" });
          // Live money only ever goes to the company's signed-in owner.
          const to = (config.mode === "live" ? (owner && c.owner === owner ? owner : null) : (owner ?? (typeof b.to === "string" ? b.to : null))) as `0x${string}` | null;
          if (!to || !/^0x[0-9a-fA-F]{40}$/.test(to)) return json(res, 400, { error: config.mode === "live" ? "Only the company's owner, signed in, can withdraw." : "Sign in, or give a destination address." });
          const r = await engine.withdraw(c, getAddress(to), typeof b.amountUsd === "number" ? usdc(b.amountUsd) : undefined);
          return json(res, 200, { ok: true, sentUsd: fromUsdc(r.sent), feeUsd: fromUsdc(r.fee), txs: r.txs });
        }
        if (action === "close" && req.method === "POST") {
          if (limited(req, `close:${c.id}`, 2, 60_000)) return json(res, 429, { error: "slow down" });
          if (!owner || c.owner !== owner) return json(res, 403, { error: "Only the company's owner, signed in, can stop it and take the funds back." });
          try { return json(res, 200, { ok: true, ...(await engine.closeOut(c, getAddress(owner))) }); } catch (e) { return json(res, 400, { error: (e as Error).message }); }
        }
        if (action === "social" && !seg[4]) {
          const b = await body(req);
          const handle = await engine.connectBluesky(c, String(b.handle ?? ""), String(b.appPassword ?? ""), Boolean(b.auto));
          return json(res, 200, { ok: true, handle });
        }
        if (action === "social" && seg[4] === "disconnect") { await engine.disconnectBluesky(c); return json(res, 200, { ok: true }); }
        // drafts are not posted by hand any more: posts about real events go out from Connections, by its rules
        if (action === "posts" && seg[4] && seg[5] === "publish") return json(res, 410, { error: "Posts go out from the owner desk's Connections tab now." });
        if (action === "pause") { engine.setStatus(c, "paused"); return json(res, 200, { ok: true }); }
        if (action === "resume") { engine.setStatus(c, "active"); return json(res, 200, { ok: true }); }
        if (action === "tasks" && seg[4] && seg[5] === "approve") { await engine.approve(c, seg[4]); return json(res, 200, { ok: true }); }
        if (action === "tasks" && seg[4] && seg[5] === "reject") { engine.reject(c, seg[4]); return json(res, 200, { ok: true }); }
        return json(res, 404, { error: "unknown action" });
      }
      if (seg[0] === "api" && seg[1] === "public" && seg[2] && seg[3] === "shifts" && seg[4]) {
        const c = engine.get(seg[2]);
        const f = c && !(config.mode === "live" && c.sim) ? await flightFor(engine, c, seg[4], false) : null;
        return f ? json(res, 200, f) : json(res, 404, { error: "no such shift" });
      }
      if (seg[0] === "api" && seg[1] === "public" && seg[2]) {
        const c = engine.get(seg[2]);
        // the shop page loads this: one visit per visitor per 10 minutes (bots left out), the number the CEO reads as traffic
        if (c && !seg[3] && !BOT.test(String(req.headers["user-agent"] ?? "x")) && !limited(req, `visit:${c.id}`, 1, 600_000)) {
          const v = engine.store.metricsOf(c.id).visits; v.push(Date.now()); if (v.length > 5000) v.splice(0, v.length - 5000); engine.store.markDirty();
        }
        // a visit that came from one of the company's own posts (its link carries ?via=<channel>), once per visitor per 10 minutes
        const via = url.searchParams.get("via") ?? "";
        if (c && (CHANNELS as string[]).includes(via) && !limited(req, `via:${c.id}`, 1, 600_000)) {
          const m = engine.store.metricsOf(c.id);
          (m.via ??= []).push({ at: Date.now(), ch: via });
          if (m.via.length > 5000) m.via.splice(0, m.via.length - 5000);
          engine.store.markDirty();
        }
        return c ? json(res, 200, publicView(engine, c)) : json(res, 404, { error: "no such company" });
      }

      // x402: pay in USDC, get the product. Agents and people use the same door.
      if (seg[0] === "buy" && seg[1] && seg[2]) {
        const c = engine.get(seg[1]);
        const id = productIdOf(seg[2]);
        const product = c?.products.find((x) => x.id === id && x.status === "live");
        if (!c || !product) return json(res, 404, { error: "no such product" });
        // Never take money for something that cannot be handed over yet.
        if (!engine.files.has(c, product)) return json(res, 409, { error: "This product is being packaged. Try again in a few minutes." });
        // what the agent is buying, in the same words the discovery catalog uses: the facilitator settles against exactly this
        const offer = offerFor(c, product, engine.files.read(c, product));
        const req402 = offer.requirement;
        const challenge = (error?: string) => challenge402(offer.requirement, offer.resource, error, offer.extensions);
        const sig = req.headers["payment-signature"] ?? req.headers["x-payment"];
        if (config.mode === "sim" && url.searchParams.get("sim") === "1" && req.method === "POST") {
          await engine.recordSale(c, product.id, product.priceUsdc, "0xdemo000000000000000000000000000000buyer", null, true);
          return json(res, 200, { ok: true, sim: true, deliverable: engine.files.link(c, product, `sim-${Date.now()}`) });
        }
        if (!sig || Array.isArray(sig)) {
          const ch = challenge("payment required");
          return json(res, 402, ch, { "PAYMENT-REQUIRED": encodeHeader(ch) });
        }
        const payment = decodeHeader<PaymentPayload>(sig);
        const auth = payment?.payload?.authorization;
        // A retry of a payment already settled is checked as of its first try, at the price paid then.
        const prior = auth?.from && auth.nonce ? engine.checkout.recordOf(auth.from, auth.nonce) : undefined;
        const reqPay = prior ? requirement(config.salesChainId, c.wallet, prior.value) : req402;
        const v = await verifyPayment(payment, reqPay, prior ? Math.floor(prior.at / 1000) : undefined);
        if (!v.ok) return json(res, 402, challenge(v.reason), { "PAYMENT-REQUIRED": encodeHeader(challenge(v.reason)) });
        if (config.mode === "sim") return json(res, 400, { error: "sim mode does not settle real payments" });
        // Settling costs the facilitator or the company gas: limit it per caller and per payer, check
        // the payer can actually pay, and settle one payment at a time per company.
        if (limited(req, "settle", 6, 60_000) || limited(req, `settle-payer:${v.payer.toLowerCase()}`, 3, 60_000)) return json(res, 429, { error: "Too many payments at once; try again in a minute." });
        if (await engine.checkout.fresh(auth.from, auth.nonce)) {
          const value = BigInt(auth.value);
          const bal = await sales.readContract({ address: USDC[config.salesChainId]!.address, abi: erc20Abi, functionName: "balanceOf", args: [v.payer as `0x${string}`] }).catch(() => 0n);
          if (bal < value) return json(res, 402, challenge("insufficient USDC balance"), { "PAYMENT-REQUIRED": encodeHeader(challenge("insufficient USDC balance")) });
        }
        // Through the CDP facilitator when it is on (it pays the gas); otherwise the company settles,
        // saved before it is broadcast. Booked once it lands; the same header again never pays twice.
        const run = engine.settleInTurn(c.id, () => engine.checkout.settle(c.id, c.wallet, product.id, payment, undefined, offer));
        let tx: `0x${string}`;
        try { tx = await run; } catch (e) {
          if (e instanceof PendingError) return json(res, 202, { ok: false, pending: true, error: e.message });
          if (e instanceof PaymentRefused) return json(res, 402, challenge(e.reason), { "PAYMENT-REQUIRED": encodeHeader(challenge(e.reason)) });
          // the company settles this one itself and has no gas on Base: refused before anything is sent
          if (e instanceof NoGasError) {
            void engine.alert(`${c.name} cannot take a payment: its wallet has no ETH on Base for the settlement gas.`, `nogas-${c.id}`);
            return json(res, 503, { error: e.message });
          }
          throw e;
        }
        return json(res, 200, { ok: true, tx, deliverable: engine.files.link(c, product, tx) }, { "PAYMENT-RESPONSE": encodeHeader({ success: true, transaction: tx, network: req402.network, payer: v.payer }) });
      }

      // A bought product: signed per sale, valid for a week.
      if (seg[0] === "download" && seg[1] && seg[2] && seg[3] && seg[4]) {
        const c = engine.get(seg[1]) ?? engine.archived(seg[1]);
        const product = c?.products.find((x) => x.id === seg[2]);
        const ref = url.searchParams.get("ref") ?? "";
        if (!c || !product || !engine.files.check(c, product.id, seg[3], seg[4], ref)) return json(res, 403, { error: "This download link is invalid or has expired." });
        const bin = engine.files.bytes(c, product);
        if (bin) {
          res.writeHead(200, { "Content-Type": bin.type, "Content-Length": bin.data.length, "Content-Disposition": `attachment; filename="${bin.name.replace(/"/g, "")}"`, "Cache-Control": "private, no-store" });
          return res.end(bin.data);
        }
        const text = engine.files.read(c, product);
        if (text === null) return json(res, 404, { error: "not packaged yet" });
        res.writeHead(200, { "Content-Type": "text/markdown; charset=utf-8", "Content-Disposition": `attachment; filename="${c.slug}-${product.id.replace(/[^\w-]/g, "")}.md"`, "Cache-Control": "private, no-store", "Content-Security-Policy": SANDBOX_CSP });
        return res.end(text);
      }

      // A studio product's listing images: public, like the product card itself.
      if (seg[0] === "api" && seg[1] === "studio" && seg[2] && seg[3] && /^(hero|inside|included)\.png$/.test(seg[4] ?? "") && req.method === "GET") {
        if (limited(req, "studio-img", 120, 60_000)) return json(res, 429, { error: "slow down" });
        const c = engine.get(seg[2]);
        const product = c?.products.find((x) => x.id === seg[3] && x.status === "live");
        const png = c && product ? engine.files.image(c, product, seg[4]!.slice(0, -4)) : null;
        if (!png) return json(res, 404, { error: "no such image" });
        res.writeHead(200, { "Content-Type": "image/png", "Content-Length": png.length, "Cache-Control": "public, max-age=3600" });
        return res.end(png);
      }

      // Sim deliveries: the page and files the simulated swarm "built".
      if (seg[0] === "sites" && seg[1]) {
        const id = engine.sim.sites.get(seg[1]) ?? [...engine.store.companies.values()].find((x) => x.site?.jobId === seg[1] || x.tasks.some((t) => t.imd?.jobId === seg[1]))?.id;
        const c = id ? engine.store.companies.get(id) : undefined;
        if (!c) return json(res, 404, { error: "no such site" });
        // one visit per visitor per 10 minutes, and a bounded history
        if (!limited(req, `visit:${c.id}`, 1, 600_000)) { const v = engine.store.metricsOf(c.id).visits; v.push(Date.now()); if (v.length > 5000) v.splice(0, v.length - 5000); engine.store.markDirty(); }
        res.writeHead(200, { "Content-Type": "text/html; charset=utf-8", "Content-Security-Policy": SANDBOX_CSP });
        return res.end(engine.sim.site(c));
      }
      if (seg[0] === "files" && seg[1] && seg[2] && config.mode === "sim") {
        const text = engine.sim.file(seg[1], seg[2]);
        if (text === null) return json(res, 404, { error: "no such file" });
        res.writeHead(200, { "Content-Type": "text/markdown; charset=utf-8" });
        return res.end(text);
      }

      // an unknown API path is a 404, not the app's page
      if ((req.method === "GET" || req.method === "HEAD") && !p.startsWith("/api/") && serveStatic(res, p, req.method === "HEAD", /gzip/.test(String(req.headers["accept-encoding"] ?? "")))) {
        // a page (not a file) shown to a browser: counted by path and by where the visitor came from
        if (req.method === "GET" && !extname(p) && (req.headers.accept ?? "").includes("text/html")) liveUsage(config.dataDir).page(clientIp(req), p, req.headers.referer, req.headers["user-agent"], url.searchParams, url.hostname);
        return;
      }
      return json(res, 404, { error: "not found" });
    } catch (err) {
      console.error(err);
      // Our own errors are written for people; library errors (RPC URLs, versions, stacks) are not shown.
      const msg = String((err as Error).message ?? "").split("\n")[0] ?? "";
      const raw = msg.length > 220 || /viem|Version:|https?:\/\/|Request Arguments|Details:|ECONN|ETIMEDOUT/i.test(msg);
      return json(res, 400, { error: raw || !msg ? "Something went wrong. Try again in a moment." : msg });
    }
  });
  // LASTSPAWN: the MMORPG's world, one WebSocket on this same server (LASTSPAWN=0 turns it off)
  if (process.env.LASTSPAWN !== "0") attachLastspawn(server, { dataDir: config.dataDir, wallet: (req) => engine.auth.caller(req)?.addr ?? null, savedName, log: (s) => console.error(s) });
  server.listen(config.port, () => console.log(`NIGHTSHIFT engine on ${config.publicUrl} (${config.mode} mode${engine.llm ? `, CEO model ${config.model}` : ", playbook CEO: set OPENROUTER_API_KEY for the model"})`));
  return server;
}
