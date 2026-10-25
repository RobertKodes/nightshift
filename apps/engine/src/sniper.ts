import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { Address, Hex } from "viem";
import { writeAtomic } from "./atomic.js";
import { config } from "./config.js";
import type { HookReport } from "./services/hook.js";
import type { LaunchDetail, LaunchRow } from "./services/imd.js";
import type { Impact, VerdictReport } from "./services/verdict.js";
import { NATIVE, type Slot0, poolIdOf, price1in0 } from "./services/v4pool.js";
import { type Button, esc } from "./social.js";
import type { PoolKey } from "./v4.js";

/**
 * NIGHT SNIPER: every new IMD launch on Ethereum, checked before anyone buys.
 * - A token launch gets the house Token Verdict (safe, caution or avoid, each with its reasons),
 *   its v4 hook read in full by the Hook Inspector, and its launcher: the wallet that asked IMD for
 *   it, the share of the supply it keeps, and every other launch it made, with how the called ones went.
 * - An NFT launch (an IMD contracts launch whose contract is an ERC-721 or ERC-1155) gets its
 *   supply, mint price and owner, then replies as it mints out.
 * The alert reaches holders' app first and the community chat a few minutes later; replies follow
 * as the pool moves (2x, 3x, 5x... or a dump), and a recap goes out every evening. Prices are read
 * from the launch's own Uniswap v4 pool on chain: DexScreener indexes only a few IMD launches.
 */

export type Verdict = "safe" | "caution" | "avoid" | "unchecked";
export type Pool = { key: PoolKey; id: Hex; quote: Address; tokenIs1: boolean; tokenDec: number; quoteDec: number };
export type HookView = { address: Address; template: string | null; risk: HookReport["risk"]; summary: string; powers: { text: string; level: string }[]; swapFee: string; hookFee: string };
export type Launcher = { address: string; keepsPct: number | null };
/** The mint price, in ETH or in the ERC-20 the contract names as its payment token. */
export type MintPrice = { amount: number; unit: string };
export type Nft = { standard: "ERC-721" | "ERC-1155"; maxSupply: number | null; minted: number | null; price: MintPrice | null; owner: string | null; milestones: number[] };
export type NftRead = Omit<Nft, "milestones"> & { name: string | null; symbol: string | null };
export type Call = {
  type: "token" | "nft";
  launch: number; id: string; token: Address; symbol: string | null; name: string | null; kind: string; repo: string | null;
  at: number; verdict: Verdict; summary: string; reasons: { impact: Impact; text: string }[];
  pool: Pool | null; supply: number | null; hook: HookView | null; launcher: Launcher | null; nft: Nft | null;
  /** The token's price in its pool's quote currency: at the call, last read, and highest since. */
  entry: number | null; last: number | null; peak: number | null; checkedAt: number | null;
  hits: number[]; dumped: boolean; posted: boolean; pushedAll: boolean;
  messages: { chat: string; id: number }[];
};
/** What the launcher index keeps of a launch: who asked for it, what it is. */
type Indexed = { r: string; k: string; t: string | null; c: number; at: string };
type State = { seen: number[]; calls: Call[]; recapDay?: string; started?: boolean; index: Record<string, Indexed> };

export const MILESTONES = [2, 3, 5, 10, 20, 50, 100];
/** Minted shares an NFT launch gets a reply at. */
export const MINT_STEPS = [25, 50, 75, 100];
/** Down this far from the call, a launch is called dumped (once). */
export const DUMP_AT = 0.2;
/** Launches older than this when first seen are history, not alerts. */
const FRESH_MS = 6 * 3_600_000;
/** A call is followed for a week. */
const FOLLOW_MS = 7 * 86_400_000;
const TRACK_EVERY_MS = 5 * 60_000;
const RECAP_HOUR_UTC = 20;
/** Older launches read into the launcher index per minute (IMD's public reads allow 120). */
const BACKFILL_PER_TICK = 8;
const REINDEX_MS = 30 * 60_000;

