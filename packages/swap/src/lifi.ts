import { CHAINS, type ChainKey, type Token, chainByLifi, isNative } from "./chains.js";
import { checkQuote, contractsOf } from "./check.js";
import { readSvmTransaction } from "./svm.js";
import { type EvmTx, type Fee, type Quote, type QuoteRequest, type Step, type SvmTx, usd } from "./types.js";

export const LIFI_API = "https://li.quest/v1";

/**
 * LI.FI's quote query. The NIGHTSHIFT fee is always sent, `fee=0` when it is waived: a fee configured on the
 * integration in LI.FI's portal is never what decides it.
 */
export function lifiQuoteQuery(r: QuoteRequest, o: { integrator: string; feeBps: number }): string {
  return new URLSearchParams({
    fromChain: String(CHAINS[r.fromChain].lifi),
    toChain: String(CHAINS[r.toChain].lifi),
    fromToken: r.fromToken,
    toToken: r.toToken,
    fromAmount: r.amount,
    fromAddress: r.from,
    toAddress: r.to,
    slippage: String(r.slippage),
    integrator: o.integrator.trim() || "nightshift",
    fee: o.feeBps > 0 ? String(o.feeBps / 10_000) : "0",
  }).toString();
}

type LifiToken = { address: string; chainId: number; symbol: string; name: string; decimals: number; logoURI?: string; priceUSD?: string; verificationStatus?: string; coinKey?: string };
type LifiStep = { type: string; tool: string; toolDetails?: { name?: string }; action: { fromChainId: number; toChainId: number; fromToken: LifiToken; toToken: LifiToken } };
export type LifiQuote = {
  id: string; tool: string; toolDetails?: { name?: string };
  action: { fromChainId: number; toChainId: number; fromToken: LifiToken; toToken: LifiToken; fromAmount: string; fromAddress: string; toAddress: string; slippage: number };
  estimate: { approvalAddress?: string; toAmount: string; toAmountMin: string; fromAmount: string; fromAmountUSD?: string; toAmountUSD?: string; executionDuration: number; feeCosts?: { name: string; amountUSD?: string; included?: boolean }[]; gasCosts?: { amountUSD?: string }[] };
  includedSteps: LifiStep[];
  transactionRequest?: { to?: string; data: string; value?: string; chainId?: number; gasLimit?: string };
};

export const lifiToken = (t: LifiToken, chain: ChainKey): Token => ({
  chain, address: t.address, symbol: t.symbol, name: t.name, decimals: t.decimals, logo: t.logoURI || undefined,
  priceUsd: usd(t.priceUSD), verified: t.verificationStatus === "verified" || isNative(chain, t.address),
  ...(t.coinKey ? { canonical: true } : {}),
});

const stepType = (s: LifiStep): Step["type"] => (s.type === "cross" ? "bridge" : s.type === "swap" ? "swap" : s.tool === "feeCollection" ? "fee" : "wrap");

/** A LI.FI quote in the page's shape, with every check run. Throws on a LI.FI error answer. */
export function fromLifi(j: LifiQuote | { message?: string; code?: number }, r: QuoteRequest, ns: { bps: number; waived: boolean; note: string }): Quote {
  if (!("estimate" in j)) throw Object.assign(new Error((j as { message?: string }).message ?? "LI.FI sent no quote."), { code: (j as { code?: number }).code });
  const e = j.estimate, a = j.action;
  const fromChain = chainByLifi(a.fromChainId), toChain = chainByLifi(a.toChainId);
  if (!fromChain || !toChain) throw new Error("LI.FI answered for another chain.");
  const fromToken = lifiToken(a.fromToken, fromChain), toToken = lifiToken(a.toToken, toChain);
  const t = j.transactionRequest;
  const txs: (EvmTx | SvmTx)[] = !t ? [] : CHAINS[fromChain].kind === "svm"
    ? [{ kind: "svm", base64: t.data }]
    : [{ kind: "evm", chainId: Number(t.chainId), to: t.to ?? "", data: t.data, value: BigInt(t.value ?? "0").toString(), gas: t.gasLimit ? BigInt(t.gasLimit).toString() : undefined }];
  const erc20 = CHAINS[fromChain].kind === "evm" && !isNative(fromChain, fromToken.address);
  const fromUsd = usd(e.fromAmountUSD);
  // NIGHTSHIFT's fee is shown on its own line: an integrator-fee entry LI.FI may list is kept out of the provider's
  const fees: Fee[] = (e.feeCosts ?? []).filter((f) => !/integrator/i.test(f.name)).map((f) => ({ name: f.name, usd: usd(f.amountUSD), included: f.included !== false }));
  const svm = txs[0]?.kind === "svm" ? readSvmTransaction(txs[0].base64) : null;
  const q: Quote = {
    provider: "lifi", providerName: "LI.FI", tool: j.toolDetails?.name ?? j.tool, id: j.id,
    fromChain, toChain, fromToken, toToken,
    fromAmount: e.fromAmount, toAmount: e.toAmount, toAmountMin: e.toAmountMin,
    fromUsd, toUsd: usd(e.toAmountUSD),
    steps: j.includedSteps.map((s) => ({ type: stepType(s), tool: s.toolDetails?.name ?? s.tool, fromChain: chainByLifi(s.action.fromChainId), toChain: chainByLifi(s.action.toChainId), from: s.action.fromToken.symbol, to: s.action.toToken.symbol })),
    fees,
    gasUsd: (e.gasCosts ?? []).reduce<number | null>((s, g) => (usd(g.amountUSD) === null ? s : (s ?? 0) + usd(g.amountUSD)!), null),
    nightshift: { bps: ns.bps, usd: fromUsd === null ? null : (fromUsd * ns.bps) / 10_000, amount: ((BigInt(e.fromAmount) * BigInt(ns.bps)) / 10_000n).toString(), waived: ns.waived, note: ns.note },
    etaSeconds: e.executionDuration,
    slippage: a.slippage,
    approval: erc20 && e.approvalAddress ? { token: fromToken.address, spender: e.approvalAddress, amount: e.fromAmount } : null,
    txs,
    contracts: [],
    track: { provider: "lifi", tool: j.tool },
    problems: [],
  };
  q.contracts = contractsOf(q, svm);
  q.problems = checkQuote(q, r, { from: a.fromAddress, to: a.toAddress, svm, needsApproval: erc20 });
  return q;
}
