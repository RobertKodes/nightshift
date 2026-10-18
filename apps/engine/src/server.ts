import { existsSync, readFileSync, statSync } from "node:fs";
import { type IncomingMessage, type ServerResponse, createServer } from "node:http";
import { extname, join, normalize } from "node:path";
import type { Company } from "@nightshift/core";
import { fromImd, fromUsdc } from "@nightshift/core";
import { type PaymentPayload, USDC, challenge, decodeHeader, encodeHeader, requirement, settlePayment, verifyPayment } from "@nightshift/x402";
import { balances, eth, sales, salesWallet } from "./chain.js";
import { findPool } from "./v4.js";
import { liveStats, pageClosed, pageOpened, sawVisitor } from "./live.js";
import { keeperAccount } from "./keeper.js";
import { claimsOf, epochs, markPosted } from "./frogpot.js";
import { config } from "./config.js";
import type { Engine } from "./engine.js";
import { handleMcp } from "./mcp.js";
import { isAdmin, saveSetup, setupState } from "./admin.js";
import { buybacks, checkLaunch, holderStatus, launchBody, launchState, patchLaunch, recordBuyback, recordLaunch, saveVerification, tokenOn, verification } from "./token.js";
import { verifyShift } from "./shift-verify.js";
import { DEV_WALLET, FIRST_BUYER } from "./shift-launch.js";
import { CATALOG, checkOrder, orders, recordOrder } from "./orders.js";
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

