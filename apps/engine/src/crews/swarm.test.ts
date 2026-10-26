import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import type { ImdPlane } from "@nightshift/imd";
import { decodeHeader, encodeHeader, requirement, signPayment, verifyPayment, type Challenge, type PaymentPayload } from "@nightshift/x402";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { afterEach, describe, expect, it, vi } from "vitest";
import { bazaarOf, holderPriceOf, offer } from "../services/catalog.js";
import type { Ctx } from "../services/context.js";
import { type Io, type Out, type Payer, services } from "../services/routes.js";
import { houseProfiles } from "./profiles.js";
import { JobLedger } from "./ledger.js";
import { SWARM_IMD, SwarmDesk, swarmPrice } from "./swarm.js";

const BASE = "https://getnightshift.tech";
const NOW = Date.parse("2026-10-26T12:00:00Z");
const BRIEF = "Research the IMD ecosystem with sources and concrete examples.";
const A = "0x1111111111111111111111111111111111111111";
const TX = `0x${"a".repeat(64)}` as const;
const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) {
    if (!resolve(dir).startsWith(resolve(join(tmpdir(), "nightshift-swarm-")))) throw new Error("Unexpected test directory");
    rmSync(dir, { recursive: true, force: true });
  }
});

function harness(file: string | null = null) {
  const h = { now: NOW, enabled: true, cap: 100, inflight: 25, imd: 10n * 10n ** 18n, eth: 10n ** 18n, gasRequired: 10n ** 15n, usd: 6.87, priceAt: NOW, pinned: false, blocked: false, failed: false, complete: false, priceImd: SWARM_IMD, settlement: null as `0x${string}` | null, pending: false, events: [] as string[] };
  const plane: ImdPlane = {
    mode: "live",
    capabilities: vi.fn<ImdPlane["capabilities"]>(async () => ({ price: h.priceImd, asset: "0xd34a99bc0f67ae1bbd63c660e6d0b0dd03e263b7", payTo: A, network: "eip155:1", quoteTtlSeconds: 600 })),
    check: vi.fn<ImdPlane["check"]>(async (action) => ({ action, blockers: h.blocked ? [{ code: "blocked", message: "IMD cannot build this" }] : [], suggestions: [], plan: [] })),
    open: vi.fn<ImdPlane["open"]>(async (action, body, hooks) => {
      h.events.push("open");
      await hooks?.onQuote?.("imd-order-1");
      if (file) expect(readFileSync(file, "utf8")).toContain("imd-order-1");
      if (h.failed) throw new Error("IMD is unavailable");
      return { orderId: "imd-order-1", action, state: "admitted", jobId: "imd-job-1" };
    }),
    order: vi.fn<ImdPlane["order"]>(async (orderId) => ({ orderId, action: "job.open", state: "admitted", jobId: "imd-job-1" })),
    job: vi.fn<ImdPlane["job"]>(async (jobId) => ({ jobId, state: h.complete ? "completed" : "running", stepsDone: 1, stepsTotal: 2, activity: "building" })),
    result: vi.fn<ImdPlane["result"]>(async (jobId) => ({ jobId, siteUrl: "https://example.ipfs.site", repoUrl: "https://github.com/example/result", files: { report: "https://api.imd.fun/jobs/imd-job-1/report.md" }, summary: null })),
  };
  const record = vi.fn(), alert = vi.fn(async () => true);
  const deps = { file, plane, enabled: () => h.enabled, dailyImd: () => h.cap, inFlight: () => h.inflight, price: () => ({ usd: h.usd, at: h.priceAt, pinned: h.pinned }), funds: vi.fn(async () => ({ imd: h.imd, eth: h.eth, gasRequired: h.gasRequired })), settled: () => h.settlement, pending: () => h.pending, record, alert, verifiedContract: async () => true, now: () => h.now };
  const desk = new SwarmDesk(deps);
  const quote = (kind = "research", brief = BRIEF, repo: string | null = null) => desk.quote(kind, brief, repo, BASE, kind === "tests" ? { commit: "a".repeat(40) } : kind === "frontend" ? { chain: "base", address: A } : kind === "logo" ? { name: "Night Owl", style: "minimal owl" } : {});
  const payment = (price: number, nonce = "0x01") => ({ payer: A, nonce, usd: price, network: "eip155:8453", validBefore: Math.floor(h.now / 1000) + 3600 });
  const settle = vi.fn(async () => { h.events.push("settle"); h.settlement = TX; return TX; });
  return { h, deps, desk, quote, payment, settle, plane, record, alert };
}
const body = (out: Out) => out.body as { orderId: string; orderToken?: string; status: string; result?: unknown; payment: { tx: string }; refundOwed?: boolean; message?: string };
const tempFile = () => { const dir = mkdtempSync(join(tmpdir(), "nightshift-swarm-")); dirs.push(dir); return join(dir, "swarm-desk.json"); };

