import {
  type AddressLookupTableAccount, ComputeBudgetProgram, Connection, PublicKey, TransactionInstruction, TransactionMessage, VersionedTransaction,
} from "@solana/web3.js";
import { decodeAbiParameters, encodeAbiParameters, encodeFunctionData, erc20Abi, getAddress, parseAbi, stringToHex } from "viem";
import { COMPUTE_BUDGET, NATIVE_SOL, RELAY_DEPOSITORY, type RelayIx, SOLANA_RELAY_CHAIN } from "./sol-fees.js";
import { INTAKE, JOB_ACTION } from "./sol-imd.js";

/**
 * The IMD swarm's job paid in SOL from the creator's Solana wallet, in one signature, through NIGHTSHIFT Swap's
 * Relay route: SOL in on Solana; on Robinhood Chain, Relay's solver buys exactly 0.5 IMD and its router runs
 * two calls, approve(IMD's Intake, 0.5 IMD) and Intake.request(job.open, the launch's exact body). The IMD goes
 * to IMD, as when the creator pays from an EVM wallet; NIGHTSHIFT never holds it.
 *
 * Every quote is checked before the page sees it (relayPayProblem): one deposit, from the creator only, into
 * Relay's depository; IMD on Robinhood Chain; the destination calls exactly ours; refunds on Solana to the
 * creator, anything left on Robinhood Chain to NIGHTSHIFT's swap fee wallet. The deposit is then simulated: the
 * creator's wallet may lose the quoted SOL and the network fee, nothing more.
 */

export const RH_CHAIN = 4663;
export const RH_IMD = "0x5f7bb59365ce557c26dbcaa4ee9d39a4b95b7127";
export const IMD_WEI = 500_000_000_000_000_000n; // 0.5 IMD, 18 decimals
const RELAY = "https://api.relay.link";
const ZERO = "0x0000000000000000000000000000000000000000";
/** A route that loses more than this between the SOL paid and the IMD bought (Relay's and the DEX's costs) waits. */
export const MAX_ROUTE_LOSS_PCT = 25;
/** Never more than this for a 0.5 IMD job, whatever a quote says. */
export const MAX_PAY_LAMPORTS = 500_000_000n; // 0.5 SOL
/** On top of the quoted SOL: Solana's fee and the priority fee. */
export const FEE_SLACK = 1_000_000n; // 0.001 SOL
export const PRIORITY_MICROLAMPORTS = 50_000;

const intakeAbi = parseAbi(["function request(bytes32 action, bytes body, (address target, bytes4 selector) callback, address asset, uint256 amount) returns (bytes32)"]);

/** The two calls Relay's router runs on Robinhood Chain: exactly 0.5 IMD approved to the Intake, then the job with this body. */
export function imdCalls(body: string): { to: string; value: string; data: string }[] {
  const imd = getAddress(RH_IMD), intake = getAddress(INTAKE);
  return [
    { to: imd, value: "0", data: encodeFunctionData({ abi: erc20Abi, functionName: "approve", args: [intake, IMD_WEI] }) },
    { to: intake, value: "0", data: encodeFunctionData({ abi: intakeAbi, functionName: "request", args: [stringToHex(JOB_ACTION, { size: 32 }), stringToHex(body), { target: ZERO, selector: "0x00000000" }, imd, IMD_WEI] }) },
  ];
}

export type RelayPaySettings = { key: string; feeWallet: string; feeBps: number };

/** Relay's quote request: exact output (0.5 IMD), our calls, the IMD's fallback to the fee wallet, refunds to the creator. */
export function relayPayRequest(o: { creator: string; body: string } & RelayPaySettings): Record<string, unknown> {
  const wallet = getAddress(o.feeWallet);
  return {
    user: o.creator, originChainId: SOLANA_RELAY_CHAIN, originCurrency: NATIVE_SOL,
    destinationChainId: RH_CHAIN, destinationCurrency: getAddress(RH_IMD), amount: IMD_WEI.toString(), tradeType: "EXACT_OUTPUT",
    recipient: wallet, refundTo: o.creator, txs: imdCalls(o.body),
    ...(o.feeBps > 0 ? { appFees: [{ recipient: wallet, fee: String(o.feeBps) }] } : {}),
  };
}

