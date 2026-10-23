import { randomUUID } from "node:crypto";
import type { ImdPlane } from "@nightshift/imd";
import type { Ledger } from "@nightshift/ledger";
import type { LlmClient } from "@nightshift/llm";
import { inputHash, keywords } from "imd-mcp/lib";
import { imdOrder } from "./catalog.js";
import { type MarketDeps, type MarketReceipt, type Scored, RELEVANT, candidate, keywordScore, marketLimits, marketReserved, marketRule, marketSpentToday, modelScores, relevantByKeywords, terms } from "./market.js";
import { aboutOf, repeatOf, siteWithoutAddress } from "./memory.js";
import { type CompanyStats, type Decision, llmDecision, playbook } from "./planner.js";
import { budgetFreesAt, canSpend } from "./policy.js";
import type { Company, JournalEntry, MarketSearch, Product, Task } from "./types.js";
import { fromImd, fromUsdc, usdc } from "./types.js";

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
  /** The NIGHTSHIFT market: research is bought from another company first when a relevant, cheaper product is on sale. */
  market?: MarketDeps;
  /** What the CEO reads beyond the numbers: the connected channels, the real events to post about, what sells. */
  context?: (c: Company) => Promise<Partial<CompanyStats>>;
  /** The owner's connected channels: a post move hands its event here, to be posted by the rules. */
  posts?: PostDeps;
  /**
   * The strong model, paid by the company itself from its own USDC (over x402), or null when it cannot
   * pay today (no USDC, or its AI limit for the day is spent): the CEO then thinks with the free model.
   */
  brain?: (c: Company) => Promise<Brain | null>;
  /** The NIGHTSHIFT studio: makes a planner in-house and calls finishStudio when it is done. */
  studio?: { build: (c: Company, t: Task, p: Product, decision: Decision) => void };
}

export interface Brain {
  llm: Pick<LlmClient, "chat">;
  model: string;
  /** What the last answer cost the company, once it is paid. */
  paid: () => NonNullable<Task["mind"]>["paid"] | null;
}

export interface PostDeps {
  /** Queues a post about one real event (by its key) on every connected channel; says what happened, in words. */
  queue: (c: Company, t: Task, factKey: string, angle?: string) => Promise<{ ok: boolean; note: string }>;
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
  delete c.restReason;
  c.cycle += 1;
  const context = d.context ? await d.context(c).catch(() => ({})) : {};
  const stats: CompanyStats = { ...d.stats(c), ...context };
  let decision: Decision | null = null;
  const saw = seen(c, stats);
  let mind: Task["mind"] = { by: "playbook", saw };
  // The hard rules (memory.ts): a move that repeats earlier work is passed over, with the reason kept
  // for the flight recorder, and the next move that is new is made instead.
  const avoided: string[] = [];
  const isNew = (x: Decision) => {
    const why = repeatOf(c, x, imdOrder(c, x, d.buyBase(c)), now(d));
    if (why) avoided.push(`${x.title}: ${why}`);
    return !why;
  };
  // the strong model when the company pays for it, else the free one; the playbook when neither answers
  const brain = d.brain ? await d.brain(c).catch(() => null) : null;
  const minds: Brain[] = [...(brain ? [brain] : []), ...(d.llm ? [{ llm: d.llm, model: d.model, paid: () => null }] : [])];
  for (const [i, m] of minds.entries()) {
    try {
      const r = await llmDecision(m.llm, m.model, c, stats);
      const paid = m.paid();
      if (r && isNew(r.decision)) { decision = r.decision; mind = { by: "model", model: r.servedModel, costUsd: r.costUsd, saw, ...(paid ? { paid } : {}) }; }
      else mind.fallback = r ? `the model's move repeats earlier work (${avoided[0]!.slice(r.decision.title.length + 2)})` : "the model's answer was not a usable move";
      break;
    } catch (err) {
      if (i < minds.length - 1) { note(c, d, "note", `The strong model could not answer (${(err as Error).message.slice(0, 120)}); thinking with the free model this shift.`); continue; }
      mind.fallback = "the model could not be reached";
      note(c, d, "warning", "The CEO could not think this shift; using the playbook.");
    }
  }
  decision ??= playbook(c, stats, now(d)).find(isNew) ?? null;
  if (avoided.length) mind.avoided = avoided.slice(0, 8);
  if (!decision) {
    // Everything it would do next was done, is owned, or failed twice: no task, no spend, and the
    // owner desk says why. It rests for a day, or until the owner gives a direction or runs a shift.
    c.cycle -= 1;
    c.restUntil = now(d) + DAY;
    c.restReason = avoided.length ? `everything it would do next repeats earlier work (${avoided.slice(0, 2).join("; ").slice(0, 300)})` : `the owner's direction rules out every move it knows ("${(c.direction ?? "").slice(0, 200)}")`;
    note(c, d, "note", `Saver: nothing new worth doing: ${c.restReason}. Resting for a day; give the CEO a direction, or run a shift.`);
    return null;
  }
  const order = imdOrder(c, decision, d.buyBase(c));
  note(c, d, "decision", `Shift ${c.cycle}: ${decision.title}. ${decision.why}${avoided.length ? ` (Passed over ${avoided.length} move${avoided.length === 1 ? "" : "s"} that would repeat earlier work.)` : ""}`);
  return start(c, d, decision, mind, order, false);
}

