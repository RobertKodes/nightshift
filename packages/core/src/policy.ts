import type { Company, Policy } from "./types.js";
import { fromImd } from "./types.js";

export const DEFAULT_POLICY: Policy = {
  dailyBudgetUsd: 10,
  approvalOverUsd: 5,
  autopilot: true,
  shiftMinutes: 24 * 60,
};

export type SpendDecision =
  | { allow: true }
  | { allow: false; wait: "approval"; reason: string }
  | { allow: false; wait: "budget"; reason: string };

const DAY = 24 * 60 * 60 * 1000;

/** IMD spent in the last 24 hours, valued at today's price. */
export function spentTodayUsd(c: Company, imdUsd: number, now = Date.now()): number {
  let imd = 0n;
  for (const t of c.tasks) if (t.costImd > 0n && now - t.updatedAt < DAY) imd += t.costImd;
  return fromImd(imd) * imdUsd;
}

/**
 * Every purchase passes here before money moves. A purchase over the per-action limit waits for
 * the owner; a purchase that would break the daily budget waits for tomorrow. Approved purchases
 * still count against the budget.
 */
export function canSpend(c: Company, costUsd: number, imdUsd: number, opts: { approved?: boolean; now?: number } = {}): SpendDecision {
  const spent = spentTodayUsd(c, imdUsd, opts.now);
  if (spent + costUsd > c.policy.dailyBudgetUsd + 1e-9) {
    return { allow: false, wait: "budget", reason: `$${costUsd.toFixed(2)} would take today's spend to $${(spent + costUsd).toFixed(2)}, over the $${c.policy.dailyBudgetUsd} budget` };
  }
  if (!opts.approved && costUsd > c.policy.approvalOverUsd + 1e-9) {
    return { allow: false, wait: "approval", reason: `$${costUsd.toFixed(2)} is over the $${c.policy.approvalOverUsd} you approve by hand` };
  }
  return { allow: true };
}

export function validatePolicy(p: Partial<Policy>): Policy {
  // Only the four known fields, as numbers and a boolean: a request body cannot store anything else here.
  const m = { ...DEFAULT_POLICY, ...p };
  const out: Policy = { dailyBudgetUsd: Number(m.dailyBudgetUsd), approvalOverUsd: Number(m.approvalOverUsd), autopilot: m.autopilot === true || (m.autopilot as unknown) === "true", shiftMinutes: Number(m.shiftMinutes) };
  if (!(out.dailyBudgetUsd >= 0 && out.dailyBudgetUsd <= 10_000)) throw new Error("dailyBudgetUsd must be between 0 and 10000");
  if (!(out.approvalOverUsd >= 0)) throw new Error("approvalOverUsd must be 0 or more");
  if (!(out.shiftMinutes >= 1 && out.shiftMinutes <= 7 * 24 * 60)) throw new Error("shiftMinutes must be between 1 and 10080");
  return out;
}

/**
 * When a purchase that broke the budget would fit again: spending older than a day stops counting,
 * so walk the spend in order until enough of it has aged out.
 */
export function budgetFreesAt(c: Company, costUsd: number, imdUsd: number, now = Date.now()): number {
  const spends = c.tasks
    .filter((t) => t.costImd > 0n && now - t.updatedAt < DAY)
    .map((t) => ({ at: t.updatedAt, usd: fromImd(t.costImd) * imdUsd }))
    .sort((a, b) => a.at - b.at);
  let spent = spends.reduce((s, x) => s + x.usd, 0);
  for (const x of spends) {
    if (spent + costUsd <= c.policy.dailyBudgetUsd + 1e-9) break;
    spent -= x.usd;
    if (spent + costUsd <= c.policy.dailyBudgetUsd + 1e-9) return x.at + DAY;
  }
  // Still too big even with nothing spent: it needs a larger budget, so look again in a day.
  return spent + costUsd <= c.policy.dailyBudgetUsd + 1e-9 ? now : now + DAY;
}

/**
 * The IMD price budgets are valued at, from market readings (USD per IMD). Two sources that agree
 * within 10% set it; one source alone may move it at most 30% from the last kept live price, and
 * never sets the first one. Anything else keeps the last price (null): a wrong feed cannot make
 * IMD look cheap enough to spend far past the owner's USD limits.
 */
export function budgetPrice(readings: number[], last: number | null): number | null {
  const ok = readings.filter((x) => Number.isFinite(x) && x > 0.01 && x < 10_000);
  if (ok.length >= 2) {
    const [a, b] = [Math.min(...ok), Math.max(...ok)];
    if ((b - a) / a <= 0.1) return (a + b) / 2;
  }
  if (last === null) return null;
  return ok.find((x) => Math.abs(x - last) / last <= 0.3) ?? null;
}