describe("Swarm Desk", () => {
  it("refuses the exact job IMD blocks, with the blockers and no charge", async () => {
    const x = harness();
    x.h.blocked = true;
    await expect(x.quote("audit", BRIEF, "https://github.com/example/solidity")).rejects.toMatchObject({ status: 422, blockers: [{ code: "blocked", message: "IMD cannot build this" }] });
    expect(x.plane.check).toHaveBeenCalledWith("job.open", expect.objectContaining({ template: "audit", repoUrl: "https://github.com/example/solidity" }));
    expect(x.settle).not.toHaveBeenCalled();
    expect(x.plane.open).not.toHaveBeenCalled();
  });

  it("prices at the floor or rounds the IMD cost plus margin and overhead up to a cent", async () => {
    expect(swarmPrice(1)).toBe(3);
    expect(swarmPrice(6.87)).toBe(4.9);
    expect(swarmPrice(10)).toBe(6.85);
    expect(swarmPrice(6.881)).toBe(4.91);
    const x = harness(), q = await x.quote();
    expect(q).toMatchObject({ kind: "research", priceUsd: 4.9, imd: 0.5, pay: `${BASE}/api/v1/swarm/order?quoteId=${q.quoteId}`, expiresAt: new Date(NOW + 600_000).toISOString() });
    expect(holderPriceOf(x.desk.quotedOffer(q.quoteId))).toBe(4_900_000n);
  });

  it("rejects stale or unknown prices, invalid inputs and the off switch", async () => {
    const x = harness();
    x.h.priceAt = NOW - 30 * 60_000;
    await expect(x.quote()).rejects.toMatchObject({ status: 503, message: expect.stringContaining("stale") });
    x.h.priceAt = NOW; x.h.usd = 0;
    await expect(x.quote()).rejects.toMatchObject({ status: 503 });
    x.h.usd = 6.87;
    await expect(x.quote("unknown")).rejects.toMatchObject({ status: 400 });
    await expect(x.quote("research", "too short")).rejects.toMatchObject({ status: 400 });
    for (const repo of ["http://github.com/a/b", "https://github.com.evil.test/a/b", "https://github.com/a/b?token=secret", "https://user@github.com/a/b"]) await expect(x.quote("audit", BRIEF, repo)).rejects.toMatchObject({ status: 400 });
    x.h.enabled = false;
    await expect(x.quote()).rejects.toMatchObject({ status: 503 });
  });

  it.each(["website", "research", "audit", "contract", "tests", "review", "frontend", "image", "logo"])("orders the same checked %s body, only after USDC settles", async (kind) => {
    const x = harness(), q = await x.quote(kind, BRIEF, ["audit", "tests", "review"].includes(kind) ? "https://github.com/example/contracts" : null);
    const checked = vi.mocked(x.plane.check).mock.calls[0]![1];
    const out = await x.desk.order(q.quoteId, x.payment(q.priceUsd), x.settle, () => false);
    expect(out.status).toBe(200);
    expect(x.h.events).toEqual(["settle", "open"]);
    expect(x.plane.open).toHaveBeenCalledExactlyOnceWith("job.open", checked, expect.objectContaining({ onQuote: expect.any(Function) }));
    expect(x.record).toHaveBeenCalledWith(expect.objectContaining({ crew: "swarm" }), expect.objectContaining({ kind: `swarm.${kind}`, pending: true, tx: TX }));
    const b = body(out);
    expect(b.orderToken).toHaveLength(43);
    await expect(x.desk.job(b.orderId, "wrong-token")).rejects.toMatchObject({ status: 404 });
    x.h.complete = true;
    expect(await x.desk.job(b.orderId, b.orderToken!)).toMatchObject({ status: "done", result: { repoUrl: "https://github.com/example/result", files: { report: expect.any(String) } } });
    expect(x.record).toHaveBeenLastCalledWith(expect.any(Object), expect.objectContaining({ kind: `swarm.${kind}`, pending: false, ok: true, costUsd: 3.435 }));
    await x.desk.follow();
    expect(x.record.mock.calls.filter(([, r]) => !r.pending)).toHaveLength(1);
  });

  it.each(["imd", "eth", "cap", "off", "price changed"])("refuses before settling when the house lacks %s", async (why) => {
    const x = harness(), q = await x.quote();
    if (why === "imd") x.h.imd = SWARM_IMD - 1n;
    if (why === "eth") x.h.eth = x.h.gasRequired - 1n;
    if (why === "cap") x.h.cap = 0;
    if (why === "off") x.h.enabled = false;
    if (why === "price changed") x.h.priceImd = SWARM_IMD * 2n;
    await expect(x.desk.order(q.quoteId, x.payment(q.priceUsd), x.settle, () => false)).rejects.toMatchObject({ status: 503 });
    expect(x.settle).not.toHaveBeenCalled();
    expect(x.plane.open).not.toHaveBeenCalled();
  });

  it("records refund owed with the payment tx and alerts if IMD fails after settlement", async () => {
    const file = tempFile(), x = harness(file), q = await x.quote();
    x.h.failed = true;
    const out = await x.desk.order(q.quoteId, x.payment(q.priceUsd), x.settle, () => false);
    expect(out.status).toBe(502);
    expect(body(out)).toMatchObject({ status: "failed", refundOwed: true, payment: { tx: TX }, message: "NIGHTSHIFT owes you a refund; it is recorded" });
    expect(readFileSync(file, "utf8")).toContain("refund owed");
    expect(x.record).toHaveBeenLastCalledWith(expect.objectContaining({ crew: "swarm" }), expect.objectContaining({ kind: "swarm.research", ok: false, error: expect.stringContaining("refund owed"), tx: TX }));
    expect(x.alert).toHaveBeenCalledOnce();
    expect(x.alert.mock.calls[0]).toEqual([expect.stringContaining(TX), expect.stringContaining("swarm-refund-")]);
  });

  it("does not charge or order twice on concurrent replays, a second payment or another quote", async () => {
    const x = harness(), q = await x.quote(), p = x.payment(q.priceUsd);
    const [a, b] = await Promise.all([x.desk.order(q.quoteId, p, x.settle, () => false), x.desk.order(q.quoteId, p, x.settle, () => false)]);
    expect(body(a).orderId).toBe(body(b).orderId);
    expect(body(a).orderToken).toBeTruthy();
    expect(body(b).orderToken).toBe(body(a).orderToken);
    expect(x.settle).toHaveBeenCalledOnce();
    expect(x.plane.open).toHaveBeenCalledOnce();
    await expect(x.desk.order(q.quoteId, x.payment(q.priceUsd, "0x02"), x.settle, () => false)).rejects.toMatchObject({ status: 409 });
    const other = await x.quote();
    await expect(x.desk.order(other.quoteId, p, x.settle, () => false)).rejects.toMatchObject({ status: 409 });
    expect(x.settle).toHaveBeenCalledOnce();
  });

  it("keeps the daily cap across restart and resets it on a new UTC day", async () => {
    const file = tempFile(), x = harness(file);
    x.h.cap = 0.5;
    const q = await x.quote(), out = await x.desk.order(q.quoteId, x.payment(q.priceUsd), x.settle, () => false);
    x.h.complete = true;
    await x.desk.job(body(out).orderId, body(out).orderToken!);
    const reloaded = new SwarmDesk(x.deps), q2 = await reloaded.quote("research", BRIEF, null, BASE);
    await expect(reloaded.order(q2.quoteId, x.payment(q2.priceUsd, "0x02"), x.settle, () => false)).rejects.toMatchObject({ status: 503, message: expect.stringContaining("cap") });
    x.h.now += 86_400_000; x.h.priceAt = x.h.now;
    const q3 = await reloaded.quote("research", BRIEF, null, BASE);
    expect((await reloaded.order(q3.quoteId, x.payment(q3.priceUsd, "0x03"), x.settle, () => false)).status).toBe(200);
  });

  it("keeps at most three jobs in flight and expires unused quotes", async () => {
    const x = harness(); x.h.inflight = 3;
    for (let i = 0; i < 3; i++) { const q = await x.quote(); await x.desk.order(q.quoteId, x.payment(q.priceUsd, `0x0${i}`), x.settle, () => false); }
    const q = await x.quote();
    await expect(x.desk.order(q.quoteId, x.payment(q.priceUsd, "0x04"), x.settle, () => false)).rejects.toMatchObject({ status: 503, message: expect.stringContaining("3 jobs") });
    expect(x.settle).toHaveBeenCalledTimes(3);
    x.h.now += 600_000;
    expect(() => x.desk.quotedOffer(q.quoteId)).toThrow("expired");
  });

  it("reloads in-flight orders and their IMD ids, follows results and refuses replay purchases", async () => {
    const file = tempFile(), x = harness(file), q = await x.quote();
    const first = body(await x.desk.order(q.quoteId, x.payment(q.priceUsd), x.settle, () => false));
    const saved = JSON.parse(readFileSync(file, "utf8"));
    saved.orders[0].status = "ordering"; // the process stopped before receiving IMD's answer
    writeFileSync(file, JSON.stringify(saved));
    const reloaded = new SwarmDesk(x.deps);
    x.h.complete = true;
    await reloaded.follow();
    expect(await reloaded.job(first.orderId, first.orderToken!)).toMatchObject({ status: "done", result: { siteUrl: "https://example.ipfs.site" }, refundOwed: false });
    const retry = await reloaded.order(q.quoteId, x.payment(q.priceUsd), x.settle, () => false);
    expect(body(retry).orderToken).toBe(first.orderToken);
    expect(x.plane.open).toHaveBeenCalledOnce();
    expect(x.settle).toHaveBeenCalledOnce();
  });

  it("follows pending Base settlement after restart before opening IMD, keeping the token for the answer", async () => {
    const file = tempFile(), x = harness(file), q = await x.quote();
    const waiting = await x.desk.order(q.quoteId, x.payment(q.priceUsd), async () => { x.h.pending = true; throw new Error("pending"); }, () => true);
    expect(waiting.status).toBe(202);
    expect(x.plane.open).not.toHaveBeenCalled();
    const reloaded = new SwarmDesk(x.deps);
    await reloaded.follow();
    expect(x.plane.open).not.toHaveBeenCalled();
    x.h.settlement = TX; x.h.now += 15_000;
    await reloaded.follow();
    expect(x.plane.open).toHaveBeenCalledOnce();
    const answer = body(await reloaded.order(q.quoteId, x.payment(q.priceUsd), x.settle, () => false));
    expect(answer.orderToken).toBeTruthy();
    expect(x.settle).not.toHaveBeenCalled();
  });

  it("does not mark a resumed swarm ledger job interrupted", () => {
    const file = tempFile(), l = new JobLedger({ file, now: () => NOW });
    const j = l.start({ crew: "swarm", operator: "house", kind: "swarm.contract", free: false, payment: { payer: A, usd: 4.9, tx: TX, network: "eip155:8453" } });
    const resumed = new JobLedger({ file, now: () => NOW + 86_400_000 });
    expect(resumed.get(j.id)?.status).toBe("running");
  });

  it("keeps Swarm Desk preview while off even with a catalog price", () => {
    const metrics = new JobLedger({ file: null });
    const args = { prices: [{ offer: "swarm-order", label: "From", usd: 3, holderUsd: 3, crew: "swarm" as const }], metrics: () => metrics.metrics("swarm"), base: BASE };
    expect(houseProfiles(args).find((p) => p.id === "swarm")?.status).toBe("preview");
    expect(houseProfiles({ ...args, swarmEnabled: true }).find((p) => p.id === "swarm")?.status).toBe("live");
  });

  it("publishes a short Bazaar description and the GET quoteId path parameter", () => {
    const o = offer("swarm-order");
    expect(o.description).toMatch(/^Use when an agent needs/);
    expect(o.description.length).toBeLessThan(480);
    const b = bazaarOf(o, "/api/v1/swarm/order/quote-123").bazaar as { info: { input: { type: string; method: string; pathParams: unknown } } };
    expect(b.info.input).toMatchObject({ type: "http", method: "GET", pathParams: { quoteId: "quote-123" } });
  });
});

