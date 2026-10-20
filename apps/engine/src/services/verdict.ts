import type { Address, Hex } from "viem";
import type { PoolKey } from "../v4.js";
import { type Confidence, type Ctx, DISCLAIMER, Proof, RUN_BY, confidence, pct } from "./context.js";
import { type Power, SELECTOR_POWER, lc, powerOfName, proxyInfo, scanCode, short, tokenBasics } from "./evm.js";
import { type Holders, holdersOf } from "./holders.js";
import { type HookReport, KNOWN_HOOKS, decodeFlags, inspectHook, ownerKind } from "./hook.js";
import { IMD_FACTORIES, IMD_TOKEN, type LaunchDetail, type LaunchRow, chainIdOf, hookOf, launchUrl, tokenOf } from "./imd.js";
import type { Pair } from "./market.js";
import { type Fn, factsOf, functionsOf, scopeTo } from "./source.js";
import { NATIVE, type Slot0, keyFromInitialize, poolIdOf, positionAmounts, quote, quoteRoundTrip, routerRoundTrip, slot0 } from "./v4pool.js";

/**
 * TOKEN VERDICT, run by NIGHTSHIFT: before you buy a token on Ethereum, is it safe, worth caution,
 * or one to avoid? Built for IMD launches and Uniswap v4 hook tokens, where nobody else looks.
 * Every reason cites the evidence it rests on; what could not be checked lowers the confidence
 * and is listed, never guessed.
 */
export type Impact = "avoid" | "caution" | "note" | "good";
export type Reason = { id: string; impact: Impact; text: string; evidence: string[] };
export type Depth = "quick" | "deep";

export type VerdictReport = {
  service: "token-verdict"; runBy: string; chain: "ethereum"; chainId: 1; token: Address; depth: Depth;
  verdict: "safe" | "caution" | "avoid"; summary: string; confidence: Confidence; reasons: Reason[];
  asset: { name: string | null; symbol: string | null; decimals: number | null; totalSupply: string | null };
  imd: { isLaunch: false } | { isLaunch: true; launchNumber: number; id: string; kind: string; status: string; createdAt: string; repo: string | null; url: string; role: string; admission?: { name: string; status: string; detail: string }[]; assurances?: number; jobs?: { id: string; state: string }[] };
  source: { verified: boolean; via?: string; contract?: string; url?: string; note?: string };
  powers: { owner: Awaited<ReturnType<typeof ownerKind>>; found: { power: Power; function: string; gate: string; live: boolean; where: string | null }[]; plainErc20: boolean };
  proxy: { proxy: boolean; kind: string | null; implementation: Address | null; admin: Address | null };
  market: { priceUsd: number | null; liquidityUsd: number | null; exitLiquidityUsd: number | null; liquiditySource: "dexscreener" | "onchain" | null; volume24hUsd: number | null; fdvUsd: number | null; txns24h: { buys: number; sells: number } | null; pairs: number; pair: { dex: string; url: string; id: string; quote: string } | null; createdAt: string | null };
  pool: { protocol: "uniswap-v4"; poolId: Hex; key: PoolKey; feeBps: number | null; tick: number | null; lpHeldBy: string | null } | null;
  hook: { address: Address; flags: string; callbacks: string[]; template: string | null; inspection?: Pick<HookReport, "summary" | "risk" | "powers" | "fees" | "owner" | "upgradeable"> } | null;
  holders: (Holders & { scanned: string }) | { error: string };
  simulation: { simulated: true; quote: string; amountIn: string; buy: { ok: boolean; out?: string; taxPct?: number | null; reason?: string }; sell: { ok: boolean; out?: string; taxPct?: number | null; reason?: string }; sellIntoPoolNow: { ok: boolean; out?: string; reason?: string }; router: { ok: boolean; reason?: string }; roundTripLossPct: number | null; poolFeePct: number | null; note: string } | { simulated: false; why: string };
  copycat: { signal: "none" | "note" | "likely"; text: string; sameSymbol: { launchNumber: number; token: string; createdAt: string; liquidityUsd: number | null; name: string | null }[] };
  explanation?: string;
  evidence: Proof["list"]; generatedAt: string; disclaimer: string;
};

const SIM_FROM: Address = "0x7e57000000000000000000000000000000000001";
const LIVE_POWERS: Power[] = ["mint", "pause", "blacklist", "fees", "limits", "trading", "upgrade", "burn-other", "rebase", "roles"];
const FACTORY_ABI_NOTE = "IMD's LaunchFactory and ProjectFactory hold each launch's pool position; their verified ABIs on Sourcify have no function that removes liquidity (only claimFees, withdraw of fees owed and setRequester), checked 2026-10-20";
const n = (v: bigint, dec: number) => Number(v) / 10 ** dec;
const usd = (x: number) => x === 0 ? "$0" : x >= 1e6 ? `$${(x / 1e6).toFixed(2)}M` : x >= 1e3 ? `$${(x / 1e3).toFixed(1)}k` : `$${x.toFixed(x < 1 ? 4 : 0)}`;

export class ServiceError extends Error { constructor(readonly status: number, msg: string) { super(msg); } }
/** A library error's first line, without the node URL viem appends. */
const firstLine = (e: unknown) => String((e as Error)?.message ?? e).split("\n")[0]!.slice(0, 120);