async function body(req: IncomingMessage): Promise<Record<string, unknown>> {
  let raw = "";
  for await (const chunk of req) {
    raw += chunk;
    if (raw.length > 64_000) throw new Error("body too large");
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
  const companies = [...engine.store.companies.values()];
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

const MIME: Record<string, string> = { ".html": "text/html; charset=utf-8", ".js": "text/javascript", ".css": "text/css", ".svg": "image/svg+xml", ".png": "image/png", ".ico": "image/x-icon", ".json": "application/json", ".woff2": "font/woff2" };

function serveStatic(res: ServerResponse, path: string): boolean {
  if (!existsSync(config.webDist)) return false;
  const safe = normalize(path).replace(/^([/\\])+/, "").replace(/\.\.[/\\]?/g, "");
  let f = join(config.webDist, safe);
  if (!existsSync(f) || statSync(f).isDirectory()) f = join(config.webDist, "index.html");
  if (!existsSync(f)) return false;
  res.writeHead(200, { "Content-Type": MIME[extname(f)] ?? "application/octet-stream" });
  res.end(readFileSync(f));
  return true;
}

export function serve(engine: Engine) {
  const server = createServer(async (req, res) => {
    const url = new URL(req.url ?? "/", config.publicUrl);
    const p = url.pathname;
    const seg = p.split("/").filter(Boolean);
    if (!p.startsWith("/api/admin") && !p.startsWith("/assets/") && !/\.(js|css|png|jpg|webp|svg|mp4|ico|woff2?)$/.test(p)) sawVisitor(clientIp(req), req.headers["user-agent"]);
    try {
      if (p === "/api/health") return json(res, 200, { ok: true, mode: config.mode, llm: Boolean(engine.llm), imdUsd: config.imdUsdPinned || Date.now() - config.imdUsdAt < 30 * 60_000 ? config.imdUsd : null, salesChainId: config.salesChainId, requireAuth: config.requireAuth, platformFeeBps: config.platformTreasury ? config.platformFeeBps : 0 });

      // ---- the operator's setup dashboard (/setup), behind the admin token
      if (p.startsWith("/api/admin/")) {
        if (limited(req, "admin", 60, 60_000)) return json(res, 429, { error: "slow down" });
        if (!isAdmin(req)) return json(res, 401, { error: "wrong admin token" });
        if (p === "/api/admin/setup" && req.method === "GET") return json(res, 200, await setupState(engine));
        if (p === "/api/admin/setup" && req.method === "POST") {
          const patch = await body(req);
          const err = saveSetup(patch);
          // Settings that move money or trust are announced, so a leaked admin token cannot act quietly.
          const touched = ["NIGHTSHIFT_MODE", "PLATFORM_TREASURY", "PLATFORM_FEE_BPS", "ETH_RPC", "SALES_RPC", "SALES_CHAIN_ID", "TOKEN_ADDRESS", "NFT_ADDRESS", "REQUIRE_AUTH"].filter((k) => k in patch);
          if (!err && touched.length) void engine.alert(`⚠️ /setup changed: ${touched.join(", ")}. If this was not you, rotate the admin token now.`, `setup-${Date.now()}`);
          return err ? json(res, 400, { error: err }) : json(res, 200, await setupState(engine));
        }
        if (p === "/api/admin/buyback" && req.method === "POST") {
          const b = await body(req);
          const tx = String(b.tx ?? "");
          if (!/^0x[0-9a-fA-F]{64}$/.test(tx)) return json(res, 400, { error: "tx must be a transaction hash" });
          recordBuyback({ at: Date.now(), tx, usd: Number(b.usd) || 0, amount: Number(b.amount) || 0, note: b.note ? String(b.note).slice(0, 200) : undefined });
          return json(res, 200, { ok: true, buybacks: buybacks() });
        }
        if (p === "/api/admin/token/check" && req.method === "POST") {
          // The launch is fixed (shift-launch.ts): nothing to type, only IMD's free check.
          return json(res, 200, { body: launchBody(), check: await checkLaunch(), dev: DEV_WALLET, firstBuyer: FIRST_BUYER });
        }
        if (p === "/api/admin/token/verify" && req.method === "POST") {
          const l = launchState();
          if (!l?.contracts) return json(res, 400, { error: "Nothing deployed yet." });
          if (l.contracts.hook && !l.pool) { const pool = await findPool(eth, l.contracts.token as `0x${string}`, l.contracts.hook as `0x${string}`).catch(() => null); if (pool) patchLaunch({ pool }); }
          const checks = await verifyShift(l.contracts);
          saveVerification(checks);
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
          json(res, 200, { ok: true });
          setTimeout(() => { void engine.store.flush().finally(() => process.exit(0)); }, 400);
          return;
        }
        return json(res, 404, { error: "not found" });
      }

      const owner = engine.auth.owner(req);

      // ---- the landing page's live numbers: real where they can be, labelled where simulated
      if (p === "/api/landing") return json(res, 200, await landing(engine));
      if (p === "/api/impact") return json(res, 200, await impact(engine));
      if (p === "/api/frogs/staking") {
        const w = new URL(req.url ?? "/", config.publicUrl).searchParams.get("wallet") ?? "";
        return json(res, 200, { board: stakingBoard(20), me: /^0x[0-9a-fA-F]{40}$/.test(w) ? stakingOf(w) : null });
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
        if (req.method === "GET") return json(res, 200, engine.auth.listKeys(owner));
        if (req.method === "POST") { const b = await body(req); return json(res, 201, engine.auth.createKey(owner, String(b.label ?? "MCP"))); }
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
        const list = await Promise.all([...engine.store.companies.values()].filter((c) => !onlyMine || (owner !== null && c.owner === owner)).sort((a, b) => b.createdAt - a.createdAt).map(async (c) => {
          const v = publicView(engine, c);
          const working = c.tasks.find((t) => ["checking", "ordering", "building", "awaiting_approval"].includes(t.status));
          return { id: c.id, ...v, nextShiftAt: c.nextShiftAt, working: working ? { title: working.title, status: working.status, activity: working.activity } : null };
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
          if (!product || !engine.files.has(product)) return json(res, 409, { error: "Not packaged yet." });
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
        if (!engine.files.has(product)) return json(res, 409, { error: "This product is being packaged. Try again in a few minutes." });
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
        const v = await verifyPayment(payment, req402);
        if (!v.ok) return json(res, 402, challenge(req402, resource, v.reason), { "PAYMENT-REQUIRED": encodeHeader(challenge(req402, resource, v.reason)) });
        if (config.mode === "sim") return json(res, 400, { error: "sim mode does not settle real payments" });
        // Settling costs the company gas: limit it per caller and per payer, check the payer can
        // actually pay, and settle one payment at a time per company.
        if (limited(req, "settle", 6, 60_000) || limited(req, `settle-payer:${v.payer.toLowerCase()}`, 3, 60_000)) return json(res, 429, { error: "Too many payments at once; try again in a minute." });
        const value = BigInt(payment.payload.authorization.value);
        const bal = await sales.readContract({ address: USDC[config.salesChainId]!.address, abi: erc20Abi, functionName: "balanceOf", args: [v.payer as `0x${string}`] }).catch(() => 0n);
        if (bal < value) return json(res, 402, challenge(req402, resource, "insufficient USDC balance"), { "PAYMENT-REQUIRED": encodeHeader(challenge(req402, resource, "insufficient USDC balance")) });
        const account = engine.vault.account(c.id);
        const prev = settling.get(c.id) ?? Promise.resolve();
        const run = prev.catch(() => {}).then(() => settlePayment(payment, salesWallet(account) as never, sales as never, account));
        settling.set(c.id, run.catch(() => {}));
        const tx = await run;
        await engine.recordSale(c, product.id, BigInt(payment.payload.authorization.value), v.payer, tx, false);
        return json(res, 200, { ok: true, tx, deliverable: engine.files.link(c, product, tx) }, { "PAYMENT-RESPONSE": encodeHeader({ success: true, transaction: tx, network: req402.network, payer: v.payer }) });
      }

      // A bought product: signed per sale, valid for a week.
      if (seg[0] === "download" && seg[1] && seg[2] && seg[3] && seg[4]) {
        const c = engine.get(seg[1]);
        const product = c?.products.find((x) => x.id === seg[2]);
        const ref = url.searchParams.get("ref") ?? "";
        if (!c || !product || !engine.files.check(product.id, seg[3], seg[4], ref)) return json(res, 403, { error: "This download link is invalid or has expired." });
        const text = engine.files.read(product);
        if (text === null) return json(res, 404, { error: "not packaged yet" });
        res.writeHead(200, { "Content-Type": "text/markdown; charset=utf-8", "Content-Disposition": `attachment; filename="${c.slug}-${product.id}.md"`, "Cache-Control": "private, no-store" });
        return res.end(text);
      }

      // Sim deliveries: the page and files the simulated swarm "built".
      if (seg[0] === "sites" && seg[1]) {
        const id = engine.sim.sites.get(seg[1]) ?? [...engine.store.companies.values()].find((x) => x.site?.jobId === seg[1] || x.tasks.some((t) => t.imd?.jobId === seg[1]))?.id;
        const c = id ? engine.store.companies.get(id) : undefined;
        if (!c) return json(res, 404, { error: "no such site" });
        // one visit per visitor per 10 minutes, and a bounded history
        if (!limited(req, `visit:${c.id}`, 1, 600_000)) { const v = engine.store.metricsOf(c.id).visits; v.push(Date.now()); if (v.length > 5000) v.splice(0, v.length - 5000); }
        res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
        return res.end(engine.sim.site(c));
      }
      if (seg[0] === "files" && seg[1] && seg[2] && config.mode === "sim") {
        const text = engine.sim.file(seg[1], seg[2]);
        if (text === null) return json(res, 404, { error: "no such file" });
        res.writeHead(200, { "Content-Type": "text/markdown; charset=utf-8" });
        return res.end(text);
      }

      if (req.method === "GET" && serveStatic(res, p)) return;
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
