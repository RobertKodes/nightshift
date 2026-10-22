import type { ChainKey } from "./chains.js";
import type { Quote } from "./types.js";

/** Tether on Ethereum refuses approve() from a non-zero allowance to another non-zero one: it is set to 0 first. */
export const USDT_ETHEREUM = "0xdac17f958d2ee523a2206206994597c13d831ec7";

export type ApproveCall = { token: string; spender: string; amount: bigint };

/**
 * The approvals a route needs, given the allowance the wallet already gave that spender: none when it already
 * covers the swap, else exactly the swap's input amount, never more (and never "unlimited": the July 2024
 * LI.FI exploit drained only wallets with unlimited approvals).
 */
export function approvalCalls(approval: Quote["approval"], chain: ChainKey, allowance: bigint): ApproveCall[] {
  if (!approval) return [];
  const need = BigInt(approval.amount);
  if (need <= 0n || allowance >= need) return [];
  const calls: ApproveCall[] = [];
  if (allowance > 0n && chain === "eth" && approval.token.toLowerCase() === USDT_ETHEREUM) calls.push({ token: approval.token, spender: approval.spender, amount: 0n });
  calls.push({ token: approval.token, spender: approval.spender, amount: need });
  return calls;
}
