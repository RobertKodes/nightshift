import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { writeAtomic } from "../atomic.js";
import { config } from "../config.js";
import { OFFERS, type Offer, holderPriceOf, usdOf } from "../services/catalog.js";
import type { CrewEvent, CrewProfile } from "./contracts.js";
import { JobLedger } from "./ledger.js";
import { Operators } from "./operators.js";
import { type HousePrice, externalProfiles, houseProfiles } from "./profiles.js";
import { season } from "./season.js";
import type { Highlight } from "../recruiter/recruiter.js";
import type { JobEvent as WatchJob, Watch, WatchReport, Watchtower } from "../watchtower/index.js";
import type { PaidRecord } from "../services/routes.js";

/**
 * The crews as the running engine sees them: one job ledger and one operator registry on disk, the
 * season's start (recorded the first time this build runs), and the price list taken from the
 * services catalogue, so a crew page can never show a price the x402 router does not charge.
 */
let ledger: JobLedger | null = null;
let operators: Operators | null = null;
const listeners = new Set<(e: CrewEvent) => void>();

export function crewLedger(): JobLedger {
  return (ledger ??= new JobLedger({ file: join(config.dataDir, "crews.json"), onEvent: (e) => { for (const l of listeners) try { l(e); } catch { /* a listener never breaks a job */ } } }));
}
export function crewOperators(): Operators {
  return (operators ??= new Operators({ file: join(config.dataDir, "operators.json") }));
}
/** Every crew event as it happens (the live feeds subscribe here). */
export function onCrewEvent(l: (e: CrewEvent) => void): () => void { listeners.add(l); return () => listeners.delete(l); }

let watchtower: Watchtower | null = null;
export const setLiveWatchtower = (w: Watchtower | null) => { watchtower = w; };
export const liveWatchtower = () => watchtower;

/**
 * Watchtower's own runs in the ledger: free samples and every monitoring run of a watch. Paid checks and
 * watch starts are recorded by the x402 router with their payment, so they are not counted twice.
 */
export function recordWatchJob(e: WatchJob): void {
  if (!e.free && (e.kind === "watch.check" || e.kind === "watch.start")) return;
  const l = crewLedger(), j = l.start({ crew: "watchtower", operator: "house", kind: e.kind, free: true });
  if (e.status === "done") l.done(j.id, { summary: e.summary }); else l.fail(j.id, e.summary);
}

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const val = (v: unknown) => { const s = typeof v === "string" ? v : JSON.stringify(v); return esc(String(s ?? "none").slice(0, 60)); };
/** One Watchtower alert for Telegram: what changed, with before and after, what could not be checked, and how to stop. */
export function watchAlert(w: Watch, r: WatchReport, unsubscribe: string): string {
  const lines = [`🛰 <b>Watchtower</b> · <code>${esc(w.address)}</code>`, esc(r.summary), ""];
  for (const c of r.changes.slice(0, 6)) lines.push(`• <b>${esc(c.field)}</b> (${c.severity}): ${val(c.before)} → ${val(c.after)}`);
  if (r.unavailable.length) lines.push(`⚠️ Could not check: ${esc(r.unavailable.map((u) => u.label).slice(0, 4).join(", "))}`);
  if (r.stale) lines.push("⚠️ The data is stale: a source did not answer. This is not an all-clear.");
  lines.push("", `<a href="https://etherscan.io/address/${esc(w.address)}">Etherscan</a> · <a href="${esc(unsubscribe)}">Stop these alerts</a>`);
  return lines.join("\n");
}

/** /start wt_<code> in a private chat with the bot: that chat gets the watch's alerts. */
export function linkWatchAlerts(chat: string, code: string): { text: string } | null {
  const w = watchtower?.linkTelegram(code.replace(/^wt_/, ""), chat);
  return w ? { text: `🛰 <b>Watchtower alerts are on</b> for <code>${esc(w.address)}</code> until ${w.expiresAt.slice(0, 16).replace("T", " ")} UTC. You get a message when something changes, or when a check stops working.` } : null;
}

/** What the recruiter may post about: only real crew work, and only when there is enough of it. */
export function crewHighlights(now = Date.now()): Highlight[] {
  const l = crewLedger(), since = now - 86_400_000, day = new Date(now).toISOString().slice(0, 10);
  const done = l.list({ since, status: "done", limit: 5000 }).filter((j) => j.operator === "house");
  const out: Highlight[] = [];
  if (done.length >= 5) {
    const by = (c: string) => done.filter((j) => j.crew === c).length;
    out.push({ id: `jobs-${day}`, text: `In the last 24 hours NIGHTSHIFT's house crews finished ${done.length} jobs: Watchtower ${by("watchtower")}, Research Desk ${by("research")}, Build & Check ${by("buildcheck")}. Every job is on the crew pages.`, path: "/crews" });
  }
  for (const o of crewOperators().all()) if (o.status === "active" && o.activatedAt && o.activatedAt > since) out.push({ id: `op-${o.id}`, text: `A new crew joined NIGHTSHIFT: ${o.name} passed its onboarding run and now takes work.`, path: "/crews" });
  return out;
}

/** Season 1 starts the first time this build runs against the data folder, and that moment is kept. */
export function seasonStart(now = Date.now()): number {
  const f = join(config.dataDir, "season.json");
  try { if (existsSync(f)) { const v = Number((JSON.parse(readFileSync(f, "utf8")) as { startAt?: number }).startAt); if (v > 0) return v; } } catch { /* rewrite it */ }
  writeAtomic(f, JSON.stringify({ id: "S1", startAt: now }));
  return now;
}

export const housePrices = (): HousePrice[] => OFFERS.map((o) => ({ offer: o.id, label: o.name, usd: usdOf(o), holderUsd: Number(holderPriceOf(o)) / 1e6, crew: o.crew }));

export function crewProfiles(): CrewProfile[] {
  const l = crewLedger();
  return [...houseProfiles({ prices: housePrices(), metrics: (c) => l.metrics(c), base: config.publicUrl, swarmEnabled: config.swarmDesk && config.mode === "live" && config.salesChainId === 8453, swarmDailyImd: config.swarmDeskDailyImd }), ...externalProfiles(crewOperators(), (c) => l.metrics(c))];
}
export const crewSeason = () => season(crewLedger(), { startAt: seasonStart(), operators: crewOperators().all() });

/**
 * One paid call of a house service, recorded once (keyed on the payment's payer and nonce). The answer
 * may precede settlement for checks, or follow settlement for Swarm Desk. Pending swarm jobs finish
 * when their delivery or refund owed is recorded.
 */
export function recordPaid(o: Offer, r: PaidRecord): void {
  const l = crewLedger();
  const job = l.start({
    key: `${r.payer.toLowerCase()}:${r.nonce.toLowerCase()}`, crew: o.crew, operator: "house", kind: r.kind ?? o.id, free: false,
    payment: { usd: r.usd, payer: r.payer, tx: r.tx, network: r.network, sim: r.sim }, customer: `w:${r.payer.toLowerCase()}`,
  });
  if (job.status !== "running" || r.pending) return;
  if (r.ok) l.done(job.id, { summary: r.summary ?? `${o.name}: answered and settled`, costUsd: r.costUsd });
  else l.fail(job.id, r.error ?? "the answer failed; nothing was charged", r.costUsd);
}