describe("Swarm Desk public capacity", () => {
  it("coalesces slow followers and returns known status while the background read is pending", async () => {
    const x = harness(), q = await x.quote(), receipt = body(await x.desk.order(q.quoteId, x.payment(q.priceUsd), x.settle, () => false));
    let release!: () => void;
    const gate = new Promise<void>((r) => { release = r; }), original = x.plane.order;
    x.plane.order = async (id) => { await gate; return original(id); };
    const a = x.desk.follow(), b = x.desk.follow(); expect(a).toBe(b);
    expect(await x.desk.job(receipt.orderId, receipt.orderToken!)).toMatchObject({ status: "running" }); release(); await a;
  });
  it("persists the actual reserve eligibility for each order's refill revenue", async () => {
    const x = harness(), q = await x.quote(); await x.desk.order(q.quoteId, x.payment(q.priceUsd), x.settle, () => false);
    expect(x.desk.revenue()[0]).toMatchObject({ units: "4900000", reserveUnits: "2450000" });
    const file = tempFile(), y = harness(file), d = new SwarmDesk({ ...y.deps, reservePayer: () => false });
    const ownerQuote = await d.quote("research", BRIEF, null, BASE); await d.order(ownerQuote.quoteId, y.payment(ownerQuote.priceUsd), y.settle, () => false);
    expect(new SwarmDesk(y.deps).revenue()[0]).toMatchObject({ units: "4900000", reserveUnits: "0" });
  });
  it("gets live counters at runtime, caches them for 60 seconds and reports unavailable honestly", async () => {
    const x = harness(), health = vi.fn(async () => ({ agentsOnline: 7, seatsEnrolled: 11, jobsDoneLastDay: 3, counts: { jobs: 20, jobStates: { completed: 15 } } }));
    const d = new SwarmDesk({ ...x.deps, health });
    expect((await d.stats()).swarm).toMatchObject({ agentsOnline: 7, seatsEnrolled: 11, totalJobs: 20, completedJobs: 15, completionRate: 0.75 });
    expect((await d.stats()).desk).toMatchObject({ enabled: true, dailyImd: 100, maxInFlight: 25, kinds: expect.arrayContaining([expect.objectContaining({ kind: "tests", priceUsd: 4.9 })]) });
    expect(health).toHaveBeenCalledOnce(); x.h.now += 60_001; await d.stats(); expect(health).toHaveBeenCalledTimes(2);
    const missing = new SwarmDesk({ ...x.deps, health: async () => { throw new Error("offline"); } });
    expect(await missing.stats()).toMatchObject({ swarm: { available: false, seatsEnrolled: null, completionRate: null }, coverage: ["IMD live counters unavailable"] });
  });
  it("requires verified frontend source and a runtime-confirmed skill before the free check", async () => {
    const x = harness(), verifiedContract = vi.fn(async () => true), skills = vi.fn(async () => [{ name: "frontend-for-contract" }]);
    const d = new SwarmDesk({ ...x.deps, verifiedContract, skills });
    await d.quote("frontend", BRIEF, null, BASE, { chain: "base", address: A });
    expect(verifiedContract).toHaveBeenCalledWith("base", A);
    expect(x.plane.check).toHaveBeenCalledWith("job.open", expect.objectContaining({ skill: "frontend-for-contract", chainId: 8453, contractAddress: A }));
    vi.mocked(verifiedContract).mockResolvedValue(false);
    await expect(d.quote("frontend", BRIEF, null, BASE, { chain: "base", address: A })).rejects.toMatchObject({ status: 400 });
    await expect(d.quote("image", BRIEF, null, BASE)).rejects.toMatchObject({ status: 503 });
    expect(x.plane.check).toHaveBeenCalledOnce();
  });
  it("returns one stable discoverable 402 for old paths, query quotes and unbound probes", async () => {
    const x = harness(), q = await x.quote();
    const payer = { mode: "live", chainId: 8453, payTo: () => A, holder: async () => false } as unknown as Payer;
    const s = services({ d: { now: () => NOW } } as Ctx, payer, { swarm: x.desk });
    for (const [path, query] of [[`/api/v1/swarm/order/${q.quoteId}`, ""], ["/api/v1/swarm/order", `quoteId=${q.quoteId}`], ["/api/v1/swarm/order", ""]]) {
      const out = (await s.handle({ method: "GET", path: path!, query: new URLSearchParams(query), header: () => undefined, ip: A, base: BASE, limited: () => false }))!;
      expect(out.status).toBe(402); const ch = out.body as Challenge;
      expect(ch.resource.url).toBe(`${BASE}/api/v1/swarm/order`);
      expect(decodeHeader(out.headers!["PAYMENT-REQUIRED"]!)).toEqual(ch);
    }
    x.h.imd = 0n;
    await expect(x.desk.order(q.quoteId, x.payment(q.priceUsd), x.settle, () => false)).rejects.toMatchObject({ status: 503, retryAfter: 60, message: expect.stringContaining("nothing was charged") });
    expect(x.settle).not.toHaveBeenCalled();
  });
});

