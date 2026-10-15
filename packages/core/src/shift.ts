import { randomUUID } from "node:crypto";
import type { ImdPlane } from "@nightshift/imd";
import type { Ledger } from "@nightshift/ledger";
import type { LlmClient } from "@nightshift/llm";
import { imdOrder } from "./catalog.js";
import { type CompanyStats, type Decision, heuristicDecision, llmDecision } from "./planner.js";
import { canSpend } from "./policy.js";
import type { Company, JournalEntry, Product, Task } from "./types.js";
import { fromImd, usdc } from "./types.js";

export interface ShiftDeps {
  imd: ImdPlane;
  ledger: Ledger;
  llm: LlmClient | null;
  model: string;
  imdUsd: () => number;
  stats: (c: Company) => CompanyStats;
  /** Public URL prefix of a company's buy links, e.g. https://host/buy/acme */
  buyBase: (c: Company) => string;
  emit: (c: Company, type: "task" | "journal" | "company", payload: unknown) => void;
  now?: () => number;
}

const ACTIVE = new Set(["checking", "ordering", "building"]);
const now = (d: ShiftDeps) => (d.now ?? Date.now)();

export function note(c: Company, d: ShiftDeps, kind: JournalEntry["kind"], text: string): void {
  const e = { at: now(d), cycle: c.cycle, kind, text };
  c.journal.push(e);
  if (c.journal.length > 500) c.journal.splice(0, c.journal.length - 500);
  d.emit(c, "journal", e);
}

function touch(c: Company, t: Task, d: ShiftDeps, patch: Partial<Task>): void {
  Object.assign(t, patch, { updatedAt: now(d) });
  d.emit(c, "task", t);
}

/**
 * One shift: the CEO looks at the numbers, picks one move and starts it. Paid moves are checked
 * for free first, then held to the owner's limits, and only then bought from the IMD swarm.
 */
export async function runShift(c: Company, d: ShiftDeps): Promise<Task | null> {
  if (c.status !== "active") return null;
  if (c.tasks.some((t) => ACTIVE.has(t.status))) {
    note(c, d, "note", "Work from an earlier shift is still in progress; checking on it instead of starting more.");
    return null;
  }
  c.cycle += 1;
  const stats = d.stats(c);
  let decision: Decision | null = null;
  let by = "playbook";
  if (d.llm) {
    try {
      const r = await llmDecision(d.llm, d.model, c, stats);
      if (r) { decision = r.decision; by = r.servedModel; }
    } catch (err) {
      note(c, d, "warning", `The CEO model failed (${(err as Error).message.slice(0, 120)}); using the playbook this shift.`);
    }
  }
  decision ??= heuristicDecision(c, stats);
  note(c, d, "decision", `Shift ${c.cycle}: ${decision.title}. ${decision.why}${by === "playbook" ? "" : ` (${by})`}`);

  const t: Task = {
    id: randomUUID(),
    cycle: c.cycle,
    kind: decision.kind,
    title: decision.title,
    why: decision.why,
    status: "planned",
    stepsDone: 0,
    stepsTotal: 0,
    activity: null,
    costImd: 0n,
    result: null,
    error: null,
    createdAt: now(d),
    updatedAt: now(d),
  };
  c.tasks.push(t);
  if (c.tasks.length > 300) c.tasks.splice(0, c.tasks.length - 300);

  const order = imdOrder(c, decision, d.buyBase(c));
  if (!order) {
    doInHouse(c, t, decision, d);
    return t;
  }

  if (decision.kind === "build_product" && decision.product) {
    const p: Product = {
      id: randomUUID().slice(0, 8),
      name: decision.product.name,
      kind: decision.product.kind,
      pitch: decision.product.pitch,
      priceUsdc: usdc(decision.product.priceUsd),
      status: "building",
      deliverableUrl: null,
      taskId: t.id,
      sales: 0,
      revenueUsdc: 0n,
      createdAt: now(d),
    };
    c.products.push(p);
    t.productId = p.id;
  }
  t.imd = { action: order.action, input: order.input };
  await buy(c, t, d, false);
  return t;
}

