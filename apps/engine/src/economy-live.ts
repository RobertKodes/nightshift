import { liveSwarmDesk } from "./crews/swarm.js";
import { join } from "node:path";
import { decodeEventLog, erc20Abi, keccak256, parseAbiItem, parseTransaction, type Address, type Hex } from "viem";
import { estimateL1Fee } from "viem/op-stack";
import type { EvmTx, Quote, Track } from "@nightshift/swap";
import { AgentEconomy, setAgentEconomy } from "./agent-economy.js";
import { AgentReserve, reserveBuyMessage, RESERVE_GAS, RESERVE_SHIFT, RESERVE_USDC, RESERVE_WALLET, setAgentReserve, type ReserveBuy, type ReserveSettings } from "./agent-reserve.js";
import { broadcastSales, eth, sales, salesTxState, salesWallet } from "./chain.js";
import { chats, sendCard } from "./community.js";
import { config } from "./config.js";
import type { Engine } from "./engine.js";
import { liveOwnerStats } from "./owner-stats.js";
import { proofPayments } from "./proof.js";
import { readSettings, writeSettings } from "./settings.js";
import { swapService, swapSettings } from "./swap.js";

const HOUSE = "nightshift-services", TRANSFER = parseAbiItem("event Transfer(address indexed from, address indexed to, uint256 value)");
const OPERATOR_FEE = parseAbiItem("function getOperatorFee(uint256 gasUsed) view returns (uint256)");
export function reserveSettings(): ReserveSettings {
  const s = readSettings(), get = (k: "AGENT_RESERVE" | "AGENT_RESERVE_DRY" | "RESERVE_WALLET") => s[k] ?? process.env[k];
  return { enabled: get("AGENT_RESERVE") === "1" && config.mode === "live" && config.salesChainId === 8453, dry: get("AGENT_RESERVE_DRY") === "1", wallet: get("RESERVE_WALLET") || RESERVE_WALLET };
}
const transfers = (logs: { address: string; data: Hex; topics: readonly Hex[] }[], token: string, from: string | null, to: string | null): bigint => {
  let n = 0n;
  for (const l of logs) {
    if (l.address.toLowerCase() !== token.toLowerCase()) continue;
    try {
      const x = decodeEventLog({ abi: [TRANSFER], data: l.data, topics: l.topics as [Hex, ...Hex[]] });
      if ((!from || x.args.from.toLowerCase() === from.toLowerCase()) && (!to || x.args.to.toLowerCase() === to.toLowerCase())) n += x.args.value;
    } catch { /* another event */ }
  }
  return n;
};

type Receipt = { status: string; transactionHash: Hex; logs: { address: string; data: Hex; topics: readonly Hex[] }[] };
/** Provider status locates receipts; only matching transfers prove a delivery or refund. */
export async function confirmReserveDelivery(b: ReserveBuy, house: string, d: { status(query: URLSearchParams): Promise<{ body: unknown }>; base(hash: Hex): Promise<Receipt | null>; ethereum(hash: Hex): Promise<Receipt | null> }) {
  const source = b.legs.at(-1)!.signed!.hash;
  const q = new URLSearchParams({ provider: b.route.provider, from: "base", to: "eth", tx: source });
  if (b.route.track.requestId) q.set("id", b.route.track.requestId);
  if (b.route.track.tool) q.set("tool", b.route.track.tool);
  const track = (await d.status(q)).body as Track, input = await d.base(source);
  if (!input || input.status !== "success" || input.transactionHash !== source || transfers(input.logs, RESERVE_USDC, house, null) !== BigInt(b.amount)) throw new Error("Source USDC transfer does not match the reserve buy");
  if (track.state === "done" && track.outHash && /^0x[0-9a-f]{64}$/i.test(track.outHash)) {
    const receipt = await d.ethereum(track.outHash as Hex);
    if (receipt?.status === "success" && receipt.transactionHash === track.outHash) {
      const shift = transfers(receipt.logs, RESERVE_SHIFT, null, b.recipient);
      if (shift >= BigInt(b.route.toAmountMin)) return { state: "done" as const, tx: receipt.transactionHash, shift: shift.toString() };
    }
  }
  // Provider failure alone is not proof that the USDC came back.
  if ((track.state === "refunded" || track.state === "failed") && track.outHash && /^0x[0-9a-f]{64}$/i.test(track.outHash)) {
    const refund = await d.base(track.outHash as Hex);
    if (refund?.status === "success" && refund.transactionHash === track.outHash && transfers(refund.logs, RESERVE_USDC, null, house) >= BigInt(b.amount)) return { state: "refunded" as const };
  }
  if (track.state === "failed" || track.state === "refunded") return { state: "pending" as const, warning: "Agent Reserve route reports a failure, but a full Base USDC refund is not proven. The buy stays locked for reconciliation." };
  return { state: "pending" as const };
}

