/**
 * The launch settings a creator picks, without Meteora's SDK (the form imports this; params.ts turns a
 * choice into the Meteora config). What never changes is in params.ts: a frozen SPL token, 100% locked
 * graduated liquidity, NIGHTSHIFT as the launch partner paying for the IMD swarm's work.
 */
export const LAUNCH = {
  supply: 1_000_000_000,
  decimals: 6,
  createFeeSol: 0.04, // spam guard, and it pays the IMD swarm's review of the launch (90% to NIGHTSHIFT)
  configRentSol: 0.009, // a launch with its own settings creates its own Meteora config (the creator pays its rent)
  devBuyMaxSol: 5,
} as const;

export type Sniper = "off" | "standard" | "strong";
/**
 * The creator's own allocation, locked by Meteora's program (a Jupiter Lock escrow made at graduation):
 * nothing of it can move before the token graduates; then it waits `cliffDays` and releases daily over
 * `vestDays`. Shown on the token page for every buyer to see.
 */
export type DevLock = { pct: number; cliffDays: number; vestDays: number };
export type LaunchOptions = { feeBps: 100 | 200; startMcapUsd: number; graduateMcapUsd: number; sniper: Sniper; dev: DevLock };

export const STANDARD: LaunchOptions = { feeBps: 100, startMcapUsd: 5_000, graduateMcapUsd: 75_000, sniper: "standard", dev: { pct: 0, cliffDays: 0, vestDays: 30 } };
export const MCAP_STEPS = [
  { start: 5_000, graduate: 75_000, label: "$5K → $75K" },
  { start: 10_000, graduate: 150_000, label: "$10K → $150K" },
  { start: 25_000, graduate: 400_000, label: "$25K → $400K" },
  { start: 50_000, graduate: 1_000_000, label: "$50K → $1M" },
] as const;
export const SNIPER: Record<Sniper, { startBps: number; seconds: number; periods: number; label: string; says: string }> = {
  off: { startBps: 0, seconds: 0, periods: 0, label: "OFF", says: "The normal fee from the first trade." },
  standard: { startBps: 5000, seconds: 120, periods: 60, label: "STANDARD", says: "50% at the open, falling to the normal fee over 2 minutes." },
  strong: { startBps: 9000, seconds: 300, periods: 100, label: "STRONG", says: "90% at the open, falling to the normal fee over 5 minutes." },
};
export const DEV_PCTS = [0, 10, 20, 30, 50, 70] as const;
export const CLIFF_DAYS = [0, 30, 90, 180, 365] as const;
export const VEST_DAYS = [30, 90, 180, 365] as const;
export const MAX_LOCK_DAYS = 730; // Meteora's locker caps a lock at two years

/** The protocol's cut of every trading fee (Meteora DBC) and the creator's share of the rest. */
export const METEORA_FEE_PCT = 20;
export const CREATOR_FEE_SHARE = 50;

export const isStandard = (o: LaunchOptions) =>
  o.feeBps === STANDARD.feeBps && o.startMcapUsd === STANDARD.startMcapUsd && o.graduateMcapUsd === STANDARD.graduateMcapUsd && o.sniper === STANDARD.sniper && o.dev.pct === 0;

/** What a trading fee pays, per $100 traded. */
export function feeSplit(feeBps = 100, volume = 100) {
  const fee = (volume * feeBps) / 10_000;
  const meteora = (fee * METEORA_FEE_PCT) / 100;
  const creator = ((fee - meteora) * CREATOR_FEE_SHARE) / 100;
  return { fee, meteora, creator, nightshift: fee - meteora - creator };
}

/** The range checks the form shows before the SDK is loaded (params.checkOptions adds the curve's own). */
export function optionProblem(o: LaunchOptions): string | null {
  if (o.feeBps !== 100 && o.feeBps !== 200) return "The trading fee is 1% or 2%.";
  if (!MCAP_STEPS.some((s) => s.start === o.startMcapUsd && s.graduate === o.graduateMcapUsd)) return "Pick one of the market cap ranges.";
  if (!(o.sniper in SNIPER)) return "Pick an anti-sniper setting.";
  if (!(DEV_PCTS as readonly number[]).includes(o.dev?.pct)) return "Pick a creator allocation.";
  if (o.dev.pct > 0 && (!(CLIFF_DAYS as readonly number[]).includes(o.dev.cliffDays) || !(VEST_DAYS as readonly number[]).includes(o.dev.vestDays))) return "Pick when the creator allocation unlocks.";
  if (o.dev.pct > 0 && o.dev.cliffDays + o.dev.vestDays > MAX_LOCK_DAYS) return "The lock can last at most two years in all.";
  return null;
}