export type SniperDeps = {
  now(): number;
  /** IMD's newest launches (one page). */
  launches(): Promise<LaunchRow[]>;
  /** Every IMD launch, for the launcher index (read rarely). */
  allLaunches?(): Promise<LaunchRow[]>;
  detail(id: string): Promise<LaunchDetail | null>;
  verdict(token: Address): Promise<VerdictReport>;
  hook(address: Address): Promise<HookReport | null>;
  /** An ERC-721 or ERC-1155 contract's supply, price and owner; null when it is not an NFT. */
  nft(address: Address): Promise<NftRead | null>;
  slot0(poolId: Hex): Promise<Slot0 | null>;
  decimals(token: Address): Promise<number>;
  /** USD per unit of a pool's quote currency (ETH or IMD); 0 when unknown. */
  usdOf(quote: Address): Promise<number>;
  /** Posts to every community chat (as a reply where one is given); the messages that went out. */
  post(text: string, buttons: Button[][], replyTo?: { chat: string; id: number }[]): Promise<{ chat: string; id: number }[]>;
  /** App notifications: holders get a call at once, everyone else when the community does. */
  push(call: Call, audience: "holders" | "everyone"): Promise<void>;
  delayMs: number;
  file: string | null;
};

const ICON: Record<Verdict, string> = { safe: "✅", caution: "⚠️", avoid: "⛔", unchecked: "❔" };
export const verdictLabel = (v: Verdict) => `${ICON[v]} ${v.toUpperCase()}`;
const IMD: Address = "0xd34a99bc0f67ae1bbd63c660e6d0b0dd03e263b7";
const quoteName = (q: Address) => (q === NATIVE ? "ETH" : q.toLowerCase() === IMD ? "IMD" : "its pair");
const shortAddr = (a: string) => `${a.slice(0, 6)}…${a.slice(-4)}`;

export const uniswapUrl = (c: Pick<Call, "token" | "pool">) =>
  `https://app.uniswap.org/swap?chain=mainnet&inputCurrency=${c.pool && c.pool.quote !== NATIVE ? c.pool.quote : "NATIVE"}&outputCurrency=${c.token}`;
export const chartUrl = (c: Pick<Call, "token" | "pool">) =>
  c.pool ? `https://www.geckoterminal.com/eth/pools/${c.pool.id}` : `https://dexscreener.com/ethereum/${c.token}`;
export const openseaUrl = (contract: string) => `https://opensea.io/assets/ethereum/${contract}`;
export const etherscanUrl = (a: string) => `https://etherscan.io/address/${a}`;
export const sniperUrl = (c: Pick<Call, "token">) => `${config.publicUrl}/sniper?token=${c.token}`;
const tag = (c: Pick<Call, "symbol" | "name" | "launch">) => (c.symbol ? `$${c.symbol}` : c.name ?? `launch #${c.launch}`);

const usd = (x: number) => (x >= 1e6 ? `$${(x / 1e6).toFixed(2)}M` : x >= 1e3 ? `$${(x / 1e3).toFixed(1)}k` : `$${Math.round(x)}`);
const times = (m: number) => `${m >= 10 ? Math.round(m) : Math.round(m * 10) / 10}x`;
const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/** The token's price in the pool's quote currency, from slot0 (the pool prices currency0 in currency1). */
export function priceOf(p: Pool, s: Slot0): number {
  if (!p.tokenIs1) return price1in0(s, p.tokenDec, p.quoteDec);
  const tokensPerQuote = price1in0(s, p.quoteDec, p.tokenDec);
  return tokensPerQuote > 0 ? 1 / tokensPerQuote : 0;
}

/** The milestone a move just reached (the highest one not replied to yet), or null. */
export function newHit(multiple: number, hits: number[], steps = MILESTONES): number | null {
  const reached = steps.filter((m) => multiple >= m);
  const top = reached.at(-1);
  return top !== undefined && !hits.includes(top) && top > Math.max(0, ...hits) ? top : null;
}

/** The launch's pool, from what the verdict read on chain or else the pool IMD seeded. */
export function poolOf(token: Address, v: VerdictReport | null, l: LaunchRow): Omit<Pool, "tokenDec" | "quoteDec"> | null {
  const t = token.toLowerCase();
  const seeded = l.seeded?.pools?.find((p) => p.currency0.toLowerCase() === t || p.currency1.toLowerCase() === t);
  const key: PoolKey | null = v?.pool?.key ?? (seeded ? { currency0: seeded.currency0 as Address, currency1: seeded.currency1 as Address, fee: seeded.fee, tickSpacing: seeded.tickSpacing, hooks: seeded.hooks as Address } : null);
  if (!key) return null;
  const tokenIs1 = key.currency1.toLowerCase() === t;
  return { key, id: v?.pool?.poolId ?? poolIdOf(key), quote: (tokenIs1 ? key.currency0 : key.currency1).toLowerCase() as Address, tokenIs1 };
}

