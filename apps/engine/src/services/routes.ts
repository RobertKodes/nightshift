import { PaymentRequests, requestDigest } from "./payment-requests.js";
import { saleKey } from "../checkout.js";
import type { IncomingMessage, ServerResponse } from "node:http";
import { type Offer as X402Offer, type PaymentPayload, type Requirement, challenge as challenge402, encodeHeader, requirement } from "@nightshift/x402";
import type { Address } from "viem";
import { a2a } from "./a2a.js";
import { type FastDeps, fastTools } from "./fast-tools.js";
import { feedInput } from "./feed-input.js";
import { fastInput, isFastId } from "./fast-input.js";
import { DailyQuota, Gate, TtlCache } from "./cache.js";
import { HOLDER_RULE, OFFERS, type Offer, type OfferId, bazaarOf, holderPriceOf, offer, openapi, usdOf } from "./catalog.js";
import { type Ctx, RUN_BY } from "./context.js";
import { type Feed, feed } from "./feed.js";
import { type HookReport, KNOWN_HOOKS, decodeFlags, inspectHook } from "./hook.js";
import { tokenBasics } from "./evm.js";
import { chainIdOf, hookOf, launchUrl, tokenOf } from "./imd.js";
import { type VerdictReport, ServiceError, tokenVerdict } from "./verdict.js";
import { parseTarget } from "../crews/buildcheck.js";
import type { Watchtower } from "../watchtower/index.js";
import { researchQuestion } from "../crews/research.js";
import type { SwarmInput } from "../crews/swarm-kinds.js";
import { SwarmError, type SwarmDesk } from "../crews/swarm.js";

/**
 * The house services over HTTP: /api/v1/verdict, /api/v1/hook, /api/v1/imd/* and /openapi.json.
 * Paid calls follow x402 v2 like every product on NIGHTSHIFT: no payment → 402 with the terms;
 * a signed payment is checked, the answer is computed and saved, then the
 * payment is settled on Base and the answer returned with the settlement. Swarm Desk settles first,
 * then orders the checked IMD work and records a refund owed if ordering fails.
 */
export interface Payer {
  requests?: PaymentRequests;
  mode: "sim" | "live";
  chainId: number;
  /** Where the money goes: the house company's wallet. Null until the house company exists. */
  payTo(): Address | null;
  /** The signed payment checked against this offer: signature, amount, the payer's USDC and the house's gas. */
  check(o: Offer, header: string, ip: string): Promise<{ ok: true; payment: PaymentPayload; payer: string } | { ok: false; status: number; reason: string; challenge?: boolean }>;
  /**
   * Settles on Base and books the sale; throws PendingError while the settlement is on its way.
   * `terms` is exactly what this call's 402 advertised (requirement, resource, bazaar extension): the
   * CDP facilitator settles against it, which is also what lists the service in the Bazaar.
   */
  settle(o: Offer, payment: PaymentPayload, terms?: SettleTerms): Promise<`0x${string}`>;
  /** A demo sale (sim mode only): booked as simulated, no money moves. */
  sim(o: Offer): Promise<void>;
  isPending(e: unknown): boolean;
  /** Does this wallet get the holder price (HOLDER_RULE)? Without it, nobody does. */
  holder?(wallet: string): Promise<boolean>;
}

/** What a paid call's 402 advertised, handed to the facilitator with the payment. */
export type SettleTerms = X402Offer;

export type Io = { method: string; path: string; query: URLSearchParams; header(name: string): string | undefined; ip: string; base: string; limited(key: string, n: number, ms: number): boolean };
export type Out = { status: number; body: unknown; headers?: Record<string, string> };
export type PaidRecord = { payer: string; nonce: string; usd: number; tx: string | null; network: string; ok: boolean; summary?: string; error?: string; sim?: boolean; kind?: string; pending?: boolean; costUsd?: number };

/**
 * What the house crews add to the router: the Research Desk and Build & Check answers, and the job
 * ledger every paid call is recorded in. Optional, so the services run (and test) without them.
 */
