import { existsSync, readFileSync, statSync } from "node:fs";
import { type IncomingMessage, type ServerResponse, createServer } from "node:http";
import { extname, join, normalize } from "node:path";
import type { Company } from "@nightshift/core";
import { fromImd, fromUsdc } from "@nightshift/core";
import { type PaymentPayload, challenge, decodeHeader, encodeHeader, requirement, settlePayment, verifyPayment } from "@nightshift/x402";
import { balances, sales, salesWallet } from "./chain.js";
import { config } from "./config.js";
import type { Engine } from "./engine.js";

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
    try {
      if (p === "/api/health") return json(res, 200, { ok: true, mode: config.mode, llm: Boolean(engine.llm), model: config.model, imdUsd: config.imdUsd, salesChainId: config.salesChainId, generatedSecret: engine.vault.generatedSecret });

      // Live events: every task step, journal line and sale, as it happens.
      if (p === "/api/events") {
        res.writeHead(200, { "Content-Type": "text/event-stream", "Cache-Control": "no-cache", Connection: "keep-alive" });
        res.write(": ok\n\n");
        const only = url.searchParams.get("company");
        const off = engine.on((e) => {
          if (only && e.companyId !== only) return;
          res.write(`data: ${JSON.stringify(e, (_k, v) => (typeof v === "bigint" ? v.toString() : v))}\n\n`);
        });
        const ping = setInterval(() => res.write(": ping\n\n"), 20_000);
        req.on("close", () => { off(); clearInterval(ping); });
        return;
      }

      if (p === "/api/companies" && req.method === "GET") {
        const list = await Promise.all([...engine.store.companies.values()].sort((a, b) => b.createdAt - a.createdAt).map(async (c) => {
          const v = publicView(engine, c);
          const working = c.tasks.find((t) => ["checking", "ordering", "building", "awaiting_approval"].includes(t.status));
          return { id: c.id, ...v, nextShiftAt: c.nextShiftAt, working: working ? { title: working.title, status: working.status, activity: working.activity } : null };
        }));
        return json(res, 200, list);
      }
      if (p === "/api/companies" && req.method === "POST") {
        const b = await body(req);
        const c = await engine.create(String(b.idea ?? ""), (b.policy ?? {}) as never, typeof b.owner === "string" ? b.owner : null);
        return json(res, 201, { id: c.id, slug: c.slug });
      }
      if (seg[0] === "api" && seg[1] === "companies" && seg[2]) {
        const c = engine.get(seg[2]);
        if (!c) return json(res, 404, { error: "no such company" });
        const action = seg[3];
        if (!action && req.method === "GET") return json(res, 200, await full(engine, c));
        if (action === "wallet") {
          if (config.mode === "sim") return json(res, 200, { address: c.wallet, mode: "sim" });
          const b = await balances(c.wallet);
          return json(res, 200, { address: c.wallet, mode: "live", eth: b.eth, imd: b.imd, usdc: b.usdc, saleGas: b.saleGas });
        }
        if (req.method !== "POST") return json(res, 405, { error: "method" });
        if (action === "shift") { await engine.shiftNow(c); return json(res, 200, { ok: true }); }
        if (action === "policy") { engine.setPolicy(c, (await body(req)) as never); return json(res, 200, c.policy); }
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
        const req402 = requirement(config.salesChainId, c.wallet, product.priceUsdc);
        const resource = { url: `${config.publicUrl}/buy/${c.slug}/${product.id}`, description: `${product.name}: ${product.pitch}`, mimeType: "application/json" };
        const sig = req.headers["payment-signature"] ?? req.headers["x-payment"];
        if (config.mode === "sim" && url.searchParams.get("sim") === "1" && req.method === "POST") {
          await engine.recordSale(c, product.id, product.priceUsdc, "0xdemo000000000000000000000000000000buyer", null, true);
          return json(res, 200, { ok: true, sim: true, deliverable: product.deliverableUrl });
        }
        if (!sig || Array.isArray(sig)) {
          const ch = challenge(req402, resource, "payment required");
          return json(res, 402, ch, { "PAYMENT-REQUIRED": encodeHeader(ch) });
        }
        const payment = decodeHeader<PaymentPayload>(sig);
        const v = await verifyPayment(payment, req402);
        if (!v.ok) return json(res, 402, challenge(req402, resource, v.reason), { "PAYMENT-REQUIRED": encodeHeader(challenge(req402, resource, v.reason)) });
        if (config.mode === "sim") return json(res, 400, { error: "sim mode does not settle real payments" });
        const account = engine.vault.account(c.id);
        const tx = await settlePayment(payment, salesWallet(account) as never, sales as never, account);
        await engine.recordSale(c, product.id, BigInt(payment.payload.authorization.value), v.payer, tx, false);
        return json(res, 200, { ok: true, tx, deliverable: product.deliverableUrl }, { "PAYMENT-RESPONSE": encodeHeader({ success: true, transaction: tx, network: req402.network, payer: v.payer }) });
      }

      // Sim deliveries: the page and files the simulated swarm "built".
      if (seg[0] === "sites" && seg[1]) {
        const id = engine.sim.sites.get(seg[1]) ?? [...engine.store.companies.values()].find((x) => x.site?.jobId === seg[1] || x.tasks.some((t) => t.imd?.jobId === seg[1]))?.id;
        const c = id ? engine.store.companies.get(id) : undefined;
        if (!c) return json(res, 404, { error: "no such site" });
        engine.store.metricsOf(c.id).visits.push(Date.now());
        res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
        return res.end(engine.sim.site(c));
      }
      if (seg[0] === "files" && seg[1] && seg[2]) {
        const text = engine.sim.file(seg[1], seg[2]);
        if (text === null) return json(res, 404, { error: "no such file" });
        res.writeHead(200, { "Content-Type": "text/markdown; charset=utf-8" });
        return res.end(text);
      }

      if (req.method === "GET" && serveStatic(res, p)) return;
      return json(res, 404, { error: "not found" });
    } catch (err) {
      console.error(err);
      return json(res, 400, { error: (err as Error).message });
    }
  });
  server.listen(config.port, () => console.log(`NIGHTSHIFT engine on ${config.publicUrl} (${config.mode} mode${engine.llm ? `, CEO model ${config.model}` : ", playbook CEO: set OPENROUTER_API_KEY for the model"})`));
  return server;
}
