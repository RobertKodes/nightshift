import { type Address, type Hex, decodeAbiParameters, toFunctionSelector } from "viem";
import type { PoolKey } from "../v4.js";
import { type Confidence, type Ctx, DISCLAIMER, Proof, RUN_BY, confidence } from "./context.js";
import { type CodeScan, type Power, PLAIN, SELECTOR_POWER, ZERO, lc, lookupSelectors, proxyInfo, scanCode, short } from "./evm.js";
import { IMD_FACTORIES, hookOf, launchUrl, tokenOf } from "./imd.js";
import { multicall } from "./net.js";
import { type AbiFn, type Fn, excerpt, factsOf, functionsOf, scopeTo } from "./source.js";
import { DYNAMIC_FEE, poolIdOf, poolsOfHook, slot0 } from "./v4pool.js";

/**
 * HOOK INSPECTOR, run by NIGHTSHIFT: what a Uniswap v4 hook can do, read from the address bits,
 * the code and (when verified) the source. The address says which callbacks the PoolManager will
 * ever call; the code says what they do and who controls them.
 */
const KEY = "(address,address,uint24,int24,address)";
const LIQ = "(int24,int24,int256,bytes32)";
const SWAP = "(bool,int256,uint160)";
export const HOOK_FLAGS: { bit: number; name: string; sig?: string; base?: string; what: string }[] = [
  { bit: 13, name: "beforeInitialize", sig: `beforeInitialize(address,${KEY},uint160)`, what: "runs before a pool with this hook is created: can refuse pools (often: only one pool, or only a factory)" },
  { bit: 12, name: "afterInitialize", sig: `afterInitialize(address,${KEY},uint160,int24)`, what: "runs after a pool is created" },
  { bit: 11, name: "beforeAddLiquidity", sig: `beforeAddLiquidity(address,${KEY},${LIQ},bytes)`, what: "runs before liquidity is added: can refuse or restrict LPs" },
  { bit: 10, name: "afterAddLiquidity", sig: `afterAddLiquidity(address,${KEY},${LIQ},int256,int256,bytes)`, what: "runs after liquidity is added" },
  { bit: 9, name: "beforeRemoveLiquidity", sig: `beforeRemoveLiquidity(address,${KEY},${LIQ},bytes)`, what: "runs before liquidity is removed: can refuse a withdrawal and keep LPs in" },
  { bit: 8, name: "afterRemoveLiquidity", sig: `afterRemoveLiquidity(address,${KEY},${LIQ},int256,int256,bytes)`, what: "runs after liquidity is removed" },
  { bit: 7, name: "beforeSwap", sig: `beforeSwap(address,${KEY},${SWAP},bytes)`, what: "runs before every swap: can refuse it, set a per-swap fee, or take a cut" },
  { bit: 6, name: "afterSwap", sig: `afterSwap(address,${KEY},${SWAP},int256,bytes)`, what: "runs after every swap: can act on the result or take a cut of the output" },
  { bit: 5, name: "beforeDonate", sig: `beforeDonate(address,${KEY},uint256,uint256,bytes)`, what: "runs before a donation to LPs" },
  { bit: 4, name: "afterDonate", sig: `afterDonate(address,${KEY},uint256,uint256,bytes)`, what: "runs after a donation to LPs" },
  { bit: 3, name: "beforeSwapReturnsDelta", base: "beforeSwap", what: "beforeSwap may change the swap's amounts: take tokens from the swapper (a fee) or replace the pool's pricing" },
  { bit: 2, name: "afterSwapReturnsDelta", base: "afterSwap", what: "afterSwap may change what the swapper receives: a fee on the output" },
  { bit: 1, name: "afterAddLiquidityReturnsDelta", base: "afterAddLiquidity", what: "afterAddLiquidity may change what an LP pays in" },
  { bit: 0, name: "afterRemoveLiquidityReturnsDelta", base: "afterRemoveLiquidity", what: "afterRemoveLiquidity may take part of what an LP withdraws" },
];
const CALLBACK_SEL = new Map(HOOK_FLAGS.filter((f) => f.sig).map((f) => [f.name, toFunctionSelector(f.sig!).slice(2)]));
const PM = {
  take: toFunctionSelector("take(address,address,uint256)").slice(2),
  mint: toFunctionSelector("mint(address,uint256,uint256)").slice(2),
  settle: toFunctionSelector("settle()").slice(2),
  sync: toFunctionSelector("sync(address)").slice(2),
  donate: toFunctionSelector(`donate(${KEY},uint256,uint256,bytes)`).slice(2),
  updateDynamicLPFee: toFunctionSelector(`updateDynamicLPFee(${KEY},uint24)`).slice(2),
  unlock: toFunctionSelector("unlock(bytes)").slice(2),
};

