import { DynamicBondingCurveClient, getCurrentPoint, SwapMode } from "@meteora-ag/dynamic-bonding-curve-sdk";
import { getAssociatedTokenAddressSync, NATIVE_MINT } from "@solana/spl-token";
import { ComputeBudgetProgram, Connection, Keypair, LAMPORTS_PER_SOL, PublicKey, SystemProgram, type Transaction, VersionedTransaction } from "@solana/web3.js";
import BN from "bn.js";
import { checkOptions, isStandard, LAUNCH, launchConfig, type LaunchOptions, STANDARD } from "./params";

/**
 * Every Solana transaction of the launchpad, built here in the browser with Meteora's SDK and signed by
 * the user's own wallet. Each one is simulated first: if it would fail, nothing is sent. The RPC is the
 * NIGHTSHIFT proxy (/api/sol/rpc), which forwards reads and sendTransaction only. Loaded only on the
 * Solana launchpad pages (net.ts sets up Buffer first).
 */

export type SolSigner = { address: string; wallet: { signTransaction<T extends Transaction | VersionedTransaction>(tx: T): Promise<T> } };

const conn = new Connection(`${location.origin}/api/sol/rpc`, { commitment: "confirmed" });
const client = new DynamicBondingCurveClient(conn, "confirmed");
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** A priority fee from the network's recent fees, so the transaction lands when Solana is busy. */
async function priority(units: number) {
  const fees = await conn.getRecentPrioritizationFees().catch(() => []);
  const paid = fees.map((f) => f.prioritizationFee).filter((x) => x > 0).sort((a, b) => a - b);
  const median = paid.length ? paid[Math.floor(paid.length / 2)]! : 0;
  const microLamports = Math.min(2_000_000, Math.max(20_000, Math.round(median * 1.2)));
  return [ComputeBudgetProgram.setComputeUnitLimit({ units }), ComputeBudgetProgram.setComputeUnitPrice({ microLamports })];
}

/** Simulate, sign (extra signers first, then the wallet), send through the proxy, follow to confirmed. */
async function sendTx(tx: Transaction, who: SolSigner, extra: Keypair[], units: number, say: (s: string) => void): Promise<string> {
  const payer = new PublicKey(who.address);
  tx.instructions = [...(await priority(units)), ...tx.instructions];
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

/** The admin: the shared NIGHTSHIFT config key (the standard launch, one signature for creators), owned by the partner wallet that signs it. */
export async function createConfig(who: SolSigner, solUsd: number, say: (s: string) => void): Promise<{ config: string; signature: string }> {
  const config = Keypair.generate();
  const me = new PublicKey(who.address);
  const tx = await client.partner.createConfig2({ payer: me, config: config.publicKey, feeClaimer: me, leftoverReceiver: me, quoteMint: NATIVE_MINT, ...launchConfig(STANDARD, solUsd) });
  const signature = await sendTx(tx, who, [config], 200_000, say);
  return { config: config.publicKey.toBase58(), signature };
}

/** A new mint address for a launch: the page shows it and saves the details under it before signing. */
export function newMint(): Keypair { return Keypair.generate(); }

/**
 * A launch, with the creator's optional first buy in the same transaction (atomic with the creation,
 * so nobody can buy before it; it pays the normal fee, not the sniper fee). The standard settings use
 * the shared NIGHTSHIFT config (one signature); any other settings create the launch's own Meteora
 * config first, with NIGHTSHIFT as its partner (two signatures). The IMD swarm website, when chosen,
 * is paid to the partner wallet inside the launch transaction itself.
 */
export async function launch(o: {
  who: SolSigner; partner: string; shared: string | null; options: LaunchOptions; solUsd: number;
  mint: Keypair; name: string; symbol: string; uri: string; devBuySol: number; kitLamports: bigint | null; say: (s: string) => void;
}): Promise<{ signature: string; config: string }> {
  const problem = checkOptions(o.options, o.solUsd);
  if (problem) throw new Error(problem);
  const me = new PublicKey(o.who.address);
  const buy = Math.min(Math.max(0, o.devBuySol), LAUNCH.devBuyMaxSol);
  const firstBuyParam = buy > 0 ? { buyer: me, buyAmount: new BN(Math.round(buy * LAMPORTS_PER_SOL)), minimumAmountOut: new BN(1), referralTokenAccount: null } : undefined;
  const kit = o.kitLamports && o.kitLamports > 0n ? SystemProgram.transfer({ fromPubkey: me, toPubkey: new PublicKey(o.partner), lamports: o.kitLamports }) : null;
  if (o.shared && isStandard(o.options)) {
    const createPoolParam = { baseMint: o.mint.publicKey, config: new PublicKey(o.shared), name: o.name, symbol: o.symbol, uri: o.uri, payer: me, poolCreator: me };
    const tx = firstBuyParam ? await client.creator.createPoolWithFirstBuy({ createPoolParam, firstBuyParam }) : await client.creator.createPool(createPoolParam);
    if (kit) tx.add(kit);
    return { signature: await sendTx(tx, o.who, [o.mint], 450_000, o.say), config: o.shared };
  }
  const config = Keypair.generate();
  const partner = new PublicKey(o.partner);
  const { createConfigTx, createPoolWithFirstBuyTx } = await client.partner.createConfigAndPoolWithFirstBuy({
    payer: me, config: config.publicKey, feeClaimer: partner, leftoverReceiver: partner, quoteMint: NATIVE_MINT, ...launchConfig(o.options, o.solUsd),
    preCreatePoolParam: { baseMint: o.mint.publicKey, name: o.name, symbol: o.symbol, uri: o.uri, poolCreator: me },
    firstBuyParam,
  });
  await sendTx(createConfigTx, o.who, [config], 250_000, (s) => o.say(`Step 1 of 2, your launch's Meteora settings: ${s}`));
  if (kit) createPoolWithFirstBuyTx.add(kit);
  const signature = await sendTx(createPoolWithFirstBuyTx, o.who, [o.mint], 450_000, (s) => o.say(`Step 2 of 2, the token and its curve: ${s}`));
  return { signature, config: config.publicKey.toBase58() };
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
