// Read-only: what a launch's partner (the fee wallet) and creator can claim after it graduates. Sends nothing.
//   npx tsx scripts/sol-lp-check.mts [mint] [dbcPool] [rpc]
// Finds the curve (DBC pool) of the mint, the DAMM v2 pool Meteora's migration creates for it (derived from the
// config's migration fee option; the program's own address), the LP positions in it (owned by whoever holds each
// position NFT), and the fees waiting on each. Then runs the engine's own reader (liveFeePort().extras) for the
// fee wallet, the exact list the 6-hourly run would claim.
import {
  CpAmm, derivePositionNftAccount, getAllPositionNftAccountByOwner, getUnClaimLpFee, type PoolState,
} from "@meteora-ag/cp-amm-sdk";
import { DAMM_V2_MIGRATION_FEE_ADDRESS, deriveDammV2PoolAddress, DynamicBondingCurveClient } from "@meteora-ag/dynamic-bonding-curve-sdk";
import { Connection, PublicKey } from "@solana/web3.js";
import { liveFeePort } from "../src/sol-fees-live.ts";

const MINT = process.argv[2] ?? "CUFS4ggDUYH4NCGVu3ezDubwPm5vM6rFfxLXtcnr8imd"; // IMDSOL
const KNOWN_POOL = process.argv[3] ?? (MINT === "CUFS4ggDUYH4NCGVu3ezDubwPm5vM6rFfxLXtcnr8imd" ? "CbQPoSYaXP45ob9HFP9NJyqsmaCmR7PtfRChpjmiDnoo" : "");
const RPC = process.argv[4] ?? "https://api.mainnet-beta.solana.com";
const conn = new Connection(RPC, "confirmed");
const dbc = new DynamicBondingCurveClient(conn, "confirmed");
const amm = new CpAmm(conn);
const sol = (v: { toString(): string } | bigint) => `${(Number(v.toString()) / 1e9).toFixed(9)} SOL`;
const tok = (v: { toString(): string }) => (Number(v.toString()) / 1e6).toLocaleString("en-US");

// the curve
let poolKey = KNOWN_POOL;
if (!poolKey) {
  const found = await dbc.state.getPoolByBaseMint(MINT).catch(() => null);
  if (!found) throw new Error("No Meteora curve found for that mint (pass the DBC pool as the second argument).");
  poolKey = found.publicKey.toBase58();
}
const vp = await dbc.state.getPool(poolKey);
if (!vp) throw new Error(`No DBC pool at ${poolKey}`);
const s = vp.poolState as unknown as Record<string, any>;
if (s.baseMint.toBase58() !== MINT) throw new Error(`The pool ${poolKey} is not the mint's curve.`);
const cfg = await dbc.state.getPoolConfig(s.config) as unknown as Record<string, any>;
const feeWallet = cfg.feeClaimer.toBase58() as string, creator = s.creator.toBase58() as string;
const threshold = BigInt(cfg.migrationQuoteThreshold.toString()), reserve = BigInt(s.quoteReserve.toString());
console.log(`mint            ${MINT}`);
console.log(`curve (DBC)     ${poolKey}  config ${s.config.toBase58()}`);
console.log(`partner         ${feeWallet}  (feeClaimer = leftoverReceiver: ${cfg.leftoverReceiver.toBase58() === feeWallet})`);
console.log(`creator         ${creator}`);
console.log(`progress        ${sol(reserve)} of ${sol(threshold)} (${(Number(reserve * 10_000n / (threshold || 1n)) / 100).toFixed(2)}%), isMigrated=${s.isMigrated}, migrationProgress=${s.migrationProgress}`);
console.log(`graduation LP   partner locked ${cfg.partnerPermanentLockedLiquidityPercentage}% + unlocked ${cfg.partnerLiquidityPercentage}% · creator locked ${cfg.creatorPermanentLockedLiquidityPercentage}% + unlocked ${cfg.creatorLiquidityPercentage}% · migration fee ${cfg.migrationFeePercentage}% · migrationFeeOption ${cfg.migrationFeeOption}`);
console.log(`curve fees      partner ${sol(s.partnerQuoteFee)} + ${tok(s.partnerBaseFee)} tokens · creator ${sol(s.creatorQuoteFee)} + ${tok(s.creatorBaseFee)} tokens (unclaimed)`);
const surplus = await dbc.state.getPoolSurplus(poolKey).catch(() => null);
if (surplus) console.log(`surplus         partner ${sol(surplus.partner)} (withdrawn ${surplus.partnerWithdrawn}) · creator ${sol(surplus.creator)} (withdrawn ${surplus.creatorWithdrawn}) · protocol ${sol(surplus.protocol)}`);

