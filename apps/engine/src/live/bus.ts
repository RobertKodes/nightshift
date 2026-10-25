import { randomBytes } from "node:crypto";

export type LivePayloads = {
  "imd.pulse": { agentsOnline: number | null; jobsLastDay: number | null; at: number; ok: boolean };
  "imd.job": { job: string; kind: string; summary: string };
  "imd.launch": { launch: number; name: string; verdict: string; summary: string; update?: boolean };
  "shift.buy": { usd: number; eth: number | null; buyer: string; test?: boolean };
  "shift.burn": { amount: number };
  "shift.stake": { share: number };
  "crew.job": { crew: string; kind: string; summary: string; test?: boolean };
  "watchtower.change": { token: string; summary: string };
  "agent.docked": { client: string };
  "tg.request": { kind: "ask" | "watchtower" | "buildcheck"; summary: string };
  "spotlight.queued": { item: string; kind: "token" | "agent"; target: string; position: number };
  "spotlight.started": { item: string; kind: "token" | "agent"; target: string };
  "spotlight.result": { item: string; kind: "token" | "agent"; target: string; summary: string; ok: boolean };
  "game.live": { count: number; house: number };
};
export type LiveType = keyof LivePayloads;
export type LiveEvent = { [K in LiveType]: { id: string; at: number; type: K; data: LivePayloads[K] } }[LiveType];
export type LiveStats = {
  agentsOnline: number | null; jobsToday: number; jobsLastDay: number | null; launchesToday: number;
  priceUsd: number | null; stakedShare: number | null; pulseAt: number | null; pulseOk: boolean;
  marketAt: number | null; observedSince: number;
};

/** External text becomes a bounded public caption. */
export function publicText(s: unknown, max = 180): string {
  return String(s ?? "").replace(/<[^>]*>/g, " ")
    .replace(/https?:\/\/\S+/gi, "[link]")
    .replace(/0x[0-9a-f]{40,64}/gi, (a) => `${a.slice(0, 6)}…${a.slice(-4)}`)
    .replace(/\b(?:\d{1,3}\.){3}\d{1,3}\b/g, "[address]")
    .replace(/\b(?:[0-9a-f]{0,4}:){2,}[0-9a-f:]+\b/gi, "[address]")
    .replace(/[\w.+-]+@[\w.-]+\.[a-z]{2,}/gi, "[private]")
    .replace(/@[\w]+/g, "[anonymous]")
    .replace(/\b(?:bearer|api[_-]?key|token|password|secret)\s*[:=]\s*\S+/gi, "[private]")
    .replace(/[\u0000-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069<>]/g, " ")
    .replace(/\s+/g, " ").trim().slice(0, max);
}
const n = (v: unknown): number => typeof v === "number" && Number.isFinite(v) ? Math.max(0, Math.min(v, 1e16)) : 0;
const nullable = (v: unknown): number | null => typeof v === "number" && Number.isFinite(v) && v >= 0 ? n(v) : null;
const id = (v: unknown) => String(v ?? "").replace(/[^\w.-]/g, "").slice(0, 80);
const target = (v: unknown) => publicText(v, 96);

