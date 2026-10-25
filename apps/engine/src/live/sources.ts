import { config } from "../config.js";
import { marketSnapshot } from "../community.js";
import { swarmPulse } from "../crew.js";
import { crewLedger, onCrewEvent } from "../crews/live.js";
import { liveUsage } from "../usage.js";
import { liveGames } from "../spectate.js";
import { LiveBus, liveBus, type LivePayloads } from "./bus.js";
import { liveSpotlight } from "./spotlight.js";

const obj = (v: unknown): Record<string, unknown> => v && typeof v === "object" ? v as Record<string, unknown> : {};
const num = (v: unknown) => typeof v === "number" && Number.isFinite(v) && v >= 0 ? v : null;
const rows = (v: unknown): Record<string, unknown>[] => Array.isArray(v) ? v.map(obj) : [];
const day = (at: number) => new Date(at).toISOString().slice(0, 10);

/** Baselines never play old activity as new. Failed reads do not reset a baseline. */
export class LiveDiff {
  #pulse = "";
  #clients: Set<string> | null = null;
  #clientDay = "";
  #jobs: Map<string, string> | null = null;
  #launches: Set<number> | null = null;
  #todayJobs = new Set<string>();
  #jobDay = "";
  constructor(readonly bus: LiveBus, private readonly now = Date.now) {}
  pulse(value: unknown): void {
    const p = obj(value);
    if (!Object.keys(p).length) return;
    const v: LivePayloads["imd.pulse"] = { agentsOnline: num(p.agentsOnline), jobsLastDay: num(p.jobsDoneLastDay), at: num(p.at) ?? this.now(), ok: p.ok === true };
    const key = JSON.stringify([v.agentsOnline, v.jobsLastDay, v.ok]);
    Object.assign(this.bus.stats, { pulseAt: v.at, pulseOk: v.ok });
    if (key === this.#pulse) return;
    this.#pulse = key; this.bus.emit("imd.pulse", v);
  }
  clients(clients: { name: string; count: number }[], date = day(this.now())): void {
    const names = clients.filter((c) => c.count > 0).map((c) => c.name);
    if (!this.#clients || date !== this.#clientDay) { this.#clients = new Set(names); this.#clientDay = date; return; }
    for (const client of names) if (!this.#clients.has(client)) { this.#clients.add(client); this.bus.emit("agent.docked", { client }); }
  }
  jobs(jobs: Record<string, unknown>[]): void {
    const first = this.#jobs === null;
    this.#jobs ??= new Map();
    const today = day(this.now());
    if (today !== this.#jobDay) { this.#jobDay = today; this.#todayJobs.clear(); }
    for (const j of jobs) {
      const id = String(j.id ?? ""), state = String(j.state ?? "");
      if (!id) continue;
      const at = Date.parse(String(j.updatedAt ?? ""));
      if (state === "completed") {
        if (Number.isFinite(at) && day(at) === today) this.#todayJobs.add(id);
        if (!first && this.#jobs.get(id) !== "completed" && at >= this.bus.stats.observedSince) this.bus.emit("imd.job", { job: id, kind: String(j.template ?? j.launchKind ?? "work"), summary: String(j.objective ?? "Swarm job completed") });
      }
      this.#jobs.set(id, state);
    }
    this.bus.stats.jobsToday = this.#todayJobs.size;
    if (this.#jobs.size > 4000) this.#jobs = new Map([...this.#jobs].slice(-2000));
  }
  launches(launches: Record<string, unknown>[]): void {
    const first = this.#launches === null;
    this.#launches ??= new Set();
    let today = 0;
    for (const l of launches) {
      if (l.status !== "live" || num(l.launchNumber) === null) continue;
      const at = Date.parse(String(l.createdAt ?? ""));
      if (Number.isFinite(at) && day(at) === day(this.now())) today++;
      const launch = Number(l.launchNumber);
      if (!first && !this.#launches.has(launch)) {
        const token = rows(l.artifacts).find((a) => a.role === "token");
        this.bus.emit("imd.launch", { launch, name: String(token?.name ?? l.kind ?? "IMD launch"), verdict: "unchecked", summary: "NIGHT SNIPER: checks pending or not covered." });
      }
      this.#launches.add(launch);
    }
    this.bus.stats.launchesToday = today;
    if (this.#launches.size > 4000) this.#launches = new Set([...this.#launches].slice(-2000));
  }
}

async function get(path: string): Promise<Record<string, unknown>> {
  const r = await fetch(`https://api.imd.fun${path}`, { signal: AbortSignal.timeout(12_000) });
  if (!r.ok) throw new Error("IMD unavailable");
  return obj(await r.json());
}

let stop: (() => void) | null = null;
/** Starts once per engine; returns a cleanup for server shutdown. */
export function startLiveSources(o: { token?: () => Promise<unknown> } = {}): () => void {
  if (stop) return stop;
  const diff = new LiveDiff(liveBus);
  let busy = false, ended = false;
  let gameKey: string | null = null, cursor = 0;
  const active = new Set<string>();
  const off = onCrewEvent((e) => {
    if (e.status !== "done") return;
    const job = crewLedger().list({ crew: e.crew, limit: 10 }).find((j) => j.endedAt === e.at && j.kind === e.kind);
    liveBus.emit("crew.job", { crew: e.crew, kind: e.kind, summary: e.summary ?? "Job completed", test: job?.payment?.class === "test" });
  });
  async function tick() {
    if (busy || ended) return;
    busy = true;
    try {
      await Promise.allSettled([
        swarmPulse().then((p) => { if (!ended) diff.pulse(p); }),
        (async () => {
          const r = await get("/jobs?limit=200");
          if (!Array.isArray(r.jobs)) return;
          const list = rows(r.jobs), ids = new Set(list.map((j) => String(j.id)));
          const missing = [...active].filter((id) => !ids.has(id));
          const rotated = missing.length ? [...missing.slice(cursor % missing.length), ...missing.slice(0, cursor % missing.length)] : [];
          cursor += 20;
          const extra = await Promise.all(rotated.slice(0, 20).map(async (id) => {
            const r = await get(`/jobs/${encodeURIComponent(id)}`).catch(() => null);
            return r ? obj(r.job ?? r) : null;
          }));
          if (ended) return;
          const all = [...list, ...extra.filter((j): j is Record<string, unknown> => j !== null)];
          diff.jobs(all);
          for (const j of all) {
            const id = String(j.id ?? "");
            if (["executing", "pending", "running"].includes(String(j.state))) { if (active.size < 200) active.add(id); } else active.delete(id);
          }
        })(),
        (async () => {
          const list: Record<string, unknown>[] = [];
          let before = "";
          for (let i = 0; i < 10; i++) {
            const r = await get(`/launches?limit=200${before ? `&before=${before}` : ""}`);
            if (!Array.isArray(r.launches)) return;
            const part = rows(r.launches); list.push(...part);
            if (part.length < 200 || part.some((l) => Date.parse(String(l.createdAt)) < Date.parse(`${day(Date.now())}T00:00:00Z`))) break;
            before = String(part.at(-1)?.launchNumber ?? "");
          }
          if (!ended) diff.launches(list);
        })(),
        (async () => {
          const report = liveUsage(config.dataDir).report(1);
          if (!ended) diff.clients(report.mcp.clients, report.days.at(-1)?.day);
        })(),
        (async () => {
          const games = liveGames(), key = games.map((g) => `${g.game}:${g.id}`).sort().join(",");
          if (gameKey !== null && key !== gameKey && !ended) liveBus.emit("game.live", { count: games.length, house: games.filter((g) => g.house).length });
          gameKey = key;
        })(),
        (async () => {
          if (!o.token) return;
          const [value, market] = await Promise.all([o.token(), marketSnapshot()]);
          const t = obj(value);
          if (ended) return;
          const price = num(obj(t.market).priceUsd), pct = num(t.stakedPct);
          if (price !== null && market) { liveBus.stats.priceUsd = price; liveBus.stats.marketAt = market.at; }
          if (pct !== null) {
            if (liveBus.stats.stakedShare === null) liveBus.stats.stakedShare = pct / 100;
            else if (liveBus.stats.stakedShare !== pct / 100) liveBus.emit("shift.stake", { share: pct / 100 });
          }
        })(),
      ]);
      if (!ended) void liveSpotlight().tick().catch(() => {});
    } finally { busy = false; }
  }
  void tick().catch(() => {});
  const timer = setInterval(() => void tick().catch(() => {}), 30_000); timer.unref();
  stop = () => { ended = true; clearInterval(timer); off(); stop = null; };
  return stop;
}
