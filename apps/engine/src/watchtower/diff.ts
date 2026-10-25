import { type Check, type Group, type Json, type Liquidity, type Observation, etherscanAddress, etherscanBlock } from "./observe.js";

/**
 * What changed between two observations of one contract, and how much it matters. A check that
 * ran before and did not run now is a coverage item, never "no change": nobody knows what it
 * would have shown.
 */
export type Severity = "info" | "low" | "medium" | "high" | "critical";
export const SEVERITIES: Severity[] = ["info", "low", "medium", "high", "critical"];
export const rank = (s: Severity): number => SEVERITIES.indexOf(s);
export const isSeverity = (s: unknown): s is Severity => typeof s === "string" && (SEVERITIES as string[]).includes(s);

export type Change = {
  /** Stable per check ("owner()", "coverage:liquidity"): with `after`, the key alerts are deduplicated on. */
  id: string;
  /** "change": a value moved. "coverage": a check stopped (after = "unavailable") or started again (after = "available") answering. */
  kind: "change" | "coverage";
  field: string; label: string; severity: Severity;
  before: Json; after: Json;
  beforeBlock: number | null; afterBlock: number | null;
  /** Links to verify it: the contract, both blocks, the DexScreener pairs. */
  evidence: string[];
  /** One plain sentence. */
  note: string;
};

/** Defaults, overridable per watch. Severity per group replaces the computed one for that group. */
export type Thresholds = {
  /** Liquidity: a move of at least this share AND at least liquidityMinUsd is medium… */
  liquidityMediumPct: number;
  /** …and at least this share is high. */
  liquidityHighPct: number;
  liquidityMinUsd: number;
  /** Total supply: a move above this share is a change (medium). */
  supplyPct: number;
  severity: Partial<Record<Group, Severity>>;
};
export const DEFAULT_THRESHOLDS: Thresholds = { liquidityMediumPct: 30, liquidityHighPct: 60, liquidityMinUsd: 5_000, supplyPct: 1, severity: {} };
/** Default severity of a change, by what the check is about. Fees: medium, high when a fee went up. */
export const DEFAULT_SEVERITY: Record<Group, Severity> = {
  code: "high", implementation: "high", admin: "high", beacon: "high", owner: "high", paused: "high", gate: "high", decimals: "high",
  token: "low", supply: "medium", fee: "medium", feeRecipient: "medium", liquidity: "medium", other: "medium",
};

/** Thresholds from a partial input, checked: numbers in range, known severities. Throws a plain message otherwise. */
export function thresholdsOf(p: unknown = {}): Thresholds {
  const t: Thresholds = { ...DEFAULT_THRESHOLDS, severity: {} };
  if (p === null || typeof p !== "object") throw new Error("thresholds must be an object");
  const o = p as Record<string, unknown>;
  const num = (k: "liquidityMediumPct" | "liquidityHighPct" | "liquidityMinUsd" | "supplyPct", lo: number, hi: number) => {
    if (o[k] === undefined) return;
    const v = o[k];
    if (typeof v !== "number" || !Number.isFinite(v) || v < lo || v > hi) throw new Error(`thresholds.${k} must be a number from ${lo} to ${hi}`);
    t[k] = v;
  };
  num("liquidityMediumPct", 1, 100); num("liquidityHighPct", 1, 100); num("liquidityMinUsd", 0, 1e9); num("supplyPct", 0, 100);
  if (t.liquidityHighPct < t.liquidityMediumPct) throw new Error("thresholds.liquidityHighPct must be at least liquidityMediumPct");
  if (o.severity !== undefined) {
    if (!o.severity || typeof o.severity !== "object") throw new Error("thresholds.severity must be an object");
    for (const [g, s] of Object.entries(o.severity as Record<string, unknown>)) {
      if (!(g in DEFAULT_SEVERITY)) throw new Error(`thresholds.severity: unknown group ${g}`);
      if (!isSeverity(s)) throw new Error(`thresholds.severity.${g} must be one of ${SEVERITIES.join(", ")}`);
      t.severity[g as Group] = s;
    }
  }
  return t;
}

