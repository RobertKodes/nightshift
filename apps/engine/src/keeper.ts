import { randomInt } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { type Address, type Hex, type LocalAccount, createWalletClient, decodeEventLog, erc20Abi, formatEther, http, parseAbi } from "viem";
import { mainnet } from "viem/chains";
import { writeAtomic } from "./atomic.js";
import { eth, ethWallet } from "./chain.js";
import { config } from "./config.js";
import { V4, quoteArgs, quoterAbi } from "./v4.js";
import { IMD_TOKEN } from "./token.js";
import type { Vault } from "./vault.js";

/**
 * The keeper: a server wallet that runs the fee splitter once a day. `distribute(token)` is open to
 * anyone; `burnReserve` is keeper-only and swaps the splitter's ETH burn reserve for IMD, which the
 * splitter sends straight to IMD's BurnExecutor. The dev wallet names this address as keeper once.
 * It only ever pays gas: the funds move inside the splitter, to the addresses fixed in its code.
 */
const SPLITTER = parseAbi([
  "function distribute(address token)",
  "function burnReserve(address token, uint256 amountIn, uint256 minImdOut)",
  "function reserve(address token) view returns (uint256)",
]);
export const KEEPER_SETTER = parseAbi(["function setKeeper(address keeper)"]);
const SPLITTER_ROUTE = parseAbi([
  "function keeper() view returns (address)",
  "function imdPoolSet() view returns (bool)",
  "function setImdPool((address currency0, address currency1, uint24 fee, int24 tickSpacing, address hooks) key)",
]);
const HOOK = parseAbi(["function pendingEthClaims() view returns (uint256)", "function redeemFeeClaims()"]);
/** IMD's LaunchFactory: the 1% pool fee is owed to the launch payer; anyone may collect and pay it out. */
const FACTORY: Address = "0x12c63b581d07093f6126bc02263c58f7eadaa96f";
const FACTORY_ABI = parseAbi(["function claimFees(uint64 launchNumber)", "function withdraw(address account, address currency)", "function owed(address account, address currency) view returns (uint256)"]);
/** The deepest unhooked ETH/IMD v4 pool (≈$2M), where the burn reserve buys IMD. */
const IMD_POOL = { currency0: "0x0000000000000000000000000000000000000000", currency1: "0xd34a99bc0f67ae1bbd63c660e6d0b0dd03e263b7", fee: 10000, tickSpacing: 200, hooks: "0x0000000000000000000000000000000000000000" } as const;
const ETH: Address = "0x0000000000000000000000000000000000000000";
/** Without a gas price from the node: the old fixed floors (a run would spend more gas than it moves below these). */
const DUST = { eth: 5n * 10n ** 15n, token: 1_000n * 10n ** 18n, imd: 10n ** 17n, burn: 10n ** 16n };
const erc20 = parseAbi(["function balanceOf(address) view returns (uint256)"]);

/**
 * The keeper pays its own gas and nothing refills it (the splitter's split is fixed forever), so each
 * write must be worth it: what it moves is worth at least WORTH times its gas at today's gas price.
 * distribute(token) is open to anyone and the IMD launch fee waits at the factory, so a skipped run
 * loses nothing: those go at most once a day each. Below KEEPER_RESERVE the keeper sends none of its
 * own writes: what is left pays the staked-game payouts it relays.
 */
export const WORTH = { distribute: 50n, burn: 30n, fees: 50n } as const;
/** The burn waits for at least this much ETH in the reserve (and 30x its gas). */
export const BURN_MIN = 2n * 10n ** 15n;
export const KEEPER_RESERVE = 3n * 10n ** 15n;
/** Under this the admins are told, at most once a day. */
export const KEEPER_LOW = 4n * 10n ** 15n;
export const ONCE_A_DAY_MS = 86_400_000;
/** Gas units when the node gives no estimate (a v4 swap for the burn; four transfers for a split). */
export const GAS_UNITS = { distribute: 150_000n, burn: 320_000n, claimFees: 160_000n, withdraw: 80_000n, redeem: 120_000n, setPool: 90_000n } as const;
/** Enough of a value, at this gas price, for a write that costs `units` of gas (a null price falls back to `dust`). */
export const worth = (value: bigint, gasWei: bigint | null, multiple: bigint, dust: bigint, floor = 0n) =>
  gasWei === null ? value >= dust : value >= floor && value >= gasWei * multiple;
