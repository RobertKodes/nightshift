import type { IncomingMessage, ServerResponse } from "node:http";
import { type PaymentPayload, type Requirement, challenge as challenge402, encodeHeader, requirement } from "@nightshift/x402";
import type { Address } from "viem";
import { DailyQuota, Gate, TtlCache } from "./cache.js";
import { OFFERS, type Offer, type OfferId, bazaarOf, offer, openapi, usdOf } from "./catalog.js";
import { type Ctx, RUN_BY } from "./context.js";
import { type Feed, feed } from "./feed.js";
import { type HookReport, KNOWN_HOOKS, decodeFlags, inspectHook } from "./hook.js";
import { chainIdOf, hookOf, launchUrl, tokenOf } from "./imd.js";
import { type VerdictReport, ServiceError, tokenVerdict } from "./verdict.js";

/**
 * The house services over HTTP: /api/v1/verdict, /api/v1/hook, /api/v1/imd/* and /openapi.json.
 * Paid calls follow x402 v2 like every product on NIGHTSHIFT: no payment → 402 with the terms;
 * a signed payment is checked, the answer is computed (a failure is never charged), then the
 * payment is settled on Base and the answer returned with the settlement.
 */
export interface Payer {
  mode: "sim" | "live";
  chainId: number;
  /** Where the money goes: the house company's wallet. Null until the house company exists. */
  payTo(): Address | null;
  /** The signed payment checked against this offer: signature, amount, the payer's USDC and the house's gas. */
  check(o: Offer, header: string, ip: string): Promise<{ ok: true; payment: PaymentPayload; payer: string } | { ok: false; status: number; reason: string; challenge?: boolean }>;
  /** Settles on Base and books the sale; throws PendingError while the settlement is on its way. */
  settle(o: Offer, payment: PaymentPayload): Promise<`0x${string}`>;
  /** A demo sale (sim mode only): booked as simulated, no money moves. */
  sim(o: Offer): Promise<void>;
  isPending(e: unknown): boolean;
}

export type Io = { method: string; path: string; query: URLSearchParams; header(name: string): string | undefined; ip: string; base: string; limited(key: string, n: number, ms: number): boolean };
export type Out = { status: number; body: unknown; headers?: Record<string, string> };

