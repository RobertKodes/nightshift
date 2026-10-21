// What the bot does with the coordinator's answer, as pure functions so the tests can drive them without a chain.
//
// The coordinator (getnightshift.tech/api/watch/jobs) hands each seat its share of the work: a loan to mark
// (bark), or a share of a marked loan to liquidate (bite) once its grace has run out. The bot never does more
// than it was handed, so the seats of the Night Watch never race each other for the same loan.

/** A bite share, cut to what the keeper holds: bite burns the caller's own imdUSD. */
export const biteAmount = (job, inventory) => {
  const want = BigInt(job.repay);
  return inventory < want ? inventory : want;
};

/**
 * What to do with one job at block time `now` (seconds):
 *   { act: "bark" } / { act: "bite", amount } now,
 *   { act: "wait", seconds } for a bite whose window opens within `soonSeconds` (the bot sleeps and fires),
 *   { act: "skip", why } otherwise.
 */
export function decide(job, { now, inventory, soonSeconds = 90, minSlice = 15n * 10n ** 18n }) {
  if (job.kind === "bark") return { act: "bark" };
  if (job.kind !== "bite") return { act: "skip", why: `unknown job ${job.kind}` };
  if (now > job.closesAt) return { act: "skip", why: "its window closed: it will be marked again" };
  const amount = biteAmount(job, inventory);
  if (amount <= 0n) return { act: "skip", why: "no imdUSD to repay with" };
  if (amount < minSlice && amount < BigInt(job.repay)) return { act: "skip", why: "too little imdUSD for a bite worth its gas" };
  if (now < job.opensAt) {
    const wait = job.opensAt - now;
    return wait <= soonSeconds ? { act: "wait", seconds: wait, amount } : { act: "skip", why: `its window opens in ${Math.round(wait / 60)} min` };
  }
  return { act: "bite", amount };
}

/**
 * The cut the coordinator says is due, and how to pay it: from staked IMD first (the sIMD a bite paid,
 * withdrawn straight to the FeeSplitter), else from plain IMD. Nothing while an earlier payment may still be
 * on its way to the coordinator's books (`recentPaySeconds`).
 */
export function cutPayment({ dueImd, simdCovers, imdBalance, lastPaidAgoSeconds, recentPaySeconds = 300 }) {
  const due = BigInt(dueImd ?? "0");
  if (due <= 0n) return { pay: false };
  if (lastPaidAgoSeconds !== null && lastPaidAgoSeconds < recentPaySeconds) return { pay: false, why: "a payment is still being counted" };
  if (simdCovers) return { pay: true, from: "simd", amount: due };
  if (imdBalance >= due) return { pay: true, from: "imd", amount: due };
  return { pay: false, why: `${Number(due) / 1e18} IMD due, and the keeper holds too little sIMD or IMD to pay it` };
}