/**
 * Work the owner orders by hand: the same free check, daily budget, saver and books as the CEO's
 * moves, without the approval wait (the owner is the one asking). One paid move at a time.
 */
export async function commission(c: Company, d: ShiftDeps, decision: Decision): Promise<Task> {
  if (c.status !== "active") throw new Error("The company is paused. Resume it to order work.");
  if (c.tasks.some((t) => ACTIVE.has(t.status))) throw new Error("Work is still in progress. Order more once it is delivered.");
  const order = imdOrder(c, decision, d.buyBase(c));
  if (!order) throw new Error("That is not work the swarm can do for this company yet.");
  const twin = twinOf(c, order);
  if (twin) throw new Error(`The same order was already bought in shift ${twin.cycle}.`);
  delete c.restUntil;
  c.cycle += 1;
  const saw = seen(c, d.stats(c));
  note(c, d, "decision", `Shift ${c.cycle}, ordered by the owner: ${decision.title}.`);
  return start(c, d, decision, { by: "owner", saw }, order, true);
}

/** The numbers the CEO looked at, kept on the task: only these, not the whole context. */
function seen(c: Company, s: CompanyStats): NonNullable<Task["mind"]>["saw"] {
  return { visits7d: s.visits7d, sales7d: s.sales7d, revenue7dUsd: s.revenue7dUsd, imdUsd: s.imdUsd, liveProducts: c.products.filter((p) => p.status === "live").length, direction: Boolean(c.direction) };
}

/** An order already bought with the same body, unless it failed or was turned down. */
function twinOf(c: Company, order: { action: string; input: unknown }): Task | undefined {
  const hash = inputHash(order.action, order.input);
  return c.tasks.find((x) => x.imd && !["failed", "rejected"].includes(x.status) && inputHash(x.imd.action, x.imd.input) === hash);
}