describe("Swarm Desk HTTP and x402", () => {
  it("checks payment, uses the quoted exact terms without holder discounts, and exposes free status", async () => {
    const x = harness(), buyer = privateKeyToAccount(generatePrivateKey()), payTo = privateKeyToAccount(generatePrivateKey()).address;
    const payer: Payer = {
      mode: "live", chainId: 8453, payTo: () => payTo, holder: async () => true,
      check: vi.fn<Payer["check"]>(async (o, sig) => {
        const p = decodeHeader<PaymentPayload>(sig), checked = await verifyPayment(p, requirement(8453, payTo, o.priceUsdc));
        x.h.events.push("check");
        return checked.ok ? { ok: true, payment: p, payer: checked.payer } : { ok: false, status: 402, reason: checked.reason, challenge: true };
      }),
      settle: vi.fn(async (_o, _p, terms) => { expect(terms?.requirement.amount).toBe("4900000"); return x.settle(); }),
      isPending: () => false, sim: async () => {},
    };
    const s = services({ d: { now: () => NOW } } as Ctx, payer, { swarm: x.desk });
    const call = async (path: string, q: Record<string, string> = {}, payment?: string) => (await s.handle({ method: "GET", path, query: new URLSearchParams(q), header: (name) => name === "payment-signature" ? payment : undefined, ip: "203.0.113.1", base: BASE, limited: () => false } satisfies Io))!;
    const quote = await call("/api/v1/swarm/quote", { kind: "research", brief: BRIEF });
    const q = quote.body as { quoteId: string }, path = `/api/v1/swarm/order/${q.quoteId}`;
    const ch = await call(path, { holder: buyer.address });
    expect(ch.status).toBe(402);
    expect(ch.body).toMatchObject({ priceUsd: 4.9, holderPrice: false, holderPriceUsd: 4.9 });
    expect((ch.body as Challenge).accepts[0]?.amount).toBe("4900000");
    expect((ch.body as Challenge).extensions).toEqual(bazaarOf(offer("swarm-order"), "/api/v1/swarm/order"));
    const short = encodeHeader(await signPayment(buyer, requirement(8453, payTo, 2_450_000n)));
    expect((await call(path, {}, short)).status).toBe(402);
    expect(x.settle).not.toHaveBeenCalled();
    const signed = encodeHeader(await signPayment(buyer, requirement(8453, payTo, 4_900_000n)));
    const out = await call(path, {}, signed);
    expect(out.status).toBe(200);
    expect(x.h.events.slice(-3)).toEqual(["check", "settle", "open"]);
    expect(decodeHeader(out.headers!["PAYMENT-RESPONSE"]!)).toMatchObject({ transaction: TX, success: true });
    expect((await call(`/api/v1/swarm/jobs/${body(out).orderId}`, { token: body(out).orderToken! })).status).toBe(200);
  });
});