export async function tokenVerdict(ctx: Ctx, chain: string, tokenIn: string, depth: Depth): Promise<VerdictReport> {
  const chainId = chainIdOf(chain);
  if (chainId !== 1) throw new ServiceError(400, "Only Ethereum is supported for now: IMD launches and v4 hook tokens live there (IMD's Base launches are not open yet). Use /api/v1/verdict/ethereum/<token>.");
  if (!/^0x[0-9a-fA-F]{40}$/.test(tokenIn)) throw new ServiceError(400, "The token must be a 0x address (40 hex characters).");
  const token = lc(tokenIn);
  const ev = new Proof();
  const reasons: Reason[] = [];
  const say = (id: string, impact: Impact, text: string, evidence: (string | null)[]) => reasons.push({ id, impact, text, evidence: evidence.filter((e): e is string => Boolean(e)) });

  const code = await ctx.code(token);
  if (code === "0x") throw new ServiceError(404, "No contract at this address on Ethereum.");
  const [basics, hit, src, head, mk] = await Promise.all([
    tokenBasics(ctx.d.rpc, token), ctx.imd.launchOf(1, token).catch(() => null), ctx.source(1, token).catch(() => null), ctx.head(), ctx.market.marketOf(1, token).catch(() => null),
  ]);
  if (basics.totalSupply === null || basics.decimals === null) throw new ServiceError(422, "This contract does not answer totalSupply() and decimals(): it is not an ERC-20 token.");
  const dec = basics.decimals;
  const eBasics = ev.add(`${basics.name ?? "?"} (${basics.symbol ?? "?"}), ${dec} decimals, supply ${n(basics.totalSupply, dec).toLocaleString("en-US")}`, "eth_call");
  const now = ctx.d.now();

  // ---- IMD
  const launch: LaunchRow | null = hit?.launch ?? null;
  const isToken = hit?.artifact.role === "token";
  let detail: LaunchDetail | null = null;
  const eImd = launch ? ev.add(`IMD launch #${launch.launchNumber} (${launch.kind}, ${launch.status}) lists this address as its ${hit!.artifact.role}`, "api.imd.fun", { url: launchUrl(launch) }) : ev.add("No IMD launch on Ethereum lists this address", "api.imd.fun", { url: "https://api.imd.fun/launches" });
  if (launch && isToken) say("imd-launch", "good", `IMD launch #${launch.launchNumber} (${launch.kind}), deployed by IMD's launch wallet from source built and checked by the IMD swarm.`, [eImd]);
  else if (launch) say("imd-artifact", "caution", `This address is IMD launch #${launch.launchNumber}'s ${hit!.artifact.role}, not its token.`, [eImd]);
  if (depth === "deep" && launch) {
    detail = await ctx.imd.detail(launch.id).catch(() => null);
    const checks = detail?.admissionChecks ?? [];
    if (checks.length) {
      const failed = checks.filter((c) => c.status !== "passed");
      const e = ev.add(`IMD admission checks: ${checks.map((c) => `${c.name} ${c.status}`).join(", ")}`, "api.imd.fun", { url: launchUrl(launch) });
      say("imd-admission", failed.length ? "caution" : "good", failed.length ? `IMD admission checks not passed: ${failed.map((c) => c.name).join(", ")}.` : `All ${checks.length} IMD admission checks passed (provenance, findings, independent review, reproducible bytecode…).`, [e]);
    }
    if (detail?.assurances?.length) say("imd-assurances", "good", `${detail.assurances.filter((x) => !x.revokedAt).length} outside audit or bounty on record at IMD.`, [ev.add("Assurances on record", "api.imd.fun", { url: `${launchUrl(launch)}/assurances` })]);
  }

  // ---- source and powers
  const scan = scanCode(code);
  const px = await proxyInfo(ctx.d.rpc, token, scan);
  const eProxy = ev.add(px.proxy ? `Proxy (${px.kind}) to ${px.implementation}${px.admin ? `, admin ${px.admin}` : ""}` : "EIP-1967 implementation, admin and beacon slots are empty; not a minimal proxy", "eth_getStorageAt");
  const implSrc = px.proxy && px.implementation ? await ctx.source(1, px.implementation).catch(() => null) : null;
  const eSrc = src?.verified ? ev.add(`Verified source: ${src.contract}, ${Object.keys(src.files).length} project file(s)`, src.via, { url: src.url }) : ev.add(src ? src.note : "Source lookup failed", "sourcify");
  const files = { ...(src?.verified ? scopeTo(src.files, src.contract) : {}), ...(implSrc?.verified ? scopeTo(implSrc.files, implSrc.contract) : {}) };
  const verified = Boolean(src?.verified) && (!px.proxy || Boolean(implSrc?.verified));
  const fns: Fn[] = functionsOf(files);
  const facts = factsOf(files, fns);
  const owner = await ownerKind(ctx, basics.owner);
  const eOwner = basics.owner ? ev.add(`owner() = ${basics.owner} (${owner.kind})`, "eth_call") : ev.add("No owner() or getOwner() on the token", "eth_call");
  const live = owner.kind !== "renounced";
  const found: VerdictReport["powers"]["found"] = [];
  if (verified) {
    for (const f of fns) {
      if (f.visibility !== "external" && f.visibility !== "public") continue;
      const mints = /\b_mint\s*\(/.test(f.body) && f.name !== "constructor";
      const power: Power | null = f.power ?? (mints ? "mint" : null);
      if (!power || !LIVE_POWERS.includes(power)) continue;
      if (f.gate === "pool-manager" || f.gate === "self" || f.gate === "factory") continue;
      found.push({ power, function: `${f.name}(${f.params})`, gate: f.gate, live: f.gate === "anyone" || live, where: `${f.file}:${f.line}` });
    }
    // public functions inherited from libraries (OpenZeppelin AccessControl, Pausable…) are in the ABI, not in the project's files
    for (const f of [...(src?.verified ? src.abi : []), ...(implSrc?.verified ? implSrc.abi : [])]) {
      if (f.type !== "function" || !f.name || f.stateMutability === "view" || f.stateMutability === "pure") continue;
      const power = powerOfName(f.name);
      if (!power || !LIVE_POWERS.includes(power) || found.some((x) => x.function.startsWith(`${f.name}(`))) continue;
      found.push({ power, function: `${f.name}(${(f.inputs ?? []).map((i) => i.type).join(",")})`, gate: power === "roles" ? "role" : "unknown", live, where: "inherited library code (ABI)" });
    }
  } else {
    for (const s of scan.selectors) {
      const k = SELECTOR_POWER.get(s);
      if (k && LIVE_POWERS.includes(k.power)) found.push({ power: k.power, function: k.sig, gate: "unknown", live, where: null });
    }
  }
  const plainErc20 = found.length === 0 && !px.proxy;
  if (src?.verified) say("verified", "good", `Source verified on ${src.via === "etherscan" ? "Etherscan" : "Sourcify"} (${src.contract}).`, [eSrc]);
  else say("unverified", "caution", `Source not verified (${src?.verified === false ? src.checked.join(" and ") : "lookup failed"}): powers below are read from the bytecode alone, so who may call them cannot be seen.`, [eSrc]);
  const eFns = ev.add(verified ? `${fns.length} function(s) declared in the deployed contract's own source, plus every state-changing function in its ABI (library code such as OpenZeppelin included)` : `${scan.selectors.length} functions in the bytecode dispatcher`, verified ? (src as { via: string }).via : "eth_getCode");
  if (plainErc20) say("plain", "good", verified ? "No mint, pause, blacklist, fee or upgrade function anyone controls: a plain ERC-20." : "No mint, pause, blacklist, fee or upgrade selector in the bytecode.", [eBasics, eFns, eOwner]);
  for (const f of found) {
    const who = f.gate === "anyone" ? "anyone" : f.gate === "unknown" ? "someone (not visible without source)" : `the ${f.gate}`;
    const what: Record<string, string> = { mint: "can create new tokens", pause: "can stop transfers", blacklist: "can block wallets from selling", fees: "can change a transfer fee", limits: "can change wallet or trade limits", trading: "can open or close trading", upgrade: "can replace the token's code", "burn-other": "can burn tokens from other wallets", rebase: "can change every balance", roles: "can hand out roles" };
    if (!f.live) { say(`power-${f.power}-${f.function}`, "note", `${f.function} ${what[f.power] ?? "has a power"}, but the owner renounced: it can no longer run.`, [eFns, eOwner]); continue; }
    const severe = f.power === "mint" || f.power === "blacklist" || f.power === "upgrade" || f.power === "burn-other" || f.power === "rebase";
    const impact: Impact = f.gate === "anyone" && f.power === "mint" ? "avoid" : severe && (owner.kind === "wallet" || f.gate === "anyone") ? "avoid" : "caution";
    say(`power-${f.power}-${f.function}`, impact, `${who === "anyone" ? "Anyone" : who[0]!.toUpperCase() + who.slice(1)} ${what[f.power] ?? "has a power"}: ${f.function}${f.where ? ` (${f.where})` : ""}${owner.kind === "safe" ? `; the owner is a Safe (${owner.safe!.threshold} of ${owner.safe!.owners})` : owner.kind === "wallet" ? `; the owner is one wallet, ${short(owner.address!)}` : ""}.`, [eFns, eOwner]);
  }
  if (px.proxy) say("proxy", "caution", `Upgradeable proxy (${px.kind}): the code behind it can be replaced${px.admin ? ` by ${short(px.admin)}` : ""}${implSrc?.verified ? "" : ", and the implementation's source is not verified"}.`, [eProxy]);
  if (facts.txOrigin && verified) say("tx-origin", "note", "The token's code checks tx.origin (sometimes an anti-bot rule): wallets can be treated differently.", [eSrc]);

  // ---- pool, market and hook
  const pairs = mk?.pairs ?? [];
  let key: PoolKey | null = null, keyFrom = "";
  const seeded = launch?.seeded?.pools?.find((p) => p.currency0.toLowerCase() === token || p.currency1.toLowerCase() === token);
  if (seeded) { key = { currency0: lc(seeded.currency0), currency1: lc(seeded.currency1), fee: seeded.fee, tickSpacing: seeded.tickSpacing, hooks: lc(seeded.hooks) }; keyFrom = "api.imd.fun seeded pool"; }
  const v4pair = pairs.find((p) => p.labels?.includes("v4") && (!key || p.pairAddress.toLowerCase() === poolIdOf(key).toLowerCase())) ?? null;
  if (!key && v4pair && /^0x[0-9a-f]{64}$/i.test(v4pair.pairAddress)) {
    const near = v4pair.pairCreatedAt ? head - BigInt(Math.max(0, Math.floor((now - v4pair.pairCreatedAt) / 12_000))) : head;
    const k = await keyFromInitialize(ctx.d.rpc, v4pair.pairAddress as Hex, near, head).catch(() => null);
    if (k) { key = k.key; keyFrom = `PoolManager Initialize event, block ${k.block}`; }
  }
  const poolId = key ? poolIdOf(key) : null;
  const s0: Slot0 | null = poolId ? await slot0(ctx.d.rpc, poolId).catch(() => null) : null;
  const ePool = key ? ev.add(`Uniswap v4 pool ${poolId}: key from ${keyFrom}; ${s0 ? `tick ${s0.tick}, LP fee ${s0.lpFee / 100} bps` : "state not readable"}`, "eth_getStorageAt") : null;
  const pair: Pair | null = (poolId ? pairs.find((p) => p.pairAddress.toLowerCase() === poolId.toLowerCase()) : null) ?? pairs[0] ?? null;
  const ePair = pair ? ev.add(`DexScreener: ${pairs.length} pair(s); deepest ${pair.dexId} ${pair.labels?.join("/") ?? ""} liquidity ${usd(pair.liquidity?.usd ?? 0)}, 24h volume ${usd(pair.volume?.h24 ?? 0)}`, "dexscreener", { url: pair.url }) : ev.add("DexScreener lists no pair for this token", "dexscreener", { url: `https://api.dexscreener.com/tokens/v1/ethereum/${token}` });
  const qCur = key ? (key.currency0 === token ? key.currency1 : key.currency0) : null;
  const qUsd = qCur ? await ctx.market.usdOf(1, qCur).catch(() => null) : null;
  let liquidityUsd: number | null = pair?.liquidity?.usd ?? null;
  // what sellers can take out: the quote side of the pool, in dollars (DexScreener's quote reserve at the quote's price)
  let exitUsd: number | null = pair?.liquidity?.quote !== undefined && pair.priceUsd && pair.priceNative && pair.baseToken.address.toLowerCase() === token
    ? Math.round(pair.liquidity.quote * (Number(pair.priceUsd) / Number(pair.priceNative))) : liquidityUsd !== null ? Math.round(liquidityUsd / 2) : null;
  let liquiditySource: VerdictReport["market"]["liquiditySource"] = liquidityUsd !== null ? "dexscreener" : null;
  const position = launch?.seeded?.positions?.[0];
  if (liquidityUsd === null && s0 && key && position && qUsd !== null) {
    // one IMD-seeded position: the pool's reserves are that position's amounts at the current price
    const amt = positionAmounts(s0, position.tickLower, position.tickUpper);
    const tokenIs0 = key.currency0 === token;
    const qAmt = (tokenIs0 ? amt.amount1 : amt.amount0) / 1e18;
    const tRaw = tokenIs0 ? amt.amount0 : amt.amount1;
    const p = Number(s0.sqrtPriceX96) / 2 ** 96; const P = p * p; // currency1 per currency0, raw
    const tInQ = (tokenIs0 ? tRaw * P : tRaw / P) / 1e18;
    // no active liquidity: the price left the seeded range, and the pool holds only tokens (its total is then unknown here)
    liquidityUsd = s0.liquidity === 0n ? null : Math.round((qAmt + tInQ) * qUsd);
    exitUsd = s0.liquidity === 0n ? 0 : Math.round(qAmt * qUsd);
    liquiditySource = "onchain";
  }
  const eLiq = liquiditySource === "onchain" ? ev.add(`On-chain liquidity: the IMD-seeded position's amounts at the current price, valued at ${qCur === NATIVE ? "ETH" : "IMD"} $${qUsd}`, "eth_getStorageAt") : ePair;
  const exitText = (x: number) => `${usd(x)} can be taken out by sellers (the pool's ${qCur === NATIVE || pair?.quoteToken.symbol === "ETH" || pair?.quoteToken.symbol === "WETH" ? "ETH" : pair?.quoteToken.symbol ?? "quote"} side${liquidityUsd !== null ? `; ${usd(liquidityUsd)} in all` : ""})`;
  if (exitUsd === 0 && liquiditySource === "onchain") say("liquidity", "caution", `The pool holds no ${qCur === NATIVE ? "ETH" : "IMD"} right now: nobody has bought yet, or every buyer has sold. Only what buyers put in can come out.`, [eLiq]);
  else if (exitUsd === null) say("no-liquidity", key ? "caution" : "avoid", key ? "No liquidity figure: DexScreener does not index this pool and it could not be valued on chain." : "No pool found: DexScreener lists no pair and no IMD launch pool is known. You may not be able to sell.", [ePair]);
  else if (exitUsd < 500) say("liquidity", "avoid", `Only ${exitText(exitUsd)}: even a small sell moves the price a lot.`, [eLiq]);
  else if (exitUsd < 5_000) say("liquidity", "caution", `Thin: ${exitText(exitUsd)}.`, [eLiq]);
  else if (exitUsd < 25_000) say("liquidity", "note", `${exitText(exitUsd)[0]!.toUpperCase()}${exitText(exitUsd).slice(1)}: thin, so large sells move the price.`, [eLiq]);
  else say("liquidity", "good", `${exitText(exitUsd)[0]!.toUpperCase()}${exitText(exitUsd).slice(1)}.`, [eLiq]);
  if (key && launch && isToken && position && IMD_FACTORIES[position.factory.toLowerCase()]) say("lp-held", "good", `The pool's liquidity is a position held by ${IMD_FACTORIES[position.factory.toLowerCase()]} (${short(position.factory)}), which has no function to remove it.`, [ev.add(FACTORY_ABI_NOTE, "sourcify", { url: `https://sourcify.dev/server/v2/contract/1/${position.factory}?fields=abi` }), ePool]);

  let hook: VerdictReport["hook"] = null;
  if (key && key.hooks !== NATIVE) {
    const fl = decodeFlags(key.hooks);
    const known = KNOWN_HOOKS[key.hooks];
    const imdHook = launch && hookOf(launch)?.address.toLowerCase() === key.hooks ? hookOf(launch)!.name : null;
    hook = { address: key.hooks, flags: fl.hex, callbacks: fl.permissions.filter((p) => p.set).map((p) => p.name), template: known?.template ?? (imdHook ? `${imdHook} (IMD launch #${launch!.launchNumber})` : null) };
    const eHook = ev.add(`Hook ${key.hooks}: permission bits ${fl.hex} (${hook.callbacks.join(", ") || "none"})`, "address");
    if (!fl.valid) say("hook-invalid", "avoid", `The pool's hook address is not a valid v4 hook: ${fl.problems.join("; ")}.`, [eHook]);
    if (depth === "deep") {
      const h = await inspectHook(ctx, key.hooks, false).catch(() => null);
      if (h) {
        hook.inspection = { summary: h.summary, risk: h.risk, powers: h.powers, fees: h.fees, owner: h.owner, upgradeable: h.upgradeable };
        const eH = ev.add(`Hook inspection: ${h.summary}`, "hook-inspector", { url: `/api/v1/hook/${key.hooks}` });
        const high = h.powers.filter((p) => p.level === "high"), mid = h.powers.filter((p) => p.level === "medium");
        if (high.length) say("hook-powers", "caution", `Hook: ${high.map((p) => p.text).join("; ")}.`, [eH]);
        if (mid.length) say("hook-watch", "note", `Hook: ${mid.map((p) => p.text).join("; ")}.`, [eH]);
        if (!high.length && !mid.length) say("hook-ok", "good", `Hook: ${h.powers.map((p) => p.text).join("; ")}.`, [eH]);
      }
    } else if (hook.callbacks.some((c) => /Swap/.test(c))) say("hook-swaps", "note", `The pool's hook (${hook.template ?? short(key.hooks)}) runs on swaps (${hook.callbacks.filter((c) => /Swap/.test(c)).join(", ")}); the simulation below shows what it charges. Deep verdicts inspect it in full.`, [eHook]);
    else say("hook-quiet", "good", `The pool's hook (${hook.template ?? short(key.hooks)}) never runs on swaps or liquidity (${hook.callbacks.join(", ") || "no callbacks"}).`, [eHook]);
  }

  // ---- holders
  let holders: VerdictReport["holders"];
  const labels: Record<string, string> = { [token]: "the token contract itself" };
  for (const a of launch?.artifacts ?? []) if (a.address.toLowerCase() !== token) labels[a.address.toLowerCase()] = `IMD launch ${a.role} (${a.name})`;
  if (key && key.hooks !== NATIVE) labels[key.hooks] = labels[key.hooks] ?? "the pool's hook";
  const deployBlock = (hit?.artifact.blockNumber ?? (src?.verified ? src.deployBlock : null)) ?? null;
  try {
    const h = await holdersOf(ctx.d.rpc, { token, supply: basics.totalSupply, deployBlock, head, maxChunks: depth === "deep" ? 40 : 12, labels });
    // name the contracts among the largest holders (staking, vaults, lockers) from their verified source
    await Promise.all(h.top.filter((x) => x.kind === "contract" && !x.label).slice(0, 5).map(async (x) => { const s = await ctx.source(1, x.address).catch(() => null); if (s?.verified && s.contract) x.label = `${s.contract} (verified contract)`; }));
    const eH = ev.add(`Transfer events from block ${h.fromBlock} to ${h.toBlock} (${h.transfers} transfers${h.complete ? ", from deployment: exact" : ", recent window only: partial"})`, "eth_getLogs");
    holders = { ...h, scanned: h.complete ? "complete since deployment" : "recent blocks only; balances read on chain for every address seen" };
    const w = h.largestWallet;
    const who = (x: NonNullable<typeof w>) => `${x.label ? `${x.label}, ` : x.kind === "contract" ? "a contract, " : x.kind === "wallet" ? "a wallet, " : ""}${short(x.address)}`;
    if (w && w.pct > 50) say("holder-whale", "avoid", `One holder has ${pct(w.pct)}% of the supply (${who(w)}).`, [eH]);
    else if (w && w.pct > 20) say("holder-big", "caution", `One holder has ${pct(w.pct)}% of the supply (${who(w)}).`, [eH]);
    else if (h.top10PctExInfra > 70) say("holders-top10", "caution", `The ten largest holders (pools, burns and IMD's launch contracts left out) hold ${h.top10PctExInfra}%.`, [eH]);
    else say("holders", w && w.pct > 10 ? "note" : "good", `${h.count.toLocaleString("en-US")} holders${h.complete ? "" : " seen"}. Leaving out the pool, burns and IMD's launch contracts, the largest holder has ${w ? `${pct(w.pct)}% (${who(w)})` : "nothing notable"} and the top ten ${h.top10PctExInfra}%.`, [eH]);
  } catch (e) { holders = { error: `Holder scan failed: ${firstLine(e)}` }; }

  // ---- sell simulation (Uniswap v4 only)
  let simulation: VerdictReport["simulation"];
  if (!key || !s0 || !qCur) simulation = { simulated: false, why: key ? "the pool's state could not be read" : pair ? `the deepest pool is ${pair.dexId} ${pair.labels?.join("/") ?? ""}, and this service simulates Uniswap v4 pools only` : "no pool found" };
  else {
    const qDec = 18;
    const qSym = qCur === NATIVE ? "ETH" : qCur === IMD_TOKEN ? "IMD" : short(qCur);
    // about $10, smaller in thin pools so price impact stays near zero and the tax shows clearly
    const targetUsd = Math.max(0.1, Math.min(10, (exitUsd ?? 20_000) * 0.0005));
    const amountIn = BigInt(Math.round((qUsd ? targetUsd / qUsd : qCur === NATIVE ? 0.003 : 2) * 1e6)) * 10n ** 12n;
    const buyZ = key.currency0 === qCur;
    const fee = s0.lpFee / 1_000_000;
    const p = Number(s0.sqrtPriceX96) / 2 ** 96; const P = p * p; // raw currency1 per raw currency0
    const tokPerQ = buyZ ? P : 1 / P;
    const buy = await quote(ctx.d.rpc, key, buyZ, amountIn, SIM_FROM);
    // the sell, as the buy left the pool: a two-hop round trip quote, and the same through the router with real transfers
    const trip = await quoteRoundTrip(ctx.d.rpc, key, qCur, amountIn, SIM_FROM);
    const router = await routerRoundTrip(ctx.d.rpc, key, qCur, amountIn, SIM_FROM, now);
    const tokens = buy.ok && buy.out > 0n ? buy.out : basics.totalSupply / 1_000_000n;
    // and a sell into the pool as it is right now (fails when the pool holds none of the quote currency)
    const now0 = await quote(ctx.d.rpc, key, !buyZ, tokens, SIM_FROM);
    const tax = (got: bigint, expected: number) => expected > 0 ? pct(Math.max(0, (1 - Number(got) / expected) * 100), 2) : null;
    const buyTax = buy.ok ? tax(buy.out, Number(amountIn) * tokPerQ * (1 - fee)) : null;
    // what the sell cost beyond the pool fee: the round trip against what two pool fees and the buy's own cost leave
    const sellTax = buy.ok && trip.ok ? tax(trip.out, Number(amountIn) * (1 - fee) ** 2 * (1 - (buyTax ?? 0) / 100)) : null;
    const rt = trip.ok ? pct((1 - Number(trip.out) / Number(amountIn)) * 100, 2) : null;
    const eSim = ev.add(`eth_call: V4 Quoter buy ${n(amountIn, qDec)} ${qSym} → ${buy.ok ? `${n(buy.out, dec).toLocaleString("en-US")} tokens` : `reverted (${buy.reason})`}; buy-then-sell round trip → ${trip.ok ? `${n(trip.out, qDec)} ${qSym}` : `reverted (${trip.reason})`}; the same round trip through the Universal Router with real token transfers ${router.ok ? "went through" : `failed (${router.reason})`}`, "eth_call", { block: Number(head) });
    simulation = {
      simulated: true, quote: qSym, amountIn: `${n(amountIn, qDec)} ${qSym}`,
      buy: buy.ok ? { ok: true, out: `${n(buy.out, dec)}`, taxPct: buyTax } : { ok: false, reason: buy.reason },
      sell: trip.ok ? { ok: true, out: `${n(trip.out, qDec)} ${qSym}`, taxPct: sellTax } : { ok: false, reason: trip.reason },
      sellIntoPoolNow: now0.ok ? { ok: true, out: `${n(now0.out, qDec)} ${qSym}` } : { ok: false, reason: now0.reason },
      router: router.ok ? { ok: true } : { ok: false, reason: router.reason },
      roundTripLossPct: rt, poolFeePct: pct(fee * 100, 3),
      note: `A ~$${pct(targetUsd, 2)} buy and the sell of what it bought, back to back: quoted by the V4 Quoter (it runs the hook), then sent through the Universal Router with eth_call so the token's transfer code runs both ways. Tax = what is lost beyond the pool's ${pct(fee * 100, 3)}% fee. Nothing was signed or sent.`,
    };
    if (!buy.ok) say("buy-blocked", "caution", `Buying does not go through right now (${buy.reason}): trading may not be open, or the pool refuses this kind of wallet.`, [eSim]);
    else if (!trip.ok || (!router.ok && router.stage === "swap")) say("sell-blocked", "avoid", `Buying works but selling it back fails: ${!trip.ok ? trip.reason : router.ok ? "" : router.reason}. This is what a honeypot looks like.`, [eSim]);
    else if (sellTax !== null && sellTax > 25) say("sell-tax", "avoid", `Selling costs ${sellTax}% beyond the pool fee.`, [eSim]);
    else if (sellTax !== null && sellTax > 10) say("sell-tax", "caution", `Selling costs ${sellTax}% beyond the pool fee.`, [eSim]);
    else if (sellTax !== null && sellTax > 0.5) {
      const raisable = found.some((f) => f.power === "fees" && f.live) || (hook?.inspection?.powers ?? []).some((x) => /change fees/.test(x.text) && /no cap/.test(x.text));
      say("sell-tax", raisable ? "caution" : "note", `Selling costs ${sellTax}% beyond the ${pct(fee * 100, 3)}% pool fee${hook ? " (taken by the hook)" : ""}${raisable ? ", and the fee can be raised" : ""}. Buying ${buyTax !== null && buyTax > 0.5 ? `costs ${buyTax}%` : "has no extra cost"}.`, [eSim]);
    } else say("sell-ok", "good", `A ~$${pct(targetUsd, 2)} buy and its sell both go through, through the Quoter and the Universal Router, with no cost beyond the ${pct(fee * 100, 3)}% pool fee.`, [eSim]);
    if (!router.ok && router.stage === "setup") say("router-setup", "note", `The router simulation could not run: ${router.reason}.`, [eSim]);
  }

  // ---- copycat
  let copycat: VerdictReport["copycat"] = { signal: "none", text: "No other IMD launch uses this symbol.", sameSymbol: [] };
  if (basics.symbol) {
    const same = await ctx.imd.sameSymbol(1, basics.symbol).catch(() => [] as LaunchRow[]);
    const others = same.filter((l) => tokenOf(l)?.address.toLowerCase() !== token);
    if (others.length) {
      const liq = await ctx.market.pairsOf(1, others.map((l) => tokenOf(l)!.address)).catch(() => new Map<string, Pair[]>());
      const rows = others.map((l) => {
        const t = tokenOf(l)!.address.toLowerCase();
        const best = (liq.get(t) ?? []).reduce((m, x) => Math.max(m, x.liquidity?.usd ?? 0), 0);
        return { launchNumber: l.launchNumber, token: t, createdAt: l.createdAt, liquidityUsd: best || null, name: tokenOf(l)!.name ?? null };
      });
      const eCopy = ev.add(`${rows.length} other IMD launch(es) with symbol ${basics.symbol}: ${rows.map((r) => `#${r.launchNumber}`).join(", ")} (symbols read on chain for every Ethereum launch token)`, "api.imd.fun + eth_call");
      const mine = liquidityUsd ?? 0;
      const older = launch ? rows.filter((r) => r.launchNumber < launch.launchNumber) : rows;
      const deeper = rows.filter((r) => (r.liquidityUsd ?? 0) > mine);
      if (!launch) copycat = { signal: "likely", text: `Not an IMD launch, but uses the symbol ${basics.symbol} of IMD launch${rows.length > 1 ? "es" : ""} ${rows.map((r) => `#${r.launchNumber}`).join(", ")}. Check you have the right address.`, sameSymbol: rows };
      else if (older.length && deeper.length) copycat = { signal: "likely", text: `Likely a copycat: IMD launch #${older[0]!.launchNumber} came first with the symbol ${basics.symbol}${deeper[0] ? `, and #${deeper[0].launchNumber} has more liquidity (${usd(deeper[0].liquidityUsd ?? 0)})` : ""}.`, sameSymbol: rows };
      else if (older.length) copycat = { signal: "note", text: `Shares the symbol ${basics.symbol} with older IMD launch${older.length > 1 ? "es" : ""} ${older.map((r) => `#${r.launchNumber}`).join(", ")}, but this one has the deepest liquidity of them${rows.length > older.length ? `; later copies: ${rows.filter((r) => r.launchNumber > launch.launchNumber).map((r) => `#${r.launchNumber}`).join(", ")}` : ""}.`, sameSymbol: rows };
      else copycat = { signal: "note", text: `The first IMD launch with the symbol ${basics.symbol}; ${rows.length} later launch${rows.length > 1 ? "es copy" : " copies"} it (${rows.map((r) => `#${r.launchNumber}`).join(", ")}). Check you have this address.`, sameSymbol: rows };
      say("copycat", copycat.signal === "likely" ? "caution" : "note", copycat.text, [eCopy, eImd]);
    }
  }

  // ---- age
  const created = launch?.createdAt ?? (pair?.pairCreatedAt ? new Date(pair.pairCreatedAt).toISOString() : null);
  if (created && now - Date.parse(created) < 24 * 3_600_000) say("new", "note", `Launched ${Math.max(1, Math.round((now - Date.parse(created)) / 3_600_000))} h ago: new tokens move fast and have little history.`, [eImd]);

  // ---- the verdict
  const conf = confidence([
    { name: "token contract", weight: 0.05, done: true },
    { name: "verified source", weight: 0.2, done: verified, why: src?.verified === false ? src.note : px.proxy && !implSrc?.verified ? "implementation not verified" : undefined },
    { name: "owner powers", weight: 0.15, done: verified || scan.selectors.length > 0 },
    { name: "liquidity", weight: 0.15, done: exitUsd !== null, why: "no liquidity figure" },
    { name: "holders", weight: 0.15, done: !("error" in holders) && holders.complete, why: "error" in holders ? holders.error : "partial scan (old token): dormant holders may be missing" },
    { name: "sell simulation", weight: 0.2, done: simulation.simulated, why: simulation.simulated ? undefined : simulation.why },
    { name: "IMD match and copycat", weight: 0.1, done: true },
  ]);
  let verdict: VerdictReport["verdict"] = reasons.some((r) => r.impact === "avoid") ? "avoid" : reasons.some((r) => r.impact === "caution") ? "caution" : "safe";
  if (verdict === "safe" && conf.level === "low") { verdict = "caution"; say("low-confidence", "caution", "Too little could be checked to call it safe.", []); }
  const order: Impact[] = ["avoid", "caution", "note", "good"];
  reasons.sort((a, b) => order.indexOf(a.impact) - order.indexOf(b.impact));
  const head2 = reasons.filter((r) => r.impact === verdict || (verdict === "safe" && r.impact === "good")).slice(0, 2).map((r) => r.text.replace(/\.$/, ""));
  const name = basics.symbol ? `$${basics.symbol}${launch && isToken ? ` (IMD #${launch.launchNumber})` : ""}` : short(token);
  const summary = `${name}: ${verdict.toUpperCase()}. ${head2.join(". ")}.`;

  const report: VerdictReport = {
    service: "token-verdict", runBy: RUN_BY, chain: "ethereum", chainId: 1, token, depth, verdict, summary, confidence: conf, reasons,
    asset: { name: basics.name, symbol: basics.symbol, decimals: dec, totalSupply: basics.totalSupply.toString() },
    imd: launch ? { isLaunch: true, launchNumber: launch.launchNumber, id: launch.id, kind: launch.kind, status: launch.status, createdAt: launch.createdAt, repo: launch.sourceRepoUrl, url: launchUrl(launch), role: hit!.artifact.role,
      ...(detail ? { admission: (detail.admissionChecks ?? []).map((c) => ({ name: c.name, status: c.status, detail: c.detail })), assurances: (detail.assurances ?? []).length, jobs: (detail.jobs ?? []).map((j) => ({ id: j.id, state: j.state })) } : {}) } : { isLaunch: false },
    source: src?.verified ? { verified: true, via: src.via, contract: src.contract, url: src.url } : { verified: false, note: src?.verified === false ? src.note : "lookup failed" },
    powers: { owner, found, plainErc20 },
    proxy: { proxy: px.proxy, kind: px.kind, implementation: px.implementation, admin: px.admin },
    market: {
      priceUsd: pair?.priceUsd ? Number(pair.priceUsd) : null, liquidityUsd, exitLiquidityUsd: exitUsd, liquiditySource, volume24hUsd: pair?.volume?.h24 ?? null, fdvUsd: pair?.fdv ?? null,
      txns24h: pair?.txns?.h24 ?? null, pairs: pairs.length, pair: pair ? { dex: `${pair.dexId}${pair.labels?.length ? ` ${pair.labels.join("/")}` : ""}`, url: pair.url, id: pair.pairAddress, quote: pair.quoteToken.symbol } : null,
      createdAt: pair?.pairCreatedAt ? new Date(pair.pairCreatedAt).toISOString() : null,
    },
    pool: key && poolId ? { protocol: "uniswap-v4", poolId, key, feeBps: s0 ? s0.lpFee / 100 : (key.fee & 0x800000 ? null : key.fee / 100), tick: s0?.tick ?? null, lpHeldBy: position ? IMD_FACTORIES[position.factory.toLowerCase()] ?? position.factory : null } : null,
    hook, holders, simulation, copycat,
    evidence: ev.list, generatedAt: new Date(now).toISOString(), disclaimer: DISCLAIMER,
  };
  if (depth === "deep") report.explanation = explainVerdict(report);
  return report;
}

/** The deep verdict's written explanation: the findings as a short memo, worst first. Written by rules from the evidence, not by a model. */
export function explainVerdict(r: VerdictReport): string {
  const sym = r.asset.symbol ? `$${r.asset.symbol}` : r.token;
  const by = (i: Impact) => r.reasons.filter((x) => x.impact === i).map((x) => x.text);
  const out: string[] = [];
  out.push(`${sym} (${r.token}) on Ethereum: ${r.verdict.toUpperCase()}, with ${r.confidence.level} confidence (${Math.round(r.confidence.score * 100)}% of the checks ran).`);
  if (r.imd.isLaunch) out.push(`It is IMD launch #${r.imd.launchNumber}, a ${r.imd.kind} launch${r.imd.repo ? ` whose source is public at ${r.imd.repo}` : ""}. IMD's launch wallet deployed it from the code its swarm built and checked.`);
  else out.push("It is not an IMD launch: no IMD launch on Ethereum lists this address.");
  const bad = [...by("avoid"), ...by("caution")];
  if (bad.length) out.push(`What counts against it:\n- ${bad.join("\n- ")}`);
  const notes = by("note");
  if (notes.length) out.push(`Worth knowing:\n- ${notes.join("\n- ")}`);
  const good = by("good");
  if (good.length) out.push(`What checks out:\n- ${good.join("\n- ")}`);
  if (r.simulation.simulated) out.push(`The simulation bought with ${r.simulation.amountIn} and sold it back: ${r.simulation.roundTripLossPct !== null ? `a round trip loses ${r.simulation.roundTripLossPct}%, including the pool fee of ${r.simulation.poolFeePct}% each way` : "the round trip could not be completed"}.`);
  if (r.hook?.inspection) out.push(`The pool's hook: ${r.hook.inspection.summary}`);
  if (r.confidence.unknowns.length) out.push(`Not checked: ${r.confidence.unknowns.join("; ")}.`);
  out.push("This memo is written by NIGHTSHIFT's rules from the evidence listed with it. It is not financial advice and not an audit.");
  return out.join("\n\n");
}
