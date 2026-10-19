import { existsSync, readFileSync, statSync } from "node:fs";
import { type IncomingMessage, type ServerResponse, createServer } from "node:http";
import { extname, join, normalize, resolve, sep } from "node:path";
import type { Company } from "@nightshift/core";
import { fromImd, fromUsdc } from "@nightshift/core";
import { type PaymentPayload, USDC, challenge, decodeHeader, encodeHeader, requirement, verifyPayment } from "@nightshift/x402";
import { balances, eth, sales } from "./chain.js";
import { PendingError } from "./checkout.js";
import { findPool } from "./v4.js";
import { liveStats, pageClosed, pageOpened, sawVisitor } from "./live.js";
import { keeperAccount } from "./keeper.js";
import { frogPng } from "./frogpng.js";
import { board as pinBoard, frogImage as pinFrogImage, inMatch as pinInMatch, soloFinish as pinSoloFinish, soloProgress as pinSoloProgress, soloStart as pinSoloStart, finish as pinFinish, get as pinGet, leave as pinLeave, listen as pinListen, progress as pinProgress, queue as pinQueue, stakes as pinStakes } from "./pinball.js";
import { claimsOf, epochs, markPosted } from "./frogpot.js";
import { config } from "./config.js";
import type { Engine } from "./engine.js";
import { handleMcp } from "./mcp.js";
import { ANNOUNCED, checkSetup, isAdmin, pendingChanges, setupState } from "./admin.js";
import { writeSettings } from "./settings.js";
import { buybacks, checkLaunch, completeContracts, holderStatus, launchBody, launchState, patchLaunch, recordBuyback, recordLaunch, saveVerification, tokenOn, verification } from "./token.js";
import { verifyShift } from "./shift-verify.js";
import { DEV_WALLET, FIRST_BUYER } from "./shift-launch.js";
import { CATALOG, checkOrder, orders, recordOrder } from "./orders.js";
import { burnTotals, marketSnapshot } from "./community.js";
import { chessRoutes } from "./chess-routes.js";
import { gamesRoutes } from "./games-routes.js";
import { arenaRoutes } from "./arena-routes.js";
import { spectateRoutes } from "./spectate.js";
import { betsRoutes } from "./bets-routes.js";
import { prices } from "./prices.js";
import { checkOrder as checkSwarmOrder, orders as swarmOrders, placeOrder as placeSwarmOrder } from "./swarm.js";
import { frogStats, frogsOn, stakingBoard, stakingOf } from "./frogs.js";
import { impact } from "./impact.js";
import { usdc } from "@nightshift/core";
import { erc20Abi, getAddress } from "viem";

/** The caller's IP. X-Forwarded-For is trusted only when the request comes from the local proxy. */
function clientIp(req: IncomingMessage): string {
  const peer = (req.socket.remoteAddress ?? "?").replace(/^::ffff:/, "");
  const fromProxy = /^(127\.|10\.|172\.(1[6-9]|2\d|3[01])\.|192\.168\.|::1$)/.test(peer);
  const fwd = (req.headers["x-forwarded-for"] as string | undefined)?.split(",")[0]?.trim();
  return fromProxy && fwd ? fwd : peer;
}

/** Open live-event streams, per IP and in all. */
const streams = new Map<string, number>();
let streamsTotal = 0;

/** Payments being settled, one chain per company. */
const settling = new Map<string, Promise<unknown>>();

/** A small fixed-window limiter per IP and route; expired windows are swept. */
const hits = new Map<string, { n: number; reset: number }>();
setInterval(() => { const now = Date.now(); for (const [k, h] of hits) if (h.reset < now) hits.delete(k); }, 60_000).unref();
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
  const rev = await engine.ledger.balance(`co:${c.id}:usdc`, "USDC");
  let spent = 0n;
  for (const t of c.tasks) spent += t.costImd;
  const stats = engine.stats(c);
  const m = engine.store.metricsOf(c.id);
  return {
    ...c,
    tasks: c.tasks.slice(-60),
    journal: c.journal.slice(-150),
    stats,
    pnl: {
      revenueUsd: fromUsdc(rev),
      spentImd: fromImd(spent),
      spentUsd: fromImd(spent) * config.imdUsd,
      profitUsd: fromUsdc(rev) - fromImd(spent) * config.imdUsd,
      imdBalance: fromImd(imd),
    },
    recentSales: m.sales.slice(-20).reverse(),
    holder: tokenOn() ? { symbol: config.token.symbol, ...(await holderStatus(c.owner)), min: config.token.holderMin } : null,
    platformFeeBps: config.platformTreasury ? config.platformFeeBps : 0,
    series: series(m.visits, m.sales.map((s) => ({ at: s.at, usd: Number(s.usdc) / 1e6 }))),
  };
}

