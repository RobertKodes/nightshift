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
  /** Where products are sold (Base or Base Sepolia), for the payment link of a market purchase. */
  salesChainId?: number;
}

const ACCOUNT = (c: Company, a: string, seller?: { id: string; name: string }) =>
  a === `co:${c.id}:imd` ? `${c.name} (IMD)` : a === `co:${c.id}:usdc` ? `${c.name} (USDC)` : seller && a === `co:${seller.id}:usdc` ? `${seller.name} (USDC)` : a === "ext:imd-swarm" ? "IMD swarm" : a.startsWith("ext:platform") ? "NIGHTSHIFT fee" : a.replace(/^ext:/, "");

/** A market purchase's phases are named for what happened: paying another company, not the swarm. */
const marketPay = (g: TrailEntry[]) => /^paying .* over x402$/.test(g[0]?.activity ?? "");
const marketWait = (g: TrailEntry[]) => (g[0]?.activity ?? "").startsWith("paid · waiting for Base") || (g[0]?.activity ?? "").startsWith("paid · confirming with Base");

export function flight(c: Company, t: Task, o: FlightInput) {
  const recorded = Boolean(t.trail?.length);
  // shifts from before the recorder: what is known is when it started and where it ended
  const trail: TrailEntry[] = recorded ? t.trail! : [
    { at: t.createdAt, status: "planned", activity: null, step: 0 },
    ...(t.status !== "planned" ? [{ at: t.updatedAt, status: t.status, activity: t.activity, step: t.stepsDone }] : []),
  ];
  const imdUsd = fromImd(t.costImd) * o.imdUsd;
  const marketUsd = fromUsdc(t.costUsdc ?? 0n);
  const costUsd = imdUsd + marketUsd;
  const mk = t.market;
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
      // the market search before paying the swarm, right after the decision: every candidate scored, and what it decided
      if (mk && i === 0) {
        span(`${t.id}:market`, root.id, mk.by === "model" ? "llm_call" : "tool_call", "Search the NIGHTSHIFT market", mk.at, mk.doneAt, "ok", {
          log: [{ at: mk.doneAt, text: mk.decision }], candidates: mk.candidates.length, by: mk.by,
        }, mk.costUsd ?? 0);
      }
    } else if (status === "ordering" && marketPay(g)) {
      const to = /^paying (.+) \$[\d.,]+ over x402$/.exec(g[0]!.activity ?? "")?.[1] ?? "the seller";
      span(id, root.id, "tx", `Pay ${to} over x402`, start, end, end === null ? "running" : mk?.paid || next?.status === "building" ? "ok" : "error", { log }, mk?.paid ? marketUsd : 0);
    } else if (status === "ordering") {
      span(id, root.id, "tx", PHASE.ordering, start, end, state, { log, orderId: t.imd?.orderId ?? null }, imdUsd);
    } else if (status === "building" && marketWait(g)) {
      span(id, root.id, "custom", "Waiting for Base to confirm the payment", start, end, state, { log });
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
  // what went through the owner's connected accounts for this shift: each post and Gumroad action, with how it went.
  // The public sees only what went out in public (a post, a product published), without the details.
  const acts = (c.connections?.log ?? []).filter((e) => e.taskId === t.id && (o.owner || e.public));
  acts.forEach((e, i) => span(`${t.id}:conn:${i}`, root.id, "tool_call", e.what, e.at, e.at, e.result === "failed" ? "error" : "ok", {
    channel: e.channel, result: e.result, log: [{ at: e.at, text: o.owner && e.detail ? `${e.result}: ${e.detail}` : e.result }],
    ...(e.result === "failed" && o.owner && e.detail ? { error: e.detail } : {}),
  }));

  root.totalCostUsd = spans.reduce((a, s) => a + (s.id === root.id ? 0 : s.costUsd), 0);

  const ids = t.imd?.orderId ? new Set([`imd:${t.imd.orderId}`, `imd-reversal:${t.imd.orderId}`]) : new Set<string>();
  if (mk?.paid) ids.add(mk.paid.ledgerId);
  const seller = mk?.pick ? { id: mk.pick.sellerId, name: mk.pick.company } : undefined;
  const ledger = o.ledger.filter((x) => ids.has(x.id)).map((x) => ({
    id: x.id, kind: x.kind, memo: x.memo, at: new Date(x.at).getTime(),
    legs: x.postings.map((p) => ({ account: ACCOUNT(c, p.account, seller), asset: p.asset, amount: Number(p.amount) / (p.asset === "IMD" ? 1e18 : 1e6) })),
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
    money: { costImd: fromImd(t.costImd), costUsd, costUsdc: marketUsd, imdUsd: o.imdUsd, ledger },
    market: mk ? {
      at: mk.at, by: mk.by, threshold: mk.threshold, swarmUsd: mk.swarmUsd, decision: mk.decision,
      ...(mk.fallback ? { fallback: mk.fallback } : {}),
      ...(o.owner ? { query: mk.query } : {}),
      // the products are public; the reasons quote the brief's terms, so they are the owner's
      candidates: mk.candidates.map((x) => ({ company: x.company, slug: x.slug, productId: x.productId, name: x.name, kind: x.kind, priceUsd: x.priceUsd, score: x.score, verdict: x.verdict, ...(o.owner || !/key terms/.test(x.why) ? { why: x.why } : {}) })),
      bought: mk.paid && mk.pick ? {
        company: mk.pick.company, slug: mk.pick.slug, productId: mk.pick.productId, name: mk.pick.name, usd: fromUsdc(mk.paid.usdc), sim: mk.paid.sim, tx: mk.paid.tx,
        txUrl: o.live && mk.paid.tx ? `https://${o.salesChainId === 8453 ? "" : "sepolia."}basescan.org/tx/${mk.paid.tx}` : null,
      } : null,
      pending: Boolean(mk.pending),
    } : null,
    payback,
    connections: acts.map((e) => ({ at: e.at, channel: e.channel, what: e.what, result: e.result, ...(e.url ? { url: e.url } : {}), ...(o.owner && e.detail ? { detail: e.detail } : {}) })),
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
  return flight(c, t, { imdUsd: config.imdUsd, owner, live: config.mode === "live", ledger: await engine.ledger.store.list(`co:${c.id}:`), sales: m.sales, visits: m.visits, salesChainId: config.salesChainId });
}