export type CrewDeps = {
  fast?: FastDeps;
  research?(q: string): Promise<unknown>;
  buildCheck?(url: string): Promise<unknown>;
  record?(o: Offer, r: PaidRecord): void;
  swarm?: SwarmDesk;
  watchtower?: Watchtower;
  /** The bot link that turns on a watch's Telegram alerts. */
  telegramLink?(code: string): string | null;
};

export function services(ctx: Ctx, payer: Payer, crews: CrewDeps = {}) {
  const requests = payer.requests ?? new PaymentRequests(new Map(), async () => {}, ctx.d.now);
  const verdicts = new TtlCache<VerdictReport>(10 * 60_000, 2_000, ctx.d.now);
  const hooks = new TtlCache<HookReport>(30 * 60_000, 1_000, ctx.d.now);
  const previews = new TtlCache<unknown>(5 * 60_000, 2_000, ctx.d.now);
  const gate = new Gate(4);
  const demo = new DailyQuota(1, ctx.d.now);
  const imd: Feed = feed(ctx);
  const fast = fastTools(ctx, crews.fast);

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
      // the symbol from the chain: DexScreener lists few launch tokens
      const sym = (await tokenBasics(ctx.d.rpc, t as Address).catch(() => null))?.symbol ?? (best?.baseToken.address.toLowerCase() === t ? best.baseToken.symbol : null);
      const same = sym ? (await ctx.imd.sameSymbol(1, sym).catch(() => [])).filter((x) => tokenOf(x)?.address.toLowerCase() !== t).map((x) => x.launchNumber) : [];
      const hk = p?.hooks.toLowerCase();
      return {
        service: "token-verdict", runBy: RUN_BY, preview: true, chain: "ethereum", token: t,
        imd: l ? { isLaunch: hit!.artifact.role === "token", role: hit!.artifact.role, launchNumber: l.launchNumber, kind: l.kind, status: l.status, createdAt: l.createdAt, url: launchUrl(l) } : { isLaunch: false },
        market: best ? { symbol: sym, priceUsd: best.priceUsd ? Number(best.priceUsd) : null, liquidityUsd: best.liquidity?.usd ?? null, volume24hUsd: best.volume?.h24 ?? null, pair: best.url, dex: `${best.dexId}${best.labels?.length ? ` ${best.labels.join("/")}` : ""}` } : null,
        sameSymbolLaunches: same,
        hook: hk && hk !== "0x0000000000000000000000000000000000000000" ? { address: hk, flags: decodeFlags(hk).hex, template: KNOWN_HOOKS[hk]?.template ?? (l && hookOf(l)?.address.toLowerCase() === hk ? hookOf(l)!.name : null) } : null,
        verdict: null, next: { quick: `/api/v1/verdict/ethereum/${t}?depth=quick`, deep: `/api/v1/verdict/ethereum/${t}?depth=deep`, demo: `/api/v1/verdict/ethereum/${t}?depth=quick&demo=1` },
        note: "A free preview: no verdict. The verdict ($0.01 quick, $0.25 deep) adds verified source, owner powers, holders, a buy-then-sell simulation and the reasons with their evidence. One quick verdict per IP per day is free with demo=1.",
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

  const terms = (o: Offer, price = o.priceUsdc): Requirement | null => { const to = payer.payTo(); return to ? requirement(payer.chainId, to, price) : null; };
  /** The wallet a caller asks the holder price for, if it is one and it qualifies. */
  const holderAsked = async (io: Io): Promise<boolean> => {
    const w = io.query.get("holder") ?? io.header("x-holder-wallet");
    return Boolean(w && /^0x[0-9a-fA-F]{40}$/.test(w) && payer.holder && (await payer.holder(w).catch(() => false)));
  };
  function challengeOf(o: Offer, io: Io, error?: string, holder = false) {
    holder = holder && !o.quoted;
    const req = terms(o, holder ? holderPriceOf(o) : o.priceUsdc);
    if (!req) return null;
    const resource = { url: o.quoted ? `${io.base}/api/v1/swarm/order` : `${io.base}${io.path}${io.query.toString() ? `?${io.query}` : ""}`, description: o.description, mimeType: "application/json", serviceName: "NIGHTSHIFT Services", tags: ["nightshift", o.kind, ...o.id.split("-").slice(0, 2)], ...(io.base.startsWith("https://") ? { iconUrl: `${io.base}/app/icon-512.png` } : {}) };
    return { ...challenge402(req, resource, error), extensions: bazaarOf(o, o.quoted ? "/api/v1/swarm/order" : io.path), runBy: RUN_BY,
      priceUsd: holder ? Number(holderPriceOf(o)) / 1e6 : usdOf(o), holderPrice: holder, holderPriceUsd: Number(holderPriceOf(o)) / 1e6, holders: HOLDER_RULE };
  }
  const p402 = (o: Offer, io: Io, error: string, holder = false): Out => {
    const ch = challengeOf(o, io, error, holder);
    if (!ch) return { status: 503, body: { error: "The house services cannot take payments yet." } };
    return { status: 402, body: ch, headers: { "PAYMENT-REQUIRED": encodeHeader(ch) } };
  };

  /** The paid door: terms, check, compute, settle. */
  async function paid(io: Io, o: Offer, run: (pay: { payer: string; usd: number; key?: string }) => Promise<unknown>, inputs: object = {}, path = io.path, activate?: (v: unknown, tx: string) => unknown): Promise<Out> {
    if (payer.mode === "sim" && io.query.get("sim") === "1") {
      const v = await run({ payer: "0xdemo000000000000000000000000000000buyer", usd: usdOf(o) });
      await payer.sim(o);
      return { status: 200, body: { ...(v as object), payment: { sim: true, priceUsd: usdOf(o), note: "Simulation: a demo sale was booked and no money moved." } } };
    }
    const allowed = o.id.startsWith("token-verdict") ? ["depth", "demo"] : o.id.startsWith("hook-inspector") ? ["explain"] : o.id.startsWith("watchtower") ? ["days"] : o.id === "research-report" ? ["q"] : o.id === "buildcheck-report" ? ["url"] : o.id === "imd-feed" ? ["chain", "kind", "status", "limit", "before", "since", "sample", "indexed"] : null;
    for (const [k, v] of io.query) if (v.length > 2000 || io.query.getAll(k).length !== 1 || (allowed && ![...allowed, "holder", "sim"].includes(k))) throw new ServiceError(400, "Invalid or duplicate input. Nothing was charged.");
    const sig = io.header("payment-signature") ?? io.header("x-payment");
    if (!sig) return p402(o, io, "payment required", await holderAsked(io));
    const c = await payer.check(o, sig, io.ip);
    if (!c.ok) return c.challenge ? p402(o, io, c.reason, await holderAsked(io)) : { status: c.status, body: { error: c.reason } };
    if (payer.mode === "sim") return { status: 400, body: { error: "sim mode does not settle real payments; add sim=1 for a demo answer" } };
    if (isFastId(o.id) && io.limited(`svc-fast-payer:${c.payer.toLowerCase()}`, 300, 60_000)) return { status: 429, body: { error: "slow down: 300 fast tool calls a minute per payer" } };
    const auth = c.payment.payload.authorization, network = `eip155:${payer.chainId}`;
    const key = saleKey(auth.from, auth.nonce);
    return requests.use({ key, companyId: "nightshift-services", productId: o.id, payer: auth.from, value: BigInt(auth.value), at: ctx.d.now(), payTo: payer.payTo() ?? undefined }, requestDigest(io.method, path.replace(/0x[0-9a-fA-F]{40}/g, (a) => a.toLowerCase()), inputs), async (request, keep) => {
      let v: unknown = request.answer ? JSON.parse(request.answer) : undefined;
      try { if (!request.answer) { v = await run({ payer: c.payer, usd: Number(BigInt(auth.value)) / 1e6, key }); await keep("answer", v); } } catch (e) {
        // a failed answer is never settled, so never charged: it still counts against the crew's reliability
        const st = e instanceof ServiceError ? e.status : (e as { status?: number }).status;
        if (!(typeof st === "number" && st < 500)) crews.record?.(o, { payer: c.payer, nonce: auth.nonce, usd: Number(BigInt(auth.value)) / 1e6, tx: null, network, ok: false, error: "a source did not answer; nothing was charged" });
        throw e;
      }
      // the terms this payment was made against: the holder price or the full one, as the payer signed
      const paidHalf = BigInt(c.payment.payload.authorization.value) < o.priceUsdc;
      const ch = challengeOf(o, io, undefined, paidHalf);
      const terms: SettleTerms | undefined = ch ? { requirement: ch.accepts[0]!, resource: ch.resource, extensions: ch.extensions as Record<string, unknown> } : undefined;
      let tx: `0x${string}`;
      try { tx = await payer.settle(o, c.payment, terms); } catch (e) {
        if (payer.isPending(e)) return { status: 202, body: { ok: false, pending: true, error: (e as Error).message } };
        throw e;
      }
      const paidUsd = Number(BigInt(auth.value)) / 1e6;
      crews.record?.(o, { payer: c.payer, nonce: auth.nonce, usd: paidUsd, tx, network, ok: true, summary: `${o.name}: answered and settled` });
      if (activate) v = activate(v, tx);
      const out: Out = { status: 200, body: { ...(v as object), payment: { tx, network, priceUsd: paidUsd, holderPrice: paidUsd < usdOf(o), payer: c.payer } }, headers: { "PAYMENT-RESPONSE": encodeHeader({ success: true, transaction: tx, network, payer: c.payer }) } };
      await keep("response", out);
      return out;
    });
  }

  /** One request. Null: not a services path. */
  async function handle(io: Io): Promise<Out | null> {
    const seg = io.path.split("/").filter(Boolean); // api v1 …
    if (io.path === "/openapi.json" || io.path === "/api/v1/openapi.json") return { status: 200, body: markFree(openapi(io.base, payer.chainId, payer.payTo())) };
    // an unpaid call to a paid route gets the price first, whatever its input, so scanners and agents can read the terms;
    // a paid call with bad input is refused before anything settles
    const bad = (o: Offer, error: string): Out => (io.header("payment-signature") ?? io.header("x-payment")) ? { status: 400, body: { error: `${error} Nothing was charged.` } } : p402(o, io, error);
    if (seg[0] !== "api" || seg[1] !== "v1") return null;
    if (io.method !== "GET" && io.method !== "HEAD") return { status: 405, body: { error: "GET only" } };
    try {
      if (seg[2] === "services" && !seg[3]) {
        if (io.limited("svc-free", 120, 60_000)) return { status: 429, body: { error: "slow down" } };
        return { status: 200, body: {
          provider: "NIGHTSHIFT Services", runBy: RUN_BY, house: true, x402Version: 2, network: `eip155:${payer.chainId}`, payTo: payer.payTo(), mode: payer.mode,
          holders: HOLDER_RULE,
          offers: [...OFFERS].sort((a, b) => Number(Boolean(b.quoted)) - Number(Boolean(a.quoted))).map((o) => ({ id: o.id, name: o.name, pitch: o.pitch, priceUsd: usdOf(o), holderPriceUsd: Number(holderPriceOf(o)) / 1e6, ...(o.quoted ? { priceIsMinimum: true, quote: `${io.base}/api/v1/swarm/quote`, holderDiscount: false } : {}), route: `${io.base}${o.route}`, example: `${io.base}${o.example}`, page: `${io.base}${o.page}`, description: o.description, latency: fast.latency(o.id), accepts: o.quoted ? [] : terms(o) ? [terms(o)] : [] })),
          free: { verdictPreview: `${io.base}/api/v1/verdict/ethereum/<token>/preview`, verdictDemo: "one quick verdict per IP per day: add demo=1", hookFlags: `${io.base}/api/v1/hook/<address>/flags`, feedSample: "add sample=1 to any /api/v1/imd/* call" },
          mcp: `${io.base}/mcp/public`, openapi: `${io.base}/openapi.json`,
        } };
      }
      if (seg[2] && isFastId(seg[2]) && !seg[3]) {
        if (io.method !== "GET") return { status: 405, body: { error: "GET only" } };
        if (io.limited("svc-fast", 300, 60_000)) return { status: 429, body: { error: "slow down: 300 fast tool calls a minute per IP" } };
        const id = seg[2];
        let input: ReturnType<typeof fastInput>;
        try { input = fastInput(id, io.query); } catch (e) { return bad(offer(id), (e as Error).message); }
        return await paid(io, offer(id), () => fast.run(id, input), input);
      }
      if (seg[2] === "swarm") {
        const desk = crews.swarm;
        if (!desk) return { status: 503, body: { error: "Swarm Desk is off in this engine." } };
        if (io.method !== "GET") return { status: 405, body: { error: "GET only" } };
        if (io.limited("svc-swarm", 240, 60_000)) return { status: 429, body: { error: "slow down: 240 Swarm Desk calls a minute per IP" }, headers: { "Retry-After": "60" } };
        if (seg[3] === "stats" && !seg[4]) return { status: 200, body: await desk.stats(), headers: { "Cache-Control": "public, max-age=60" } };
        if (seg[3] === "quote" && !seg[4]) {
          const allowed = ["kind", "brief", "repo", "commit", "chain", "address", "name", "style"];
          for (const [key, value] of io.query) if (!allowed.includes(key) || io.query.getAll(key).length !== 1 || value.length > 2000) throw new SwarmError(400, "Invalid or duplicate Swarm quote parameter.");
          return { status: 200, body: await desk.quote(io.query.get("kind"), io.query.get("brief"), io.query.get("repo"), io.base, Object.fromEntries(["commit", "chain", "address", "name", "style"].map((key) => [key, io.query.get(key)])) as SwarmInput) };
        }
        if (seg[3] === "jobs" && seg[4] && !seg[5]) return { status: 200, body: await desk.job(seg[4], io.query.get("token")) };
        if (seg[3] === "order" && !seg[5]) {
          const id = seg[4] ?? io.query.get("quoteId");
          const signed = io.header("payment-signature") ?? io.header("x-payment");
          if (!id) return signed ? { status: 400, body: { error: "Get a free quote, then pass quoteId. Nothing was charged." } } : p402(offer("swarm-order"), io, "Get a free checked quote at /api/v1/swarm/quote, then pass quoteId. The price here is the minimum, not an executable quote.");
          const o = desk.quotedOffer(id);
          const sig = io.header("payment-signature") ?? io.header("x-payment");
          if (!sig) return p402(o, io, "payment required");
          const c = await payer.check(o, sig, io.ip);
          if (!c.ok) return c.challenge ? p402(o, io, c.reason) : { status: c.status, body: { error: c.reason } };
          if (payer.mode !== "live" || payer.chainId !== 8453) return { status: 503, body: { error: "Swarm Desk requires live USDC payments on Base." } };
          const auth = c.payment.payload.authorization;
          if (BigInt(auth.value) !== o.priceUsdc) return p402(o, io, "Pay the exact quoted price. Swarm Desk has no holder discount.");
          for (const [key, value] of io.query) if (key !== "quoteId" || io.query.getAll(key).length !== 1 || value !== id) throw new SwarmError(400, "Invalid or duplicate Swarm order parameter. Nothing was charged.");
          const ch = challengeOf(o, io)!;
          const key = saleKey(auth.from, auth.nonce);
          return await requests.use({ key, companyId: "nightshift-services", productId: o.id, payer: auth.from, value: BigInt(auth.value), at: ctx.d.now(), payTo: payer.payTo() ?? undefined }, requestDigest(io.method, "/api/v1/swarm/order", { quoteId: id }), async (_request, keep) => {
            const out = await desk.order(id, { payer: c.payer, nonce: auth.nonce, usd: Number(BigInt(auth.value)) / 1e6, network: `eip155:${payer.chainId}`, validBefore: Number(auth.validBefore) }, () => payer.settle(o, c.payment, { requirement: ch.accepts[0]!, resource: ch.resource, extensions: ch.extensions }), (e) => payer.isPending(e));
            const body = out.body as { payment?: { tx?: string } };
            if (body.payment?.tx) out.headers = { ...out.headers, "PAYMENT-RESPONSE": encodeHeader({ success: true, transaction: body.payment.tx, network: `eip155:${payer.chainId}`, payer: c.payer }) };
            if (out.status !== 202) await keep("response", out);
            return out;
          });
        }
        return { status: 404, body: { error: "Swarm Desk routes: quote, order/{quoteId}, jobs/{orderId}?token=" } };
      }
      // ---- Watchtower: what changed since the last observation, once or watched for a prepaid term
      if (seg[2] === "watchtower" && (seg[3] === "check" || seg[3] === "watch") && seg[4] && seg[5] && !seg[6]) {
        const wt = crews.watchtower;
        if (!wt) return { status: 404, body: { error: "Watchtower is not on in this engine." } };
        const wo = offer(seg[3] === "check" ? "watchtower-check" : "watchtower-watch");
        if (chainIdOf(seg[4]) !== 1) return bad(wo, "Only Ethereum is supported: /api/v1/watchtower/" + seg[3] + "/ethereum/<address>.");
        if (!/^0x[0-9a-fA-F]{40}$/.test(seg[5])) return bad(wo, "The address must be a 0x address (40 hex characters).");
        if (io.limited("svc-watch", 30, 60_000)) return { status: 429, body: { error: "slow down: 30 a minute per IP" } };
        const address = seg[5];
        if (seg[3] === "check") return await paid(io, offer("watchtower-check"), () => wt.check(address), { address: address.toLowerCase(), chain: "ethereum" });
        if (io.query.get("days") && io.query.get("days") !== "7") return bad(wo, "days: 7. One prepaid term of 7 days, no renewal.");
        const out = await paid(io, offer("watchtower-watch"), async (pay) => {
          const r = await wt.startWatch({ address, owner: pay.payer, days: 7, payment: { usd: pay.usd, payer: pay.payer, tx: null }, paymentKey: pay.key });
          return { ...r.report, watch: r.watch, manageToken: r.manageToken, telegram: crews.telegramLink?.(r.telegramCode) ?? null, stop: `POST ${io.base}/api/watchtower/watches/${r.watch.id}/stop with the header X-Watch-Token: <manageToken>` };
        }, { address: address.toLowerCase(), chain: "ethereum", days: 7 }, io.path, (v, tx) => {
          const body = v as { watch: { id: string } };
          wt.confirmPayment(body.watch.id, tx);
          return { ...body, watch: wt.getWatch(body.watch.id, { token: (v as { manageToken: string }).manageToken }).watch };
        });
        return out;
      }
      // ---- Research Desk: an evidence report from the IMD swarm's published work
      if (seg[2] === "research" && !seg[3]) {
        if (!crews.research) return { status: 404, body: { error: "The Research Desk is not on in this engine." } };
        if (io.limited("svc-research", 20, 60_000)) return { status: 429, body: { error: "slow down: 20 reports a minute per IP" } };
        let q: ReturnType<typeof researchQuestion>;
        try { q = researchQuestion(io.query.get("q")); } catch (e) { return bad(offer("research-report"), (e as Error).message); }
        return await paid(io, offer("research-report"), () => crews.research!(q), { q });
      }
      // ---- Build & Check: does a public agent service work for other agents?
      if (seg[2] === "buildcheck" && !seg[3]) {
        if (!crews.buildCheck) return { status: 404, body: { error: "Build & Check is not on in this engine." } };
        if (io.limited("svc-buildcheck", 10, 60_000)) return { status: 429, body: { error: "slow down: 10 checks a minute per IP" } };
        let url: string;
        try { url = parseTarget(io.query.get("url")).toString(); } catch (e) { return bad(offer("buildcheck-report"), (e as Error).message); }
        return await paid(io, offer("buildcheck-report"), () => crews.buildCheck!(url), { url });
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
        const o = offer(depth === "deep" ? "token-verdict-deep" : "token-verdict-quick");
        if (io.query.get("depth") && !["quick", "deep"].includes(io.query.get("depth")!)) return bad(o, "depth is quick or deep");
        if (chainIdOf(seg[3]) !== 1) return bad(o, "Only Ethereum is supported for now: /api/v1/verdict/ethereum/<token>.");
        if (!/^0x[0-9a-fA-F]{40}$/.test(seg[4])) return bad(o, "The token must be a 0x address (40 hex characters).");
        if (io.query.get("demo") === "1") {
          if (depth !== "quick") return { status: 400, body: { error: "The free demo is a quick verdict: drop depth=deep." } };
          if (!demo.take(io.ip)) {
            const ch = challengeOf(o, io, "free demo used today");
            return { status: 429, body: { error: "Your free verdict for today is used. Pay $0.01 per verdict over x402 (USDC on Base), or come back tomorrow.", nextFreeAt: new Date(demo.resetsAt()).toISOString(), payment: ch }, headers: ch ? { "PAYMENT-REQUIRED": encodeHeader(ch) } : {} };
          }
          return { status: 200, body: { ...(await verdict(seg[3], seg[4], "quick")), demo: { free: true, left: demo.left(io.ip), nextFreeAt: new Date(demo.resetsAt()).toISOString() } } };
        }
        return await paid(io, o, () => verdict(seg[3]!, seg[4]!, depth), { chain: "ethereum", token: seg[4].toLowerCase(), depth });
      }
      // ---- Hook Inspector
      if (seg[2] === "hook" && seg[3]) {
        if (seg[4] === "flags") {
          if (io.limited("svc-free", 120, 60_000)) return { status: 429, body: { error: "slow down" } };
          return { status: 200, body: flags(seg[3]) };
        }
        if (seg[4]) return { status: 404, body: { error: "not found" } };
        if (io.limited("svc-hook", 60, 60_000)) return { status: 429, body: { error: "slow down: 60 inspections a minute per IP" } };
        const explain = io.query.get("explain") === "1";
        if (!/^0x[0-9a-fA-F]{40}$/.test(seg[3])) return bad(offer(explain ? "hook-inspector-explained" : "hook-inspector"), "The hook must be a 0x address (40 hex characters).");
        return await paid(io, offer(explain ? "hook-inspector-explained" : "hook-inspector"), () => hook(seg[3]!, explain), { address: seg[3].toLowerCase(), explain });
      }
      // ---- IMD Data Feed
      if (seg[2] === "imd" && seg[3]) {
        const sample = io.query.get("sample") === "1";
        if (io.limited(sample ? "svc-sample" : "svc-feed", sample ? 60 : 300, 60_000)) return { status: 429, body: { error: "slow down" } };
        const validPath = (seg[3] === "launches" && !seg[5]) || (["tokens", "swarm"].includes(seg[3]) && !seg[4]) || (seg[3] === "agents" && seg[4] && !seg[5]);
        if (!validPath) return { status: 404, body: { error: "IMD feed endpoints: launches, launches/<n>, tokens, swarm, agents/<seat>" } };
        const input = feedInput(seg[3], Boolean(seg[4]), io.query);
        if (seg[3] === "agents" && !/^\d{1,9}$/.test(seg[4]!)) return bad(offer("imd-feed"), "seat must be a number.");
        const run = (): Promise<unknown> | null =>
          seg[3] === "launches" && !seg[4] ? imd.launches(input, sample)
          : seg[3] === "launches" && seg[4] && !seg[5] ? imd.launch(seg[4], sample)
          : seg[3] === "tokens" && !seg[4] ? imd.tokens(input, sample)
          : seg[3] === "swarm" && !seg[4] ? imd.swarm(input, sample)
          : seg[3] === "agents" && seg[4] && !seg[5] ? imd.agent(seg[4], input, sample)
          : null;
        const known = ["launches", "tokens", "swarm", "agents"].includes(seg[3]) && !(seg[3] === "agents" && !seg[4]);
        if (!known) return { status: 404, body: { error: "IMD feed endpoints: launches, launches/<n>, tokens, swarm, agents/<seat>" } };
        if (sample) { const p = run(); return p ? { status: 200, body: await p } : { status: 404, body: { error: "not found" } }; }
        return await paid(io, offer("imd-feed"), async () => { const p = run(); if (!p) throw new ServiceError(404, "not found"); return p; }, Object.fromEntries(input));
      }
      return { status: 404, body: { error: "not found", see: `${io.base}/api/v1/services` } };
    } catch (e) {
      if (e instanceof SwarmError) return { status: e.status, body: { error: e.message, ...(e.blockers ? { blockers: e.blockers } : {}) }, ...(e.retryAfter ? { headers: { "Retry-After": String(e.retryAfter) } } : {}) };
      const st = e instanceof ServiceError ? e.status : (e as { status?: number }).status;
      if (typeof st === "number") return { status: st, body: { error: (e as Error).message } };
      console.error("services", e);
      return { status: 503, body: { error: "A source or payment settlement did not answer. Retry the same payment and request; do not sign a new authorization while its status is unknown." } };
    }
  }

  return { handle, verdict, hook, preview, flags, imd, fast, paidCall: paid, challengeOf, demo, terms, holder: (w: string) => (payer.holder ? payer.holder(w) : Promise.resolve(false)) };
}
export type Services = ReturnType<typeof services>;

// ---------------------------------------------------------------- the server's one instance

let live: Services | null = null;
let makeLive: (() => Services) | null = null;
/** Set once at startup (server.ts): the live readers and the house company's payer. */
export function useServices(make: () => Services): void { makeLive = make; live = null; }
export function liveServices(): Services | null { if (!live && makeLive) live = makeLive(); return live; }

const CORS = { "Access-Control-Allow-Origin": "*", "Access-Control-Expose-Headers": "PAYMENT-REQUIRED, PAYMENT-RESPONSE", "Access-Control-Allow-Headers": "PAYMENT-SIGNATURE, X-PAYMENT, X-Holder-Wallet, X-Watch-Token, Content-Type", "Access-Control-Allow-Methods": "GET, POST, OPTIONS" };

/** The hook line in server.ts: answers /api/v1/* and /openapi.json. */
export async function serviceRoutes(req: IncomingMessage, res: ServerResponse, p: string, ctx: { url: URL; base: string; ip: string; limited(req: IncomingMessage, key: string, n: number, ms: number): boolean }): Promise<boolean> {
  if (!p.startsWith("/api/v1/") && p !== "/openapi.json") return false;
  const s = liveServices();
  if (!s) return false;
  if (req.method === "OPTIONS") { res.writeHead(204, CORS); res.end(); return true; }
  const h = (n: string) => { const v = req.headers[n.toLowerCase()]; return Array.isArray(v) ? v[0] : v; };
  const io: Io = { method: req.method ?? "GET", path: p, query: ctx.url.searchParams, header: h, ip: ctx.ip, base: ctx.base, limited: (k, n, ms) => ctx.limited(req, k, n, ms) };
  let out: Out | null;
  if (p === "/api/v1/a2a" && req.method === "POST") {
    if (io.limited("svc-a2a", 240, 60_000)) { res.writeHead(429, { ...CORS, "Retry-After": "60" }); res.end(); return true; }
    try { const chunks: Buffer[] = []; let size = 0; for await (const chunk of req) { size += chunk.length; if (size > 64 * 1024) throw new Error("Request exceeds 64 KiB"); chunks.push(Buffer.from(chunk)); } out = await a2a(s, io, JSON.parse(Buffer.concat(chunks).toString("utf8"))); }
    catch { out = { status: 400, body: { jsonrpc: "2.0", id: null, error: { code: -32700, message: "Invalid or oversized JSON request" } } }; }
  } else out = await s.handle(io);
  if (!out) return false;
  const body = JSON.stringify(out.body, (_k, v) => (typeof v === "bigint" ? v.toString() : v));
  res.writeHead(out.status, { "Content-Type": "application/json", "Cache-Control": "no-store", ...CORS, ...(out.headers ?? {}) });
  res.end(req.method === "HEAD" ? undefined : body);
  return true;
}

export type { OfferId };

/** OpenAPI operations without an x402 price are free: "security": [] tells scanners such as x402scan not to probe them for a payment. */
function markFree<T>(doc: T): T {
  const paths = (doc as { paths?: Record<string, Record<string, Record<string, unknown>>> }).paths ?? {};
  for (const ops of Object.values(paths)) for (const op of Object.values(ops)) if (op && typeof op === "object" && !("x-payment-info" in op)) op.security = [];
  return doc;
}