export function services(ctx: Ctx, payer: Payer) {
  const verdicts = new TtlCache<VerdictReport>(10 * 60_000, 2_000, ctx.d.now);
  const hooks = new TtlCache<HookReport>(30 * 60_000, 1_000, ctx.d.now);
  const previews = new TtlCache<unknown>(5 * 60_000, 2_000, ctx.d.now);
  const gate = new Gate(4);
  const demo = new DailyQuota(1, ctx.d.now);
  const imd: Feed = feed(ctx);

  const fresh = <T extends object>(r: { v: T; at: number; hit: boolean }): T & { cached: boolean; dataAgeSeconds: number } => ({ ...r.v, cached: r.hit, dataAgeSeconds: Math.round((ctx.d.now() - r.at) / 1000) });
  const verdict = async (chain: string, token: string, depth: "quick" | "deep") => {
    const k = `${chain.toLowerCase()}:${token.toLowerCase()}:${depth}`;
    if (verdicts.peek(k)) return fresh(await verdicts.get(k, () => Promise.reject(new Error("unreachable"))));
    return fresh(await gate.run(() => verdicts.get(k, () => tokenVerdict(ctx, chain, token, depth))));
  };
  const hook = async (address: string, explain: boolean) => {
    if (!/^0x[0-9a-fA-F]{40}$/.test(address)) throw new ServiceError(400, "The hook must be a 0x address (40 hex characters).");
    const k = `${address.toLowerCase()}:${explain ? 1 : 0}`;
    if (hooks.peek(k)) return fresh(await hooks.get(k, () => Promise.reject(new Error("unreachable"))));
    return fresh(await gate.run(() => hooks.get(k, () => inspectHook(ctx, address.toLowerCase() as Address, explain))));
  };

  /** Free: what is cheap to know before paying (IMD match, market, copycat, hook bits), never the verdict. */
  async function preview(chain: string, token: string): Promise<unknown> {
    if (chainIdOf(chain) !== 1) throw new ServiceError(400, "Only Ethereum is supported for now.");
    if (!/^0x[0-9a-fA-F]{40}$/.test(token)) throw new ServiceError(400, "The token must be a 0x address (40 hex characters).");
    const t = token.toLowerCase();
    return (await previews.get(t, async () => {
      const [hit, m] = await Promise.all([ctx.imd.launchOf(1, t).catch(() => null), ctx.market.marketOf(1, t as Address).catch(() => null)]);
      const l = hit?.launch;
      const p = l?.seeded?.pools?.find((x) => x.currency0.toLowerCase() === t || x.currency1.toLowerCase() === t);
      const best = m?.best;
      const sym = best?.baseToken.address.toLowerCase() === t ? best.baseToken.symbol : null;
      const same = sym ? (await ctx.imd.sameSymbol(1, sym).catch(() => [])).filter((x) => tokenOf(x)?.address.toLowerCase() !== t).map((x) => x.launchNumber) : [];
      const hk = p?.hooks.toLowerCase();
      return {
        service: "token-verdict", runBy: RUN_BY, preview: true, chain: "ethereum", token: t,
        imd: l ? { isLaunch: hit!.artifact.role === "token", role: hit!.artifact.role, launchNumber: l.launchNumber, kind: l.kind, status: l.status, createdAt: l.createdAt, url: launchUrl(l) } : { isLaunch: false },
        market: best ? { symbol: sym, priceUsd: best.priceUsd ? Number(best.priceUsd) : null, liquidityUsd: best.liquidity?.usd ?? null, volume24hUsd: best.volume?.h24 ?? null, pair: best.url, dex: `${best.dexId}${best.labels?.length ? ` ${best.labels.join("/")}` : ""}` } : null,
        sameSymbolLaunches: same,
        hook: hk && hk !== "0x0000000000000000000000000000000000000000" ? { address: hk, flags: decodeFlags(hk).hex, template: KNOWN_HOOKS[hk]?.template ?? (l && hookOf(l)?.address.toLowerCase() === hk ? hookOf(l)!.name : null) } : null,
        verdict: null, next: { quick: `/api/v1/verdict/ethereum/${t}?depth=quick`, deep: `/api/v1/verdict/ethereum/${t}?depth=deep`, demo: `/api/v1/verdict/ethereum/${t}?depth=quick&demo=1` },
        note: "A free preview: no verdict. The verdict ($0.02 quick, $0.25 deep) adds verified source, owner powers, holders, a buy-then-sell simulation and the reasons with their evidence. One quick verdict per IP per day is free with demo=1.",
        generatedAt: new Date(ctx.d.now()).toISOString(),
      };
    })).v;
  }

  /** Free: a hook's permission bits from its address, and a known-template match. */
  function flags(address: string) {
    if (!/^0x[0-9a-fA-F]{40}$/.test(address)) throw new ServiceError(400, "The hook must be a 0x address (40 hex characters).");
    const a = address.toLowerCase();
    const k = KNOWN_HOOKS[a];
    return { service: "hook-inspector", runBy: RUN_BY, preview: true, address: a, flags: decodeFlags(a), template: k ? { name: k.template, by: k.by, note: k.note, match: "exact address" } : null,
      note: "Free: the bits say which callbacks the PoolManager will ever call. The paid inspection ($0.05) reads the code: what each callback does, fees, owner powers, upgrades. explain=1 ($0.50) adds a written explanation with the source lines." };
  }

  const terms = (o: Offer): Requirement | null => { const to = payer.payTo(); return to ? requirement(payer.chainId, to, o.priceUsdc) : null; };
  function challengeOf(o: Offer, io: Io, error?: string) {
    const req = terms(o);
    if (!req) return null;
    return { ...challenge402(req, { url: `${io.base}${io.path}${io.query.toString() ? `?${io.query}` : ""}`, description: o.description, mimeType: "application/json" }, error), extensions: bazaarOf(o), runBy: RUN_BY, priceUsd: usdOf(o) };
  }
  const p402 = (o: Offer, io: Io, error: string): Out => {
    const ch = challengeOf(o, io, error);
    if (!ch) return { status: 503, body: { error: "The house services cannot take payments yet." } };
    return { status: 402, body: ch, headers: { "PAYMENT-REQUIRED": encodeHeader(ch) } };
  };

  /** The paid door: terms, check, compute, settle. */
  async function paid(io: Io, o: Offer, run: () => Promise<unknown>): Promise<Out> {
    if (payer.mode === "sim" && io.query.get("sim") === "1") {
      const v = await run();
      await payer.sim(o);
      return { status: 200, body: { ...(v as object), payment: { sim: true, priceUsd: usdOf(o), note: "Simulation: a demo sale was booked and no money moved." } } };
    }
    const sig = io.header("payment-signature") ?? io.header("x-payment");
    if (!sig) return p402(o, io, "payment required");
    const c = await payer.check(o, sig, io.ip);
    if (!c.ok) return c.challenge ? p402(o, io, c.reason) : { status: c.status, body: { error: c.reason } };
    if (payer.mode === "sim") return { status: 400, body: { error: "sim mode does not settle real payments; add sim=1 for a demo answer" } };
    const v = await run();
    let tx: `0x${string}`;
    try { tx = await payer.settle(o, c.payment); } catch (e) {
      if (payer.isPending(e)) return { status: 202, body: { ok: false, pending: true, error: (e as Error).message } };
      throw e;
    }
    const network = `eip155:${payer.chainId}`;
    return { status: 200, body: { ...(v as object), payment: { tx, network, priceUsd: usdOf(o), payer: c.payer } }, headers: { "PAYMENT-RESPONSE": encodeHeader({ success: true, transaction: tx, network, payer: c.payer }) } };
  }

  /** One request. Null: not a services path. */
  async function handle(io: Io): Promise<Out | null> {
    const seg = io.path.split("/").filter(Boolean); // api v1 …
    if (io.path === "/openapi.json" || io.path === "/api/v1/openapi.json") return { status: 200, body: openapi(io.base, payer.chainId, payer.payTo()) };
    if (seg[0] !== "api" || seg[1] !== "v1") return null;
    if (io.method !== "GET" && io.method !== "HEAD") return { status: 405, body: { error: "GET only" } };
    try {
      if (seg[2] === "services" && !seg[3]) {
        if (io.limited("svc-free", 120, 60_000)) return { status: 429, body: { error: "slow down" } };
        return { status: 200, body: {
          provider: "NIGHTSHIFT Services", runBy: RUN_BY, house: true, x402Version: 2, network: `eip155:${payer.chainId}`, payTo: payer.payTo(), mode: payer.mode,
          offers: OFFERS.map((o) => ({ id: o.id, name: o.name, priceUsd: usdOf(o), route: `${io.base}${o.route}`, example: `${io.base}${o.example}`, page: `${io.base}${o.page}`, description: o.description, accepts: terms(o) ? [terms(o)] : [] })),
          free: { verdictPreview: `${io.base}/api/v1/verdict/ethereum/<token>/preview`, verdictDemo: "one quick verdict per IP per day: add demo=1", hookFlags: `${io.base}/api/v1/hook/<address>/flags`, feedSample: "add sample=1 to any /api/v1/imd/* call" },
          mcp: `${io.base}/mcp/public`, openapi: `${io.base}/openapi.json`,
        } };
      }
      // ---- Token Verdict
      if (seg[2] === "verdict" && seg[3] && seg[4]) {
        if (seg[5] === "preview") {
          if (io.limited("svc-free", 120, 60_000)) return { status: 429, body: { error: "slow down" } };
          return { status: 200, body: await preview(seg[3], seg[4]) };
        }
        if (seg[5]) return { status: 404, body: { error: "not found" } };
        if (io.limited("svc-verdict", 60, 60_000)) return { status: 429, body: { error: "slow down: 60 verdicts a minute per IP" } };
        const depth = io.query.get("depth") === "deep" ? "deep" : "quick";
        if (io.query.get("depth") && !["quick", "deep"].includes(io.query.get("depth")!)) return { status: 400, body: { error: "depth is quick or deep" } };
        if (chainIdOf(seg[3]) !== 1) return { status: 400, body: { error: "Only Ethereum is supported for now: /api/v1/verdict/ethereum/<token>." } };
        if (!/^0x[0-9a-fA-F]{40}$/.test(seg[4])) return { status: 400, body: { error: "The token must be a 0x address (40 hex characters)." } };
        const o = offer(depth === "deep" ? "token-verdict-deep" : "token-verdict-quick");
        if (io.query.get("demo") === "1") {
          if (depth !== "quick") return { status: 400, body: { error: "The free demo is a quick verdict: drop depth=deep." } };
          if (!demo.take(io.ip)) {
            const ch = challengeOf(o, io, "free demo used today");
            return { status: 429, body: { error: "Your free verdict for today is used. Pay $0.02 per verdict over x402 (USDC on Base), or come back tomorrow.", nextFreeAt: new Date(demo.resetsAt()).toISOString(), payment: ch }, headers: ch ? { "PAYMENT-REQUIRED": encodeHeader(ch) } : {} };
          }
          return { status: 200, body: { ...(await verdict(seg[3], seg[4], "quick")), demo: { free: true, left: demo.left(io.ip), nextFreeAt: new Date(demo.resetsAt()).toISOString() } } };
        }
        return await paid(io, o, () => verdict(seg[3]!, seg[4]!, depth));
      }
      // ---- Hook Inspector
      if (seg[2] === "hook" && seg[3]) {
        if (seg[4] === "flags") {
          if (io.limited("svc-free", 120, 60_000)) return { status: 429, body: { error: "slow down" } };
          return { status: 200, body: flags(seg[3]) };
        }
        if (seg[4]) return { status: 404, body: { error: "not found" } };
        if (io.limited("svc-hook", 60, 60_000)) return { status: 429, body: { error: "slow down: 60 inspections a minute per IP" } };
        if (!/^0x[0-9a-fA-F]{40}$/.test(seg[3])) return { status: 400, body: { error: "The hook must be a 0x address (40 hex characters)." } };
        const explain = io.query.get("explain") === "1";
        return await paid(io, offer(explain ? "hook-inspector-explained" : "hook-inspector"), () => hook(seg[3]!, explain));
      }
      // ---- IMD Data Feed
      if (seg[2] === "imd" && seg[3]) {
        const sample = io.query.get("sample") === "1";
        if (io.limited(sample ? "svc-sample" : "svc-feed", sample ? 60 : 300, 60_000)) return { status: 429, body: { error: "slow down" } };
        const run = (): Promise<unknown> | null =>
          seg[3] === "launches" && !seg[4] ? imd.launches(io.query, sample)
          : seg[3] === "launches" && seg[4] && !seg[5] ? imd.launch(seg[4], sample)
          : seg[3] === "tokens" && !seg[4] ? imd.tokens(io.query, sample)
          : seg[3] === "swarm" && !seg[4] ? imd.swarm(io.query, sample)
          : seg[3] === "agents" && seg[4] && !seg[5] ? imd.agent(seg[4], io.query, sample)
          : null;
        const known = ["launches", "tokens", "swarm", "agents"].includes(seg[3]) && !(seg[3] === "agents" && !seg[4]);
        if (!known) return { status: 404, body: { error: "IMD feed endpoints: launches, launches/<n>, tokens, swarm, agents/<seat>" } };
        if (sample) { const p = run(); return p ? { status: 200, body: await p } : { status: 404, body: { error: "not found" } }; }
        return await paid(io, offer("imd-feed"), async () => { const p = run(); if (!p) throw new ServiceError(404, "not found"); return p; });
      }
      return { status: 404, body: { error: "not found", see: `${io.base}/api/v1/services` } };
    } catch (e) {
      const st = e instanceof ServiceError ? e.status : (e as { status?: number }).status;
      if (typeof st === "number") return { status: st, body: { error: (e as Error).message } };
      console.error("services", e);
      return { status: 503, body: { error: "A source did not answer (IMD, DexScreener, Sourcify or the Ethereum nodes). Nothing was charged; try again in a minute." } };
    }
  }

  return { handle, verdict, hook, preview, flags, imd, paidCall: paid, challengeOf, demo, terms };
}
export type Services = ReturnType<typeof services>;

