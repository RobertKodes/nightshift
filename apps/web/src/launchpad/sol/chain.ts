import { DynamicBondingCurveClient, getCurrentPoint, SwapMode } from "@meteora-ag/dynamic-bonding-curve-sdk";
import { getAssociatedTokenAddressSync, NATIVE_MINT } from "@solana/spl-token";
import {
  ComputeBudgetProgram, Connection, Keypair, LAMPORTS_PER_SOL, NONCE_ACCOUNT_LENGTH, PublicKey, SystemProgram, Transaction, type TransactionInstruction, VersionedTransaction,
} from "@solana/web3.js";
import BN from "bn.js";
import { checkOptions, curvePreview, LAUNCH, launchConfig, type LaunchOptions, STANDARD } from "./params";

export { curvePreview };

/**
 * Every Solana transaction of the launchpad, built here in the browser with Meteora's SDK and signed by
 * the user's own wallet. Transactions the page sends itself are simulated first: if one would fail,
 * nothing is sent. A launch is signed here and handed to NIGHTSHIFT, which adds the one signature it
 * holds (the token's address) and sends it: at once, or when the IMD swarm finishes (then it is signed
 * on a durable nonce, so it does not expire). The RPC is the NIGHTSHIFT proxy (/api/sol/rpc).
 */

export type SolSigner = {
  address: string;
  wallet: { signTransaction<T extends Transaction | VersionedTransaction>(tx: T): Promise<T>; signMessage?(m: Uint8Array): Promise<Uint8Array | { signature: Uint8Array }> };
};

const conn = new Connection(`${location.origin}/api/sol/rpc`, { commitment: "confirmed" });
const client = new DynamicBondingCurveClient(conn, "confirmed");
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const COMPUTE = ComputeBudgetProgram.programId.toBase58();

/** A priority fee from the network's recent fees, so the transaction lands when Solana is busy. */
async function priority(units: number, floor = 20_000) {
  const fees = await conn.getRecentPrioritizationFees().catch(() => []);
  const paid = fees.map((f) => f.prioritizationFee).filter((x) => x > 0).sort((a, b) => a - b);
  const median = paid.length ? paid[Math.floor(paid.length / 2)]! : 0;
  const microLamports = Math.min(2_000_000, Math.max(floor, Math.round(median * 1.2)));
  return [ComputeBudgetProgram.setComputeUnitLimit({ units }), ComputeBudgetProgram.setComputeUnitPrice({ microLamports })];
}

/** Simulate, sign (extra signers first, then the wallet), send through the proxy, follow to confirmed. */
async function sendTx(tx: Transaction, who: SolSigner, extra: Keypair[], units: number, say: (s: string) => void): Promise<string> {
  const payer = new PublicKey(who.address);
  tx.instructions = [...(await priority(units)), ...tx.instructions.filter((i) => i.programId.toBase58() !== COMPUTE)];
  const { blockhash, lastValidBlockHeight } = await conn.getLatestBlockhash("confirmed");
  tx.recentBlockhash = blockhash;
  tx.feePayer = payer;
  say("Checking the transaction on Solana…");
  const sim = await conn.simulateTransaction(new VersionedTransaction(tx.compileMessage()), { sigVerify: false, commitment: "confirmed" });
  if (sim.value.err) {
    const why = (sim.value.logs ?? []).reverse().find((l) => /Error|insufficient|failed/i.test(l)) ?? JSON.stringify(sim.value.err);
    throw new Error(`This would fail right now on Solana: ${why.replace(/^Program log: /, "").slice(0, 160)}. Nothing was sent.`);
  }
  if (extra.length) tx.partialSign(...extra);
  say("Confirm in your Solana wallet…");
  const signed = await who.wallet.signTransaction(tx);
  const raw = signed.serialize();
  say("Sending…");
  const sig = await conn.sendRawTransaction(raw, { skipPreflight: true, maxRetries: 0 });
  // resend every few seconds until confirmed or the blockhash expires: how Solana transactions land reliably
  for (let i = 0; i < 40; i++) {
    const s = (await conn.getSignatureStatuses([sig])).value[0];
    if (s?.err) throw new Error("The transaction failed on Solana. Only the network fee was spent.");
    if (s?.confirmationStatus === "confirmed" || s?.confirmationStatus === "finalized") return sig;
    if ((await conn.getBlockHeight("confirmed")) > lastValidBlockHeight) throw new Error("Solana did not take the transaction in time. Nothing was spent; try again.");
    if (i % 2 === 1) await conn.sendRawTransaction(raw, { skipPreflight: true, maxRetries: 0 }).catch(() => {});
    say(i < 6 ? "Waiting for Solana…" : "Still waiting for Solana (busy network)…");
    await sleep(2000);
  }
  return sig;
}

