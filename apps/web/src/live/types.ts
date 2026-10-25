export type LiveEvent = { id: string; at: number; type: string; data: Record<string, string | number | boolean | null> };
export type LiveState = {
  at: number; simulated?: boolean;
  stats: { agentsOnline: number | null; jobsToday: number; jobsLastDay: number | null; launchesToday: number; priceUsd: number | null; stakedShare: number | null; pulseAt: number | null; pulseOk: boolean; marketAt: number | null; observedSince: number };
  events: LiveEvent[];
  spotlight?: { queued: number; nextAt: number; current: { id: string; kind: string; target: string; summary: string; ok: boolean; at: number } | null };
};
export const EMPTY: LiveState = { at: 0, stats: { agentsOnline: null, jobsToday: 0, jobsLastDay: null, launchesToday: 0, priceUsd: null, stakedShare: null, pulseAt: null, pulseOk: false, marketAt: null, observedSince: 0 }, events: [] };
export const CREWS: Record<string, string> = { watchtower: "Watchtower", research: "Research Desk", buildcheck: "Build & Check", swarm: "Swarm Desk" };
export function caption(e: LiveEvent): { title: string; text: string; tone: string; icon: string } {
  const d = e.data, summary = String(d.summary ?? "");
  switch (e.type) {
    case "imd.job": return { title: /audit/i.test(String(d.kind)) ? "Audit complete" : "Swarm delivery", text: summary, tone: "cyan", icon: "↗" };
    case "imd.launch": return { title: `IMD #${d.launch} launched`, text: `${d.name} · NIGHT SNIPER: ${d.verdict}. ${summary}`, tone: "violet", icon: "↑" };
    case "shift.buy": return { title: "Power surge", text: `${d.buyer} bought $${Number(d.usd).toLocaleString("en-US", { maximumFractionDigits: 2 })} of SHIFT`, tone: "lime", icon: "ϟ" };
    case "shift.burn": return { title: "Reactor ignited", text: `${Number(d.amount).toLocaleString("en-US")} SHIFT burned onchain`, tone: "orange", icon: "♨" };
    case "shift.stake": return { title: "Shield updated", text: `${(Number(d.share) * 100).toFixed(1)}% of SHIFT is staked`, tone: "cyan", icon: "◇" };
    case "crew.job": return { title: `${CREWS[String(d.crew)] ?? "Outside crew"} delivered`, text: summary, tone: "cyan", icon: "✓" };
    case "agent.docked": return { title: "Agent docked", text: `${d.client} connected to NIGHTSHIFT MCP`, tone: "violet", icon: "↓" };
    case "watchtower.change": return { title: `Watchtower · ${d.token}`, text: summary, tone: "orange", icon: "⌖" };
    case "tg.request": return { title: `Community /${d.kind}`, text: summary, tone: "pink", icon: "↳" };
    case "spotlight.queued": return { title: "Spotlight queued", text: `${d.target} · position ${d.position}`, tone: "lime", icon: "☆" };
    case "spotlight.started": return { title: "In the Spotlight", text: `${d.target} · real check in progress`, tone: "lime", icon: "◎" };
    case "spotlight.result": return { title: `Spotlight · ${d.target}`, text: summary, tone: d.ok ? "lime" : "orange", icon: "◎" };
    case "game.live": return { title: "Game room", text: `${d.count} games live${d.house ? ` · ${d.house} house exhibitions` : ""}`, tone: "pink", icon: "✦" };
    default: return { title: "Swarm signal", text: `${d.agentsOnline ?? "—"} IMD agents online`, tone: "cyan", icon: "◉" };
  }
}
export function validState(x: unknown): x is LiveState {
  if (!x || typeof x !== "object") return false;
  const s = x as LiveState;
  if (!s.stats || !validTime(s.at) || !Array.isArray(s.events) || s.events.length > 200 || !s.events.every(validEvent)) return false;
  for (const key of ["agentsOnline", "jobsToday", "jobsLastDay", "launchesToday", "priceUsd", "stakedShare", "pulseAt", "marketAt", "observedSince"] as const) {
    const n = s.stats[key]; if (n !== null && (typeof n !== "number" || !Number.isFinite(n) || n < 0)) return false;
  }
  if (s.spotlight) {
    if (!Number.isFinite(s.spotlight.queued) || s.spotlight.queued < 0 || s.spotlight.queued > 20) return false;
    const c = s.spotlight.current;
    if (c && (typeof c.target !== "string" || c.target.length > 100 || typeof c.summary !== "string" || c.summary.length > 200)) return false;
  }
  return true;
}
const validTime = (n: unknown): n is number => typeof n === "number" && Number.isFinite(n) && n >= 0 && n < 8.64e15;
export function validEvent(x: unknown): x is LiveEvent {
  if (!x || typeof x !== "object") return false;
  const e = x as LiveEvent;
  return typeof e.id === "string" && e.id.length <= 80 && validTime(e.at) && typeof e.type === "string" && e.type.length <= 40 && !!e.data && typeof e.data === "object" && Object.values(e.data).every((v) => v === null || typeof v === "boolean" || (typeof v === "string" && v.length <= 500) || (typeof v === "number" && Number.isFinite(v)));
}