// ---------------------------------------------------------------- the server's one instance

let live: Services | null = null;
let makeLive: (() => Services) | null = null;
/** Set once at startup (server.ts): the live readers and the house company's payer. */
export function useServices(make: () => Services): void { makeLive = make; live = null; }
export function liveServices(): Services | null { if (!live && makeLive) live = makeLive(); return live; }

const CORS = { "Access-Control-Allow-Origin": "*", "Access-Control-Expose-Headers": "PAYMENT-REQUIRED, PAYMENT-RESPONSE", "Access-Control-Allow-Headers": "PAYMENT-SIGNATURE, X-PAYMENT, Content-Type", "Access-Control-Allow-Methods": "GET, OPTIONS" };

/** The hook line in server.ts: answers /api/v1/* and /openapi.json. */
export async function serviceRoutes(req: IncomingMessage, res: ServerResponse, p: string, ctx: { url: URL; base: string; ip: string; limited(req: IncomingMessage, key: string, n: number, ms: number): boolean }): Promise<boolean> {
  if (!p.startsWith("/api/v1/") && p !== "/openapi.json") return false;
  const s = liveServices();
  if (!s) return false;
  if (req.method === "OPTIONS") { res.writeHead(204, CORS); res.end(); return true; }
  const h = (n: string) => { const v = req.headers[n.toLowerCase()]; return Array.isArray(v) ? v[0] : v; };
  const out = await s.handle({ method: req.method ?? "GET", path: p, query: ctx.url.searchParams, header: h, ip: ctx.ip, base: ctx.base, limited: (k, n, ms) => ctx.limited(req, k, n, ms) });
  if (!out) return false;
  const body = JSON.stringify(out.body, (_k, v) => (typeof v === "bigint" ? v.toString() : v));
  res.writeHead(out.status, { "Content-Type": "application/json", "Cache-Control": "no-store", ...CORS, ...(out.headers ?? {}) });
  res.end(req.method === "HEAD" ? undefined : body);
  return true;
}

export type { OfferId };
