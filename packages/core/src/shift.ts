import { randomUUID } from "node:crypto";
import type { ImdPlane } from "@nightshift/imd";
import type { Ledger } from "@nightshift/ledger";
import type { LlmClient } from "@nightshift/llm";
import { inputHash, keywords } from "imd-mcp/lib";
import { imdOrder } from "./catalog.js";
import { type CompanyStats, type Decision, heuristicDecision, llmDecision } from "./planner.js";
import { budgetFreesAt, canSpend } from "./policy.js";
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
  /** The saver's first rule: look for shipped public work before paying for research. */
  findExisting?: (query: string) => Promise<{ title: string; url: string } | null>;
  now?: () => number;
  /** Writes the company state to disk now (the engine's store). Called once an order id exists, before paying. */
  persist?: () => Promise<void>;
}

const ACTIVE = new Set(["checking", "ordering", "building"]);
const DAY = 24 * 60 * 60 * 1000;
const now = (d: ShiftDeps) => (d.now ?? Date.now)();

export function note(c: Company, d: ShiftDeps, kind: JournalEntry["kind"], text: string): void {
  const e = { at: now(d), cycle: c.cycle, kind, text };
  c.journal.push(e);
  if (c.journal.length > 500) c.journal.splice(0, c.journal.length - 500);
  d.emit(c, "journal", e);
}

function touch(c: Company, t: Task, d: ShiftDeps, patch: Partial<Task>): void {
  Object.assign(t, patch, { updatedAt: now(d) });
  mark(t, now(d));
  d.emit(c, "task", t);
}

const TRAIL_MAX = 80;

/**
 * Writes the task's current state to its flight record when it changed. Past the limit, activity-only
 * lines go first, so every change of status and step is kept.
 */
export function mark(t: Task, at: number): void {
  const trail = (t.trail ??= []);
  const last = trail.at(-1);
  if (last && last.status === t.status && last.step === t.stepsDone && last.activity === t.activity) return;
  trail.push({ at, status: t.status, activity: t.activity, step: t.stepsDone });
  if (trail.length <= TRAIL_MAX) return;
  const i = trail.findIndex((e, k) => k > 0 && k < trail.length - 1 && e.status === trail[k - 1]!.status && e.step === trail[k - 1]!.step);
  trail.splice(i > 0 ? i : 1, 1);
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
  // Out of budget for today: rest quietly instead of picking a move it cannot pay for.
  if (c.restUntil && now(d) < c.restUntil) return null;
  delete c.restUntil;
  c.cycle += 1;
  const stats = d.stats(c);
  let decision: Decision | null = null;
  const saw = { ...stats, liveProducts: c.products.filter((p) => p.status === "live").length, direction: Boolean(c.direction) };
  let mind: Task["mind"] = { by: "playbook", saw };
  if (d.llm) {
    try {
      const r = await llmDecision(d.llm, d.model, c, stats);
      if (r) { decision = r.decision; mind = { by: "model", model: r.servedModel, costUsd: r.costUsd, saw }; }
      else mind.fallback = "the model's answer was not a usable move";
    } catch (err) {
      mind.fallback = "the model could not be reached";
      note(c, d, "warning", "The CEO could not think this shift; using the playbook.");
    }
  }
  decision ??= heuristicDecision(c, stats);
  const order = imdOrder(c, decision, d.buyBase(c));
  // The saver: never buy the same body twice. An identical order is not a move, so it leaves no
  // task behind; the company rests for a day instead of asking again every shift.
  if (order) {
    const hash = inputHash(order.action, order.input);
    const twin = c.tasks.find((x) => x.imd && !["failed", "rejected"].includes(x.status) && inputHash(x.imd.action, x.imd.input) === hash);
    if (twin) {
      c.cycle -= 1;
      c.restUntil = now(d) + 24 * 60 * 60 * 1000;
      note(c, d, "note", `Saver: "${decision.title}" was already bought in shift ${twin.cycle}. Nothing new worth paying for; resting for a day, or until you run a shift.`);
      return null;
    }
  }
  note(c, d, "decision", `Shift ${c.cycle}: ${decision.title}. ${decision.why}`);

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
    mind,
  };
  mark(t, now(d));
  c.tasks.push(t);
  trimTasks(c, d);

  if (!order) {
    doInHouse(c, t, decision, d);
    return t;
  }

  if (decision.kind === "research" && d.findExisting) {
    const hit = await d.findExisting(keywords(`${decision.brief} ${c.idea}`)).catch(() => null);
    if (hit) {
      touch(c, t, d, { status: "done", result: { files: { research: hit.url }, note: `Reused: ${hit.title}` } });
      note(c, d, "result", `Saver: the swarm already published research on this ("${hit.title.slice(0, 80)}"). Reused it for free instead of paying 0.5 IMD.`);
      return t;
    }
  }

  if (decision.kind === "build_product" && decision.product) {
    const p: Product = {
      // the full UUID: a product's private file and its download links are keyed on it
      id: randomUUID(),
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
      note(c, d, "note", `Waiting for your approval: ${t.title} (${gate.reason}; ${fromImd(caps.price)} IMD at $${d.imdUsd().toFixed(2)} per IMD).`);
    } else {
      touch(c, t, d, { status: "failed", error: gate.reason, activity: null });
      dropProduct(c, t);
      c.restUntil = budgetFreesAt(c, costUsd, d.imdUsd(), now(d));
      note(c, d, "warning", `Skipped "${t.title}": ${gate.reason}. Resting until ${new Date(c.restUntil).toUTCString().slice(17, 22)} UTC, when the budget frees up, or until you raise it.`);
    }
    return;
  }
  // The price is reserved against the budget before anything is signed, so a concurrent shift or
  // approval cannot spend the same budget twice, and an order that may have been paid keeps counting.
  touch(c, t, d, { status: "ordering", costImd: caps.price, activity: "quote, pay 0.5 IMD, submit" });
  try {
    const order = await d.imd.open(o.action as never, o.input, {
      onQuote: async (id) => { o.orderId = id; touch(c, t, d, { activity: "quoted · paying 0.5 IMD" }); await d.persist?.(); },
    });
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
    const msg = (err as Error).message;
    // Refused before signing (the free path, or a challenge we would not sign): nothing was paid.
    const unpaid = /refused to pay|challenge without accepts|^refused|IMD would refuse/i.test(msg);
    const sent = (err as { orderId?: string }).orderId ?? o.orderId;
    if (sent && !unpaid) {
      // Sent but not confirmed: follow it like any paid order instead of buying it again.
      o.orderId = sent;
      touch(c, t, d, { status: "building", costImd: caps.price, activity: "sent · confirming with IMD" });
      note(c, d, "note", `IMD did not confirm "${t.title}" in time; following the order instead of buying it again.`);
      return;
    }
    touch(c, t, d, { status: "failed", costImd: unpaid ? 0n : caps.price, error: msg.slice(0, 300), activity: null });
    dropProduct(c, t);
    note(c, d, "warning", `The order for "${t.title}" failed: ${msg.slice(0, 160)}${unpaid ? "" : " It may have been paid, so it still counts against today's budget."}`);
  }
}