/** What a Relay quote says, in the shape the checks read. */
export type RelayPayQuote = {
  requestId: string;
  steps: number; items: number; kind: string;
  instructions: RelayIx[]; lookupTables: string[];
  sender: string; recipient: string;
  inChain: number; inCurrency: string; inLamports: string; inUsd: number;
  outChain: number; outCurrency: string; outAmount: string; outUsd: number;
  timeEstimate: number;
  /** what Relay's solver commits to on the destination: the calls, the payments and the refunds */
  orderChain: string; calls: string[]; refunds: { chainId: string; recipient: string }[];
};

/** Relay's answer read into RelayPayQuote. Throws on an error answer. */
export function readRelayQuote(j: Record<string, any>): RelayPayQuote {
  if (!j || !j.details || !Array.isArray(j.steps)) throw new Error(`Relay sent no quote${j?.message ? `: ${String(j.message).slice(0, 160)}` : "."}`);
  const steps = j.steps as { kind?: string; requestId?: string; items?: { data?: { instructions?: RelayIx[]; addressLookupTableAddresses?: string[] } }[] }[];
  const item = steps[0]?.items?.[0]?.data ?? {};
  const d = j.details, order = j.protocol?.v2?.orderData ?? {};
  return {
    requestId: String(steps[0]?.requestId ?? j.requestId ?? ""),
    steps: steps.length, items: steps.reduce((a, s) => a + (s.items?.length ?? 0), 0), kind: String(steps[0]?.kind ?? ""),
    instructions: item.instructions ?? [], lookupTables: item.addressLookupTableAddresses ?? [],
    sender: String(d.sender ?? ""), recipient: String(d.recipient ?? ""),
    inChain: Number(d.currencyIn?.currency?.chainId ?? 0), inCurrency: String(d.currencyIn?.currency?.address ?? ""), inLamports: String(d.currencyIn?.amount ?? "0"), inUsd: Number(d.currencyIn?.amountUsd ?? 0),
    outChain: Number(d.currencyOut?.currency?.chainId ?? 0), outCurrency: String(d.currencyOut?.currency?.address ?? ""), outAmount: String(d.currencyOut?.amount ?? "0"), outUsd: Number(d.currencyOut?.amountUsd ?? 0),
    timeEstimate: Number(d.timeEstimate ?? 0),
    orderChain: String(order.output?.chainId ?? ""), calls: (order.output?.calls ?? []).map(String),
    refunds: ((order.inputs ?? []) as { refunds?: { chainId?: string; recipient?: string }[] }[]).flatMap((i) => i.refunds ?? []).map((r) => ({ chainId: String(r.chainId ?? ""), recipient: String(r.recipient ?? "") })),
  };
}

/**
 * The two ways a committed destination call can be laid out: Relay's order data carries (address to, (bytes data),
 * uint256 value) (seen 2026-11-15: the calldata wrapped in a one-field tuple), the plain one is (address, bytes, uint256).
 */
const CALL_LAYOUTS = [
  [{ type: "address" }, { type: "tuple", components: [{ type: "bytes" }] }, { type: "uint256" }],
  [{ type: "address" }, { type: "bytes" }, { type: "uint256" }],
] as const;

/** One of Relay's committed destination calls, read: the target, the calldata and the value. */
export function readCall(hex: string): { to: string; data: string; value: bigint } | null {
  for (const [i, layout] of CALL_LAYOUTS.entries()) {
    try {
      const [to, data, value] = decodeAbiParameters(layout, hex as `0x${string}`) as unknown as [string, readonly [string] | string, bigint];
      const bytes = (i === 0 ? (data as readonly [string])[0] : (data as string)).toLowerCase();
      // the read must be exactly what was sent: re-encoded, it gives the same hex
      if (encodeCall({ to, data: bytes, value }, i).toLowerCase() === hex.toLowerCase()) return { to: to.toLowerCase(), data: bytes, value };
    } catch { /* the other layout */ }
  }
  return null;
}

/** A destination call encoded in one of the layouts (Relay's by default). */
export function encodeCall(c: { to: string; data: string; value: bigint }, layout = 0): string {
  return layout === 0
    ? encodeAbiParameters(CALL_LAYOUTS[0], [getAddress(c.to), [c.data as `0x${string}`], c.value])
    : encodeAbiParameters(CALL_LAYOUTS[1], [getAddress(c.to), c.data as `0x${string}`, c.value]);
}