/** Records the move as a task and starts it: in-house at once, or bought from the swarm. */
async function start(c: Company, d: ShiftDeps, decision: Decision, mind: Task["mind"], order: ReturnType<typeof imdOrder>, approved: boolean): Promise<Task> {
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
    about: aboutOf(c, decision),
  };
  mark(t, now(d));
  c.tasks.push(t);
  trimTasks(c, d);

  if (decision.kind === "post") {
    await postMove(c, t, decision, d);
    return t;
  }
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

  // Free first, then the market, then the swarm. The order body is kept either way, so the saver
  // still knows this research was answered and never pays for the same body twice.
  if (decision.kind === "research" && d.market) {
    t.imd = { action: order.action, input: order.input };
    if ((await shopFirst(c, t, decision.brief || decision.title, d, approved)) !== "none") return t;
  }

  if (decision.kind === "build_product" && decision.product?.format === "planner" && d.studio) {
    const p: Product = {
      id: randomUUID(), name: decision.product.name, kind: "template", format: "planner", pitch: decision.product.pitch, priceUsdc: usdc(decision.product.priceUsd),
      status: "building", deliverableUrl: null, taskId: t.id, sales: 0, revenueUsdc: 0n, createdAt: now(d),
    };
    c.products.push(p);
    t.productId = p.id;
    t.studio = { format: "planner", at: now(d), brief: decision.brief };
    touch(c, t, d, { status: "building", activity: "the studio is designing the planner" });
    note(c, d, "decision", `Making "${p.name}" in the NIGHTSHIFT studio: a hyperlinked planner, designed for ${c.audience}. No swarm order, so no IMD is spent.`);
    d.studio.build(c, t, p, decision);
    return t;
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
  await buy(c, t, d, approved);
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
      delete c.restReason;
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
    if (((x.costImd > 0n || (x.costUsdc ?? 0n) > 0n) && now(d) - x.updatedAt < DAY) || x.status === "awaiting_approval") i++;
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
  if (t.market?.pick && !t.market.paid) {
    if ((await payMarket(c, t, d)) !== "none") return;
    // the product is gone or no longer fits: the swarm order goes through its own limits
    await buy(c, t, d, false);
    return;
  }
  await buy(c, t, d, true);
}

const usd = (v: bigint) => `$${fromUsdc(v).toFixed(2)}`;

/**
 * Market first: search the NIGHTSHIFT market for a product on the brief's topic, score each one's free
 * preview against the brief, apply the rules, and buy the best relevant, cheaper one over x402. Every
 * candidate, its score and the decision go on the task for the flight recorder. "none": order from
 * the swarm as before.
 */
