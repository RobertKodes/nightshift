import { describe, expect, it } from "vitest";
import { SimImdPlane } from "@nightshift/imd";
import { Ledger } from "@nightshift/ledger";
import { DEFAULT_POLICY } from "./policy.js";
import { advance, approve, runShift } from "./shift.js";
import { heuristicDecision } from "./planner.js";
import type { Company } from "./types.js";

function company(policy = {}): Company {
  return {
    id: "c1", slug: "acme", name: "Acme", idea: "weekly AI tool reviews for solo founders who have no time to test tools",
    mission: "Save solo founders ten hours a week on picking AI tools.", audience: "solo founders",
    createdAt: 0, owner: null, wallet: "0x0000000000000000000000000000000000000001",
    policy: { ...DEFAULT_POLICY, ...policy }, status: "active", cycle: 0, nextShiftAt: null,
    site: null, products: [], tasks: [], journal: [], marketing: [],
  };
}

function deps(now: { t: number }, imd = new SimImdPlane({ jobMs: 10_000, now: () => now.t, deliver: async (id) => ({ siteUrl: `http://sites/${id}`, repoUrl: null, files: { report: `http://files/${id}.md` }, summary: null }) })) {
  return {
    imd, ledger: new Ledger(), llm: null, model: "none", imdUsd: () => 6,
    stats: () => ({ visits7d: 0, sales7d: 0, revenue7dUsd: 0, imdUsd: 6 }),
    buyBase: () => "http://buy/acme", emit: () => {}, now: () => now.t,
  };
}

describe("the autonomous company", () => {
  it("ships a product first, then a site, buying each from the swarm and recording the spend", async () => {
    const now = { t: 1_000_000 };
    const d = deps(now);
    const c = company();
    const t1 = await runShift(c, d);
    expect(t1?.kind).toBe("build_product");
    expect(t1?.status).toBe("building");
    expect(c.products[0]?.status).toBe("building");
    expect(await d.ledger.balance("co:c1:imd", "IMD")).toBe(-500000000000000000n);

    // A second shift while work is building starts nothing new.
    expect(await runShift(c, d)).toBeNull();

    now.t += 20_000;
    await advance(c, d); // admission → job id
    await advance(c, d); // completed → delivered
    expect(c.products[0]?.status).toBe("live");
    expect(c.products[0]?.deliverableUrl).toContain("http://");

    const t2 = await runShift(c, d);
    expect(t2?.kind).toBe("build_site");
    now.t += 20_000;
    await advance(c, d);
    await advance(c, d);
    expect(c.site?.url).toContain("http://sites/");
  });

  it("holds a purchase over the owner's limit until approved, and spends nothing before", async () => {
    const now = { t: 1_000_000 };
    const d = deps(now);
    const c = company({ approvalOverUsd: 1 }); // 0.5 IMD × $6 = $3 > $1
    const t = await runShift(c, d);
    expect(t?.status).toBe("awaiting_approval");
    expect(await d.ledger.balance("co:c1:imd", "IMD")).toBe(0n);
    await approve(c, t!.id, d);
    expect(t?.status).toBe("building");
  });

  it("refuses to break the daily budget", async () => {
    const now = { t: 1_000_000 };
    const c = company({ dailyBudgetUsd: 2 });
    const t = await runShift(c, deps(now));
    expect(t?.status).toBe("failed");
    expect(t?.error).toMatch(/budget/);
    expect(c.products).toHaveLength(0);
    // and then rests instead of retrying the same unaffordable move every shift
    const tasks = c.tasks.length;
    expect(await runShift(c, deps(now))).toBeNull();
    expect(c.tasks).toHaveLength(tasks);
    now.t += 25 * 60 * 60 * 1000;
    expect(await runShift(c, deps(now))).not.toBeNull();
  });
});