/** Everything that must hold before the creator is asked to sign the deposit. Null when it is safe. */
export function relayPayProblem(q: RelayPayQuote, o: { creator: string; body: string; feeWallet: string }): string | null {
  if (q.steps !== 1 || q.items !== 1 || q.kind !== "transaction") return "Relay asked for more than one Solana transaction";
  if (!/^0x[0-9a-f]{64}$/i.test(q.requestId)) return "the quote has no request id";
  if (q.sender !== o.creator) return "the deposit is not from the creator's wallet";
  if (q.inChain !== SOLANA_RELAY_CHAIN || q.inCurrency !== NATIVE_SOL) return "the quote is not paid in SOL on Solana";
  if (q.outChain !== RH_CHAIN || q.outCurrency.toLowerCase() !== RH_IMD) return "the quote does not buy IMD on Robinhood Chain";
  if (BigInt(q.outAmount || "0") !== IMD_WEI) return "the quote does not buy exactly 0.5 IMD";
  if (q.recipient.toLowerCase() !== o.feeWallet.toLowerCase()) return "what the calls leave would not go to NIGHTSHIFT's swap wallet";
  const lamports = BigInt(q.inLamports || "0");
  if (lamports <= 0n || lamports > MAX_PAY_LAMPORTS) return "the quoted SOL is out of range";
  if (!q.instructions.length) return "the quote has no deposit";
  for (const ix of q.instructions) {
    if (ix.programId !== RELAY_DEPOSITORY && ix.programId !== COMPUTE_BUDGET) return `an unknown program (${ix.programId.slice(0, 8)}…) is in the deposit`;
    for (const k of ix.keys) if (k.isSigner && k.pubkey !== o.creator) return "the deposit asks another signer";
  }
  // the destination calls Relay's solver committed to: exactly ours, in order, no value
  if (q.orderChain && q.orderChain !== "robinhood") return "Relay's order runs on another chain";
  const want = imdCalls(o.body);
  if (q.calls.length !== want.length) return "the destination calls are not IMD's job";
  for (const [i, c] of q.calls.entries()) {
    const got = readCall(c);
    if (!got || got.to !== want[i]!.to.toLowerCase() || got.data !== want[i]!.data.toLowerCase() || got.value !== 0n) return "the destination calls are not IMD's job for this launch";
  }
  for (const r of q.refunds) {
    if (r.chainId === "solana" ? r.recipient !== o.creator : r.recipient.toLowerCase() !== o.feeWallet.toLowerCase()) return "a refund would go to another wallet";
  }
  if (!q.refunds.some((r) => r.chainId === "solana")) return "the quote has no refund to the creator";
  if (!(q.inUsd > 0) || !(q.outUsd > 0)) return "the quote has no dollar values";
  const loss = (1 - q.outUsd / q.inUsd) * 100;
  if (loss > MAX_ROUTE_LOSS_PCT) return `the route costs ${loss.toFixed(1)}% (the limit is ${MAX_ROUTE_LOSS_PCT}%)`;
  return null;
}

export type RelayPayState = "waiting" | "pending" | "success" | "refunded" | "failed";
/** Relay's status for a request: the destination transaction when it is done. */
export type RelayStatus = { state: RelayPayState; destTx: string | null; destChain: number | null; inTx: string | null; why: string | null };

export function readRelayStatus(j: Record<string, any> | null): RelayStatus {
  const st = String(j?.status ?? "");
  const destTx = Array.isArray(j?.txHashes) ? String(j!.txHashes[0] ?? "") : "";
  const base = { destTx: /^0x[0-9a-fA-F]{64}$/.test(destTx) ? destTx.toLowerCase() : null, destChain: j?.destinationChainId ? Number(j.destinationChainId) : null, inTx: Array.isArray(j?.inTxHashes) ? String(j!.inTxHashes[0] ?? "") || null : null };
  const why = j?.failReason && j.failReason !== "N/A" ? String(j.failReason).slice(0, 120) : null;
  if (st === "success") return { state: "success", ...base, why: null };
  if (st === "refund" || st === "refunded") return { state: "refunded", ...base, why };
  if (st === "failure") return { state: "failed", ...base, why };
  if (st === "pending" || st === "submitted" || st === "delayed") return { state: "pending", ...base, why: null };
  return { state: "waiting", ...base, why: null };
}

