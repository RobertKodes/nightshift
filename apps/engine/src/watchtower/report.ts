import { randomBytes } from "node:crypto";
import type { Address } from "viem";
import { RUN_BY } from "../services/context.js";
import type { Change } from "./diff.js";
import { type Json, type Kind, type Observation, etherscanAddress, etherscanBlock, shortAddr } from "./observe.js";

/**
 * A Watchtower report: what changed since the previous observation, with the evidence, and
 * exactly what was and was not checked. Counts, not grades: check coverage says how much was
 * read, never how likely a token is to be fine.
 */
export const SCOPE = "Ethereum mainnet (chainId 1) only: ERC-20 token contracts and Uniswap v4 hook contracts.";
export const COVERAGE_NOTE = "Check coverage counts which checks ran. It is not a probability that a token is safe or profitable, and a check that did not run says nothing about what it would have found.";
export const CONFIRMATIONS_NOTE = "Values are read at the node's head block with 0 confirmations (the engine's RPC reader takes no block tag); a reorg can still replace that block.";

export type WatchReport = {
  id: string; service: "watchtower"; runBy: string;
  address: Address; chain: "ethereum"; chainId: 1; kind: Kind; scope: string;
  /** What this run was compared with: null on the first observation. */
  baseline: { at: string; block: number } | null;
  /** This run's observation; on a failed run, the last good one. A watch keeps it on its newest report only (older ones: null). */
  observation: Observation | null;
  changes: Change[];
  unavailable: { id: string; label: string; reason: string; lastValue?: Json; lastBlock?: number | null }[];
  unsupported: { id: string; label: string; reason: string }[];
  counts: { completed: number; changes: number; unavailable: number; unsupported: number };
  /** True when the run failed (the head block could not be read) or the data is older than the watch's threshold. */
  stale: boolean; staleReason: string | null;
  summary: string; human: string; coverageNote: string;
  generatedAt: string;
};

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
const shortLabel = (l: string) => l.split(" (")[0]!;
const lower1 = (s: string) => s[0]!.toLowerCase() + s.slice(1);
const ago = (ms: number) => (ms < 90 * 60_000 ? `${Math.max(1, Math.round(ms / 60_000))} min` : ms < 48 * 3_600_000 ? `${Math.round(ms / 3_600_000)} h` : `${Math.round(ms / 86_400_000)} days`);
export const newId = (prefix: string) => `${prefix}_${randomBytes(8).toString("hex")}`;

/** A value as a report shows it. */
export function fmt(v: Json): string {
  if (v === null) return "not present";
  if (typeof v === "object" && !Array.isArray(v) && typeof v.totalUsd === "number") return `$${(v.totalUsd as number).toLocaleString("en-US")} (${v.pairs} pair${v.pairs === 1 ? "" : "s"})`;
  if (typeof v === "object") return JSON.stringify(v);
  return String(v);
}

function lists(obs: Observation, changes: Change[]) {
  const unavailable: WatchReport["unavailable"] = Object.entries(obs.checks).filter(([, c]) => c.status === "unavailable")
    .map(([id, c]) => {
      const lost = changes.find((x) => x.id === `coverage:${id}` && x.after === "unavailable" && x.before !== "unavailable");
      return { id, label: c.label, reason: c.reason ?? "did not answer", ...(lost ? { lastValue: lost.before, lastBlock: lost.beforeBlock } : {}) };
    });
  // checks that ran before and were not read at all this time
  for (const x of changes) if (x.kind === "coverage" && x.after === "unavailable" && !(x.field in obs.checks)) unavailable.push({ id: x.field, label: x.label, reason: "not read this time", lastValue: x.before, lastBlock: x.beforeBlock });
  const unsupported = Object.entries(obs.checks).filter(([, c]) => c.status === "unsupported").map(([id, c]) => ({ id: id.replace(/^unsupported\./, ""), label: c.label, reason: c.reason ?? "no reader" }));
  return { unavailable, unsupported, completed: Object.values(obs.checks).filter((c) => c.status === "ok").length };
}

/** The one-line count every report and job carries. */
function countLine(completed: number, real: Change[], unavailable: WatchReport["unavailable"], unsupported: WatchReport["unsupported"], baseline: boolean): string {
  const bySev = ["critical", "high", "medium", "low", "info"].map((s) => [s, real.filter((c) => c.severity === s).length] as const).filter(([, n]) => n > 0).map(([s, n]) => `${n} ${s}`);
  const parts = [plural(completed, "check") + " completed"];
  if (!baseline) parts.push(`${plural(real.length, "change")} detected${bySev.length ? ` (${bySev.join(", ")})` : ""}`);
  parts.push(`${plural(unavailable.length, "check")} unavailable${unavailable.length ? ` (${unavailable.map((u) => lower1(shortLabel(u.label))).join(", ")})` : ""}`);
  parts.push(unsupported.length ? `these checks are not supported: ${unsupported.map((u) => lower1(shortLabel(u.label))).join(", ")}` : "no unsupported checks");
  return parts.join(", ");
}

