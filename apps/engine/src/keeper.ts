import { randomInt } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { type Address, type Hex, type LocalAccount, createWalletClient, decodeEventLog, erc20Abi, http, parseAbi } from "viem";
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
/** Below these, a run would spend more gas than it moves. */
const DUST = { eth: 5n * 10n ** 15n, token: 1_000n * 10n ** 18n, imd: 10n ** 17n, burn: 10n ** 16n };
const erc20 = parseAbi(["function balanceOf(address) view returns (uint256)"]);

export type KeeperRun = { at: number; did: string[]; skipped: string[]; error?: string };

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
type BurnPrice = { imdPerEth: string; at: number; tx: string };
const burnFile = () => join(config.dataDir, "keeper-burn.json");
export function lastBurnPrice(): BurnPrice | null {
  try { return existsSync(burnFile()) ? JSON.parse(readFileSync(burnFile(), "utf8")) as BurnPrice : null; } catch { return null; }
}
/** IMD per 1 ETH (18 decimals) for `imd` bought with `wei`. */
const perEth = (imd: bigint, wei: bigint) => (imd * 10n ** 18n) / wei;
let burning = false;

export async function runKeeper(vault: Vault, c: { splitter?: string; token?: string; hook?: string }, launch?: { launchNumber?: number; payer?: string }, o: { burnDelayMs?: number } = {}): Promise<KeeperRun> {
  const run: KeeperRun = { at: Date.now(), did: [], skipped: [] };
  const splitter = c.splitter as Address | undefined;
  if (!splitter || !c.token) return { ...run, error: "no splitter yet" };
  const account = keeperAccount(vault);
  const gas = await eth.getBalance({ address: account.address });
  if (gas < 2n * 10n ** 15n) return { ...run, error: `the keeper ${account.address} needs ETH for gas (has ${Number(gas) / 1e18})` };
  // The burn swap goes through Flashbots Protect, out of the public mempool, so no bot can sandwich it.
  const send = async (label: string, functionName: "distribute" | "burnReserve", args: readonly unknown[]) => {
    try {
      const { request } = await eth.simulateContract({ account, address: splitter, abi: SPLITTER, functionName, args } as never);
      const hash = await keeperWrite(account, request, functionName === "burnReserve");
      const r = await eth.waitForTransactionReceipt({ hash, timeout: 300_000 });
      if (r.status === "success") run.did.push(`${label}: ${hash}`); else run.skipped.push(`${label}: reverted ${hash}`);
      return r.status === "success" ? { hash, logs: (r as { logs?: { address: string; topics: Hex[]; data: Hex }[] }).logs ?? [] } : null;
    } catch (e) { run.skipped.push(`${label}: ${(e as Error).message.split("\n")[0]!.slice(0, 120)}`); return null; }
  };
  const call = async (label: string, address: Address, abi: readonly unknown[], functionName: string, args: readonly unknown[] = []) => {
    try {
      const { request } = await eth.simulateContract({ account, address, abi, functionName, args } as never);
      const hash = await keeperWrite(account, request);
      const r = await eth.waitForTransactionReceipt({ hash });
      if (r.status === "success") run.did.push(`${label}: ${hash}`); else run.skipped.push(`${label}: reverted ${hash}`);
    } catch (e) { run.skipped.push(`${label}: ${(e as Error).message.split("\n")[0]!.slice(0, 120)}`); }
  };
  // 0. The launch payer's 1% pool fee: collect it at IMD's factory and pay it to the dev wallet.
  if (launch?.launchNumber && launch.payer) {
    await call("collect the 1% pool fee", FACTORY, FACTORY_ABI, "claimFees", [BigInt(launch.launchNumber)]);
    for (const [cur, label] of [["0x0000000000000000000000000000000000000000", "ETH"], [c.token!, "SHIFT"]] as const) {
      const owed = await eth.readContract({ address: FACTORY, abi: FACTORY_ABI, functionName: "owed", args: [launch.payer as Address, cur as Address] }).catch(() => 0n);
      if (owed > 0n) await call(`pay ${Number(owed) / 1e18} ${label} pool fee to the dev wallet`, FACTORY, FACTORY_ABI, "withdraw", [launch.payer, cur]);
    }
  }
  // 1. Sell-fee ETH the hook could not send at once waits there as claims: move it to the splitter.
  if (c.hook) {
    const pending = await eth.readContract({ address: c.hook as Address, abi: HOOK, functionName: "pendingEthClaims" }).catch(() => 0n);
    if (pending > 0n) await call(`redeem ${Number(pending) / 1e18} ETH of sell fees`, c.hook as Address, HOOK, "redeemFeeClaims");
  }
  // 2. Once named keeper, tell the splitter which pool buys the IMD it burns (only once).
  const isKeeper = (await eth.readContract({ address: splitter, abi: SPLITTER_ROUTE, functionName: "keeper" }).catch(() => "0x")).toLowerCase() === account.address.toLowerCase();
  if (isKeeper && !(await eth.readContract({ address: splitter, abi: SPLITTER_ROUTE, functionName: "imdPoolSet" }).catch(() => true)))
    await call("set the ETH/IMD burn pool", splitter, SPLITTER_ROUTE, "setImdPool", [IMD_POOL]);
  if (!isKeeper) run.skipped.push("not the keeper yet: the dev wallet must press Make the server the keeper in /setup");
  const bal = (t: Address) => (t === ETH ? eth.getBalance({ address: splitter }) : eth.readContract({ address: t, abi: erc20, functionName: "balanceOf", args: [splitter] }));

  // 1. Split what came in, by the rule: rewards, dev, treasury, burn.
  for (const [t, label, dust] of [[ETH, "ETH", DUST.eth], [c.token as Address, "SHIFT", DUST.token], [IMD_TOKEN as Address, "IMD", DUST.imd]] as const) {
    const b = await bal(t);
    if (b < dust) { run.skipped.push(`${label}: only ${Number(b) / 1e18} in the splitter`); continue; }
    await send(`distribute ${label}`, "distribute", [t]);
  }
  // 2. Burn the ETH reserve: buy IMD with it and send it to IMD's BurnExecutor (inside the splitter).
  // At a random moment of the run, one burn at a time.
  if (burning) { run.skipped.push("burn: the last run's burn is still waiting for its moment"); return run; }
  burning = true;
  try {
    const delay = o.burnDelayMs ?? randomInt(0, BURN_WINDOW_MS);
    if (delay > 0) await new Promise((r) => setTimeout(r, delay));
    // The spec's reserve(token) view, and nothing else: the splitter's balance also holds ETH owed to
    // rewards, dev and treasury, so when the view does not answer nothing is burned this run.
    const reserve = await eth.readContract({ address: splitter, abi: SPLITTER, functionName: "reserve", args: [ETH] }).catch(() => null);
    if (reserve === null) run.skipped.push("burn: reserve unknown (the reserve view did not answer); nothing burned");
    else if (reserve >= DUST.burn) {
      // The price is the pool's own, from Uniswap's v4 Quoter, and at most 3% may be lost to price movement.
      const quoted = await eth.simulateContract({ address: V4.quoter, abi: quoterAbi, functionName: "quoteExactInputSingle", args: quoteArgs(IMD_POOL as never, true, reserve) as never })
        .then((q) => (q.result as readonly [bigint, bigint])[0]).catch(() => 0n);
      const last = lastBurnPrice();
      const ref = last && Date.now() - last.at < BURN_PRICE_MAX_AGE_MS && /^\d+$/.test(last.imdPerEth) ? BigInt(last.imdPerEth) : null;
      if (quoted <= 0n) run.skipped.push("burn: the Quoter gave no price");
      else if (ref !== null && perEth(quoted, reserve) * 100n < ref * (100n - BURN_MAX_DRIFT_PCT))
        run.skipped.push(`burn: the quote is more than ${BURN_MAX_DRIFT_PCT}% worse than the last burn's price; nothing burned (the pool may be pushed)`);
      else {
        const minOut = (quoted * 97n) / 100n;
        const done = await send(`burn ${Number(reserve) / 1e18} ETH as IMD`, "burnReserve", [ETH, reserve, minOut]);
        if (done) {
          // what was really bought: the largest IMD transfer of the burn (the splitter to the BurnExecutor), else the quote
          let bought = 0n;
          for (const l of done.logs) {
            if (l.address.toLowerCase() !== IMD_TOKEN.toLowerCase()) continue;
            try { const d = decodeEventLog({ abi: erc20Abi, eventName: "Transfer", data: l.data, topics: l.topics as [Hex, ...Hex[]] }); if (d.args.value > bought) bought = d.args.value; } catch { /* not a transfer */ }
          }
          try { writeAtomic(burnFile(), JSON.stringify({ imdPerEth: perEth(bought > 0n ? bought : quoted, reserve).toString(), at: Date.now(), tx: done.hash } satisfies BurnPrice)); } catch (e) { console.error("keeper burn price", e); }
        }
      }
    } else run.skipped.push(`burn: reserve ${Number(reserve) / 1e18} ETH is too small`);
  } finally { burning = false; }
  return run;
}