/**
 * The share of the supply the launcher keeps at launch. A custom token sends 10% to the swarm and
 * poolBps of the supply into the pool; the rest goes to remainderTo (the launcher, or a wallet it named).
 */
export function launcherShare(d: Pick<LaunchDetail, "kind" | "economics" | "requester"> | null): number | null {
  const bps = d?.economics?.poolBps;
  if (d?.kind !== "custom_token" || typeof bps !== "number") return null;
  return Math.max(0, Math.round((9000 - bps) / 10) / 10);
}

/**
 * The verdict for the moment a launch goes live. Two of the Token Verdict's cautions are true of
 * every IMD launch at that moment and so tell launches apart not at all: the pool holds nothing yet
 * because nobody has bought, and the source sits in IMD's public launch repo before any verifier
 * has it. Those become notes. The hook, read in full, counts as a deep verdict counts it; so does
 * a launcher that keeps much of the supply. Every other reason counts as the Token Verdict counts it.
 */
export function launchVerdict(v: VerdictReport, extra: { hook?: HookReport | null; keepsPct?: number | null } = {}): { verdict: Verdict; summary: string; reasons: { impact: Impact; text: string }[] } {
  const imdRepo = v.imd.isLaunch ? v.imd.repo : null;
  const reasons = v.reasons.map((r) => {
    if (r.id === "liquidity" && r.text.startsWith("The pool holds no")) return { impact: "note" as Impact, text: "Nobody has bought yet: the pool holds only the launch's tokens." };
    if (r.id === "unverified" && imdRepo) return { impact: "note" as Impact, text: "Source is public in IMD's launch repo; no verifier (Sourcify, Etherscan) has it yet, so the powers were read from the bytecode." };
    return { impact: r.impact, text: r.text };
  });
  const h = extra.hook;
  if (h) {
    const high = h.powers.filter((p) => p.level === "high"), mid = h.powers.filter((p) => p.level === "medium");
    if (high.length) reasons.push({ impact: "caution", text: `Hook: ${high.map((p) => p.text).join("; ")}.` });
    else if (mid.length) reasons.push({ impact: "note", text: `Hook: ${mid.map((p) => p.text).join("; ")}.` });
    else reasons.push({ impact: "good", text: `Hook: ${h.powers.map((p) => p.text).join("; ") || "nothing it can change"}.` });
  }
  const keeps = extra.keepsPct;
  if (keeps !== null && keeps !== undefined) {
    if (keeps >= 20) reasons.push({ impact: "avoid", text: `The launcher keeps ${keeps}% of the supply: enough to sell into the pool and sink the price.` });
    else if (keeps >= 5) reasons.push({ impact: "caution", text: `The launcher keeps ${keeps}% of the supply.` });
    else reasons.push({ impact: "good", text: keeps === 0 ? "The launcher keeps none of the supply: it all went to the pool and the swarm." : `The launcher keeps only ${keeps}% of the supply.` });
  }
  const verdict: Verdict = reasons.some((r) => r.impact === "avoid") ? "avoid" : reasons.some((r) => r.impact === "caution") ? "caution" : "safe";
  const order: Impact[] = ["avoid", "caution", "note", "good"];
  reasons.sort((a, b) => order.indexOf(a.impact) - order.indexOf(b.impact));
  // a headline only: the reasons themselves are listed under it
  const count = (k: Impact) => reasons.filter((r) => r.impact === k).length;
  const summary = verdict === "safe" ? `No red flags at launch: ${plural(count("good"), "check", "checks")} passed.`
    : verdict === "caution" ? `${plural(count("caution"), "thing", "things")} to watch.` : `${plural(count("avoid"), "red flag", "red flags")}.`;
  return { verdict, summary, reasons };
}

/** "125 bps static; 125 bps static" (one part per pool) once. */
const once = (s: string) => [...new Set(s.split(/;\s*/).filter(Boolean))].join("; ");

