import { type Address, type LocalAccount, erc20Abi, getAddress, isAddress, parseAbi, parseAbiItem } from "viem";
import { eth } from "./chain.js";
import { config } from "./config.js";
import { DEAL_COINS, DEAL_FEE_BPS, DEAL_HOLDER_FEE_BPS, DEAL_MAX_FEE_BPS } from "./order-deals.js";
import { livePartners } from "./partners.js";
import { HOLDER_SHIFT } from "./services/catalog.js";
import { context } from "./services/context.js";
import { liveNet, liveRpc } from "./services/net.js";
import { tokenVerdict } from "./services/verdict.js";
import { readHoldings } from "./swap.js";
import type { Vault } from "./vault.js";

/**
 * Token Deals: the cards of the OTC escrow (order token-deals), read from the contract and dressed with what a
 * buyer needs to judge them: the deal's price against the market, liquidity, the Token Verdict, the seller's
 * past trades and the partner badge. Holders get a short-lived pass the contract accepts for the lower fee.
 * Nothing here can move a deal: the most a pass can do is lower one buyer's fee from 1% to 0.5%.
 */
export const DEALS_ABI = parseAbi([
  "function open(address token, uint256 amount, address payCoin, uint256 price, uint256 minBuy, uint64 expiry, address buyer) returns (uint256 dealId)",
  "function buy(uint256 dealId, uint256 amount, address recipient, uint256 maxTotal, uint64 passExpiry, bytes pass) payable",
  "function update(uint256 dealId, uint256 price, uint256 minBuy, uint64 expiry)",
  "function cancel(uint256 dealId)",
  "function claimOwed()",
  "function deals(uint256 dealId) view returns (address seller, address token, address payCoin, uint256 held, uint256 left, uint256 price, uint256 minBuy, uint64 expiry, address buyer, bool open)",
  "function dealCount() view returns (uint256)",
  "function quote(uint256 dealId, uint256 amount, bool holder) view returns (uint256 cost, uint256 fee, uint256 total)",
  "function feeBps() view returns (uint256)",
  "function holderFeeBps() view returns (uint256)",
  "function passSigner() view returns (address)",
  "function owed(address account) view returns (uint256)",
  "function paused() view returns (bool)",
]);
const BOUGHT = parseAbiItem("event Bought(uint256 indexed dealId, address indexed payer, address indexed recipient, uint256 amount, uint256 cost, uint256 fee, bool holder)");
const CANCELLED = parseAbiItem("event DealCancelled(uint256 indexed dealId, uint256 returned)");
export const PASS_TYPES = { HolderPass: [{ name: "recipient", type: "address" }, { name: "expiry", type: "uint64" }] } as const;
/** A pass is good for 30 minutes (the contract takes up to 24 hours): enough to confirm a buy, not to hand around. */
export const PASS_TTL = 1_800;
const ETH: Address = "0x0000000000000000000000000000000000000000";
const WETH = "0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2";
export const COINS = [{ symbol: "ETH", address: ETH, decimals: 18 }, ...DEAL_COINS.map((c) => ({ symbol: c.symbol, address: c.address as Address, decimals: c.decimals }))];
/** Deals shown: the newest this many. */
const SHOWN = 300;
const SPAN = 9_000n;

export class DealsError extends Error { constructor(readonly status: number, message: string, readonly code = "bad_request") { super(message); } }

export type Quote = { priceUsd: number | null; liquidityUsd: number | null; volume24hUsd: number | null; image: string | null; chart: string | null };
export type Verdict = { verdict: "no_issues_found" | "caution" | "avoid"; summary: string };
export type Raw = { id: number; seller: string; token: string; payCoin: string; held: bigint; left: bigint; price: bigint; minBuy: bigint; expiry: number; buyer: string; open: boolean };
export type Meta = { name: string | null; symbol: string | null; decimals: number | null };
type Chain = Pick<typeof eth, "readContract" | "multicall" | "getBlockNumber" | "getLogs">;
type Buy = { dealId: number; payer: string; recipient: string; amount: string; cost: string; fee: string; holder: boolean; tx: string; block: number };

export type DealsDeps = {
  address: () => string; block: () => number; chain: Chain; now: () => number;
  market: (tokens: string[]) => Promise<Map<string, Quote>>;
  verdict: (token: string) => Promise<Verdict | null>;
  holds: (wallet: string) => Promise<boolean>;
  signer: () => LocalAccount;
  partners: () => { address: string; symbol: string | null }[];
};

