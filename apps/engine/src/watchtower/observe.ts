import { type Address, type Hex, decodeAbiParameters, decodeFunctionResult, encodeFunctionData, keccak256, parseAbi, toFunctionSelector } from "viem";
import type { Ctx } from "../services/context.js";
import { SLOTS, isAddr, lc, scanCode } from "../services/evm.js";
import { HOOK_FLAGS, KNOWN_HOOKS, decodeFlags } from "../services/hook.js";
import type { Pair } from "../services/market.js";
import { HttpError, type Rpc } from "../services/net.js";
import type { AbiFn, Source } from "../services/source.js";

/**
 * WATCHTOWER, run by NIGHTSHIFT: one observation of a token or a Uniswap v4 hook on Ethereum.
 * Every check reads one thing (a code hash, a proxy slot, a getter, DexScreener's pairs) and says
 * whether it ran: ok, unavailable (the source did not answer this time) or unsupported (there is
 * no reliable reader for it). An unavailable check is never read as "no change".
 */
export type Kind = "token" | "hook";
export type Status = "ok" | "unavailable" | "unsupported";
export type Json = string | number | boolean | null | { [k: string]: Json } | Json[];
/** What a check is about: it decides the default severity of a change. */
export type Group = "code" | "implementation" | "admin" | "beacon" | "owner" | "paused" | "gate" | "decimals" | "token" | "supply" | "fee" | "feeRecipient" | "liquidity" | "other";

export type Check = {
  label: string; group: Group; status: Status;
  /** The value read (ok only). null means the getter or slot is not present / empty. */
  value: Json;
  /** The value in plain words, for reports. */
  display?: string;
  /** Where to verify it: the contract on Etherscan, or the DexScreener pair. */
  source: string;
  /** Why it is unavailable or unsupported. */
  reason?: string;
  /** Set only when the value comes from an earlier observation than the one it sits in (a merged baseline). */
  block?: number;
};

export type Observation = {
  v: 1; chain: "ethereum"; chainId: 1; address: Address; kind: Kind;
  /** Known template, by exact address (NightshiftHook, IMD PoolInitializationGuard). */
  template: string | null;
  /** When it was read (ms). */
  at: number;
  /**
   * The head block the reads were made at. The engine's Rpc door takes no block tag, so values are
   * read at the node's latest block and nothing waits for confirmations: `confirmations` is 0.
   * `hash` is the head's hash when the node can return it from inside a call, `parentHash` the
   * hash of the block before it (the EVM sees only past block hashes).
   */
  block: { number: number; hash: Hex | null; parentHash: Hex | null; confirmations: 0 };
  checks: Record<string, Check>;
  links: { address: string; block: string };
};

/** A failure with an HTTP status and a public-safe message (no node URL, no stack). */
export class WatchtowerError extends Error {
  constructor(readonly status: number, msg: string, readonly extra: Record<string, unknown> = {}) { super(msg); }
}

export const CHAIN_ID = 1;
export const DEX_API = "https://api.dexscreener.com/tokens/v1/ethereum";
export const etherscanAddress = (a: string) => `https://etherscan.io/address/${a}`;
export const etherscanBlock = (n: number) => `https://etherscan.io/block/${n}`;

/** The checks with a reader, and what each one reads. Fee, fee-recipient and gate checks are added per contract. */
export const CHECKS: Record<string, { label: string; group: Group; kinds: Kind[]; how: string }> = {
  code: { label: "Bytecode hash", group: "code", kinds: ["token", "hook"], how: "keccak256 of eth_getCode: a redeploy or code change changes it" },
  "eip1967.implementation": { label: "EIP-1967 implementation slot", group: "implementation", kinds: ["token", "hook"], how: "eth_getStorageAt 0x3608…2bbc: a proxy upgrade changes it" },
  "eip1967.admin": { label: "EIP-1967 admin slot", group: "admin", kinds: ["token", "hook"], how: "eth_getStorageAt 0xb531…6103: the proxy admin" },
  "eip1967.beacon": { label: "EIP-1967 beacon slot", group: "beacon", kinds: ["token", "hook"], how: "eth_getStorageAt 0xa3f0…3d50: a beacon proxy's beacon" },
  "eip1967.beaconImplementation": { label: "Beacon implementation", group: "implementation", kinds: ["token", "hook"], how: "implementation() on the beacon, when the beacon slot is set" },
  "owner()": { label: "Owner (owner())", group: "owner", kinds: ["token", "hook"], how: "eth_call owner()" },
  "getOwner()": { label: "Owner (getOwner())", group: "owner", kinds: ["token", "hook"], how: "eth_call getOwner()" },
  "admin()": { label: "Admin (admin())", group: "owner", kinds: ["token", "hook"], how: "eth_call admin()" },
  "paused()": { label: "Paused (paused())", group: "paused", kinds: ["token", "hook"], how: "eth_call paused()" },
  name: { label: "Name", group: "token", kinds: ["token"], how: "eth_call name()" },
  symbol: { label: "Symbol", group: "token", kinds: ["token"], how: "eth_call symbol()" },
  decimals: { label: "Decimals", group: "decimals", kinds: ["token"], how: "eth_call decimals()" },
  totalSupply: { label: "Total supply", group: "supply", kinds: ["token"], how: "eth_call totalSupply()" },
  fees: { label: "Fee settings", group: "fee", kinds: ["token", "hook"], how: "known template getters (NightshiftHook), or zero-argument fee, tax, fee-recipient and trading-gate getters in the verified ABI" },
  liquidity: { label: "Liquidity (DexScreener)", group: "liquidity", kinds: ["token"], how: "DexScreener's pairs for the token: total USD liquidity and the deepest pair" },
};