async function shopFirst(c: Company, t: Task, brief: string, d: ShiftDeps, approved: boolean): Promise<"bought" | "waiting" | "pending" | "none"> {
  const m = d.market!;
  const lim = marketLimits(c);
  const at = now(d);
  const record = (x: Partial<MarketSearch>): MarketSearch => (t.market = { at, doneAt: now(d), query: [...terms(brief)].join(" "), swarmUsd: 0, by: "keywords", threshold: RELEVANT.keywords, candidates: [], decision: "", ...x });
  let swarmUsd: number;
  try { swarmUsd = fromImd((await d.imd.capabilities()).price) * d.imdUsd(); } catch { return "none"; }
  if (!lim.on) { record({ swarmUsd, decision: "Buying from the market is off for this company: ordering from the swarm." }); return "none"; }
  const offers = await m.offers(c).catch(() => []);
  const held = await m.usdc(c).catch(() => 0n);
  const money = { swarmUsd, maxUsd: lim.maxUsd, dailyUsd: lim.dailyUsd, spentUsdc: marketSpentToday(c, now(d), t), availableUsdc: held - marketReserved(c, t) };
  // only products that share a key term with the brief are candidates at all
  const scored: Scored[] = offers.map((o) => ({ o, ...keywordScore(brief, o), why: "", rule: marketRule(c, o, money) })).filter((x) => x.shared.length > 0)
    .sort((a, b) => b.score - a.score || Number(a.o.product.priceUsdc - b.o.product.priceUsdc));
  for (const x of scored) x.why = `${x.shared.length} of ${x.of} key terms: ${x.shared.slice(0, 6).join(", ")}`;
  let by: MarketSearch["by"] = "keywords", threshold: number = RELEVANT.keywords, costUsd = 0, fallback: string | undefined;
  const allowed = scored.filter((x) => !x.rule);
  let relevant = (x: Scored) => relevantByKeywords(x);
  if (d.llm && allowed.length) {
    const ask = allowed.slice(0, 6);
    const r = await modelScores(d.llm, d.model, brief, ask.map((x) => x.o)).catch(() => null);
    if (r) {
      by = "model"; threshold = RELEVANT.model; costUsd = r.costUsd;
      ask.forEach((x, i) => { x.score = r.scores[i]!.score; x.why = r.scores[i]!.why || x.why; });
      const asked = new Set(ask);
      relevant = (x) => asked.has(x) && x.score >= RELEVANT.model;
      allowed.sort((a, b) => b.score - a.score || Number(a.o.product.priceUsdc - b.o.product.priceUsdc));
    } else fallback = "the model's answer was not usable, so the keyword score decided";
  }
  const best = allowed.find(relevant);
  const shown = [...(best ? [best] : []), ...scored.filter((x) => x !== best)].slice(0, 8);
  const theirs = scored.filter((x) => x.rule?.verdict !== "own");
  const candidates = shown.map((x) => x === best ? candidate(x, "picked", x.why)
    : x.rule ? candidate(x, x.rule.verdict, `${x.rule.why}${x.rule.verdict !== "own" && relevantByKeywords(x) ? "; relevant otherwise" : ""}`)
    : relevant(x) ? candidate(x, "relevant", x.why)
    : candidate(x, "irrelevant", `${x.why}; below the ${threshold} needed`));
  const base = { swarmUsd, by, threshold, candidates, ...(costUsd ? { costUsd } : {}), ...(fallback ? { fallback } : {}) };
  if (!best) {
    // its own products are not "on the market" for it
    const blocked = scored.filter((x) => x.rule && x.rule.verdict !== "own" && relevantByKeywords(x));
    record({ ...base, decision: !theirs.length
      ? "Nothing on the NIGHTSHIFT market matches this research: ordering it from the swarm."
      : blocked.length
        ? `${blocked.length} relevant product${blocked.length === 1 ? "" : "s"} on the market, but none this company may buy (${[...new Set(blocked.map((x) => x.rule!.why))].slice(0, 2).join("; ")}): ordering from the swarm.`
        : `No product on the market is relevant enough (best ${Math.max(...theirs.map((x) => x.score)).toFixed(2)}, needs ${threshold}): ordering from the swarm.` });
    note(c, d, "note", `Market first: ${t.market!.decision}`);
    return "none";
  }
  const o = best.o;
  const pick = { sellerId: o.seller.id, company: o.seller.name, slug: o.seller.slug, productId: o.product.id, name: o.product.name, kind: o.product.kind, priceUsdc: o.product.priceUsdc, score: best.score };
  record({ ...base, pick, decision: `Buy "${o.product.name}" from ${o.seller.name} for ${usd(o.product.priceUsdc)} instead of ordering the research from the swarm ($${swarmUsd.toFixed(2)}): it scored ${best.score.toFixed(2)} against the brief.` });
  if (!approved && fromUsdc(o.product.priceUsdc) > c.policy.approvalOverUsd + 1e-9) {
    const reason = `${usd(o.product.priceUsdc)} on the market is over the $${c.policy.approvalOverUsd} you approve by hand`;
    touch(c, t, d, { status: "awaiting_approval", activity: reason });
    note(c, d, "note", `Waiting for your approval: buy "${o.product.name}" from ${o.seller.name} on the NIGHTSHIFT market for ${usd(o.product.priceUsdc)} (${reason}), instead of research from the swarm at ~$${swarmUsd.toFixed(2)}.`);
    return "waiting";
  }
  return payMarket(c, t, d);
}

