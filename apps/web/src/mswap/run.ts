import { CHAINS, type ChainKey, type Quote, type QuoteRequest, type SvmTx, amountText, approvalCalls, checkQuote, isNative, readSvmTransaction } from "@nightshift/swap";
import { type Address, type Hex, createPublicClient, createWalletClient, custom, erc20Abi, http } from "viem";
import { base, mainnet, robinhood } from "viem/chains";
import { chooseSolana, chooseWallet } from "../wallet";

/**
 * Signing a route in the visitor's own wallets. Nothing is sent before the route passed the checks again here,
 * against the contracts pinned in this page (@nightshift/swap/known.ts), whatever the server said; every EVM
 * transaction is simulated first (eth_call), every Solana one too (simulateTransaction); an allowance is only
 * ever exactly the swap's input.
 */
const VIEM = { eth: mainnet, base, rh: robinhood } as const;
type Evm = keyof typeof VIEM;
const rpcs = new Map<Evm, ReturnType<typeof make>>();
const make = (c: Evm) => createPublicClient({ chain: VIEM[c], transport: http(CHAINS[c].rpc) });
export const evmRpc = (c: Evm) => { let r = rpcs.get(c); if (!r) { r = make(c); rpcs.set(c, r); } return r; };
const short = (e: unknown) => String((e as { shortMessage?: string }).shortMessage ?? (e as Error).message ?? e).split("\n")[0]!.slice(0, 140);

/** The checks the server ran, run again in the page: a route that fails any of them is never signed. */
export function recheck(q: Quote, r: QuoteRequest): string[] {
  const first = q.txs[0];
  const svm = first?.kind === "svm" ? readSvmTransaction(first.base64) : null;
  return [...q.problems, ...checkQuote(q, r, { svm, needsApproval: CHAINS[q.fromChain].kind === "evm" && !isNative(q.fromChain, q.fromToken.address) })];
}

/** A wallet's balance of a token, in its smallest unit; null when it cannot be read. */
export async function balanceOf(chain: ChainKey, token: string, who: string): Promise<bigint | null> {
  try {
    if (chain === "eth" || chain === "base" || chain === "rh") {
      const rpc = evmRpc(chain);
      return isNative(chain, token) ? await rpc.getBalance({ address: who as Address }) : await rpc.readContract({ address: token as Address, abi: erc20Abi, functionName: "balanceOf", args: [who as Address] });
    }
    if (chain === "sol") {
      const call = async (method: string, params: unknown[]) => ((await (await fetch(CHAINS.sol.rpc!, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }) })).json()) as { result: unknown }).result;
      if (isNative("sol", token)) return BigInt(((await call("getBalance", [who])) as { value: number }).value);
      const r = (await call("getTokenAccountsByOwner", [who, { mint: token }, { encoding: "jsonParsed" }])) as { value: { account: { data: { parsed: { info: { tokenAmount: { amount: string } } } } } }[] };
      return r.value.reduce((s, a) => s + BigInt(a.account.data.parsed.info.tokenAmount.amount), 0n);
    }
  } catch { /* unknown */ }
  return null;
}

/** An EVM route: exact approval when needed, then each transaction simulated and sent. Resolves with the last hash. */
export async function runEvm(q: Quote, r: QuoteRequest, say: (s: string) => void): Promise<Hex> {
  const c = q.fromChain as Evm, chain = VIEM[c], name = CHAINS[c].name;
  say(`Switch your wallet to ${name}…`);
  const w = createWalletClient({ chain, transport: custom((await chooseWallet({ chain: chain.id })) as never) });
  const [a] = await w.requestAddresses();
  if (!a || a.toLowerCase() !== r.from.toLowerCase()) throw new Error("Your wallet changed since this quote. Get a new one.");
  const rpc = evmRpc(c);
  if (q.approval) {
    const allowance = await rpc.readContract({ address: q.approval.token as Address, abi: erc20Abi, functionName: "allowance", args: [a, q.approval.spender as Address] });
    for (const x of approvalCalls(q.approval, c, allowance)) {
      say(x.amount === 0n ? `Set the old ${q.fromToken.symbol} allowance to 0 first (Tether needs it)…` : `Allow exactly ${amountText(x.amount, q.fromToken.decimals)} ${q.fromToken.symbol} for this swap…`);
      const { request } = await rpc.simulateContract({ account: a, address: x.token as Address, abi: erc20Abi, functionName: "approve", args: [x.spender as Address, x.amount] });
      const h = await w.writeContract(request);
      say("Waiting for the approval…");
      if ((await rpc.waitForTransactionReceipt({ hash: h })).status !== "success") throw new Error("The approval failed. Nothing was swapped.");
    }
  }
  let last: Hex | null = null;
  for (const t of q.txs) {
    if (t.kind !== "evm") throw new Error("This route has a step this page cannot sign.");
    say(`Checking the swap on ${name}…`);
    try { await rpc.call({ account: a, to: t.to as Address, data: t.data as Hex, value: BigInt(t.value) }); }
    catch (e) { throw new Error(`The swap would fail right now (${short(e)}). Nothing was sent.`); }
    say("Confirm the swap in your wallet…");
    last = await w.sendTransaction({ account: a, chain, to: t.to as Address, data: t.data as Hex, value: BigInt(t.value), ...(t.gas ? { gas: BigInt(t.gas) } : {}) });
    say(`Waiting for ${name}…`);
    if ((await rpc.waitForTransactionReceipt({ hash: last })).status !== "success") throw new Error("The swap transaction reverted. Only gas was spent.");
  }
  if (!last) throw new Error("Nothing to send.");
  return last;
}

