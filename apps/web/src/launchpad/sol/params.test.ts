import { validateConfigParameters } from "@meteora-ag/dynamic-bonding-curve-sdk";
import { PublicKey } from "@solana/web3.js";
import { describe, expect, it } from "vitest";
import { CLIFF_DAYS, checkOptions, CURVES, curvePreview, DEV_PCTS, FEES, feeSplit, LAUNCH, launchConfig, type LaunchOptions, SNIPER, STANDARD, VEST_DAYS } from "./params";

const RECEIVER = new PublicKey("11111111111111111111111111111112");
// the quick picks, plus curves typed in by hand at the edges of the limits
const CAPS = [...CURVES.map((c) => [c.start, c.graduate] as const), [1_000, 100_000_000], [1_000_000, 100_000_000], [2_500, 2_000_000], [7_777, 333_333]] as const;
const all: LaunchOptions[] = CAPS.flatMap(([start, graduate]) => FEES.flatMap((feeBps) => (Object.keys(SNIPER) as (keyof typeof SNIPER)[]).flatMap((sniper) => DEV_PCTS.map((pct) => ({ feeBps, startMcapUsd: start, graduateMcapUsd: graduate, sniper, dev: { pct, cliffDays: 90, vestDays: 365 } })))));

describe("NIGHTSHIFT Solana launch settings", () => {
  it.each([50, 100, 300])("every combination passes Meteora's own validation at $%d SOL", (solUsd) => {
    for (const o of all) {
      if (checkOptions(o, solUsd)) continue; // too small to graduate at this price: the page refuses it
      expect(() => validateConfigParameters({ ...launchConfig(o, solUsd), leftoverReceiver: RECEIVER }), JSON.stringify(o)).not.toThrow();
    }
  });

  it("keeps the guarantees whatever is picked: frozen SPL token, 100% locked graduated LP, DAMM v2 at the curve's fee", () => {
    for (const o of all) {
      const c = launchConfig(o, 100);
      expect(c.tokenType).toBe(0);
      expect(c.tokenDecimal).toBe(LAUNCH.decimals);
      expect(c.tokenUpdateAuthority).toBe(1);
      expect(c.partnerLiquidityPercentage + c.creatorLiquidityPercentage).toBe(0);
      expect(c.partnerPermanentLockedLiquidityPercentage + c.creatorPermanentLockedLiquidityPercentage).toBe(100);
      expect(c.migrationOption).toBe(1);
      expect(c.migrationFeeOption).toBe(FEES.indexOf(o.feeBps));
    }
  });

  it("prices the market caps in dollars and refuses curves too small to graduate", () => {
    const raised = curvePreview(STANDARD, 100)!.raiseSol;
    expect(raised).toBeGreaterThan(10);
    expect(Number(launchConfig(STANDARD, 100).migrationQuoteThreshold.toString()) / 1e9).toBe(raised);
    // a higher graduation cap raises more (less of the supply is sold on the curve, so not ten times)
    expect(curvePreview({ ...STANDARD, graduateMcapUsd: 750_000 }, 100)!.raiseSol / raised).toBeGreaterThan(2);
    expect(checkOptions(STANDARD, 100)).toBeNull();
    expect(checkOptions({ ...STANDARD, feeBps: 150 as 100 }, 100)).toMatch(/Meteora's trading fees/);
    expect(checkOptions({ ...STANDARD, graduateMcapUsd: 9_000 }, 100)).toMatch(/graduation market cap/);
    expect(checkOptions({ ...STANDARD, startMcapUsd: 50_000, graduateMcapUsd: 75_000 }, 100)).toMatch(/twice/);
    // the smallest curve raises ~24 SOL at $100 SOL, but under the keeper's 10 SOL if SOL were $1,000
    expect(checkOptions({ ...STANDARD, startMcapUsd: 1_000, graduateMcapUsd: 10_000 }, 100)).toBeNull();
    expect(checkOptions({ ...STANDARD, startMcapUsd: 1_000, graduateMcapUsd: 10_000 }, 1_000)).toMatch(/too little to graduate/);
    expect(checkOptions(STANDARD, 0)).toMatch(/SOL price/);
  });

  it("opens with the anti-sniper fee only when asked, and charges the creation fee", () => {
    expect(launchConfig({ ...STANDARD, sniper: "standard" }).poolFees.baseFee.baseFeeMode).toBe(1);
    expect(launchConfig({ ...STANDARD, sniper: "off" }).poolFees.baseFee.baseFeeMode).toBe(0);
    expect(Number(launchConfig().poolCreationFee.toString())).toBe(LAUNCH.createFeeSol * 1e9);
  });

  it("splits a 1% fee per $100: $0.20 Meteora, $0.40 creator, $0.40 NIGHTSHIFT", () => {
    const s = feeSplit(100, 100);
    expect([s.fee, s.meteora, s.creator, s.nightshift].map((x) => +x.toFixed(4))).toEqual([1, 0.2, 0.4, 0.4]);
    expect(feeSplit(200, 100).nightshift).toBeCloseTo(0.8);
    expect(feeSplit(25, 100).fee).toBeCloseTo(0.25);
  });

  it("locks a 70% creator allocation until graduation, then a cliff, then daily vesting", () => {
    const o: LaunchOptions = { ...STANDARD, dev: { pct: 70, cliffDays: 180, vestDays: 365 } };
    expect(checkOptions(o, 100)).toBeNull();
    const c = launchConfig(o, 100);
    expect(() => validateConfigParameters({ ...c, leftoverReceiver: RECEIVER })).not.toThrow();
    const v = c.lockedVesting;
    const locked = BigInt(v.amountPerPeriod.toString()) * BigInt(v.numberOfPeriod.toString()) + BigInt(v.cliffUnlockAmount.toString());
    expect(Number(locked) / 10 ** LAUNCH.decimals / LAUNCH.supply).toBeCloseTo(0.7, 2);
    expect(Number(v.numberOfPeriod.toString())).toBe(365);
    expect(Number(v.cliffDurationFromMigrationTime.toString())).toBe(180 * 86_400);
    expect(checkOptions({ ...o, dev: { pct: 70, cliffDays: 365, vestDays: 365 } }, 100)).toBeNull();
    expect(checkOptions({ ...o, dev: { pct: 80, cliffDays: 0, vestDays: 30 } }, 100)).toMatch(/allocation/);
    expect(CLIFF_DAYS.length * VEST_DAYS.length).toBeGreaterThan(0);
  });
});
