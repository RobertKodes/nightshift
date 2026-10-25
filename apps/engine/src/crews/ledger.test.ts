import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { CrewEvent } from "./contracts.js";
import { JobLedger, MAX_JOBS, STALE_MS, paymentClass, publicJob } from "./ledger.js";

const A = "0x1111111111111111111111111111111111111111";
const B = "0x2222222222222222222222222222222222222222";
const DEV = "0x6c4c78f2c3bdf4c4318fe305fb1c8bc1694d19b5";
const T0 = Date.parse("2026-10-25T10:00:00Z");
const pay = (payer: string, usd = 0.05, extra: { network?: string; test?: boolean; sim?: boolean } = {}) => ({ usd, payer, tx: "0xabc", network: extra.network ?? "eip155:8453", ...extra });

describe("job ledger", () => {
  it("counts the same payment key once", () => {
    const l = new JobLedger({ file: null, now: () => T0 });
    const a = l.start({ key: `${A}:nonce-1`, crew: "watchtower", operator: "house", kind: "watch.check", free: false, payment: pay(A) });
    const b = l.start({ key: `${A}:nonce-1`, crew: "watchtower", operator: "house", kind: "watch.check", free: false, payment: pay(A) });
    expect(b.id).toBe(a.id);
    l.done(a.id, { summary: "Checked 1 token: no changes" });
    l.start({ key: `${A}:nonce-1`, crew: "watchtower", operator: "house", kind: "watch.check", free: false, payment: pay(A) });
    const m = l.metrics("watchtower");
    expect(m).toMatchObject({ jobs: 1, done: 1, paidJobs: 1, customerPaidJobs: 1, revenueUsd: 0.05, payingWallets: 1, repeatWallets: 0 });
  });

  it("classes payments: our wallets internal, simulations and test networks test, the rest customer", () => {
    expect(paymentClass({ payer: DEV })).toBe("internal");
    expect(paymentClass({ payer: DEV.toUpperCase().replace("0X", "0x") })).toBe("internal");
    expect(paymentClass({ payer: A, sim: true })).toBe("test");
    expect(paymentClass({ payer: A, test: true })).toBe("test");
    expect(paymentClass({ payer: A, network: "eip155:84532" })).toBe("test");
    expect(paymentClass({ payer: A, network: "eip155:8453" })).toBe("customer");
    const l = new JobLedger({ file: null, now: () => T0 });
    expect(l.start({ crew: "research", operator: "house", kind: "research.report", free: false, payment: pay(DEV) }).payment?.class).toBe("internal");
    expect(l.start({ crew: "research", operator: "house", kind: "research.report", free: false, payment: pay(A, 0.25, { sim: true }) }).payment?.class).toBe("test");
    expect(l.start({ crew: "research", operator: "house", kind: "research.report", free: false, payment: pay(A, 0.25) }).customer).toBe(`w:${A}`);
  });

  it("computes metrics: repeat wallets, success rate, latency; revenue leaves out internal, test and failed jobs", () => {
    let t = T0;
    const l = new JobLedger({ file: null, now: () => t });
    const run = (payment: ReturnType<typeof pay> | null, ok: boolean, ms: number) => {
      const j = l.start({ crew: "buildcheck", operator: "house", kind: "buildcheck.report", free: !payment, payment });
      t += ms;
      if (ok) l.done(j.id, { summary: "5 checks", costUsd: 0.01 }); else l.fail(j.id, "the check could not run");
    };
    run(pay(A, 0.1), true, 100);
    run(pay(A, 0.1), true, 300);
    run(pay(B, 0.1), true, 200);
    run(pay(B, 0.1), false, 50); // failed: never charged
    run(pay(DEV, 0.1), true, 100); // internal
    run(pay(A, 0.1, { test: true }), true, 100); // test
    run(null, true, 100); // free
    const m = l.metrics("buildcheck");
    expect(m).toMatchObject({ jobs: 7, done: 6, failed: 1, paidJobs: 6, customerPaidJobs: 4, payingWallets: 2, repeatWallets: 1, revenueUsd: 0.3, knownCostUsd: 0.06, medianLatencyMs: 100, lastJobAt: T0 + 850 });
    expect(m.successRate).toBeCloseTo(6 / 7);
    expect(l.metrics("buildcheck", T0 + 10_000)).toMatchObject({ jobs: 0, successRate: null, medianLatencyMs: null, lastJobAt: null });
  });

  it("fails a job left running across a restart once 15 minutes have passed, and keeps the file", () => {
    const file = join(mkdtempSync(join(tmpdir(), "crews-ledger-")), "jobs.json");
    let t = T0;
    const first = new JobLedger({ file, now: () => t });
    const old = first.start({ crew: "research", operator: "house", kind: "research.report", free: true });
    t += 10 * 60_000;
    const young = first.start({ crew: "research", operator: "house", kind: "research.report", free: true });
    t += 6 * 60_000; // old: 16 minutes, young: 6 minutes
    const events: CrewEvent[] = [];
    const second = new JobLedger({ file, now: () => t, onEvent: (e) => events.push(e) });
    expect(second.get(old.id)).toMatchObject({ status: "failed", error: "interrupted" });
    expect(second.get(young.id)?.status).toBe("running");
    expect(events).toHaveLength(1);
    // a job started by this process is never swept, however long it runs
    const mine = second.start({ crew: "research", operator: "house", kind: "research.report", free: true });
    t += STALE_MS + 60_000;
    expect(second.list({ status: "failed" }).map((j) => j.id).sort()).toEqual([old.id, young.id].sort());
    expect(second.get(mine.id)?.status).toBe("running");
    // and it was all saved
    expect(new JobLedger({ file, now: () => t }).get(young.id)?.error).toBe("interrupted");
  });

  it("shows nothing private publicly unless the job is published", () => {
    const l = new JobLedger({ file: null, now: () => T0 });
    const ip = l.anon("203.0.113.9");
    expect(ip).toMatch(/^a:[\w-]{16}$/);
    expect(ip).not.toContain("203");
    const j = l.start({ crew: "buildcheck", operator: "house", kind: "buildcheck.report", free: false, payment: pay(A), ref: "Telegram", target: "https://svc.example/mcp" });
    expect(j.target).toBeUndefined(); // not stored without publish
    const pub = publicJob(l.done(j.id, { summary: "3 checks: 3 pass" }));
    const text = JSON.stringify(pub);
    for (const secret of [A, "telegram", "svc.example", "0xabc", "w:"]) expect(text).not.toContain(secret);
    expect(pub).toMatchObject({ paid: true, payment: { usd: 0.05, network: "eip155:8453", class: "customer" }, summary: "3 checks: 3 pass" });
    const shown = publicJob(l.start({ crew: "buildcheck", operator: "house", kind: "buildcheck.report", free: true, publish: true, target: "https://svc.example/mcp" }));
    expect(shown.target).toBe("https://svc.example/mcp");
  });

  it("emits an event on every status change and keeps the last 5,000 jobs", () => {
    const events: CrewEvent[] = [];
    let t = T0;
    const l = new JobLedger({ file: null, now: () => t++, onEvent: (e) => events.push(e) });
    const a = l.start({ crew: "watchtower", operator: "house", kind: "watch.check", free: false, payment: pay(A) });
    l.done(a.id, { summary: "ok" });
    l.done(a.id, { summary: "twice" }); // already done: nothing changes
    const b = l.start({ crew: "op:abc123", operator: "abc123", kind: "onboarding", free: true });
    l.fail(b.id, "onboarding not passed");
    expect(events.map((e) => `${e.crew} ${e.status} ${e.paid} ${e.house}`)).toEqual(["watchtower running true true", "watchtower done true true", "op:abc123 running false false", "op:abc123 failed false false"]);
    expect(l.get(a.id)?.summary).toBe("ok");
    for (let i = 0; i < MAX_JOBS; i++) l.start({ crew: "research", operator: "house", kind: "research.report", free: true });
    expect(l.list({ limit: MAX_JOBS + 10 })).toHaveLength(MAX_JOBS);
    expect(l.get(a.id)).toBeNull();
    expect(() => l.start({ crew: "nope" as never, operator: "house", kind: "x", free: true })).toThrow();
  });
});