export type FlagView = { bits: number; hex: string; permissions: { name: string; set: boolean; what: string }[]; valid: boolean; problems: string[] };
/** The permission bits a v4 hook's address carries (its lowest 14 bits): fixed at deployment, they decide which callbacks ever run. */
export function decodeFlags(address: string): FlagView {
  const bits = Number(BigInt(address) & 0x3fffn);
  const has = (b: number) => (bits & (1 << b)) !== 0;
  const problems: string[] = [];
  for (const f of HOOK_FLAGS.filter((x) => x.base)) {
    const base = HOOK_FLAGS.find((x) => x.name === f.base)!;
    if (has(f.bit) && !has(base.bit)) problems.push(`${f.name} is set without ${f.base}: the PoolManager refuses to create a pool with this hook`);
  }
  return { bits, hex: `0x${bits.toString(16).padStart(4, "0")}`, permissions: HOOK_FLAGS.map((f) => ({ name: f.name, set: has(f.bit), what: f.what })), valid: problems.length === 0, problems };
}

/** Hooks we know by address. */
export const KNOWN_HOOKS: Record<string, { template: string; by: string; note: string }> = {
  "0x42ebcf86e3ab0445ba0362f911a7e8fad6ace0cc": { template: "NightshiftHook", by: "NIGHTSHIFT ($SHIFT, IMD launch #2124)", note: "Launch gate (until the treasury 0x3322…4D69 made the first buy, checked with tx.origin, every other swap reverted), then a sell fee of 2.5% of the SHIFT in and 2.5% of the ETH out to the FeeSplitter. The owner can lower either part and never raise it above 2.5%." },
  "0x784ff9a3ac5d88a30bfff6f7f2a270161fbe6000": { template: "IMD PoolInitializationGuard", by: "IMD (shared by IMD custom-token launches on Ethereum)", note: "beforeInitialize only: lets IMD's factory create the launch pool and refuses anyone else. It never runs on swaps or liquidity." },
  "0x19bec7c2e1b2aadaf67b259744751a9960d66000": { template: "IMD PoolInitializationGuard", by: "IMD (Robinhood Chain)", note: "beforeInitialize only, as on Ethereum." },
  "0xa0602cb30558d5dd17415b6268a4feea3a0ca000": { template: "IMD PoolInitializationGuard", by: "IMD (Sepolia)", note: "beforeInitialize only, as on Ethereum." },
};

type View = { name: string; type: string; value: string | number | boolean };
const SIMPLE = /^(address|bool|string|bytes32|u?int\d*)$/;
/** Every zero-argument view the ABI declares (up to 40), read in one call: the hook's live settings. */
export async function readViews(ctx: Ctx, address: Address, abi: AbiFn[]): Promise<View[]> {
  const fns = abi.filter((f) => f.type === "function" && (f.stateMutability === "view" || f.stateMutability === "pure") && (f.inputs ?? []).length === 0 && (f.outputs ?? []).length === 1 && SIMPLE.test(f.outputs![0]!.type)).slice(0, 40);
  if (!fns.length) return [];
  const r = await multicall(ctx.d.rpc, fns.map((f) => ({ to: address, data: toFunctionSelector(`${f.name}()`) as Hex })));
  const out: View[] = [];
  fns.forEach((f, i) => {
    const raw = r[i];
    if (!raw) return;
    try {
      const t = f.outputs![0]!.type;
      const v = decodeAbiParameters([{ type: t }], raw)[0] as unknown;
      out.push({ name: f.name!, type: t, value: typeof v === "bigint" ? (v <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(v) : v.toString()) : typeof v === "string" && t === "address" ? v.toLowerCase() : (v as string | boolean) });
    } catch { /* not what the ABI said */ }
  });
  return out;
}

