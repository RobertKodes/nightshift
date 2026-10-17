import { type Address, parseAbi } from "viem";
import { eth, ethWallet } from "./chain.js";
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
const ETH: Address = "0x0000000000000000000000000000000000000000";
/** Below these, a run would spend more gas than it moves. */
const DUST = { eth: 5n * 10n ** 15n, token: 1_000n * 10n ** 18n, imd: 10n ** 17n, burn: 10n ** 16n };
const erc20 = parseAbi(["function balanceOf(address) view returns (uint256)"]);

export type KeeperRun = { at: number; did: string[]; skipped: string[]; error?: string };

export function keeperAccount(vault: Vault) {
  try { return vault.account("keeper"); } catch { vault.create("keeper"); return vault.account("keeper"); }
}

/** ETH per IMD from IMD's deepest ETH pool on DexScreener, for the burn's minimum. */
async function ethPerImd(): Promise<number> {
  const r = await fetch(`https://api.dexscreener.com/latest/dex/tokens/${IMD_TOKEN}`, { signal: AbortSignal.timeout(8000) });
  const d = (await r.json()) as { pairs?: { chainId: string; baseToken: { address: string }; quoteToken: { symbol: string }; priceNative?: string; liquidity?: { usd?: number } }[] };
  const best = (d.pairs ?? []).filter((p) => p.chainId === "ethereum" && p.baseToken.address.toLowerCase() === IMD_TOKEN && /^W?ETH$/.test(p.quoteToken.symbol))
    .sort((a, b) => (b.liquidity?.usd ?? 0) - (a.liquidity?.usd ?? 0))[0];
  const v = Number(best?.priceNative);
  if (!(v > 0)) throw new Error("no IMD/ETH price");
  return v;
}

export async function runKeeper(vault: Vault, c: { splitter?: string; token?: string }): Promise<KeeperRun> {
  const run: KeeperRun = { at: Date.now(), did: [], skipped: [] };
  const splitter = c.splitter as Address | undefined;
  if (!splitter || !c.token) return { ...run, error: "no splitter yet" };
  const account = keeperAccount(vault);
  const w = ethWallet(account);
  const gas = await eth.getBalance({ address: account.address });
  if (gas < 2n * 10n ** 15n) return { ...run, error: `the keeper ${account.address} needs ETH for gas (has ${Number(gas) / 1e18})` };
  const send = async (label: string, functionName: "distribute" | "burnReserve", args: readonly unknown[]) => {
    try {
      const { request } = await eth.simulateContract({ account, address: splitter, abi: SPLITTER, functionName, args } as never);
      const hash = await w.writeContract(request as never);
      const r = await eth.waitForTransactionReceipt({ hash });
      if (r.status === "success") run.did.push(`${label}: ${hash}`); else run.skipped.push(`${label}: reverted ${hash}`);
    } catch (e) { run.skipped.push(`${label}: ${(e as Error).message.split("\n")[0]!.slice(0, 120)}`); }
  };
  const bal = (t: Address) => (t === ETH ? eth.getBalance({ address: splitter }) : eth.readContract({ address: t, abi: erc20, functionName: "balanceOf", args: [splitter] }));

  // 1. Split what came in, by the rule: rewards, dev, treasury, burn.
  for (const [t, label, dust] of [[ETH, "ETH", DUST.eth], [c.token as Address, "SHIFT", DUST.token], [IMD_TOKEN as Address, "IMD", DUST.imd]] as const) {
    const b = await bal(t);
    if (b < dust) { run.skipped.push(`${label}: only ${Number(b) / 1e18} in the splitter`); continue; }
    await send(`distribute ${label}`, "distribute", [t]);
  }
  // 2. Burn the ETH reserve: buy IMD with it and send it to IMD's BurnExecutor (inside the splitter).
  // The spec's reserve(token) view; the splitter's ETH balance if the view is missing.
  const reserve = await eth.readContract({ address: splitter, abi: SPLITTER, functionName: "reserve", args: [ETH] }).catch(() => bal(ETH));
  if (reserve >= DUST.burn) {
    const perImd = await ethPerImd().catch(() => 0);
    if (perImd > 0) {
      const minOut = BigInt(Math.floor((Number(reserve) / perImd) * 0.92));
      await send(`burn ${Number(reserve) / 1e18} ETH as IMD`, "burnReserve", [ETH, reserve, minOut]);
    } else run.skipped.push("burn: no IMD price");
  } else run.skipped.push(`burn: reserve ${Number(reserve) / 1e18} ETH is too small`);
  return run;
}
