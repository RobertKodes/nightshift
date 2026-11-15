import { DynamicBondingCurveClient } from "@meteora-ag/dynamic-bonding-curve-sdk";
import {
  AddressLookupTableAccount, ComputeBudgetProgram, Connection, type Keypair, PublicKey, SystemProgram, Transaction, TransactionInstruction,
  TransactionMessage, VersionedTransaction,
} from "@solana/web3.js";
// @ts-expect-error bn.js has no types in this package; the Meteora SDK takes its BN values
import BN from "bn.js";
import { getAddress } from "viem";
import { BURNS, type FeePort, NATIVE_SOL, type RelayQuote, SOLANA_RELAY_CHAIN } from "./sol-fees.js";

const RELAY = "https://api.relay.link";
const U64_MAX = new BN("18446744073709551615");
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** The live chain behind the fee wallet: Meteora's DBC for claims, plain transfers, Relay for the burns. */
export function liveFeePort(rpc: string, relayKey?: string): FeePort {
  const conn = new Connection(rpc, "confirmed");
  const client = new DynamicBondingCurveClient(conn, "confirmed");
  const headers: Record<string, string> = { "content-type": "application/json", ...(relayKey ? { "x-api-key": relayKey } : {}) };

  const landed = async (sig: string, history = false) => {
    const { value: [s] } = await conn.getSignatureStatuses([sig], { searchTransactionHistory: history });
    if (s?.err) throw new Error(`The transaction failed on Solana (${JSON.stringify(s.err).slice(0, 80)}).`);
    return s?.confirmationStatus === "confirmed" || s?.confirmationStatus === "finalized";
  };

  // Expiry is read with isBlockhashValid, never getBlockHeight: some RPCs (publicnode, 2026-11-15) answer
  // getBlockHeight with the slot, ~22M above the real height, so every transaction looked expired at once
  // although it landed. A payout that looked failed but landed would be paid twice.
  async function confirm(sig: string, blockhash: string): Promise<string> {
    for (let i = 0; i < 90; i++) {
      if (await landed(sig)) return sig;
      if (i % 5 === 4 && !(await conn.isBlockhashValid(blockhash, { commitment: "confirmed" }).then((r) => r.value).catch(() => true))) {
        await sleep(3000);
        if (await landed(sig, true)) return sig;
        throw new Error("Solana did not take the transaction in time.");
      }
      await sleep(2000);
    }
    throw new Error("Solana did not confirm the transaction in time.");
  }

  /** Simulates, then signs and sends a legacy transaction from the fee wallet. */
  async function send(tx: Transaction, kp: Keypair, cu = 200_000): Promise<string> {
    const { blockhash, lastValidBlockHeight } = await conn.getLatestBlockhash("confirmed");
    const t = new Transaction({ feePayer: kp.publicKey, blockhash, lastValidBlockHeight });
    t.add(ComputeBudgetProgram.setComputeUnitLimit({ units: cu }), ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 20_000 }), ...tx.instructions);
    t.sign(kp);
    const sim = await conn.simulateTransaction(t);
    if (sim.value.err) throw new Error(`would fail: ${JSON.stringify(sim.value.err).slice(0, 80)}`);
    const sig = await conn.sendRawTransaction(t.serialize(), { skipPreflight: true, maxRetries: 3 });
    return confirm(sig, blockhash);
  }

  return {
    balance: async (a) => BigInt(await conn.getBalance(new PublicKey(a), "confirmed")),

    async claimable(pools) {
      const out: { pool: string; lamports: bigint; creation: bigint }[] = [];
      for (const pool of pools) {
        const p = await client.state.getPool(pool).catch(() => null);
        if (!p) continue;
        const s = p.poolState as unknown as { partnerQuoteFee: BN; config: PublicKey };
        const cfg = await client.state.getPoolConfig(s.config).catch(() => null) as { poolCreationFee?: BN } | null;
        out.push({ pool, lamports: BigInt(s.partnerQuoteFee.toString()), creation: BigInt(cfg?.poolCreationFee?.toString() ?? "0") });
      }
      return out;
    },

    async claim(kp, pool, creation) {
      const p = new PublicKey(pool);
      const fees = await client.partner.claimPartnerTradingFee({ feeClaimer: kp.publicKey, payer: kp.publicKey, pool: p, maxBaseAmount: U64_MAX, maxQuoteAmount: U64_MAX });
      const created = creation ? await client.partner.claimPartnerPoolCreationFee({ pool: p, feeReceiver: kp.publicKey }).catch(() => null) : null;
      // both in one transaction when the launch fee is still there; else the trading fees alone
      if (created) {
        try { return { sig: await send(new Transaction().add(...fees.instructions, ...created.instructions), kp, 250_000), creationClaimed: true }; }
        catch (e) { if (!/would fail/.test((e as Error).message)) throw e; }
      }
      return { sig: await send(fees, kp), creationClaimed: false };
    },

    async pay(kp, to) {
      const tx = new Transaction().add(...to.map((t) => SystemProgram.transfer({ fromPubkey: kp.publicKey, toPubkey: new PublicKey(t.address), lamports: t.lamports })));
      return send(tx, kp, 20_000);
    },

    async quote({ wallet, burn, lamports }) {
      const b = BURNS[burn];
      // checksummed: Relay reads a lowercase 0x…dead as another address (seen 2026-11-13); relayProblem() checks what it answers
      const r = await fetch(`${RELAY}/quote`, {
        method: "POST", headers, signal: AbortSignal.timeout(20_000),
        body: JSON.stringify({ user: wallet, originChainId: SOLANA_RELAY_CHAIN, destinationChainId: 1, originCurrency: NATIVE_SOL, destinationCurrency: getAddress(b.token), amount: lamports.toString(), tradeType: "EXACT_INPUT", recipient: getAddress(b.to), slippageTolerance: "300" }),
      });
      const j = await r.json() as Record<string, any>;
      if (!r.ok) throw new Error(`Relay: ${String(j.message ?? r.status).slice(0, 120)}`);
      const steps = (j.steps ?? []) as { id: string; requestId?: string; items: { data: { instructions?: RelayQuote["instructions"]; addressLookupTableAddresses?: string[] } }[] }[];
      if (steps.length !== 1 || steps[0]!.items.length !== 1) throw new Error("Relay asked for more than one deposit.");
      const d = j.details ?? {};
      return {
        requestId: String(steps[0]!.requestId ?? ""),
        instructions: steps[0]!.items[0]!.data.instructions ?? [],
        lookupTables: steps[0]!.items[0]!.data.addressLookupTableAddresses ?? [],
        sender: String(d.sender ?? ""), recipient: String(d.recipient ?? ""),
        outToken: String(d.currencyOut?.currency?.address ?? ""), outAmount: String(d.currencyOut?.amount ?? "0"), minOut: String(d.currencyOut?.minimumAmount ?? "0"),
        inUsd: Number(d.currencyIn?.amountUsd ?? 0), outUsd: Number(d.currencyOut?.amountUsd ?? 0),
      };
    },

    async deposit(kp, q, lamports) {
      const ixs = q.instructions.map((ix) => new TransactionInstruction({
        programId: new PublicKey(ix.programId), data: Buffer.from(ix.data, "hex"),
        keys: ix.keys.map((k) => ({ pubkey: new PublicKey(k.pubkey), isSigner: k.isSigner, isWritable: k.isWritable })),
      }));
      const tables = (await Promise.all(q.lookupTables.map((a) => conn.getAddressLookupTable(new PublicKey(a)).then((r) => r.value)))).filter((t): t is AddressLookupTableAccount => !!t);
      const { blockhash } = await conn.getLatestBlockhash("confirmed");
      const msg = new TransactionMessage({
        payerKey: kp.publicKey, recentBlockhash: blockhash,
        instructions: [ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 20_000 }), ...ixs.filter((i) => !i.programId.equals(ComputeBudgetProgram.programId))],
      }).compileToV0Message(tables);
      const tx = new VersionedTransaction(msg);
      tx.sign([kp]);
      // the wallet may lose the burn and the network fee, nothing more
      const before = BigInt(await conn.getBalance(kp.publicKey, "confirmed"));
      const sim = await conn.simulateTransaction(tx, { accounts: { encoding: "base64", addresses: [kp.publicKey.toBase58()] } });
      if (sim.value.err) throw new Error(`The burn deposit would fail on Solana (${JSON.stringify(sim.value.err).slice(0, 80)}).`);
      const after = BigInt(sim.value.accounts?.[0]?.lamports ?? 0);
      if (before - after > lamports + 1_000_000n) throw new Error("The burn deposit would take more SOL than the burn.");
      const sig = await conn.sendRawTransaction(tx.serialize(), { skipPreflight: true, maxRetries: 3 });
      return confirm(sig, blockhash);
    },

    async status(requestId) {
      const r = await fetch(`${RELAY}/intents/status/v3?requestId=${encodeURIComponent(requestId)}`, { headers, signal: AbortSignal.timeout(15_000) });
      const j = await r.json() as { status?: string; txHashes?: string[]; outTxHashes?: string[] };
      const st = String(j.status ?? "");
      if (st === "success") {
        // what actually arrived at the burn address
        const out = await fetch(`${RELAY}/requests/v2?id=${encodeURIComponent(requestId)}`, { headers, signal: AbortSignal.timeout(15_000) })
          .then((x) => x.json() as Promise<{ requests?: { data?: { metadata?: { currencyOut?: { amount?: string } } } }[] }>)
          .then((x) => x.requests?.[0]?.data?.metadata?.currencyOut?.amount ?? null).catch(() => null);
        return { state: "done", ethTx: (j.txHashes ?? j.outTxHashes ?? [])[0] ?? null, out: out && /^\d+$/.test(out) ? out : null };
      }
      if (st === "refund" || st === "refunded" || st === "failure") return { state: "refunded", ethTx: null, out: null };
      return { state: "pending", ethTx: null, out: null };
    },
  };
}
