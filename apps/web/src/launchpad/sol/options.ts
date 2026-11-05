/**
 * The launch settings a creator picks, without Meteora's SDK (the form imports this; params.ts turns a
 * choice into the Meteora config). What never changes is in params.ts: a frozen SPL token, 100% locked
 * graduated liquidity, NIGHTSHIFT as the launch partner. The engine checks the same limits (sol-launch.ts).
 */
export const LAUNCH = {
  supply: 1_000_000_000,
  decimals: 6,
  createFeeSol: 0.04, // spam guard, paid to NIGHTSHIFT inside the launch
  configRentSol: 0.009, // a launch with its own settings creates its own Meteora config (the creator pays its rent)
  nonceRentSol: 0.0015, // a launch that waits for the swarm is signed on a durable nonce; its rent comes back
  devBuyMaxSol: 5,
} as const;

export type Sniper = "off" | "standard" | "strong";
/**
 * The creator's own allocation, locked by Meteora's program (a Jupiter Lock escrow made at graduation):
 * nothing of it can move before the token graduates; then it waits `cliffDays` and releases daily over
 * `vestDays`. Shown on the token page for every buyer to see.
 */
export type DevLock = { pct: number; cliffDays: number; vestDays: number };
export type LaunchOptions = { feeBps: FeeBps; startMcapUsd: number; graduateMcapUsd: number; sniper: Sniper; dev: DevLock };

/** Meteora's trading fees: each matches the fee of the DAMM v2 pool it graduates into. */
export const FEES = [25, 30, 100, 200, 400, 600] as const;
export type FeeBps = (typeof FEES)[number];
export const MCAP_LIMITS = { start: [1_000, 1_000_000], graduate: [10_000, 100_000_000], minRatio: 2 } as const;

export const STANDARD: LaunchOptions = { feeBps: 100, startMcapUsd: 5_000, graduateMcapUsd: 75_000, sniper: "standard", dev: { pct: 0, cliffDays: 0, vestDays: 30 } };
/** Quick picks for the curve; any start and graduation in the limits can be typed in. */
export const CURVES = [
  { start: 5_000, graduate: 75_000, label: "$5K → $75K", says: "pump.fun-like" },
  { start: 10_000, graduate: 150_000, label: "$10K → $150K", says: "a bit more room" },
  { start: 25_000, graduate: 400_000, label: "$25K → $400K", says: "a community launch" },
  { start: 50_000, graduate: 1_000_000, label: "$50K → $1M", says: "a project launch" },
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

/** The IMD swarm work a creator can pick before the launch: one IMD job (0.5 IMD) whatever is picked. */
export type SwarmPick = "review" | "logo" | "banner" | "website";
export const SWARM: Record<SwarmPick, { label: string; says: string; skill: string }> = {
  review: { label: "REVIEW", says: "A sourced check of the name, links and your wallet's history. If the swarm says no, the token never launches; if it says yes, the token carries IMD REVIEWED.", skill: "research-report" },
  logo: { label: "LOGO", says: "The swarm draws the token's logo from your words. Skip the upload.", skill: "token-logo" },
  banner: { label: "X BANNER", says: "A 1500 × 500 header for the token's X account, in the logo's style.", skill: "create-image" },
  website: { label: "WEBSITE", says: "A one-page site built and checked by the swarm, hosted on IPFS at an imd.site address, with a Buy button to this launch.", skill: "build-website" },
};
export const SWARM_ORDER: SwarmPick[] = ["review", "logo", "banner", "website"];
/** Where the creator pays IMD for the swarm's job: IMD's Intake sells jobs on these chains. */
export type PayChain = 1 | 4663;
export const PAY_NAMES: Record<PayChain, string> = { 1: "Ethereum", 4663: "Robinhood Chain" };

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
  if (!(FEES as readonly number[]).includes(o.feeBps)) return "Pick one of Meteora's trading fees.";
  if (!(o.startMcapUsd >= MCAP_LIMITS.start[0] && o.startMcapUsd <= MCAP_LIMITS.start[1])) return "The starting market cap is $1,000 to $1,000,000.";
  if (!(o.graduateMcapUsd >= MCAP_LIMITS.graduate[0] && o.graduateMcapUsd <= MCAP_LIMITS.graduate[1])) return "The graduation market cap is $10,000 to $100,000,000.";
  if (o.graduateMcapUsd < o.startMcapUsd * MCAP_LIMITS.minRatio) return "Graduation must be at least twice the starting market cap.";
  if (!(o.sniper in SNIPER)) return "Pick an anti-sniper setting.";
  if (!(DEV_PCTS as readonly number[]).includes(o.dev?.pct)) return "Pick a creator allocation.";
  if (o.dev.pct > 0 && (!(CLIFF_DAYS as readonly number[]).includes(o.dev.cliffDays) || !(VEST_DAYS as readonly number[]).includes(o.dev.vestDays))) return "Pick when the creator allocation unlocks.";
  if (o.dev.pct > 0 && o.dev.cliffDays + o.dev.vestDays > MAX_LOCK_DAYS) return "The lock can last at most two years in all.";
  return null;
}
