import type { IncomingMessage, ServerResponse } from "node:http";
import {
  CHAINS, CHAIN_ORDER, type ChainKey, DEFAULT_FEE_BPS, type FeeDecision, LIFI_API, MAX_FEE_BPS, type Quote, type QuoteRequest, RELAY_API, type Token, type Track,
  XRPL_SOURCE_SOON, bestFirst, checkRequest, decideFee, fromLifi, fromLifiStatus, fromRelay, fromRelayStatus, isChain, isEvmAddress, lifiQuoteQuery,
  lifiToken, pinnedOn, providerFee, relayQuoteBody, sameAddress, validAddress,
} from "@nightshift/swap";
import { parseAbi } from "viem";
import { eth } from "./chain.js";
import { config } from "./config.js";
import { type SettingKey, readSettings } from "./settings.js";

/**
 * The multichain swap's server side (docs/swap/RESEARCH.md): it decides NIGHTSHIFT's fee for the signed-in
 * wallet, asks LI.FI and Relay for routes with that fee (keys stay here), checks every route against the
 * contracts pinned in @nightshift/swap and passes on token lists and transfer status. It never holds funds and
 * never signs: the page builds and signs every transaction in the visitor's own wallet, after the same checks.
 */
export type SwapSettings = { feeBps: number; feeWallet: string; lifiIntegrator: string; lifiKey: string; relayKey: string };

/** Read on every request, so a change in /setup applies at once. */
export function swapSettings(saved: Partial<Record<SettingKey, string>> = readSettings(), env: Record<string, string | undefined> = process.env): SwapSettings {
  const g = (k: SettingKey) => (saved[k] ?? env[k] ?? "").trim();
  const bps = g("SWAP_FEE_BPS");
  const wallet = g("SWAP_FEE_WALLET");
  return {
    feeBps: bps === "" ? DEFAULT_FEE_BPS : Math.min(MAX_FEE_BPS, Math.max(0, Math.floor(Number(bps)) || 0)),
    feeWallet: isEvmAddress(wallet) ? wallet : config.platformTreasury,
    lifiIntegrator: g("LIFI_INTEGRATOR"),
    lifiKey: g("LIFI_API_KEY"),
    relayKey: g("RELAY_API_KEY"),
  };
}

/** NIGHT FROGS (and NIGHT WATCHERS, once the forge is set) on Ethereum: the wallets that pay no swap fee. */
export const FROGS = "0x55b8c762f1b86fe1d5406edaaae0f8ecf3688a0c";
const BALANCE = parseAbi(["function balanceOf(address) view returns (uint256)"]);
export async function readHoldings(wallet: string): Promise<boolean> {
  const who = wallet as `0x${string}`;
  const forge = /^0x[0-9a-fA-F]{40}$/.test(config.forge.address) ? (config.forge.address as `0x${string}`) : null;
  const [frogs, watchers] = await Promise.all([
    eth.readContract({ address: (config.nft.address || FROGS) as `0x${string}`, abi: BALANCE, functionName: "balanceOf", args: [who] }),
    forge ? eth.readContract({ address: forge, abi: BALANCE, functionName: "balanceOf", args: [who] }) : 0n,
  ]);
  return frogs + watchers > 0n;
}

type Fetch = (url: string, init?: RequestInit) => Promise<Response>;
export type SwapDeps = { fetch: Fetch; holds: (wallet: string) => Promise<boolean>; settings: () => SwapSettings; now: () => number };

const FEATURED: Record<ChainKey, string[]> = {
  eth: ["USDC", "USDT", "WETH", "WBTC", "cbBTC", "DAI", "LINK", "UNI"],
  base: ["USDC", "WETH", "cbBTC", "USDT", "DAI", "AERO", "DEGEN"],
  rh: ["WETH", "USDG", "USDe", "cbBTC", "TSLA", "NVDA", "AAPL", "SPY"],
  sol: ["USDC", "USDT", "wSOL", "JUP", "BONK", "WIF", "cbBTC"],
  xrpl: [],
};
const LIFI_CHAINS = CHAIN_ORDER.filter((c) => CHAINS[c].lifi !== undefined);

