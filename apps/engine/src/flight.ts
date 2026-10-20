import type { Company, Task, TaskStatus, TrailEntry } from "@nightshift/core";
import { fromImd, fromUsdc } from "@nightshift/core";
import type { LedgerTx } from "@nightshift/ledger";
import { buildTree, type SpanKind, type SpanRecord, type SpanStatus } from "@nightshift/trace";
import { config } from "./config.js";
import type { Engine } from "./engine.js";

/**
 * The flight recorder: one shift, rebuilt from its record as a trace (what the CEO saw, each phase
 * and swarm step with its timing, the money that moved) and whether the shift paid for itself.
 * Adapted from Projects/solver's trace explorer, built on the same span model (@nightshift/trace).
 */

const PHASE: Record<TaskStatus, string> = {
  planned: "The CEO decides",
  checking: "IMD's free check",
  awaiting_approval: "Waiting for the owner",
  ordering: "Quote, pay, submit",
  building: "The swarm builds",
  done: "Delivered",
  failed: "Stopped",
  rejected: "Turned down by the owner",
};
const END = new Set<TaskStatus>(["done", "failed", "rejected"]);

export interface FlightInput {
  imdUsd: number;
  /** The owner sees the brief, the files, the model and the full error; the public does not. */
  owner: boolean;
  live: boolean;
  ledger: LedgerTx[];
  sales: { at: number; productId: string; usdc: string; payer: string; tx: string | null }[];
  visits: number[];
}

const ACCOUNT = (c: Company, a: string) =>
  a === `co:${c.id}:imd` ? `${c.name} (IMD)` : a === `co:${c.id}:usdc` ? `${c.name} (USDC)` : a === "ext:imd-swarm" ? "IMD swarm" : a.startsWith("ext:platform") ? "NIGHTSHIFT fee" : a.replace(/^ext:/, "");

