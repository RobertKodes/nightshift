import { describe, expect, it } from "vitest";
import { canon, paymentHash } from "./canon.js";
import { SimImdPlane } from "./sim.js";

describe("canonical JSON", () => {
  it("sorts keys at every depth and drops whitespace", () => {
    expect(canon({ b: 1, a: { d: [2, { z: 1, y: "x" }], c: null } })).toBe('{"a":{"c":null,"d":[2,{"y":"x","z":1}]},"b":1}');
  });
  it("refuses non-integers, so a hashed payment can never be ambiguous", () => {
    expect(() => canon({ a: 1.5 })).toThrow();
  });
  it("hashes the same payment the same way regardless of key order", () => {
    expect(paymentHash({ x: 1, y: { b: 2, a: 1 } })).toBe(paymentHash({ y: { a: 1, b: 2 }, x: 1 }));
  });
});

describe("simulated plane", () => {
  it("refuses a vague body at check, like the real plane, and never opens it", async () => {
    const imd = new SimImdPlane();
    const c = await imd.check("job.open", { objective: "make app" });
    expect(c.blockers.length).toBe(1);
    expect((await imd.open("job.open", { objective: "make app" })).state).toBe("refused");
  });
  it("walks an order through payment and admission, then a job through its steps", async () => {
    let now = 0;
    const imd = new SimImdPlane({ jobMs: 10_000, now: () => now, deliver: async () => ({ siteUrl: "http://site", repoUrl: null, files: {}, summary: "ok" }) });
    const o = await imd.open("job.open", { objective: "Build a one-page site that sells a weekly AI tools digest for founders." });
    expect(o.state).toBe("payment_pending");
    now = 3500;
    expect((await imd.order(o.orderId)).state).toBe("admitted");
    expect((await imd.job(o.jobId!)).state).toBe("running");
    now = 20_000;
    expect((await imd.job(o.jobId!)).state).toBe("completed");
    expect((await imd.result(o.jobId!)).siteUrl).toBe("http://site");
  });
});
