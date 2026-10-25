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
  return [...houseProfiles({ prices: housePrices(), metrics: (c) => l.metrics(c), base: config.publicUrl }), ...externalProfiles(crewOperators(), (c) => l.metrics(c))];
}
export const crewSeason = () => season(crewLedger(), { startAt: seasonStart(), operators: crewOperators().all() });

/**
 * One paid call of a house service, recorded once (keyed on the payment's payer and nonce). The answer
 * was computed before the payment was settled, so a failed answer is recorded as failed and was never charged.
 */
export function recordPaid(o: Offer, r: { payer: string; nonce: string; usd: number; tx: string | null; network: string; ok: boolean; summary?: string; error?: string; sim?: boolean }): void {
  const l = crewLedger();
  const job = l.start({
    key: `${r.payer.toLowerCase()}:${r.nonce.toLowerCase()}`, crew: o.crew, operator: "house", kind: o.id, free: false,
    payment: { usd: r.usd, payer: r.payer, tx: r.tx, network: r.network, sim: r.sim }, customer: `w:${r.payer.toLowerCase()}`,
  });
  if (job.status !== "running") return;
  if (r.ok) l.done(job.id, { summary: r.summary ?? `${o.name}: answered and settled` });
  else l.fail(job.id, r.error ?? "the answer failed; nothing was charged");
}