import { found } from "./planner.js";
describe("the fallback CEO acts on its research", () => {
  it("turns delivered research into the next product, once, instead of asking for the same research again", () => {
    const c = company();
    const t0 = Date.now() - 60 * 60_000;
    c.site = { url: "http://site", jobId: "j" } as never;
    c.marketing = [{ at: Date.now(), channel: "x", text: "hi" }] as never;
    c.products = [{ id: "p1", name: "Acme — The Playbook", kind: "report", pitch: "x", priceUsdc: 9_000_000n, status: "live", deliverableUrl: "f", taskId: "t1", sales: 0, revenueUsdc: 0n, createdAt: t0 }] as never;
    const stats = { visits7d: 5, sales7d: 0, revenue7dUsd: 0, imdUsd: 6 };
    expect(heuristicDecision(c, stats).kind).toBe("research");
    c.tasks = [{ id: "r1", cycle: 4, kind: "research", title: "Find the next thing to sell", why: "", status: "done", stepsDone: 3, stepsTotal: 3, activity: null, costImd: 0n,
      result: { files: { report: "http://files/r1/report" } }, error: null, createdAt: t0 + 1000, updatedAt: t0 + 2000 }] as never;
    const next = heuristicDecision(c, stats);
    expect(next.kind).toBe("build_product");
    expect(next.brief).toContain("http://files/r1/report");
    expect(next.product?.priceUsd).toBeGreaterThan(9);
    // once that product exists, the same research does not trigger another build
    c.products.push({ ...c.products[0]!, id: "p2", createdAt: t0 + 5000 } as never);
    expect(heuristicDecision(c, stats).title).not.toMatch(/research found/);
  });
});

describe("founding without a model", () => {
  it("finds the audience and a usable name in the idea", async () => {
    const f = await found("Weekly reviews of new AI tools for solo founders who have no time to test them", null, "x");
    expect(f.audience).toBe("solo founders");
    expect(f.name).toBe("ReviewsTools");
    expect(f.mission.endsWith(".")).toBe(true);
  });
});

describe("the saver inside a company", () => {
  it("reuses published research instead of paying, and never buys the same body twice", async () => {
    const now = { t: 1_000_000 };
    const c = company();
    c.products.push({ id: "p", name: "P", kind: "report", pitch: "x", priceUsdc: 1n, status: "live", deliverableUrl: null, taskId: "t", sales: 9, revenueUsdc: 0n, createdAt: Date.now() });
    c.site = { url: "http://s", jobId: "j" };
    c.marketing.push({ at: Date.now(), channel: "x", text: "hi", status: "drafted" });
    c.products[0]!.sales = 0;
    const d = { ...deps(now), findExisting: async () => ({ title: "Existing research", url: "https://explorer.imd.fun/jobs/abc" }) };
    const t = await runShift(c, d);
    expect(t?.kind).toBe("research");
    expect(t?.status).toBe("done");
    expect(t?.costImd).toBe(0n);
    expect(await d.ledger.balance("co:c1:imd", "IMD")).toBe(0n);

    const d2 = deps(now);
    const t2 = await runShift(c, d2);
    expect(t2?.kind).toBe("research");
    expect(t2?.status).toBe("building");
    expect(t2?.title).not.toBe(t?.title); // the research it reused is not bought again
    const t3 = await runShift(c, d2);
    expect(t3).toBeNull(); // still building: no second purchase
    t2!.status = "done";
    const t4 = await runShift(c, d2); // a new question, never the same body again
    expect(t4?.kind).toBe("research");
    expect(new Set(c.tasks.map((x) => x.title)).size).toBe(c.tasks.length);
    const bodies = c.tasks.filter((x) => x.imd).map((x) => JSON.stringify(x.imd!.input));
    expect(new Set(bodies).size).toBe(bodies.length);
  });
});