/** The reserve the next burn needs at this gas price. */
export const burnAt = (gasPrice: bigint | null) => {
  if (gasPrice === null) return DUST.burn;
  const g = gasPrice * GAS_UNITS.burn * WORTH.burn;
  return g > BURN_MIN ? g : BURN_MIN;
};
/** A token amount in ETH at a price in ETH per token; null without a price. */
const inEth = (amount: bigint, perEth?: number | null) => (perEth && perEth > 0 && Number.isFinite(perEth) ? (amount * BigInt(Math.round(perEth * 1e18))) / 10n ** 18n : null);
const eth4 = (wei: bigint) => (Number(wei) / 1e18).toFixed(wei < 10n ** 15n ? 6 : 4);

/**
 * What the keeper remembers between runs (keeper-state.json): when each token was last split and the
 * launch fee last collected, its balance once an hour (for the burn rate), and the last gas alert.
 */
type KeeperState = { distributed?: Record<string, number>; claimedAt?: number; samples?: { at: number; wei: string }[]; alertAt?: number; last?: KeeperRun };
const stateFile = () => join(config.dataDir, "keeper-state.json");
export function keeperState(): KeeperState {
  try { return existsSync(stateFile()) ? JSON.parse(readFileSync(stateFile(), "utf8")) as KeeperState : {}; } catch { return {}; }
}
/** Read fresh, changed, written: a run and the hourly check never overwrite each other's lines. */
function patchState(f: (s: KeeperState) => void) {
  const s = keeperState();
  f(s);
  try { writeAtomic(stateFile(), JSON.stringify(s)); } catch (e) { console.error("keeper state", e); }
}
/** One balance reading an hour at most, a week of them. */
export function sampleKeeper(wei: bigint, now = Date.now()) {
  patchState((s) => {
    const list = (s.samples ?? []).filter((x) => now - x.at < 7 * ONCE_A_DAY_MS);
    if (!list.length || now - list.at(-1)!.at >= 55 * 60_000) list.push({ at: now, wei: wei.toString() });
    s.samples = list;
  });
}
/**
 * What the keeper spends a day, from its balance readings (only the drops count: a top-up is not
 * spending), and how many days its balance lasts at that rate. Null until it has 6 hours of readings.
 */
export function keeperBurnRate(wei: bigint, samples = keeperState().samples ?? []): { perDay: bigint | null; daysLeft: number | null } {
  if (samples.length < 2) return { perDay: null, daysLeft: null };
  const span = samples.at(-1)!.at - samples[0]!.at;
  if (span < 6 * 3_600_000) return { perDay: null, daysLeft: null };
  let used = 0n;
  for (let i = 1; i < samples.length; i++) { const d = BigInt(samples[i - 1]!.wei) - BigInt(samples[i]!.wei); if (d > 0n) used += d; }
  const perDay = (used * BigInt(ONCE_A_DAY_MS)) / BigInt(span);
  return { perDay, daysLeft: perDay > 0n ? Number((wei * 100n) / perDay) / 100 : null };
}
/** The once-a-day admin note when the keeper runs low: its address, how long it lasts, what to send. */
export function keeperGasAlert(address: string, wei: bigint, now = Date.now(), s = keeperState()): string | null {
  if (wei >= KEEPER_LOW || now - (s.alertAt ?? 0) < ONCE_A_DAY_MS) return null;
  const { perDay, daysLeft } = keeperBurnRate(wei, s.samples ?? []);
  // enough for 90 days at the measured rate, at least 0.01 ETH, rounded up to 0.005
  const want = perDay ? perDay * 90n : 10n ** 16n;
  const step = 5n * 10n ** 15n, top = ((want > 10n ** 16n ? want : 10n ** 16n) + step - 1n) / step * step;
  return `the keeper ${address} has ${eth4(wei)} ETH (under ${eth4(KEEPER_LOW)}). ${daysLeft !== null ? `At ${eth4(perDay!)} ETH a day it lasts about ${daysLeft < 1 ? "less than a day" : `${Math.floor(daysLeft)} days`}.` : "Its daily spend is still being measured."} Under ${eth4(KEEPER_RESERVE)} ETH it stops its own runs and keeps the rest for staked-game payouts. Send it about ${eth4(top)} ETH.`;
}
export const markGasAlert = (now = Date.now()) => patchState((s) => { s.alertAt = now; });

