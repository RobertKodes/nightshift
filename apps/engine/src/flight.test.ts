import { describe, expect, it } from "vitest";
import type { Company, Task } from "@nightshift/core";
import { flight } from "./flight.js";

const IMD = 10n ** 18n;

function shift(): { c: Company; t: Task } {
  const t: Task = {
    id: "t1", cycle: 3, kind: "build_product", title: "Build the playbook", why: "Nothing to sell yet.", status: "done",
    imd: { action: "job.open", input: { objective: "Write the playbook. The owner's direction: only Shopify." }, orderId: "o1", jobId: "j1", txHash: "0xabc", plan: ["Research", "Write", "Review"] },
    stepsDone: 3, stepsTotal: 3, activity: null, costImd: IMD / 2n, result: { files: { report: "https://files/secret.md" } }, error: null, productId: "p1",
    createdAt: 1_000, updatedAt: 9_000,
    mind: { by: "model", model: "acme/ceo-1", costUsd: 0.002, saw: { visits7d: 4, sales7d: 0, revenue7dUsd: 0, imdUsd: 6, liveProducts: 0, direction: true } },
    trail: [
      { at: 1_000, status: "planned", activity: null, step: 0 },
      { at: 1_100, status: "checking", activity: "IMD free check", step: 0 },
      { at: 1_500, status: "ordering", activity: "quote, pay 0.5 IMD, submit", step: 0 },
      { at: 1_700, status: "ordering", activity: "quoted · paying 0.5 IMD", step: 0 },
      { at: 2_000, status: "building", activity: "paid · waiting for the swarm", step: 0 },
      { at: 4_000, status: "building", activity: "writing", step: 1 },
      { at: 6_000, status: "building", activity: "reviewing", step: 2 },
      { at: 9_000, status: "done", activity: null, step: 3 },
    ],
  };
  const c = {
    id: "c1", slug: "acme", name: "Acme", products: [{ id: "p1", name: "The Playbook", kind: "report", pitch: "p", priceUsdc: 9_000_000n, status: "live", deliverableUrl: "x", taskId: "t1", sales: 2, revenueUsdc: 18_000_000n, createdAt: 1_000 }],
    tasks: [t],
  } as unknown as Company;
  return { c, t };
}

const ledger = [{ id: "imd:o1", at: new Date(2_000), kind: "imd_order", memo: "Build the playbook", postings: [{ account: "co:c1:imd", asset: "IMD", amount: -IMD / 2n }, { account: "ext:imd-swarm", asset: "IMD", amount: IMD / 2n }] }];
const input = (owner: boolean) => ({ imdUsd: 6, owner, live: true, ledger: ledger as never, sales: [{ at: 8_000, productId: "p1", usdc: "9000000", payer: "0xbuyer", tx: "0xs" }], visits: [] });

describe("the flight recorder", () => {
  it("rebuilds a shift as a trace: phases in order, swarm steps inside the build, the money on the payment", () => {
    const { c, t } = shift();
    const f = flight(c, t, input(true));
    const root = f.trace[0]!;
    expect(root.name).toBe("Shift 3: Build the playbook");
    expect(root.children.map((s) => s.name)).toEqual(["The CEO decides", "IMD's free check", "Quote, pay, submit", "The swarm builds", "Delivered"]);
    const pay = root.children[2]!;
    expect([pay.startedAt, pay.endedAt, pay.costUsd]).toEqual([1_500, 2_000, 3]);
    const build = root.children[3]!;
    expect(build.children.map((s) => [s.name, s.startedAt, s.endedAt])).toEqual([["Research", 2_000, 4_000], ["Write", 4_000, 6_000], ["Review", 6_000, 9_000]]);
    expect(root.totalCostUsd).toBeCloseTo(3.002);
    expect(f.durationMs).toBe(8_000);
    expect(f.money.ledger[0]?.legs).toEqual([{ account: "Acme (IMD)", asset: "IMD", amount: -0.5 }, { account: "IMD swarm", asset: "IMD", amount: 0.5 }]);
    expect(f.payback).toMatchObject({ kind: "product", sales: 2, revenueUsd: 18, costUsd: 3, ratio: 6 });
    expect(f.receipts.jobUrl).toBe("https://explorer.imd.fun/jobs/j1");
  });

  it("shows the public the shift but not the brief, the paid file, the model or the buyers", () => {
    const { c, t } = shift();
    const pub = flight(c, t, input(false));
    const text = JSON.stringify(pub);
    expect(text).not.toContain("secret.md");
    expect(text).not.toContain("Shopify");
    expect(text).not.toContain("acme/ceo-1");
    expect(text).not.toContain("0xbuyer");
    expect(pub.mind?.saw.visits7d).toBe(4);
    const own = JSON.stringify(flight(c, t, input(true)));
    expect(own).toContain("secret.md");
    expect(own).toContain("acme/ceo-1");
  });

  it("still opens shifts recorded before the recorder, from their start and end", () => {
    const { c, t } = shift();
    delete t.trail;
    const f = flight(c, t, input(true));
    expect(f.recorded).toBe(false);
    expect(f.trace[0]!.children.map((s) => [s.name, s.endedAt! - s.startedAt])).toEqual([["The CEO decides", 0], ["Not kept in detail (before the recorder)", 8_000], ["Delivered", 0]]);
  });

  it("marks a running shift as running and a failed step as the one that stopped", () => {
    const { c, t } = shift();
    t.trail = t.trail!.slice(0, 6);
    t.status = "building";
    const live = flight(c, t, input(true)).trace[0]!;
    expect(live.status).toBe("running");
    expect(live.children.at(-1)!.children.map((s) => s.status)).toEqual(["ok", "running"]);
    t.trail.push({ at: 7_000, status: "failed", activity: null, step: 1 });
    t.status = "failed";
    t.error = "the swarm failed the job";
    const dead = flight(c, t, input(false)).trace[0]!;
    expect(dead.status).toBe("error");
    expect(dead.children.at(-2)!.children.map((s) => s.status)).toEqual(["ok", "error"]);
    expect(JSON.stringify(dead)).not.toContain("the swarm failed the job");
  });
});
