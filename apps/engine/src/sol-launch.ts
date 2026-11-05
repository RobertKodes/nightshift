import { existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { writeAtomic } from "./atomic.js";
import { config } from "./config.js";
import { readSettings } from "./settings.js";
import { IMD_PRICE, type ImdFile, type ImdPort, PAY_CHAINS, type PayChain } from "./sol-imd.js";
import { MintKeys } from "./sol-mints.js";
import { launchTxProblem, readTx, walletSigned } from "./sol-tx.js";

export { DBC_PROGRAM } from "./sol-tx.js";

/**
 * IMD Launch on Solana, through NIGHTSHIFT: tokens launched on Meteora's Dynamic Bonding Curve with
 * NIGHTSHIFT as the launch partner, and the IMD swarm doing the work the creator picks before the
 * launch: a sourced review that decides whether it goes live, the logo, an X banner, the website.
 * IMD's own launches are EVM-only; this is its Solana rail until IMD launches on Solana itself.
 *
 * How a launch goes:
 *  1. prepare: the creator's details, the Meteora settings and the swarm work they pick; NIGHTSHIFT
 *     gives the launch its address (ending in "imd") and, with swarm work, the exact IMD job body,
 *     checked by IMD for free.
 *  2. signed: the creator's wallet signs the launch. Without swarm work NIGHTSHIFT adds the address's
 *     signature and sends it at once. With swarm work the launch is signed on a durable nonce (it does
 *     not expire) and waits here: nothing is on Solana yet.
 *  3. paid: the creator pays the 0.5 IMD job from their own Ethereum or Robinhood Chain wallet; the
 *     payment is checked to carry exactly that body.
 *  4. The swarm works; this module follows the job. When it completes (and the review, if picked,
 *     says launch), NIGHTSHIFT sends the signed launch: the token goes live with the swarm's logo,
 *     banner and site. If the review says no, it never launches.
 * NIGHTSHIFT never holds a creator's key or funds: the one key it holds creates the token's address.
 */

export const WSOL = "So11111111111111111111111111111111111111112";
const RPC_DEFAULT = { mainnet: "https://solana-rpc.publicnode.com", devnet: "https://api.devnet.solana.com" } as const;
export type SolNet = keyof typeof RPC_DEFAULT;

export type SolSettings = { network: SolNet; rpc: string; config: string | null; partner: string | null };
export function solSettings(): SolSettings {
  const s = readSettings() as Record<string, string | undefined>;
  const network: SolNet = s.SOL_NETWORK === "devnet" ? "devnet" : "mainnet";
  const isKey = (v?: string) => !!v && BASE58_KEY.test(v);
  return { network, rpc: s.SOL_RPC?.trim() || RPC_DEFAULT[network], config: isKey(s.SOL_DBC_CONFIG) ? s.SOL_DBC_CONFIG! : null, partner: isKey(s.SOL_PARTNER) ? s.SOL_PARTNER! : null };
}

// ---------------------------------------------------------------- what a creator writes

export const BASE58_KEY = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
/** Control, zero-width and bidirectional characters out: they make a name display as something else (a reversed "PIRATE"). */
export const cleanText = (s: string) => s.replace(/[\u0000-\u001f\u007f-\u009f​-‏‪-‮⁠-⁩﻿]/g, "");
export type SolMeta = { mint: string; name: string; symbol: string; description: string; website: string; twitter: string; telegram: string; image: string };
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

/** The creator's fields, checked; the image as bytes when uploaded. A launch without a logo needs the swarm to draw one. */
export function checkMeta(b: Record<string, unknown>, logoBySwarm = false): { meta: Omit<SolMeta, "image" | "mint">; image: { ext: string; bytes: Buffer } | { url: string } | null } {
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
  if (!image && !logoBySwarm) throw new SolInputError("Add a logo for the token, or ask the IMD swarm to draw one.");
  return { meta: { name, symbol, description, website, twitter, telegram }, image };
}

/** The token's metadata JSON, in the shape wallets, explorers and Jupiter read. */
export function metaJson(l: SolLaunch, site: string) {
  const image = l.image || l.swarm?.logo || "";
  const type = /\.png$|\/artifacts\//.test(image) ? "image/png" : image.endsWith(".gif") ? "image/gif" : image.endsWith(".jpg") ? "image/jpeg" : "image/webp";
  const website = l.website || l.swarm?.site || "";
  const page = `${site}/launchpad/sol/${l.mint}`;
  return {
    name: l.name, symbol: l.symbol, description: l.description, image,
    external_url: website || page,
    extensions: { website: website || undefined, twitter: l.twitter || undefined, telegram: l.telegram || undefined, launchpad: page },
    properties: { category: "image", files: image ? [{ uri: image, type }] : [] },
  };
}

// ---------------------------------------------------------------- the bonding curve the creator picks

export type Sniper = "off" | "standard" | "strong";
/** What the creator chose for Meteora's curve (the page builds the config from it; the chain is checked for the guarantees and the lock). */
export type SolOptions = { feeBps: number; startMcapUsd: number; graduateMcapUsd: number; sniper: Sniper };
export const FEE_BPS = [25, 30, 100, 200, 400, 600] as const;
export const MCAP_LIMITS = { start: [1_000, 1_000_000], graduate: [10_000, 100_000_000], minRatio: 2 } as const;

export function checkOptions(v: unknown): SolOptions {
  const o = (v && typeof v === "object" ? v : {}) as Record<string, unknown>;
  const n = (x: unknown) => (typeof x === "number" && Number.isFinite(x) ? Math.round(x) : NaN);
  const feeBps = n(o.feeBps), start = n(o.startMcapUsd), graduate = n(o.graduateMcapUsd);
  if (!(FEE_BPS as readonly number[]).includes(feeBps)) throw new SolInputError("The trading fee is one of Meteora's: 0.25%, 0.3%, 1%, 2%, 4% or 6%.");
  if (!(start >= MCAP_LIMITS.start[0] && start <= MCAP_LIMITS.start[1])) throw new SolInputError("The starting market cap is $1,000 to $1,000,000.");
  if (!(graduate >= MCAP_LIMITS.graduate[0] && graduate <= MCAP_LIMITS.graduate[1])) throw new SolInputError("The graduation market cap is $10,000 to $100,000,000.");
  if (graduate < start * MCAP_LIMITS.minRatio) throw new SolInputError("The graduation market cap must be at least twice the starting one.");
  const sniper = ["off", "standard", "strong"].includes(String(o.sniper)) ? (String(o.sniper) as Sniper) : "standard";
  return { feeBps, startMcapUsd: start, graduateMcapUsd: graduate, sniper };
}

// ---------------------------------------------------------------- the swarm work the creator picks

export type SwarmPick = "review" | "logo" | "banner" | "website";
export const SWARM_PICKS: readonly SwarmPick[] = ["review", "logo", "banner", "website"];
/** IMD's step for each pick, and the job node keys IMD names them by (a website adds a design critic). */
const PICK_NODE: Record<SwarmPick, RegExp> = { review: /^research_report/, logo: /^token_logo/, banner: /^create_image/, website: /^(build_website|design_critic)/ };

export type SwarmStep = { pick: SwarmPick; state: "waiting" | "working" | "done" | "failed" };
export type SwarmRun = {
  picks: SwarmPick[]; chainId: PayChain; body: string;
  state: "unpaid" | "paid" | "working" | "done" | "refused" | "failed";
  payTx: string | null; payer: string | null; job: string | null; steps: SwarmStep[];
  verdict: { launch: boolean; reason: string } | null; report: string | null; logo: string | null; banner: string | null; site: string | null;
  note: string | null; paidAt: number | null;
};

export function picksOf(v: unknown): SwarmPick[] {
  const a = Array.isArray(v) ? v.map(String) : [];
  return SWARM_PICKS.filter((p) => a.includes(p));
}

/** The label a swarm website is published under (lowercase, as IMD's ENS names need). */
export const siteLabel = (symbol: string, mint: string) => `${symbol.toLowerCase().replace(/[^a-z0-9]/g, "").slice(0, 10) || "token"}-${mint.slice(-6).toLowerCase()}`;

/**
 * The IMD job for a launch: one job.open (0.5 IMD whatever the creator picks), a chain of the picked
 * steps. Its objective names the token's address, so the job cannot be reused for another launch.
 */
export function swarmBody(l: Pick<SolLaunch, "mint" | "name" | "symbol" | "description" | "website" | "twitter" | "telegram" | "image" | "creator" | "dev" | "logoIdea">, picks: SwarmPick[], site: string) {
  const page = `${site}/launchpad/sol/${l.mint}`;
  const links = [l.website, l.twitter, l.telegram].filter(Boolean).join(", ") || "none";
  const lock = l.dev ? ` The creator keeps ${l.dev.pct}% of the supply locked by Meteora's program until graduation, then ${l.dev.cliffDays} days, then released daily over ${l.dev.vestDays} days.` : " The creator keeps no allocation: the whole supply is on the curve.";
  const logo = l.image || (picks.includes("logo") ? "the logo drawn in this job's logo step (artifacts/logo.png)" : "");
  const objective = [
    `The IMD swarm's work before a Solana token launch through NIGHTSHIFT. Token ${l.name} ($${l.symbol}), mint ${l.mint}, on a Meteora Dynamic Bonding Curve priced in SOL: 1,000,000,000 supply, 6 decimals, the mint and metadata frozen, graduation into a Meteora DAMM v2 pool with 100% of its liquidity locked forever.${lock}`,
    `Creator wallet ${l.creator}. What it is: ${l.description || "not given"}. Links: ${links}.`,
    `The creator signed the launch already; NIGHTSHIFT submits it on Solana when this job completes${picks.includes("review") ? " and the review's verdict says launch" : ""}, and publishes this job's work with the token. Its page: ${page}.`,
  ].join(" ");
  const steps: Record<string, unknown>[] = [];
  if (picks.includes("review")) steps.push({
    skill: "research-report",
    objective: "Review this launch before it goes live. Check the name, ticker and description for impersonation of an existing project, brand or person; whether the links are real and match; the creator wallet's history on Solscan and its earlier tokens; and scam reports. Write artifacts/verdict.json as {\"launch\": true or false, \"reason\": \"one sentence\"}: false only for impersonation, fake links, a wallet tied to scams, or illegal content. Write the sourced review a buyer can read to artifacts/report.md.",
    acceptanceCriteria: ["artifacts/verdict.json is valid JSON with a boolean launch and a one-sentence reason", "artifacts/report.md cites what was checked"],
    outputs: [{ name: "verdict", path: "artifacts/verdict.json", mediaType: "application/json" }, { name: "report", path: "artifacts/report.md", mediaType: "text/markdown" }],
  });
  if (picks.includes("logo")) steps.push({
    skill: "token-logo",
    objective: `The token's logo${l.logoIdea ? `: ${l.logoIdea}` : `, a bold simple mark for ${l.name} ($${l.symbol})`}. Square, at least 512 px, readable at 32 px, no text but the ticker if any.`,
    outputs: [{ name: "logo", path: "artifacts/logo.png", mediaType: "image/png" }],
  });
  if (picks.includes("banner")) steps.push({
    skill: "create-image",
    objective: `An X (Twitter) header banner for ${l.name} ($${l.symbol}), exactly 1500 x 500 px, in the style of ${logo || "the token"}. The ticker large and readable; keep the lower-left corner clear for the profile picture. No promises of returns.`,
    outputs: [{ name: "banner", path: "artifacts/banner.png", mediaType: "image/png" }],
  });
  if (picks.includes("website")) steps.push({
    skill: "build-website",
    objective: `A one-page website for the token: ${logo ? `its logo (${logo}), ` : ""}what it is, the mint address ${l.mint} with a copy button, a Buy button linking to ${page}, the creator's allocation as stated above, and the links (${links}). Dark, bold, readable on a phone. Static, no wallet connection, no promises of returns.`,
  });
  return {
    objective: objective.slice(0, 8000), shape: "chain", steps, github: false,
    ...(picks.includes("review") ? { minCitations: 3 } : {}),
    ...(picks.includes("website") ? { ipfs: siteLabel(l.symbol, l.mint) } : {}),
  };
}

/** The review's verdict, from the swarm's verdict.json (a loose read: the shape the job asked for, or close to it). */
export function readVerdict(text: string | null): { launch: boolean; reason: string } | null {
  if (!text) return null;
  try {
    const j = JSON.parse(text) as { launch?: unknown; reason?: unknown };
    if (typeof j.launch === "boolean") return { launch: j.launch, reason: cleanText(String(j.reason ?? "")).slice(0, 300) };
  } catch { /* fall through to the loose read */ }
  const m = /"launch"\s*:\s*(true|false)/i.exec(text);
  if (!m) return null;
  const r = /"reason"\s*:\s*"([^"]{0,300})/.exec(text);
  return { launch: m[1]!.toLowerCase() === "true", reason: cleanText(r?.[1] ?? "") };
}

