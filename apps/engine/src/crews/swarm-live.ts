import { createHash } from "node:crypto";
import { join } from "node:path";
import { type Address, type Hex, decodeEventLog, erc20Abi, keccak256, parseAbiItem, parseTransaction, parseUnits } from "viem";
import { estimateL1Fee } from "viem/op-stack";
import type { Quote, EvmTx, Track } from "@nightshift/swap";
import { eth, sales, salesWallet, broadcastSales, salesTxState } from "../chain.js";
import { config } from "../config.js";
import type { Engine } from "../engine.js";
import { liveAgentReserve } from "../agent-reserve.js";
import { swapService, swapSettings } from "../swap.js";
import { TtlCache } from "../services/cache.js";
import { verifiedSource } from "../services/source.js";
import type { Ctx } from "../services/context.js";
import { ImdQueue } from "./swarm-rate.js";
import { SwarmRefill, BASE_GAS_FLOOR, REFILL_IMD, REFILL_USDC, type SwarmRefillOrder } from "./swarm-refill.js";
import { publicRepo } from "./swarm-kinds.js";
import type { SwarmDesk } from "./swarm.js";

export const swarmImdQueue = new ImdQueue();
const httpCache = new TtlCache<unknown>(60_000, 20);
/** Runtime facts and skill names come from IMD, never from enrollment constants. */
export const swarmJson = async <T>(path: string): Promise<T> => (await httpCache.get(path, async () => {
  const r = await swarmImdQueue.run(false, () => fetch(`https://api.imd.fun${path}`, { headers: { accept: "application/json" }, signal: AbortSignal.timeout(3_000) }));
  if (!r.ok) throw new Error(`IMD ${path} unavailable.`); return r.json();
})).v as T;

const transfer = parseAbiItem("event Transfer(address indexed from, address indexed to, uint256 value)");
type Receipt = { status: string; transactionHash: Hex; logs: { address: string; data: Hex; topics: readonly Hex[] }[] };
const transfers = (r: Receipt, token: string, from: string | null, to: string | null) => r.logs.reduce((n, l) => {
  if (l.address.toLowerCase() !== token.toLowerCase()) return n;
  try { const e = decodeEventLog({ abi: [transfer], topics: l.topics as [Hex, ...Hex[]], data: l.data }); return (!from || e.args.from.toLowerCase() === from.toLowerCase()) && (!to || e.args.to.toLowerCase() === to.toLowerCase()) ? n + e.args.value : n; } catch { return n; }
}, 0n);
type Trace = { to?: string; value?: Hex; error?: string; calls?: Trace[] };
const nativeTo = (t: Trace, to: string): bigint => t.error ? 0n : (t.to?.toLowerCase() === to.toLowerCase() ? BigInt(t.value ?? "0x0") : 0n) + (t.calls ?? []).reduce((n, c) => n + nativeTo(c, to), 0n);