/** One run: what it did, what it skipped and why, the ETH it spent on gas, and all of it on one line. */
export type KeeperRun = { at: number; did: string[]; skipped: string[]; error?: string; spentWei?: string; line?: string };

export function keeperAccount(vault: Vault) {
  try { return vault.account("keeper"); } catch { vault.create("keeper"); return vault.account("keeper"); }
}

/** Flashbots Protect: a transaction sent here stays out of the public mempool, so no bot can sandwich or front-run it. */
export function protectedWallet(account: LocalAccount) {
  return createWalletClient({ account, chain: mainnet, transport: http("https://rpc.flashbots.net") });
}

/**
 * Every transaction the keeper key sends goes through this one queue, with its nonce picked here:
 * the keeper run, the escrow's and the betting pool's relays can fire at the same moment, and two
 * sends that each ask the node for the next nonce would get the same one. A nonce handed out in the
 * last NONCE_MEMORY_MS counts even while no node shows it (a private Flashbots send is never pending
 * in the public mempool); past that, the node's count is trusted again (a dropped send frees its nonce).
 */
const NONCE_MEMORY_MS = 10 * 60_000;
let sendQueue: Promise<unknown> = Promise.resolve();
let lastNonce: { address: string; nonce: number; at: number } | null = null;
export function keeperSend(account: LocalAccount, send: (nonce: number) => Promise<Hex>): Promise<Hex> {
  const run = sendQueue.then(async () => {
    const me = account.address.toLowerCase();
    const pending = await eth.getTransactionCount({ address: account.address, blockTag: "pending" });
    const next = lastNonce && lastNonce.address === me && Date.now() - lastNonce.at < NONCE_MEMORY_MS ? lastNonce.nonce + 1 : 0;
    const nonce = Math.max(pending, next);
    const hash = await send(nonce);
    lastNonce = { address: me, nonce, at: Date.now() };
    return hash;
  });
  sendQueue = run.catch(() => {});
  return run;
}
/** A simulated request, sent from the keeper through the queue (privately through Flashbots Protect with `priv`). */
export function keeperWrite(account: LocalAccount, request: unknown, priv = false): Promise<Hex> {
  return keeperSend(account, (nonce) => (priv ? protectedWallet(account) : ethWallet(account)).writeContract({ ...(request as object), nonce } as never));
}

/**
 * The burn's price guard beyond the Quoter's: the Quoter reads the pool as it is in this block, which
 * someone can push just before the burn. So the IMD bought per ETH at the last successful burn is
 * kept, and a quote more than BURN_MAX_DRIFT_PCT worse than it is refused (nothing burned this run).
 * A reference older than BURN_PRICE_MAX_AGE_MS is not used (the market may really have moved).
 */