const nodeState = (s: string): SwarmStep["state"] => s === "accepted" ? "done" : /fail|reject|abandon|cancel/.test(s) ? "failed" : /run|dispatch|claim|work|verif|submit|execut|review|revis|judg/.test(s) ? "working" : "waiting";
const JOB_DONE = new Set(["completed"]);
const JOB_FAILED = new Set(["failed", "cancelled", "canceled", "refused", "expired", "rejected"]);
const SWARM_TIMEOUT = 72 * 3600_000;

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

/** The chain reads and sends this module needs; sol-chain.ts uses Meteora's SDK, tests pass a fake. */
export type SolChain = {
  poolOf(config: string, mint: string): Promise<PoolView | null>;
  pools(addresses: string[]): Promise<(PoolView | null)[]>;
  config(config: string): Promise<ConfigView | null>;
  mint(mint: string): Promise<MintView | null>;
  holders(mint: string): Promise<Holder[] | null>;
  /** a durable nonce account's authority and current value */
  nonce(account: string): Promise<{ authority: string; value: string } | null>;
  /** a signed (or partly signed) transaction run on Solana without being sent */
  simulate(txB64: string): Promise<{ ok: boolean; why: string | null }>;
  /** send a fully signed transaction and follow it until it is confirmed; throws with the reason if it fails */
  send(txB64: string): Promise<string>;
  solUsd(): Promise<number | null>;
};