/** Provider status locates receipts; transfers or a successful call trace prove delivery. */
export async function confirmSwarmRefill(order: SwarmRefillOrder, house: string, d: {
  status(q: URLSearchParams): Promise<{ body: unknown }>; base(hash: Hex): Promise<Receipt | null>; ethereum(hash: Hex): Promise<Receipt | null>; native(hash: Hex, recipient: string): Promise<bigint | null>;
}) {
  const hash = order.legs.at(-1)!.signed!.hash;
  const params = new URLSearchParams({ provider: order.route.provider, from: "base", to: "eth", tx: hash });
  if (order.route.track.requestId) params.set("id", order.route.track.requestId); if (order.route.track.tool) params.set("tool", order.route.track.tool);
  const [trackResult, source] = await Promise.all([d.status(params), d.base(hash)]), track = trackResult.body as Track;
  if (!source || source.status !== "success" || source.transactionHash.toLowerCase() !== hash.toLowerCase() || transfers(source, REFILL_USDC, house, null) !== BigInt(order.amount)) throw new Error("Source receipt does not match the refill USDC spend.");
  if (!track.outHash || !/^0x[\da-f]{64}$/i.test(track.outHash)) return { state: "pending" as const };
  if (track.state === "done") {
    const receipt = await d.ethereum(track.outHash as Hex);
    if (receipt?.status === "success" && receipt.transactionHash.toLowerCase() === track.outHash.toLowerCase()) {
      const received = order.kind === "imd" ? transfers(receipt, REFILL_IMD, null, house) : await d.native(track.outHash as Hex, house);
      if (received != null && received >= BigInt(order.route.toAmountMin)) return { state: "done" as const, tx: track.outHash, amount: received.toString() };
    }
  }
  if (track.state === "failed" || track.state === "refunded") {
    const refund = await d.base(track.outHash as Hex);
    if (refund?.status === "success" && refund.transactionHash.toLowerCase() === track.outHash.toLowerCase() && transfers(refund, REFILL_USDC, null, house) >= BigInt(order.amount)) return { state: "refunded" as const, tx: track.outHash };
  }
  return { state: "pending" as const };
}