/** Order-independent JSON: equal values give equal text. */
export function stable(v: Json | undefined): string {
  if (v === undefined) return "undefined";
  if (v === null || typeof v !== "object") return JSON.stringify(v);
  if (Array.isArray(v)) return `[${v.map(stable).join(",")}]`;
  return `{${Object.keys(v).sort().map((k) => `${JSON.stringify(k)}:${stable(v[k])}`).join(",")}}`;
}

const num = (v: Json): number | null => (typeof v === "number" ? v : typeof v === "string" && /^\d+$/.test(v) ? Number(v) : null);
const liq = (v: Json): Liquidity | null => (v && typeof v === "object" && !Array.isArray(v) && typeof v.totalUsd === "number" ? (v as unknown as Liquidity) : null);
const pct = (x: number) => Math.round(x * 10) / 10;

export type DiffResult = {
  changes: Change[];
  /** Fields that moved but stayed under their threshold (liquidity, supply): a watch keeps the older reference for them, so a slow drain still adds up to a change. */
  held: string[];
};

/** Every change from `a` to `b`, worst first. */
export function diff(a: Observation, b: Observation, t: Thresholds = DEFAULT_THRESHOLDS): Change[] {
  return diffDetailed(a, b, t).changes;
}

export function diffDetailed(a: Observation, b: Observation, t: Thresholds = DEFAULT_THRESHOLDS): DiffResult {
  const changes: Change[] = [];
  const held: string[] = [];
  const addr = etherscanAddress(b.address);
  const blockOf = (c: Check | undefined, o: Observation) => (c ? c.block ?? o.block.number : null);
  const links = (ca: Check | undefined, cb: Check | undefined, extra: string[] = []) => [...new Set([addr, ...(ca ? [etherscanBlock(blockOf(ca, a)!)] : []), ...(cb ? [etherscanBlock(blockOf(cb, b)!)] : []), ...extra])];
  const sev = (g: Group, computed: Severity): Severity => t.severity[g] ?? computed;

  for (const field of new Set([...Object.keys(a.checks), ...Object.keys(b.checks)])) {
    const ca = a.checks[field], cb = b.checks[field];
    if (!ca || ca.status === "unsupported") continue; // no baseline for it: the new reading becomes one
    const label = (cb ?? ca).label;
    if (ca.status === "unavailable") {
      if (!cb) continue; // replaced by other checks (the fee placeholder, once the fee getters are found)
      if (cb.status === "ok") changes.push({ id: `coverage:${field}`, kind: "coverage", field, label, severity: "info", before: "unavailable", after: "available", beforeBlock: blockOf(ca, a), afterBlock: blockOf(cb, b), evidence: links(undefined, cb, [cb.source]), note: `${label} answered again; there is no earlier value to compare it with.` });
      else changes.push({ id: `coverage:${field}`, kind: "coverage", field, label, severity: "low", before: "unavailable", after: "unavailable", beforeBlock: blockOf(ca, a), afterBlock: b.block.number, evidence: links(undefined, cb), note: `${label} is still unavailable${cb.reason ? ` (${cb.reason})` : ""}: changes there are unknown.` });
      continue;
    }
    // ca is ok from here
    if (!cb || cb.status !== "ok") {
      const reason = !cb ? "it was not read this time" : cb.reason ?? cb.status;
      changes.push({ id: `coverage:${field}`, kind: "coverage", field, label, severity: "low", before: ca.value, after: "unavailable", beforeBlock: blockOf(ca, a), afterBlock: b.block.number, evidence: links(ca, undefined, [ca.source]),
        note: `${label} could not be checked (${reason}). Its last value, ${ca.display ?? stable(ca.value)} at block ${blockOf(ca, a)}, may or may not still hold.` });
      continue;
    }
    if (stable(ca.value) === stable(cb.value)) continue;
    const g = cb.group;
    const base = { id: field, kind: "change" as const, field, label, before: ca.value, after: cb.value, beforeBlock: blockOf(ca, a), afterBlock: blockOf(cb, b) };

    if (g === "liquidity") {
      const x = liq(ca.value), y = liq(cb.value);
      if (x && y) {
        const d = y.totalUsd - x.totalUsd;
        const p = x.totalUsd > 0 ? (Math.abs(d) / x.totalUsd) * 100 : y.totalUsd > 0 ? Infinity : 0;
        if (Math.abs(d) < t.liquidityMinUsd || p < t.liquidityMediumPct) { held.push(field); continue; }
        const urls = [x.top?.url, y.top?.url].filter((u): u is string => Boolean(u));
        changes.push({ ...base, severity: sev(g, p >= t.liquidityHighPct ? "high" : "medium"), evidence: links(ca, cb, urls),
          note: `Liquidity ${d < 0 ? "fell" : "rose"} ${Number.isFinite(p) ? `${pct(p)}%` : "from zero"}, from $${x.totalUsd.toLocaleString("en-US")} to $${y.totalUsd.toLocaleString("en-US")} (DexScreener).` });
        continue;
      }
    }
    if (g === "supply" && typeof ca.value === "string" && typeof cb.value === "string" && /^\d+$/.test(ca.value) && /^\d+$/.test(cb.value)) {
      const x = BigInt(ca.value), y = BigInt(cb.value);
      const d = y > x ? y - x : x - y;
      const p = x === 0n ? Infinity : Number((d * 1_000_000n) / x) / 10_000;
      if (p <= t.supplyPct) { held.push(field); continue; }
      changes.push({ ...base, severity: sev(g, "medium"), evidence: links(ca, cb), note: `Total supply ${y > x ? "grew" : "shrank"} ${Number.isFinite(p) ? `${pct(p)}%` : "from zero"}: ${ca.display ?? ca.value} → ${cb.display ?? cb.value}.` });
      continue;
    }
    if (g === "fee") {
      const x = num(ca.value), y = num(cb.value);
      const up = x !== null && y !== null ? y > x : x === null && y !== null;
      changes.push({ ...base, severity: sev(g, up ? "high" : "medium"), evidence: links(ca, cb), note: `${label} ${up ? "went up" : x !== null && y !== null ? "went down" : "changed"}: ${ca.display ?? stable(ca.value)} → ${cb.display ?? stable(cb.value)}.` });
      continue;
    }
    changes.push({ ...base, severity: sev(g, DEFAULT_SEVERITY[g]), evidence: links(ca, cb), note: `${label} changed: ${ca.display ?? stable(ca.value)} → ${cb.display ?? stable(cb.value)}.` });
  }
  changes.sort((x, y) => rank(y.severity) - rank(x.severity) || (x.kind === y.kind ? 0 : x.kind === "change" ? -1 : 1) || x.field.localeCompare(y.field));
  return { changes, held };
}