export type SolStatus = "prepared" | "waiting" | "launching" | "live" | "graduated" | "refused" | "failed" | "cancelled";
export type SolLaunch = SolMeta & {
  config: string; pool: string | null; creator: string; signature: string | null; createdAt: number; launchedAt: number | null;
  status: SolStatus; note: string | null;
  quoteReserve: string; priceSol: number | null; mcapSol: number | null; progress: number;
  graduateSol: number | null; options: SolOptions;
  dev: { pct: number; cliffDays: number; vestDays: number } | null;
  devBuySol: number; logoIdea: string;
  checks: SolCheck[]; checkedAt: number;
  change1h: number | null; change24h: number | null; movedAt: number | null;
  swarm: SwarmRun | null;
  /** the creator's signed launch, waiting for the swarm: never shown */
  held: { tx: string; nonce: string | null } | null;
};
export type SolCheck = { key: string; ok: boolean | null; says: string };
/** What the public sees of a launch: everything but the signed transaction. */
export type SolView = Omit<SolLaunch, "held"> & { nonce: string | null };

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

/** The words a creator's wallet signs to act on a launch that waits for the swarm. */
export const actText = (action: "release" | "cancel", mint: string) => `NIGHTSHIFT: ${action === "release" ? "launch without the swarm's work" : "cancel the launch"} ${mint}`;