/** The admin: the shared NIGHTSHIFT config key (the standard launch), owned by the partner wallet that signs it. */
export async function createConfig(who: SolSigner, solUsd: number, say: (s: string) => void): Promise<{ config: string; signature: string }> {
  const config = Keypair.generate();
  const me = new PublicKey(who.address);
  const tx = await client.partner.createConfig2({ payer: me, config: config.publicKey, feeClaimer: me, leftoverReceiver: me, quoteMint: NATIVE_MINT, ...launchConfig(STANDARD, solUsd) });
  const signature = await sendTx(tx, who, [config], 200_000, say);
  return { config: config.publicKey.toBase58(), signature };
}

const nonceIxs = async (me: PublicKey, nonce: Keypair): Promise<TransactionInstruction[]> =>
  SystemProgram.createNonceAccount({ fromPubkey: me, noncePubkey: nonce.publicKey, authorizedPubkey: me, lamports: await conn.getMinimumBalanceForRentExemption(NONCE_ACCOUNT_LENGTH) }).instructions;

/**
 * Before the launch is signed, what it needs on Solana: its own Meteora config (unless the standard
 * shared one is used), with NIGHTSHIFT as partner, and, for a launch that waits for the swarm, a
 * durable nonce account the creator owns. In one transaction when they fit, else two.
 */
export async function prepareChain(o: { who: SolSigner; partner: string; shared: string | null; standard: boolean; options: LaunchOptions; solUsd: number; nonce: boolean; say: (s: string) => void }): Promise<{ config: string; nonce: string | null }> {
  const problem = checkOptions(o.options, o.solUsd);
  if (problem) throw new Error(problem);
  const me = new PublicKey(o.who.address);
  const nonce = o.nonce ? Keypair.generate() : null;
  const useShared = !!o.shared && o.standard;
  if (useShared && !nonce) return { config: o.shared!, nonce: null };
  if (useShared) {
    await sendTx(new Transaction().add(...await nonceIxs(me, nonce!)), o.who, [nonce!], 50_000, (s) => o.say(`Your launch's nonce account: ${s}`));
    return { config: o.shared!, nonce: nonce!.publicKey.toBase58() };
  }
  const config = Keypair.generate();
  const partner = new PublicKey(o.partner);
  const cfgTx = await client.partner.createConfig2({ payer: me, config: config.publicKey, feeClaimer: partner, leftoverReceiver: partner, quoteMint: NATIVE_MINT, ...launchConfig(o.options, o.solUsd) });
  if (nonce) {
    const both = new Transaction().add(...cfgTx.instructions, ...await nonceIxs(me, nonce));
    both.feePayer = me;
    both.recentBlockhash = PublicKey.default.toBase58();
    // three signatures and two compute budget steps on top of the message: Solana's limit is 1232 bytes
    if (both.compileMessage().serialize().length + 1 + 3 * 64 + 40 <= 1232) {
      await sendTx(both, o.who, [config, nonce], 250_000, (s) => o.say(`Your launch's Meteora settings: ${s}`));
      return { config: config.publicKey.toBase58(), nonce: nonce.publicKey.toBase58() };
    }
  }
  await sendTx(cfgTx, o.who, [config], 250_000, (s) => o.say(`Your launch's Meteora settings: ${s}`));
  if (nonce) await sendTx(new Transaction().add(...await nonceIxs(me, nonce)), o.who, [nonce], 50_000, (s) => o.say(`Your launch's nonce account: ${s}`));
  return { config: config.publicKey.toBase58(), nonce: nonce?.publicKey.toBase58() ?? null };
}

