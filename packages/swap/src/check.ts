import { CHAINS, isNative, sameAddress } from "./chains.js";
import { knownContract } from "./known.js";
import type { SvmSummary } from "./svm.js";
import type { Contract, Quote, QuoteRequest } from "./types.js";

/** A bridge may ask for a little native coin on top of an ERC-20 input (a messaging fee): never more than this. */
export const MAX_EXTRA_NATIVE = 10n ** 16n;

/** The contracts (EVM) or programs (Solana) a route's transactions touch, each labelled when we know it. */
export function contractsOf(q: Quote, svm: SvmSummary | null): Contract[] {
  const c = q.fromChain, out: Contract[] = [];
  const add = (address: string, role: string) => { if (!out.some((x) => x.address === address && x.role === role)) out.push({ chain: c, address, role, label: knownContract(c, address) }); };
  if (q.approval) add(q.approval.spender, `May spend exactly your ${q.fromToken.symbol} for this swap`);
  for (const t of q.txs) {
    if (t.kind === "evm") add(t.to, "Called by the swap");
    else if (t.kind === "svm-ix") for (const ix of t.instructions) add(ix.programId, "Program in the swap");
  }
  for (const p of svm?.programs ?? []) add(p, "Program in the swap");
  return out;
}

/**
 * Everything that must hold before a route is shown as signable, whoever built it: the chains, tokens, amount,
 * sender and recipient asked for; a minimum no lower than the slippage allows; transactions only to contracts
 * pinned in known.ts, on the right chain, sending no more native coin than the swap needs; on Solana, the
 * connected wallet as the only signer and only known programs.
 */
export function checkQuote(q: Quote, r: QuoteRequest, claimed: { from?: string; to?: string; svm?: SvmSummary | null; needsApproval?: boolean }): string[] {
  const p: string[] = [];
  const chain = CHAINS[q.fromChain];
  if (q.fromChain !== r.fromChain || q.toChain !== r.toChain) p.push("The route is for other chains than the ones picked.");
  if (!sameAddress(q.fromToken.address, r.fromToken) || !sameAddress(q.toToken.address, r.toToken)) p.push("The route swaps other tokens than the ones picked.");
  if (q.fromAmount !== r.amount) p.push("The route spends another amount than the one typed.");
  if (claimed.from !== undefined && !sameAddress(claimed.from, r.from)) p.push("The route is built for another wallet.");
  if (claimed.to !== undefined && !sameAddress(claimed.to, r.to)) p.push("The route pays out to another address than yours.");
  const out = BigInt(q.toAmount), min = BigInt(q.toAmountMin);
  const floor = (out * BigInt(Math.round((1 - r.slippage) * 10_000) - 50)) / 10_000n;
  if (min <= 0n || min > out || min < floor) p.push("The route's minimum does not match your slippage.");
  if (!q.txs.length) p.push("The route came without a transaction.");
  if (q.approval && !knownContract(q.fromChain, q.approval.spender)) p.push(`The route asks to let an unknown contract spend your ${q.fromToken.symbol}: ${q.approval.spender}.`);
  if (q.approval && (q.approval.amount !== r.amount || !sameAddress(q.approval.token, r.fromToken))) p.push("The route asks for a different allowance than this swap needs.");
  if (claimed.needsApproval && !q.approval) p.push("The route has no allowance step for your token.");
  const native = isNative(q.fromChain, r.fromToken);
  for (const t of q.txs) {
    if (t.kind === "evm") {
      if (chain.kind !== "evm" || t.chainId !== chain.evmId) p.push(`A transaction is for chain ${t.chainId}, not ${chain.name}.`);
      if (!knownContract(q.fromChain, t.to)) p.push(`The route sends a transaction to an unknown contract: ${t.to}.`);
      const v = BigInt(t.value);
      if (native ? v > BigInt(r.amount) + BigInt(r.amount) / 50n : v > MAX_EXTRA_NATIVE) p.push("A transaction sends more native coin than this swap needs.");
    } else if (t.kind === "svm-ix") {
      for (const ix of t.instructions) {
        if (!knownContract("sol", ix.programId)) p.push(`The route calls an unknown Solana program: ${ix.programId}.`);
        if (ix.keys.some((k) => k.isSigner && k.pubkey !== r.from)) p.push("A Solana instruction needs another signer than your wallet.");
      }
    }
  }
  if (claimed.svm) {
    if (claimed.svm.payer !== r.from || claimed.svm.signers.some((s) => s !== r.from)) p.push("The Solana transaction is signed or paid by another wallet than yours.");
    for (const prog of claimed.svm.programs) if (!knownContract("sol", prog)) p.push(`The route calls an unknown Solana program: ${prog}.`);
  }
  return [...new Set(p)];
}