/** What Watchtower does not check, said plainly in every report. */
export const NOT_SUPPORTED: Record<Kind, { id: string; label: string; reason: string }[]> = {
  token: [
    { id: "transferRestrictions", label: "Transfer restrictions (blacklists, max transaction or wallet limits, cooldowns)", reason: "No reliable reader: these getters differ per contract, and the verdict code detects such functions without reading their values." },
    { id: "roles", label: "Role holders (AccessControl grants and revokes)", reason: "Not read: role membership needs each role's event history." },
    { id: "holders", label: "Holder concentration", reason: "Not part of Watchtower (Token Verdict scans holders)." },
    { id: "sellTax", label: "Measured buy and sell tax", reason: "Not part of Watchtower (Token Verdict simulates a buy and a sell)." },
  ],
  hook: [
    { id: "liquidity", label: "Liquidity", reason: "DexScreener lists pairs by token, not by hook: watch the pool's token for liquidity." },
    { id: "poolFee", label: "Pool LP fee (dynamic fees set per swap)", reason: "The pools of a hook are not indexed here." },
    { id: "roles", label: "Role holders (AccessControl grants and revokes)", reason: "Not read: role membership needs each role's event history." },
  ],
};

/** Getters of known templates, by template name (services/hook.ts KNOWN_HOOKS), read without a source lookup. */
type Reader = { field: string; label: string; group: Group; sig: string; out: "uint" | "address" | "bool" };
export const TEMPLATE_READERS: Record<string, { readers: Reader[]; none?: string }> = {
  NightshiftHook: { readers: [
    { field: "fee.shiftFeeBps", label: "Sell fee on the SHIFT in (shiftFeeBps())", group: "fee", sig: "shiftFeeBps()", out: "uint" },
    { field: "fee.ethFeeBps", label: "Sell fee on the ETH out (ethFeeBps())", group: "fee", sig: "ethFeeBps()", out: "uint" },
    { field: "feeRecipient.feeSplitter", label: "Fee recipient (feeSplitter())", group: "feeRecipient", sig: "feeSplitter()", out: "address" },
    { field: "gate.tradingOpen", label: "Trading gate (tradingOpen())", group: "gate", sig: "tradingOpen()", out: "bool" },
  ] },
  "IMD PoolInitializationGuard": { readers: [], none: "The IMD PoolInitializationGuard template has no fee settings: it only runs beforeInitialize." },
};

const FEE_NAME = /(fee|tax)/i;
const NOT_A_SETTING = /(total|collected|accum|earned|pending|claim|growth|balance|count|last|paid|owed|reserve|threshold|amount|denominator|divisor|precision|max|min|cap|limit|exempt|excluded)/i;
const RECIPIENT_NAME = /(fee|tax|treasury|marketing|splitter|recipient|beneficiary|collector)/i;
/** The trading-gate getters the Hook Inspector already reads (services/hook.ts). */
const GATE_NAME = /^(tradingOpen|tradingEnabled|isTradingOpen|launched)$/;

