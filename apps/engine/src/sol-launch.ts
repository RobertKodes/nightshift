import { existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { writeAtomic } from "./atomic.js";
import { config } from "./config.js";
import { readSettings } from "./settings.js";

/**
 * IMD Launch on Solana, through NIGHTSHIFT: tokens launched on Meteora's Dynamic Bonding Curve with
 * NIGHTSHIFT as the launch partner, and the IMD swarm doing the work around every launch (a review of
 * each launch, and a website built by the swarm when the creator asks for one). IMD's own launches are
 * EVM-only; this is its Solana rail. The browser builds and signs every transaction with the creator's
 * own wallet; this module only:
 *  - hosts the token's metadata JSON and a small logo (the token's `uri`), written before the launch,
 *  - verifies a reported launch on chain: the pool at its derived address, on a config whose fees go to
 *    NIGHTSHIFT and which keeps the guarantees (frozen token, 100% locked graduated liquidity, DAMM v2),
 *  - reads each pool (price, market cap, progress, the creator's locked allocation), keeps a price
 *    history for the charts, and free safety checks,
 *  - orders the IMD swarm's review of each launch, and the swarm website a creator paid for in the launch,
 *  - proxies a whitelist of Solana JSON-RPC reads and sendTransaction, so an RPC key stays here.
 * NIGHTSHIFT never holds a creator's or a trader's key or funds.
 */

export const DBC_PROGRAM = "dbcij3LWUppWqq96dh6gJWwBifmcGfLSB5D4DuSMaqN";
export const WSOL = "So11111111111111111111111111111111111111112";
export const METAPLEX = "metaqbxxUerdq28cj1RbAWkYQm3ybzjb6a8bt518x1s";
const RPC_DEFAULT = { mainnet: "https://solana-rpc.publicnode.com", devnet: "https://api.devnet.solana.com" } as const;
export type SolNet = keyof typeof RPC_DEFAULT;
/** The swarm website a creator can add to a launch, paid in SOL inside the launch transaction. */
export const KIT_USD = 6;

export type SolSettings = { network: SolNet; rpc: string; config: string | null; partner: string | null; review: boolean; kit: boolean };
export function solSettings(): SolSettings {
  const s = readSettings() as Record<string, string | undefined>;
  const network: SolNet = s.SOL_NETWORK === "devnet" ? "devnet" : "mainnet";
  const isKey = (v?: string) => !!v && BASE58_KEY.test(v);
  return {
    network, rpc: s.SOL_RPC?.trim() || RPC_DEFAULT[network], config: isKey(s.SOL_DBC_CONFIG) ? s.SOL_DBC_CONFIG! : null, partner: isKey(s.SOL_PARTNER) ? s.SOL_PARTNER! : null,
    review: s.SOL_SWARM_REVIEW === "on", kit: s.SOL_KIT === "on",
  };
}

// ---------------------------------------------------------------- what a creator writes

export const BASE58_KEY = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
/** Control, zero-width and bidirectional characters out: they make a name display as something else (a reversed "PIRATE"). */
export const cleanText = (s: string) => s.replace(/[\u0000-\u001f\u007f-\u009f​-‏‪-‮⁠-⁩﻿]/g, "");
export type SolMeta = { mint: string; name: string; symbol: string; description: string; website: string; twitter: string; telegram: string; image: string };
/** What the creator chose on the page (shown on the token page; the chain is checked for the guarantees and the lock). */
export type SolOptions = { feeBps: number; startMcapUsd: number; graduateMcapUsd: number; sniper: string };
const IMAGE_MAX = 160_000; // bytes after the page's 256 px downscale (a webp is ~20-60 KB)
const IMAGE_TYPES: Record<string, string> = { "image/webp": "webp", "image/png": "png", "image/jpeg": "jpg", "image/gif": "gif" };

export class SolInputError extends Error { constructor(m: string, readonly status = 400) { super(m); } }

const httpsUrl = (v: unknown, host?: RegExp, label?: string): string => {
  const s = String(v ?? "").trim();
  if (!s) return "";
  let u: URL;
  try { u = new URL(s); } catch { throw new SolInputError(`Not a link: ${s.slice(0, 60)}`); }
  if (u.protocol !== "https:") throw new SolInputError("Links must start with https://");
  if (host && !host.test(u.hostname)) throw new SolInputError(`That link must point to ${label}.`);
  return u.toString().slice(0, 200);
};

const options = (v: unknown): SolOptions | null => {
  if (!v || typeof v !== "object") return null;
  const o = v as Record<string, unknown>;
  const n = (x: unknown) => (typeof x === "number" && Number.isFinite(x) ? x : 0);
  return { feeBps: n(o.feeBps), startMcapUsd: n(o.startMcapUsd), graduateMcapUsd: n(o.graduateMcapUsd), sniper: ["off", "standard", "strong"].includes(String(o.sniper)) ? String(o.sniper) : "standard" };
};

/** The creator's fields, checked; the image as bytes when uploaded. Throws SolInputError with the reason. */
export function checkMeta(b: Record<string, unknown>): { meta: Omit<SolMeta, "image">; image: { ext: string; bytes: Buffer } | { url: string } | null } {
  const mint = String(b.mint ?? "").trim();
  if (!BASE58_KEY.test(mint)) throw new SolInputError("The token address is missing or invalid.");
  const name = cleanText(String(b.name ?? "")).replace(/\s+/g, " ").trim();
  if (name.length < 2 || name.length > 32) throw new SolInputError("The name needs 2 to 32 characters.");
  const symbol = String(b.symbol ?? "").trim().toUpperCase();
  if (!/^[A-Z0-9]{2,10}$/.test(symbol)) throw new SolInputError("The ticker needs 2 to 10 letters or digits.");
  const description = cleanText(String(b.description ?? "")).trim().slice(0, 500);
  const website = httpsUrl(b.website);
  const twitter = httpsUrl(b.twitter, /^(www\.)?(x|twitter)\.com$/, "x.com");
  const telegram = httpsUrl(b.telegram, /^(www\.)?t\.me$/, "t.me");
  let image: { ext: string; bytes: Buffer } | { url: string } | null = null;
  const data = String(b.image ?? "");
  if (data) {
    const m = /^data:(image\/(?:webp|png|jpeg|gif));base64,([A-Za-z0-9+/=]+)$/.exec(data);
    if (!m) throw new SolInputError("The logo must be a webp, png, jpg or gif image.");
    const bytes = Buffer.from(m[2]!, "base64");
    if (bytes.length > IMAGE_MAX) throw new SolInputError("The logo is too large. Use an image under 160 KB.");
    image = { ext: IMAGE_TYPES[m[1]!]!, bytes };
  } else if (b.imageUrl) image = { url: httpsUrl(b.imageUrl) };
  if (!image) throw new SolInputError("Add a logo for the token.");
  return { meta: { mint, name, symbol, description, website, twitter, telegram }, image };
}

/** The token's metadata JSON, in the shape wallets, explorers and Jupiter read. */
export function metaJson(m: SolMeta, site: string) {
  const type = m.image.endsWith(".png") ? "image/png" : m.image.endsWith(".gif") ? "image/gif" : m.image.endsWith(".jpg") ? "image/jpeg" : "image/webp";
  return {
    name: m.name, symbol: m.symbol, description: m.description, image: m.image,
    external_url: m.website || `${site}/launchpad/sol/${m.mint}`,
    extensions: { website: m.website || undefined, twitter: m.twitter || undefined, telegram: m.telegram || undefined, launchpad: `${site}/launchpad/sol/${m.mint}` },
    properties: { category: "image", files: m.image ? [{ uri: m.image, type }] : [] },
  };
}

// ---------------------------------------------------------------- what the chain says

export type PoolView = {
  pool: string; config: string; creator: string; baseMint: string; baseVault: string;
  quoteReserve: bigint; sqrtPrice: bigint; migrated: boolean; activationPoint: number;
};
export type ConfigView = {
  config: string; feeClaimer: string; leftoverReceiver: string; quoteMint: string; threshold: bigint; tokenDecimal: number; supply: bigint; tokenUpdateAuthority: number;
  creatorFeePct: number; partnerLockedPct: number; creatorLockedPct: number; partnerLpPct: number; creatorLpPct: number; migrationOption: number;
  cliffFeeNumerator: bigint; poolCreationFee: bigint;
  /** the creator's locked allocation (Meteora locked vesting): released after graduation + cliff, over the periods */
  devLocked: bigint; devCliffSecs: number; devPeriods: number; devPeriodSecs: number;
};
export type MintView = { mintAuthority: string | null; freezeAuthority: string | null; supply: bigint; decimals: number };
export type Holder = { owner: string | null; account: string; amount: bigint };

/** The chain reads this module needs; sol-chain.ts uses Meteora's SDK, tests pass a fake. */
export type SolChain = {
  poolOf(config: string, mint: string): Promise<PoolView | null>;
  pools(addresses: string[]): Promise<(PoolView | null)[]>;
  config(config: string): Promise<ConfigView | null>;
  mint(mint: string): Promise<MintView | null>;
  holders(mint: string): Promise<Holder[] | null>;
  /** launches on a config since the newest signature seen, each with its base mint (the backstop scan) */
  newLaunches(config: string, since: string | null): Promise<{ newest: string | null; mints: { mint: string; signature: string; at: number }[] }>;
  onchainMeta(mint: string): Promise<{ name: string; symbol: string; uri: string } | null>;
  /** lamports the account received in a confirmed transaction (0 if none) */
  paidTo(signature: string, account: string): Promise<bigint>;
  solUsd(): Promise<number | null>;
};

/** The swarm's work for one launch, ordered through the Swarm Desk (see houseOrder). */
export type SwarmWork = { ref: string; state: "queued" | "running" | "done" | "failed" | "off"; job: string | null; url: string | null; note?: string };
/** How the engine places and follows the IMD swarm's work; server.ts passes the live Swarm Desk. */
export type SwarmPort = {
  /** false while the Swarm Desk is not running: no reviews or kits are offered then */
  ready?(): boolean;
  order(kind: "research" | "website", brief: string, ref: string): Promise<void>;
  follow(ref: string): Promise<{ status: string; job: string | null; site: string | null } | null>;
};

export type SolLaunch = SolMeta & {
  config: string; pool: string | null; creator: string | null; signature: string | null; createdAt: number; source: "nightshift" | "elsewhere";
  status: "pending" | "live" | "graduated"; quoteReserve: string; priceSol: number | null; mcapSol: number | null; progress: number;
  graduateSol: number | null; options: SolOptions | null;
  dev: { pct: number; cliffDays: number; vestDays: number } | null;
  checks: SolCheck[]; checkedAt: number;
  change1h: number | null; change24h: number | null; movedAt: number | null;
  review: SwarmWork | null; kit: (SwarmWork & { paidSol: number }) | null; kitWanted?: boolean;
};
export type SolCheck = { key: string; ok: boolean | null; says: string };

/** Price in SOL per whole token from a Q64.64 sqrt price (quote atoms per base atom, squared). */
export function priceFromSqrt(sqrtPrice: bigint, baseDecimals: number, quoteDecimals = 9): number {
  const s = Number(sqrtPrice) / 2 ** 64;
  return s * s * 10 ** (baseDecimals - quoteDecimals);
}

/** The creator's locked allocation as the page shows it. */
export function devLock(c: ConfigView): SolLaunch["dev"] {
  if (c.devLocked <= 0n || c.supply <= 0n) return null;
  // Meteora splits the lock into equal periods, so 70% can land a hair under: shown to one decimal
  return { pct: Math.round((Number(c.devLocked) / Number(c.supply)) * 1000) / 10, cliffDays: Math.round(c.devCliffSecs / 86_400), vestDays: Math.round((c.devPeriods * c.devPeriodSecs) / 86_400) };
}

/** The free checks every listed token gets, from what the chain says. */
export function safetyChecks(mint: MintView | null, holders: Holder[] | null, pool: PoolView | null, launchesByCreator: number, dev: SolLaunch["dev"] = null): SolCheck[] {
  const out: SolCheck[] = [];
  if (mint) {
    out.push({ key: "mint", ok: mint.mintAuthority === null, says: mint.mintAuthority === null ? "Nobody can mint more: the supply is fixed." : `Someone can still mint more (${mint.mintAuthority.slice(0, 4)}…).` });
    out.push({ key: "freeze", ok: mint.freezeAuthority === null, says: mint.freezeAuthority === null ? "Nobody can freeze holders' tokens." : "Someone can freeze holders' tokens." });
  } else out.push({ key: "mint", ok: null, says: "The token could not be read right now." });
  if (dev) out.push({ key: "devlock", ok: true, says: `${dev.pct}% is the creator's, locked by Meteora: nothing moves before graduation, then ${dev.cliffDays ? `${dev.cliffDays} days, then ` : ""}released daily over ${dev.vestDays} days.` });
  if (holders && mint && mint.supply > 0n) {
    // the pool's own vault holds the unsold curve: it is not a holder
    const rest = holders.filter((h) => h.account !== pool?.baseVault && h.owner !== pool?.pool);
    const top10 = rest.slice(0, 10).reduce((a, h) => a + h.amount, 0n);
    const pct = Number((top10 * 10_000n) / mint.supply) / 100;
    const creator = pool ? rest.filter((h) => h.owner === pool.creator).reduce((a, h) => a + h.amount, 0n) : 0n;
    const cpct = Number((creator * 10_000n) / mint.supply) / 100;
    out.push({ key: "top10", ok: pct <= 30, says: `The top 10 wallets hold ${pct.toFixed(1)}% of the supply${pct > 30 ? ": concentrated" : ""}.` });
    out.push({ key: "creator", ok: cpct <= 5, says: `The creator's wallet holds ${cpct.toFixed(1)}%${cpct > 5 ? ": more than 5%" : ""}.` });
  } else out.push({ key: "top10", ok: null, says: "Holders need a keyed Solana RPC to read." });
  out.push({ key: "serial", ok: launchesByCreator <= 3, says: launchesByCreator <= 1 ? "The creator's first launch here." : `The creator launched ${launchesByCreator} tokens here${launchesByCreator > 3 ? ": a serial launcher" : ""}.` });
  return out;
}

/** What the config must keep for a launch to be listed: NIGHTSHIFT as partner and the guarantees. */
export function termsProblems(c: ConfigView, partner: string): string[] {
  const bad: string[] = [];
  if (c.feeClaimer !== partner) bad.push("its fees go to another wallet");
  if (c.leftoverReceiver !== partner) bad.push("its leftover goes to another wallet");
  if (c.quoteMint !== WSOL) bad.push("it is not priced in SOL");
  if (c.tokenUpdateAuthority !== 1) bad.push("its tokens are not frozen");
  if (c.partnerLpPct + c.creatorLpPct !== 0 || c.partnerLockedPct + c.creatorLockedPct !== 100) bad.push("its graduated liquidity is not 100% locked");
  if (c.migrationOption !== 1) bad.push("it does not graduate to DAMM v2");
  return bad;
}

/** The brief for the IMD swarm's review of a launch: a sourced report a buyer can read. */
export function reviewBrief(l: SolLaunch, site: string): string {
  return [
    `Review this new Solana token launch for a buyer, as a short sourced report. Token ${l.name} ($${l.symbol}), mint ${l.mint}, launched ${new Date(l.createdAt).toISOString().slice(0, 10)} on a Meteora Dynamic Bonding Curve through NIGHTSHIFT (${site}/launchpad/sol/${l.mint}).`,
    `Creator wallet ${l.creator ?? "unknown"}.${l.dev ? ` The creator holds ${l.dev.pct}% locked by Meteora until graduation, then ${l.dev.cliffDays} days, then vesting over ${l.dev.vestDays} days.` : ""}`,
    `Links given: ${[l.website, l.twitter, l.telegram].filter(Boolean).join(", ") || "none"}. Description: ${l.description || "none"}.`,
    "Check from public sources (Solscan, the links, social accounts): the creator wallet's history and earlier tokens, whether the links are real and match, copies of other projects' names or art, and any scam reports. End with a one-line verdict: looks normal, unclear, or red flags, and why.",
  ].join(" ").slice(0, 1500);
}

/** The brief for the website the creator paid for: a one-page site for the token on IPFS. */
export function kitBrief(l: SolLaunch, site: string): string {
  return [
    `A one-page website for the Solana token ${l.name} ($${l.symbol}), mint ${l.mint}.`,
    l.description ? `What it is: ${l.description}` : "",
    `Use its logo ${l.image}. Show the token address with a copy button, a Buy button linking to ${site}/launchpad/sol/${l.mint}, and links: ${[l.website, l.twitter, l.telegram].filter(Boolean).join(", ") || "none yet"}.`,
    "Dark, bold, meme-friendly, readable on a phone. No wallet connection, no promises of returns.",
  ].filter(Boolean).join(" ").slice(0, 1500);
}

// ---------------------------------------------------------------- the store

type Stored = Record<string, SolLaunch>;
type History = Record<string, [number, number][]>;
const PENDING_TTL = 2 * 3600_000;
const DAY = 86_400_000;

export class SolLaunchpad {
  private launches: Stored;
  private history: History;
  private scanSince: Record<string, string | null> = {};
  private scannedAt = 0;
  private configs = new Map<string, ConfigView>();
  private usd: { v: number | null; at: number } = { v: null, at: 0 };
  private file: string;
  private histFile: string;
  private imgDir: string;

  constructor(private chain: SolChain, private settings: () => SolSettings = solSettings, private dir = config.dataDir, private site = config.publicUrl, private swarm: SwarmPort | null = null) {
    this.file = join(dir, "sol-launches.json");
    this.histFile = join(dir, "sol-history.json");
    this.imgDir = join(dir, "sol-img");
    this.launches = existsSync(this.file) ? (JSON.parse(readFileSync(this.file, "utf8")) as Stored) : {};
    this.history = existsSync(this.histFile) ? (JSON.parse(readFileSync(this.histFile, "utf8")) as History) : {};
  }

  private swarmOn(): boolean { return !!this.swarm && this.swarm.ready?.() !== false; }

  private save() { writeAtomic(this.file, JSON.stringify(this.launches)); writeAtomic(this.histFile, JSON.stringify(this.history)); }

  async solUsd(): Promise<number | null> {
    if (Date.now() - this.usd.at > 300_000) this.usd = { v: await this.chain.solUsd().catch(() => null) ?? this.usd.v, at: Date.now() };
    return this.usd.v;
  }

  /** The website add-on's price in SOL right now, or null when it is off. */
  async kitLamports(): Promise<bigint | null> {
    const u = await this.solUsd();
    return this.settings().kit && this.swarmOn() && u ? BigInt(Math.ceil((KIT_USD / u) * 1e3)) * 1_000_000n : null;
  }

  private async configOf(key: string): Promise<ConfigView | null> {
    const c = this.configs.get(key) ?? await this.chain.config(key).catch(() => null);
    if (c) this.configs.set(key, c);
    return c;
  }

  /** Before the launch: the creator's metadata and logo, kept under the mint the page generated. */
  saveMeta(b: Record<string, unknown>): { uri: string; image: string } {
    const { meta, image } = checkMeta(b);
    const was = this.launches[meta.mint];
    if (was && was.status !== "pending") throw new SolInputError("This token is already launched.", 409);
    let imageUrl: string;
    if (image && "bytes" in image) {
      mkdirSync(this.imgDir, { recursive: true });
      for (const e of Object.values(IMAGE_TYPES)) { const f = join(this.imgDir, `${meta.mint}.${e}`); if (existsSync(f)) unlinkSync(f); }
      writeFileSync(join(this.imgDir, `${meta.mint}.${image.ext}`), image.bytes);
      imageUrl = `${this.site}/api/sol/img/${meta.mint}.${image.ext}`;
    } else imageUrl = (image as { url: string }).url;
    this.launches[meta.mint] = {
      ...meta, image: imageUrl, config: "", pool: null, creator: null, signature: null, createdAt: Date.now(), source: "nightshift", status: "pending",
      quoteReserve: "0", priceSol: null, mcapSol: null, progress: 0, graduateSol: null, options: options(b.options), dev: null, checks: [], checkedAt: 0,
      change1h: null, change24h: null, movedAt: null, review: null, kit: null, kitWanted: b.kit === true,
    };
    this.save();
    return { uri: `${this.site}/api/sol/meta/${meta.mint}.json`, image: imageUrl };
  }

  meta(mint: string) { const l = this.launches[mint]; return l ? metaJson(l, this.site) : null; }

  image(file: string): { bytes: Buffer; type: string } | null {
    const m = /^([1-9A-HJ-NP-Za-km-z]{32,44})\.(webp|png|jpg|gif)$/.exec(file);
    if (!m) return null;
    const f = join(this.imgDir, file);
    if (!existsSync(f)) return null;
    return { bytes: readFileSync(f), type: m[2] === "jpg" ? "image/jpeg" : `image/${m[2]}` };
  }

  /** After the launch: the page reports the mint and its config; the pool must exist on chain on terms NIGHTSHIFT lists. */
  async launched(mint: string, signature: string, configKey?: string): Promise<SolLaunch> {
    const s = this.settings();
    if (!s.partner) throw new SolInputError("The Solana launchpad is not open yet.", 503);
    if (!BASE58_KEY.test(mint) || !/^[1-9A-HJ-NP-Za-km-z]{60,100}$/.test(signature)) throw new SolInputError("The token address or the transaction is invalid.");
    const key = configKey || s.config;
    if (!key || !BASE58_KEY.test(key)) throw new SolInputError("The launch's config is missing.");
    const l = this.launches[mint];
    if (!l) throw new SolInputError("Unknown token: save its details first.", 404);
    const c = await this.configOf(key);
    if (!c) throw new SolInputError("That config is not on Solana.", 409);
    const bad = termsProblems(c, s.partner);
    if (bad.length) throw new SolInputError(`That launch is not on NIGHTSHIFT terms: ${bad.join(", ")}.`, 409);
    let pool: PoolView | null = null;
    for (let i = 0; i < 6 && !pool; i++) { pool = await this.chain.poolOf(key, mint); if (!pool) await new Promise((r) => setTimeout(r, 1500 * (i + 1))); }
    if (!pool) throw new SolInputError("The launch is not on Solana yet. Try again in a moment.", 409);
    Object.assign(l, { config: key, pool: pool.pool, creator: pool.creator, signature, status: pool.migrated ? "graduated" : "live", createdAt: l.createdAt || Date.now(), dev: devLock(c) });
    await this.refreshOne(l, pool);
    // the website the creator paid for inside the launch transaction
    if (l.kitWanted && this.swarmOn()) {
      const price = await this.kitLamports();
      const paid = await this.chain.paidTo(signature, s.partner).catch(() => 0n);
      if (price && paid >= (price * 9n) / 10n) l.kit = { ref: `sol-kit:${mint}`, state: "queued", job: null, url: null, paidSol: Number(paid) / 1e9 };
    }
    if (s.review && this.swarmOn()) l.review = { ref: `sol-review:${mint}`, state: "queued", job: null, url: null };
    this.save();
    void this.work().catch(() => {});
    return l;
  }

  /** The launches, in the order a board asks for. */
  list(sort: "new" | "mcap" | "progress" | "movers" = "new"): SolLaunch[] {
    const all = Object.values(this.launches).filter((l) => l.status !== "pending");
    const by = {
      new: (a: SolLaunch, b: SolLaunch) => b.createdAt - a.createdAt,
      mcap: (a: SolLaunch, b: SolLaunch) => (b.mcapSol ?? 0) - (a.mcapSol ?? 0),
      progress: (a: SolLaunch, b: SolLaunch) => (a.status === "graduated" ? 1 : 0) - (b.status === "graduated" ? 1 : 0) || b.progress - a.progress,
      movers: (a: SolLaunch, b: SolLaunch) => (b.movedAt ?? 0) - (a.movedAt ?? 0),
    }[sort];
    return all.sort(by);
  }

  one(mint: string): SolLaunch | null { const l = this.launches[mint]; return l && l.status !== "pending" ? l : null; }
  chart(mint: string): [number, number][] { return this.history[mint] ?? []; }
  spark(mint: string): number[] { const h = this.history[mint] ?? []; return h.slice(-48).map((p) => p[1]); }

  async info() {
    const s = this.settings();
    const usd = await this.solUsd();
    const shared = s.config ? await this.configOf(s.config) : null;
    const all = this.list();
    return {
      network: s.network, open: !!s.partner, partner: s.partner, config: shared ? s.config : null, solUsd: usd,
      shared: shared ? { graduateSol: Number(shared.threshold) / 1e9, createFeeSol: Number(shared.poolCreationFee) / 1e9 } : null,
      imd: { review: s.review && this.swarmOn(), kit: s.kit && this.swarmOn(), kitUsd: KIT_USD, kitLamports: (await this.kitLamports())?.toString() ?? null },
      counts: { live: all.filter((l) => l.status === "live").length, graduated: all.filter((l) => l.status === "graduated").length, reviewed: all.filter((l) => l.review?.state === "done").length },
    };
  }

  private async refreshOne(l: SolLaunch, pool: PoolView | null) {
    const c = l.config ? await this.configOf(l.config) : null;
    if (pool) {
      const before = l.quoteReserve;
      l.pool = pool.pool; l.creator = pool.creator; l.status = pool.migrated ? "graduated" : "live";
      l.quoteReserve = pool.quoteReserve.toString();
      if (before !== l.quoteReserve && before !== "0") l.movedAt = Date.now();
      const dec = c?.tokenDecimal ?? 6;
      l.priceSol = priceFromSqrt(pool.sqrtPrice, dec);
      l.mcapSol = c ? l.priceSol * (Number(c.supply) / 10 ** dec) : null;
      l.graduateSol = c ? Number(c.threshold) / 1e9 : l.graduateSol;
      l.progress = pool.migrated ? 1 : c && c.threshold > 0n ? Math.min(1, Number(pool.quoteReserve) / Number(c.threshold)) : 0;
      if (c && !l.dev) l.dev = devLock(c);
      // the chart: one point a minute, a day kept
      const h = (this.history[l.mint] ??= []);
      const now = Date.now();
      if (!h.length || now - h[h.length - 1]![0] > 50_000) h.push([now, l.priceSol]);
      while (h.length && now - h[0]![0] > DAY) h.shift();
      // a change is shown only when the history reaches back that far (50 minutes, 20 hours)
      const oldest = h[0]?.[0] ?? now;
      const at = (ago: number) => h.find((p) => p[0] >= now - ago)?.[1];
      const p1 = oldest <= now - 50 * 60_000 ? at(3600_000) : undefined, p24 = oldest <= now - 20 * 3600_000 ? h[0]?.[1] : undefined;
      l.change1h = p1 ? ((l.priceSol - p1) / p1) * 100 : null;
      l.change24h = p24 ? ((l.priceSol - p24) / p24) * 100 : null;
    }
    if (Date.now() - l.checkedAt > 600_000) {
      const [m, hs] = await Promise.all([this.chain.mint(l.mint).catch(() => null), this.chain.holders(l.mint).catch(() => null)]);
      const serial = Object.values(this.launches).filter((x) => x.creator && x.creator === l.creator).length;
      l.checks = safetyChecks(m, hs, pool, serial, l.dev);
      l.checkedAt = Date.now();
    }
  }

  /** The swarm's work: order what is queued, follow what runs. */
  async work(): Promise<void> {
    if (!this.swarm || !this.swarmOn()) return;
    for (const l of Object.values(this.launches)) {
      for (const [w, kind, brief] of [[l.review, "research", () => reviewBrief(l, this.site)], [l.kit, "website", () => kitBrief(l, this.site)]] as const) {
        if (!w || w.state === "done" || w.state === "failed" || w.state === "off") continue;
        try {
          if (w.state === "queued") { await this.swarm.order(kind, brief(), w.ref); w.state = "running"; }
          const f = await this.swarm.follow(w.ref);
          if (f) {
            w.job = f.job;
            w.url = f.site ?? (f.job ? `https://explorer.imd.fun/jobs/${f.job}` : null);
            if (f.status === "done") w.state = "done";
            if (f.status === "failed" || f.status === "unpaid") { w.state = "failed"; w.note = "The swarm job did not complete."; }
          }
        } catch (e) { w.note = (e as Error).message.slice(0, 160); if (w.state === "queued" && /409|400/.test(w.note)) w.state = "failed"; }
      }
    }
    this.save();
  }

  /** Every minute: pools re-read, stale pending entries dropped, launches made elsewhere picked up, the swarm followed. */
  async refresh(): Promise<void> {
    const s = this.settings();
    const now = Date.now();
    for (const [k, l] of Object.entries(this.launches)) if (l.status === "pending" && now - l.createdAt > PENDING_TTL) delete this.launches[k];
    // launches made elsewhere with the shared NIGHTSHIFT config key: every 5 minutes, gently (every trade touches it too)
    if (s.config && s.partner && now - this.scannedAt > 300_000) try {
      this.scannedAt = now;
      const found = await this.chain.newLaunches(s.config, this.scanSince[s.config] ?? null);
      if (found.newest) this.scanSince[s.config] = found.newest;
      for (const f of found.mints) {
        if (this.launches[f.mint] && this.launches[f.mint]!.status !== "pending") continue;
        const own = this.launches[f.mint];
        const m = own ?? await this.chain.onchainMeta(f.mint).then((x) => x && { mint: f.mint, name: x.name, symbol: x.symbol, description: "", website: "", twitter: "", telegram: "", image: "" }).catch(() => null);
        if (!m) continue;
        this.launches[f.mint] = { ...m, config: s.config, pool: null, creator: null, signature: f.signature, createdAt: f.at || now, source: own ? "nightshift" : "elsewhere", status: "live", quoteReserve: "0", priceSol: null, mcapSol: null, progress: 0, graduateSol: null, options: own?.options ?? null, dev: null, checks: [], checkedAt: 0, change1h: null, change24h: null, movedAt: null, review: null, kit: null } as SolLaunch;
      }
    } catch { /* the scan is a backstop; the next run tries again */ }
    const listed = Object.values(this.launches).filter((l) => l.status !== "pending" && l.config);
    const withPool = listed.filter((l) => l.pool);
    const views = withPool.length ? await this.chain.pools(withPool.map((l) => l.pool!)).catch(() => withPool.map(() => null)) : [];
    for (const [i, l] of withPool.entries()) await this.refreshOne(l, views[i] ?? null).catch(() => {});
    for (const l of listed.filter((x) => !x.pool)) await this.refreshOne(l, await this.chain.poolOf(l.config, l.mint).catch(() => null)).catch(() => {});
    await this.work().catch(() => {});
    this.save();
  }

  /** The shared config key the admin created: the DBC program's, fees to the partner, on NIGHTSHIFT terms. */
  async verifyConfig(configKey: string, partner: string): Promise<{ ok: true; config: ConfigView } | { ok: false; why: string }> {
    if (!BASE58_KEY.test(configKey) || !BASE58_KEY.test(partner)) return { ok: false, why: "The config or the partner wallet is not a Solana address." };
    const c = await this.chain.config(configKey).catch(() => null);
    if (!c) return { ok: false, why: "No Meteora DBC config at that address on this network yet." };
    const bad = termsProblems(c, partner);
    if (bad.length) return { ok: false, why: `That config does not match the NIGHTSHIFT terms: ${bad.join(", ")}.` };
    this.configs.set(configKey, c);
    return { ok: true, config: c };
  }
}

// ---------------------------------------------------------------- the RPC proxy

/** Reads the page's SDK needs, and sending a signed transaction. Nothing that scans the chain. */
export const RPC_METHODS = new Set([
  "getLatestBlockhash", "isBlockhashValid", "getAccountInfo", "getMultipleAccounts", "getBalance", "getTokenAccountBalance",
  "getTokenAccountsByOwner", "getMinimumBalanceForRentExemption", "getSignatureStatuses", "sendTransaction", "simulateTransaction",
  "getSlot", "getBlockTime", "getEpochInfo", "getFeeForMessage", "getRecentPrioritizationFees", "getTokenSupply", "getBlockHeight",
  "getGenesisHash", "getVersion", "getHealth",
]);
const MULTI_CHUNK = 10; // the free public RPC answers at most 10 accounts per call
type RpcReq = { jsonrpc: "2.0"; id: unknown; method: string; params?: unknown[] };

/** One JSON-RPC request (or a batch of up to 10) checked, forwarded, and getMultipleAccounts split to fit the RPC. */
export async function proxyRpc(rpc: string, payload: unknown, send: (body: unknown) => Promise<unknown> = (b) => postRpc(rpc, b)): Promise<unknown> {
  const batch = Array.isArray(payload);
  const reqs = (batch ? payload : [payload]) as RpcReq[];
  if (!reqs.length || reqs.length > 10) throw new SolInputError("Send 1 to 10 requests at a time.");
  for (const r of reqs) {
    if (!r || typeof r !== "object" || r.jsonrpc !== "2.0" || typeof r.method !== "string") throw new SolInputError("Not a JSON-RPC request.");
    if (!RPC_METHODS.has(r.method)) throw new SolInputError(`${String(r.method).slice(0, 40)} is not available here.`, 403);
  }
  const answers = await Promise.all(reqs.map(async (r) => {
    const keys = r.method === "getMultipleAccounts" && Array.isArray(r.params?.[0]) ? (r.params![0] as string[]) : null;
    if (!keys || keys.length <= MULTI_CHUNK) return send(r);
    if (keys.length > 100) return { jsonrpc: "2.0", id: r.id, error: { code: -32602, message: "At most 100 accounts." } };
    const parts: { result?: { context: unknown; value: unknown[] }; error?: unknown }[] = [];
    for (let i = 0; i < keys.length; i += MULTI_CHUNK) parts.push(await send({ ...r, params: [keys.slice(i, i + MULTI_CHUNK), ...(r.params!.slice(1))] }) as never);
    const err = parts.find((p) => p.error);
    if (err) return { jsonrpc: "2.0", id: r.id, error: err.error };
    return { jsonrpc: "2.0", id: r.id, result: { context: parts[0]!.result!.context, value: parts.flatMap((p) => p.result!.value) } };
  }));
  return batch ? answers : answers[0];
}

async function postRpc(rpc: string, body: unknown): Promise<unknown> {
  const r = await fetch(rpc, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body), signal: AbortSignal.timeout(20_000) });
  const text = await r.text();
  try { return JSON.parse(text); } catch { return { jsonrpc: "2.0", id: (body as RpcReq).id, error: { code: r.status, message: `The Solana node answered ${r.status}.` } }; }
}
