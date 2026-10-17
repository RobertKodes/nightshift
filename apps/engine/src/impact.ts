import { config } from "./config.js";
import { frogStats } from "./frogs.js";
import { orders } from "./orders.js";
import type { Engine } from "./engine.js";

/**
 * IMD Impact: what NIGHTSHIFT has given the IMD network, every number checkable. Real work only:
 * IMD paid to the swarm (operator orders, and live companies' jobs), the agents (seats) that did
 * it, and the IMD burned by NIGHT FROGS mints. Simulated companies are counted apart, as demo.
 */
type Job = { title: string; jobId: string; state: string; imd: number; seats: string[]; at: number; by: string };
type Impact = { at: number; imdPaid: number; jobs: Job[]; seats: number; burned: number; frogsMinted: number; frogsImd: number; demoCompanies: number; liveCompanies: number };

let cache: Impact | null = null;
const seatsOf = new Map<string, { at: number; state: string; seats: string[] }>();

async function jobInfo(jobId: string) {
  const hit = seatsOf.get(jobId);
  if (hit && (hit.state === "completed" || Date.now() - hit.at < 10 * 60_000)) return hit;
  try {
    const r = await fetch(`https://api.imd.fun/jobs/${jobId}`, { signal: AbortSignal.timeout(15000) });
    const j = (await r.json()) as { state?: string; nodes?: { seat?: { tokenId?: string } | null }[] };
    const v = { at: Date.now(), state: j.state ?? "unknown", seats: [...new Set((j.nodes ?? []).map((n) => n.seat?.tokenId).filter(Boolean) as string[])] };
    seatsOf.set(jobId, v);
    return v;
  } catch { return hit ?? { at: 0, state: "unknown", seats: [] }; }
}

export async function impact(engine: Engine): Promise<Impact> {
  if (cache && Date.now() - cache.at < 5 * 60_000) return cache;
  const jobs: Job[] = [];
  for (const o of orders()) {
    if (!o.jobId) continue;
    const i = await jobInfo(o.jobId);
    jobs.push({ title: o.title, jobId: o.jobId, state: i.state, imd: 0.5, seats: i.seats, at: o.at, by: "NIGHTSHIFT" });
  }
  const all = [...engine.store.companies.values()];
  if (config.mode === "live") {
    for (const c of all) for (const t of c.tasks) {
      if (!t.imd?.jobId || t.costImd <= 0n) continue;
      const i = await jobInfo(t.imd.jobId);
      jobs.push({ title: `${c.name}: ${t.title}`, jobId: t.imd.jobId, state: i.state, imd: Number(t.costImd) / 1e18, seats: i.seats, at: t.createdAt, by: c.name });
    }
  }
  const f = await frogStats();
  cache = {
    at: Date.now(),
    imdPaid: jobs.reduce((a, j) => a + j.imd, 0),
    jobs: jobs.sort((a, b) => b.at - a.at),
    seats: new Set(jobs.flatMap((j) => j.seats)).size,
    burned: f?.burned ?? 0,
    frogsMinted: f?.minted ?? 0,
    frogsImd: (f?.minted ?? 0) * (f?.price ?? 2),
    demoCompanies: config.mode === "live" ? 0 : all.length,
    liveCompanies: config.mode === "live" ? all.length : 0,
  };
  return cache;
}