/** The public view: what a visitor or investor may see. No wallet keys, no drafts. */
function publicView(engine: Engine, c: Company) {
  const m = engine.store.metricsOf(c.id);
  let spent = 0n;
  for (const t of c.tasks) spent += t.costImd;
  const revenue = c.products.reduce((a, p) => a + fromUsdc(p.revenueUsdc), 0);
  return {
    slug: c.slug, name: c.name, mission: c.mission, audience: c.audience, createdAt: c.createdAt, wallet: c.wallet, status: c.status, cycle: c.cycle,
    site: c.site?.url ?? null,
    products: c.products.filter((p) => p.status === "live").map((p) => ({ id: p.id, name: p.name, kind: p.kind, pitch: p.pitch, priceUsd: fromUsdc(p.priceUsdc), sales: p.sales, buyUrl: `${config.publicUrl}/buy/${c.slug}/${p.id}` })),
    pnl: { revenueUsd: revenue, spentUsd: fromImd(spent) * config.imdUsd, sales: m.sales.length },
    shifts: c.tasks.slice(-12).reverse().map((t) => ({ cycle: t.cycle, kind: t.kind, title: t.title, status: t.status })),
    mode: config.mode,
  };
}

let swarmCache: { at: number; agents: number | null; working: number | null } = { at: 0, agents: null, working: null };
async function landing(engine: Engine) {
  if (Date.now() - swarmCache.at > 30_000) {
    const h = await engine.reads.health().catch(() => null);
    swarmCache = { at: Date.now(), agents: h?.connectedDaemons ?? null, working: h?.workingNow ?? null };
  }
  // Live: demo companies retired from simulation are not shown; their revenue was never real.
  const companies = [...engine.store.companies.values()].filter((c) => config.mode !== "live" || !c.sim);
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
  ...(config.publicUrl.startsWith("https://") ? { "Strict-Transport-Security": "max-age=31536000; includeSubDomains" } : {}),
};
/** The app's pages: our own scripts only, and only the hosts the browser really talks to (RPCs, WalletConnect, Google Fonts). */
const CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
  "font-src 'self' data: https://fonts.gstatic.com",
  "img-src 'self' data: blob: https:",
  "media-src 'self' blob:",
  "connect-src 'self' https://ethereum-rpc.publicnode.com https://rpc.mevblocker.io https://eth.drpc.org https://mainnet.base.org https://sepolia.base.org wss://relay.walletconnect.com wss://relay.walletconnect.org https://*.walletconnect.com https://*.walletconnect.org https://*.reown.com wss://*.reown.com",
  "frame-src https://verify.walletconnect.com https://verify.walletconnect.org",
  "worker-src 'self'", "manifest-src 'self'", "object-src 'none'", "base-uri 'self'", "form-action 'self'", "frame-ancestors 'none'",
].join("; ");
/** Pages made from company or model text (sim sites): no script at all, whatever they contain. */
const SANDBOX_CSP = "sandbox allow-popups allow-popups-to-escape-sandbox; default-src 'none'; style-src 'unsafe-inline'; img-src https: data:; frame-ancestors 'none'";

/** Browsers send Origin on cross-site POSTs: one from another site never acts with the visitor's session cookie. */
function crossSite(req: IncomingMessage): boolean {
  const origin = req.headers.origin;
  if (!origin || !/(?:^|;\s*)ns_session=/.test(req.headers.cookie ?? "")) return false;
  try { return new URL(origin).host !== req.headers.host && new URL(origin).origin !== new URL(config.publicUrl).origin; } catch { return true; }
}

