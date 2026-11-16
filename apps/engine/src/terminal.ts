import type { IncomingMessage, ServerResponse } from "node:http";
import type { Board, BoardRow } from "./launchpad.js";
import type { SolView } from "./sol-launch.js";
import type { GtNetwork, Trade } from "./sol-market.js";

/**
 * IMD TERMINAL: one token list for the front page and /discover, merged from what NIGHTSHIFT already reads.
 *  - Solana: the launches on NIGHTSHIFT's IMD launchpad (price, market cap and curve progress from the chain,
 *    through the engine's own reader; its 1h/24h change from the engine's price history).
 *  - Ethereum and Robinhood Chain: IMD's live coin launches (api.imd.fun/launches), priced by DexScreener,
 *    from the Ethereum launchpad's board (launchpad.ts, one cache shared with /launchpad/eth).
 *  - GeckoTerminal fills what those miss (24h volume, liquidity, trades, changes) through the engine's one
 *    GeckoTerminal budget (sol-market.ts): a few batched reads per build, never more than leaves the token
 *    pages room, each token's answer kept 5 minutes. Nothing is invented: a number nobody published is null.
 */

export type Chain = "sol" | "eth" | "rh";
export type TermToken = {
  id: string; chain: Chain; address: string; name: string; symbol: string; image: string | null;
  /** the token's page on NIGHTSHIFT */
  href: string;
  /** launched through NIGHTSHIFT (every Solana launch; Ethereum ones made from NIGHTSHIFT's launch form) */
  ours: boolean;
  /** the IMD swarm worked on it (every IMD launch; a Solana launch when its swarm job finished) */
  swarm: boolean;
  /** curve: on the Solana bonding curve; graduated: moved to its locked pool; pool: trading in a Uniswap v4 pool */
  status: "curve" | "graduated" | "pool";
  /** share of the Solana curve sold, 0 to 1 (null off Solana) */
  progress: number | null;
  launchNumber: number | null;
  createdAt: number;
  priceUsd: number | null; mcapUsd: number | null; liquidityUsd: number | null; vol24: number | null;
  change1h: number | null; change24h: number | null; buys24: number | null; sells24: number | null;
  /** the engine's own price line (Solana launches: one point a minute, the last 48) */
  spark: number[] | null;
  /** where the market numbers came from and when they were read */
  market: { from: string[]; at: number | null };
  /** the market cap is the fully diluted value (all of the supply at today's price): no circulating figure was published */
  capIsFdv?: boolean;
  /** one of the ecosystem's core tokens (IMD, $SHIFT), pinned at the top of the terminal */
  core?: boolean;
};
export type Activity = {
  kind: "launch" | "buy" | "sell"; at: number; token: Pick<TermToken, "id" | "chain" | "symbol" | "name" | "image" | "href">;
  usd: number | null; account: string | null; tx: string | null;
};
export type Source = { id: "sol" | "imd" | "gt"; label: string; at: number | null; ok: boolean; note?: string };
export type TokenList = { at: number; tokens: TermToken[]; core: TermToken[]; sources: Source[]; prices: { solUsd: number | null; imdUsd: number | null; ethUsd: number | null } };
export type Sections = Record<"trending" | "fresh" | "graduating" | "gainers" | "losers" | "volume", TermToken[]>;

/** What GeckoTerminal says about one token (its busiest pool for the changes and trades). */
export type GtToken = {
  priceUsd: number | null; mcapUsd: number | null; liquidityUsd: number | null; vol24: number | null;
  change1h: number | null; change24h: number | null; buys24: number | null; sells24: number | null; image: string | null; capIsFdv: boolean;
};

/** A Solana curve this far sold is "about to graduate". */
export const GRADUATING = 0.7;
/** Ethereum pools with less than this in them move on almost nothing: left out of the gainers and losers. */
export const MIN_MOVER_LIQUIDITY = 1_000;
export const SECTION_SIZE = 12;
const GT_TTL = 5 * 60_000;
const GT_BATCH = 30;
/** GeckoTerminal reads per build at most, and the calls left in the minute below which the Terminal reads none. */
const GT_PER_BUILD = 3;
const GT_KEEP_FREE = 10;
const NETWORK: Record<Chain, GtNetwork> = { sol: "solana", eth: "eth", rh: "robinhood" };

