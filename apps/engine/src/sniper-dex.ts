import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { Address, Hex } from "viem";
import { writeAtomic } from "./atomic.js";
import { config } from "./config.js";
import type { DexPair } from "./imdmarket.js";
import type { LaunchDetail, LaunchRow } from "./services/imd.js";
import type { Impact, VerdictReport } from "./services/verdict.js";
import { NATIVE, type Slot0 } from "./services/v4pool.js";
import { type MintPrice, type NftRead, type Pool, type Verdict, chartUrl, launchVerdict, launcherShare, poolOf, priceOf, uniswapUrl } from "./sniper.js";

/**
 * The NIGHT SNIPER dex: every live IMD token on Ethereum and every IMD NFT collection, not only the
 * launches called since NIGHT SNIPER started. A token's price is read from its own Uniswap v4 pool on
 * chain, so a token DexScreener does not list (it indexes only some v4 pools) is priced all the same;
 * GeckoTerminal charts v4 pools by their id. Its launch market cap comes from IMD's launch record, so
 * "since launch" is exact. Verdicts are worked out a few at a time and kept for days.
 */

export type DexToken = {
  launch: number; id: string; token: Address; kind: string; at: string; repo: string | null;
  symbol: string | null; name: string | null; supply: number | null;
  pool: Pool | null; quoteSymbol?: string | null; launcher: string | null; keepsPct: number | null;
  /** The market cap IMD launched it at, in the pool's quote currency. */
  mc0: number | null;
  /** The token's price in its quote currency, when last read, and hourly prices for the 24-hour move. */
  price: number | null; priceAt: number | null; hourly: [number, number][];
  verdict: { verdict: Verdict; summary: string; reasons: { impact: Impact; text: string }[]; at: number } | null;
  /** DexScreener, when it lists the token. */
  dex: { url: string; liquidityUsd: number | null; volume24: number | null } | null;
};
export type DexNft = {
  launch: number; contract: Address; name: string | null; symbol: string | null; standard: string;
  minted: number | null; maxSupply: number | null; price: MintPrice | null; owner: string | null;
  launcher: string | null; at: string; repo: string | null; checkedAt: number;
};
type State = { tokens: Record<string, DexToken>; nfts: Record<string, DexNft>; scanned: Record<string, 1> };

export type DexDeps = {
  now(): number;
  allLaunches(): Promise<LaunchRow[]>;
  detail(id: string): Promise<LaunchDetail | null>;
  basics(token: Address): Promise<{ name: string | null; symbol: string | null; decimals: number | null; totalSupply: bigint | null }>;
  slot0(poolId: Hex): Promise<Slot0 | null>;
  decimals(token: Address): Promise<number>;
  verdict(token: Address): Promise<VerdictReport>;
  dexQuotes(tokens: string[]): Promise<Map<string, DexPair>>;
  nft(address: Address): Promise<NftRead | null>;
  file: string | null;
};

const PER_TICK = { add: 6, price: 40, verdict: 1, scan: 4, nftRefresh: 2 };
const LIST_EVERY = 30 * 60_000, PRICE_EVERY = 10 * 60_000, VERDICT_EVERY = 3 * 86_400_000, NFT_EVERY = 6 * 3_600_000, HOUR = 3_600_000;
const IMD: Address = "0xd34a99bc0f67ae1bbd63c660e6d0b0dd03e263b7";

/** The move over the last 24 hours, from the hourly prices (null until there is a price a day old). */
export function change24(t: Pick<DexToken, "hourly" | "price">, now: number): number | null {
  const old = t.hourly.find(([at]) => now - at <= 25 * HOUR && now - at >= 20 * HOUR);
  return old && t.price ? t.price / old[1] - 1 : null;
}