const MIME: Record<string, string> = { ".html": "text/html; charset=utf-8", ".js": "text/javascript", ".css": "text/css", ".svg": "image/svg+xml", ".png": "image/png", ".ico": "image/x-icon", ".json": "application/json", ".woff2": "font/woff2", ".webp": "image/webp", ".jpg": "image/jpeg", ".mp4": "video/mp4", ".webmanifest": "application/manifest+json" };

function serveStatic(res: ServerResponse, path: string): boolean {
  if (!existsSync(config.webDist)) return false;
  const safe = normalize(path).replace(/^([/\\])+/, "").replace(/\.\.[/\\]?/g, "");
  let f = resolve(config.webDist, safe);
  // never a file outside the built app, whatever the path says
  if (!f.startsWith(resolve(config.webDist) + sep) || !existsSync(f) || statSync(f).isDirectory()) f = join(config.webDist, "index.html");
  if (!existsSync(f)) return false;
  const type = MIME[extname(f)] ?? "application/octet-stream";
  res.writeHead(200, { "Content-Type": type, ...(type.startsWith("text/html") ? { "Content-Security-Policy": CSP } : {}) });
  res.end(readFileSync(f));
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
/** Everything the token page shows, in one read: market, supply, burns, frogs. */
async function tokenOverview(): Promise<unknown> {
  if (overviewCache && Date.now() - overviewCache.at < 60_000) return overviewCache.v;
  const token = config.token.address as `0x${string}` | "";
  const [m, staked, dead, frogs] = await Promise.all([
    marketSnapshot().catch(() => null),
    stakedNow(),
    token ? eth.readContract({ address: token, abi: erc20Abi, functionName: "balanceOf", args: [DEAD] }).then((v) => Number(v / 10n ** 18n)).catch(() => null) : Promise.resolve(null),
    frogStats().catch(() => null),
  ]);
  const burnedShift = dead ?? 0;
  const v = {
    symbol: config.token.symbol, address: token || null, supply: SUPPLY,
    market: m ? { priceUsd: m.priceUsd, mcap: m.mcap, liquidity: m.liquidity, chart: m.chart } : null,
    staked, stakedPct: staked === null ? null : (staked / SUPPLY) * 100,
    burnedShift, burnedImd: burnTotals().imd,
    circulating: SUPPLY - burnedShift - (staked ?? 0),
    frogs: frogs ? { minted: Number(frogs.minted), max: 500 } : null,
  };
  overviewCache = { at: Date.now(), v };
  return v;
}

export function serve(engine: Engine) {
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
        if (p === "/api/admin/swarm" && req.method === "GET") return json(res, 200, { orders: await swarmOrders() });
        if (p === "/api/admin/swarm/check" && req.method === "POST") { const b = await body(req); try { return json(res, 200, await checkSwarmOrder(String(b.key ?? ""))); } catch (e) { return json(res, 400, { error: (e as Error).message }); } }
        if (p === "/api/admin/swarm/placed" && req.method === "POST") {
          const b = await body(req);
          const tx = String(b.tx ?? "");
          if (!/^0x[0-9a-fA-F]{64}$/.test(tx)) return json(res, 400, { error: "tx must be a transaction hash" });
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
        if (p === "/api/admin/keeper" && req.method === "GET") {
          const a = keeperAccount(engine.vault).address;
          return json(res, 200, { address: a, eth: (await eth.getBalance({ address: a }).catch(() => 0n)).toString(), last: engine.lastKeeper });
        }
        if (p === "/api/admin/keeper/run" && req.method === "POST") return json(res, 200, await engine.keeperRun());
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

      const owner = engine.auth.owner(req);
      // Reads that reach the chain or IMD when their cache is cold: plenty for pages, not for a loop.
      if (["/api/staked", "/api/token/overview", "/api/token", "/api/frogs", "/api/frogs/claims", "/api/frogs/staking", "/api/impact", "/api/landing"].includes(p) && limited(req, "reads", 240, 60_000)) return json(res, 429, { error: "slow down" });

      // ---- the landing page's live numbers: real where they can be, labelled where simulated
      if (p === "/api/landing") return json(res, 200, await landing(engine));
      if (p === "/api/impact") return json(res, 200, await impact(engine));
      if (p === "/api/frogs/staking") {
        const w = new URL(req.url ?? "/", config.publicUrl).searchParams.get("wallet") ?? "";
        return json(res, 200, { board: stakingBoard(20), me: /^0x[0-9a-fA-F]{40}$/.test(w) ? stakingOf(w) : null });
      }
      if (await spectateRoutes(req, res, p, { json, limited })) return;
      if (p.startsWith("/api/chess/") && await chessRoutes(req, res, p, { json, body, limited, owner: engine.auth.owner(req), url })) return;
      if (p.startsWith("/api/bets/") && await betsRoutes(req, res, p, { json, body, limited, owner, url, vault: engine.vault })) return;
      if (p.startsWith("/api/games/") && await gamesRoutes(req, res, p, { json, body, limited, owner: engine.auth.owner(req), url, vault: engine.vault })) return;
      if ((p.startsWith("/api/arena/") || p === "/arena/agents.md") && await arenaRoutes(req, res, p, { json, body, limited, owner, url, auth: engine.auth, vault: engine.vault })) return;
      if (p.startsWith("/api/pinball/")) {
        const parts = p.split("/").filter(Boolean); // api pinball …
        if (p === "/api/pinball/stakes") return json(res, 200, pinStakes());
        if (p === "/api/pinball/board") return json(res, 200, pinBoard());
        // a NIGHT FROG's onchain image, the only face from a wallet shown to a rival: never run as a page
        if (parts[2] === "frog" && parts[3] && req.method === "GET") {
          if (limited(req, "pinball-frog", 120, 60_000)) return json(res, 429, { error: "slow down" });
          // the same frog as a PNG, for Telegram photos and link previews
          const pngId = /^(\d{1,5})\.png$/.exec(parts[3])?.[1];
          if (pngId) {
            const png = await frogPng(Number(pngId)).catch(() => null);
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
          // one open run per player: the signed-in wallet, else the IP
          try { return json(res, 200, pinSoloStart(String(b.name ?? ""), owner ?? `ip:${clientIp(req)}`)); } catch (e) { return json(res, 409, { error: (e as Error).message }); }
        }
        if (parts[2] === "solo" && parts[3] && parts[4] === "progress" && req.method === "POST") {
          if (limited(req, "pinball-solo-progress", 600, 60_000)) return json(res, 429, { error: "slow down" });
          const b = await body(req, 16_000);
          try { pinSoloProgress(parts[3], b); return json(res, 200, { ok: true }); } catch (e) { return json(res, 400, { error: (e as Error).message }); }
        }
        if (parts[2] === "solo" && parts[3] && parts[4] === "finish" && req.method === "POST") {
          if (limited(req, "pinball-solo-finish", 40, 600_000)) return json(res, 429, { error: "slow down" });
          const b = await body(req, 400_000);
          try { return json(res, 200, pinSoloFinish(parts[3], b.inputs)); } catch (e) { return json(res, 400, { error: (e as Error).message }); }
        }
        if (p === "/api/pinball/queue" && req.method === "POST") {
          if (limited(req, "pinball-queue", 20, 600_000)) return json(res, 429, { error: "slow down" });
          const b = await body(req);
          try { return json(res, 200, await pinQueue(String(b.name ?? ""), owner, String(b.currency ?? "FREE") as never, Number(b.stake ?? 0), typeof b.avatar === "string" ? b.avatar : null)); } catch (e) { return json(res, 400, { error: (e as Error).message }); }
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
            try { pinProgress(id, String(b.player ?? ""), b); return json(res, 200, { ok: true }); } catch (e) { return json(res, 400, { error: (e as Error).message }); }
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
      if (p === "/api/wallet-config") return json(res, 200, { walletConnect: config.walletConnect || null });
      if (p === "/api/staked") {
        const staked = await stakedNow();
        return json(res, 200, { staked, supply: SUPPLY, pct: staked === null ? null : (staked / SUPPLY) * 100 });
      }
      if (p === "/api/token/overview") return json(res, 200, await tokenOverview());
      if (p === "/api/prices") { const d = await prices(); return d ? json(res, 200, d) : json(res, 503, { error: "No price data right now." }); }
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

      // ---- sign-in with a wallet
      if (p === "/api/auth/nonce") {
        if (limited(req, "nonce", 30, 60_000)) return json(res, 429, { error: "slow down" });
        const address = url.searchParams.get("address");
        if (!address) return json(res, 400, { error: "address required" });
        const n = engine.auth.nonce();
        return json(res, 200, { nonce: n.nonce, message: n.message(getAddress(address)) });
      }
      if (p === "/api/auth/verify" && req.method === "POST") {
        const b = await body(req);
        const token = await engine.auth.verify(String(b.address), String(b.nonce), String(b.signature) as `0x${string}`);
        const secure = config.publicUrl.startsWith("https") ? "; Secure" : "";
        return json(res, 200, { token, address: getAddress(String(b.address)) }, { "Set-Cookie": `ns_session=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=604800${secure}` });
      }
      if (p === "/api/auth/me") return json(res, 200, { address: owner, requireAuth: config.requireAuth });
      if (p === "/api/auth/logout" && req.method === "POST") { engine.auth.revoke(req); return json(res, 200, { ok: true }, { "Set-Cookie": "ns_session=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0" }); }

      // ---- API keys for the MCP endpoint
      if (seg[0] === "api" && seg[1] === "keys") {
        if (!owner) return json(res, 401, { error: "sign in first" });
        // Keys are managed from a signed-in wallet only: a leaked key cannot mint more keys for itself.
        if ((req.headers.authorization ?? "").includes("nsk_")) return json(res, 403, { error: "Manage API keys from the dashboard, signed in with your wallet." });
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
        const viewer = engine.auth.owner(req);
        const off = engine.on((e) => {
          if (only && e.companyId !== only) return;
          // Other people's companies only say "something changed"; their tasks and log stay private.
          const c = engine.store.companies.get(e.companyId);
          const ev = config.requireAuth && (!viewer || c?.owner !== viewer) ? { type: "company", companyId: e.companyId, payload: null, at: e.at } : e;
          res.write(`data: ${JSON.stringify(ev, (_k, v) => (typeof v === "bigint" ? v.toString() : v))}\n\n`);
        });
        const ping = setInterval(() => res.write(": ping\n\n"), 20_000);
        req.on("close", () => { off(); clearInterval(ping); });
        return;
      }

      if (p === "/api/companies" && req.method === "GET") {
        const onlyMine = url.searchParams.get("mine") === "1";
        // Live: retired demo companies stay in their owner's own list only.
        const list = await Promise.all([...engine.store.companies.values()].filter((c) => onlyMine ? owner !== null && c.owner === owner : config.mode !== "live" || !c.sim).sort((a, b) => b.createdAt - a.createdAt).map(async (c) => {
          const v = publicView(engine, c);
          const working = c.tasks.find((t) => ["checking", "ordering", "building", "awaiting_approval"].includes(t.status));
          return { id: c.id, ...v, nextShiftAt: c.nextShiftAt, working: working ? { title: working.title, status: working.status, activity: working.activity } : null, mine: owner !== null && c.owner === owner };
        }));
        return json(res, 200, list);
      }
      if (p === "/api/companies" && req.method === "POST") {
        if (config.requireAuth && !owner) return json(res, 401, { error: "Sign in with your wallet to start a company." });
        if (limited(req, "create", 10, 3600_000)) return json(res, 429, { error: "Too many new companies from here; try again later." });
        const b = await body(req);
        const c = await engine.create(String(b.idea ?? ""), (b.policy ?? {}) as never, owner);
        return json(res, 201, { id: c.id, slug: c.slug });
      }
      if (seg[0] === "api" && seg[1] === "companies" && seg[2]) {
        const c = engine.get(seg[2]);
        if (!c) return json(res, 404, { error: "no such company" });
        const action = seg[3];
        // The owner's view and every control are the owner's alone once sign-in is on.
        if (config.requireAuth && (!owner || c.owner !== owner)) return json(res, owner ? 403 : 401, { error: owner ? "This company belongs to another wallet." : "Sign in as the owner." });
        if (!action && req.method === "GET") return json(res, 200, { ...(await full(engine, c)), withdrawableUsd: fromUsdc(await engine.withdrawable(c)), isOwner: owner !== null && c.owner === owner });
        if (action === "wallet") {
          if (config.mode === "sim") return json(res, 200, { address: c.wallet, mode: "sim" });
          const b = await balances(c.wallet);
          return json(res, 200, { address: c.wallet, mode: "live", eth: b.eth, imd: b.imd, usdc: b.usdc, saleGas: b.saleGas });
        }
        if (action === "products" && seg[4] && seg[5] === "download") {
          const product = c.products.find((x) => x.id === seg[4]);
          if (!product || !engine.files.has(c, product)) return json(res, 409, { error: "Not packaged yet." });
          res.writeHead(302, { Location: engine.files.link(c, product, `owner-${Date.now()}`, 1) });
          return res.end();
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
        if (action === "social" && seg[4] === "disconnect") { engine.disconnectBluesky(c); return json(res, 200, { ok: true }); }
        if (action === "posts" && seg[4] && seg[5] === "publish") {
          return json(res, 200, { ok: true, url: await engine.publishPost(c, Number(seg[4])) });
        }
        if (action === "pause") { engine.setStatus(c, "paused"); return json(res, 200, { ok: true }); }
        if (action === "resume") { engine.setStatus(c, "active"); return json(res, 200, { ok: true }); }
        if (action === "tasks" && seg[4] && seg[5] === "approve") { await engine.approve(c, seg[4]); return json(res, 200, { ok: true }); }
        if (action === "tasks" && seg[4] && seg[5] === "reject") { engine.reject(c, seg[4]); return json(res, 200, { ok: true }); }
        return json(res, 404, { error: "unknown action" });
      }
      if (seg[0] === "api" && seg[1] === "public" && seg[2]) {
        const c = engine.get(seg[2]);
        return c ? json(res, 200, publicView(engine, c)) : json(res, 404, { error: "no such company" });
      }

      // x402: pay in USDC, get the product. Agents and people use the same door.
      if (seg[0] === "buy" && seg[1] && seg[2]) {
        const c = engine.get(seg[1]);
        const product = c?.products.find((x) => x.id === seg[2] && x.status === "live");
        if (!c || !product) return json(res, 404, { error: "no such product" });
        // Never take money for something that cannot be handed over yet.
        if (!engine.files.has(c, product)) return json(res, 409, { error: "This product is being packaged. Try again in a few minutes." });
        const req402 = requirement(config.salesChainId, c.wallet, product.priceUsdc);
        const resource = { url: `${config.publicUrl}/buy/${c.slug}/${product.id}`, description: `${product.name}: ${product.pitch}`, mimeType: "application/json" };
        const sig = req.headers["payment-signature"] ?? req.headers["x-payment"];
        if (config.mode === "sim" && url.searchParams.get("sim") === "1" && req.method === "POST") {
          await engine.recordSale(c, product.id, product.priceUsdc, "0xdemo000000000000000000000000000000buyer", null, true);
          return json(res, 200, { ok: true, sim: true, deliverable: engine.files.link(c, product, `sim-${Date.now()}`) });
        }
        if (!sig || Array.isArray(sig)) {
          const ch = challenge(req402, resource, "payment required");
          return json(res, 402, ch, { "PAYMENT-REQUIRED": encodeHeader(ch) });
        }
        const payment = decodeHeader<PaymentPayload>(sig);
        const auth = payment?.payload?.authorization;
        // A retry of a payment already settled is checked as of its first try, at the price paid then.
        const prior = auth?.from && auth.nonce ? engine.checkout.recordOf(auth.from, auth.nonce) : undefined;
        const reqPay = prior ? requirement(config.salesChainId, c.wallet, prior.value) : req402;
        const v = await verifyPayment(payment, reqPay, prior ? Math.floor(prior.at / 1000) : undefined);
        if (!v.ok) return json(res, 402, challenge(req402, resource, v.reason), { "PAYMENT-REQUIRED": encodeHeader(challenge(req402, resource, v.reason)) });
        if (config.mode === "sim") return json(res, 400, { error: "sim mode does not settle real payments" });
        // Settling costs the company gas: limit it per caller and per payer, check the payer can
        // actually pay, and settle one payment at a time per company.
        if (limited(req, "settle", 6, 60_000) || limited(req, `settle-payer:${v.payer.toLowerCase()}`, 3, 60_000)) return json(res, 429, { error: "Too many payments at once; try again in a minute." });
        if (await engine.checkout.fresh(auth.from, auth.nonce)) {
          const value = BigInt(auth.value);
          const bal = await sales.readContract({ address: USDC[config.salesChainId]!.address, abi: erc20Abi, functionName: "balanceOf", args: [v.payer as `0x${string}`] }).catch(() => 0n);
          if (bal < value) return json(res, 402, challenge(req402, resource, "insufficient USDC balance"), { "PAYMENT-REQUIRED": encodeHeader(challenge(req402, resource, "insufficient USDC balance")) });
          // The company pays the settlement gas on Base: without it, refuse before anything is sent.
          if ((await sales.getBalance({ address: c.wallet }).catch(() => 0n)) < 20_000_000_000_000n) {
            void engine.alert(`${c.name} cannot take a payment: its wallet has no ETH on Base for the settlement gas.`, `nogas-${c.id}`);
            return json(res, 503, { error: "This company cannot take payments right now. Nothing was charged; try again later." });
          }
        }
        // Saved before it is broadcast and booked once it lands; the same header again never pays twice.
        const prev = settling.get(c.id) ?? Promise.resolve();
        const run = prev.catch(() => {}).then(() => engine.checkout.settle(c.id, c.wallet, product.id, payment));
        settling.set(c.id, run.catch(() => {}));
        let tx: `0x${string}`;
        try { tx = await run; } catch (e) {
          if (e instanceof PendingError) return json(res, 202, { ok: false, pending: true, error: e.message });
          throw e;
        }
        return json(res, 200, { ok: true, tx, deliverable: engine.files.link(c, product, tx) }, { "PAYMENT-RESPONSE": encodeHeader({ success: true, transaction: tx, network: req402.network, payer: v.payer }) });
      }

      // A bought product: signed per sale, valid for a week.
      if (seg[0] === "download" && seg[1] && seg[2] && seg[3] && seg[4]) {
        const c = engine.get(seg[1]);
        const product = c?.products.find((x) => x.id === seg[2]);
        const ref = url.searchParams.get("ref") ?? "";
        if (!c || !product || !engine.files.check(c, product.id, seg[3], seg[4], ref)) return json(res, 403, { error: "This download link is invalid or has expired." });
        const text = engine.files.read(c, product);
        if (text === null) return json(res, 404, { error: "not packaged yet" });
        res.writeHead(200, { "Content-Type": "text/markdown; charset=utf-8", "Content-Disposition": `attachment; filename="${c.slug}-${product.id.replace(/[^\w-]/g, "")}.md"`, "Cache-Control": "private, no-store", "Content-Security-Policy": SANDBOX_CSP });
        return res.end(text);
      }

      // Sim deliveries: the page and files the simulated swarm "built".
      if (seg[0] === "sites" && seg[1]) {
        const id = engine.sim.sites.get(seg[1]) ?? [...engine.store.companies.values()].find((x) => x.site?.jobId === seg[1] || x.tasks.some((t) => t.imd?.jobId === seg[1]))?.id;
        const c = id ? engine.store.companies.get(id) : undefined;
        if (!c) return json(res, 404, { error: "no such site" });
        // one visit per visitor per 10 minutes, and a bounded history
        if (!limited(req, `visit:${c.id}`, 1, 600_000)) { const v = engine.store.metricsOf(c.id).visits; v.push(Date.now()); if (v.length > 5000) v.splice(0, v.length - 5000); }
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
      if (req.method === "GET" && !p.startsWith("/api/") && serveStatic(res, p)) return;
      return json(res, 404, { error: "not found" });
    } catch (err) {
      console.error(err);
      // Our own errors are written for people; library errors (RPC URLs, versions, stacks) are not shown.
      const msg = String((err as Error).message ?? "").split("\n")[0] ?? "";
      const raw = msg.length > 220 || /viem|Version:|https?:\/\/|Request Arguments|Details:|ECONN|ETIMEDOUT/i.test(msg);
      return json(res, 400, { error: raw || !msg ? "Something went wrong. Try again in a moment." : msg });
    }
  });
  server.listen(config.port, () => console.log(`NIGHTSHIFT engine on ${config.publicUrl} (${config.mode} mode${engine.llm ? `, CEO model ${config.model}` : ", playbook CEO: set OPENROUTER_API_KEY for the model"})`));
  return server;
}