/** Fee, fee-recipient and trading-gate getters a verified ABI declares (zero arguments, one simple output), at most 12. */
export function readersFromAbi(abi: AbiFn[]): Reader[] {
  const out: Reader[] = [];
  const seen = new Set<string>();
  for (const f of abi) {
    if (f.type !== "function" || !f.name || seen.has(f.name)) continue;
    if (f.stateMutability !== "view" && f.stateMutability !== "pure") continue;
    if ((f.inputs ?? []).length !== 0 || (f.outputs ?? []).length !== 1) continue;
    const t = f.outputs![0]!.type;
    const constant = /^[A-Z0-9_]+$/.test(f.name);
    let r: Reader | null = null;
    if (GATE_NAME.test(f.name) && t === "bool") r = { field: `gate.${f.name}`, label: `Trading gate (${f.name}())`, group: "gate", sig: `${f.name}()`, out: "bool" };
    else if (!constant && t === "address" && RECIPIENT_NAME.test(f.name)) r = { field: `feeRecipient.${f.name}`, label: `Fee recipient (${f.name}())`, group: "feeRecipient", sig: `${f.name}()`, out: "address" };
    else if (!constant && /^u?int\d*$/.test(t) && FEE_NAME.test(f.name) && !NOT_A_SETTING.test(f.name)) r = { field: `fee.${f.name}`, label: `Fee setting (${f.name}())`, group: "fee", sig: `${f.name}()`, out: "uint" };
    if (r) { out.push(r); seen.add(f.name); }
  }
  return out.slice(0, 12);
}

// ---------------------------------------------------------------- reads

const MULTICALL3: Address = "0xcA11bde05977b3631167028862bE2a173976CA11";
const MC = parseAbi([
  "function aggregate3((address target, bool allowFailure, bytes callData)[] calls) payable returns ((bool success, bytes returnData)[] returnData)",
  "function getBlockHash(uint256 blockNumber) view returns (bytes32 blockHash)",
]);
export const MULTICALL3_ADDRESS = MULTICALL3;

/**
 * Many calls in one eth_call (Multicall3), each allowed to fail on its own. Unlike services'
 * multicall(), a failed batch throws instead of looking like "every getter is absent", so a
 * node that did not answer can never pass for a contract without an owner.
 */
async function aggregate(rpc: Rpc, calls: { to: Address; data: Hex }[]): Promise<(Hex | null)[]> {
  const r = await rpc.call({ to: MULTICALL3, data: encodeFunctionData({ abi: MC, functionName: "aggregate3", args: [calls.map((c) => ({ target: c.to, allowFailure: true, callData: c.data }))] }) });
  if (!r.ok) throw new Error("multicall failed");
  const rows = decodeFunctionResult({ abi: MC, functionName: "aggregate3", data: r.data }) as readonly { success: boolean; returnData: Hex }[];
  if (rows.length !== calls.length) throw new Error("multicall answered the wrong number of results");
  return rows.map((x) => (x.success && x.returnData !== "0x" ? x.returnData : null));
}

type Settled<T> = { ok: true; v: T } | { ok: false; e: unknown };
const settle = <T,>(p: Promise<T>): Promise<Settled<T>> => p.then((v) => ({ ok: true as const, v }), (e: unknown) => ({ ok: false as const, e }));
/** Free nodes and DexScreener sometimes refuse one read in a burst: once more before giving up. */
const twice = <T,>(f: () => Promise<T>): Promise<T> => f().catch(() => f());
/** A public-safe reason: a status code, never the raw error (it can carry a node URL). */
function why(e: unknown, who: string): string {
  if (e instanceof HttpError) return e.status === 429 ? `${who} rate-limited the read (429)` : `${who} answered ${e.status}`;
  return `${who} did not answer`;
}

const word = (d: Hex | null): string | null => (d && d.length >= 66 ? d.slice(2, 66) : null);
const asAddr = (d: Hex | null): Address | null => { const w = word(d); return w && /^0{24}/.test(w) ? lc(`0x${w.slice(24)}`) : null; };
const asBool = (d: Hex | null): boolean | null => { const w = word(d); return w === null ? null : /^0{64}$/.test(w) ? false : /^0{63}1$/.test(w) ? true : null; };
const asUint = (d: Hex | null): bigint | null => { const w = word(d); return w === null ? null : BigInt(`0x${w}`); };
const asStr = (d: Hex | null): string | null => {
  if (!d) return null;
  try { return decodeAbiParameters([{ type: "string" }], d)[0] as string; } catch { /* bytes32 names (old tokens) */ }
  if (d.length === 66) return Buffer.from(d.slice(2), "hex").toString("utf8").replace(/\0+$/, "") || null;
  return null;
};
/** A proxy slot: the address it holds, the raw word if it is not an address, or null when empty. */
const slotValue = (v: Hex): string | null => {
  const h = v.replace(/^0x/, "").padStart(64, "0").slice(-64);
  if (/^0{64}$/.test(h)) return null;
  return /^0{24}/.test(h) ? `0x${h.slice(24)}` : `0x${h}`;
};
const sel = (sig: string) => toFunctionSelector(sig) as Hex;