export function swapService(d: SwapDeps) {
  const held = new Map<string, { at: number; holds: boolean }>();
  /** Holding, read on chain and kept 5 minutes; a failed read keeps the last answer (or "no"). */
  async function holds(wallet: string | null): Promise<boolean> {
    if (!wallet || !isEvmAddress(wallet)) return false;
    const w = wallet.toLowerCase(), hit = held.get(w);
    if (hit && d.now() - hit.at < 5 * 60_000) return hit.holds;
    try { const h = await d.holds(w); held.set(w, { at: d.now(), holds: h }); return h; } catch { return hit?.holds ?? false; }
  }

  async function fee(session: string | null, wallet: string | null): Promise<FeeDecision & { collect: { lifi: boolean; relay: boolean } }> {
    const s = d.settings();
    const [sessionHolds, walletHolds] = await Promise.all([holds(session), wallet && wallet.toLowerCase() !== session?.toLowerCase() ? holds(wallet) : Promise.resolve(null)]);
    const decision = decideFee({ baseBps: s.feeBps, session, sessionHolds, wallet, walletHolds: walletHolds ?? sessionHolds });
    const cfg = { lifiIntegrator: s.lifiIntegrator, feeWallet: s.feeWallet };
    return { ...decision, collect: { lifi: providerFee("lifi", { ...decision, bps: s.feeBps }, cfg).bps > 0, relay: providerFee("relay", { ...decision, bps: s.feeBps }, cfg).bps > 0 } };
  }

  // short-lived answers, so a page that re-asks (or two visitors on the same pair) spends no extra quota
  const cache = new Map<string, { at: number; v: unknown }>();
  async function getJson(url: string, init: RequestInit & { ttl?: number } = {}): Promise<{ status: number; body: Record<string, unknown> }> {
    const key = `${init.method ?? "GET"} ${url} ${typeof init.body === "string" ? init.body : ""}`;
    const hit = cache.get(key);
    if (init.ttl && hit && d.now() - hit.at < init.ttl) return hit.v as { status: number; body: Record<string, unknown> };
    const r = await d.fetch(url, { ...init, signal: AbortSignal.timeout(20_000) });
    const body = (await r.json().catch(() => ({}))) as Record<string, unknown>;
    const v = { status: r.status, body };
    if (init.ttl && r.ok) { cache.set(key, { at: d.now(), v }); if (cache.size > 500) cache.delete(cache.keys().next().value!); }
    return v;
  }
  const busy = (name: string, status: number) => (status === 429 ? `${name} is busy right now (rate limit). Try again in a minute.` : null);

  async function lifi(r: QuoteRequest, dec: FeeDecision, s: SwapSettings): Promise<Quote> {
    const pf = providerFee("lifi", dec, { lifiIntegrator: s.lifiIntegrator, feeWallet: s.feeWallet });
    const ask = (bps: number) => getJson(`${LIFI_API}/quote?${lifiQuoteQuery(r, { integrator: s.lifiIntegrator, feeBps: bps })}`, { headers: s.lifiKey ? { "x-lifi-api-key": s.lifiKey } : {}, ttl: 15_000 });
    let a = await ask(pf.bps), off = pf.off;
    // an integration set in /setup but not (yet) configured for fees on portal.li.fi: the route without our fee
    if (a.body.code === 1011 && pf.bps > 0) { a = await ask(0); off = "not collected on LI.FI routes yet (LI.FI integration not set up for fees)"; }
    const b = busy("LI.FI", a.status);
    if (b) throw new Error(b);
    const bps = off ? 0 : pf.bps;
    return fromLifi(a.body as never, r, { bps, waived: dec.waived, note: off && !dec.waived ? `NIGHTSHIFT fee ${off}.` : dec.note });
  }

  async function relay(r: QuoteRequest, dec: FeeDecision, s: SwapSettings): Promise<Quote> {
    const pf = providerFee("relay", dec, { lifiIntegrator: s.lifiIntegrator, feeWallet: s.feeWallet });
    const a = await getJson(`${RELAY_API}/quote`, { method: "POST", headers: { "Content-Type": "application/json", ...(s.relayKey ? { "x-api-key": s.relayKey } : {}) }, body: JSON.stringify(relayQuoteBody(r, { feeBps: pf.bps, feeWallet: s.feeWallet })), ttl: 15_000 });
    const b = busy("Relay", a.status);
    if (b) throw new Error(b);
    return fromRelay(a.body as never, r, { bps: pf.bps, waived: dec.waived, note: pf.off && !dec.waived ? `NIGHTSHIFT fee ${pf.off}.` : dec.note });
  }

  /** Every provider that covers both chains, asked at once; the routes best first, and why the others gave none. */
  async function quote(x: Record<string, unknown>, session: string | null): Promise<{ status: number; body: unknown }> {
    const c = checkRequest(x);
    if ("error" in c) return { status: 400, body: { error: c.error } };
    const r = c.req, s = d.settings();
    const dec = decideFee({ baseBps: s.feeBps, session, sessionHolds: await holds(session) });
    const asks: { provider: "lifi" | "relay"; run: () => Promise<Quote> }[] = [];
    if (CHAINS[r.fromChain].lifi && CHAINS[r.toChain].lifi) asks.push({ provider: "lifi", run: () => lifi(r, dec, s) });
    if (CHAINS[r.fromChain].relay && CHAINS[r.toChain].relay) asks.push({ provider: "relay", run: () => relay(r, dec, s) });
    const got = await Promise.allSettled(asks.map((a) => a.run()));
    const quotes: Quote[] = [], errors: { provider: string; error: string }[] = [];
    got.forEach((g, i) => { if (g.status === "fulfilled") quotes.push(g.value); else errors.push({ provider: asks[i]!.provider, error: String((g.reason as Error)?.message ?? g.reason).slice(0, 240) }); });
    return { status: 200, body: { quotes: bestFirst(quotes), fee: dec, errors } };
  }

  let list: { at: number; tokens: Partial<Record<ChainKey, Token[]>> } | null = null;
  let loading: Promise<void> | null = null;
  /** LI.FI's token lists for our four chains (several MB), kept 6 hours; the pinned tokens whatever happens. */
  async function lists(): Promise<Partial<Record<ChainKey, Token[]>>> {
    if (list && d.now() - list.at < 6 * 3_600_000) return list.tokens;
    loading ??= (async () => {
      try {
        const a = await getJson(`${LIFI_API}/tokens?chains=${LIFI_CHAINS.map((c) => CHAINS[c].lifi).join(",")}`, { headers: d.settings().lifiKey ? { "x-lifi-api-key": d.settings().lifiKey } : {} });
        const raw = (a.body.tokens ?? {}) as Record<string, Parameters<typeof lifiToken>[0][]>;
        const tokens: Partial<Record<ChainKey, Token[]>> = {};
        for (const c of LIFI_CHAINS) tokens[c] = (raw[String(CHAINS[c].lifi)] ?? []).map((t) => lifiToken(t, c));
        if (Object.values(tokens).some((t) => t.length)) list = { at: d.now(), tokens };
      } catch { /* the pinned tokens still answer */ } finally { loading = null; }
    })();
    await loading;
    return list?.tokens ?? {};
  }

  /** A chain's tokens: NIGHTSHIFT's pinned ones first, then the featured ones, or the matches for `q` (a symbol, a name, an address). */
  async function tokens(chain: string, q: string): Promise<{ status: number; body: unknown }> {
    if (!isChain(chain)) return { status: 400, body: { error: "unknown chain" } };
    const pinned = pinnedOn(chain);
    const all = chain === "xrpl" ? [] : (await lists())[chain] ?? [];
    const notPinned = (t: Token) => !pinned.some((p) => sameAddress(p.address, t.address));
    const query = q.trim().slice(0, 64);
    if (!query) {
      const featured = FEATURED[chain].map((sym) => all.find((t) => t.verified && t.symbol === sym && notPinned(t))).filter((t): t is Token => Boolean(t));
      return { status: 200, body: { tokens: [...pinned, ...featured] } };
    }
    if (validAddress(chain, query)) {
      const known = [...pinned, ...all].find((t) => sameAddress(t.address, query));
      if (known) return { status: 200, body: { tokens: [known] } };
      if (CHAINS[chain].lifi) {
        const a = await getJson(`${LIFI_API}/token?chain=${CHAINS[chain].lifi}&token=${encodeURIComponent(query)}`, { ttl: 600_000 }).catch(() => null);
        if (a?.status === 200 && a.body.address) return { status: 200, body: { tokens: [lifiToken(a.body as never, chain)] } };
      }
      return { status: 200, body: { tokens: [] } };
    }
    const needle = query.toLowerCase();
    const score = (t: Token) => (t.symbol.toLowerCase() === needle ? 0 : t.symbol.toLowerCase().startsWith(needle) ? 1 : t.name.toLowerCase().includes(needle) ? 2 : 9);
    const hits = [...pinned, ...all.filter((t) => t.verified && notPinned(t))].filter((t) => score(t) < 9).sort((a, b) => score(a) - score(b) || (b.priceUsd ? 1 : 0) - (a.priceUsd ? 1 : 0)).slice(0, 30);
    return { status: 200, body: { tokens: hits } };
  }

  async function status(u: URLSearchParams): Promise<{ status: number; body: unknown }> {
    const to = u.get("to") ?? "", from = u.get("from") ?? "";
    if (!isChain(to) || !isChain(from)) return { status: 400, body: { error: "unknown chain" } };
    let t: Track;
    if (u.get("provider") === "relay") {
      const id = u.get("id") ?? "";
      if (!/^0x[0-9a-fA-F]{64}$/.test(id)) return { status: 400, body: { error: "bad request id" } };
      const a = await getJson(`${RELAY_API}/intents/status/v3?requestId=${id}`, { headers: d.settings().relayKey ? { "x-api-key": d.settings().relayKey } : {} });
      t = fromRelayStatus(a.body, to);
    } else {
      const tx = u.get("tx") ?? "";
      if (!/^(0x[0-9a-fA-F]{64}|[1-9A-HJ-NP-Za-km-z]{64,90})$/.test(tx)) return { status: 400, body: { error: "bad transaction hash" } };
      const p = new URLSearchParams({ txHash: tx, fromChain: String(CHAINS[from].lifi), toChain: String(CHAINS[to].lifi) });
      const tool = u.get("tool");
      if (tool && /^[\w-]{1,40}$/.test(tool)) p.set("bridge", tool);
      const a = await getJson(`${LIFI_API}/status?${p}`, { headers: d.settings().lifiKey ? { "x-lifi-api-key": d.settings().lifiKey } : {} });
      t = fromLifiStatus(a.body, to);
    }
    return { status: 200, body: t };
  }

  return { fee, quote, tokens, status, holds };
}

