// The launch that waits for the IMD swarm, rehearsed on MAINNET without sending or spending anything.
// It builds the exact transaction the page signs (a durable nonce first, then the priority fee, then
// Meteora's pool creation with the creator's first buy), runs the engine's own check on it, and
// simulates the same launch without the nonce (simulation skips signatures, so a funded public
// address stands in as the payer). It also measures whether a creator's own config and the nonce
// account fit in one transaction.
//   npx tsx scripts/sol-simulate-held.mts
import { DynamicBondingCurveClient } from "@meteora-ag/dynamic-bonding-curve-sdk";
import { NATIVE_MINT } from "@solana/spl-token";
import { ComputeBudgetProgram, Connection, Keypair, LAMPORTS_PER_SOL, NONCE_ACCOUNT_LENGTH, PublicKey, SystemProgram, Transaction, VersionedTransaction } from "@solana/web3.js";
import BN from "bn.js";
import { launchTxProblem, readTx } from "../../engine/src/sol-tx.ts";
import { launchConfig, STANDARD } from "../src/launchpad/sol/params.ts";

const RPC = process.env.SOL_RPC ?? "https://solana-rpc.publicnode.com";
const DBC = new PublicKey("dbcij3LWUppWqq96dh6gJWwBifmcGfLSB5D4DuSMaqN");
const conn = new Connection(RPC, "confirmed");
const client = new DynamicBondingCurveClient(conn, "confirmed");
const STAND_IN = new PublicKey(process.env.SOL_STAND_IN ?? "5tzFkiKscXHK5ZXCGbXZxdw7gTjjD1mBwuoFbhUvuAi9");
const COMPUTE = ComputeBudgetProgram.programId.toBase58();
const results: boolean[] = [];
const say = (ok: boolean, label: string, more = "") => { results.push(ok); console.log(`${ok ? "PASS" : "FAIL"} ${label}${more ? `: ${more}` : ""}`); };

// a live config still taking launches: the newest DBC transactions name a pool on one
const sigs = await conn.getSignaturesForAddress(DBC, { limit: 40 });
let liveConfig: PublicKey | null = null;
for (const s of sigs) {
  if (s.err || liveConfig) continue;
  const t = await conn.getTransaction(s.signature, { maxSupportedTransactionVersion: 0 }).catch(() => null);
  const keys = t?.transaction.message.staticAccountKeys ?? [];
  for (let i = 0; i < keys.length && !liveConfig; i += 10) {
    const infos = await conn.getMultipleAccountsInfo(keys.slice(i, i + 10));
    for (const [j, inf] of infos.entries()) {
      if (!inf?.owner.equals(DBC) || inf.data.length !== 424) continue;
      const p = await client.state.getPool(keys[i + j]).catch(() => null);
      if (p && !p.poolState.isMigrated) { liveConfig = p.poolState.config; break; }
    }
  }
}
if (!liveConfig) { console.log("No live config found in the latest transactions; run again."); process.exit(2); }
console.log("live config", liveConfig.toBase58());

/** The launch exactly as chain.ts signLaunch builds it. */
async function build(creator: PublicKey, mint: PublicKey, nonce: PublicKey | null) {
  const built = await client.creator.createPoolWithFirstBuy({
    createPoolParam: { baseMint: mint, config: liveConfig!, name: "Night Rehearsal", symbol: "NREH", uri: "https://getnightshift.tech/api/sol/meta/rehearsal.json", payer: creator, poolCreator: creator },
    firstBuyParam: { buyer: creator, buyAmount: new BN(0.05 * LAMPORTS_PER_SOL), minimumAmountOut: new BN(1), referralTokenAccount: null },
  });
  const tx = new Transaction();
  if (nonce) tx.add(SystemProgram.nonceAdvance({ noncePubkey: nonce, authorizedPubkey: creator }));
  tx.add(ComputeBudgetProgram.setComputeUnitLimit({ units: 450_000 }), ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 100_000 }), ...built.instructions.filter((i) => i.programId.toBase58() !== COMPUTE));
  tx.feePayer = creator;
  return tx;
}