/** Who an owner is: nobody (renounced), a wallet, a Safe (with its threshold) or another contract. */
export async function ownerKind(ctx: Ctx, owner: Address | null): Promise<{ address: Address | null; kind: "none" | "renounced" | "wallet" | "safe" | "contract"; safe?: { threshold: number; owners: number } }> {
  if (!owner) return { address: null, kind: "none" };
  if (owner === ZERO || owner.toLowerCase() === "0x000000000000000000000000000000000000dead") return { address: owner, kind: "renounced" };
  const code = await ctx.code(owner).catch(() => "0x" as Hex);
  // an EOA, also one with an EIP-7702 delegation (its code is 0xef0100 + the delegate)
  if (code === "0x" || code.startsWith("0xef0100")) return { address: owner, kind: "wallet" };
  const r = await multicall(ctx.d.rpc, [{ to: owner, data: toFunctionSelector("getThreshold()") as Hex }, { to: owner, data: toFunctionSelector("getOwners()") as Hex }]);
  if (r[0]) {
    let owners = 0;
    try { owners = (decodeAbiParameters([{ type: "address[]" }], r[1]!)[0] as readonly string[]).length; } catch { /* unknown */ }
    return { address: owner, kind: "safe", safe: { threshold: Number(BigInt(r[0])), owners } };
  }
  return { address: owner, kind: "contract" };
}

export type AdminFn = { name: string; signature: string | null; power: Power | null; gate: Fn["gate"] | "unknown"; capped?: string | null; file?: string; line?: number; note: string };
export type HookReport = {
  service: "hook-inspector"; runBy: string; chain: "ethereum"; chainId: 1; address: Address; explain: boolean;
  summary: string; risk: "low" | "medium" | "high";
  flags: FlagView;
  callbacks: { name: string; calledByPoolManager: boolean; inCode: boolean | null; implemented: boolean | null }[];
  template: { name: string; by: string; note: string; match: string } | null;
  imd: { launchNumber: number; kind: string; status: string; token: string | null; url: string } | null;
  source: { verified: boolean; via?: string; contract?: string; compiler?: string | null; url?: string; files?: string[]; note?: string };
  code: { bytes: number; functions: number; delegatecall: boolean; selfdestruct: boolean; embeddedAddresses: string[]; names: "source" | "abi" | "signature-database" };
  owner: Awaited<ReturnType<typeof ownerKind>>;
  upgradeable: { proxy: boolean; kind: string | null; implementation: Address | null; admin: Address | null; note: string };
  pools: { poolId: Hex; key: PoolKey; fee: { type: "static" | "dynamic"; poolFeeBps: number | null; currentLpFeeBps: number | null }; tick: number | null; source: string }[];
  fees: { swapFee: string; hookFee: string; parameters: View[]; recipients: { name: string; address: string; label: string | null }[] };
  adminFunctions: AdminFn[];
  powers: { text: string; level: "high" | "medium" | "low" | "info" }[];
  explanation?: { text: string; excerpts: { name: string; code: string }[] };
  confidence: Confidence; evidence: Proof["list"]; generatedAt: string; disclaimer: string;
};