const n = (v: unknown): number | null => { if (v == null || v === "") return null; const x = typeof v === "number" ? v : Number(v); return Number.isFinite(x) ? x : null; };
const pos = (v: unknown): number | null => { const x = n(v); return x != null && x > 0 ? x : null; };
const https = (v: unknown): string | null => { const s = typeof v === "string" ? v.trim() : ""; return /^https:\/\/[^\s"'<>]{4,400}$/.test(s) && !s.includes("missing.png") ? s : null; };
/** Our own logo paths (/api/sol/img/…) or an https image. */
const img = (v: unknown): string | null => { const s = typeof v === "string" ? v.trim() : ""; return /^\/api\/sol\/img\/[A-Za-z0-9-]{32,60}\.(?:webp|png|jpg|gif)$/.test(s) || /^\/brand\/[a-z0-9-]{1,60}\.(?:png|svg|webp)$/.test(s) ? s : https(s); };
const keyOf = (chain: Chain, address: string) => (chain === "sol" ? address : address.toLowerCase());

/** GeckoTerminal's /tokens/multi answer (with include=top_pools) as one row per token address. */
export function parseGtTokens(j: unknown, chain: Chain): Map<string, GtToken> {
  const out = new Map<string, GtToken>();
  const data = (j as { data?: unknown })?.data, included = (j as { included?: unknown })?.included;
  if (!Array.isArray(data)) return out;
  const pools = new Map<string, Record<string, unknown>>();
  if (Array.isArray(included)) for (const p of included) { const id = (p as { id?: unknown })?.id, a = (p as { attributes?: Record<string, unknown> })?.attributes; if (typeof id === "string" && a) pools.set(id, a); }
  for (const t of data) {
    const a = (t as { attributes?: Record<string, unknown> })?.attributes;
    const address = typeof a?.address === "string" ? a.address : "";
    if (!a || !address) continue;
    // the token's deepest pool: its changes and trade counts
    const ids = ((t as { relationships?: { top_pools?: { data?: { id?: string }[] } } }).relationships?.top_pools?.data ?? []).map((x) => x?.id).filter((x): x is string => typeof x === "string");
    const top = ids.map((id) => pools.get(id)).filter((x): x is Record<string, unknown> => !!x).sort((x, y) => (n(y.reserve_in_usd) ?? 0) - (n(x.reserve_in_usd) ?? 0))[0];
    const ch = (top?.price_change_percentage ?? {}) as Record<string, unknown>, tx = ((top?.transactions as Record<string, { buys?: unknown; sells?: unknown }> | undefined)?.h24) ?? {};
    const vol = (a.volume_usd ?? {}) as Record<string, unknown>;
    const liquid = (pos(a.total_reserve_in_usd) ?? 0) > 0;
    out.set(keyOf(chain, address), {
      priceUsd: pos(a.price_usd), mcapUsd: pos(a.market_cap_usd) ?? pos(a.fdv_usd), capIsFdv: !pos(a.market_cap_usd) && !!pos(a.fdv_usd), liquidityUsd: n(a.total_reserve_in_usd), vol24: n(vol.h24),
      // a pool with nothing in it reports "0%" for every change: that is no data, not a flat price
      change1h: liquid ? n(ch.h1) : null, change24h: liquid ? n(ch.h24) : null, buys24: n(tx.buys), sells24: n(tx.sells), image: https(a.image_url),
    });
  }
  return out;
}

/** A launch on NIGHTSHIFT's Solana launchpad as a Terminal token (the chain's numbers first, GeckoTerminal's after). */
export function fromSol(l: SolView, o: { spark: number[]; solUsd: number | null; gt?: { v: GtToken; at: number } | null; at: number }): TermToken {
  const g = o.gt?.v ?? null, usd = o.solUsd;
  const w = l.swarm, swarmLogo = w?.logoHosted || w?.logo || "";
  const image = img((w?.picks.includes("logo") && swarmLogo) || l.image || swarmLogo) ?? g?.image ?? null;
  const chainPrice = l.priceSol != null && usd ? l.priceSol * usd : null, chainCap = l.mcapSol != null && usd ? l.mcapSol * usd : null;
  const from = [chainPrice != null ? "Solana" : null, g ? "GeckoTerminal" : null].filter((x): x is string => !!x);
  return {
    id: `sol:${l.mint}`, chain: "sol", address: l.mint, name: l.name, symbol: l.symbol, image, href: `/launchpad/sol/${l.mint}`,
    ours: true, swarm: w?.state === "done", status: l.status === "graduated" ? "graduated" : "curve", progress: l.status === "graduated" ? 1 : Math.max(0, Math.min(1, l.progress)),
    launchNumber: null, createdAt: l.launchedAt ?? l.createdAt,
    priceUsd: chainPrice ?? g?.priceUsd ?? null, mcapUsd: chainCap ?? g?.mcapUsd ?? null, liquidityUsd: g?.liquidityUsd ?? null, vol24: g?.vol24 ?? null,
    change1h: l.change1h ?? g?.change1h ?? null, change24h: l.change24h ?? g?.change24h ?? null, buys24: g?.buys24 ?? null, sells24: g?.sells24 ?? null,
    spark: o.spark.length >= 2 ? o.spark : null,
    market: { from, at: from.length ? Math.max(chainPrice != null ? o.at : 0, o.gt?.at ?? 0) : null },
    ...(chainCap == null && g?.capIsFdv ? { capIsFdv: true } : {}),
  };
}

/** An IMD launch from the Ethereum launchpad's board (DexScreener's numbers first, GeckoTerminal's after). */
export function fromBoard(r: BoardRow, o: { boardAt: number; gt?: { v: GtToken; at: number } | null }): TermToken {
  const m = r.market, g = o.gt?.v ?? null;
  const from = [m ? "DexScreener" : null, g ? "GeckoTerminal" : null].filter((x): x is string => !!x);
  const created = Date.parse(r.createdAt);
  return {
    id: `${r.chain}:${r.token.toLowerCase()}`, chain: r.chain, address: r.token.toLowerCase(), name: r.name, symbol: r.symbol ?? m?.symbol ?? "",
    image: img(r.logo) ?? g?.image ?? null, href: `/launchpad/t/${r.launchNumber}`, ours: r.ours, swarm: true, status: "pool", progress: null,
    launchNumber: r.launchNumber, createdAt: Number.isFinite(created) ? created : 0,
    priceUsd: pos(m?.priceUsd) ?? g?.priceUsd ?? null, mcapUsd: pos(m?.mcapUsd) ?? g?.mcapUsd ?? null, liquidityUsd: n(m?.liquidityUsd) ?? g?.liquidityUsd ?? null,
    vol24: n(m?.volume24) ?? g?.vol24 ?? null, change1h: m ? n(m.change1h) : g?.change1h ?? null, change24h: m ? n(m.change24h) : g?.change24h ?? null,
    buys24: m ? n(m.buys24) : g?.buys24 ?? null, sells24: m ? n(m.sells24) : g?.sells24 ?? null, spark: null,
    market: { from, at: from.length ? Math.max(m ? o.boardAt : 0, o.gt?.at ?? 0) : null },
    ...(!pos(m?.mcapUsd) && g?.capIsFdv ? { capIsFdv: true } : {}),
  };
}

// ---------------------------------------------------------------- the core tokens

/**
 * The ecosystem's own tokens, pinned at the top of the terminal: IMD (its deepest ETH/IMD Uniswap v4 pool, the one
 * the burn reserve buys in) and $SHIFT (its SHIFT/ETH v4 pool, NIGHTSHIFT's hook). Numbers from GeckoTerminal's
 * read of those two pools; trading goes through NIGHTSHIFT Swap.
 */
export const CORE = [
  { symbol: "IMD", name: "IMD", address: "0xd34a99bc0f67ae1bbd63c660e6d0b0dd03e263b7", pool: "0xb07d640fd9e2eb9dc81b953c8e4fd006bdfeaf276010fb5418eb763ca15abfb3", image: null, href: "/swap?to=eth:0xd34a99bc0f67ae1bbd63c660e6d0b0dd03e263b7&from=base" },
  { symbol: "SHIFT", name: "NIGHTSHIFT", address: "0xe5e58e53d0bb204aa62c995a6c8cc8a48e60c3ac", pool: "0x6775f516eda3ee5cde65ceff94ce98935c7dc1e4d183238a8effa4d50e5c5ed4", image: "/brand/shift-icon-512.png", href: "/swap?pool" },
] as const;

/** GeckoTerminal's /pools/multi answer (include=base_token) as one row per pool, for the token on its base side only. */
export function parseGtPools(j: unknown): Map<string, GtToken & { base: string }> {
  const out = new Map<string, GtToken & { base: string }>();
  const data = (j as { data?: unknown })?.data, included = (j as { included?: unknown })?.included;
  if (!Array.isArray(data)) return out;
  const images = new Map<string, string | null>();
  if (Array.isArray(included)) for (const t of included) { const id = (t as { id?: unknown })?.id; if (typeof id === "string") images.set(id, https((t as { attributes?: { image_url?: unknown } }).attributes?.image_url)); }
  for (const p of data) {
    const a = (p as { attributes?: Record<string, unknown> })?.attributes;
    const baseId = (p as { relationships?: { base_token?: { data?: { id?: string } } } }).relationships?.base_token?.data?.id ?? "";
    const address = typeof a?.address === "string" ? a.address.toLowerCase() : "";
    if (!a || !address || !baseId) continue;
    const ch = (a.price_change_percentage ?? {}) as Record<string, unknown>, tx = ((a.transactions as Record<string, { buys?: unknown; sells?: unknown }> | undefined)?.h24) ?? {};
    const liquid = (pos(a.reserve_in_usd) ?? 0) > 0;
    out.set(address, {
      base: baseId.replace(/^[a-z]+_/, "").toLowerCase(),
      priceUsd: pos(a.base_token_price_usd), mcapUsd: pos(a.market_cap_usd) ?? pos(a.fdv_usd), capIsFdv: !pos(a.market_cap_usd) && !!pos(a.fdv_usd),
      liquidityUsd: n(a.reserve_in_usd), vol24: n((a.volume_usd as Record<string, unknown> | undefined)?.h24),
      change1h: liquid ? n(ch.h1) : null, change24h: liquid ? n(ch.h24) : null, buys24: n(tx.buys), sells24: n(tx.sells), image: images.get(baseId) ?? null,
    });
  }
  return out;
}

/** A core token as the terminal shows it: its pool's numbers when the token is that pool's base, nothing invented when not. */
export function coreToken(c: (typeof CORE)[number], g: (GtToken & { base: string }) | null, at: number | null): TermToken {
  const ok = g && g.base === c.address ? g : null;
  return {
    id: `eth:${c.address}`, chain: "eth", address: c.address, name: c.name, symbol: c.symbol, image: c.image ?? ok?.image ?? null, href: c.href,
    ours: c.symbol === "SHIFT", swarm: false, status: "pool", progress: null, launchNumber: null, createdAt: 0,
    priceUsd: ok?.priceUsd ?? null, mcapUsd: ok?.mcapUsd ?? null, liquidityUsd: ok?.liquidityUsd ?? null, vol24: ok?.vol24 ?? null,
    change1h: ok?.change1h ?? null, change24h: ok?.change24h ?? null, buys24: ok?.buys24 ?? null, sells24: ok?.sells24 ?? null, spark: null,
    market: { from: ok ? ["GeckoTerminal"] : [], at: ok ? at : null }, core: true, ...(ok?.capIsFdv ? { capIsFdv: true } : {}),
  };
}

/** One list, one row per token (the first seen wins: Solana launches, then IMD's), newest first. */
export function mergeTokens(...lists: TermToken[][]): TermToken[] {
  const seen = new Map<string, TermToken>();
  for (const list of lists) for (const t of list) if (!seen.has(t.id)) seen.set(t.id, t);
  return [...seen.values()].sort((a, b) => b.createdAt - a.createdAt);
}

const trades24 = (t: TermToken) => (t.buys24 ?? 0) + (t.sells24 ?? 0);
/** Can its price move be trusted: a Solana curve always (the curve is the liquidity), a pool with real money in it. */
export const movable = (t: TermToken) => t.chain === "sol" || (t.liquidityUsd ?? 0) >= MIN_MOVER_LIQUIDITY;

/** The front page's rows, each from published numbers only (a token without the number is not in that row). */
export function sections(tokens: TermToken[], size = SECTION_SIZE): Sections {
  const top = (xs: TermToken[]) => xs.slice(0, size);
  return {
    // most trades in 24 hours, then the most volume
    trending: top(tokens.filter((t) => trades24(t) > 0 || (t.vol24 ?? 0) > 0).sort((a, b) => trades24(b) - trades24(a) || (b.vol24 ?? 0) - (a.vol24 ?? 0))),
    fresh: top([...tokens].sort((a, b) => b.createdAt - a.createdAt)),
    graduating: top(tokens.filter((t) => t.status === "curve" && (t.progress ?? 0) >= GRADUATING).sort((a, b) => (b.progress ?? 0) - (a.progress ?? 0))),
    gainers: top(tokens.filter((t) => movable(t) && (t.change24h ?? 0) > 0).sort((a, b) => b.change24h! - a.change24h!)),
    losers: top(tokens.filter((t) => movable(t) && (t.change24h ?? 0) < 0).sort((a, b) => a.change24h! - b.change24h!)),
    volume: top(tokens.filter((t) => (t.vol24 ?? 0) > 0).sort((a, b) => b.vol24! - a.vol24!)),
  };
}

/** The live activity line: launches (Solana and IMD), and recent trades on Solana launches, newest first. */
export function activityOf(tokens: TermToken[], trades: { token: TermToken; trades: Trade[] }[], now: number, max = 24): Activity[] {
  const brief = (t: TermToken) => ({ id: t.id, chain: t.chain, symbol: t.symbol, name: t.name, image: t.image, href: t.href });
  const out: Activity[] = [];
  for (const t of tokens) if (t.createdAt > 0 && now - t.createdAt < 7 * 86_400_000 && t.createdAt <= now + 60_000) out.push({ kind: "launch", at: t.createdAt, token: brief(t), usd: null, account: null, tx: null });
  for (const { token, trades: list } of trades) for (const x of list.slice(0, 8)) out.push({ kind: x.kind, at: x.at, token: brief(token), usd: x.usd > 0 ? x.usd : null, account: x.account, tx: x.tx });
  return out.sort((a, b) => b.at - a.at).slice(0, max);
}

// ---------------------------------------------------------------- the reader

export type TerminalDeps = {
  now: () => number;
  /** NIGHTSHIFT's Solana launches (live and graduated), each one's price line, SOL in USD */
  sol: () => { list: SolView[]; spark: (mint: string) => number[]; solUsd: () => Promise<number | null> };
  /** the IMD launch board (Ethereum, Robinhood Chain) */
  board: () => Promise<Board>;
  /** one GeckoTerminal read inside the engine's budget, and the calls left in this minute */
  gt: { read: (network: GtNetwork, path: string) => Promise<unknown>; left: () => number };
  /** a Solana launch's latest trades (cached by the market reader) */
  trades: (o: { mint: string; pool: string | null; graduated: boolean }) => Promise<{ trades: Trade[] }>;
};

export class Terminal {
  private gtRows = new Map<string, { at: number; v: GtToken | null }>();
  private list: TokenList | null = null;
  private building: Promise<TokenList> | null = null;
  private lastBoard: Board | null = null;
  private corePools: { at: number; v: Map<string, GtToken & { base: string }> } | null = null;
  private act: { at: number; v: Activity[] } | null = null;
  private actBusy: Promise<Activity[]> | null = null;
  static readonly TTL = { list: 60_000, activity: 60_000 };

  constructor(private d: TerminalDeps) {}

  /** The merged list, rebuilt at most once a minute (one build at a time, shared). */
  async tokens(): Promise<TokenList> {
    if (this.list && this.d.now() - this.list.at < Terminal.TTL.list) return this.list;
    if (!this.building) this.building = this.build().then((v) => (this.list = v)).finally(() => { this.building = null; });
    // a stale list is answered at once while the next one builds
    return this.list ?? this.building;
  }

  private async build(): Promise<TokenList> {
    const now = this.d.now();
    const sol = this.d.sol();
    const [solUsd, board] = await Promise.all([sol.solUsd().catch(() => null), this.d.board().then((b) => (this.lastBoard = b), () => this.lastBoard)]);
    const listed = sol.list.filter((l) => l.status === "live" || l.status === "graduated");
    const rows = board?.rows ?? [];
    await this.refreshCore();
    const gtNote = await this.refreshGt([...listed.map((l) => ({ chain: "sol" as const, address: l.mint })), ...rows.map((r) => ({ chain: r.chain, address: r.token }))]);
    const gt = (chain: Chain, a: string) => { const e = this.gtRows.get(`${chain}:${keyOf(chain, a)}`); return e?.v ? { v: e.v, at: e.at } : null; };
    const solTokens = listed.map((l) => fromSol(l, { spark: sol.spark(l.mint), solUsd, gt: gt("sol", l.mint), at: now }));
    const imdTokens = rows.map((r) => fromBoard(r, { boardAt: board!.at, gt: gt(r.chain, r.token) }));
    // the core tokens are pinned above the lists, not repeated in them ($SHIFT is also IMD launch #2124)
    const coreIds = new Set<string>(CORE.map((c) => `eth:${c.address}`));
    const tokens = mergeTokens(solTokens, imdTokens).filter((t) => !coreIds.has(t.id));
    const core = CORE.map((c) => coreToken(c, this.corePools?.v.get(c.pool) ?? null, this.corePools?.at ?? null));
    const gtAts = [...this.gtRows.values()].filter((e) => e.v).map((e) => e.at);
    return {
      at: now, tokens, core,
      prices: { solUsd, imdUsd: board?.usd.imd ?? null, ethUsd: board?.usd.eth ?? null },
      sources: [
        { id: "sol", label: "NIGHTSHIFT's Solana launches, read from the chain about once a minute", at: now, ok: true },
        { id: "imd", label: "IMD launches on Ethereum and Robinhood Chain (api.imd.fun), priced by DexScreener", at: board?.at ?? null, ok: !!board, ...(board ? {} : { note: "IMD's launch list could not be read right now." }) },
        { id: "gt", label: "GeckoTerminal: volume, liquidity and trades it indexes", at: gtAts.length ? Math.min(...gtAts) : null, ok: gtAts.length > 0, ...(gtNote ? { note: gtNote } : {}) },
      ],
    };
  }

  /** IMD's and $SHIFT's pools: one GeckoTerminal read every 5 minutes, first in line; the last answer kept when it fails. */
  private async refreshCore(): Promise<void> {
    if (this.corePools && this.d.now() - this.corePools.at < GT_TTL) return;
    if (this.d.gt.left() <= GT_KEEP_FREE) return;
    try {
      const v = parseGtPools(await this.d.gt.read("eth", `/pools/multi/${CORE.map((c) => c.pool).join(",")}?include=base_token`));
      if (v.size) this.corePools = { at: this.d.now(), v };
    } catch { /* the last answer stays */ }
  }

  /**
   * GeckoTerminal for the tokens it has not been asked about lately: missing ones first, then the oldest answers,
   * 30 a call, at most GT_PER_BUILD calls, and none when the engine's budget runs low (the token pages come first).
   */
  private async refreshGt(want: { chain: Chain; address: string }[]): Promise<string | null> {
    const now = this.d.now();
    const age = (k: string) => { const e = this.gtRows.get(k); return e ? now - e.at : Infinity; };
    const stale = want.map((w) => ({ ...w, k: `${w.chain}:${keyOf(w.chain, w.address)}` })).filter((w) => age(w.k) >= GT_TTL);
    if (!stale.length) return null;
    // the oldest first (never asked = Infinity); Solana before the rest when equal
    stale.sort((a, b) => age(b.k) - age(a.k) || (a.chain === "sol" ? -1 : 0) - (b.chain === "sol" ? -1 : 0));
    let calls = 0, note: string | null = null;
    for (const chain of ["sol", "eth", "rh"] as const) {
      const mine = [...new Map(stale.filter((w) => w.chain === chain).map((w) => [w.k, w])).values()];
      for (let i = 0; i < mine.length && calls < GT_PER_BUILD; i += GT_BATCH) {
        if (this.d.gt.left() <= GT_KEEP_FREE) return "GeckoTerminal is busy: its numbers fill in over the next minutes.";
        const batch = mine.slice(i, i + GT_BATCH);
        calls++;
        try {
          const got = parseGtTokens(await this.d.gt.read(NETWORK[chain], `/tokens/multi/${batch.map((w) => w.address).join(",")}?include=top_pools`), chain);
          // a token GeckoTerminal does not know is remembered as nothing, so it is not asked again for 5 minutes
          for (const w of batch) this.gtRows.set(w.k, { at: now, v: got.get(keyOf(chain, w.address)) ?? null });
        } catch { note = "GeckoTerminal could not be read on the last try: its numbers may be a few minutes old."; }
      }
    }
    // keep the memory to the tokens still listed
    const live = new Set(want.map((w) => `${w.chain}:${keyOf(w.chain, w.address)}`));
    for (const k of this.gtRows.keys()) if (!live.has(k)) this.gtRows.delete(k);
    return note;
  }

  /** The live line: launches, and the latest trades of the three Solana launches that moved or launched last (once a minute). */
  async activity(): Promise<Activity[]> {
    if (this.act && this.d.now() - this.act.at < Terminal.TTL.activity) return this.act.v;
    if (!this.actBusy) {
      this.actBusy = (async () => {
        const { tokens } = await this.tokens();
        // the three that moved last (a launch the engine has not seen move yet counts from its launch)
        const last = (l: SolView) => l.movedAt ?? l.launchedAt ?? l.createdAt;
        const sol = this.d.sol().list.filter((l) => l.pool && (l.status === "live" || l.status === "graduated")).sort((a, b) => last(b) - last(a)).slice(0, 3);
        const trades = await Promise.all(sol.map(async (l) => {
          const token = tokens.find((t) => t.id === `sol:${l.mint}`);
          const r = token ? await this.d.trades({ mint: l.mint, pool: l.pool, graduated: l.status === "graduated" }).catch(() => ({ trades: [] as Trade[] })) : { trades: [] as Trade[] };
          return token ? { token, trades: r.trades } : null;
        }));
        const v = activityOf(tokens, trades.filter((x): x is { token: TermToken; trades: Trade[] } => !!x), this.d.now());
        this.act = { at: this.d.now(), v };
        return v;
      })().finally(() => { this.actBusy = null; });
    }
    return this.act?.v ?? this.actBusy;
  }

  /** The front page in one answer: the sections, the live line, the counts, where it all came from. */
  async home() {
    const list = await this.tokens();
    const activity = await this.activity().catch(() => [] as Activity[]);
    const t = list.tokens;
    return {
      at: list.at, prices: list.prices, sources: list.sources, core: list.core, sections: sections(t), activity,
      counts: { tokens: t.length, sol: t.filter((x) => x.chain === "sol").length, eth: t.filter((x) => x.chain === "eth").length, rh: t.filter((x) => x.chain === "rh").length, curve: t.filter((x) => x.status === "curve").length, graduated: t.filter((x) => x.status === "graduated").length },
    };
  }
}

// ---------------------------------------------------------------- the routes

type Context = { json(res: ServerResponse, status: number, body: unknown, headers?: Record<string, string>): void; limited(req: IncomingMessage, key: string, max: number, windowMs: number): boolean };

let shared: Terminal | null = null;
async function liveTerminal(): Promise<Terminal> {
  if (shared) return shared;
  // loaded on first use: the Solana launchpad and the IMD board start their own readers
  const [{ solPad }, { launchpadBoard }, { solMarket }] = await Promise.all([import("./sol-routes.js"), import("./launchpad.js"), import("./sol-market.js")]);
  const mk = solMarket();
  shared ??= new Terminal({
    now: Date.now,
    sol: () => { const pad = solPad(); return { list: pad.list("new"), spark: (m) => pad.spark(m), solUsd: () => pad.solUsd() }; },
    board: launchpadBoard,
    gt: { read: (net, path) => mk.read(net, path), left: () => mk.left() },
    trades: (o) => mk.trades(o),
  });
  return shared;
}

/** /api/terminal/home (the front page) and /api/terminal/tokens (the directory). Public, read-only. */
export async function terminalRoutes(req: IncomingMessage, res: ServerResponse, p: string, ctx: Context, term?: Terminal): Promise<boolean> {
  if (!p.startsWith("/api/terminal/") || req.method !== "GET") return false;
  const reply = (code: number, body: unknown, cache = "no-store") => { ctx.json(res, code, body, { "Cache-Control": cache, "Access-Control-Allow-Origin": "*" }); return true; };
  if (p !== "/api/terminal/home" && p !== "/api/terminal/tokens") return reply(404, { error: "not found" });
  if (ctx.limited(req, "terminal", 120, 60_000)) return reply(429, { error: "Too many requests. Wait a minute." });
  try {
    const t = term ?? await liveTerminal();
    return p === "/api/terminal/home" ? reply(200, await t.home(), "public, max-age=20") : reply(200, await t.tokens(), "public, max-age=30");
  } catch {
    return reply(503, { error: "The token list could not be read right now. Try again shortly." });
  }
}