const fromB64 = (s: string) => Uint8Array.from(atob(s), (ch) => ch.charCodeAt(0));
const fromHex = (h: string) => Uint8Array.from((h.replace(/^0x/, "").match(/../g) ?? []).map((x) => parseInt(x, 16)));

/** The Solana transaction of a route: LI.FI's as sent, Relay's built from its instructions with a fresh blockhash. */
export async function svmTransaction(t: SvmTx, payer: string) {
  const { AddressLookupTableAccount, Connection, PublicKey, TransactionInstruction, TransactionMessage, VersionedTransaction } = await import("@solana/web3.js");
  const conn = new Connection(CHAINS.sol.rpc!, "confirmed");
  if (t.kind === "svm") return { conn, tx: VersionedTransaction.deserialize(fromB64(t.base64)) };
  const tables = (await Promise.all(t.lookupTables.map((k) => conn.getAddressLookupTable(new PublicKey(k)).then((x) => x.value)))).filter((x): x is InstanceType<typeof AddressLookupTableAccount> => x !== null);
  const { blockhash } = await conn.getLatestBlockhash("confirmed");
  const message = new TransactionMessage({
    payerKey: new PublicKey(payer),
    recentBlockhash: blockhash,
    instructions: t.instructions.map((ix) => new TransactionInstruction({ programId: new PublicKey(ix.programId), keys: ix.keys.map((k) => ({ pubkey: new PublicKey(k.pubkey), isSigner: k.isSigner, isWritable: k.isWritable })), data: fromHex(ix.data) as never })),
  }).compileToV0Message(tables);
  return { conn, tx: new VersionedTransaction(message) };
}

/** A Solana route: simulated, signed in the connected Solana wallet, confirmed. Resolves with the signature. */
export async function runSvm(q: Quote, r: QuoteRequest, say: (s: string) => void): Promise<string> {
  const t = q.txs[0];
  if (!t || t.kind === "evm" || q.txs.length !== 1) throw new Error("This route has a step this page cannot sign.");
  const sol = await chooseSolana();
  if (!sol || sol.address !== r.from) throw new Error("Your Solana wallet changed since this quote. Get a new one.");
  say("Checking the swap on Solana…");
  const { conn, tx } = await svmTransaction(t, r.from);
  const sim = await conn.simulateTransaction(tx, { sigVerify: false, replaceRecentBlockhash: true, commitment: "confirmed" });
  if (sim.value.err) throw new Error(`The swap would fail right now on Solana (${JSON.stringify(sim.value.err).slice(0, 100)}). Nothing was sent.`);
  say("Confirm the swap in your Solana wallet…");
  const sig = sol.wallet.signAndSendTransaction
    ? await sol.wallet.signAndSendTransaction(tx, { maxRetries: 3 })
    : await conn.sendRawTransaction((await sol.wallet.signTransaction(tx)).serialize(), { maxRetries: 3 });
  say("Waiting for Solana…");
  for (let i = 0; i < 60; i++) {
    const s = (await conn.getSignatureStatuses([sig])).value[0];
    if (s?.err) throw new Error("The Solana transaction failed. Only the network fee was spent.");
    if (s?.confirmationStatus === "confirmed" || s?.confirmationStatus === "finalized") return sig;
    await new Promise((res) => setTimeout(res, 1500));
  }
  return sig; // sent; the transfer status below keeps following it
}