export function flight(c: Company, t: Task, o: FlightInput) {
  const recorded = Boolean(t.trail?.length);
  // shifts from before the recorder: what is known is when it started and where it ended
  const trail: TrailEntry[] = recorded ? t.trail! : [
    { at: t.createdAt, status: "planned", activity: null, step: 0 },
    ...(t.status !== "planned" ? [{ at: t.updatedAt, status: t.status, activity: t.activity, step: t.stepsDone }] : []),
  ];
  const costUsd = fromImd(t.costImd) * o.imdUsd;
  const endedAt = END.has(t.status) ? trail.at(-1)!.at : null;
  const plan = t.imd?.plan ?? [];
  const spans: SpanRecord[] = [];
  const span = (id: string, parentId: string | null, kind: SpanKind, name: string, startedAt: number, end: number | null, status: SpanStatus, attrs: Record<string, unknown> = {}, cost = 0): SpanRecord => {
    const s: SpanRecord = { id, traceId: t.id, parentId, kind, name, startedAt, endedAt: end, status, attrs, costUsd: cost, totalCostUsd: cost, tokens: { prompt: 0, completion: 0 } };
    spans.push(s);
    return s;
  };

  const root = span(t.id, null, "run", `Shift ${t.cycle}: ${t.title}`, t.createdAt, endedAt, endedAt === null ? "running" : t.status === "done" ? "ok" : "error", { kind: t.kind });

  // consecutive entries with the same status are one phase
  const groups: TrailEntry[][] = [];
  for (const e of trail) {
    const g = groups.at(-1);
    if (g && g[0]!.status === e.status) g.push(e);
    else groups.push([e]);
  }
  groups.forEach((g, i) => {
    const status = g[0]!.status;
    const next = groups[i + 1]?.[0];
    const start = g[0]!.at;
    const end = !recorded && status === "planned" ? start : next ? next.at : END.has(status) ? start : null;
    const log = g.filter((e, k) => e.activity && e.activity !== g[k - 1]?.activity).slice(-30).map((e) => ({ at: e.at, text: e.activity }));
    const state: SpanStatus = end === null ? "running" : status === "failed" ? "error" : "ok";
    const id = `${t.id}:${i}`;
    if (status === "planned") {
      const m = t.mind;
      span(id, root.id, m?.by === "model" ? "llm_call" : "custom", PHASE.planned, start, end, state, {
        by: m?.by ?? null,
        ...(o.owner && m?.model ? { model: m.model } : {}),
        ...(m?.fallback ? { fallback: m.fallback } : {}),
        ...(m ? { saw: m.saw } : {}),
        why: t.why,
      }, m?.costUsd ?? 0);
    } else if (status === "ordering") {
      span(id, root.id, "tx", PHASE.ordering, start, end, state, { log, orderId: t.imd?.orderId ?? null }, costUsd);
    } else if (status === "building") {
      span(id, root.id, "custom", PHASE.building, start, end, state, { log });
      const total = Math.max(t.stepsTotal, plan.length);
      for (let k = 0; k < total; k++) {
        const from = k === 0 ? start : g.find((e) => e.step >= k)?.at;
        if (from === undefined) break;
        const finished = g.find((e) => e.step >= k + 1)?.at;
        const to = finished ?? next?.at ?? null;
        span(`${id}:${k}`, id, "experiment", plan[k] ?? `Step ${k + 1}`, from, to, to === null ? "running" : finished === undefined && next?.status !== "done" ? "error" : "ok");
      }
    } else {
      span(id, root.id, "custom", PHASE[status], start, end, state, {
        log,
        ...(status === "failed" ? { error: o.owner ? t.error : "It did not go through. Nothing more was spent on it." } : {}),
      });
    }
  });
  if (!recorded && trail.length > 1) {
    span(`${t.id}:legacy`, root.id, "custom", "Not kept in detail (before the recorder)", t.createdAt, trail.at(-1)!.at, "ok", {}, costUsd);
  }
  root.totalCostUsd = spans.reduce((a, s) => a + (s.id === root.id ? 0 : s.costUsd), 0);

  const ids = t.imd?.orderId ? new Set([`imd:${t.imd.orderId}`, `imd-reversal:${t.imd.orderId}`]) : new Set<string>();
  const ledger = o.ledger.filter((x) => ids.has(x.id)).map((x) => ({
    id: x.id, kind: x.kind, memo: x.memo, at: new Date(x.at).getTime(),
    legs: x.postings.map((p) => ({ account: ACCOUNT(c, p.account), asset: p.asset, amount: Number(p.amount) / (p.asset === "IMD" ? 1e18 : 1e6) })),
  }));

  // did it pay for itself: what the product it built has earned, or the visits the site it built has had
  const product = t.kind === "build_product" ? c.products.find((p) => p.id === t.productId || p.taskId === t.id) : undefined;
  const payback = product ? {
    kind: "product" as const, name: product.name, status: product.status, sales: product.sales, revenueUsd: fromUsdc(product.revenueUsdc), costUsd,
    ratio: costUsd > 0 ? fromUsdc(product.revenueUsdc) / costUsd : null,
    recent: o.sales.filter((s) => s.productId === product.id).slice(-8).reverse().map((s) => ({ at: s.at, usd: Number(s.usdc) / 1e6, ...(o.owner ? { payer: s.payer, tx: s.tx } : {}) })),
  } : (t.kind === "build_site" || t.kind === "improve_site") && t.status === "done" && endedAt ? {
    kind: "site" as const, visits: o.visits.filter((v) => v >= endedAt).length, costUsd,
  } : null;

  const files = o.owner ? t.result?.files ?? null : null;
  return {
    id: t.id, cycle: t.cycle, kind: t.kind, title: t.title, why: t.why, status: t.status,
    error: t.error ? (o.owner ? t.error : "It did not go through.") : null,
    createdAt: t.createdAt, endedAt, durationMs: (endedAt ?? Date.now()) - t.createdAt,
    activity: t.activity, recorded,
    mind: t.mind ? { by: t.mind.by, costUsd: t.mind.costUsd ?? 0, saw: t.mind.saw, ...(t.mind.fallback ? { fallback: t.mind.fallback } : {}), ...(o.owner && t.mind.model ? { model: t.mind.model } : {}) } : null,
    plan,
    steps: { done: t.stepsDone, total: Math.max(t.stepsTotal, plan.length) },
    trace: buildTree(spans),
    money: { costImd: fromImd(t.costImd), costUsd, imdUsd: o.imdUsd, ledger },
    payback,
    receipts: {
      orderId: t.imd?.orderId ?? null,
      jobId: t.imd?.jobId ?? null,
      jobUrl: o.live && t.imd?.jobId ? `https://explorer.imd.fun/jobs/${t.imd.jobId}` : null,
      txHash: t.imd?.txHash ?? null,
      txUrl: o.live && t.imd?.txHash ? `https://etherscan.io/tx/${t.imd.txHash}` : null,
      siteUrl: t.result?.siteUrl ?? null,
      files,
    },
    ...(o.owner && t.imd ? { brief: String((t.imd.input as { objective?: unknown })?.objective ?? "") } : {}),
    company: { name: c.name, slug: c.slug },
  };
}

export type Flight = ReturnType<typeof flight>;

/** One shift's flight record from the engine's books, for its owner (everything) or the public. */
export async function flightFor(engine: Engine, c: Company, taskId: string, owner: boolean): Promise<Flight | null> {
  const t = c.tasks.find((x) => x.id === taskId || String(x.cycle) === taskId);
  if (!t) return null;
  const m = engine.store.metricsOf(c.id);
  return flight(c, t, { imdUsd: config.imdUsd, owner, live: config.mode === "live", ledger: await engine.ledger.store.list(`co:${c.id}:`), sales: m.sales, visits: m.visits });
}
