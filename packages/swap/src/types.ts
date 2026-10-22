import { validAddress } from "./addr.js";
import { CHAINS, type ChainKey, type Token, XRPL_SOURCE_SOON, isChain } from "./chains.js";
import type { Provider } from "./fee.js";

/** What the page asks for: amounts in the input token's smallest unit, slippage as a fraction (0.01 = 1%). */
export type QuoteRequest = {
  fromChain: ChainKey;
  toChain: ChainKey;
  fromToken: string;
  toToken: string;
  amount: string;
  /** The wallet that signs on the source chain. */
  from: string;
  /** The wallet that receives on the destination chain. */
  to: string;
  slippage: number;
};

export type Fee = { name: string; usd: number | null; included: boolean };
export type EvmTx = { kind: "evm"; chainId: number; to: string; data: string; value: string; gas?: string };
export type SvmIx = { programId: string; keys: { pubkey: string; isSigner: boolean; isWritable: boolean }[]; data: string };
export type SvmTx = { kind: "svm"; base64: string } | { kind: "svm-ix"; instructions: SvmIx[]; lookupTables: string[] };
export type Step = { type: "fee" | "wrap" | "swap" | "bridge"; tool: string; fromChain: ChainKey | null; toChain: ChainKey | null; from: string; to: string };
export type Contract = { chain: ChainKey; address: string; role: string; label: string | null };

/** One route, the same shape whichever provider found it. */
export type Quote = {
  provider: Provider;
  providerName: string;
  /** The bridge or exchange the provider picked (across, mayan, relay…). */
  tool: string;
  id: string;
  fromChain: ChainKey;
  toChain: ChainKey;
  fromToken: Token;
  toToken: Token;
  fromAmount: string;
  toAmount: string;
  toAmountMin: string;
  fromUsd: number | null;
  toUsd: number | null;
  steps: Step[];
  /** The provider's own fees (bridge, relayer, its service fee); NIGHTSHIFT's is apart, below. */
  fees: Fee[];
  gasUsd: number | null;
  nightshift: { bps: number; usd: number | null; amount: string; waived: boolean; note: string };
  etaSeconds: number;
  slippage: number;
  /** An ERC-20 input: exactly this allowance for exactly this spender, nothing more. */
  approval: { token: string; spender: string; amount: string } | null;
  txs: (EvmTx | SvmTx)[];
  contracts: Contract[];
  track: { provider: Provider; requestId?: string; tool?: string };
  /** Why this route must not be signed; empty when it passed every check. */
  problems: string[];
};

const num = (v: unknown) => (v === null || v === undefined || v === "" || !Number.isFinite(Number(v)) ? null : Number(v));
export const usd = num;

/** The request as typed in the page, checked: chains, addresses for those chains, a positive whole amount, sane slippage. */
export function checkRequest(x: Record<string, unknown>): { req: QuoteRequest } | { error: string } {
  const { fromChain, toChain } = x;
  if (!isChain(fromChain) || !isChain(toChain)) return { error: "Pick a chain to swap from and one to swap to." };
  if (fromChain === "xrpl") return { error: XRPL_SOURCE_SOON };
  const s = (k: string) => (typeof x[k] === "string" ? (x[k] as string).trim() : "");
  const req: QuoteRequest = { fromChain, toChain, fromToken: s("fromToken"), toToken: s("toToken"), amount: s("amount"), from: s("from"), to: s("to"), slippage: Number(x.slippage) };
  if (!req.fromToken || !req.toToken) return { error: "Pick both tokens." };
  if (!/^[1-9]\d{0,40}$/.test(req.amount)) return { error: "Type an amount above zero." };
  if (!validAddress(fromChain, req.from)) return { error: `Connect your ${CHAINS[fromChain].name} wallet to pay from.` };
  if (!validAddress(toChain, req.to)) return { error: `That is not a valid ${CHAINS[toChain].name} address to receive at.` };
  if (!(req.slippage >= 0.001 && req.slippage <= 0.2)) return { error: "Slippage must be between 0.1% and 20%." };
  if (fromChain === toChain && req.fromToken.toLowerCase() === req.toToken.toLowerCase()) return { error: "Pick two different tokens." };
  return { req };
}