// ---------------------------------------------------------------- the store

type Stored = Record<string, SolLaunch>;
type History = Record<string, [number, number][]>;
const PREPARED_TTL = 2 * 3600_000;
const UNPAID_TTL = 48 * 3600_000;
const DAY = 86_400_000;
const LISTED: SolStatus[] = ["live", "graduated"];
const WAITING: SolStatus[] = ["waiting", "launching"];

export class SolLaunchpad {
  private launches: Stored;
  private history: History;
  private configs = new Map<string, ConfigView>();
  private usd: { v: number | null; at: number } = { v: null, at: 0 };
  private file: string;
  private histFile: string;
  private imgDir: string;
  private run: Promise<void> | null = null;
  readonly mints: MintKeys;

  constructor(private chain: SolChain, private settings: () => SolSettings = solSettings, private dir = config.dataDir, private site = config.publicUrl, private imd: ImdPort | null = null, mints?: MintKeys) {
    this.file = join(dir, "sol-launches.json");
    this.histFile = join(dir, "sol-history.json");
    this.imgDir = join(dir, "sol-img");
    this.launches = existsSync(this.file) ? (JSON.parse(readFileSync(this.file, "utf8")) as Stored) : {};
    this.history = existsSync(this.histFile) ? (JSON.parse(readFileSync(this.histFile, "utf8")) as History) : {};
    this.mints = mints ?? new MintKeys(dir);
  }

  private save() { writeAtomic(this.file, JSON.stringify(this.launches)); writeAtomic(this.histFile, JSON.stringify(this.history)); }

  async solUsd(): Promise<number | null> {
    if (Date.now() - this.usd.at > 300_000) this.usd = { v: await this.chain.solUsd().catch(() => null) ?? this.usd.v, at: Date.now() };
    return this.usd.v;
  }

  private async configOf(key: string): Promise<ConfigView | null> {
    const c = this.configs.get(key) ?? await this.chain.config(key).catch(() => null);
    if (c) this.configs.set(key, c);
    return c;
  }

  private need(mint: string): SolLaunch {
    const l = BASE58_KEY.test(mint) ? this.launches[mint] : undefined;
    if (!l) throw new SolInputError("No launch with that address here.", 404);
    return l;
  }

  view(l: SolLaunch): SolView {
    const { held, ...rest } = l;
    return { ...rest, nonce: held?.nonce ?? null };
  }

