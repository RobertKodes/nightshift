import {
  CpAmm, derivePositionAddress, derivePositionNftAccount, getAllPositionNftAccountByOwner, getTokenProgram, getUnClaimLpFee, type PoolState, type PositionState,
} from "@meteora-ag/cp-amm-sdk";
import { DynamicBondingCurveClient } from "@meteora-ag/dynamic-bonding-curve-sdk";
import {
  AddressLookupTableAccount, ComputeBudgetProgram, Connection, type Keypair, PublicKey, SystemProgram, Transaction, TransactionInstruction,
  TransactionMessage, VersionedTransaction,
} from "@solana/web3.js";
// @ts-expect-error bn.js has no types in this package; the Meteora SDK takes its BN values
import BN from "bn.js";
import { getAddress } from "viem";
import { BURNS, claimProblem, type Extra, type FeePort, NATIVE_SOL, partnerMigrationFee, type RelayQuote, SOLANA_RELAY_CHAIN } from "./sol-fees.js";

const RELAY = "https://api.relay.link";
const U64_MAX = new BN("18446744073709551615");
/** A claim may cost the fee wallet at most this (the network fee and the rent of a token account it opens); it brings SOL in. */
const CLAIM_MAX_COST = 3_000_000n; // 0.003 SOL
const WSOL = "So11111111111111111111111111111111111111112";
const ATA_PROGRAM = new PublicKey("ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL");
/** Accounts read per call: the free public RPCs answer at most 10 at a time. */
const CHUNK = 10;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** The live chain behind the fee wallet: Meteora's DBC for claims, plain transfers, Relay for the burns. */
export function liveFeePort(rpc: string, relayKey?: string): FeePort {
  const conn = new Connection(rpc, "confirmed");
  const client = new DynamicBondingCurveClient(conn, "confirmed");
  const amm = new CpAmm(conn);
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

  /**
   * Checks, simulates, then signs and sends a transaction from the fee wallet. Every transaction may call only
   * known programs and needs only the fee wallet's signature; a claim (`maxCost`) may cost the wallet at most that.
   */
  async function send(tx: Transaction, kp: Keypair, cu = 200_000, maxCost?: bigint): Promise<string> {
    const me = kp.publicKey.toBase58();
    const bad = claimProblem(tx.instructions.map((i) => ({ programId: i.programId.toBase58(), keys: i.keys.map((k) => ({ pubkey: k.pubkey.toBase58(), isSigner: k.isSigner })) })), me);
    if (bad) throw new Error(`refused: ${bad}`);
    const { blockhash, lastValidBlockHeight } = await conn.getLatestBlockhash("confirmed");
    const t = new Transaction({ feePayer: kp.publicKey, blockhash, lastValidBlockHeight });
    t.add(ComputeBudgetProgram.setComputeUnitLimit({ units: cu }), ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 20_000 }), ...tx.instructions.filter((i) => !i.programId.equals(ComputeBudgetProgram.programId)));
    const vt = new VersionedTransaction(t.compileMessage());
    if (vt.message.header.numRequiredSignatures !== 1) throw new Error("refused: the transaction needs another signature");
    vt.sign([kp]);
    const before = maxCost === undefined ? 0n : BigInt(await conn.getBalance(kp.publicKey, "confirmed"));
    const sim = await conn.simulateTransaction(vt, { accounts: { encoding: "base64", addresses: [me] } });
    if (sim.value.err) throw new Error(`would fail: ${JSON.stringify(sim.value.err).slice(0, 80)}`);
    if (maxCost !== undefined) {
      const after = BigInt(sim.value.accounts?.[0]?.lamports ?? 0);
      if (before - after > maxCost) throw new Error("refused: the claim would cost the fee wallet more than its network fee");
    }
    const sig = await conn.sendRawTransaction(vt.serialize(), { skipPreflight: true, maxRetries: 3 });
    return confirm(sig, blockhash);
  }

  /** Accounts in chunks the public RPCs answer; a missing or foreign account comes back null. */
  async function many<T>(keys: PublicKey[], fetch: (k: PublicKey[]) => Promise<(T | null)[]>): Promise<(T | null)[]> {
    const out: (T | null)[] = [];
    for (let i = 0; i < keys.length; i += CHUNK) out.push(...await fetch(keys.slice(i, i + CHUNK)));
    return out;
  }

  /** The raw balance of the owner's token account for a mint (0 when it has none). */
  async function tokenBalance(owner: PublicKey, mint: PublicKey, program: PublicKey): Promise<bigint> {
    const [ata] = PublicKey.findProgramAddressSync([owner.toBuffer(), program.toBuffer(), mint.toBuffer()], ATA_PROGRAM);
    return conn.getTokenAccountBalance(ata, "confirmed").then((r) => BigInt(r.value.amount)).catch(() => 0n);
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
        try { return { sig: await send(new Transaction().add(...fees.instructions, ...created.instructions), kp, 250_000, CLAIM_MAX_COST), creationClaimed: true }; }
        catch (e) { if (!/would fail/.test((e as Error).message)) throw e; }
      }
      return { sig: await send(fees, kp, 200_000, CLAIM_MAX_COST), creationClaimed: false };
    },

    async extras(pools, owner) {
      const out: Extra[] = [];
      const byMint = new Map<string, string>(); // the launched token -> its curve
      for (const pool of pools) {
        const p = await client.state.getPool(pool).catch(() => null);
        if (!p) continue;
        const s = p.poolState as unknown as { baseMint: PublicKey; config: PublicKey; isMigrated: number };
        const mint = s.baseMint.toBase58();
        byMint.set(mint, pool);
        if (Number(s.isMigrated) !== 1) continue;
        // the curve after graduation: the partner's share of the surplus (once), and of a migration fee (ours is 0%)
        const surplus = await client.state.getPoolSurplus(pool).catch(() => null);
        if (surplus && !surplus.partnerWithdrawn && surplus.partner.gtn(0)) out.push({ kind: "surplus", pool, ref: pool, mint, lamports: BigInt(surplus.partner.toString()), tokens: 0n });
        const cfg = await client.state.getPoolConfig(s.config).catch(() => null) as { migrationFeePercentage?: number; creatorMigrationFeePercentage?: number; migrationQuoteThreshold?: BN } | null;
        const mig = cfg ? partnerMigrationFee(BigInt(cfg.migrationQuoteThreshold?.toString() ?? "0"), Number(cfg.migrationFeePercentage ?? 0), Number(cfg.creatorMigrationFeePercentage ?? 0)) : 0n;
        if (mig > 0n) out.push({ kind: "migration", pool, ref: pool, mint, lamports: mig, tokens: 0n });
      }
      if (!byMint.size) return out;
      // the LP positions the owner holds (DAMM v2 positions are NFTs), in DAMM v2 pools of these tokens, paired with SOL
      const nfts = await getAllPositionNftAccountByOwner(conn, new PublicKey(owner));
      if (!nfts.length) return out;
      const keys = nfts.map((n) => derivePositionAddress(n.positionNft));
      const positions = await many<PositionState>(keys, (k) => amm._program.account.position.fetchMultiple(k) as Promise<(PositionState | null)[]>);
      const poolKeys = [...new Map(positions.filter((x): x is PositionState => !!x).map((x) => [x.pool.toBase58(), x.pool])).values()];
      const states = await many<PoolState>(poolKeys, (k) => amm._program.account.pool.fetchMultiple(k) as Promise<(PoolState | null)[]>);
      const poolOf = new Map(poolKeys.map((k, i) => [k.toBase58(), states[i]]));
      positions.forEach((pos, i) => {
        const ps = pos ? poolOf.get(pos.pool.toBase58()) : null;
        if (!pos || !ps) return;
        const a = ps.tokenAMint.toBase58(), b = ps.tokenBMint.toBase58();
        const solIsB = b === WSOL, solIsA = a === WSOL;
        const mint = solIsB ? a : solIsA ? b : null;
        if (!mint || !byMint.has(mint)) return;
        const f = getUnClaimLpFee(ps, pos);
        const sol = solIsB ? f.feeTokenB : f.feeTokenA, tok = solIsB ? f.feeTokenA : f.feeTokenB;
        out.push({ kind: "position", pool: byMint.get(mint)!, ref: keys[i]!.toBase58(), mint, lamports: BigInt(sol.toString()), tokens: BigInt(tok.toString()) });
      });
      return out;
    },

    async claimExtra(kp, e) {
      if (e.kind === "surplus") return { sig: await send(await client.partner.partnerWithdrawSurplus({ feeClaimer: kp.publicKey, pool: new PublicKey(e.pool) }), kp, 200_000, CLAIM_MAX_COST), tokens: 0n };
      if (e.kind === "migration") return { sig: await send(await client.partner.partnerWithdrawMigrationFee({ pool: new PublicKey(e.pool), sender: kp.publicKey }), kp, 200_000, CLAIM_MAX_COST), tokens: 0n };
      // a locked LP position's fees: claimed by the NFT's owner, SOL unwrapped into the wallet, the token (if any) kept in its account
      const position = new PublicKey(e.ref);
      const pos = await amm.fetchPositionState(position);
      const ps = await amm.fetchPoolState(pos.pool);
      const tokenMint = new PublicKey(e.mint);
      const tokenProgram = getTokenProgram(ps.tokenAMint.equals(tokenMint) ? ps.tokenAFlag : ps.tokenBFlag);
      const tx = await amm.claimPositionFee({
        owner: kp.publicKey, feePayer: kp.publicKey, position, pool: pos.pool, positionNftAccount: derivePositionNftAccount(pos.nftMint),
        tokenAMint: ps.tokenAMint, tokenBMint: ps.tokenBMint, tokenAVault: ps.tokenAVault, tokenBVault: ps.tokenBVault,
        tokenAProgram: getTokenProgram(ps.tokenAFlag), tokenBProgram: getTokenProgram(ps.tokenBFlag),
      });
      const held = await tokenBalance(kp.publicKey, tokenMint, tokenProgram);
      const sig = await send(tx, kp, 250_000, CLAIM_MAX_COST);
      const got = (await tokenBalance(kp.publicKey, tokenMint, tokenProgram)) - held;
      return { sig, tokens: got > 0n ? got : 0n };
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