/**
 * The launch itself, with the creator's optional first buy in the same transaction (atomic with the
 * creation, so nobody can buy before it; it pays the normal fee, not the sniper fee). Signed here by
 * the creator only; NIGHTSHIFT adds the token address's signature. Returned as base64.
 */
export async function signLaunch(o: { who: SolSigner; config: string; mint: string; name: string; symbol: string; uri: string; devBuySol: number; nonce: string | null; say: (s: string) => void }): Promise<string> {
  const me = new PublicKey(o.who.address);
  const buy = Math.min(Math.max(0, o.devBuySol), LAUNCH.devBuyMaxSol);
  const createPoolParam = { baseMint: new PublicKey(o.mint), config: new PublicKey(o.config), name: o.name, symbol: o.symbol, uri: o.uri, payer: me, poolCreator: me };
  o.say("Building the launch…");
  const built = buy > 0
    ? await client.creator.createPoolWithFirstBuy({ createPoolParam, firstBuyParam: { buyer: me, buyAmount: new BN(Math.round(buy * LAMPORTS_PER_SOL)), minimumAmountOut: new BN(1), referralTokenAccount: null } })
    : await client.creator.createPool(createPoolParam);
  const tx = new Transaction();
  // a waiting launch starts with its nonce: it stays valid until NIGHTSHIFT sends it
  if (o.nonce) tx.add(SystemProgram.nonceAdvance({ noncePubkey: new PublicKey(o.nonce), authorizedPubkey: me }));
  tx.add(...await priority(450_000, o.nonce ? 100_000 : 20_000), ...built.instructions.filter((i) => i.programId.toBase58() !== COMPUTE));
  tx.feePayer = me;
  if (o.nonce) {
    const n = await conn.getNonce(new PublicKey(o.nonce), "confirmed");
    if (!n) throw new Error("The nonce account is not on Solana yet. Wait a moment and try again.");
    tx.recentBlockhash = n.nonce;
  } else tx.recentBlockhash = (await conn.getLatestBlockhash("confirmed")).blockhash;
  o.say(o.nonce ? "Sign the launch in your Solana wallet: it is sent when the swarm finishes…" : "Confirm the launch in your Solana wallet…");
  const signed = await o.who.wallet.signTransaction(tx);
  return Buffer.from(signed.serialize({ requireAllSignatures: false, verifySignatures: false })).toString("base64");
}

/** The nonce account's rent back to the creator (after the launch, or if it never happens). */
export async function closeNonce(who: SolSigner, nonce: string, say: (s: string) => void): Promise<string> {
  const me = new PublicKey(who.address), n = new PublicKey(nonce);
  const lamports = await conn.getBalance(n);
  if (!lamports) throw new Error("That nonce account is already closed.");
  return sendTx(new Transaction().add(SystemProgram.nonceWithdraw({ noncePubkey: n, authorizedPubkey: me, toPubkey: me, lamports })), who, [], 50_000, say);
}

/** The creator's wallet signing a short text (launch without the swarm, cancel), base64. */
export async function signText(who: SolSigner, text: string): Promise<string> {
  if (!who.wallet.signMessage) throw new Error("This wallet cannot sign a message. Use Phantom, Solflare or Backpack.");
  const r = await who.wallet.signMessage(new TextEncoder().encode(text));
  const sig = r instanceof Uint8Array ? r : r.signature;
  return Buffer.from(sig).toString("base64");
}

/** NIGHTSHIFT's unclaimed trading fees in each launch's pool (the partner's share, collected in SOL). */
export async function partnerFees(pools: string[]): Promise<{ pool: string; sol: number; tokens: number }[]> {
  const out: { pool: string; sol: number; tokens: number }[] = [];
  for (const pool of pools) {
    const p = await client.state.getPool(pool).catch(() => null);
    if (!p) continue;
    const s = p.poolState as unknown as { partnerQuoteFee: BN; partnerBaseFee: BN };
    out.push({ pool, sol: Number(s.partnerQuoteFee.toString()) / LAMPORTS_PER_SOL, tokens: Number(s.partnerBaseFee.toString()) / 10 ** LAUNCH.decimals });
  }
  return out;
}