  /**
   * Step 1: the creator's details, settings and swarm picks. Returns the launch's address, its metadata
   * link and, with swarm work, the exact IMD job body and IMD's free check of it.
   */
  async prepare(b: Record<string, unknown>): Promise<{ mint: string; uri: string; image: string; swarm: { body: string; chainId: PayChain; blockers: string[]; plan: string[] } | null }> {
    const s = this.settings();
    if (!s.partner) throw new SolInputError("The Solana launchpad is not open yet.", 503);
    const creator = String(b.creator ?? "").trim();
    if (!BASE58_KEY.test(creator)) throw new SolInputError("Connect the creator's Solana wallet first.");
    const picks = picksOf(b.swarm);
    if (picks.length && !this.imd) throw new SolInputError("The IMD swarm is not reachable from here right now. Launch without it, or try again later.", 503);
    const { meta, image } = checkMeta(b, picks.includes("logo"));
    const options = checkOptions(b.options);
    const chainId: PayChain = Number(b.chainId) === 4663 ? 4663 : 1;
    const devBuySol = Math.max(0, Math.min(5, Number(b.devBuySol) || 0));
    const d = (b.dev && typeof b.dev === "object" ? b.dev : {}) as Record<string, unknown>;
    const dev = Number(d.pct) > 0 ? { pct: Math.min(80, Number(d.pct)), cliffDays: Math.max(0, Number(d.cliffDays) || 0), vestDays: Math.max(1, Number(d.vestDays) || 1) } : null;
    const logoIdea = cleanText(String(b.logoIdea ?? "")).trim().slice(0, 200);
    const mint = this.mints.take();
    let imageUrl = "";
    if (image && "bytes" in image) {
      mkdirSync(this.imgDir, { recursive: true });
      for (const e of Object.values(IMAGE_TYPES)) { const f = join(this.imgDir, `${mint}.${e}`); if (existsSync(f)) unlinkSync(f); }
      writeFileSync(join(this.imgDir, `${mint}.${image.ext}`), image.bytes);
      imageUrl = `${this.site}/api/sol/img/${mint}.${image.ext}`;
    } else if (image) imageUrl = image.url;
    const l: SolLaunch = {
      mint, ...meta, image: imageUrl, config: "", pool: null, creator, signature: null, createdAt: Date.now(), launchedAt: null, status: "prepared", note: null,
      quoteReserve: "0", priceSol: null, mcapSol: null, progress: 0, graduateSol: null, options, dev, devBuySol, logoIdea, checks: [], checkedAt: 0,
      change1h: null, change24h: null, movedAt: null, swarm: null, held: null,
    };
    let swarm: { body: string; chainId: PayChain; blockers: string[]; plan: string[] } | null = null;
    if (picks.length) {
      const body = JSON.stringify(swarmBody(l, picks, this.site));
      const check = await this.imd!.check(JSON.parse(body)).catch((e: Error) => { this.mints.drop(mint); throw new SolInputError(e.message, 503); });
      swarm = { body, chainId, ...check };
      l.swarm = { picks, chainId, body, state: "unpaid", payTx: null, payer: null, job: null, steps: picks.map((pick) => ({ pick, state: "waiting" })), verdict: null, report: null, logo: null, banner: null, site: null, note: null, paidAt: null };
      if (check.blockers.length) { this.mints.drop(mint); return { mint, uri: "", image: imageUrl, swarm }; }
    }
    this.launches[mint] = l;
    this.save();
    return { mint, uri: `${this.site}/api/sol/meta/${mint}.json`, image: imageUrl, swarm };
  }

  meta(mint: string) { const l = this.launches[mint]; return l ? metaJson(l, this.site) : null; }

  image(file: string): { bytes: Buffer; type: string } | null {
    const m = /^([1-9A-HJ-NP-Za-km-z]{32,44})\.(webp|png|jpg|gif)$/.exec(file);
    if (!m) return null;
    const f = join(this.imgDir, file);
    if (!existsSync(f)) return null;
    return { bytes: readFileSync(f), type: m[2] === "jpg" ? "image/jpeg" : `image/${m[2]}` };
  }