export function createDex(d: DexDeps) {
  const load = (): State => {
    try { if (d.file && existsSync(d.file)) return { tokens: {}, nfts: {}, scanned: {}, ...JSON.parse(readFileSync(d.file, "utf8")) }; } catch { /* a fresh start */ }
    return { tokens: {}, nfts: {}, scanned: {} };
  };
  const st = load();
  const save = () => { if (d.file) writeAtomic(d.file, JSON.stringify(st)); };
  let busy = false, listedAt = 0, dexAt = 0;
  let toAdd: LaunchRow[] = [], toScan: LaunchRow[] = [];

  async function add(l: LaunchRow): Promise<void> {
    const token = l.artifacts!.find((a) => a.role === "token")!.address.toLowerCase() as Address;
    const [det, b] = await Promise.all([d.detail(l.id).catch(() => null), d.basics(token).catch(() => null)]);
    const p = poolOf(token, null, l);
    const tokenDec = b?.decimals ?? 18;
    const pool = p ? { ...p, tokenDec, quoteDec: p.quote === NATIVE ? 18 : await d.decimals(p.quote).catch(() => 18) } : null;
    const quoteSymbol = !p || p.quote === NATIVE ? "ETH" : p.quote === IMD ? "IMD" : (await d.basics(p.quote).catch(() => null))?.symbol ?? null;
    const mcw = det?.economics && "initialMarketCapWei" in det.economics ? Number((det.economics as { initialMarketCapWei?: string }).initialMarketCapWei ?? 0) : 0;
    st.tokens[token] = {
      launch: l.launchNumber, id: l.id, token, kind: l.kind, at: l.createdAt, repo: l.sourceRepoUrl ?? null,
      symbol: b?.symbol ?? null, name: b?.name ?? null, supply: b?.totalSupply ? Number(b.totalSupply) / 10 ** tokenDec : null,
      pool, quoteSymbol, launcher: det?.requester?.toLowerCase() ?? null, keepsPct: launcherShare(det), mc0: mcw > 0 ? mcw / 1e18 : null,
      price: null, priceAt: null, hourly: [], verdict: null, dex: null,
    };
  }

  async function price(t: DexToken): Promise<void> {
    t.priceAt = d.now();
    if (!t.pool) return;
    const s = await d.slot0(t.pool.id).catch(() => null);
    const p = s ? priceOf(t.pool, s) : 0;
    if (!(p > 0)) return;
    t.price = p;
    const last = t.hourly.at(-1);
    if (!last || d.now() - last[0] >= HOUR) { t.hourly.push([d.now(), p]); if (t.hourly.length > 26) t.hourly.splice(0, t.hourly.length - 26); }
  }

  async function judge(t: DexToken): Promise<void> {
    const v = await d.verdict(t.token).catch(() => null);
    if (!v) { t.verdict = { verdict: "unchecked", summary: "The checks could not run on this token yet.", reasons: [], at: d.now() }; return; }
    const lv = launchVerdict(v, { keepsPct: t.keepsPct });
    t.verdict = { ...lv, at: d.now() };
    t.symbol ??= v.asset.symbol; t.name ??= v.asset.name;
  }

  async function scan(l: LaunchRow): Promise<void> {
    st.scanned[String(l.launchNumber)] = 1;
    for (const a of (l.artifacts ?? []).filter((x) => x.role !== "token").slice(0, 8)) {
      const n = await d.nft(a.address.toLowerCase() as Address).catch(() => null);
      if (!n) continue;
      const det = await d.detail(l.id).catch(() => null);
      st.nfts[a.address.toLowerCase()] = { launch: l.launchNumber, contract: a.address.toLowerCase() as Address, ...n, name: n.name ?? a.name, launcher: det?.requester?.toLowerCase() ?? null, at: l.createdAt, repo: l.sourceRepoUrl ?? null, checkedAt: d.now() };
    }
  }

  async function tick(): Promise<void> {
    if (busy) return;
    busy = true;
    try {
      if (d.now() - listedAt > LIST_EVERY) {
        listedAt = d.now();
        const all = await d.allLaunches().catch(() => [] as LaunchRow[]);
        const live = all.filter((l) => l.chainId === 1 && l.status === "live");
        toAdd = live.filter((l) => l.artifacts?.some((a) => a.role === "token") && !st.tokens[l.artifacts!.find((a) => a.role === "token")!.address.toLowerCase()]).sort((a, b) => b.launchNumber - a.launchNumber);
        toScan = live.filter((l) => (l.kind === "evm_contracts" || l.kind === "evm_project") && !st.scanned[String(l.launchNumber)]).sort((a, b) => b.launchNumber - a.launchNumber);
      }
      for (const l of toAdd.splice(0, PER_TICK.add)) await add(l).catch((e) => console.error("dex add", l.launchNumber, (e as Error).message));
      const tokens = Object.values(st.tokens);
      for (const t of tokens.filter((x) => !x.priceAt || d.now() - x.priceAt > PRICE_EVERY).sort((a, b) => (a.priceAt ?? 0) - (b.priceAt ?? 0)).slice(0, PER_TICK.price)) await price(t);
      for (const t of tokens.filter((x) => !x.verdict || d.now() - x.verdict.at > VERDICT_EVERY).sort((a, b) => (a.verdict?.at ?? 0) - (b.verdict?.at ?? 0) || b.launch - a.launch).slice(0, PER_TICK.verdict)) await judge(t);
      for (const l of toScan.splice(0, PER_TICK.scan)) await scan(l).catch(() => undefined);
      for (const n of Object.values(st.nfts).filter((x) => d.now() - x.checkedAt > NFT_EVERY).slice(0, PER_TICK.nftRefresh)) {
        const r = await d.nft(n.contract).catch(() => null);
        n.checkedAt = d.now();
        if (r) Object.assign(n, { minted: r.minted, maxSupply: r.maxSupply ?? n.maxSupply, price: r.price ?? n.price });
      }
      if (d.now() - dexAt > LIST_EVERY && tokens.length) {
        dexAt = d.now();
        const q = await d.dexQuotes(tokens.map((t) => t.token)).catch(() => new Map<string, DexPair>());
        for (const t of tokens) { const p = q.get(t.token); t.dex = p ? { url: p.url, liquidityUsd: p.liquidity?.usd ?? null, volume24: p.volume?.h24 ?? null } : null; }
      }
    } finally {
      busy = false;
      save();
    }
  }

  type Sort = "mcap" | "new" | "move" | "safe";
  /** The dex as the site shows it, in dollars. `usdOf` prices a quote currency (ETH, IMD). */
  function view(o: { sort?: Sort; q?: string; limit?: number; hideNewerThan?: number }, usdOf: (quote: Address) => number) {
    const q = (o.q ?? "").trim().toLowerCase().replace(/^\$/, "");
    const now = d.now();
    const rows = Object.values(st.tokens)
      .filter((t) => !o.hideNewerThan || Date.parse(t.at) <= o.hideNewerThan)
      .filter((t) => !q || t.token === q || String(t.launch) === q.replace(/^#/, "") || (t.symbol ?? "").toLowerCase().includes(q) || (t.name ?? "").toLowerCase().includes(q))
      .map((t) => {
        const qUsd = t.pool ? usdOf(t.pool.quote) : 0;
        const mcapNow = t.price && t.supply && qUsd ? t.price * t.supply * qUsd : null;
        const mcap0 = t.mc0 && qUsd ? t.mc0 * qUsd : null;
        return {
          launch: t.launch, token: t.token, symbol: t.symbol, name: t.name, kind: t.kind, at: t.at,
          quote: t.pool ? (t.pool.quote === NATIVE ? "ETH" : t.pool.quote === IMD ? "IMD" : t.quoteSymbol ?? "token") : null,
          mcapNow, mcap0, sinceLaunch: mcapNow && mcap0 ? mcapNow / mcap0 : null, change24: change24(t, now),
          liquidityUsd: t.dex?.liquidityUsd ?? null, onDexScreener: Boolean(t.dex), verdict: t.verdict,
          launcher: t.launcher, keepsPct: t.keepsPct,
          links: { uniswap: t.verdict?.verdict === "avoid" ? null : uniswapUrl(t), chart: chartUrl(t), dexscreener: t.dex?.url ?? null, repo: t.repo },
        };
      });
    const rank = { safe: 0, caution: 1, unchecked: 2, avoid: 3 } as const;
    const by: Record<Sort, (a: (typeof rows)[number], b: (typeof rows)[number]) => number> = {
      mcap: (a, b) => (b.mcapNow ?? -1) - (a.mcapNow ?? -1),
      new: (a, b) => b.launch - a.launch,
      move: (a, b) => (b.change24 ?? -9) - (a.change24 ?? -9),
      safe: (a, b) => rank[a.verdict?.verdict ?? "unchecked"] - rank[b.verdict?.verdict ?? "unchecked"] || (b.mcapNow ?? -1) - (a.mcapNow ?? -1),
    };
    rows.sort(by[o.sort ?? "mcap"]);
    const nfts = Object.values(st.nfts).filter((n) => !o.hideNewerThan || Date.parse(n.at) <= o.hideNewerThan).sort((a, b) => b.launch - a.launch);
    return { count: rows.length, tokens: rows.slice(0, o.limit ?? 120), nfts, verdicts: rows.filter((r) => r.verdict).length };
  }

  /** Every pool quote currency in the dex, for pricing. */
  const quotes = () => [...new Set(Object.values(st.tokens).map((t) => t.pool?.quote).filter((q): q is Address => Boolean(q)))];
  return { tick, view, quotes, size: () => ({ tokens: Object.keys(st.tokens).length, nfts: Object.keys(st.nfts).length }) };
}
export type Dex = ReturnType<typeof createDex>;
export const dexFile = () => join(config.dataDir, "sniper-dex.json");