/** Inspects one hook. `explain` adds the written explanation and the source lines behind every power. */
export async function inspectHook(ctx: Ctx, address: Address, explain: boolean): Promise<HookReport> {
  const a = lc(address);
  const ev = new Proof();
  const flags = decodeFlags(a);
  ev.add(`Permission bits ${flags.hex} read from the address's lowest 14 bits`, "address");
  const [code, src, imd, head] = await Promise.all([ctx.code(a), ctx.source(1, a).catch(() => null), ctx.imd.launchOf(1, a).catch(() => null), ctx.head()]);
  if (code === "0x") throw Object.assign(new Error("No contract at this address on Ethereum."), { status: 404 });
  ev.add(`Runtime code, ${(code.length - 2) / 2} bytes`, "eth_getCode");
  const scan: CodeScan = scanCode(code);
  const files = src?.verified ? scopeTo(src.files, src.contract) : {};
  const fns = functionsOf(files);
  const facts = factsOf(files, fns);
  src?.verified ? ev.add(`Verified source: ${src.contract} (${Object.keys(files).length} project files, ${src.libraryFiles} library files)`, src.via, { url: src.url }) : ev.add(src ? src.note : "Source lookup failed", "sourcify");

  // callbacks: called (bits) vs present (dispatcher) vs really implemented (source)
  const callbacks = HOOK_FLAGS.filter((f) => f.sig).map((f) => {
    const called = flags.permissions.find((p) => p.name === f.name)!.set;
    const inCode = scan.selectors.length ? scan.selectors.includes(CALLBACK_SEL.get(f.name)!) : null;
    const fn = fns.find((x) => x.name === f.name || x.name === `_${f.name}`);
    const implemented = src?.verified ? Boolean(fn && !/HookNotImplemented/.test(fn.body.slice(0, 300)) && fn.body.replace(/\s/g, "").length > 4) : inCode;
    return { name: f.name, calledByPoolManager: called, inCode, implemented };
  });
  const missing = callbacks.filter((c) => c.calledByPoolManager && c.inCode === false);

  // template
  const known = KNOWN_HOOKS[a];
  const launch = imd?.launch ?? null;
  let template: HookReport["template"] = known ? { name: known.template, by: known.by, note: known.note, match: "exact address" } : null;
  if (!template && launch && hookOf(launch)?.address.toLowerCase() === a) template = launch.kind === "univ4_hook"
    ? { name: "IMD univ4_hook launch hook", by: `IMD launch #${launch.launchNumber} (${hookOf(launch)!.name}), built and audited by the IMD swarm, deployed by IMD`, note: "IMD's univ4_hook launches pair a hook written for the launch with a 1.25% pool that only IMD's factory may initialise (the beforeInitialize bit). What happens on swaps is this hook's own code: read the callbacks and powers below.", match: "IMD launch artifact" }
    : { name: hookOf(launch)!.name, by: `IMD launch #${launch.launchNumber}`, note: "A hook deployed by an IMD launch.", match: "IMD launch artifact" };
  launch ? ev.add(`IMD launch #${launch.launchNumber} (${launch.kind}, ${launch.status}) lists this address as its ${imd!.artifact.role}`, "api.imd.fun", { url: launchUrl(launch) }) : null;

  // owner, settings and powers
  const abi: AbiFn[] = src?.verified ? src.abi : [];
  const views = abi.length ? await readViews(ctx, a, abi) : [];
  let ownerAddr = (views.find((v) => v.name === "owner" && v.type === "address")?.value as Address | undefined) ?? null;
  if (!ownerAddr && scan.selectors.includes("8da5cb5b")) {
    const r = await multicall(ctx.d.rpc, [{ to: a, data: "0x8da5cb5b" }]);
    if (r[0]) ownerAddr = lc(`0x${r[0].slice(26)}`);
  }
  const owner = await ownerKind(ctx, ownerAddr);
  ownerAddr ? ev.add(`owner() = ${ownerAddr} (${owner.kind}${owner.safe ? `, ${owner.safe.threshold} of ${owner.safe.owners}` : ""})`, "eth_call") : null;
  const names = src?.verified ? new Map<string, string>() : await lookupSelectors(ctx.d.net, scan.selectors).catch(() => new Map<string, string>());
  const adminFunctions: AdminFn[] = [];
  if (src?.verified) {
    for (const f of fns.filter((x) => (x.visibility === "external" || x.visibility === "public") && x.mutability !== "view" && x.mutability !== "pure")) {
      if (HOOK_FLAGS.some((h) => h.name === f.name) || f.name === "unlockCallback") continue;
      if (f.gate === "anyone" && !f.power) continue;
      const caps = [...new Map(facts.feeConstants.filter((c) => /MAX|CAP|LIMIT/.test(c.name) && f.body.includes(c.name)).map((c) => [c.name, c])).values()];
      adminFunctions.push({ name: f.name, signature: `${f.name}(${f.params})`, power: f.power, gate: f.gate, capped: caps.length ? caps.map((c) => `${c.name} = ${c.value}`).join(", ") : null, file: f.file, line: f.line,
        note: f.gate === "anyone" ? "anyone can call it" : `only the ${f.gate === "owner" ? "owner" : f.gate === "role" ? "holder of a role" : f.gate}` });
    }
  } else {
    for (const s of scan.selectors) {
      const k = SELECTOR_POWER.get(s);
      const n = k?.sig ?? names.get(s) ?? null;
      if (!k && (!n || PLAIN.has(s))) continue;
      if (CALLBACK_SEL.size && [...CALLBACK_SEL.values()].includes(s)) continue;
      adminFunctions.push({ name: n?.split("(")[0] ?? `0x${s}`, signature: n, power: k?.power ?? null, gate: "unknown", note: "found in the bytecode; who may call it is not visible without source" });
    }
  }
  ev.add(src?.verified ? `${adminFunctions.length} state-changing functions with a gate or a power, read from the verified source` : `${scan.selectors.length} functions in the bytecode dispatcher, named from openchain.xyz's signature database where possible`, src?.verified ? src.via : "eth_getCode");

  // pools
  const pools: HookReport["pools"] = [];
  const seeded = (await ctx.imd.launches().catch(() => ({ list: [] as never[] }))).list.flatMap((l) => (l.seeded?.pools ?? []).filter((p) => p.hooks.toLowerCase() === a).map((p) => ({ p, l })));
  for (const { p } of seeded.slice(0, 5)) {
    const key: PoolKey = { currency0: lc(p.currency0), currency1: lc(p.currency1), fee: p.fee, tickSpacing: p.tickSpacing, hooks: lc(p.hooks) };
    pools.push({ poolId: poolIdOf(key), key, fee: feeOf(key), tick: null, source: "api.imd.fun seeded pool" });
  }
  if (!pools.length && src?.verified && src.deployBlock) {
    for (const x of await poolsOfHook(ctx.d.rpc, a, BigInt(src.deployBlock), head, 4)) pools.push({ poolId: x.id, key: x.key, fee: feeOf(x.key), tick: null, source: `PoolManager Initialize event, block ${x.block}` });
  }
  for (const p of pools) {
    const s = await slot0(ctx.d.rpc, p.poolId).catch(() => null);
    if (s) { p.tick = s.tick; p.fee.currentLpFeeBps = s.lpFee / 100; }
  }
  pools.length ? ev.add(`${pools.length} pool(s) with this hook; fee and price from the PoolManager's storage`, "eth_getStorageAt") : null;

  // fees
  const dynamic = pools.some((p) => p.fee.type === "dynamic") || scan.pushed4.has(PM.updateDynamicLPFee) || /updateDynamicLPFee/.test(Object.values(files).join("\n"));
  const takes = scan.pushed4.has(PM.take) || scan.pushed4.has(PM.mint);
  const deltaFlags = flags.permissions.filter((p) => p.set && /ReturnsDelta$/.test(p.name)).map((p) => p.name);
  const feeViews = views.filter((v) => /fee|bps|tax|rate/i.test(v.name) && v.type !== "address");
  const recipients = views.filter((v) => v.type === "address" && /splitter|treasury|recipient|fee|beneficiary|collector/i.test(v.name) && v.value !== ZERO)
    .map((v) => ({ name: v.name, address: String(v.value), label: IMD_FACTORIES[String(v.value)] ?? null }));
  const swapFee = pools.length ? pools.map((p) => p.fee.type === "dynamic" ? `dynamic (the hook sets it; now ${p.fee.currentLpFeeBps ?? "?"} bps)` : `${p.fee.poolFeeBps} bps static`).join("; ") : dynamic ? "dynamic (the hook can set it per swap)" : "no pool found to read";
  const hookFee = deltaFlags.length && takes
    ? `takes its own fee: ${deltaFlags.join(" and ")} set and it moves pool currency out with PoolManager.take/mint${feeViews.length ? ` (settings: ${feeViews.map((v) => `${v.name} = ${v.value}`).join(", ")})` : ""}${recipients.length ? `, to ${recipients.map((r) => `${r.name} ${short(r.address)}`).join(", ")}` : ""}`
    : deltaFlags.length ? `can change swap amounts (${deltaFlags.join(", ")}), no direct take found in the code`
    : takes ? "calls PoolManager.take or mint, but no return-delta bit is set: it cannot charge swappers through the swap itself"
    : "no hook fee: no return-delta bits and no take from the pool";
  ev.add(`Fee logic: ${hookFee}`, src?.verified ? src.via : "eth_getCode");

  // upgradeability
  const px = await proxyInfo(ctx.d.rpc, a, scan);
  const upgradeable = {
    ...px,
    note: px.proxy ? `a ${px.kind} proxy: the code behind it can be replaced${px.admin ? ` by ${short(px.admin)}` : ""}` : scan.delegatecall ? "not a standard proxy, but the code can DELEGATECALL: it can run code from another address with its own storage" : "not a proxy and no DELEGATECALL: the code cannot change",
  };
  ev.add(`Proxy slots (EIP-1967, beacon) ${px.proxy ? "set" : "empty"}; DELEGATECALL ${scan.delegatecall ? "present" : "absent"}; SELFDESTRUCT ${scan.selfdestruct ? "present" : "absent"}`, "eth_getStorageAt");

  // powers, plain words
  const powers: HookReport["powers"] = [];
  const active = owner.kind !== "renounced" && owner.kind !== "none";
  if (!flags.valid) powers.push({ text: flags.problems.join("; "), level: "high" });
  if (missing.length) powers.push({ text: `the address asks the PoolManager to call ${missing.map((m) => m.name).join(", ")}, but the code has no such function: those pool actions would revert`, level: "high" });
  const can = (n: string) => flags.permissions.find((p) => p.name === n)?.set;
  if (can("beforeAddLiquidity")) powers.push({ text: "runs before liquidity is added: it can refuse or restrict who provides liquidity", level: "low" });
  if (can("beforeRemoveLiquidity")) powers.push({ text: "runs before every liquidity withdrawal: read it to be sure LPs can always leave", level: "medium" });
  if (can("afterRemoveLiquidityReturnsDelta")) powers.push({ text: "can take part of what LPs withdraw", level: "medium" });
  const open = views.find((v) => /^(tradingOpen|tradingEnabled|isTradingOpen|launched)$/.test(v.name) && v.type === "bool");
  if (can("beforeSwap")) powers.push({ text: facts.txOrigin ? `runs before every swap and checks tx.origin: swaps can be allowed or refused per wallet${open?.value === true ? ` (here a launch gate, now open: ${open.name} = true)` : ""}` : "runs before every swap: it can refuse swaps", level: facts.txOrigin && open?.value !== true ? "medium" : "low" });
  if (deltaFlags.length && takes) powers.push({ text: `charges a hook fee on swaps (${hookFee.replace(/^takes its own fee: /, "")})`, level: "info" });
  for (const f of adminFunctions.filter((x) => x.gate !== "anyone")) {
    if (f.power === "fees") powers.push({ text: `${f.gate === "unknown" ? "a fee setter exists" : `the ${f.gate} can change fees`} (${f.name})${f.capped ? `, capped by ${f.capped}` : ", no cap found"}`, level: f.capped ? "low" : active ? "high" : "info" });
    else if (f.power === "pause" || f.power === "blacklist" || f.power === "trading") powers.push({ text: `${f.gate === "unknown" ? "the bytecode has" : `the ${f.gate} can call`} ${f.name}: swaps can be stopped or wallets blocked`, level: active ? "high" : "info" });
    else if (f.power === "upgrade" || f.power === "hook-admin") powers.push({ text: `${f.name} can rewire the hook (${f.power})`, level: active ? "medium" : "info" });
    else if (f.power === "withdraw") powers.push({ text: `${f.name}: the ${f.gate} can move tokens out of the hook`, level: "low" });
  }
  if (px.proxy) powers.push({ text: upgradeable.note, level: "high" });
  else if (scan.delegatecall) powers.push({ text: upgradeable.note, level: "medium" });
  if (scan.selfdestruct) powers.push({ text: "the code has SELFDESTRUCT (since Cancun it no longer deletes code, but it can send away ETH)", level: "low" });
  if (owner.kind === "wallet" && adminFunctions.some((f) => f.gate === "owner")) powers.push({ text: `the owner is a single wallet (${short(owner.address!)}), not a multisig`, level: "low" });
  if (owner.kind === "renounced") powers.push({ text: "ownership is renounced: owner-only functions can never run again", level: "info" });
  if (!powers.length) powers.push({ text: "no owner powers, no fee taking and no upgrade path found", level: "info" });
  const risk: HookReport["risk"] = powers.some((p) => p.level === "high") ? "high" : powers.some((p) => p.level === "medium") ? "medium" : "low";

  const called = callbacks.filter((c) => c.calledByPoolManager).map((c) => c.name);
  const summary = `${template ? `${template.name}. ` : ""}The PoolManager calls ${called.length ? called.join(", ") : "no callback"}${deltaFlags.length ? ` (with ${deltaFlags.join(", ")})` : ""}. ${hookFee[0]!.toUpperCase()}${hookFee.slice(1)}. ${owner.kind === "none" ? "No owner." : owner.kind === "renounced" ? "Owner renounced." : `Owner: ${owner.kind} ${short(owner.address!)}.`} ${upgradeable.note[0]!.toUpperCase()}${upgradeable.note.slice(1)}.`;

  const conf = confidence([
    { name: "permission bits", weight: 0.15, done: true },
    { name: "callbacks in code", weight: 0.15, done: scan.selectors.length > 0 },
    { name: "verified source", weight: 0.3, done: Boolean(src?.verified), why: src && !src.verified ? src.note : "lookup failed" },
    { name: "owner", weight: 0.1, done: ownerAddr !== null || !scan.selectors.includes("8da5cb5b") },
    { name: "pools", weight: 0.15, done: pools.length > 0, why: "no pool found (IMD records, or Initialize events after the deploy block)" },
    { name: "upgradeability", weight: 0.15, done: true },
  ]);

  const report: HookReport = {
    service: "hook-inspector", runBy: RUN_BY, chain: "ethereum", chainId: 1, address: a, explain, summary, risk, flags, callbacks, template,
    imd: launch ? { launchNumber: launch.launchNumber, kind: launch.kind, status: launch.status, token: tokenOf(launch)?.address ?? null, url: launchUrl(launch) } : null,
    source: src?.verified ? { verified: true, via: src.via, contract: src.contract, compiler: src.compiler, url: src.url, files: Object.keys(files) } : { verified: false, note: src?.note ?? "source lookup failed" },
    code: { bytes: scan.bytes, functions: scan.selectors.length, delegatecall: scan.delegatecall, selfdestruct: scan.selfdestruct, embeddedAddresses: scan.embedded.slice(0, 12), names: src?.verified ? "source" : "signature-database" },
    owner, upgradeable, pools, fees: { swapFee, hookFee, parameters: views.filter((v) => v.type !== "string").slice(0, 30), recipients }, adminFunctions, powers,
    confidence: conf, evidence: ev.list, generatedAt: new Date(ctx.d.now()).toISOString(), disclaimer: DISCLAIMER,
  };
  if (explain) report.explanation = explainHook(report, fns);
  return report;
}