/** The free check, the owner's limits, then the purchase. Re-entered after an approval. */
async function buy(c: Company, t: Task, d: ShiftDeps, approved: boolean): Promise<void> {
  const o = t.imd!;
  touch(c, t, d, { status: "checking", activity: "IMD free check" });
  const check = await d.imd.check(o.action as never, o.input);
  o.plan = check.plan;
  if (check.blockers.length) {
    touch(c, t, d, { status: "failed", error: `IMD would refuse it: ${check.blockers.map((b) => b.message).join("; ")}`, activity: null });
    dropProduct(c, t);
    note(c, d, "warning", `Did not buy "${t.title}": the free check found problems, so no IMD was spent.`);
    return;
  }
  const caps = await d.imd.capabilities();
  const costUsd = fromImd(caps.price) * d.imdUsd();
  const gate = canSpend(c, costUsd, d.imdUsd(), { approved, now: now(d) });
  if (!gate.allow) {
    if (gate.wait === "approval") {
      touch(c, t, d, { status: "awaiting_approval", activity: gate.reason });
      note(c, d, "note", `Waiting for your approval: ${t.title} (${gate.reason}).`);
    } else {
      touch(c, t, d, { status: "failed", error: gate.reason, activity: null });
      dropProduct(c, t);
      note(c, d, "warning", `Skipped "${t.title}": ${gate.reason}.`);
    }
    return;
  }
  touch(c, t, d, { status: "ordering", activity: "quote, pay 0.5 IMD, submit" });
  try {
    const order = await d.imd.open(o.action as never, o.input);
    if (order.state === "refused") throw new Error(order.problems?.join("; ") || "refused");
    o.orderId = order.orderId;
    o.txHash = order.txHash;
    o.jobId = order.jobId;
    await d.ledger.post({
      id: `imd:${order.orderId}`,
      at: new Date(now(d)),
      kind: "imd_order",
      memo: t.title,
      ref: { chainTx: order.txHash },
      postings: [
        { account: `co:${c.id}:imd`, asset: "IMD", amount: -caps.price },
        { account: "ext:imd-swarm", asset: "IMD", amount: caps.price },
      ],
    });
    touch(c, t, d, { status: "building", costImd: caps.price, activity: "paid · waiting for the swarm" });
    note(c, d, "decision", `Bought from the IMD swarm for ${fromImd(caps.price)} IMD (~$${costUsd.toFixed(2)}): ${t.title}.`);
  } catch (err) {
    touch(c, t, d, { status: "failed", error: (err as Error).message.slice(0, 300), activity: null });
    dropProduct(c, t);
    note(c, d, "warning", `The order for "${t.title}" failed: ${(err as Error).message.slice(0, 160)}`);
  }
}

function dropProduct(c: Company, t: Task): void {
  if (!t.productId) return;
  const i = c.products.findIndex((p) => p.id === t.productId && p.status === "building");
  if (i >= 0) c.products.splice(i, 1);
}

export async function approve(c: Company, taskId: string, d: ShiftDeps): Promise<void> {
  const t = c.tasks.find((x) => x.id === taskId);
  if (!t || t.status !== "awaiting_approval") throw new Error("nothing waiting with that id");
  note(c, d, "note", `You approved "${t.title}".`);
  await buy(c, t, d, true);
}

export function reject(c: Company, taskId: string, d: ShiftDeps): void {
  const t = c.tasks.find((x) => x.id === taskId);
  if (!t || t.status !== "awaiting_approval") throw new Error("nothing waiting with that id");
  touch(c, t, d, { status: "rejected", activity: null });
  dropProduct(c, t);
  note(c, d, "note", `You turned down "${t.title}". Nothing was spent.`);
}

