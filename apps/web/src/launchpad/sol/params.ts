import {
  ActivationType, BaseFeeMode, type BaseFeeParams, buildCurveWithMarketCap, CollectFeeMode, type ConfigParameters, MigrationFeeOption, MigrationOption,
  TokenAuthorityOption, TokenDecimal, TokenType,
} from "@meteora-ag/dynamic-bonding-curve-sdk";
import { CREATOR_FEE_SHARE, LAUNCH, type LaunchOptions, optionProblem, SNIPER, STANDARD } from "./options";

export * from "./options";

/**
 * A launch's Meteora Dynamic Bonding Curve config, from the creator's choice (options.ts).
 *
 * What never changes, whatever the creator picks (the guarantees the page promises):
 * - an SPL token, 6 decimals, 1,000,000,000 supply, mint and metadata frozen at creation;
 * - graduation into a Meteora DAMM v2 pool with 100% of its LP locked forever (half creator, half NIGHTSHIFT);
 * - NIGHTSHIFT as the launch partner (fees and the curve's leftover), paying the IMD swarm's review of every launch.
 * The market caps are picked in US dollars and converted to SOL at today's price.
 */

/** The page's range checks plus the curve's own: Meteora's keeper only graduates pools that raise at least 10 SOL. */
export function checkOptions(o: LaunchOptions, solUsd: number): string | null {
  const p = optionProblem(o);
  if (p) return p;
  if (!(solUsd > 1 && solUsd < 100_000)) return "The SOL price is not available right now.";
  if (Number(launchConfig(o, solUsd).migrationQuoteThreshold.toString()) / 1e9 < 10) return "At today's SOL price this range raises too little to graduate.";
  return null;
}

export function launchConfig(o: LaunchOptions = STANDARD, solUsd = 100): ConfigParameters {
  const s = SNIPER[o.sniper];
  const fee: BaseFeeParams = s.startBps > o.feeBps
    ? { baseFeeMode: BaseFeeMode.FeeSchedulerExponential, feeSchedulerParam: { startingFeeBps: s.startBps, endingFeeBps: o.feeBps, numberOfPeriod: s.periods, totalDuration: s.seconds } }
    : { baseFeeMode: BaseFeeMode.FeeSchedulerLinear, feeSchedulerParam: { startingFeeBps: o.feeBps, endingFeeBps: o.feeBps, numberOfPeriod: 0, totalDuration: 0 } };
  return buildCurveWithMarketCap({
    token: { tokenType: TokenType.SPLToken, tokenBaseDecimal: TokenDecimal.SIX, tokenQuoteDecimal: 9, tokenAuthorityOption: TokenAuthorityOption.Immutable, totalTokenSupply: LAUNCH.supply, leftover: 0 },
    fee: {
      baseFeeParams: fee,
      dynamicFeeEnabled: true,
      collectFeeMode: CollectFeeMode.QuoteToken,
      creatorTradingFeePercentage: CREATOR_FEE_SHARE,
      poolCreationFee: LAUNCH.createFeeSol,
      // the creator's own first buy, in the launch transaction itself, pays the normal fee, not the sniper fee
      enableFirstSwapWithMinFee: true,
    },
    migration: { migrationOption: MigrationOption.MET_DAMM_V2, migrationFeeOption: o.feeBps === 200 ? MigrationFeeOption.FixedBps200 : MigrationFeeOption.FixedBps100, migrationFee: { feePercentage: 0, creatorFeePercentage: 0 } },
    liquidityDistribution: { partnerLiquidityPercentage: 0, partnerPermanentLockedLiquidityPercentage: 50, creatorLiquidityPercentage: 0, creatorPermanentLockedLiquidityPercentage: 50 },
    // the creator's allocation: locked until graduation, then the cliff, then released daily over the vesting days
    lockedVesting: o.dev.pct > 0
      ? { totalLockedVestingAmount: (LAUNCH.supply * o.dev.pct) / 100, numberOfVestingPeriod: o.dev.vestDays, cliffUnlockAmount: 0, totalVestingDuration: o.dev.vestDays * 86_400, cliffDurationFromMigrationTime: o.dev.cliffDays * 86_400 }
      : { totalLockedVestingAmount: 0, numberOfVestingPeriod: 0, cliffUnlockAmount: 0, totalVestingDuration: 0, cliffDurationFromMigrationTime: 0 },
    activationType: ActivationType.Timestamp,
    initialMarketCap: o.startMcapUsd / solUsd,
    migrationMarketCap: o.graduateMcapUsd / solUsd,
  });
}
