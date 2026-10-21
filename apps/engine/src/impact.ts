import { config } from "./config.js";
import { crew } from "./crew.js";
import { frogStats, frogsOn } from "./frogs.js";
import type { Engine } from "./engine.js";

/**
 * IMD Impact: what NIGHTSHIFT has given the IMD network, every number checkable. Real work only:
 * IMD paid to the swarm (the operator's orders and the live companies' jobs, from the crew ledger
 * that reads IMD's own records), the agents (seats) that did it, and the IMD burned by NIGHT FROGS
 * mints. Simulated companies are counted apart, as demo. Served at once from the last read: when
 * IMD or Ethereum does not answer, the figures are the last known ones and `error` says so.
 */
type Job = { title: string; jobId: string; state: string; imd: number; seats: string[]; at: number; by: string };
type Impact = {
  at: number; ok: boolean; error: string | null; imdAt: number; imdPaid: number; jobs: Job[]; seats: number;
  burned: number | null; frogsMinted: number | null; frogsImd: number | null; frogsAt: number | null; demoCompanies: number; liveCompanies: number;
};

let frogs: { at: number; minted: number; burned: number; price: number } | null = null;
/** The frog contract's totals, without waiting more than 4 s on Ethereum (the last read otherwise). */
async function frogTotals() {
  if (!frogsOn()) return null;
  const f = await Promise.race([frogStats().catch(() => null), new Promise<null>((ok) => setTimeout(() => ok(null), 4000).unref())]);
  if (f) frogs = { at: f.at, minted: f.minted, burned: f.burned, price: f.price };
  return frogs;
}

export async function impact(engine: Engine): Promise<Impact> {
  const [c, f] = await Promise.all([crew(), frogTotals()]);
  const all = [...engine.store.companies.values()].filter((x) => !x.house);
  const errors = [c.error, frogsOn() && (!f || Date.now() - f.at > 10 * 60_000) ? "Ethereum did not answer for the frog totals." : null].filter(Boolean) as string[];
  return {
    at: Date.now(), ok: errors.length === 0, error: errors.join(" ") || null, imdAt: c.at,
    imdPaid: c.paidImd,
    jobs: c.jobs.map((j) => ({ title: j.by === "NIGHTSHIFT" ? j.title : `${j.by}: ${j.title}`, jobId: j.id, state: j.state, imd: j.imd, seats: j.seats.map(String), at: j.paidAt ? Date.parse(j.paidAt) : 0, by: j.by })),
    seats: c.seats,
    burned: f ? f.burned : null,
    frogsMinted: f ? f.minted : null,
    frogsImd: f ? f.minted * (f.price || 2) : null,
    frogsAt: f?.at ?? null,
    demoCompanies: config.mode === "live" ? 0 : all.length,
    liveCompanies: config.mode === "live" ? all.length : 0,
  };
}
