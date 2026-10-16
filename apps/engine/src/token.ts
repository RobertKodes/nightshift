import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { erc20Abi } from "viem";
import { eth } from "./chain.js";
import { config } from "./config.js";

/**
 * The platform token's utility inside NIGHTSHIFT, all of it checkable onchain:
 * - holders pay no platform fee when they withdraw revenue,
 * - holders' products are featured first in the market,
 * - platform fees are used to buy the token back on its IMD pair, and every buyback is published.
 */
const holderCache = new Map<string, { at: number; holds: boolean; balance: number }>();
let decimals: number | null = null;

export const tokenOn = () => Boolean(config.token.address);

export async function holderStatus(owner: string | null): Promise<{ holds: boolean; balance: number }> {
  if (!tokenOn() || !owner) return { holds: false, balance: 0 };
  const k = owner.toLowerCase();
  const hit = holderCache.get(k);
  if (hit && Date.now() - hit.at < 10 * 60_000) return hit;
  try {
    decimals ??= Number(await eth.readContract({ address: config.token.address as `0x${string}`, abi: erc20Abi, functionName: "decimals" }));
    const raw = await eth.readContract({ address: config.token.address as `0x${string}`, abi: erc20Abi, functionName: "balanceOf", args: [owner as `0x${string}`] });
    const balance = Number(raw / 10n ** BigInt(Math.max(0, decimals - 6))) / 10 ** Math.min(6, decimals);
    const v = { at: Date.now(), holds: balance >= config.token.holderMin && config.token.holderMin > 0, balance };
    holderCache.set(k, v);
    return v;
  } catch {
    return hit ?? { holds: false, balance: 0 };
  }
}
/** The cached answer, for hot paths like the market listing. */
export const holdsCached = (owner: string | null) => (owner ? holderCache.get(owner.toLowerCase())?.holds ?? false : false);

export type Buyback = { at: number; tx: string; usd: number; amount: number; note?: string };
const file = () => join(config.dataDir, "token.json");
export function buybacks(): Buyback[] {
  try { return existsSync(file()) ? (JSON.parse(readFileSync(file(), "utf8")).buybacks ?? []) : []; } catch { return []; }
}
export function recordBuyback(b: Buyback): void {
  const all = [...buybacks(), b].sort((x, y) => y.at - x.at);
  writeFileSync(file(), JSON.stringify({ buybacks: all }, null, 2));
}