import { spentTodayUsd } from "./policy.js";
describe("money edge cases", () => {
  const llmSays = (decision: unknown) => ({ chat: async () => ({ message: { role: "assistant", content: JSON.stringify(decision) }, costUsd: 0, servedModel: "m", finishReason: "stop" }) }) as never;
  const live = (c: Company) => { c.products.push({ id: "p1", name: "P", kind: "report", pitch: "x", priceUsdc: 9_000_000n, status: "live", deliverableUrl: null, taskId: "t", sales: 0, revenueUsdc: 0n, createdAt: 0 }); c.site = { url: "http://s", jobId: "j" }; };

  it("holds a CEO reprice to the price bounds: no micro-cent, negative or non-number price", async () => {
    for (const [asked, want] of [[0.000001, 1_000_000n], [-5, 1_000_000n], [100_000, 499_000_000n]] as const) {
      const c = company();
      live(c);
      await runShift(c, { ...deps({ t: 1_000_000 }), llm: llmSays({ kind: "reprice", title: "x", why: "y", productId: "p1", priceUsd: asked }) });
      expect(c.products[0]!.priceUsdc, String(asked)).toBe(want);
    }
    const c = company();
    live(c);
    await runShift(c, { ...deps({ t: 1_000_000 }), llm: llmSays({ kind: "reprice", title: "x", why: "y", productId: "p1", priceUsd: "lots" }) });
    expect(c.products[0]!.priceUsdc).toBe(9_000_000n); // not a decision: the playbook moved instead
  });

  it("gives the budget and the books back when IMD reports a payment that never happened", async () => {
    const now = { t: 1_000_000 };
    const sim = new SimImdPlane({ jobMs: 10_000, now: () => now.t });
    const imd = { ...sim, mode: "sim" as const, capabilities: () => sim.capabilities(), check: (a: never, i: unknown) => sim.check(a, i),
      open: async (a: never) => ({ orderId: "o1", action: a, state: "payment_pending" as const }),
      order: async () => ({ orderId: "o1", action: "research" as never, state: "payment_failed" as const }),
      job: (j: string) => sim.job(j), result: (j: string) => sim.result(j) };
    const d = deps(now, imd as never);
    const c = company();
    const t = await runShift(c, d);
    expect(await d.ledger.balance("co:c1:imd", "IMD")).toBe(-500000000000000000n);
    await advance(c, d);
    expect(t?.status).toBe("failed");
    expect(t?.costImd).toBe(0n);
    expect(await d.ledger.balance("co:c1:imd", "IMD")).toBe(0n);
    expect(spentTodayUsd(c, 6, now.t)).toBe(0);
  });

  it("keeps the order id from the quote, before paying, and follows that order if the payment is cut off", async () => {
    const now = { t: 1_000_000 };
    const sim = new SimImdPlane({ jobMs: 10_000, now: () => now.t });
    const calls: string[] = [];
    const imd = { ...sim, mode: "sim" as const, capabilities: () => sim.capabilities(), check: (a: never, i: unknown) => sim.check(a, i),
      // IMD quotes the order, then the connection drops while paying: no answer, no order id in the error
      open: async (_a: never, _i: unknown, hooks?: { onQuote?: (id: string) => void | Promise<void> }) => { await hooks?.onQuote?.("o9"); calls.push("signed"); throw new Error("socket hang up"); },
      order: async () => ({ orderId: "o9", action: "research" as never, state: "admitted" as const, jobId: "j9", txHash: "0xabc" }),
      job: async () => ({ jobId: "j9", state: "running" as const, stepsDone: 1, stepsTotal: 3, activity: "building" }),
      result: (j: string) => sim.result(j) };
    const d = { ...deps(now, imd as never), persist: async () => { calls.push("saved"); } };
    const c = company();
    const t = await runShift(c, d);
    expect(calls).toEqual(["saved", "signed"]); // on disk before anything is signed
    expect(t?.imd?.orderId).toBe("o9");
    expect(t?.status).toBe("building"); // followed, not bought again and not written off
    await advance(c, d);
    expect(t?.imd?.jobId).toBe("j9");
    // the order IMD confirms is booked once, even though the payment's answer never came
    expect(await d.ledger.balance("co:c1:imd", "IMD")).toBe(-500000000000000000n);
    await advance(c, d);
    expect(await d.ledger.balance("co:c1:imd", "IMD")).toBe(-500000000000000000n);
  });

  it("free moves cannot push today's paid work out of the task list and reopen the budget", async () => {
    const now = { t: 10_000_000 };
    const c = company();
    live(c);
    const task = (i: number, costImd: bigint) => ({ id: `t${i}`, cycle: i, kind: "marketing" as const, title: "t", why: "", status: "done" as const, stepsDone: 0, stepsTotal: 0, activity: null, costImd, result: null, error: null, createdAt: now.t, updatedAt: now.t });
    c.tasks.push(task(0, 5n * 10n ** 17n), task(1, 5n * 10n ** 17n));
    for (let i = 2; i < 302; i++) c.tasks.push(task(i, 0n));
    const before = spentTodayUsd(c, 6, now.t);
    await runShift(c, { ...deps(now), llm: llmSays({ kind: "marketing", title: "post", why: "y", post: "hello" }) });
    expect(c.tasks.length).toBeLessThanOrEqual(302);
    expect(spentTodayUsd(c, 6, now.t)).toBe(before);
  });
});