/** Pays for the market pick: limits checked again (an approval may come hours later), then bought once. `alone`: the owner's own buy, with no swarm order after it. */
async function payMarket(c: Company, t: Task, d: ShiftDeps, alone = false): Promise<"bought" | "pending" | "none"> {
  const s = t.market!, pick = s.pick!;
  // reserved before anything is awaited: a second approval or shift cannot spend the same limit or buy it twice
  touch(c, t, d, { status: "ordering", costUsdc: pick.priceUsdc, activity: `paying ${pick.company} ${usd(pick.priceUsdc)} over x402` });
  const lim = marketLimits(c);
  const spent = marketSpentToday(c, now(d), t);
  const held = await d.market!.usdc(c).catch(() => 0n);
  const stop = !lim.on ? "buying from the market was turned off"
    : !alone && fromUsdc(pick.priceUsdc) > lim.maxUsd + 1e-9 ? `over the $${lim.maxUsd.toFixed(2)} limit per market buy`
    : fromUsdc(spent + pick.priceUsdc) > lim.dailyUsd + 1e-9 ? `over the $${lim.dailyUsd.toFixed(2)} a day for the market`
    : held - marketReserved(c, t) < pick.priceUsdc ? "not enough USDC"
    : null;
  try {
    if (stop) throw new Error(stop);
    const r = await d.market!.pay(c, pick, t);
    finishMarketBuy(c, t, r, d);
    return "bought";
  } catch (err) {
    const pending = (err as { pending?: string }).pending;
    if (pending) {
      s.pending = pending;
      touch(c, t, d, { status: "building", activity: "paid · waiting for Base to confirm" });
      note(c, d, "note", `The payment to ${pick.company} for "${pick.name}" was sent and is waiting for Base; following it instead of paying again.`);
      return "pending";
    }
    const msg = (err as Error).message.slice(0, 200);
    if (alone) {
      s.decision = `${s.decision} The purchase did not go through (${msg}), so nothing was paid.`;
      s.doneAt = now(d);
      touch(c, t, d, { status: "failed", costUsdc: 0n, error: msg, activity: null });
      note(c, d, "warning", `Could not buy "${pick.name}" from ${pick.company} (${msg}). Nothing was paid.`);
      return "none";
    }
    s.decision = `${s.decision} The purchase did not go through (${msg}), so nothing was paid: ordering from the swarm.`;
    delete s.pick;
    s.doneAt = now(d);
    touch(c, t, d, { status: "planned", costUsdc: 0n, activity: null });
    note(c, d, "warning", `Market first: could not buy "${pick.name}" from ${pick.company} (${msg}). Nothing was paid; ordering the research from the swarm.`);
    return "none";
  }
}

/**
 * The market purchase is booked on both sides: the file becomes this shift's research, used exactly
 * like research the swarm delivered. Once only; also called when a payment sent earlier lands.
 */
export function finishMarketBuy(c: Company, t: Task, r: MarketReceipt, d: ShiftDeps): void {
  const s = t.market, pick = s?.pick;
  if (!s || !pick || s.paid) return;
  s.paid = { at: now(d), usdc: pick.priceUsdc, ledgerId: r.ledgerId, tx: r.tx, sim: r.sim };
  delete s.pending;
  s.doneAt = now(d);
  const b2b = (c.b2b ??= { bought: [], sold: [] });
  b2b.bought.push({ at: now(d), ledgerId: r.ledgerId, taskId: t.id, productId: pick.productId, product: pick.name, kind: pick.kind, usdc: pick.priceUsdc, with: { id: pick.sellerId, name: pick.company, slug: pick.slug }, tx: r.tx, sim: r.sim });
  if (b2b.bought.length > 200) b2b.bought.splice(0, b2b.bought.length - 200);
  touch(c, t, d, { status: "done", costUsdc: pick.priceUsdc, activity: null, error: null, result: { files: { research: r.url }, note: `Bought from ${pick.company} on the NIGHTSHIFT market: ${pick.name}` } });
  note(c, d, "result", `${r.sim ? "[sim] " : ""}Market first: bought "${pick.name}" from ${pick.company} for ${usd(pick.priceUsdc)} instead of paying the swarm ~$${s.swarmUsd.toFixed(2)}. It is this shift's research and feeds the next product.`);
  d.emit(c, "company", null);
}

/**
 * The owner presses Buy under a CEO chat answer: one product from another company. The press is the
 * approval, so the per-buy limit gives way; the day's market limit, the money held and the market's
 * other rules (never the owner's own companies, never twice) all still apply. Booked like the CEO's own buys.
 */