/**
 * The partner wallet claims NIGHTSHIFT's share from each pool: its trading fees and, once, the pool's
 * launch fee. One transaction per pool, simulated first; a pool with nothing left to claim is skipped.
 */
export async function claimPartnerFees(who: SolSigner, pools: string[], say: (s: string) => void): Promise<number> {
  const me = new PublicKey(who.address);
  let sent = 0;
  for (const [i, pool] of pools.entries()) {
    const p = new PublicKey(pool);
    const fees = await client.partner.claimPartnerTradingFee({ feeClaimer: me, payer: me, pool: p, maxBaseAmount: new BN("18446744073709551615"), maxQuoteAmount: new BN("18446744073709551615") });
    const creation = await client.partner.claimPartnerPoolCreationFee({ pool: p, feeReceiver: me }).catch(() => null);
    const tries = creation ? [new Transaction().add(...fees.instructions, ...creation.instructions), fees, creation] : [fees];
    for (const tx of tries) {
      try { await sendTx(tx, who, [], 200_000, (s) => say(`Pool ${i + 1} of ${pools.length}: ${s}`)); sent++; break; }
      catch (e) { if (!/would fail/.test((e as Error).message)) throw e; }
    }
  }
  return sent;
}

export type Quote = { out: bigint; min: bigint; fee: bigint; feePct: number };

/** What a buy (SOL in) or a sell (tokens in) returns right now, with the slippage floor. */
export async function quote(pool: string, buy: boolean, amountIn: bigint, slippageBps: number): Promise<Quote> {
  const vp = await client.state.getPool(pool);
  if (!vp) throw new Error("The pool could not be read.");
  const cfg = await client.state.getPoolConfig(vp.poolState.config);
  if (!cfg) throw new Error("The pool's config could not be read.");
  const currentPoint = await getCurrentPoint(conn, cfg.activationType);
  const q = client.pool.swapQuote2({ virtualPool: vp, config: cfg, swapBaseForQuote: !buy, amountIn: new BN(amountIn.toString()), slippageBps, hasReferral: false, eligibleForFirstSwapWithMinFee: false, currentPoint, swapMode: SwapMode.ExactIn });
  // the whole fee, in SOL (the config collects fees in the quote token): the creator's, NIGHTSHIFT's and Meteora's parts
  // the fields come from the program's IDL (swapResult2); the SDK's types do not carry them through
  const r = q as unknown as { tradingFee: BN; protocolFee: BN; outputAmount: BN; minimumAmountOut: BN };
  const fee = BigInt(r.tradingFee.toString()) + BigInt(r.protocolFee.toString());
  const out = BigInt(r.outputAmount.toString());
  const gross = buy ? amountIn : out + fee;
  return { out, min: BigInt(r.minimumAmountOut.toString()), fee, feePct: gross > 0n ? Number((fee * 10_000n) / gross) / 100 : 0 };
}

/** A buy or a sell on the curve, with the quoted floor as the minimum out. */
export async function trade(o: { who: SolSigner; pool: string; buy: boolean; amountIn: bigint; slippageBps: number; say: (s: string) => void }): Promise<string> {
  const q = await quote(o.pool, o.buy, o.amountIn, o.slippageBps);
  if (q.out <= 0n) throw new Error("That amount buys nothing at this price.");
  const tx = await client.pool.swap2({ owner: new PublicKey(o.who.address), pool: new PublicKey(o.pool), swapBaseForQuote: !o.buy, referralTokenAccount: null, swapMode: SwapMode.ExactIn, amountIn: new BN(o.amountIn.toString()), minimumAmountOut: new BN(q.min.toString()) });
  return sendTx(tx, o.who, [], 250_000, o.say);
}

/** The wallet's SOL and token balances, in whole units. */
export async function balances(owner: string, mint: string): Promise<{ sol: number; token: number }> {
  const me = new PublicKey(owner);
  const sol = (await conn.getBalance(me)) / LAMPORTS_PER_SOL;
  const ata = getAssociatedTokenAddressSync(new PublicKey(mint), me);
  const token = await conn.getTokenAccountBalance(ata).then((r) => Number(r.value.uiAmount ?? 0)).catch(() => 0);
  return { sol, token };
}