export const BURN_MAX_DRIFT_PCT = 15n;
const BURN_PRICE_MAX_AGE_MS = 30 * 86_400_000;
/** The burn waits a random 0..BURN_WINDOW_MS into a run: the runs start at odd hours, so it lands within about ±60 minutes of the even hour, at a time nobody can know ahead. */
export const BURN_WINDOW_MS = 110 * 60_000;
/** The last burn: IMD bought per ETH (the price guard), when, its transaction, and what it spent and bought (decimal). */
type BurnPrice = { imdPerEth: string; at: number; tx: string; eth?: string; imd?: string };
const burnFile = () => join(config.dataDir, "keeper-burn.json");
export function lastBurnPrice(): BurnPrice | null {
  try { return existsSync(burnFile()) ? JSON.parse(readFileSync(burnFile(), "utf8")) as BurnPrice : null; } catch { return null; }
}
/** IMD per 1 ETH (18 decimals) for `imd` bought with `wei`. */
const perEth = (imd: bigint, wei: bigint) => (imd * 10n ** 18n) / wei;
let burning = false;

/** For the front page: the splitter's ETH burn reserve and what the next burn waits for at today's gas price. */
export async function burnStatus(splitter?: string): Promise<{ reserve: bigint | null; at: bigint; last: BurnPrice | null }> {
  const [reserve, gasPrice] = await Promise.all([
    splitter ? eth.readContract({ address: splitter as Address, abi: SPLITTER, functionName: "reserve", args: [ETH] }).catch(() => null) : Promise.resolve(null),
    eth.getGasPrice().catch(() => null),
  ]);
  return { reserve, at: burnAt(gasPrice), last: lastBurnPrice() };
}

/**
 * One keeper run. `prices` (ETH per token) values $SHIFT and IMD against the gas; without them those
 * fall back to the fixed floors. `now` is for tests.
 */