let live: ReturnType<typeof swapService> | null = null;
const service = () => (live ??= swapService({ fetch: (u, i) => fetch(u, i), holds: readHoldings, settings: () => swapSettings(), now: Date.now }));

type Context = {
  json(res: ServerResponse, status: number, body: unknown): void;
  body(req: IncomingMessage, max?: number): Promise<Record<string, unknown>>;
  limited(req: IncomingMessage, key: string, n: number, ms: number): boolean;
  /** The signed-in wallet: the only one whose NIGHT FROG waives the fee. */
  owner: string | null;
  url: URL;
};

export async function swapRoutes(req: IncomingMessage, res: ServerResponse, p: string, ctx: Context, svc = service()): Promise<boolean> {
  const { json, limited, url } = ctx;
  const send = (r: { status: number; body: unknown }) => json(res, r.status, r.body);
  const slow = () => json(res, 429, { error: "Slow down a little: too many swap requests from here." });
  try {
    if (p === "/api/swap/fee" && req.method === "GET") {
      if (limited(req, "swap-fee", 60, 60_000)) return slow(), true;
      const w = url.searchParams.get("wallet");
      json(res, 200, { ...(await svc.fee(ctx.owner, w && isEvmAddress(w) ? w : null)), xrplSource: XRPL_SOURCE_SOON });
      return true;
    }
    if (p === "/api/swap/quote" && req.method === "POST") {
      if (limited(req, "swap-quote", 40, 60_000)) return slow(), true;
      const b = await ctx.body(req, 4_000).catch(() => null);
      if (!b) return json(res, 400, { error: "Send the quote request as a small JSON body." }), true;
      send(await svc.quote(b, ctx.owner));
      return true;
    }
    if (p === "/api/swap/tokens" && req.method === "GET") {
      if (limited(req, "swap-tokens", 120, 60_000)) return slow(), true;
      send(await svc.tokens(url.searchParams.get("chain") ?? "", url.searchParams.get("q") ?? ""));
      return true;
    }
    if (p === "/api/swap/status" && req.method === "GET") {
      if (limited(req, "swap-status", 120, 60_000)) return slow(), true;
      send(await svc.status(url.searchParams));
      return true;
    }
  } catch (e) {
    json(res, 502, { error: `The swap providers did not answer: ${String((e as Error).message ?? e).slice(0, 160)}` });
    return true;
  }
  return false;
}