export async function ownerBuy(c: Company, d: ShiftDeps, sellerId: string, productId: string): Promise<Task> {
  if (!d.market) throw new Error("The market is not open on this engine.");
  if (c.status !== "active") throw new Error("The company is paused. Resume it to buy.");
  if (c.tasks.some((t) => ACTIVE.has(t.status))) throw new Error("Work is still in progress. Buy once it is delivered.");
  const o = (await d.market.offers(c)).find((x) => x.seller.id === sellerId && x.product.id === productId);
  if (!o) throw new Error("That product is no longer on sale.");
  const lim = marketLimits(c);
  if (!lim.on) throw new Error("Buying from the market is off for this company (see Limits).");
  const held = await d.market.usdc(c).catch(() => 0n);
  const rule = marketRule(c, o, { swarmUsd: Infinity, maxUsd: Math.max(lim.maxUsd, fromUsdc(o.product.priceUsdc)), dailyUsd: lim.dailyUsd, spentUsdc: marketSpentToday(c, now(d)), availableUsdc: held - marketReserved(c) });
  if (rule) throw new Error(`Not bought: ${rule.why}.`);
  c.cycle += 1;
  const t: Task = {
    id: randomUUID(), cycle: c.cycle, kind: "research", title: `Buy "${o.product.name}" from ${o.seller.name}`, why: "Ordered by the owner from the CEO chat.",
    status: "planned", stepsDone: 0, stepsTotal: 0, activity: null, costImd: 0n, result: null, error: null, createdAt: now(d), updatedAt: now(d),
    mind: { by: "owner", saw: seen(c, d.stats(c)) }, about: `${o.product.name}: ${o.product.pitch}`,
  };
  mark(t, now(d));
  c.tasks.push(t);
  trimTasks(c, d);
  const pick = { sellerId: o.seller.id, company: o.seller.name, slug: o.seller.slug, productId: o.product.id, name: o.product.name, kind: o.product.kind, priceUsdc: o.product.priceUsdc, score: 1 };
  t.market = { at: now(d), doneAt: now(d), query: o.product.name, swarmUsd: 0, by: "keywords", threshold: 0, candidates: [], decision: `The owner bought "${o.product.name}" from ${o.seller.name} for ${usd(o.product.priceUsdc)}.`, pick };
  note(c, d, "decision", `Shift ${c.cycle}, ordered by the owner: buy "${o.product.name}" from ${o.seller.name} for ${usd(o.product.priceUsdc)}.`);
  await payMarket(c, t, d, true);
  return t;
}

/** The studio finished (or could not finish) a planner: the product goes live with its files, or is dropped. Once only. */
export function finishStudio(c: Company, t: Task, d: ShiftDeps, r: { ok: true; summary: string } | { ok: false; error: string }): void {
  if (t.status !== "building" || !t.studio) return;
  const p = c.products.find((x) => x.id === t.productId);
  if (r.ok && p) {
    p.status = "live";
    touch(c, t, d, { status: "done", activity: null, error: null, result: { files: {}, note: r.summary } });
    note(c, d, "result", `Studio: "${p.name}" is on sale. ${r.summary}`);
  } else {
    touch(c, t, d, { status: "failed", activity: null, error: r.ok ? "the product is gone" : r.error.slice(0, 300) });
    dropProduct(c, t);
    note(c, d, "warning", `The studio could not make "${t.title}": ${r.ok ? "the product is gone" : r.error.slice(0, 200)}. Nothing was spent.`);
  }
  d.emit(c, "company", null);
}

/** A payment that was sent never landed: nothing was charged, the limit is back, and the next shift starts fresh. */
export function dropMarketBuy(c: Company, t: Task, d: ShiftDeps, why: string): void {
  if (!t.market || t.market.paid) return;
  delete t.market.pending;
  touch(c, t, d, { status: "failed", costUsdc: 0n, activity: null, error: why });
  note(c, d, "note", `"${t.title}": ${why}`);
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
    // waiting for a site's address: asked twice a minute, not on every tick
    if (t.activity === PUBLISHING && now(d) - (polled.get(t.id) ?? 0) < 30_000) continue;
    if (t.activity === PUBLISHING) polled.set(t.id, now(d));
    try {
      if (!t.imd.jobId) {
        const o = await d.imd.order(t.imd.orderId);
        unanswered.delete(t.id);
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
      unanswered.delete(t.id);
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
      // IMD marks a website job completed a minute or two before it publishes the site's address. Taking
      // the delivery then left the company with no site, so the CEO bought the same site again each shift.
      if (!r.siteUrl && hosted(c, t) && !(t.activity === PUBLISHING && now(d) - t.updatedAt > ADDRESS_WAIT)) {
        if (t.activity !== PUBLISHING) touch(c, t, d, { activity: PUBLISHING, stepsDone: j.stepsTotal, stepsTotal: j.stepsTotal });
        continue;
      }
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
      const msg = (err as Error).message;
      if (!unanswered.has(t.id)) unanswered.set(t.id, now(d));
      // IMD cannot tell about it any more (a job it lost, or the simulator restarted): a failure the company
      // moves on from, instead of "still in progress" every shift for ever. A paid order stays counted.
      if ((d.imd.mode === "sim" && /^unknown (job|order)/.test(msg)) || now(d) - unanswered.get(t.id)! > UNANSWERED) {
        unanswered.delete(t.id);
        touch(c, t, d, { status: "failed", error: `IMD stopped answering about this order (${msg.slice(0, 80)})`, activity: null });
        dropProduct(c, t);
        note(c, d, "warning", `"${t.title}": IMD stopped answering about this order, so it is marked failed and the company moves on. Its order id stays on the shift.`);
        continue;
      }
      touch(c, t, d, { activity: `retrying: ${msg.slice(0, 80)}` });
    }
  }
}

