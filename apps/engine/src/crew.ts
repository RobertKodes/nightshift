import { DEV_WALLET, TREASURY_WALLET } from "./shift-launch.js";

/**
 * NIGHTSHIFT's crew roster: every IMD swarm agent that worked on an order NIGHTSHIFT paid for,
 * from IMD's public records (GET /requests/paid-by/:wallet, then /jobs/:id and its submissions).
 * Nothing here is self-reported: each row links to the job on IMD's explorer.
 */
type Order = { orderId: string; action: string; status: string; paidAt: string | null; result?: { jobId?: string } | null };
type Submission = { nodeKey: string; role: string; seat?: { tokenId: string; agentId: string } | null; outcome: string; accepted: boolean; usage?: { model?: string; runtime?: string; wallClockMs?: number; outputTokens?: number } | null };
export type CrewMember = { seat: number; agentId: string; roles: string[]; models: string[]; runtimes: string[]; accepted: number; attempts: number; jobs: number; hours: number; outputTokens: number };
export type CrewJob = { id: string; action: string; title: string; state: string; paidAt: string | null; workers: number; accepted: number; explorer: string };
export type Crew = { at: number; payers: string[]; orders: number; paidImd: number; jobs: CrewJob[]; crew: CrewMember[]; models: { model: string; steps: number }[]; source: string };

const get = async <T,>(url: string): Promise<T> => {
  const r = await fetch(url, { headers: { accept: "application/json" }, signal: AbortSignal.timeout(12_000) });
  if (!r.ok) throw new Error(`${url} ${r.status}`);
  return (await r.json()) as T;
};

let cache: Crew | null = null;
/** Read at most every 30 minutes (a few dozen public reads, well under IMD's 120/min). */
export async function crew(fetchJson = get, payers: string[] = [DEV_WALLET, TREASURY_WALLET]): Promise<Crew | null> {
  if (cache && Date.now() - cache.at < 30 * 60_000) return cache;
  try {
    const orders: Order[] = [];
    for (const p of payers) orders.push(...((await fetchJson<{ orders?: Order[] }>(`https://api.imd.fun/requests/paid-by/${p}`)).orders ?? []));
    const paid = orders.filter((o) => o.status === "admitted" && o.result?.jobId);
    const members = new Map<string, CrewMember & { jobSet: Set<string> }>();
    const models = new Map<string, number>();
    const jobs: CrewJob[] = [];
    for (const o of paid) {
      const id = o.result!.jobId!;
      const [job, subs] = await Promise.all([
        fetchJson<{ state?: string; objective?: string }>(`https://api.imd.fun/jobs/${id}`).catch(() => ({} as { state?: string; objective?: string })),
        fetchJson<{ submissions?: Submission[] }>(`https://api.imd.fun/jobs/${id}/submissions`).catch(() => ({ submissions: [] as Submission[] })),
      ]);
      const list = subs.submissions ?? [];
      const workers = new Set<string>();
      for (const s of list) {
        if (!s.seat?.tokenId) continue;
        const k = s.seat.tokenId;
        workers.add(k);
        const m = members.get(k) ?? { seat: Number(k), agentId: s.seat.agentId, roles: [], models: [], runtimes: [], accepted: 0, attempts: 0, jobs: 0, hours: 0, outputTokens: 0, jobSet: new Set<string>() };
        m.attempts++;
        if (s.accepted) m.accepted++;
        if (s.role && !m.roles.includes(s.role)) m.roles.push(s.role);
        if (s.usage?.model && !m.models.includes(s.usage.model)) m.models.push(s.usage.model);
        if (s.usage?.runtime && !m.runtimes.includes(s.usage.runtime)) m.runtimes.push(s.usage.runtime);
        m.hours += (s.usage?.wallClockMs ?? 0) / 3_600_000;
        m.outputTokens += s.usage?.outputTokens ?? 0;
        m.jobSet.add(id);
        members.set(k, m);
        if (s.usage?.model) models.set(s.usage.model, (models.get(s.usage.model) ?? 0) + 1);
      }
      const first = (job.objective ?? "").replace(/[*#`]/g, "").split(/[.\n]/)[0]!.trim();
      // cut long objectives at a word, never mid-word
      const title = (first.length > 96 ? `${first.slice(0, 96).replace(/[\s,;:(]+\S*$/, "")}…` : first) || o.action;
      jobs.push({ id, action: o.action, title, state: job.state ?? "unknown", paidAt: o.paidAt, workers: workers.size, accepted: list.filter((s) => s.accepted).length, explorer: `https://explorer.imd.fun/jobs/${id}` });
    }
    const roster = [...members.values()].map(({ jobSet, ...m }) => ({ ...m, jobs: jobSet.size, hours: Math.round(m.hours * 10) / 10 }))
      .sort((a, b) => b.accepted - a.accepted || b.jobs - a.jobs);
    cache = {
      at: Date.now(), payers, orders: orders.length, paidImd: paid.length * 0.5, jobs, crew: roster,
      models: [...models].map(([model, steps]) => ({ model, steps })).sort((a, b) => b.steps - a.steps), source: "api.imd.fun (paid-by, jobs, submissions)",
    };
  } catch (e) { console.error("crew", (e as Error).message); }
  return cache;
}

let pulseCache: { at: number; v: unknown } | null = null;
/** The swarm's health and totals (the head of GET /swarm), every 10 minutes. */
export async function swarmPulse(fetchJson = get): Promise<unknown> {
  if (pulseCache && Date.now() - pulseCache.at < 10 * 60_000) return pulseCache.v;
  try {
    const s = await fetchJson<{ health?: Record<string, unknown>; counts?: Record<string, unknown> }>("https://api.imd.fun/swarm");
    const h = s.health ?? {}, c = s.counts ?? {};
    pulseCache = { at: Date.now(), v: { at: Date.now(), agentsOnline: h.agentsOnline, seatsEnrolled: h.seatsEnrolled, acceptedLastDay: h.acceptedLastDay, jobsDoneLastDay: h.jobsDoneLastDay, oraclesDoneLastDay: h.oraclesDoneLastDay, jobs: c.jobs, launchesLive: c.launchesLive, sites: c.sites, inferenceTokens: c.inferenceTokens, source: "api.imd.fun/swarm" } };
  } catch (e) { console.error("swarm pulse", (e as Error).message); }
  return pulseCache?.v ?? null;
}