/** The refill signer shares the house's existing Base nonce queue. */
export function attachSwarmRefill(engine: Engine, desk: SwarmDesk, ctx: Ctx): void {
  const account = () => engine.vault.account("nightshift-services");
  const swap = swapService({ fetch: (u, i) => fetch(u, i), holds: async () => false, settings: () => ({ ...swapSettings(), feeBps: 0 }), now: Date.now });
  const request = (tx: EvmTx) => ({ account: account(), to: tx.to as Address, data: tx.data as Hex, value: BigInt(tx.value), chain: sales.chain });
  const cost = async (txs: EvmTx[]) => {
    const fees = await sales.estimateFeesPerGas(); let total = 0n;
    for (const tx of txs) { const r = request(tx), gas = tx.gas ? BigInt(tx.gas) : await sales.estimateGas(r); if (gas <= 0n || gas > 10_000_000n) throw new Error("Unsafe refill gas estimate."); total += r.value + gas * fees.maxFeePerGas * 2n + (await estimateL1Fee(sales, r)) * 2n; }
    return total;
  };
  const refill = new SwarmRefill({
    file: join(config.dataDir, "swarm-refill.json"), enabled: () => config.swarmDesk && config.mode === "live" && config.salesChainId === 8453,
    float: () => parseUnits(String(config.swarmImdFloat), 18), minRefill: () => parseUnits(String(config.swarmRefillMinUsd), 6), reserved: () => desk.reservations(), credits: () => desk.revenue(), house: () => account().address,
    funds: async () => {
      const [imd, gas, usdc, baseEth] = await Promise.all([eth.readContract({ address: REFILL_IMD, abi: erc20Abi, functionName: "balanceOf", args: [account().address] }), eth.getBalance({ address: account().address }), sales.readContract({ address: REFILL_USDC, abi: erc20Abi, functionName: "balanceOf", args: [account().address] }), sales.getBalance({ address: account().address, blockTag: "pending" })]);
      const reserve = liveAgentReserve()?.heldUsdc() ?? 0n;
      return { imd, eth: gas, usdc: usdc > reserve ? usdc - reserve : 0n, baseEth };
    },
    quote: async (kind, amount) => { const r = await swap.quote({ fromChain: "base", toChain: "eth", fromToken: REFILL_USDC, toToken: kind === "imd" ? REFILL_IMD : "0x0000000000000000000000000000000000000000", amount: amount.toString(), from: account().address, to: account().address, slippage: 0.03 }, null); const route = (r.body as { quotes?: Quote[] }).quotes?.find((q) => !q.problems.length); if (!route) throw new Error("No safe Base-to-Ethereum refill route."); return route; },
    cost,
    sign: async (tx) => { const wallet = salesWallet(account()), prepared = await wallet.prepareTransactionRequest({ ...request(tx), gas: tx.gas ? BigInt(tx.gas) : undefined }); const raw = await wallet.signTransaction(prepared as never); return { raw, hash: keccak256(raw), nonce: Number(prepared.nonce) }; },
    checkSigned: async (signed) => {
      const tx = parseTransaction(signed.raw);
      if (tx.chainId !== 8453 || !tx.gas || !tx.to || keccak256(signed.raw) !== signed.hash) throw new Error("Saved refill transaction is invalid.");
      const maxGas = tx.gas * (tx.maxFeePerGas ?? tx.gasPrice ?? 0n), l1 = await estimateL1Fee(sales, { account: account(), to: tx.to, data: tx.data, value: tx.value });
      if (await sales.getBalance({ address: account().address, blockTag: "pending" }) - maxGas - l1 * 2n - (tx.value ?? 0n) < BASE_GAS_FLOOR) throw new Error("Saved refill breaches the Base settlement gas floor.");
    },
    broadcast: broadcastSales, state: (tx) => salesTxState(account().address, tx.hash, tx.nonce, 0),
    delivery: (order) => confirmSwarmRefill(order, account().address, {
      status: (q) => swap.status(q), base: (hash) => sales.getTransactionReceipt({ hash }).catch(() => null), ethereum: (hash) => eth.getTransactionReceipt({ hash }).catch(() => null),
      native: async (hash, recipient) => {
        const tx = await eth.getTransaction({ hash }).catch(() => null);
        if (tx?.to?.toLowerCase() === recipient.toLowerCase()) return tx.value;
        try { const trace = await eth.request({ method: "debug_traceTransaction", params: [hash, { tracer: "callTracer" }] } as never) as Trace; return nativeTo(trace, recipient); } catch { return null; }
      },
    }),
    alert: (text) => engine.alert(text, `swarm-refill:${createHash("sha256").update(text).digest("hex").slice(0, 16)}`),
    spent: async (order) => { const refunded = order.phase === "refunded"; await engine.ledger.post({ id: `swarm-refill:${order.id}:${refunded ? "refund" : "spend"}`, at: new Date(), kind: "swarm_refill", memo: `Swarm Desk ${order.kind} ${refunded ? "refund" : "refill"}`, ref: { chainTx: refunded ? order.destinationTx : order.legs.at(-1)!.signed!.hash }, postings: [{ account: "co:nightshift-services:usdc", asset: "USDC", amount: (refunded ? 1n : -1n) * BigInt(order.amount) }, { account: "ext:swarm-refill", asset: "USDC", amount: (refunded ? -1n : 1n) * BigInt(order.amount) }] }); },
  });
  desk.attachRefill({ tick: () => engine.settleInTurn("nightshift-services", () => refill.tick()), heldUsdc: () => refill.heldUsdc(), status: () => refill.status() });
}

export const swarmVerified = async (ctx: Ctx, chain: "ethereum" | "base", address: string) => (await verifiedSource(ctx.d, chain === "ethereum" ? 1 : 8453, address as Address)).verified;

export async function swarmImportRepo(url: string): Promise<{ repoUrl: string; baseCommit: string }> {
  const r = await swarmImdQueue.fetch("https://api.imd.fun/requests/import", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ url: publicRepo(url), kind: "code" }) });
  const body = await r.json() as { source?: { repoUrl?: string; baseCommit?: string } };
  if (!r.ok || !body.source?.repoUrl || !/^[0-9a-f]{40}$/i.test(body.source.baseCommit ?? "") || publicRepo(body.source.repoUrl).replace(/\.git$/, "").toLowerCase() !== publicRepo(url).replace(/\.git$/, "").toLowerCase()) throw new Error("IMD could not import and pin this public GitHub repository.");
  return { repoUrl: body.source.repoUrl, baseCommit: body.source.baseCommit! };
}