const PUBLISHING = "delivered · waiting for IMD to publish the address";
/** How long a delivered website waits for its address before it is taken without one (recoverAddresses keeps asking). */
const ADDRESS_WAIT = 2 * 60 * 60 * 1000;
const polled = new Map<string, number>();
/** When IMD first failed to answer about a paid order; after this long without an answer it counts as failed. */
const unanswered = new Map<string, number>();
const UNANSWERED = 6 * 60 * 60 * 1000;

/** Work the swarm hosts: the site, or a product that is a web tool. Its address is what the company gets. */
function hosted(c: Company, t: Task): boolean {
  return t.kind === "build_site" || (t.kind === "build_product" && c.products.find((p) => p.id === t.productId)?.kind === "tool");
}

/** A delivered site or web tool whose address IMD had not published when it was taken. */
export function missingAddress(c: Company): Task[] {
  const site = siteWithoutAddress(c);
  const tools = c.products.filter((p) => p.kind === "tool" && p.status === "live" && !p.deliverableUrl)
    .map((p) => c.tasks.find((t) => t.id === p.taskId && t.status === "done" && t.imd?.jobId)).filter((t): t is Task => Boolean(t));
  return [...(site ? [site] : []), ...tools];
}

/**
 * Collects the address of work delivered before IMD published it, asked every 10 minutes: the company's
 * site, or a web tool it sells. A site that was built but never recorded is found here, not bought again.
 */
export async function recoverAddresses(c: Company, d: ShiftDeps): Promise<void> {
  for (const t of missingAddress(c)) {
    if (now(d) - (polled.get(t.id) ?? 0) < 10 * 60_000) continue;
    polled.set(t.id, now(d));
    const r = await d.imd.result(t.imd!.jobId!).catch(() => null);
    if (!r?.siteUrl) continue;
    t.result = { ...(t.result ?? {}), siteUrl: r.siteUrl };
    if (t.kind === "build_site") {
      c.site = { url: r.siteUrl, jobId: t.imd!.jobId! };
      note(c, d, "result", `The site is live: ${r.siteUrl} (IMD published its address after the delivery).`);
    } else {
      const p = c.products.find((x) => x.id === t.productId);
      if (p && !p.deliverableUrl) { p.deliverableUrl = r.siteUrl; note(c, d, "result", `${p.name} is live at ${r.siteUrl}.`); }
    }
    d.emit(c, "company", null);
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

/** A post about one real event, handed to the owner's channels: they post it by their own rules (approval, caps, quiet hours). */
async function postMove(c: Company, t: Task, decision: Decision, d: ShiftDeps): Promise<void> {
  if (!d.posts) {
    touch(c, t, d, { status: "failed", error: "no channel is connected" });
  } else {
    try {
      const r = await d.posts.queue(c, t, decision.fact ?? "", decision.post);
      touch(c, t, d, r.ok ? { status: "done", result: { note: r.note } } : { status: "failed", error: r.note });
      note(c, d, r.ok ? "result" : "note", r.note);
    } catch (err) {
      touch(c, t, d, { status: "failed", error: (err as Error).message.slice(0, 200) });
    }
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
      t.productId = p.id;
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