const lc = (a: string) => a.toLowerCase();
const coinOf = (a: string) => COINS.find((c) => lc(c.address) === lc(a)) ?? null;
/** One whole token in the payment coin, from the contract's price (coin base units per 1e18 token base units). */
export const perToken = (price: bigint, tokenDecimals: number, coinDecimals: number) => Number(price) / 10 ** (18 - tokenDecimals + coinDecimals);
export const statusOf = (d: Pick<Raw, "open" | "expiry" | "left">, cancelled: boolean, nowSec: number) =>
  d.open ? (d.expiry > nowSec ? "open" : "expired") : cancelled ? "cancelled" : d.left === 0n ? "sold" : "closed";

/** One card: the deal as the contract holds it, priced in dollars and checked against the market. */
export function card(d: Raw, meta: Meta, quotes: Map<string, Quote>, o: { verdict: Verdict | null; trades: number; partners: { address: string; symbol: string | null }[]; cancelled: boolean; nowSec: number }) {
  const coin = coinOf(d.payCoin), q = quotes.get(lc(d.token)) ?? null;
  const coinUsd = coin ? (["USDC", "USDT"].includes(coin.symbol) ? 1 : quotes.get(coin.symbol === "ETH" ? WETH : lc(coin.address))?.priceUsd ?? null) : null;
  const each = meta.decimals !== null && coin ? perToken(d.price, meta.decimals, coin.decimals) : null;
  const usd = each !== null && coinUsd !== null ? each * coinUsd : null;
  const market = q?.priceUsd ?? null;
  const partner = o.partners.some((p) => lc(p.address) === lc(d.token));
  const copycat = !partner && !!meta.symbol && o.partners.some((p) => !!p.symbol && p.symbol.toLowerCase() === meta.symbol!.toLowerCase());
  return {
    id: d.id, seller: d.seller, status: statusOf(d, o.cancelled, o.nowSec), buyer: /^0x0{40}$/i.test(d.buyer) ? null : d.buyer,
    token: { address: d.token, name: meta.name, symbol: meta.symbol, decimals: meta.decimals, image: q?.image ?? null, chart: q?.chart ?? null },
    coin: coin ?? { symbol: "?", address: d.payCoin as Address, decimals: 18 },
    held: String(d.held), left: String(d.left), price: String(d.price), minBuy: String(d.minBuy), expiry: d.expiry,
    each, usdEach: usd, marketUsd: market, vsMarketPct: usd !== null && market ? Math.round((usd / market - 1) * 1000) / 10 : null,
    liquidityUsd: q?.liquidityUsd ?? null, volume24hUsd: q?.volume24hUsd ?? null,
    verdict: o.verdict, sellerTrades: o.trades, partner, copycat,
  };
}
export type Card = ReturnType<typeof card>;