/**
 * The task list keeps its newest 300, but never evicts spend from the last 24 hours or work still
 * waiting: the daily budget is summed from it, so free moves cannot push paid ones out and reopen it.
 */
function trimTasks(c: Company, d: ShiftDeps): void {
  for (let i = 0; c.tasks.length > 300 && i < c.tasks.length - 1;) {
    const x = c.tasks[i]!;
    if ((x.costImd > 0n && now(d) - x.updatedAt < DAY) || x.status === "awaiting_approval") i++;
    else c.tasks.splice(i, 1);
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
          // No settlement transaction: IMD never took the IMD, so the budget and the books get it back.
          const charged = Boolean(o.txHash ?? t.imd.txHash);
          if (!charged) await reverseOrder(c, t, d);
          touch(c, t, d, { status: "failed", ...(charged ? {} : { costImd: 0n }), error: `order ${o.state}${o.problems ? `: ${o.problems.join("; ")}` : ""}`, activity: null });
          dropProduct(c, t);
          if (!charged) note(c, d, "note", `"${t.title}": IMD reports the order ${o.state.replace(/_/g, " ")} with no payment, so nothing was spent. Its budget is back.`);
          continue;
        }
        if (!o.jobId) { touch(c, t, d, { activity: o.state.replace(/_/g, " ") }); continue; }
        t.imd.jobId = o.jobId;
        t.imd.txHash ??= o.txHash;
        await bookOrder(c, t, d);
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
      // An order IMD never received was never charged.
      if (!t.imd.jobId && (err as { status?: number }).status === 404) {
        await reverseOrder(c, t, d);
        touch(c, t, d, { status: "failed", costImd: 0n, error: "IMD has no such order; nothing was charged", activity: null });
        dropProduct(c, t);
        continue;
      }
      touch(c, t, d, { activity: `retrying: ${(err as Error).message.slice(0, 80)}` });
    }
  }
}

/** Books a paid order that a restart cut off before its ledger entry was written; once only. */
async function bookOrder(c: Company, t: Task, d: ShiftDeps): Promise<void> {
  const id = t.imd?.orderId;
  if (!id || !t.costImd || (await d.ledger.store.get(`imd:${id}`))) return;
  await d.ledger.post({
    id: `imd:${id}`, at: new Date(now(d)), kind: "imd_order", memo: `${t.title} (confirmed after a restart)`, ref: { chainTx: t.imd?.txHash },
    postings: [{ account: `co:${c.id}:imd`, asset: "IMD", amount: -t.costImd }, { account: "ext:imd-swarm", asset: "IMD", amount: t.costImd }],
  });
}

/** Takes back the IMD posting of an order IMD never charged for. */
async function reverseOrder(c: Company, t: Task, d: ShiftDeps): Promise<void> {
  const id = t.imd?.orderId;
  const paid = id ? await d.ledger.store.get(`imd:${id}`) : undefined;
  if (!paid) return;
  await d.ledger.post({ id: `imd-reversal:${id}`, at: new Date(now(d)), kind: "imd_reversal", memo: `${t.title} (never charged)`, postings: paid.postings.map((p) => ({ ...p, amount: -p.amount })) });
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
    if (p?.priceByOwner) {
      touch(c, t, d, { status: "done", result: { note: "price set by the owner; kept" } });
      note(c, d, "note", `${p.name}: the owner set its price, so it stays at $${(Number(p.priceUsdc) / 1e6).toFixed(2)}.`);
    } else if (p && !(Number(decision.priceUsd) >= 0.5 && Number(decision.priceUsd) <= 500)) {
      // the same bounds as the owner's own price: never a giveaway, never a negative amount
      touch(c, t, d, { status: "failed", error: `price ${String(decision.priceUsd)} is outside $0.50 to $500` });
      note(c, d, "warning", `${p.name}: refused to reprice to $${String(decision.priceUsd)}; prices stay between $0.50 and $500.`);
    } else if (p && decision.priceUsd) {
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