/**
 * The baseline a new observation is compared with, from the stored history (newest last): the
 * newest observation, with each check that did not answer there filled from the newest one where
 * it did (that check keeps its own block).
 */
export function mergeHistory(list: Observation[]): Observation | null {
  const last = list.at(-1);
  if (!last) return null;
  const checks: Record<string, Check> = { ...last.checks };
  for (let i = list.length - 2; i >= 0; i--) {
    const o = list[i]!;
    for (const [id, c] of Object.entries(o.checks)) {
      const cur = checks[id];
      if (c.status === "ok" && (!cur || cur.status === "unavailable")) checks[id] = { ...c, block: c.block ?? o.block.number };
    }
  }
  return { ...last, checks };
}

/**
 * A watch's next reference after a run: the new values, except that a check that did not answer
 * keeps its last answer, and a liquidity or supply move under the threshold keeps the older value.
 */
export function advance(ref: Observation | null, obs: Observation, held: string[]): Observation {
  const keep = new Set(held);
  const checks: Record<string, Check> = {};
  const old = (id: string): Check | null => { const c = ref?.checks[id]; return c && c.status === "ok" ? { ...c, block: c.block ?? ref!.block.number } : null; };
  for (const [id, c] of Object.entries(obs.checks)) {
    const prev = old(id);
    if (c.status === "ok" && !(keep.has(id) && prev)) { const { block: _drop, ...fresh } = c; checks[id] = fresh; }
    else checks[id] = prev ?? c;
  }
  for (const id of Object.keys(ref?.checks ?? {})) if (!(id in checks)) { const prev = old(id); if (prev) checks[id] = prev; }
  return { ...obs, checks };
}