  /**
   * Step 2: the creator's signed launch. It must be exactly a launch of this token on a config with
   * NIGHTSHIFT's terms, and it must work on Solana right now. Without swarm work it is sent at once;
   * with swarm work it waits here for the swarm (signed on a durable nonce, so it does not expire).
   */
  async signed(mint: string, b: Record<string, unknown>): Promise<SolView> {
    const s = this.settings();
    if (!s.partner) throw new SolInputError("The Solana launchpad is not open yet.", 503);
    const l = this.need(mint);
    if (!(l.status === "prepared" || l.status === "failed" || (l.status === "waiting" && l.swarm?.state === "unpaid"))) throw new SolInputError("This launch is already signed.", 409);
    const configKey = String(b.config ?? "") || s.config || "";
    if (!BASE58_KEY.test(configKey)) throw new SolInputError("The launch's Meteora config is missing.");
    const c = await this.configOf(configKey);
    if (!c) throw new SolInputError("That Meteora config is not on Solana yet. Wait a moment and sign again.", 409);
    const bad = termsProblems(c, s.partner);
    if (bad.length) throw new SolInputError(`That launch is not on NIGHTSHIFT terms: ${bad.join(", ")}.`, 409);
    const nonceKey = l.swarm ? String(b.nonce ?? "") : "";
    let nonce: { account: string; value: string } | null = null;
    if (l.swarm) {
      if (!BASE58_KEY.test(nonceKey)) throw new SolInputError("A launch that waits for the swarm needs its nonce account.");
      const n = await this.chain.nonce(nonceKey).catch(() => null);
      if (!n) throw new SolInputError("The nonce account is not on Solana yet. Wait a moment and sign again.", 409);
      if (n.authority !== l.creator) throw new SolInputError("That nonce account belongs to another wallet.");
      nonce = { account: nonceKey, value: n.value };
    }
    let tx;
    try { tx = readTx(String(b.tx ?? "")); } catch { throw new SolInputError("That is not a Solana transaction."); }
    const problem = launchTxProblem(tx, { creator: l.creator, mint, config: configKey, nonce });
    if (problem) throw new SolInputError(problem);
    const txB64 = tx.serialize({ requireAllSignatures: false, verifySignatures: false }).toString("base64");
    const sim = await this.chain.simulate(txB64);
    if (!sim.ok) throw new SolInputError(`This launch would fail on Solana right now: ${sim.why ?? "unknown error"}. Nothing was sent.`, 409);
    Object.assign(l, { config: configKey, dev: devLock(c), graduateSol: Number(c.threshold) / 1e9, note: null, held: { tx: txB64, nonce: nonce?.account ?? null } });
    if (!l.swarm) { await this.release(l); return this.view(l); }
    l.status = "waiting";
    this.save();
    return this.view(l);
  }

  /** Step 3: the creator paid IMD's job; the payment must carry exactly this launch's body. */
  async paid(mint: string, chainId: unknown, tx: unknown): Promise<SolView> {
    const l = this.need(mint);
    const w = l.swarm;
    if (!w || l.status !== "waiting") throw new SolInputError("This launch is not waiting for an IMD payment.", 409);
    if (w.state !== "unpaid") return this.view(l);
    const hash = String(tx ?? "").toLowerCase();
    if (!/^0x[0-9a-f]{64}$/.test(hash)) throw new SolInputError("That is not a transaction hash.");
    const chain = Number(chainId) as PayChain;
    if (!(chain in PAY_CHAINS)) throw new SolInputError("IMD is paid on Ethereum or Robinhood Chain.");
    if (Object.values(this.launches).some((x) => x !== l && x.swarm?.payTx === hash)) throw new SolInputError("That payment is already used by another launch.", 409);
    const p = await this.imd!.paid(chain, hash, w.body);
    if (!p.ok) throw new SolInputError(p.why, 409);
    Object.assign(w, { state: "paid", payTx: hash, payer: p.payer, chainId: chain, paidAt: Date.now() });
    this.save();
    void this.work().catch(() => {});
    return this.view(l);
  }

  /** The creator's own decision on a launch that waits: launch without the swarm when the swarm failed, or cancel. */
  async act(mint: string, action: unknown, signature: unknown): Promise<SolView> {
    const l = this.need(mint);
    if (action !== "release" && action !== "cancel") throw new SolInputError("Unknown action.");
    if (!walletSigned(l.creator, actText(action, mint), String(signature ?? ""))) throw new SolInputError("Sign with the creator's wallet.", 403);
    return this.decide(l, action, false);
  }

  /** The owner's override from the admin page: release a refused or stuck launch, or cancel one. */
  async adminAct(mint: string, action: unknown): Promise<SolView> {
    if (action !== "release" && action !== "cancel") throw new SolInputError("Unknown action.");
    return this.decide(this.need(mint), action, true);
  }

  private async decide(l: SolLaunch, action: "release" | "cancel", owner: boolean): Promise<SolView> {
    if (!WAITING.includes(l.status) && !(owner && l.status === "refused")) throw new SolInputError("This launch is not waiting.", 409);
    if (action === "cancel") {
      Object.assign(l, { status: "cancelled", held: null, note: owner ? "Cancelled by NIGHTSHIFT." : "Cancelled by the creator." });
      this.mints.drop(l.mint);
      this.save();
      return this.view(l);
    }
    if (!owner && l.swarm && l.swarm.state !== "failed") throw new SolInputError("The swarm is still working: the launch goes live when it finishes.", 409);
    if (!l.held) throw new SolInputError("There is no signed launch to send. Sign it again.", 409);
    await this.release(l);
    return this.view(l);
  }