export class Deals {
  readonly #d: DealsDeps;
  #meta = new Map<string, Meta>(); #verdicts = new Map<string, { at: number; v: Verdict | null }>(); #checking: Promise<void> | null = null;
  #log: { contract: string; next: number; buys: Buy[]; cancelled: Set<number> } | null = null; #catching: Promise<void> | null = null; #caught = 0;
  #fees: { at: number; fee: number; holder: number } | null = null;
  #list: { at: number; v: Card[] } | null = null;
  constructor(d: DealsDeps) { this.#d = d; }

  get address(): Address | null { const a = this.#d.address(); return isAddress(a) ? getAddress(a) : null; }

  async config() {
    const at = this.address, fees = at ? await this.#feesNow(at) : null;
    return {
      open: !!at, address: at, chainId: 1, feeTo: "0x1119d5df2f046bc2d3c0f6279ef2e9ce49422d44",
      feeBps: fees?.fee ?? DEAL_FEE_BPS, holderFeeBps: fees?.holder ?? DEAL_HOLDER_FEE_BPS, maxFeeBps: DEAL_MAX_FEE_BPS,
      coins: COINS, passSigner: this.#d.signer().address,
      holderRule: `Holders pay ${(fees?.holder ?? DEAL_HOLDER_FEE_BPS) / 100}%: a buying wallet with ${HOLDER_SHIFT.toLocaleString("en-US")}+ $SHIFT (wallet plus staked), a NIGHT FROG or a Night Watcher.`,
    };
  }

  async #feesNow(at: Address) {
    if (this.#fees && this.#d.now() - this.#fees.at < 60_000) return this.#fees;
    const [fee, holder] = await Promise.all(["feeBps", "holderFeeBps"].map((f) => this.#d.chain.readContract({ address: at, abi: DEALS_ABI, functionName: f as "feeBps" }))).catch(() => [null, null]);
    if (fee === null || holder === null) return this.#fees;
    return (this.#fees = { at: this.#d.now(), fee: Number(fee), holder: Number(holder) });
  }

  /** The newest deals, every status; the page filters. Kept 15 seconds. */
  async list(): Promise<Card[]> {
    const at = this.address;
    if (!at) return [];
    if (this.#list && this.#d.now() - this.#list.at < 15_000) return this.#list.v;
    const count = Number(await this.#d.chain.readContract({ address: at, abi: DEALS_ABI, functionName: "dealCount" }));
    const ids = Array.from({ length: Math.min(count, SHOWN) }, (_, i) => count - i);
    const rows = ids.length ? await this.#d.chain.multicall({ allowFailure: false, contracts: ids.map((id) => ({ address: at, abi: DEALS_ABI, functionName: "deals" as const, args: [BigInt(id)] as const })) }) : [];
    const raw: Raw[] = rows.map((r, i) => ({ id: ids[i]!, seller: r[0], token: r[1], payCoin: r[2], held: r[3], left: r[4], price: r[5], minBuy: r[6], expiry: Number(r[7]), buyer: r[8], open: r[9] }));
    await this.#metaOf([...new Set(raw.map((d) => lc(d.token)))]);
    await this.#catchUp(at).catch(() => {}); // a slow log read leaves the counts a little behind, never the cards
    const quotes = await this.#d.market([...new Set([...raw.map((d) => lc(d.token)), WETH, ...DEAL_COINS.map((c) => c.address)])]).catch(() => new Map<string, Quote>());
    const live = [...new Set(raw.filter((d) => d.open).map((d) => lc(d.token)))];
    void this.#checkVerdicts(live);
    const sellerOf = new Map(raw.map((d) => [d.id, lc(d.seller)])), trades = new Map<string, number>();
    for (const b of this.#log?.buys ?? []) { const s = sellerOf.get(b.dealId); if (s) trades.set(s, (trades.get(s) ?? 0) + 1); }
    const partners = this.#d.partners(), nowSec = Math.floor(this.#d.now() / 1000);
    const v = raw.map((d) => card(d, this.#meta.get(lc(d.token)) ?? { name: null, symbol: null, decimals: null }, quotes, {
      verdict: this.#verdicts.get(lc(d.token))?.v ?? null, trades: trades.get(lc(d.seller)) ?? 0, partners, cancelled: this.#log?.cancelled.has(d.id) ?? false, nowSec,
    }));
    this.#list = { at: this.#d.now(), v };
    return v;
  }

  async one(id: number) {
    const d = (await this.list()).find((x) => x.id === id);
    if (!d) throw new DealsError(404, "No deal with that number.", "not_found");
    return { deal: d, buys: (this.#log?.buys ?? []).filter((b) => b.dealId === id).slice(-20).reverse() };
  }

  /** A holder's pass for the lower fee, or { holder: false }. Bound to the wallet that receives the tokens. */
  async pass(recipient: unknown) {
    const at = this.address;
    if (!at) throw new DealsError(503, "Token Deals opens when the escrow contract is deployed.", "not_open");
    if (typeof recipient !== "string" || !isAddress(recipient)) throw new DealsError(400, "recipient: a 0x wallet address.", "bad_recipient");
    if (!(await this.#d.holds(lc(recipient)).catch(() => false))) return { holder: false as const };
    const expiry = Math.floor(this.#d.now() / 1000) + PASS_TTL;
    const signature = await this.#d.signer().signTypedData({ domain: { name: "TokenDeals", version: "1", chainId: 1, verifyingContract: at }, types: PASS_TYPES, primaryType: "HolderPass", message: { recipient: getAddress(recipient), expiry: BigInt(expiry) } });
    return { holder: true as const, expiry, signature };
  }

  async #metaOf(tokens: string[]) {
    const fresh = tokens.filter((t) => !this.#meta.has(t));
    if (!fresh.length) return;
    const calls = fresh.flatMap((t) => (["name", "symbol", "decimals"] as const).map((functionName) => ({ address: t as Address, abi: erc20Abi, functionName })));
    const r = await this.#d.chain.multicall({ allowFailure: true, contracts: calls });
    fresh.forEach((t, i) => {
      const [n, s, dec] = r.slice(i * 3, i * 3 + 3).map((x) => x.status === "success" ? x.result : null);
      this.#meta.set(t, { name: typeof n === "string" ? n.slice(0, 60) : null, symbol: typeof s === "string" ? s.slice(0, 20) : null, decimals: typeof dec === "number" ? dec : null });
    });
  }

  /** Token Verdict for each token on sale, one at a time in the background, kept 6 hours. */
  #checkVerdicts(tokens: string[]) {
    if (this.#checking) return this.#checking;
    const due = tokens.filter((t) => { const h = this.#verdicts.get(t); return !h || this.#d.now() - h.at > 6 * 3_600_000; });
    if (!due.length) return Promise.resolve();
    this.#checking = (async () => {
      for (const t of due) this.#verdicts.set(t, { at: this.#d.now(), v: await this.#d.verdict(t).catch(() => this.#verdicts.get(t)?.v ?? null) });
      this.#list = null;
    })().finally(() => { this.#checking = null; });
    return this.#checking;
  }

  /** Every buy and cancel since the deploy block, read in spans, at most every 30 seconds. */
  async #catchUp(at: Address) {
    if (this.#catching) return this.#catching;
    if (this.#d.now() - this.#caught < 30_000) return;
    this.#catching = (async () => {
      if (!this.#log || this.#log.contract !== lc(at)) this.#log = { contract: lc(at), next: this.#d.block(), buys: [], cancelled: new Set() };
      const log = this.#log, head = await this.#d.chain.getBlockNumber();
      const read = async <E extends typeof BOUGHT | typeof CANCELLED>(event: E, fromBlock: bigint, toBlock: bigint) => {
        try { return await this.#d.chain.getLogs({ address: at, event, fromBlock, toBlock }); } catch { await new Promise((r) => setTimeout(r, 1_000)); return this.#d.chain.getLogs({ address: at, event, fromBlock, toBlock }); }
      };
      for (let a = BigInt(log.next); a <= head; a += SPAN) {
        const b = a + SPAN - 1n > head ? head : a + SPAN - 1n;
        for (const l of await read(BOUGHT, a, b)) log.buys.push({ dealId: Number(l.args.dealId), payer: l.args.payer!, recipient: l.args.recipient!, amount: String(l.args.amount), cost: String(l.args.cost), fee: String(l.args.fee), holder: !!l.args.holder, tx: l.transactionHash ?? "", block: Number(l.blockNumber) });
        for (const l of await read(CANCELLED, a, b)) log.cancelled.add(Number(l.args.dealId));
        log.next = Number(b) + 1;
      }
      if (log.buys.length > 5_000) log.buys.splice(0, log.buys.length - 5_000);
      this.#caught = this.#d.now();
    })().finally(() => { this.#catching = null; });
    return this.#catching;
  }
}

/** Prices, liquidity and logos from DexScreener, 30 tokens a request, kept a minute. */
const quoteCache = new Map<string, { at: number; q: Quote }>();
async function dexQuotes(tokens: string[]): Promise<Map<string, Quote>> {
  const out = new Map<string, Quote>(), now = Date.now(), want = tokens.filter((t) => { const h = quoteCache.get(t); if (h && now - h.at < 60_000) { out.set(t, h.q); return false; } return true; });
  for (let i = 0; i < want.length; i += 30) {
    const part = want.slice(i, i + 30);
    const r = await fetch(`https://api.dexscreener.com/tokens/v1/ethereum/${part.join(",")}`, { signal: AbortSignal.timeout(12_000) });
    if (!r.ok) continue;
    const pairs = (await r.json()) as { baseToken?: { address?: string }; priceUsd?: string; liquidity?: { usd?: number }; volume?: { h24?: number }; info?: { imageUrl?: string }; url?: string }[];
    for (const t of part) {
      const best = pairs.filter((p) => lc(p.baseToken?.address ?? "") === t).sort((a, b) => (b.liquidity?.usd ?? 0) - (a.liquidity?.usd ?? 0))[0];
      if (!best) continue;
      const q = { priceUsd: best.priceUsd ? Number(best.priceUsd) : null, liquidityUsd: best.liquidity?.usd ?? null, volume24hUsd: best.volume?.h24 ?? null, image: best.info?.imageUrl ?? null, chart: best.url ?? null };
      quoteCache.set(t, { at: now, q }); out.set(t, q);
    }
  }
  return out;
}

let live: Deals | null = null;
/** The live desk: Ethereum, DexScreener, Token Verdict, the holder rule of the house tools and the vault's pass signer. */
export function liveDeals(vault: Vault): Deals {
  const ctx = context({ net: liveNet, rpc: liveRpc(eth as never), now: Date.now, etherscanKey: config.etherscanKey, watchtowerUrl: config.watchtowerUrl });
  live ??= new Deals({
    address: () => config.deals.address, block: () => config.deals.block, chain: eth, now: Date.now,
    market: dexQuotes,
    verdict: async (t) => { const r = await tokenVerdict(ctx, "ethereum", t, "quick"); return { verdict: r.verdict, summary: r.summary }; },
    holds: (w) => readHoldings(w, BigInt(HOLDER_SHIFT) * 10n ** 18n),
    signer: () => { try { return vault.account("deals-pass-signer"); } catch { vault.create("deals-pass-signer"); return vault.account("deals-pass-signer"); } },
    partners: () => livePartners().list().filter((p) => p.token.chain === "ethereum").map((p) => ({ address: p.token.address, symbol: p.symbol })),
  });
  return live;
}