export function hookView(h: HookReport): HookView {
  return {
    address: h.address, template: h.template?.name ?? null, risk: h.risk, summary: h.summary,
    powers: h.powers.slice(0, 6).map((p) => ({ text: p.text, level: p.level })), swapFee: once(h.fees.swapFee), hookFee: once(h.fees.hookFee),
  };
}

export function mcapUsd(c: Call, price: number | null, quoteUsd: number): number | null {
  return price && c.supply && quoteUsd ? price * c.supply * quoteUsd : null;
}

/** The launcher's other launches, newest first, from the index (with how each called one went). */
export type History = { launch: number; kind: string; token: string | null; at: string; called: { verdict: Verdict; peak: number | null; dumped: boolean } | null }[];

function launcherLine(c: Call, history: History): string {
  if (!c.launcher) return "";
  const keeps = c.launcher.keepsPct !== null ? ` · keeps ${c.launcher.keepsPct}% of supply` : "";
  const before = history.length ? ` · ${plural(history.length, "earlier launch", "earlier launches")}` : " · first launch";
  const called = history.filter((h) => h.called).slice(0, 3).map((h) => `#${h.launch} ${h.called!.dumped ? "dumped" : h.called!.peak ? times(h.called!.peak) : ICON[h.called!.verdict]}`).join(", ");
  return `👤 Launcher ${shortAddr(c.launcher.address)}${keeps}${before}${called ? ` (${called})` : ""}`;
}

export function callCard(c: Call, mcap: number | null, history: History = []): { text: string; buttons: Button[][] } {
  if (c.type === "nft") return nftCard(c, history);
  const pair = c.pool ? `, paired with ${quoteName(c.pool.quote)}` : "";
  const reasons = c.reasons.filter((r) => r.impact !== "note").slice(0, 3).map((r) => `• ${esc(r.text.length > 160 ? `${r.text.slice(0, 157)}…` : r.text)}`).join("\n");
  const hook = c.hook ? `🪝 Hook ${esc(c.hook.template ?? shortAddr(c.hook.address))}: ${c.hook.risk} risk` : "";
  const text = [
    `🎯 <b>NIGHT SNIPER</b> · IMD launch #${c.launch}`,
    `<b>${esc(c.name ?? "New token")}${c.symbol ? ` ($${esc(c.symbol)})` : ""}</b> · ${esc(c.kind.replace(/_/g, " "))}${pair}`,
    "",
    `${verdictLabel(c.verdict)}: ${esc(c.summary)}`,
    reasons,
    "",
    hook,
    launcherLine(c, history),
    mcap ? `💰 Market cap at the call: ${usd(mcap)}` : "",
    `<code>${c.token}</code>`,
    "<i>Automated checks, not financial advice.</i>",
  ].filter((l, i, a) => l !== "" || (i > 0 && a[i - 1] !== "")).join("\n");
  // no buy button on a launch the checks say to avoid
  const first: Button[] = c.verdict === "avoid" ? [{ text: "📊 Chart", url: chartUrl(c) }] : [{ text: "🦄 Buy on Uniswap", url: uniswapUrl(c) }, { text: "📊 Chart", url: chartUrl(c) }];
  return { text, buttons: [first, [{ text: "🔎 Full verdict", url: sniperUrl(c) }, { text: "📲 Get alerts first", url: `${config.publicUrl}/sniper#alerts` }]] };
}

const nftSupply = (n: Nft) => n.maxSupply ? `${n.minted ?? 0} of ${n.maxSupply.toLocaleString("en-US")} minted` : n.minted !== null ? `${n.minted.toLocaleString("en-US")} minted` : "supply not readable";
function nftCard(c: Call, history: History): { text: string; buttons: Button[][] } {
  const n = c.nft!;
  const text = [
    `🖼 <b>NIGHT SNIPER · NEW NFT LAUNCH</b> · IMD launch #${c.launch}`,
    `<b>${esc(c.name ?? "New collection")}${c.symbol ? ` (${esc(c.symbol)})` : ""}</b> · ${n.standard}`,
    "",
    `📦 ${nftSupply(n)}`,
    n.price ? `💎 Mint price: ${n.price.amount} ${esc(n.price.unit)}` : "",
    n.owner ? `🔑 Owner ${shortAddr(n.owner)}` : "",
    launcherLine(c, history),
    `<code>${c.token}</code>`,
    "<i>Built and deployed through IMD. Automated read, not financial advice.</i>",
  ].filter((l, i, a) => l !== "" || (i > 0 && a[i - 1] !== "")).join("\n");
  const row: Button[] = [{ text: "🌊 OpenSea", url: openseaUrl(c.token) }, { text: "🔍 Etherscan", url: etherscanUrl(c.token) }];
  return { text, buttons: [row, [{ text: "🔎 Details", url: sniperUrl(c) }, ...(c.repo ? [{ text: "📜 Source", url: c.repo }] : [])]] };
}