  /** Send the creator's signed launch with NIGHTSHIFT's signature for the token's address, then list it. */
  private async release(l: SolLaunch): Promise<void> {
    const kp = this.mints.keypair(l.mint);
    if (!kp || !l.held) { l.status = "failed"; l.note = "The launch's address key is missing: start a new launch."; this.save(); return; }
    l.status = "launching";
    this.save();
    try {
      const tx = readTx(l.held.tx);
      tx.partialSign(kp);
      l.signature = await this.chain.send(tx.serialize().toString("base64"));
    } catch (e) {
      Object.assign(l, { status: "failed", held: l.held, note: `Solana refused the launch: ${(e as Error).message.slice(0, 160)}. Sign it again to retry.` });
      this.save();
      return;
    }
    let pool: PoolView | null = null;
    for (let i = 0; i < 6 && !pool; i++) { pool = await this.chain.poolOf(l.config, l.mint).catch(() => null); if (!pool) await new Promise((r) => setTimeout(r, 1500 * (i + 1))); }
    Object.assign(l, { status: pool?.migrated ? "graduated" : "live", launchedAt: Date.now(), held: null, note: null });
    this.mints.drop(l.mint);
    if (pool) await this.refreshOne(l, pool).catch(() => {});
    this.save();
  }

  /** The launches on the board, in the order a board asks for. */
  list(sort: "new" | "mcap" | "progress" | "movers" = "new"): SolView[] {
    const all = Object.values(this.launches).filter((l) => LISTED.includes(l.status));
    const by = {
      new: (a: SolLaunch, b: SolLaunch) => (b.launchedAt ?? b.createdAt) - (a.launchedAt ?? a.createdAt),
      mcap: (a: SolLaunch, b: SolLaunch) => (b.mcapSol ?? 0) - (a.mcapSol ?? 0),
      progress: (a: SolLaunch, b: SolLaunch) => (a.status === "graduated" ? 1 : 0) - (b.status === "graduated" ? 1 : 0) || b.progress - a.progress,
      movers: (a: SolLaunch, b: SolLaunch) => (b.movedAt ?? 0) - (a.movedAt ?? 0),
    }[sort];
    return all.sort(by).map((l) => this.view(l));
  }

  /** Launches signed and waiting for the IMD swarm (paid ones first). */
  waiting(): SolView[] {
    return Object.values(this.launches).filter((l) => WAITING.includes(l.status) && l.swarm && l.swarm.state !== "unpaid")
      .sort((a, b) => (b.swarm?.paidAt ?? 0) - (a.swarm?.paidAt ?? 0)).map((l) => this.view(l));
  }

  one(mint: string): SolView | null { const l = this.launches[mint]; return l && l.status !== "prepared" ? this.view(l) : null; }
  chart(mint: string): [number, number][] { return this.history[mint] ?? []; }
  spark(mint: string): number[] { const h = this.history[mint] ?? []; return h.slice(-48).map((p) => p[1]); }

  async info() {
    const s = this.settings();
    const usd = await this.solUsd();
    const shared = s.config ? await this.configOf(s.config) : null;
    const all = Object.values(this.launches);
    return {
      network: s.network, open: !!s.partner, partner: s.partner, config: shared ? s.config : null, solUsd: usd,
      shared: shared ? { graduateSol: Number(shared.threshold) / 1e9, createFeeSol: Number(shared.poolCreationFee) / 1e9 } : null,
      imd: { on: !!this.imd, price: IMD_PRICE, imdUsd: config.imdUsd, chains: PAY_CHAINS, picks: SWARM_PICKS },
      counts: {
        live: all.filter((l) => l.status === "live").length, graduated: all.filter((l) => l.status === "graduated").length,
        reviewed: all.filter((l) => LISTED.includes(l.status) && l.swarm?.verdict?.launch).length, swarm: all.filter((l) => LISTED.includes(l.status) && l.swarm?.state === "done").length,
        waiting: all.filter((l) => WAITING.includes(l.status) && l.swarm && l.swarm.state !== "unpaid").length,
      },
    };
  }

  private async refreshOne(l: SolLaunch, pool: PoolView | null) {
    const c = l.config ? await this.configOf(l.config) : null;
    if (pool) {
      const before = l.quoteReserve;
      l.pool = pool.pool; l.status = pool.migrated ? "graduated" : "live";
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
      const serial = Object.values(this.launches).filter((x) => LISTED.includes(x.status) && x.creator === l.creator).length;
      l.checks = safetyChecks(m, hs, pool, serial, l.dev);
      l.checkedAt = Date.now();
    }
  }

  /** The swarm's work: follow every paid job, and send the launch when its job completes. */
  async work(): Promise<void> {
    if (!this.imd) return;
    // one pass at a time; a call during a pass runs another pass after it, with what is new by then
    while (this.run) await this.run.catch(() => {});
    this.run = this.workOnce().finally(() => { this.run = null; });
    return this.run;
  }