/**
 * A v4 hook by its own evidence: valid permission bits in its address, and its dispatcher has the
 * callback one of those bits asks the PoolManager to call (or getHookPermissions()). Most
 * addresses have some low bits set, so the bits alone prove nothing.
 */
export function looksLikeHook(address: string, code: Hex): boolean {
  const flags = decodeFlags(address);
  if (!flags.valid || flags.bits === 0 || code === "0x") return false;
  const selectors = new Set(scanCode(code).selectors);
  if (selectors.has(toFunctionSelector("getHookPermissions()").slice(2))) return true;
  return HOOK_FLAGS.some((f) => f.sig && flags.permissions.find((p) => p.name === f.name)?.set && selectors.has(toFunctionSelector(f.sig).slice(2)));
}
const ZERO_ADDR = "0x0000000000000000000000000000000000000000";
const short = (a: string) => `${a.slice(0, 6)}…${a.slice(-4)}`;
const addrText = (a: string | null) => (a === null ? "not present" : a === ZERO_ADDR ? `${a} (zero address)` : a);
export const usd = (x: number) => `$${Math.round(x).toLocaleString("en-US")}`;
const units = (v: bigint, dec: number | null) => (dec === null ? v.toString() : dec === 0 ? v.toLocaleString("en-US") : `${(Number(v) / 10 ** dec).toLocaleString("en-US", { maximumFractionDigits: 4 })}`);

export type Liquidity = { totalUsd: number; pairs: number; top: { url: string; dex: string; pairAddress: string; liquidityUsd: number } | null };

/** DexScreener's pairs for one token, read directly (not through the 3-minute market cache, which turns a failed read into "no pairs"). */
async function readLiquidity(ctx: Ctx, token: Address): Promise<{ ok: true; v: Liquidity } | { ok: false; reason: string }> {
  let rows: Pair[];
  try { rows = await twice(() => ctx.d.net.json<Pair[]>(`${DEX_API}/${token}`, 10_000)); } catch (e) { return { ok: false, reason: why(e, "DexScreener") }; }
  if (!Array.isArray(rows)) return { ok: false, reason: "DexScreener answered with something other than a pair list" };
  const mine = rows.filter((p) => p?.chainId === "ethereum" && (p.baseToken?.address?.toLowerCase() === token || p.quoteToken?.address?.toLowerCase() === token));
  const sorted = [...mine].sort((a, b) => (b.liquidity?.usd ?? 0) - (a.liquidity?.usd ?? 0));
  const best = sorted[0];
  return { ok: true, v: {
    totalUsd: Math.round(mine.reduce((s, p) => s + (p.liquidity?.usd ?? 0), 0)), pairs: mine.length,
    top: best ? { url: best.url, dex: `${best.dexId}${best.labels?.length ? ` ${best.labels.join("/")}` : ""}`, pairAddress: best.pairAddress, liquidityUsd: Math.round(best.liquidity?.usd ?? 0) } : null,
  } };
}

/**
 * Reads one observation of `address` on Ethereum. `kind` is told by the caller or found here: an
 * ERC-20 (it answers totalSupply() and decimals()) or a v4 hook (an exact template match or
 * permission bits in its address). Throws (status 503) only when the head block cannot be read;
 * any other failed read becomes an unavailable check.
 */