import { imdOrder } from "./catalog.js";
import { mark } from "./shift.js";
describe("the flight recorder and the owner's direction", () => {
  it("records what the CEO saw and every phase of the shift, in order", async () => {
    const now = { t: 1_000_000 };
    const d = deps(now);
    const c = company();
    const t = (await runShift(c, d))!;
    expect(t.mind).toMatchObject({ by: "playbook", saw: { visits7d: 0, liveProducts: 0, direction: false } });
    now.t += 20_000;
    await advance(c, d);
    await advance(c, d);
    const phases = t.trail!.map((e) => e.status).filter((s, i, a) => s !== a[i - 1]);
    expect(phases).toEqual(["planned", "checking", "ordering", "building", "done"]);
    expect(t.trail!.every((e, i, a) => i === 0 || e.at >= a[i - 1]!.at)).toBe(true);
  });

  it("keeps every change of status and step when the record is trimmed", () => {
    const t = { status: "building", stepsDone: 0, activity: null, trail: [] } as never as Parameters<typeof mark>[0];
    mark(t, 0);
    for (let i = 1; i < 200; i++) { t.activity = `poll ${i}`; if (i % 50 === 0) t.stepsDone += 1; mark(t, i); }
    t.status = "done"; mark(t, 300);
    expect(t.trail!.length).toBeLessThanOrEqual(80);
    expect(t.trail!.map((e) => e.step).filter((s, i, a) => s !== a[i - 1])).toEqual([0, 1, 2, 3]);
    expect(t.trail!.at(-1)?.status).toBe("done");
    expect(t.trail![0]?.at).toBe(0);
  });

  it("passes the owner's direction to the CEO's swarm orders", () => {
    const c = { ...company(), direction: "Only write for Shopify sellers." };
    const o = imdOrder(c, heuristicDecision(c, { visits7d: 0, sales7d: 0, revenue7dUsd: 0, imdUsd: 6 }), "http://buy/acme");
    expect(String(o?.input.objective)).toContain("The owner's direction: Only write for Shopify sellers.");
    expect(String(imdOrder(company(), heuristicDecision(company(), { visits7d: 0, sales7d: 0, revenue7dUsd: 0, imdUsd: 6 }), "x")?.input.objective)).not.toContain("direction");
  });
});

import { commission } from "./shift.js";
describe("work the owner orders by hand", () => {
  const product = { kind: "build_product" as const, title: 'Build "Shopify Playbook"', why: "Ordered by the owner.", brief: "A playbook for Shopify sellers.", product: { name: "Shopify Playbook", kind: "report" as const, pitch: "Sell more on Shopify this week.", priceUsd: 19 } };

  it("buys without the approval wait, but inside the daily budget, and never twice", async () => {
    const now = { t: 1_000_000 };
    const d = deps(now);
    const c = company({ approvalOverUsd: 1 }); // the CEO would wait for approval at $3
    const t = await commission(c, d, product);
    expect(t.status).toBe("building");
    expect(t.mind?.by).toBe("owner");
    expect(c.products[0]).toMatchObject({ name: "Shopify Playbook", status: "building" });
    await expect(commission(c, d, product)).rejects.toThrow(/in progress/);
    now.t += 20_000;
    await advance(c, d);
    await advance(c, d);
    await expect(commission(c, d, product)).rejects.toThrow(/already bought in shift 1/);

    const poor = company({ dailyBudgetUsd: 1 });
    const t2 = await commission(poor, d, product);
    expect(t2.status).toBe("failed"); // $3 does not fit a $1 day, whoever asks
    expect(await d.ledger.balance("co:c1:imd", "IMD")).toBe(-500000000000000000n); // only the first order was paid
  });

  it("refuses while paused, and a site change before there is a site", async () => {
    const d = deps({ t: 1_000_000 });
    await expect(commission({ ...company(), status: "paused" }, d, product)).rejects.toThrow(/paused/);
    await expect(commission(company(), d, { kind: "improve_site", title: "Fix the page", why: "", brief: "Shorter hero." })).rejects.toThrow(/not work the swarm can do/);
  });
});

import { budgetPrice } from "./policy.js";
describe("the IMD price budgets are valued at", () => {
  it("moves with two agreeing sources, but not on one wrong feed", () => {
    expect(budgetPrice([6.9, 7.1], null)).toBeCloseTo(7);
    expect(budgetPrice([0.02, 6.9], 6.87)).toBeCloseTo(6.9); // the dumped reading is ignored
    expect(budgetPrice([0.02, NaN], 6.87)).toBeNull(); // one source, 99% off: keep the last price
    expect(budgetPrice([0.02, NaN], null)).toBeNull(); // and never the first price from one source
    expect(budgetPrice([6.0, NaN], 6.87)).toBe(6.0);
    expect(budgetPrice([3, 3.1], 6.87)).toBeCloseTo(3.05); // a real move, seen by both
  });
});