export async function runKeeper(vault: Vault, c: { splitter?: string; token?: string; hook?: string }, launch?: { launchNumber?: number; payer?: string }, o: { burnDelayMs?: number; prices?: { shift?: number | null; imd?: number | null }; now?: number } = {}): Promise<KeeperRun> {
  const run: KeeperRun = { at: o.now ?? Date.now(), did: [], skipped: [] };
  const splitter = c.splitter as Address | undefined;
  if (!splitter || !c.token) return { ...run, error: "no splitter yet" };
  const account = keeperAccount(vault);
  const now = () => o.now ?? Date.now();
  const startWei = await eth.getBalance({ address: account.address });
  sampleKeeper(startWei, now());
  let spent = 0n;
  const done = () => {
    run.spentWei = spent.toString();
    const short = (x: string) => x.replace(/: (0x[0-9a-f]{10})[0-9a-f]{54}/i, ": $1…");
    run.line = `keeper ${new Date(run.at).toISOString().slice(0, 16)}Z · did ${run.did.length ? run.did.map(short).join("; ") : "nothing"} · skipped ${run.skipped.length ? run.skipped.join("; ") : "nothing"} · spent ${eth4(spent)} ETH · has ${eth4(startWei - spent)} ETH`;
    console.log(run.line);
    patchState((s) => { s.last = run; });
    return run;
  };
  if (startWei < KEEPER_RESERVE) {
    run.skipped.push(`all writes: the keeper has ${eth4(startWei)} ETH, under the ${eth4(KEEPER_RESERVE)} kept for staked-game payouts`);
    return done();
  }
  const gasPrice = await eth.getGasPrice().catch(() => null);
  /** The gas of one write at today's price: the node's estimate, else a typical count. Null without a gas price. */
  const gasOf = async (address: Address, abi: readonly unknown[], functionName: string, args: readonly unknown[], units: bigint) =>
    gasPrice === null ? null : gasPrice * (await eth.estimateContractGas({ account, address, abi, functionName, args } as never).catch(() => units));
  /** Every write first checks the keeper still has more than the reserve for game payouts. */
  const funded = async (label: string) => {
    const b = await eth.getBalance({ address: account.address }).catch(() => 0n);
    if (b >= KEEPER_RESERVE) return true;
    run.skipped.push(`${label}: the keeper is under ${eth4(KEEPER_RESERVE)} ETH, kept for staked-game payouts`);
    return false;
  };
  const paid = (r: { gasUsed?: bigint; effectiveGasPrice?: bigint }) => { if (r.gasUsed && r.effectiveGasPrice) spent += r.gasUsed * r.effectiveGasPrice; };
  // The burn swap goes through Flashbots Protect, out of the public mempool, so no bot can sandwich it.
  const send = async (label: string, functionName: "distribute" | "burnReserve", args: readonly unknown[]) => {
    if (!(await funded(label))) return null;
    try {
      const { request } = await eth.simulateContract({ account, address: splitter, abi: SPLITTER, functionName, args } as never);
      const hash = await keeperWrite(account, request, functionName === "burnReserve");
      const r = await eth.waitForTransactionReceipt({ hash, timeout: 300_000 });
      paid(r as never);
      if (r.status === "success") run.did.push(`${label}: ${hash}`); else run.skipped.push(`${label}: reverted ${hash}`);
      return r.status === "success" ? { hash, logs: (r as { logs?: { address: string; topics: Hex[]; data: Hex }[] }).logs ?? [] } : null;
    } catch (e) { run.skipped.push(`${label}: ${(e as Error).message.split("\n")[0]!.slice(0, 120)}`); return null; }
  };
  const call = async (label: string, address: Address, abi: readonly unknown[], functionName: string, args: readonly unknown[] = []) => {
    if (!(await funded(label))) return false;
    try {
      const { request } = await eth.simulateContract({ account, address, abi, functionName, args } as never);
      const hash = await keeperWrite(account, request);
      const r = await eth.waitForTransactionReceipt({ hash });
      paid(r as never);
      if (r.status === "success") run.did.push(`${label}: ${hash}`); else run.skipped.push(`${label}: reverted ${hash}`);
      return r.status === "success";
    } catch (e) { run.skipped.push(`${label}: ${(e as Error).message.split("\n")[0]!.slice(0, 120)}`); return false; }
  };
  const ago = (t: number) => `${Math.max(1, Math.round((now() - t) / 3_600_000))} h ago`;
  const st = keeperState();
  const under = (gas: bigint | null, m: bigint) => (gas === null ? "" : `, under ${m}x its gas (${eth4(gas)} ETH)`);

  // 0. The launch payer's 1% pool fee: collect it at IMD's factory (once a day, when worth it) and pay it to the dev wallet.
  if (launch?.launchNumber && launch.payer) {
    const payer = launch.payer as Address;
    const owed = (cur: Address) => eth.readContract({ address: FACTORY, abi: FACTORY_ABI, functionName: "owed", args: [payer, cur] }).catch(() => 0n);
    const claimArgs = [BigInt(launch.launchNumber)] as const;
    if (st.claimedAt && now() - st.claimedAt < ONCE_A_DAY_MS) run.skipped.push(`collect the pool fee: collected ${ago(st.claimedAt)}`);
    else {
      // what a claim would collect, read in one eth_call (the claim, then the owed views) where the node allows it
      const before = await Promise.all([owed(ETH), owed(c.token as Address)]);
      const after = await eth.multicall({ allowFailure: false, contracts: [
        { address: FACTORY, abi: FACTORY_ABI, functionName: "claimFees", args: claimArgs },
        { address: FACTORY, abi: FACTORY_ABI, functionName: "owed", args: [payer, ETH] },
        { address: FACTORY, abi: FACTORY_ABI, functionName: "owed", args: [payer, c.token as Address] },
      ] } as never).then((r) => r as unknown as [unknown, bigint, bigint]).catch(() => null);
      const gas = await gasOf(FACTORY, FACTORY_ABI, "claimFees", claimArgs, GAS_UNITS.claimFees);
      const value = after ? (after[1] - before[0]) + (inEth(after[2] - before[1], o.prices?.shift) ?? 0n) : null;
      if (value !== null && !worth(value, gas, WORTH.fees, 0n)) run.skipped.push(`collect the pool fee: ${eth4(value)} ETH of fees${under(gas, WORTH.fees)}`);
      else if (await call("collect the 1% pool fee", FACTORY, FACTORY_ABI, "claimFees", claimArgs)) patchState((s) => { s.claimedAt = now(); });
    }
    for (const [cur, label, dust] of [[ETH, "ETH", DUST.eth], [c.token as Address, "SHIFT", DUST.token]] as const) {
      const v = await owed(cur);
      if (v <= 0n) continue;
      const value = cur === ETH ? v : inEth(v, o.prices?.shift);
      const gas = value === null ? null : await gasOf(FACTORY, FACTORY_ABI, "withdraw", [payer, cur], GAS_UNITS.withdraw);
      if (!worth(value ?? v, gas, WORTH.fees, dust)) { run.skipped.push(`pay the ${label} pool fee: ${Number(v) / 1e18} ${label}${value === null ? " (no price, under the fixed floor)" : under(gas, WORTH.fees)}`); continue; }
      await call(`pay ${Number(v) / 1e18} ${label} pool fee to the dev wallet`, FACTORY, FACTORY_ABI, "withdraw", [payer, cur]);
    }
  }
  // 1. Sell-fee ETH the hook could not send at once waits there as claims: move it to the splitter, when worth its gas.
  if (c.hook) {
    const pending = await eth.readContract({ address: c.hook as Address, abi: HOOK, functionName: "pendingEthClaims" }).catch(() => 0n);
    if (pending > 0n) {
      const gas = await gasOf(c.hook as Address, HOOK, "redeemFeeClaims", [], GAS_UNITS.redeem);
      if (worth(pending, gas, WORTH.distribute, DUST.eth)) await call(`redeem ${Number(pending) / 1e18} ETH of sell fees`, c.hook as Address, HOOK, "redeemFeeClaims");
      else run.skipped.push(`redeem sell fees: ${eth4(pending)} ETH${under(gas, WORTH.distribute)}`);
    }
  }
  // 2. Once named keeper, tell the splitter which pool buys the IMD it burns (only once).
  const isKeeper = (await eth.readContract({ address: splitter, abi: SPLITTER_ROUTE, functionName: "keeper" }).catch(() => "0x")).toLowerCase() === account.address.toLowerCase();
  if (isKeeper && !(await eth.readContract({ address: splitter, abi: SPLITTER_ROUTE, functionName: "imdPoolSet" }).catch(() => true)))
    await call("set the ETH/IMD burn pool", splitter, SPLITTER_ROUTE, "setImdPool", [IMD_POOL]);
  if (!isKeeper) run.skipped.push("not the keeper yet: the dev wallet must press Make the server the keeper in /setup");
  const bal = (t: Address) => (t === ETH ? eth.getBalance({ address: splitter }) : eth.readContract({ address: t, abi: erc20, functionName: "balanceOf", args: [splitter] }));
  // The spec's reserve(token) view: the splitter's ETH balance also holds the burn reserve, which is not split again.
  const readReserve = () => eth.readContract({ address: splitter, abi: SPLITTER, functionName: "reserve", args: [ETH] }).catch(() => null);

  // 3. Split what came in, by the rule: rewards, dev, treasury, burn. Once a day per token at most, when worth 50x its gas.
  for (const [t, label, dust, price] of [[ETH, "ETH", DUST.eth, 1], [c.token as Address, "SHIFT", DUST.token, o.prices?.shift], [IMD_TOKEN as Address, "IMD", DUST.imd, o.prices?.imd]] as const) {
    const last = st.distributed?.[label];
    if (last && now() - last < ONCE_A_DAY_MS) { run.skipped.push(`distribute ${label}: split ${ago(last)}`); continue; }
    let b = await bal(t).catch(() => 0n);
    if (t === ETH) { const r = await readReserve(); if (r !== null) b = b > r ? b - r : 0n; }
    if (b <= 0n) { run.skipped.push(`distribute ${label}: nothing new in the splitter`); continue; }
    const value = t === ETH ? b : inEth(b, price);
    const gas = value === null ? null : await gasOf(splitter, SPLITTER, "distribute", [t], GAS_UNITS.distribute);
    if (!worth(value ?? b, gas, WORTH.distribute, dust)) { run.skipped.push(`distribute ${label}: only ${Number(b) / 1e18} new in the splitter${under(gas, WORTH.distribute)}`); continue; }
    if (await send(`distribute ${label}`, "distribute", [t])) patchState((s) => { s.distributed = { ...(s.distributed ?? {}), [label]: now() }; });
  }
  // 4. Burn the ETH reserve: buy IMD with it and send it to IMD's BurnExecutor (inside the splitter).
  // At a random moment of the run, one burn at a time.
  if (burning) { run.skipped.push("burn: the last run's burn is still waiting for its moment"); return done(); }
  burning = true;
  try {
    const delay = o.burnDelayMs ?? randomInt(0, BURN_WINDOW_MS);
    if (delay > 0) await new Promise((r) => setTimeout(r, delay));
    // The spec's reserve(token) view, and nothing else: the splitter's balance also holds ETH owed to
    // rewards, dev and treasury, so when the view does not answer nothing is burned this run.
    const reserve = await readReserve();
    if (reserve === null) run.skipped.push("burn: reserve unknown (the reserve view did not answer); nothing burned");
    else if (reserve < BURN_MIN || (gasPrice === null && reserve < DUST.burn)) run.skipped.push(`burn: reserve ${Number(reserve) / 1e18} ETH is too small (waits for ${eth4(burnAt(gasPrice))})`);
    else {
      // The price is the pool's own, from Uniswap's v4 Quoter, and at most 3% may be lost to price movement.
      const quoted = await eth.simulateContract({ address: V4.quoter, abi: quoterAbi, functionName: "quoteExactInputSingle", args: quoteArgs(IMD_POOL as never, true, reserve) as never })
        .then((q) => (q.result as readonly [bigint, bigint])[0]).catch(() => 0n);
      const last = lastBurnPrice();
      const ref = last && now() - last.at < BURN_PRICE_MAX_AGE_MS && /^\d+$/.test(last.imdPerEth) ? BigInt(last.imdPerEth) : null;
      const minOut = (quoted * 97n) / 100n;
      const gas = quoted > 0n ? await gasOf(splitter, SPLITTER, "burnReserve", [ETH, reserve, minOut], GAS_UNITS.burn) : null;
      if (quoted <= 0n) run.skipped.push("burn: the Quoter gave no price");
      else if (!worth(reserve, gas, WORTH.burn, DUST.burn, BURN_MIN)) run.skipped.push(`burn: reserve ${eth4(reserve)} ETH${under(gas, WORTH.burn)}`);
      else if (ref !== null && perEth(quoted, reserve) * 100n < ref * (100n - BURN_MAX_DRIFT_PCT))
        run.skipped.push(`burn: the quote is more than ${BURN_MAX_DRIFT_PCT}% worse than the last burn's price; nothing burned (the pool may be pushed)`);
      else {
        const sent = await send(`burn ${Number(reserve) / 1e18} ETH as IMD`, "burnReserve", [ETH, reserve, minOut]);
        if (sent) {
          // what was really bought: the largest IMD transfer of the burn (the splitter to the BurnExecutor), else the quote
          let bought = 0n;
          for (const l of sent.logs) {
            if (l.address.toLowerCase() !== IMD_TOKEN.toLowerCase()) continue;
            try { const d = decodeEventLog({ abi: erc20Abi, eventName: "Transfer", data: l.data, topics: l.topics as [Hex, ...Hex[]] }); if (d.args.value > bought) bought = d.args.value; } catch { /* not a transfer */ }
          }
          const imd = bought > 0n ? bought : quoted;
          try { writeAtomic(burnFile(), JSON.stringify({ imdPerEth: perEth(imd, reserve).toString(), at: now(), tx: sent.hash, eth: formatEther(reserve), imd: formatEther(imd) } satisfies BurnPrice)); } catch (e) { console.error("keeper burn price", e); }
        }
      }
    }
  } finally { burning = false; }
  return done();
}
