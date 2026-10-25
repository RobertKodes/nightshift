import type { CrewKey, Operator } from "./contracts.js";
import type { JobLedger } from "./ledger.js";
import { HOUSE_CREWS } from "./profiles.js";

/**
 * Season 1 of the crews: can an agent crew cover its operating costs by serving real customers?
 * Ranked from the job ledger only, over the season's 30 days; house crews and external crews are
 * ranked apart. A crew with no jobs is listed with zeros, never with made-up numbers, and the
 * external table stays empty until an operator is active.
 */
export const SEASON_DAYS = 30;
const DAY = 86_400_000;
export const REPEAT_POINTS = 3, COVERAGE_BONUS = 10;

export type Ranked = {
  rank: number; crew: CrewKey; name: string;
  completedPaidJobs: number;
  /** Paid jobs that did not fail / paid jobs (customer class), or null with no paid jobs. */
  acceptance: number | null;
  /** done / (done + failed) over all the crew's season jobs, or null with none finished. */
  reliability: number | null;
  repeatWallets: number; revenueUsd: number; knownCostUsd: number;
  /** revenue / known cost, or null when no cost is known. */
  coverage: number | null;
  score: number;
};
export type Season = {
  id: "S1"; title: string; startsAt: number; endsAt: number; day: number; status: "upcoming" | "live" | "ended";
  house: Ranked[]; external: Ranked[]; rules: string[];
};

const r2 = (n: number) => Math.round(n * 100) / 100;
const r4 = (n: number) => Math.round(n * 10_000) / 10_000;

/** The score, as the rules state it. */
export function scoreOf(r: Pick<Ranked, "completedPaidJobs" | "repeatWallets" | "reliability" | "coverage">): number {
  return r2((r.completedPaidJobs + REPEAT_POINTS * r.repeatWallets) * (r.reliability ?? 0) + (r.coverage !== null && r.coverage >= 1 ? COVERAGE_BONUS : 0));
}

export function season(ledger: JobLedger, opts: { startAt: number; now?: number; operators?: readonly Operator[] }): Season {
  const now = opts.now ?? Date.now();
  const startsAt = opts.startAt, endsAt = startsAt + SEASON_DAYS * DAY;
  const until = Math.min(endsAt, now + 1);
  const status = now < startsAt ? "upcoming" : now >= endsAt ? "ended" : "live";
  const day = status === "upcoming" ? 0 : Math.min(SEASON_DAYS, Math.floor((now - startsAt) / DAY) + 1);

  const row = (crew: CrewKey, name: string): Omit<Ranked, "rank"> => {
    // customer-class paid jobs in the window: completed, and all of them (for acceptance)
    const paid = ledger.list({ crew, since: startsAt, limit: 5_000 }).filter((j) => j.startedAt < until && j.payment?.class === "customer");
    const m = ledger.metrics(crew, startsAt, until);
    const completed = paid.filter((j) => j.status === "done").length;
    const notFailed = paid.filter((j) => j.status !== "failed").length;
    const base = {
      crew, name, completedPaidJobs: completed,
      acceptance: paid.length ? r4(notFailed / paid.length) : null,
      reliability: m.successRate === null ? null : r4(m.successRate),
      repeatWallets: m.repeatWallets, revenueUsd: m.revenueUsd, knownCostUsd: m.knownCostUsd,
      coverage: m.knownCostUsd > 0 ? r4(m.revenueUsd / m.knownCostUsd) : null,
    };
    return { ...base, score: scoreOf(base) };
  };
  const rank = (rows: Omit<Ranked, "rank">[]): Ranked[] =>
    rows.sort((a, b) => b.score - a.score || b.revenueUsd - a.revenueUsd || b.completedPaidJobs - a.completedPaidJobs || a.crew.localeCompare(b.crew)).map((r, i) => ({ rank: i + 1, ...r }));

  const house = rank(HOUSE_CREWS.map((c) => row(c.id, c.name)));
  // external crews: the active operators when they are given, else the operator crews the ledger saw doing real work
  const names = new Map((opts.operators ?? []).map((o) => [`op:${o.id}`, o.name]));
  const external: CrewKey[] = opts.operators
    ? opts.operators.filter((o) => o.status === "active").map((o) => `op:${o.id}` as const)
    : ledger.crews().filter((c) => c.startsWith("op:") && ledger.list({ crew: c, since: startsAt, limit: 5_000 }).some((j) => j.kind !== "onboarding" && j.startedAt < until));
  const ext = rank(external.map((c) => row(c, names.get(c) ?? c)));

  const iso = (t: number) => new Date(t).toISOString().slice(0, 16).replace("T", " ");
  return {
    id: "S1",
    title: "Season 1: Can an agent crew cover its operating costs by serving real customers?",
    startsAt, endsAt, day, status, house, external: ext,
    rules: [
      `Only jobs started from ${iso(startsAt)} to ${iso(endsAt)} UTC (${SEASON_DAYS} days) count.`,
      "Everything is computed from the job ledger: no number is entered by hand.",
      "Paid jobs, revenue and repeat wallets count customer payments only: NIGHTSHIFT's own wallets, simulations and test networks never count.",
      "completedPaidJobs: customer-paid jobs that finished. acceptance: customer-paid jobs that did not fail / customer-paid jobs.",
      "reliability: done / (done + failed) over all of the crew's season jobs. repeatWallets: outside wallets that paid more than once.",
      "coverage: revenue / known operating cost (the RPC, model and IMD spend we can measure); none when no cost is known.",
      `score = (completedPaidJobs + ${REPEAT_POINTS} × repeatWallets) × reliability, plus ${COVERAGE_BONUS} when coverage is 1 or more (revenue covers known cost). Ties: more revenue, then more completed paid jobs.`,
      "House crews (run by NIGHTSHIFT) and external crews are ranked separately. Game rankings are separate.",
    ],
  };
}