export async function observe(ctx: Ctx, address: string, kind?: Kind): Promise<Observation> {
  if (!isAddr(address)) throw new WatchtowerError(400, "The address must be 0x followed by 40 hex characters.");
  const a = lc(address);
  const rpc = ctx.d.rpc;
  let head: bigint;
  try { head = await twice(() => rpc.head()); } catch {
    throw new WatchtowerError(503, "The Ethereum node did not answer the block number, so nothing was read. Try again in a minute.");
  }
  const at = ctx.d.now();
  const n = Number(head);
  const src0 = etherscanAddress(a);
  const known = KNOWN_HOOKS[a];
  const template = known ? TEMPLATE_READERS[known.template] ?? null : null;
  const isHook = kind === "hook" || (!kind && Boolean(known));

  const [code, impl, admin, beacon, source, dex] = await Promise.all([
    settle(twice(() => rpc.code(a))),
    settle(twice(() => rpc.storage(a, SLOTS.eip1967Impl))),
    settle(twice(() => rpc.storage(a, SLOTS.eip1967Admin))),
    settle(twice(() => rpc.storage(a, SLOTS.eip1967Beacon))),
    template ? Promise.resolve(null) : settle(ctx.source(CHAIN_ID, a)),
    isHook ? Promise.resolve(null) : readLiquidity(ctx, a),
  ]);
  if (code.ok && code.v === "0x" && !kind) throw new WatchtowerError(404, "No contract at this address on Ethereum mainnet.");

  // fee getters: a known template's, or the verified ABI's (an upgradeable proxy's implementation ABI too)
  let readers: Reader[] = [];
  let feesNote: Check | null = null;
  if (template) {
    readers = template.readers;
    if (!readers.length) feesNote = { label: CHECKS.fees!.label, group: "fee", status: "unsupported", value: null, source: src0, reason: template.none ?? "This template has no fee settings to read." };
  } else if (source && !source.ok) {
    feesNote = { label: CHECKS.fees!.label, group: "fee", status: "unavailable", value: null, source: src0, reason: "The verified-source lookup (Sourcify or Etherscan) did not answer, so the fee getters could not be located" };
  } else if (source?.ok && !source.v.verified) {
    feesNote = { label: CHECKS.fees!.label, group: "fee", status: "unsupported", value: null, source: src0, reason: "The source is not verified and the contract is no known template, so fee settings cannot be located" };
  } else if (source?.ok && source.v.verified) {
    let abi = source.v.abi;
    const implAddr = (source.v.proxy?.implementation ?? (impl.ok ? slotValue(impl.v) : null)) as string | null;
    if (implAddr && isAddr(implAddr)) {
      const s = await ctx.source(CHAIN_ID, lc(implAddr)).catch((): Source | null => null);
      if (s?.verified) abi = [...abi, ...s.abi];
    }
    readers = readersFromAbi(abi);
    if (!readers.length) feesNote = { label: CHECKS.fees!.label, group: "fee", status: "unsupported", value: null, source: source.v.url, reason: "The verified ABI declares no fee, tax, fee-recipient or trading-gate getter to read" };
  }

  const beaconAddr = beacon.ok ? slotValue(beacon.v) : null;
  const calls: { key: string; to: Address; data: Hex }[] = [
    { key: "hash", to: MULTICALL3, data: encodeFunctionData({ abi: MC, functionName: "getBlockHash", args: [head] }) },
    { key: "parent", to: MULTICALL3, data: encodeFunctionData({ abi: MC, functionName: "getBlockHash", args: [head - 1n] }) },
    ...["owner()", "getOwner()", "admin()", "paused()", "name()", "symbol()", "decimals()", "totalSupply()"].map((s) => ({ key: s, to: a, data: sel(s) })),
    ...readers.map((r) => ({ key: r.field, to: a, data: sel(r.sig) })),
    ...(beaconAddr && isAddr(beaconAddr) ? [{ key: "beaconImpl", to: lc(beaconAddr), data: sel("implementation()") }] : []),
  ];
  const agg = await settle(twice(() => aggregate(rpc, calls)));
  const got = (k: string): Hex | null => (agg.ok ? agg.v[calls.findIndex((c) => c.key === k)] ?? null : null);

  // which kind of contract
  let k: Kind;
  if (kind) k = kind;
  else if (agg.ok && asUint(got("totalSupply()")) !== null && asUint(got("decimals()")) !== null) k = "token";
  else if (known || (code.ok && looksLikeHook(a, code.v))) k = "hook";
  else if (!agg.ok || !code.ok) throw new WatchtowerError(503, "The Ethereum node did not answer the reads that tell a token from a hook, so nothing was recorded. Try again in a minute.");
  else throw new WatchtowerError(422, "This contract is neither an ERC-20 token (no totalSupply() and decimals()) nor a recognisable Uniswap v4 hook (no hook callback matching the permission bits in its address). Pass kind=hook if it is a hook.");

  const checks: Record<string, Check> = {};
  const base = (id: string): Pick<Check, "label" | "group"> => ({ label: CHECKS[id]!.label, group: CHECKS[id]!.group });
  const ok = (id: string, value: Json, display: string, source = src0, meta = base(id)): void => { checks[id] = { ...meta, status: "ok", value, display, source }; };
  const down = (id: string, reason: string, source = src0, meta = base(id)): void => { checks[id] = { ...meta, status: "unavailable", value: null, source, reason }; };
  const callDown = "The Ethereum node did not answer the batched eth_call";

  // code and proxy slots
  if (code.ok) {
    if (code.v === "0x") ok("code", null, "no code at this address");
    else { const h = keccak256(code.v); ok("code", h, `${(code.v.length - 2) / 2} bytes, keccak256 ${h}`); }
  } else down("code", why(code.e, "The Ethereum node"));
  for (const [id, r] of [["eip1967.implementation", impl], ["eip1967.admin", admin], ["eip1967.beacon", beacon]] as const) {
    if (r.ok) { const v = slotValue(r.v); ok(id, v, v === null ? "empty" : v); } else down(id, why(r.e, "The Ethereum node"));
  }
  if (!beacon.ok) down("eip1967.beaconImplementation", "The beacon slot could not be read");
  else if (!beaconAddr || !isAddr(beaconAddr)) ok("eip1967.beaconImplementation", null, "no beacon");
  else if (!agg.ok) down("eip1967.beaconImplementation", callDown);
  else { const v = asAddr(got("beaconImpl")); ok("eip1967.beaconImplementation", v, addrText(v), etherscanAddress(beaconAddr)); }

  // owner, admin, paused
  for (const id of ["owner()", "getOwner()", "admin()"]) {
    if (!agg.ok) down(id, callDown);
    else { const v = asAddr(got(id)); ok(id, v, addrText(v)); }
  }
  if (!agg.ok) down("paused()", callDown);
  else { const v = asBool(got("paused()")); ok("paused()", v, v === null ? "not present" : v ? "paused" : "not paused"); }

  // the token itself
  if (k === "token") {
    if (!agg.ok) for (const id of ["name", "symbol", "decimals", "totalSupply"]) down(id, callDown);
    else {
      const nm = asStr(got("name()")), sy = asStr(got("symbol()"));
      const dRaw = asUint(got("decimals()")), ts = asUint(got("totalSupply()"));
      const dec = dRaw !== null && dRaw <= 255n ? Number(dRaw) : null;
      ok("name", nm, nm ?? "not present");
      ok("symbol", sy, sy ?? "not present");
      ok("decimals", dec, dec === null ? "not present" : String(dec));
      ok("totalSupply", ts === null ? null : ts.toString(), ts === null ? "not present" : `${units(ts, dec)}${sy ? ` ${sy}` : ""}`);
    }
  }

  // fee settings
  if (feesNote) checks.fees = feesNote;
  for (const r of readers) {
    const meta = { label: r.label, group: r.group };
    if (!agg.ok) { down(r.field, callDown, src0, meta); continue; }
    const raw = got(r.field);
    if (r.out === "address") { const v = asAddr(raw); ok(r.field, v, addrText(v), src0, meta); }
    else if (r.out === "bool") { const v = asBool(raw); ok(r.field, v, v === null ? "not present" : String(v), src0, meta); }
    else { const v = asUint(raw); ok(r.field, v === null ? null : v <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(v) : v.toString(), v === null ? "not present" : v.toString(), src0, meta); }
  }

  // liquidity
  if (k === "token") {
    const dexUrl = `https://dexscreener.com/ethereum/${a}`;
    if (!dex) down("liquidity", "DexScreener was not read", dexUrl);
    else if (!dex.ok) down("liquidity", dex.reason, dexUrl);
    else {
      const l = dex.v;
      ok("liquidity", l as unknown as Json, l.pairs ? `${usd(l.totalUsd)} across ${l.pairs} pair${l.pairs > 1 ? "s" : ""}; deepest ${l.top!.dex} ${usd(l.top!.liquidityUsd)}` : "DexScreener lists no pair", l.top?.url ?? dexUrl);
    }
  }

  // what is not supported, said in every observation
  for (const u of NOT_SUPPORTED[k]) checks[`unsupported.${u.id}`] = { label: u.label, group: "other", status: "unsupported", value: null, source: src0, reason: u.reason };

  const hash = (key: string): Hex | null => { const w = word(got(key)); return w && !/^0{64}$/.test(w) ? (`0x${w}` as Hex) : null; };
  return {
    v: 1, chain: "ethereum", chainId: 1, address: a, kind: k, template: known?.template ?? null, at,
    block: { number: n, hash: hash("hash"), parentHash: hash("parent"), confirmations: 0 },
    checks, links: { address: src0, block: etherscanBlock(n) },
  };
}

export const shortAddr = short;