// 1. the waiting launch: signed by the creator on a nonce, then the engine's check of exactly that
const creator = Keypair.generate(), mint = Keypair.generate(), nonce = Keypair.generate();
const nonceValue = Keypair.generate().publicKey.toBase58(); // any 32-byte value stands in for the nonce's
const held = await build(creator.publicKey, mint.publicKey, nonce.publicKey);
held.recentBlockhash = nonceValue;
held.partialSign(creator);
const b64 = held.serialize({ requireAllSignatures: false, verifySignatures: false }).toString("base64");
const programs = [...new Set(held.instructions.map((i) => i.programId.toBase58()))];
console.log("  programs in the launch:", programs.join(", "), `· ${Buffer.from(b64, "base64").length} bytes`);
const problem = launchTxProblem(readTx(b64), { creator: creator.publicKey.toBase58(), mint: mint.publicKey.toBase58(), config: liveConfig.toBase58(), nonce: { account: nonce.publicKey.toBase58(), value: nonceValue } });
say(problem === null, "1 the engine accepts the real signed launch, on its nonce", problem ?? "");
// and refuses it once anything is added after signing
const tampered = readTx(b64);
tampered.add(SystemProgram.transfer({ fromPubkey: creator.publicKey, toPubkey: Keypair.generate().publicKey, lamports: 1 }));
say(launchTxProblem(tampered, { creator: creator.publicKey.toBase58(), mint: mint.publicKey.toBase58(), config: liveConfig.toBase58(), nonce: { account: nonce.publicKey.toBase58(), value: nonceValue } }) !== null, "2 the engine refuses it when changed after signing");

// 2. the same launch simulated on mainnet (no nonce: the stand-in payer owns none)
const live = await build(STAND_IN, Keypair.generate().publicKey, null);
live.recentBlockhash = (await conn.getLatestBlockhash("confirmed")).blockhash;
const r = await conn.simulateTransaction(new VersionedTransaction(live.compileMessage()), { sigVerify: false, replaceRecentBlockhash: true, commitment: "confirmed" });
say(!r.value.err, "3 the launch with a first buy runs on mainnet", r.value.err ? JSON.stringify(r.value.err) + " " + (r.value.logs ?? []).filter((l) => /rror|fail/i.test(l)).slice(-3).join(" | ") : `${r.value.unitsConsumed} CU`);

// 3. a creator's own config (70% locked) with the nonce account: one transaction or two
const cfgKp = Keypair.generate();
const cfgTx = await client.partner.createConfig2({ payer: STAND_IN, config: cfgKp.publicKey, feeClaimer: STAND_IN, leftoverReceiver: STAND_IN, quoteMint: NATIVE_MINT, ...launchConfig({ ...STANDARD, dev: { pct: 70, cliffDays: 180, vestDays: 365 } }, 150) });
const both = new Transaction().add(...cfgTx.instructions, ...SystemProgram.createNonceAccount({ fromPubkey: STAND_IN, noncePubkey: nonce.publicKey, authorizedPubkey: STAND_IN, lamports: await conn.getMinimumBalanceForRentExemption(NONCE_ACCOUNT_LENGTH) }).instructions);
both.feePayer = STAND_IN;
both.recentBlockhash = (await conn.getLatestBlockhash("confirmed")).blockhash;
const size = both.compileMessage().serialize().length + 1 + 3 * 64 + 40;
console.log(`  config + nonce account: ~${size} of 1232 bytes → ${size <= 1232 ? "one transaction" : "two transactions"}`);
const rc = await conn.simulateTransaction(new VersionedTransaction(both.compileMessage()), { sigVerify: false, replaceRecentBlockhash: true, commitment: "confirmed" });
say(!rc.value.err, "4 the creator's own config with the nonce account runs on mainnet", rc.value.err ? JSON.stringify(rc.value.err) + " " + (rc.value.logs ?? []).filter((l) => /rror|fail/i.test(l)).slice(-3).join(" | ") : `${rc.value.unitsConsumed} CU`);
console.log(results.every(Boolean) ? "ALL PASS" : "SOME FAILED");