/** Follows paid work: order → admission → job steps → delivery, and applies what was delivered. */
export async function advance(c: Company, d: ShiftDeps): Promise<void> {
  for (const t of c.tasks) {
    if (t.status !== "building" || !t.imd?.orderId) continue;
    try {
      if (!t.imd.jobId) {
        const o = await d.imd.order(t.imd.orderId);
        if (o.state === "refused" || o.state === "payment_failed" || o.state === "expired") {
          touch(c, t, d, { status: "failed", error: `order ${o.state}${o.problems ? `: ${o.problems.join("; ")}` : ""}`, activity: null });
          dropProduct(c, t);
          continue;
        }
        if (!o.jobId) { touch(c, t, d, { activity: o.state.replace(/_/g, " ") }); continue; }
        t.imd.jobId = o.jobId;
        t.imd.txHash ??= o.txHash;
      }
      const j = await d.imd.job(t.imd.jobId);
      if (j.state === "failed" || j.state === "cancelled") {
        touch(c, t, d, { status: "failed", error: `the swarm ${j.state} the job`, activity: null, stepsDone: j.stepsDone, stepsTotal: j.stepsTotal });
        dropProduct(c, t);
        note(c, d, "warning", `The swarm could not finish "${t.title}".`);
        continue;
      }
      if (j.state !== "completed") {
        if (j.activity !== t.activity || j.stepsDone !== t.stepsDone) touch(c, t, d, { activity: j.activity, stepsDone: j.stepsDone, stepsTotal: j.stepsTotal });
        continue;
      }
      const r = await d.imd.result(t.imd.jobId);
      touch(c, t, d, { status: "done", activity: null, stepsDone: j.stepsTotal, stepsTotal: j.stepsTotal, result: { siteUrl: r.siteUrl, repoUrl: r.repoUrl, files: r.files, note: r.summary ?? undefined } });
      deliver(c, t, r, d);
    } catch (err) {
      touch(c, t, d, { activity: `retrying: ${(err as Error).message.slice(0, 80)}` });
    }
  }
}

function deliver(c: Company, t: Task, r: { siteUrl: string | null; files: Record<string, string>; repoUrl: string | null }, d: ShiftDeps): void {
  const firstFile = Object.values(r.files)[0] ?? null;
  if (t.kind === "build_product") {
    const p = c.products.find((x) => x.id === t.productId);
    if (p) {
      p.status = "live";
      p.deliverableUrl = r.siteUrl ?? firstFile ?? r.repoUrl;
      note(c, d, "result", `${p.name} is live at $${(Number(p.priceUsdc) / 1e6).toFixed(2)}.`);
    }
  } else if (t.kind === "build_site" && r.siteUrl) {
    c.site = { url: r.siteUrl, jobId: t.imd!.jobId! };
    note(c, d, "result", `The site is live: ${r.siteUrl}`);
  } else if (t.kind === "improve_site" && c.site) {
    c.site = { url: r.siteUrl ?? c.site.url, jobId: t.imd!.jobId! };
    note(c, d, "result", "The site update is live.");
  } else if (t.kind === "research") {
    note(c, d, "result", `Research delivered${firstFile ? `: ${firstFile}` : ""}. It feeds the next shift's decision.`);
  }
  d.emit(c, "company", null);
}

function doInHouse(c: Company, t: Task, decision: Decision, d: ShiftDeps): void {
  if (decision.kind === "marketing") {
    const text = (decision.post || decision.brief || `${c.name}: ${c.mission}`).slice(0, 280);
    c.marketing.push({ at: now(d), channel: "x", text, status: "drafted" });
    touch(c, t, d, { status: "done", result: { note: text } });
    note(c, d, "result", `Drafted a post: "${text}"`);
  } else if (decision.kind === "reprice") {
    const p = c.products.find((x) => x.id === decision.productId);
    if (p && decision.priceUsd) {
      const before = Number(p.priceUsdc) / 1e6;
      p.priceUsdc = usdc(decision.priceUsd);
      touch(c, t, d, { status: "done", result: { note: `$${before.toFixed(2)} → $${decision.priceUsd.toFixed(2)}` } });
      note(c, d, "result", `${p.name}: price $${before.toFixed(2)} → $${decision.priceUsd.toFixed(2)}.`);
    } else touch(c, t, d, { status: "failed", error: "no such product" });
  } else if (decision.kind === "retire_product") {
    const p = c.products.find((x) => x.id === decision.productId);
    if (p) { p.status = "retired"; touch(c, t, d, { status: "done" }); note(c, d, "result", `Stopped selling ${p.name}.`); }
    else touch(c, t, d, { status: "failed", error: "no such product" });
  } else {
    touch(c, t, d, { status: "failed", error: "nothing to order" });
  }
  d.emit(c, "company", null);
}