// the DAMM v2 pool the migration creates: derived from the config's fee option, as the SDK's migrateToDammV2 does
const dammConfig = DAMM_V2_MIGRATION_FEE_ADDRESS[Number(cfg.migrationFeeOption)];
const damm = dammConfig ? deriveDammV2PoolAddress(dammConfig, s.baseMint, cfg.quoteMint) : null;
const ps: PoolState | null = damm ? await amm._program.account.pool.fetchNullable(damm) as PoolState | null : null;
console.log(`DAMM v2 pool    ${damm?.toBase58() ?? "(customizable config: not derivable)"} ${ps ? "EXISTS" : "not created yet (the curve has not graduated)"}`);
if (ps && damm) {
  console.log(`                tokenA ${ps.tokenAMint.toBase58()} tokenB ${ps.tokenBMint.toBase58()} collectFeeMode ${ps.collectFeeMode} (1 = fees in token B only)`);
  // every position in the pool, and who holds its NFT
  const all = await amm.getAllPositionsByPool(damm).catch(() => null);
  for (const p of all ?? []) {
    const nftAcct = derivePositionNftAccount(p.account.nftMint);
    const info = await conn.getParsedAccountInfo(nftAcct);
    const owner = (info.value?.data as { parsed?: { info?: { owner?: string } } })?.parsed?.info?.owner ?? "?";
    const f = getUnClaimLpFee(ps, p.account);
    const who = owner === feeWallet ? "PARTNER (fee wallet)" : owner === creator ? "CREATOR" : "other";
    console.log(`  position ${p.publicKey.toBase58()} NFT owner ${owner} [${who}] locked ${p.account.permanentLockedLiquidity.toString()} unlocked ${p.account.unlockedLiquidity.toString()} · unclaimed A ${ps.tokenAMint.toBase58() === MINT ? `${tok(f.feeTokenA)} tokens` : sol(f.feeTokenA)} · B ${ps.tokenBMint.toBase58() === MINT ? `${tok(f.feeTokenB)} tokens` : sol(f.feeTokenB)}`);
  }
  if (!all) console.log("  (this RPC refused the pool's position scan; the per-owner lookups below still work)");
}
for (const [label, owner] of [["fee wallet", feeWallet], ["creator", creator]] as const) {
  const nfts = await getAllPositionNftAccountByOwner(conn, new PublicKey(owner));
  console.log(`${label} holds ${nfts.length} Token-2022 NFT(s) with amount 1 (DAMM v2 position NFTs are Token-2022)`);
}

// what the engine's run would claim for the fee wallet right now (the live reader, read-only)
const extras = await liveFeePort(RPC).extras([poolKey], feeWallet);
console.log(`engine extras() for the fee wallet: ${extras.length ? "" : "nothing yet"}`);
for (const e of extras) console.log(`  ${e.kind.padEnd(9)} ${e.ref} ${sol(e.lamports)}${e.tokens > 0n ? ` + ${tok(e.tokens)} tokens (held, not split)` : ""}`);
const forCreator = (await liveFeePort(RPC).extras([poolKey], creator)).filter((e) => e.kind === "position");
console.log(`creator's LP positions with fees: ${forCreator.length ? "" : "none yet"}`);
for (const e of forCreator) console.log(`  position ${e.ref} ${sol(e.lamports)}${e.tokens > 0n ? ` + ${tok(e.tokens)} tokens` : ""}`);