function feeOf(k: PoolKey): HookReport["pools"][number]["fee"] {
  return (k.fee & DYNAMIC_FEE) !== 0 ? { type: "dynamic", poolFeeBps: null, currentLpFeeBps: null } : { type: "static", poolFeeBps: k.fee / 100, currentLpFeeBps: null };
}

/** The written explanation: every finding above in plain sentences, with the source lines it rests on. Written by rules from the evidence, not by a model. */
export function explainHook(r: HookReport, fns: Fn[]): { text: string; excerpts: { name: string; code: string }[] } {
  const p: string[] = [];
  p.push(`${r.template ? `This is the ${r.template.name} (${r.template.by}). ${r.template.note}` : `This is a Uniswap v4 hook at ${r.address}.`}`);
  const called = r.callbacks.filter((c) => c.calledByPoolManager);
  p.push(called.length
    ? `Its address carries the permission bits ${r.flags.hex}, so the PoolManager calls it on: ${called.map((c) => `${c.name} (${HOOK_FLAGS.find((f) => f.name === c.name)!.what})`).join("; ")}. Bits are fixed at deployment: no other callback can ever run.`
    : `Its address carries no callback bits (${r.flags.hex}): the PoolManager never calls it during swaps or liquidity changes.`);
  p.push(`Fees: the pool's swap fee is ${r.fees.swapFee}. The hook ${r.fees.hookFee}.`);
  const gated = r.adminFunctions.filter((f) => f.gate !== "anyone");
  p.push(gated.length
    ? `Admin functions: ${gated.map((f) => `${f.name} (${f.note}${f.capped ? `, capped by ${f.capped}` : ""})`).join("; ")}. ${r.owner.kind === "renounced" ? "Ownership is renounced, so the owner-only ones can no longer be called." : r.owner.kind === "safe" ? `The owner is a Safe that needs ${r.owner.safe!.threshold} of ${r.owner.safe!.owners} signatures.` : r.owner.kind === "wallet" ? `The owner is one wallet, ${r.owner.address}.` : r.owner.kind === "contract" ? `The owner is a contract, ${r.owner.address}.` : ""}`
    : "No admin functions were found: nobody can change its settings after deployment.");
  p.push(`Upgrades: ${r.upgradeable.note}.`);
  if (r.pools.length) p.push(`Pools: ${r.pools.map((x) => `${x.poolId.slice(0, 10)}… (${x.key.currency0 === "0x0000000000000000000000000000000000000000" ? "ETH" : short(x.key.currency0)} / ${short(x.key.currency1)}, ${x.fee.type === "static" ? `${x.fee.poolFeeBps} bps` : "dynamic fee"}${x.tick !== null ? `, tick ${x.tick}` : ""})`).join("; ")}.`);
  const risky = r.powers.filter((x) => x.level === "high" || x.level === "medium");
  p.push(risky.length ? `What to watch: ${risky.map((x) => x.text).join("; ")}.` : "Nothing found that lets anyone take swappers' or LPs' funds beyond the fees described.");
  if (!r.source.verified) p.push("The source is not verified, so this reading comes from the bytecode alone: function names are guesses from a public signature database and who may call them cannot be seen. Treat it with more caution.");
  const pick = fns.filter((f) => (HOOK_FLAGS.some((h) => h.name === f.name || `_${h.name}` === f.name) && f.body.length > 4) || r.adminFunctions.some((a) => a.name === f.name && a.file === f.file && a.line === f.line));
  return { text: p.join("\n\n"), excerpts: pick.slice(0, 12).map((f) => ({ name: f.name, code: excerpt(f) })) };
}