  private async workOnce(): Promise<void> {
    try {
      for (const l of Object.values(this.launches)) {
        const w = l.swarm;
        if (!w || l.status !== "waiting" || !w.payTx || w.state === "failed" || w.state === "refused") continue;
        try { await this.follow(l, w); } catch (e) { w.note = (e as Error).message.slice(0, 160); }
      }
    } finally { this.save(); }
  }

  private async follow(l: SolLaunch, w: SwarmRun) {
    if (!w.job) {
      const e = await this.imd!.intake(w.chainId, w.payTx!);
      if (e?.job) w.job = e.job;
      else if (e?.state && /refus|fail|reject/.test(e.state)) { Object.assign(w, { state: "failed", note: `IMD did not take the job: ${e.reason ?? e.state}.` }); return; }
      else { w.note = "IMD is reading the payment."; return; }
    }
    const job = await this.imd!.job(w.job);
    if (!job) return;
    w.state = "working";
    w.note = null;
    for (const st of w.steps) {
      const nodes = job.nodes.filter((n) => PICK_NODE[st.pick].test(n.key));
      if (nodes.length) st.state = nodes.every((n) => n.state === "accepted") ? "done" : nodes.some((n) => nodeState(n.state) === "failed") ? "failed" : nodes.some((n) => nodeState(n.state) !== "waiting") ? "working" : "waiting";
    }
    if (job.site) w.site = job.site;
    const files = await this.imd!.files(w.job).catch(() => [] as ImdFile[]);
    const file = (name: string) => files.find((f) => f.name === name)?.url ?? null;
    w.report = file("report") ?? w.report; w.logo = file("logo") ?? w.logo; w.banner = file("banner") ?? w.banner;
    if (w.picks.includes("review") && !w.verdict && file("verdict")) w.verdict = readVerdict(await this.imd!.text(file("verdict")!));
    if (w.verdict && !w.verdict.launch) {
      // the signed launch is kept (never sent) so the owner can still overrule a mistaken verdict
      Object.assign(w, { state: "refused" });
      Object.assign(l, { status: "refused", note: `The IMD swarm's review said no: ${w.verdict.reason || "no reason given"}.` });
      return;
    }
    if (JOB_FAILED.has(job.state) || (w.paidAt && Date.now() - w.paidAt > SWARM_TIMEOUT && !JOB_DONE.has(job.state))) {
      Object.assign(w, { state: "failed", note: JOB_FAILED.has(job.state) ? `The swarm's job ended: ${job.state}.` : "The swarm did not finish within three days." });
      return;
    }
    if (!JOB_DONE.has(job.state)) return;
    if (w.picks.includes("review") && !w.verdict) { Object.assign(w, { state: "failed", note: "The swarm finished, but its verdict could not be read." }); return; }
    w.state = "done";
    for (const st of w.steps) if (st.state !== "failed") st.state = "done";
    await this.release(l);
  }

  /** Every minute: pools re-read, unsigned and unpaid launches dropped, the swarm followed. */
  async refresh(): Promise<void> {
    const now = Date.now();
    for (const [k, l] of Object.entries(this.launches)) {
      if (l.status === "prepared" && now - l.createdAt > PREPARED_TTL) { delete this.launches[k]; this.mints.drop(k); }
      else if (l.status === "waiting" && l.swarm?.state === "unpaid" && now - l.createdAt > UNPAID_TTL) { Object.assign(l, { status: "cancelled", held: null, note: "Not paid within two days." }); this.mints.drop(k); }
      else if (l.status === "refused" && l.held && now - l.createdAt > 30 * DAY) { l.held = null; this.mints.drop(k); }
    }
    const listed = Object.values(this.launches).filter((l) => LISTED.includes(l.status) && l.config);
    const withPool = listed.filter((l) => l.pool);
    const views = withPool.length ? await this.chain.pools(withPool.map((l) => l.pool!)).catch(() => withPool.map(() => null)) : [];
    for (const [i, l] of withPool.entries()) await this.refreshOne(l, views[i] ?? null).catch(() => {});
    for (const l of listed.filter((x) => !x.pool)) await this.refreshOne(l, await this.chain.poolOf(l.config, l.mint).catch(() => null)).catch(() => {});
    await this.work().catch(() => {});
    void this.mints.fill().catch(() => {});
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

  /** The admin's view: every launch not yet on the board, newest first. */
  pending(): SolView[] {
    return Object.values(this.launches).filter((l) => !LISTED.includes(l.status) && l.status !== "prepared").sort((a, b) => b.createdAt - a.createdAt).slice(0, 50).map((l) => this.view(l));
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
