// A full NIGHTSHIFT Solana launch rehearsed on devnet (free test SOL, the same Meteora DBC program):
// create the config key, launch a token with a dev buy, buy and sell on the curve, find it by config.
// The throwaway devnet keypair lives in the OS temp folder, never in the repository.
//   npx tsx scripts/sol-devnet.mts
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DynamicBondingCurveClient, getCurrentPoint, SwapMode } from "@meteora-ag/dynamic-bonding-curve-sdk";
import { Connection, Keypair, LAMPORTS_PER_SOL, sendAndConfirmTransaction, type Transaction } from "@solana/web3.js";
import { NATIVE_MINT } from "@solana/spl-token";
import BN from "bn.js";
import { launchConfig, LAUNCH } from "../src/launchpad/sol/params.ts";

const RPC = process.env.SOL_DEVNET_RPC ?? "https://api.devnet.solana.com";
const conn = new Connection(RPC, "confirmed");
const client = new DynamicBondingCurveClient(conn, "confirmed");
const keyFile = join(tmpdir(), "nightshift-devnet-launch.json");
const me = existsSync(keyFile) ? Keypair.fromSecretKey(Uint8Array.from(JSON.parse(readFileSync(keyFile, "utf8")))) : Keypair.generate();
if (!existsSync(keyFile)) writeFileSync(keyFile, JSON.stringify(Array.from(me.secretKey)));
const sol = (l: number | bigint) => (Number(l) / LAMPORTS_PER_SOL).toFixed(4);
const send = (tx: Transaction, extra: Keypair[] = []) => sendAndConfirmTransaction(conn, tx, [me, ...extra], { commitment: "confirmed" });

console.log("wallet", me.publicKey.toBase58());
let bal = await conn.getBalance(me.publicKey);
if (bal < 0.6 * LAMPORTS_PER_SOL) {
  try { const s = await conn.requestAirdrop(me.publicKey, 2 * LAMPORTS_PER_SOL); await conn.confirmTransaction(s, "confirmed"); }
  catch (e) { console.log("airdrop refused:", (e as Error).message.slice(0, 160)); }
  bal = await conn.getBalance(me.publicKey);
}
console.log("balance", sol(bal), "SOL");
if (bal < 0.3 * LAMPORTS_PER_SOL) { console.log("Not enough devnet SOL. Fund", me.publicKey.toBase58(), "at faucet.solana.com and run again."); process.exit(2); }

// 1. the partner config key (NIGHTSHIFT's, here owned by the throwaway wallet)
const configKp = Keypair.generate();
const cfgTx = await client.partner.createConfig2({ payer: me.publicKey, config: configKp.publicKey, feeClaimer: me.publicKey, leftoverReceiver: me.publicKey, quoteMint: NATIVE_MINT, ...launchConfig() });
console.log("1 config", configKp.publicKey.toBase58(), await send(cfgTx, [configKp]));

// 2. a launch with the creator's first buy in the same transaction (pays the 1% fee, not the sniper fee)
const mint = Keypair.generate();
const devBuy = new BN(0.05 * LAMPORTS_PER_SOL);
const poolTx = await client.creator.createPoolWithFirstBuy({
  createPoolParam: { baseMint: mint.publicKey, config: configKp.publicKey, name: "Night Rehearsal", symbol: "NREH", uri: "https://getnightshift.tech/api/sol/meta/rehearsal.json", payer: me.publicKey, poolCreator: me.publicKey },
  firstBuyParam: { buyer: me.publicKey, buyAmount: devBuy, minimumAmountOut: new BN(1), referralTokenAccount: null },
});
console.log("2 launch", mint.publicKey.toBase58(), await send(poolTx, [mint]));

const pool = await client.state.getPoolByBaseMint(mint.publicKey);
if (!pool) throw new Error("pool not found after launch");
const cfg = await client.state.getPoolConfig(configKp.publicKey);
console.log("  pool", pool.publicKey.toBase58(), "quote reserve", sol(pool.account.quoteReserve.toString()), "SOL; graduates at", sol(cfg.migrationQuoteThreshold.toString()), "SOL");

// 3. a buy inside the anti-sniper window: the quote shows the high fee
const point = await getCurrentPoint(conn, cfg.activationType);
const amountIn = new BN(0.1 * LAMPORTS_PER_SOL);
const q = client.pool.swapQuote2({ virtualPool: pool.account, config: cfg, swapBaseForQuote: false, amountIn, slippageBps: 500, hasReferral: false, currentPoint: point, swapMode: SwapMode.ExactIn });
console.log("3 buy quote: out", q.outputAmount?.toString?.(), "fee", q.tradingFee?.toString?.() ?? JSON.stringify(q).slice(0, 160));
const buyTx = await client.pool.swap2({ owner: me.publicKey, pool: pool.publicKey, swapBaseForQuote: false, referralTokenAccount: null, swapMode: SwapMode.ExactIn, amountIn, minimumAmountOut: q.minimumAmountOut });
console.log("  bought", await send(buyTx));

// 4. sell half of what the wallet holds
const after = await client.state.getPool(pool.publicKey);
const { getAssociatedTokenAddressSync } = await import("@solana/spl-token");
const ata = getAssociatedTokenAddressSync(mint.publicKey, me.publicKey);
const held = new BN((await conn.getTokenAccountBalance(ata)).value.amount);
const sellIn = held.divn(2);
const q2 = client.pool.swapQuote2({ virtualPool: after, config: cfg, swapBaseForQuote: true, amountIn: sellIn, slippageBps: 500, hasReferral: false, currentPoint: await getCurrentPoint(conn, cfg.activationType), swapMode: SwapMode.ExactIn });
const sellTx = await client.pool.swap2({ owner: me.publicKey, pool: pool.publicKey, swapBaseForQuote: true, referralTokenAccount: null, swapMode: SwapMode.ExactIn, amountIn: sellIn, minimumAmountOut: q2.minimumAmountOut });
console.log("4 sold half", (Number(sellIn.toString()) / 10 ** LAUNCH.decimals).toFixed(0), "tokens", await send(sellTx));

// 5. the index: every pool on the NIGHTSHIFT config
const pools = await client.state.getPoolsByConfig(configKp.publicKey);
const progress = await client.state.getPoolQuoteTokenCurveProgress(pool.publicKey);
console.log("5 pools on config", pools.length, "curve progress", (progress * 100).toFixed(2) + "%");
console.log("OK", JSON.stringify({ config: configKp.publicKey.toBase58(), mint: mint.publicKey.toBase58(), pool: pool.publicKey.toBase58() }));
