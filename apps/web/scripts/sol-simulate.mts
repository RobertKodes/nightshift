// Every NIGHTSHIFT Solana transaction simulated on MAINNET against the live Meteora DBC program,
// without sending anything or spending anything: simulation skips signatures, so a public address
// that holds SOL stands in as the payer. Checks: our config key, a launch with a dev buy (on a live
// partner's config, since ours does not exist yet), a buy and a sell on a live pool, and the
// pools-by-config read the engine's index uses.
//   npx tsx scripts/sol-simulate.mts
import { DynamicBondingCurveClient, getCurrentPoint, SwapMode } from "@meteora-ag/dynamic-bonding-curve-sdk";
import { NATIVE_MINT } from "@solana/spl-token";
import { Connection, Keypair, LAMPORTS_PER_SOL, PublicKey, type Transaction, VersionedTransaction } from "@solana/web3.js";
import BN from "bn.js";
import { launchConfig } from "../src/launchpad/sol/params.ts";

const RPC = process.env.SOL_RPC ?? "https://solana-rpc.publicnode.com";
const DBC = new PublicKey("dbcij3LWUppWqq96dh6gJWwBifmcGfLSB5D4DuSMaqN");
const conn = new Connection(RPC, "confirmed");
const client = new DynamicBondingCurveClient(conn, "confirmed");
// a well-funded system account, only as the simulated fee payer (nothing is signed or sent)
const STAND_IN = new PublicKey(process.env.SOL_STAND_IN ?? "5tzFkiKscXHK5ZXCGbXZxdw7gTjjD1mBwuoFbhUvuAi9");

async function sim(label: string, tx: Transaction, feePayer: PublicKey) {
  const { blockhash } = await conn.getLatestBlockhash("confirmed");
  tx.recentBlockhash = blockhash; tx.feePayer = feePayer;
  const r = await conn.simulateTransaction(new VersionedTransaction(tx.compileMessage()), { sigVerify: false, replaceRecentBlockhash: true, commitment: "confirmed" });
  const ok = !r.value.err;
  const logs = r.value.logs ?? [];
  console.log(`${ok ? "PASS" : "FAIL"} ${label}: ${ok ? `${r.value.unitsConsumed} CU` : JSON.stringify(r.value.err)}`);
  if (!ok) console.log(logs.filter((l) => /error|failed|Error|panicked/i.test(l)).slice(-6).join("\n"));
  return ok;
}

const info = await conn.getAccountInfo(STAND_IN);
console.log("stand-in payer", STAND_IN.toBase58(), "holds", ((info?.lamports ?? 0) / LAMPORTS_PER_SOL).toFixed(1), "SOL, owner", info?.owner.toBase58());

// 1. our config key, exactly as the admin page builds it
const configKp = Keypair.generate();
const cfgTx = await client.partner.createConfig2({ payer: STAND_IN, config: configKp.publicKey, feeClaimer: STAND_IN, leftoverReceiver: STAND_IN, quoteMint: NATIVE_MINT, ...launchConfig() });
const results: boolean[] = [];
results.push(await sim("1 create the NIGHTSHIFT config key", cfgTx, STAND_IN));

// 2. find a live pool still on its curve: the newest DBC transactions name one (a pool account is 424 bytes)
const sigs = await conn.getSignaturesForAddress(DBC, { limit: 40 });
let livePool: PublicKey | null = null, liveConfig: PublicKey | null = null;
for (const s of sigs) {
  if (s.err || livePool) continue;
  const t = await conn.getTransaction(s.signature, { maxSupportedTransactionVersion: 0 }).catch(() => null);
  const keys = t?.transaction.message.staticAccountKeys ?? [];
  for (let i = 0; i < keys.length && !livePool; i += 10) {
    const infos = await conn.getMultipleAccountsInfo(keys.slice(i, i + 10));
    for (const [j, inf] of infos.entries()) {
      if (!inf?.owner.equals(DBC) || inf.data.length !== 424) continue;
      const p = await client.state.getPool(keys[i + j]).catch(() => null);
      if (p && !p.poolState.isMigrated) { livePool = keys[i + j]; liveConfig = p.poolState.config; break; }
    }
  }
}
console.log("live pool", livePool?.toBase58(), "config", liveConfig?.toBase58());
if (!livePool || !liveConfig) { console.log("No live pool found in the latest transactions; run again."); process.exit(2); }

// 3. a launch with a dev buy, on that live config
const mint = Keypair.generate();
const poolTx = await client.creator.createPoolWithFirstBuy({
  createPoolParam: { baseMint: mint.publicKey, config: liveConfig, name: "Night Rehearsal", symbol: "NREH", uri: "https://getnightshift.tech/api/sol/meta/rehearsal.json", payer: STAND_IN, poolCreator: STAND_IN },
  firstBuyParam: { buyer: STAND_IN, buyAmount: new BN(0.05 * LAMPORTS_PER_SOL), minimumAmountOut: new BN(1), referralTokenAccount: null },
});
results.push(await sim("2 launch a token with a dev buy", poolTx, STAND_IN));

// 4. buy and sell on the live pool, with the quote our page shows
const pool = await client.state.getPool(livePool);
const cfg = await client.state.getPoolConfig(liveConfig);
const point = await getCurrentPoint(conn, cfg.activationType);
const amountIn = new BN(0.05 * LAMPORTS_PER_SOL);
if (!pool || !cfg) throw new Error("pool or config vanished");
const q = client.pool.swapQuote2({ virtualPool: pool, config: cfg, swapBaseForQuote: false, amountIn, slippageBps: 300, hasReferral: false, eligibleForFirstSwapWithMinFee: false, currentPoint: point, swapMode: SwapMode.ExactIn });
console.log("  buy 0.05 SOL quote:", JSON.stringify(q, (k, v) => (v && v.constructor?.name === "BN" ? v.toString() : v)).slice(0, 220));
const buyTx = await client.pool.swap2({ owner: STAND_IN, pool: livePool, swapBaseForQuote: false, referralTokenAccount: null, swapMode: SwapMode.ExactIn, amountIn, minimumAmountOut: q.minimumAmountOut });
results.push(await sim("3 buy on a live curve", buyTx, STAND_IN));

// 5. the index read: every pool on a config
const t0 = Date.now();
const all = await client.state.getPoolsByConfig(liveConfig).catch((e) => { console.log("  getPoolsByConfig failed:", (e as Error).message.slice(0, 140)); return null; });
console.log(`${all ? "PASS" : "FAIL"} 4 pools-by-config read: ${all?.length ?? "-"} pools in ${Date.now() - t0} ms`);
results.push(!!all);
console.log(results.every(Boolean) ? "ALL PASS" : "SOME FAILED");