/** A report for a completed observation. `baseline` is what it was compared with (null: the first one). */
export function buildReport(i: { obs: Observation; baseline: Observation | null; changes: Change[]; now: number; staleAfterMs?: number }): WatchReport {
  const { obs, baseline, changes } = i;
  const { unavailable, unsupported, completed } = lists(obs, changes);
  const real = changes.filter((c) => c.kind === "change");
  const age = i.now - obs.at;
  const stale = i.staleAfterMs !== undefined && age > i.staleAfterMs;
  const n = obs.block.number;
  const counts = countLine(completed, real, unavailable, unsupported, !baseline);
  const summary = baseline
    ? `Block ${n.toLocaleString("en-US")} compared with block ${baseline.block.number.toLocaleString("en-US")}: ${counts}.`
    : `Baseline recorded at block ${n.toLocaleString("en-US")}; nothing to compare yet. ${counts[0]!.toUpperCase()}${counts.slice(1)}.`;
  const report: WatchReport = {
    id: newId("r"), service: "watchtower", runBy: RUN_BY, address: obs.address, chain: "ethereum", chainId: 1, kind: obs.kind, scope: SCOPE,
    baseline: baseline ? { at: new Date(baseline.at).toISOString(), block: baseline.block.number } : null,
    observation: obs, changes, unavailable, unsupported,
    counts: { completed, changes: real.length, unavailable: unavailable.length, unsupported: unsupported.length },
    stale, staleReason: stale ? `The data is ${ago(age)} old.` : null,
    summary, human: "", coverageNote: COVERAGE_NOTE, generatedAt: new Date(i.now).toISOString(),
  };
  report.human = renderHuman(report);
  return report;
}

/** A report for a run that could not read the chain: no new data, the last good data named, nothing called unchanged. */
export function failedReport(i: { address: Address; kind: Kind; last: Observation | null; reason: string; now: number }): WatchReport {
  const lastText = i.last ? `; the last data is from block ${i.last.block.number.toLocaleString("en-US")} (${ago(i.now - i.last.at)} ago)` : "";
  const summary = `Run failed: ${i.reason.replace(/\.$/, "")}. No new data${lastText}, so changes since then are unknown. The next run retries at the next interval.`;
  const report: WatchReport = {
    id: newId("r"), service: "watchtower", runBy: RUN_BY, address: i.address, chain: "ethereum", chainId: 1, kind: i.kind, scope: SCOPE,
    baseline: null, observation: i.last, changes: [], unavailable: [], unsupported: [],
    counts: { completed: 0, changes: 0, unavailable: 0, unsupported: 0 },
    stale: true, staleReason: i.reason, summary, human: "", coverageNote: COVERAGE_NOTE, generatedAt: new Date(i.now).toISOString(),
  };
  report.human = `**Watchtower · ${i.kind} ${shortAddr(i.address)} · Ethereum mainnet**\n\n${summary}\n\n_${COVERAGE_NOTE}_`;
  return report;
}

const blockLink = (b: number | null) => (b === null ? "?" : `[${b.toLocaleString("en-US")}](${etherscanBlock(b)})`);
const code = (v: Json) => `\`${fmt(v)}\``;

/** The short markdown a person reads (the watch page, a Telegram alert): before → after, with the links. */
export function renderHuman(r: WatchReport, only?: Change[]): string {
  const obs = r.observation;
  const out: string[] = [];
  out.push(`**Watchtower · ${r.kind} [${shortAddr(r.address)}](${etherscanAddress(r.address)}) · Ethereum mainnet**`);
  if (obs) out.push(r.baseline ? `Read at block ${blockLink(obs.block.number)}, compared with block ${blockLink(r.baseline.block)}.` : `Baseline recorded at block ${blockLink(obs.block.number)}; nothing to compare yet.`);
  const changes = (only ?? r.changes);
  const real = changes.filter((c) => c.kind === "change");
  const lost = changes.filter((c) => c.kind === "coverage" && c.after === "unavailable");
  if (real.length) {
    out.push("**Changes**");
    for (const c of real.slice(0, 10)) {
      const pair = c.evidence.find((e) => e.includes("dexscreener.com"));
      out.push(`- **${c.severity.toUpperCase()}** ${c.label}: ${code(c.before)} → ${code(c.after)} (blocks ${blockLink(c.beforeBlock)} → ${blockLink(c.afterBlock)}${pair ? `, [pair](${pair})` : ""})`);
    }
    if (real.length > 10) out.push(`- and ${real.length - 10} more`);
  }
  if (lost.length) {
    out.push("**Coverage lost**");
    for (const c of lost.slice(0, 10)) out.push(`- ${c.label}: unavailable this run${c.before !== "unavailable" ? `; last value ${code(c.before)} at block ${blockLink(c.beforeBlock)}` : ""}. Changes there are unknown.`);
  }
  if (!only) out.push(`${plural(r.counts.completed, "check")} completed, ${r.baseline ? `${plural(r.counts.changes, "change")} detected, ` : ""}${plural(r.counts.unavailable, "check")} unavailable. Not supported: ${r.unsupported.map((u) => lower1(shortLabel(u.label))).join(", ") || "none"}.`);
  out.push(`_${CONFIRMATIONS_NOTE} ${COVERAGE_NOTE}_`);
  return out.join("\n");
}

/** The public-safe line for the job ledger: counts only, no address and no customer data. */
export function jobSummary(r: WatchReport, what: string): string {
  if (r.stale && !r.counts.completed) return `${what} 1 ${r.kind}: run failed (no new data), retrying next interval`;
  const lost = r.counts.unavailable;
  return `${what} 1 ${r.kind}: ${r.baseline ? `${plural(r.counts.changes, "change")} detected` : "baseline recorded"}, ${plural(r.counts.completed, "check")} completed, ${plural(lost, "check")} unavailable`;
}