/** The deposit, built for the creator to sign: a v0 transaction, unsigned, and what it costs their wallet in simulation. */
export type BuiltDeposit = { tx: string; lamports: bigint; blockhash: string };

export type RelayPayPort = {
  quote(o: { creator: string; body: string }): Promise<{ quote: RelayPayQuote; feeWallet: string; feeBps: number }>;
  /** builds the unsigned deposit and simulates it from the creator's wallet; throws when it would fail or cost more */
  build(q: RelayPayQuote, creator: string): Promise<BuiltDeposit>;
  status(requestId: string): Promise<RelayStatus>;
};

export function liveRelayPay(rpc: () => string, settings: () => RelayPaySettings): RelayPayPort {
  const headers = () => { const k = settings().key; return { "content-type": "application/json", ...(k ? { "x-api-key": k } : {}) }; };
  return {
    async quote({ creator, body }) {
      const s = settings();
      const r = await fetch(`${RELAY}/quote/v2`, { method: "POST", headers: headers(), body: JSON.stringify(relayPayRequest({ creator, body, ...s })), signal: AbortSignal.timeout(20_000) });
      const j = (await r.json().catch(() => ({}))) as Record<string, any>;
      if (r.status === 429) throw new Error("NIGHTSHIFT Swap's route is busy (rate limit). Try again in a minute.");
      if (!r.ok) throw new Error(`NIGHTSHIFT Swap found no route: ${String(j.message ?? r.status).slice(0, 160)}`);
      return { quote: readRelayQuote(j), feeWallet: s.feeWallet, feeBps: s.feeBps };
    },

    async build(q, creator) {
      const conn = new Connection(rpc(), "confirmed");
      const me = new PublicKey(creator);
      const ixs = q.instructions.filter((ix) => ix.programId !== COMPUTE_BUDGET).map((ix) => new TransactionInstruction({
        programId: new PublicKey(ix.programId), data: Buffer.from(ix.data, "hex"),
        keys: ix.keys.map((k) => ({ pubkey: new PublicKey(k.pubkey), isSigner: k.isSigner, isWritable: k.isWritable })),
      }));
      const tables = (await Promise.all(q.lookupTables.map((a) => conn.getAddressLookupTable(new PublicKey(a)).then((r) => r.value)))).filter((t): t is AddressLookupTableAccount => !!t);
      const { blockhash } = await conn.getLatestBlockhash("confirmed");
      const msg = new TransactionMessage({
        payerKey: me, recentBlockhash: blockhash,
        instructions: [ComputeBudgetProgram.setComputeUnitPrice({ microLamports: PRIORITY_MICROLAMPORTS }), ...ixs],
      }).compileToV0Message(tables);
      const tx = new VersionedTransaction(msg);
      const before = BigInt(await conn.getBalance(me, "confirmed"));
      const sim = await conn.simulateTransaction(tx, { sigVerify: false, commitment: "confirmed", accounts: { encoding: "base64", addresses: [creator] } });
      if (sim.value.err) {
        const short = /insufficient|0x1\b|Custom":1/i.test(JSON.stringify(sim.value.err) + (sim.value.logs ?? []).join(" "));
        throw new Error(short ? `Your wallet needs about ${(Number(BigInt(q.inLamports) + FEE_SLACK) / 1e9).toFixed(4)} SOL for the swarm, plus what the launch keeps.` : `The payment would fail on Solana right now (${JSON.stringify(sim.value.err).slice(0, 80)}). Nothing was sent.`);
      }
      const after = BigInt(sim.value.accounts?.[0]?.lamports ?? 0);
      const lamports = before - after;
      if (lamports > BigInt(q.inLamports) + FEE_SLACK) throw new Error("The payment would take more SOL than quoted. Nothing was sent.");
      return { tx: Buffer.from(tx.serialize()).toString("base64"), lamports, blockhash };
    },

    async status(requestId) {
      const r = await fetch(`${RELAY}/intents/status/v3?requestId=${encodeURIComponent(requestId)}`, { headers: headers(), signal: AbortSignal.timeout(15_000) });
      return readRelayStatus(r.ok ? ((await r.json().catch(() => null)) as Record<string, any> | null) : null);
    },
  };
}