export function hitText(c: Call, m: number, mcap: number | null): string {
  return `🚀 <b>${esc(tag(c))} ${m}x</b> since the NIGHT SNIPER call (${verdictLabel(c.verdict)})${mcap ? ` · market cap ${usd(mcap)}` : ""}`;
}
export function dumpText(c: Call): string {
  return `📉 <b>${esc(tag(c))} is down ${Math.round((1 - DUMP_AT) * 100)}%</b> since the NIGHT SNIPER call. The verdict was ${verdictLabel(c.verdict)}.`;
}
export function mintText(c: Call, pct: number): string {
  const n = c.nft!;
  return pct >= 100 ? `🏁 <b>${esc(c.name ?? tag(c))} is sold out</b>: all ${n.maxSupply!.toLocaleString("en-US")} minted.` : `🖼 <b>${esc(c.name ?? tag(c))} is ${pct}% minted</b> (${n.minted} of ${n.maxSupply!.toLocaleString("en-US")}).`;
}

export function recapText(calls: Call[], now: number): string | null {
  const day = calls.filter((c) => now - c.at < 86_400_000);
  if (!day.length) return null;
  const tokens = day.filter((c) => c.type !== "nft"), nfts = day.filter((c) => c.type === "nft");
  const count = (v: Verdict) => tokens.filter((c) => c.verdict === v).length;
  const split = (["safe", "caution", "avoid"] as const).filter((v) => count(v)).map((v) => `${count(v)} ${ICON[v]} ${v === "safe" ? "no flags" : v}`).join(", ");
  const best = tokens.filter((c) => c.entry && c.peak && c.peak / c.entry >= 1.1).sort((a, b) => b.peak! / b.entry! - a.peak! / a.entry!).slice(0, 5);
  const avoid = tokens.filter((c) => c.verdict === "avoid");
  const lines = [`🎯 <b>NIGHT SNIPER, the last 24 hours</b>`, ""];
  if (tokens.length) lines.push(`${plural(tokens.length, "IMD token launch", "IMD token launches")} checked${split ? `: ${split}` : ""}.`);
  if (nfts.length) lines.push(`${plural(nfts.length, "NFT launch", "NFT launches")}: ${nfts.map((c) => esc(c.name ?? `#${c.launch}`)).join(", ")}.`);
  if (best.length) lines.push("", "<b>Best since the call</b>", ...best.map((c, i) => `${i + 1}. ${esc(tag(c))} ${times(c.peak! / c.entry!)} at its high · ${ICON[c.verdict]}`));
  if (avoid.length) lines.push("", `⛔ Avoid calls that went on to dump: ${avoid.filter((c) => c.dumped).length} of ${avoid.length}.`);
  return lines.join("\n");
}

/** A call as the site and the app show it. */
export function publicCall(c: Call, usdOf: (quote: Address) => number, history: History = []) {
  const quoteUsd = c.pool ? usdOf(c.pool.quote) : 0;
  return {
    type: c.type ?? "token",
    launch: c.launch, token: c.token, symbol: c.symbol, name: c.name, kind: c.kind, at: c.at,
    verdict: c.verdict, summary: c.summary, reasons: c.reasons,
    quote: c.pool ? quoteName(c.pool.quote) : null,
    multiple: c.entry && c.last ? c.last / c.entry : null, peak: c.entry && c.peak ? c.peak / c.entry : null,
    mcapAtCall: mcapUsd(c, c.entry, quoteUsd), mcapNow: mcapUsd(c, c.last, quoteUsd), dumped: c.dumped,
    hook: c.hook ?? null, nft: c.nft ?? null,
    launcher: c.launcher ? { ...c.launcher, history: history.slice(0, 12) } : null,
    links: {
      uniswap: c.type === "nft" || c.verdict === "avoid" ? null : uniswapUrl(c),
      chart: c.type === "nft" ? null : chartUrl(c),
      opensea: c.type === "nft" ? openseaUrl(c.token) : null,
      etherscan: etherscanUrl(c.token), repo: c.repo,
    },
  };
}

export function createSniper(d: SniperDeps) {
  const load = (): State => {
    try { if (d.file && existsSync(d.file)) return { seen: [], calls: [], index: {}, ...JSON.parse(readFileSync(d.file, "utf8")) }; } catch { /* a fresh start */ }
    return { seen: [], calls: [], index: {} };
  };
  const st = load();
  for (const c of st.calls) c.type ??= "token";
  const save = () => { if (d.file) writeAtomic(d.file, JSON.stringify({ ...st, seen: st.seen.slice(-1000), calls: st.calls.slice(-400) })); };
  let busy = false;
  let queue: LaunchRow[] = [];
  let indexedAt = 0;

  const remember = (l: LaunchRow, det: LaunchDetail | null) => {
    st.index[String(l.launchNumber)] = { r: det?.requester?.toLowerCase() ?? "", k: l.kind, t: l.artifacts?.find((a) => a.role === "token")?.address?.toLowerCase() ?? null, c: l.chainId, at: l.createdAt };
  };

  /** Every other launch of a wallet, newest first, with how the ones NIGHT SNIPER called went. */
  function history(wallet: string, except: number): History {
    const w = wallet.toLowerCase();
    return Object.entries(st.index)
      .filter(([n, x]) => x.r === w && Number(n) !== except)
      .map(([n, x]) => {
        const c = st.calls.find((k) => k.launch === Number(n));
        return { launch: Number(n), kind: x.k, token: x.t, at: x.at, called: c ? { verdict: c.verdict, peak: c.entry && c.peak ? c.peak / c.entry : null, dumped: c.dumped } : null };
      })
      .sort((a, b) => b.launch - a.launch);
  }
  const historyOf = (c: Call) => (c.launcher ? history(c.launcher.address, c.launch) : []);

  async function tokenCall(l: LaunchRow, det: LaunchDetail | null, token: Address): Promise<Call> {
    const v = await d.verdict(token).catch((e) => { console.error("sniper verdict", l.launchNumber, (e as Error).message); return null; });
    const hookAddr = v?.hook?.address ?? (l.seeded?.pools?.[0]?.hooks as Address | undefined);
    const h = hookAddr && hookAddr !== NATIVE ? await d.hook(hookAddr.toLowerCase() as Address).catch(() => null) : null;
    const keepsPct = launcherShare(det);
    const lv = v ? launchVerdict(v, { hook: h, keepsPct }) : null;
    const art = l.artifacts?.find((a) => a.role === "token");
    const p = poolOf(token, v, l);
    const tokenDec = v?.asset.decimals ?? 18;
    const pool = p ? { ...p, tokenDec, quoteDec: p.quote === NATIVE ? 18 : await d.decimals(p.quote).catch(() => 18) } : null;
    const supply = v?.asset.totalSupply ? Number(BigInt(v.asset.totalSupply)) / 10 ** tokenDec : null;
    const c: Call = {
      type: "token", launch: l.launchNumber, id: l.id, token, symbol: v?.asset.symbol ?? null, name: v?.asset.name ?? art?.name ?? null, kind: l.kind, repo: l.sourceRepoUrl ?? null,
      at: d.now(), ...(lv ?? { verdict: "unchecked" as Verdict, summary: "The checks could not run on this launch yet.", reasons: [] }),
      pool, supply, hook: h ? hookView(h) : null, launcher: det?.requester ? { address: det.requester.toLowerCase(), keepsPct } : null, nft: null,
      entry: null, last: null, peak: null, checkedAt: null, hits: [], dumped: false, posted: false, pushedAll: false, messages: [],
    };
    if (pool) {
      const s = await d.slot0(pool.id).catch(() => null);
      const price = s ? priceOf(pool, s) : 0;
      if (price > 0) Object.assign(c, { entry: price, last: price, peak: price, checkedAt: d.now() });
    }
    return c;
  }

  async function nftCall(l: LaunchRow, det: LaunchDetail | null): Promise<Call | null> {
    for (const a of (l.artifacts ?? []).slice(0, 8)) {
      const n = await d.nft(a.address.toLowerCase() as Address).catch(() => null);
      if (!n) continue;
      return {
        type: "nft", launch: l.launchNumber, id: l.id, token: a.address.toLowerCase() as Address, symbol: n.symbol, name: n.name ?? a.name, kind: l.kind, repo: l.sourceRepoUrl ?? null,
        at: d.now(), verdict: "unchecked", summary: `${n.standard} collection · ${nftSupply({ ...n, milestones: [] })}${n.price ? ` · ${n.price.amount} ${n.price.unit} to mint` : ""}`, reasons: [],
        pool: null, supply: null, hook: null, launcher: det?.requester ? { address: det.requester.toLowerCase(), keepsPct: null } : null,
        nft: { standard: n.standard, maxSupply: n.maxSupply, minted: n.minted, price: n.price, owner: n.owner, milestones: [] },
        entry: null, last: null, peak: null, checkedAt: d.now(), hits: [], dumped: false, posted: false, pushedAll: false, messages: [],
      };
    }
    return null;
  }

  /** Older launches into the launcher index, a few each minute. */
  async function backfill(): Promise<void> {
    if (!d.allLaunches) return;
    if (d.now() - indexedAt > REINDEX_MS) {
      indexedAt = d.now();
      const all = await d.allLaunches().catch(() => [] as LaunchRow[]);
      queue = all.filter((l) => !st.index[String(l.launchNumber)]).sort((a, b) => b.launchNumber - a.launchNumber);
    }
    for (const l of queue.splice(0, BACKFILL_PER_TICK)) remember(l, await d.detail(l.id).catch(() => null));
  }

  /** New launches become calls; calls past the delay go to the community; due ones are re-read. */
  async function tick(): Promise<void> {
    if (busy) return;
    busy = true;
    try {
      const rows = await d.launches().catch((e) => { console.error("sniper launches", (e as Error).message); return [] as LaunchRow[]; });
      if (!st.started) {
        // the first run only marks where to start: no alerts for launches made before the sniper
        st.seen.push(...rows.map((l) => l.launchNumber));
        st.started = true;
      }
      const seen = new Set(st.seen);
      for (const l of rows.sort((a, b) => a.launchNumber - b.launchNumber)) {
        if (seen.has(l.launchNumber) || l.status !== "live") continue;
        st.seen.push(l.launchNumber);
        const fresh = l.chainId === 1 && d.now() - Date.parse(l.createdAt) <= FRESH_MS;
        const det = await d.detail(l.id).catch(() => null);
        remember(l, det);
        if (!fresh) continue;
        const token = l.artifacts?.find((a) => a.role === "token")?.address?.toLowerCase() as Address | undefined;
        const c = token ? await tokenCall(l, det, token) : l.kind === "evm_contracts" ? await nftCall(l, det) : null;
        if (!c) continue;
        st.calls.push(c);
        save();
        await d.push(c, "holders").catch(() => undefined);
      }
      for (const c of st.calls) {
        if (c.posted || d.now() - c.at < d.delayMs) continue;
        c.posted = true;
        const usdNow = c.pool ? await d.usdOf(c.pool.quote).catch(() => 0) : 0;
        const card = callCard(c, mcapUsd(c, c.entry, usdNow), historyOf(c));
        c.messages = await d.post(card.text, card.buttons).catch(() => []);
        if (!c.pushedAll) { c.pushedAll = true; await d.push(c, "everyone").catch(() => undefined); }
        save();
      }
      await track();
      await recap();
      await backfill();
    } finally {
      busy = false;
      save();
    }
  }

  async function track(): Promise<void> {
    const now = d.now();
    for (const c of st.calls) {
      if (!c.posted || now - c.at > FOLLOW_MS || (c.checkedAt && now - c.checkedAt < TRACK_EVERY_MS)) continue;
      if (c.type === "nft") { await trackNft(c); continue; }
      if (!c.pool) continue;
      const s = await d.slot0(c.pool.id).catch(() => null);
      c.checkedAt = now;
      const price = s ? priceOf(c.pool, s) : 0;
      if (!(price > 0)) continue;
      if (!c.entry) { Object.assign(c, { entry: price, last: price, peak: price }); continue; }
      c.last = price;
      c.peak = Math.max(c.peak ?? price, price);
      const multiple = price / c.entry;
      const hit = newHit(multiple, c.hits);
      const buttons: Button[][] = [[{ text: "🦄 Uniswap", url: uniswapUrl(c) }, { text: "📊 Chart", url: chartUrl(c) }]];
      if (hit) {
        c.hits.push(...MILESTONES.filter((m) => m <= hit && !c.hits.includes(m)));
        await d.post(hitText(c, hit, mcapUsd(c, price, await d.usdOf(c.pool.quote).catch(() => 0))), buttons, c.messages).catch(() => []);
      } else if (!c.dumped && multiple <= DUMP_AT) {
        c.dumped = true;
        await d.post(dumpText(c), [[{ text: "📊 Chart", url: chartUrl(c) }]], c.messages).catch(() => []);
      }
    }
  }

  async function trackNft(c: Call): Promise<void> {
    c.checkedAt = d.now();
    const n = await d.nft(c.token).catch(() => null);
    if (!n || !c.nft) return;
    c.nft.minted = n.minted;
    if (!c.nft.maxSupply || n.minted === null) return;
    const pct = (n.minted / c.nft.maxSupply) * 100;
    const step = newHit(pct, c.nft.milestones, MINT_STEPS);
    if (!step) return;
    c.nft.milestones.push(...MINT_STEPS.filter((m) => m <= step && !c.nft!.milestones.includes(m)));
    await d.post(mintText(c, step), [[{ text: "🌊 OpenSea", url: openseaUrl(c.token) }]], c.messages).catch(() => []);
  }

  async function recap(): Promise<void> {
    const now = new Date(d.now());
    const day = now.toISOString().slice(0, 10);
    if (now.getUTCHours() !== RECAP_HOUR_UTC || st.recapDay === day) return;
    st.recapDay = day;
    const text = recapText(st.calls, d.now());
    if (text) await d.post(text, [[{ text: "🎯 Every call", url: `${config.publicUrl}/sniper` }]]).catch(() => []);
  }

  /** Launchers ranked by how their called launches went: the best peak, how many dumped. */
  function launchers(instant: boolean) {
    const by = new Map<string, Call[]>();
    for (const c of st.calls) {
      if (!c.launcher || (!instant && !c.posted && d.now() - c.at < d.delayMs)) continue;
      by.set(c.launcher.address, [...(by.get(c.launcher.address) ?? []), c]);
    }
    return [...by.entries()].map(([address, calls]) => {
      const all = Object.values(st.index).filter((x) => x.r === address).length;
      const peaks = calls.filter((c) => c.entry && c.peak).map((c) => c.peak! / c.entry!);
      return {
        address, launches: Math.max(all, calls.length), called: calls.length,
        best: peaks.length ? Math.max(...peaks) : null, dumped: calls.filter((c) => c.dumped).length,
        avoid: calls.filter((c) => c.verdict === "avoid").length, last: Math.max(...calls.map((c) => c.at)),
      };
    }).sort((a, b) => b.last - a.last);
  }

  return {
    tick,
    /** Calls newest first; without `instant`, only those the community has seen. */
    calls(instant: boolean): Call[] {
      return st.calls.filter((c) => instant || c.posted || d.now() - c.at >= d.delayMs).slice().reverse();
    },
    historyOf,
    launchers,
    indexed: () => Object.keys(st.index).length,
    byToken: (token: string) => st.calls.find((c) => c.token === token.toLowerCase()) ?? null,
  };
}
export type Sniper = ReturnType<typeof createSniper>;

/** The track record: how many calls of each verdict, the best move since a call, and how the avoid and safe calls ended. */
export function sniperStats(calls: Call[]) {
  const tokens = calls.filter((c) => c.type !== "nft");
  const by = (v: Verdict) => tokens.filter((c) => c.verdict === v);
  const moved = tokens.filter((c) => c.entry && c.peak && c.peak / c.entry >= 1.1);
  const best = moved.sort((a, b) => b.peak! / b.entry! - a.peak! / a.entry!)[0] ?? null;
  return {
    calls: tokens.length, nfts: calls.length - tokens.length, safe: by("safe").length, caution: by("caution").length, avoid: by("avoid").length,
    best: best ? { symbol: best.symbol, launch: best.launch, peak: best.peak! / best.entry!, verdict: best.verdict } : null,
    avoidDumped: by("avoid").filter((c) => c.dumped).length, safeDumped: by("safe").filter((c) => c.dumped).length,
  };
}

export const sniperFile = () => join(config.dataDir, "sniper.json");
