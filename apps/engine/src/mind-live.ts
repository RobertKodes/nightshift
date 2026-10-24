import { join } from "node:path";
import { config } from "./config.js";
import { type Mind, createMind } from "./swarm-mind.js";
import { type Swarm, createWeather } from "./swarm-weather.js";

/** SWARM MIND on the engine: IMD's public API read with timeouts, the works kept under the data folder. */
const headers = { "user-agent": "NIGHTSHIFT swarm-mind (getnightshift.tech)" };
const get = async (url: string) => {
  const r = await fetch(url, { headers: { ...headers, accept: "application/json" }, signal: AbortSignal.timeout(20_000) });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  return r.json();
};
const text = async (url: string) => {
  const r = await fetch(url, { headers, signal: AbortSignal.timeout(20_000) });
  return r.ok ? (await r.text()).slice(0, 80_000) : null;
};
export const liveMind = () => createMind({ get, text, dir: join(config.dataDir, "swarm-mind") });

/** The swarm's numbers for SWARM WEATHER, from IMD's /swarm. */
async function swarm(): Promise<Swarm> {
  const s = (await get("https://api.imd.fun/swarm")) as { health?: Record<string, number>; counts?: Record<string, number> };
  const h = s.health ?? {}, c = s.counts ?? {};
  return { agentsOnline: h.agentsOnline ?? 0, acceptedLastDay: h.acceptedLastDay ?? 0, jobsDoneLastDay: h.jobsDoneLastDay ?? 0, oraclesDoneLastDay: h.oraclesDoneLastDay ?? 0, inferenceTokens: c.inferenceTokens ?? 0, launchesLive: c.launchesLive ?? 0, jobs: c.jobs ?? 0 };
}
export const liveWeather = (mind: Mind) => createWeather({ swarm, mind, dir: config.dataDir });
