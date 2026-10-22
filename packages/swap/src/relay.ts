import { CHAINS, type ChainKey, type Token, chainByRelay, isNative } from "./chains.js";
import { checkQuote, contractsOf } from "./check.js";
import { type EvmTx, type Fee, type Quote, type QuoteRequest, type Step, type SvmIx, type SvmTx, usd } from "./types.js";

export const RELAY_API = "https://api.relay.link";

/** Relay's quote body: exact input, the user's slippage in bps, and NIGHTSHIFT's app fee only when there is one. */
export function relayQuoteBody(r: QuoteRequest, o: { feeBps: number; feeWallet: string }): Record<string, unknown> {
  const body: Record<string, unknown> = {
    user: r.from,
    recipient: r.to,
    originChainId: CHAINS[r.fromChain].relay,
    destinationChainId: CHAINS[r.toChain].relay,
    originCurrency: r.fromToken,
    destinationCurrency: r.toToken,
    amount: r.amount,
    tradeType: "EXACT_INPUT",
    slippageTolerance: String(Math.round(r.slippage * 10_000)),
  };
  if (o.feeBps > 0) body.appFees = [{ recipient: o.feeWallet, fee: String(o.feeBps) }];
  return body;
}

type RelayCurrency = { chainId: number; address: string; symbol: string; name: string; decimals: number; metadata?: { logoURI?: string; verified?: boolean } };
type RelayAmount = { currency: RelayCurrency; amount: string; amountUsd?: string; minimumAmount?: string };
type RelayItem = { data: Record<string, unknown> };
type RelayLeg = { inputCurrency: RelayAmount; outputCurrency: RelayAmount; router?: string };
export type RelayQuote = {
  requestId?: string;
  steps: { id: string; kind: string; requestId?: string; items: RelayItem[] }[];
  fees: Record<string, { amount?: string; amountUsd?: string } | undefined>;
  details: { sender?: string; recipient?: string; currencyIn: RelayAmount; currencyOut: RelayAmount; timeEstimate: number; route?: { origin?: RelayLeg; destination?: RelayLeg } };
};

const token = (a: RelayAmount, chain: ChainKey): Token => ({
  chain, address: a.currency.address, symbol: a.currency.symbol, name: a.currency.name, decimals: a.currency.decimals,
  logo: a.currency.metadata?.logoURI || undefined, verified: Boolean(a.currency.metadata?.verified) || isNative(chain, a.currency.address),
});

/** approve(spender, amount) calldata, read: the spender and the amount, null for any other call. */
export function readApprove(data: string): { spender: string; amount: bigint } | null {
  if (!/^0x095ea7b3[0-9a-fA-F]{128}$/.test(data)) return null;
  return { spender: `0x${data.slice(34, 74)}`, amount: BigInt(`0x${data.slice(74, 138)}`) };
}

/** A Relay quote in the page's shape, with every check run. Throws on a Relay error answer. */
export function fromRelay(j: RelayQuote | { message?: string; errorCode?: string }, r: QuoteRequest, ns: { bps: number; waived: boolean; note: string }): Quote {
  if (!("details" in j)) throw Object.assign(new Error((j as { message?: string }).message ?? "Relay sent no quote."), { code: (j as { errorCode?: string }).errorCode });
  const d = j.details;
  const fromChain = chainByRelay(d.currencyIn.currency.chainId), toChain = chainByRelay(d.currencyOut.currency.chainId);
  if (!fromChain || !toChain) throw new Error("Relay answered for another chain.");
  const fromToken = token(d.currencyIn, fromChain), toToken = token(d.currencyOut, toChain);
  const problems: string[] = [];
  const txs: (EvmTx | SvmTx)[] = [];
  let approval: Quote["approval"] = null;
  for (const s of j.steps) {
    if (s.kind !== "transaction") { problems.push("This Relay route needs an off-chain signature, which this page does not sign."); continue; }
    for (const it of s.items) {
      const x = it.data;
      if (Array.isArray(x.instructions)) {
        txs.push({ kind: "svm-ix", instructions: x.instructions as SvmIx[], lookupTables: (x.addressLookupTableAddresses as string[] | undefined) ?? [] });
        continue;
      }
      const tx: EvmTx = { kind: "evm", chainId: Number(x.chainId), to: String(x.to ?? ""), data: String(x.data ?? "0x"), value: String(x.value ?? "0"), gas: x.gas ? String(x.gas) : undefined };
      const ap = s.id === "approve" ? readApprove(tx.data) : null;
      // the approval is rebuilt by the page for exactly the input amount; Relay's own is only read for its spender
      if (ap) { approval = { token: tx.to, spender: ap.spender, amount: r.amount }; continue; }
      if (s.id === "approve") { problems.push("Relay's approval step is not a plain approve."); continue; }
      if (CHAINS[fromChain].kind === "evm" && (x.chainId === undefined || !x.to)) { problems.push("Relay sent a step this page cannot sign."); continue; }
      txs.push(tx);
    }
  }
  const leg = (l: RelayLeg | undefined, c: ChainKey | null): Step | null => (l && l.inputCurrency.currency.address.toLowerCase() !== l.outputCurrency.currency.address.toLowerCase()
    ? { type: "swap", tool: l.router ?? "swap", fromChain: c, toChain: c, from: l.inputCurrency.currency.symbol, to: l.outputCurrency.currency.symbol } : null);
  const o = d.route?.origin, de = d.route?.destination;
  const steps = [
    leg(o, fromChain),
    fromChain !== toChain ? { type: "bridge" as const, tool: "Relay", fromChain, toChain, from: o?.outputCurrency.currency.symbol ?? fromToken.symbol, to: de?.inputCurrency.currency.symbol ?? toToken.symbol } : null,
    leg(de, toChain),
  ].filter((s): s is Step => s !== null);
  const f = j.fees;
  const fees: Fee[] = [
    { name: "Relay solver fee", usd: usd(f.relayerService?.amountUsd), included: true },
    { name: "Destination gas", usd: usd(f.relayerGas?.amountUsd), included: true },
  ].filter((x) => x.usd !== null);
  const erc20 = CHAINS[fromChain].kind === "evm" && !isNative(fromChain, fromToken.address);
  const fromUsd = usd(d.currencyIn.amountUsd);
  const q: Quote = {
    provider: "relay", providerName: "Relay", tool: "relay", id: j.requestId ?? j.steps[0]?.requestId ?? "",
    fromChain, toChain, fromToken, toToken,
    fromAmount: d.currencyIn.amount, toAmount: d.currencyOut.amount, toAmountMin: d.currencyOut.minimumAmount ?? d.currencyOut.amount,
    fromUsd, toUsd: usd(d.currencyOut.amountUsd),
    steps, fees,
    gasUsd: usd(f.gas?.amountUsd),
    nightshift: { bps: ns.bps, usd: ns.bps > 0 ? (usd(f.app?.amountUsd) ?? (fromUsd === null ? null : (fromUsd * ns.bps) / 10_000)) : 0, amount: ((BigInt(d.currencyIn.amount) * BigInt(ns.bps)) / 10_000n).toString(), waived: ns.waived, note: ns.note },
    etaSeconds: d.timeEstimate,
    slippage: r.slippage,
    approval,
    txs,
    contracts: [],
    track: { provider: "relay", requestId: j.requestId ?? j.steps[0]?.requestId },
    problems: [],
  };
  q.contracts = contractsOf(q, null);
  q.problems = [...new Set([...problems, ...checkQuote(q, r, { from: d.sender, to: d.recipient, needsApproval: erc20 })])];
  return q;
}