/** Reuses the site's routes, the house vault signer and Base nonce queue. */
export function startAgentEconomy(engine: Engine): void {
  const payments = () => proofPayments({ companies: [...engine.store.companies.values()], metrics: (id) => engine.store.metricsOf(id), houseId: HOUSE, swarm: liveSwarmDesk()?.revenue() });
  const economy = new AgentEconomy({ file: join(config.dataDir, "agent-economy.json"), payments, url: config.publicUrl,
    post: async (text, buttons, kind) => { const chat = chats()[0]; return Boolean(chat && config.telegramToken) && sendCard(chat!, kind, text, buttons); },
  });
  setAgentEconomy(economy);
  const account = () => engine.vault.account(HOUSE);
  const swap = swapService({ fetch: (u, i) => fetch(u, i), holds: async () => false, settings: () => ({ ...swapSettings(), feeBps: 0 }), now: Date.now });
  const baseRequest = (tx: EvmTx) => ({ account: account(), to: tx.to as Address, data: tx.data as Hex, value: BigInt(tx.value), chain: sales.chain });
  const extraFees = async (tx: { to: Address; data?: Hex; value?: bigint }, gas: bigint) => {
    const [l1, operator] = await Promise.all([
      estimateL1Fee(sales, { account: account(), to: tx.to, data: tx.data, value: tx.value }),
      sales.readContract({ address: "0x420000000000000000000000000000000000000F", abi: [OPERATOR_FEE], functionName: "getOperatorFee", args: [gas] }),
    ]);
    return (l1 + operator) * 2n;
  };
  const cost = async (txs: EvmTx[]): Promise<bigint> => {
    const fees = await sales.estimateFeesPerGas(), max = fees.maxFeePerGas;
    let total = 0n;
    for (const tx of txs) {
      const r = baseRequest(tx), gas = tx.gas ? BigInt(tx.gas) : await sales.estimateGas(r);
      if (gas <= 0n || gas > 10_000_000n) throw new Error("Unsafe reserve gas estimate");
      total += BigInt(tx.value) + gas * max * 2n + await extraFees(r, gas);
    }
    return total;
  };
  const delivery = (b: ReserveBuy) => confirmReserveDelivery(b, account().address, {
    status: (q) => swap.status(q), base: (hash) => sales.getTransactionReceipt({ hash }).catch(() => null), ethereum: (hash) => eth.getTransactionReceipt({ hash }).catch(() => null),
  });
  const reserve = new AgentReserve({ file: join(config.dataDir, "agent-reserve.json"), settings: reserveSettings,
    configure: (mode) => { writeSettings({ AGENT_RESERVE: mode === "off" ? "0" : "1", AGENT_RESERVE_DRY: mode === "dry" ? "1" : "0" }); },
    house: () => account().address,
    quote: async (amount, recipient) => {
      const r = await swap.quote({ fromChain: "base", toChain: "eth", fromToken: RESERVE_USDC, toToken: RESERVE_SHIFT, amount: amount.toString(), from: account().address, to: recipient, slippage: 0.03 }, null);
      const routes = (r.body as { quotes?: Quote[] }).quotes ?? [];
      const route = routes.find((q) => !q.problems.length);
      if (!route) throw new Error("No safe Base-to-Ethereum reserve route");
      return route;
    },
    funds: async () => ({ usdc: await sales.readContract({ address: RESERVE_USDC, abi: erc20Abi, functionName: "balanceOf", args: [account().address] }), eth: await sales.getBalance({ address: account().address, blockTag: "pending" }) }),
    cost,
    heldUsdc: () => liveSwarmDesk()?.liabilityUsdc() ?? 0n,
    sign: async (tx) => {
      const wallet = salesWallet(account()), request = await wallet.prepareTransactionRequest({ ...baseRequest(tx), gas: tx.gas ? BigInt(tx.gas) : undefined });
      const raw = await wallet.signTransaction(request as never);
      return { raw, hash: keccak256(raw), nonce: Number(request.nonce) };
    },
    checkSigned: async (signed) => {
      const tx = parseTransaction(signed.raw);
      if (tx.chainId !== 8453 || !tx.gas || !tx.to || keccak256(signed.raw) !== signed.hash) throw new Error("Saved reserve transaction is invalid");
      const maxGas = tx.gas * (tx.maxFeePerGas ?? tx.gasPrice ?? 0n);
      const extra = await extraFees({ to: tx.to, data: tx.data, value: tx.value }, tx.gas);
      if (await sales.getBalance({ address: account().address, blockTag: "pending" }) - maxGas - extra - (tx.value ?? 0n) < RESERVE_GAS) throw new Error("Signed reserve transaction would breach the Base ETH floor");
    },
    broadcast: broadcastSales, state: (tx) => salesTxState(account().address, tx.hash, tx.nonce, 0), delivery,
    alert: (text) => engine.alert(text, "agent-reserve"), log: (text) => console.info(text),
    bought: async (buy, proof) => {
      await engine.ledger.post({ id: `agent-reserve:${buy.id}`, at: new Date(buy.at), kind: "agent_reserve", memo: "Customer-funded SHIFT sent to the NIGHTSHIFT team wallet", ref: { chainTx: buy.legs.at(-1)!.signed!.hash }, postings: [
        { account: `co:${HOUSE}:usdc`, asset: "USDC", amount: -BigInt(buy.amount) },
        { account: "ext:agent-reserve", asset: "USDC", amount: BigInt(buy.amount) },
      ] });
      const text = reserveBuyMessage(buy, proof); liveOwnerStats()?.reserveBuy(buy.id, text); economy.noteBuy(buy.id, text);
    },
  });
  setAgentReserve(reserve);
  notePayment = (key) => {
    const p = payments().find((p) => p.key === key);
    if (p) {
      reserve.reconcile(payments()); economy.notePayment(p);
      void engine.settleInTurn(HOUSE, () => reserve.tick()).catch(() => { void engine.alert("Agent Reserve kept its saved buy for reconciliation.", "agent-reserve"); });
    }
  };
  // Reconcile records written just before a crash without reposting already-seen payments.
  const sync = async () => {
    const all = payments(); reserve.reconcile(all);
    for (const p of all) economy.notePayment(p);
    await economy.tick();
    await engine.settleInTurn(HOUSE, () => reserve.tick());
  };
  void sync().catch(() => { void engine.alert("Agent economy reconciliation failed; its saved ledgers were kept.", "agent-economy"); });
  setInterval(() => void sync().catch(() => { void engine.alert("Agent economy reconciliation failed; its saved ledgers were kept.", "agent-economy"); }), 60_000).unref();
}

let notePayment: ((key: string) => void) | null = null;
/** Called after settlement booking; the minute sync also recovers missed hooks. */
export function noteBookedPayment(key: string): void { notePayment?.(key); }