/** Rebuild every payload from allowed fields; private extras never reach the wire. */
function safe<K extends LiveType>(type: K, x: LivePayloads[K]): LivePayloads[K] {
  const d = x as unknown as Record<string, unknown>;
  let out: unknown;
  switch (type) {
    case "imd.pulse": out = { agentsOnline: nullable(d.agentsOnline), jobsLastDay: nullable(d.jobsLastDay), at: n(d.at), ok: d.ok === true }; break;
    case "imd.job": out = { job: id(d.job), kind: publicText(d.kind, 40), summary: publicText(d.summary) }; break;
    case "imd.launch": out = { launch: n(d.launch), name: publicText(d.name, 44), verdict: publicText(d.verdict, 32), summary: publicText(d.summary), update: d.update === true }; break;
    case "shift.buy": out = { usd: n(d.usd), eth: nullable(d.eth), buyer: publicText(d.buyer, 24), test: d.test === true }; break;
    case "shift.burn": out = { amount: n(d.amount) }; break;
    case "shift.stake": out = { share: Math.min(1, n(d.share)) }; break;
    case "crew.job": out = { crew: publicText(d.crew, 48), kind: publicText(d.kind, 48), summary: publicText(d.summary), test: d.test === true }; break;
    case "watchtower.change": out = { token: publicText(d.token, 32), summary: publicText(d.summary) }; break;
    case "agent.docked": out = { client: publicText(d.client, 40) }; break;
    case "tg.request": out = { kind: ["ask", "watchtower", "buildcheck"].includes(String(d.kind)) ? d.kind : "ask", summary: publicText(d.summary, 140) }; break;
    case "spotlight.queued": out = { item: id(d.item), kind: d.kind === "token" ? "token" : "agent", target: target(d.target), position: n(d.position) }; break;
    case "spotlight.started": out = { item: id(d.item), kind: d.kind === "token" ? "token" : "agent", target: target(d.target) }; break;
    case "spotlight.result": out = { item: id(d.item), kind: d.kind === "token" ? "token" : "agent", target: target(d.target), summary: publicText(d.summary), ok: d.ok === true }; break;
    case "game.live": out = { count: Math.floor(n(d.count)), house: Math.floor(n(d.house)) }; break;
    default: throw new Error("Unknown live event");
  }
  return out as LivePayloads[K];
}

export class LiveBus {
  #events: LiveEvent[] = [];
  #listeners = new Set<(e: LiveEvent) => void>();
  #seq = 0;
  #epoch = randomBytes(5).toString("hex");
  #launches = new Map<number, LiveEvent & { type: "imd.launch" }>();
  #day = "";
  stats: LiveStats;
  constructor(private readonly now = Date.now) {
    this.stats = { agentsOnline: null, jobsToday: 0, jobsLastDay: null, launchesToday: 0, priceUsd: null, stakedShare: null, pulseAt: null, pulseOk: false, marketAt: null, observedSince: now() };
  }
  #roll() {
    const day = new Date(this.now()).toISOString().slice(0, 10);
    if (day !== this.#day) { this.#day = day; this.stats.jobsToday = 0; this.stats.launchesToday = 0; }
  }
  emit<K extends LiveType>(type: K, payload: LivePayloads[K]): LiveEvent {
    this.#roll();
    let data = safe(type, payload);
    let eventId = `${this.#epoch}-${++this.#seq}`;
    if (type === "imd.launch") {
      const d = data as LivePayloads["imd.launch"], old = this.#launches.get(d.launch);
      if (old) {
        if (d.verdict === "unchecked" || (old.data.verdict === d.verdict && old.data.summary === d.summary)) return structuredClone(old);
        eventId = old.id; d.update = true;
        this.#events = this.#events.filter((e) => e.id !== old.id);
      }
    }
    const e = { id: eventId, at: this.now(), type, data } as LiveEvent;
    if (e.type === "imd.pulse") Object.assign(this.stats, { agentsOnline: e.data.agentsOnline, jobsLastDay: e.data.jobsLastDay, pulseAt: e.data.at, pulseOk: e.data.ok });
    if (e.type === "imd.job") this.stats.jobsToday++;
    if (e.type === "imd.launch") {
      this.#launches.set(e.data.launch, e);
      if (this.#launches.size > 1000) this.#launches.delete(this.#launches.keys().next().value!);
    }
    if (e.type === "shift.stake") this.stats.stakedShare = e.data.share;
    this.#events.push(e); this.#events = this.#events.slice(-200);
    for (const f of this.#listeners) try { f(structuredClone(e)); } catch { /* a viewer never breaks a source */ }
    return structuredClone(e);
  }
  recent(limit = 50): LiveEvent[] { const n = Number.isFinite(limit) ? Math.min(200, Math.max(0, Math.floor(limit))) : 0; return n ? structuredClone(this.#events.slice(-n)) : []; }
  snapshot() { this.#roll(); return { at: this.now(), stats: { ...this.stats }, events: this.recent(), simulated: false }; }
  on(f: (e: LiveEvent) => void): () => void { this.#listeners.add(f); return () => { this.#listeners.delete(f); }; }
}

export const liveBus = new LiveBus();
/** Call after a public Telegram reply; no chat or user identity is accepted. */
export function liveTelegram(kind: "ask" | "watchtower" | "buildcheck", summary: string): void {
  liveBus.emit("tg.request", { kind, summary });
}
