import test from "node:test";
import assert from "node:assert/strict";
import { HOUSE_TOOLS, NightshiftClient } from "../dist/index.js";

const base = "https://getnightshift.tech", id = "01234567-0123-4123-8123-012345678901";
const q = { quoteId: id, kind: "research", priceUsd: 4.9, expiresAt: new Date(Date.now() + 600_000).toISOString() };
const challenge = { x402Version: 2, resource: { url: base + "/api/v1/swarm/order" }, accepts: [{ scheme: "exact", network: "eip155:8453", asset: "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913", amount: "4900000", payTo: "0x1111111111111111111111111111111111111111" }] };
const json = (o, s = 200) => new Response(JSON.stringify(o), { status: s });

test("checked quote -> durable exact payment -> private result, with one signature after a lost answer", async () => {
  let signs = 0, saved, attempts = 0; const calls = [];
  const c = new NightshiftClient({ fetch: async (url, init) => {
    calls.push([String(url), init]);
    if (url.includes("/quote")) return json(q);
    if (url.includes("/jobs/")) return json({ status: "done", result: { files: { report: "report.md" } } });
    if (!init.headers["PAYMENT-SIGNATURE"]) return json(challenge, 402);
    assert.deepEqual(saved, { url, payment: "signed" });
    if (++attempts === 1) throw new Error("lost response");
    return json({ orderId: "sd_test", orderToken: "secret" });
  } });
  const quote = await c.swarmQuote({ kind: "research", brief: "Research rollups with primary sources" });
  const request = await c.prepareSwarmOrder(quote, { maxUsd: 5, sign: r => { signs++; assert.equal(r.amount, "4900000"); return "signed"; } }); saved = request;
  await assert.rejects(c.submitPaid(request), e => e.signedRequest === request);
  const receipt = await c.submitPaid(request), result = await c.pollSwarm(receipt.orderId, receipt.orderToken, { intervalMs: 0 });
  assert.equal(result.status, "done"); assert.equal(signs, 1); assert.equal(attempts, 2);
  assert.match(calls.at(-1)[0], /token=secret/);
});
test("never signs an over-budget, expired, wrong-price or unstable-resource quote", async () => {
  let signs = 0; const c = new NightshiftClient({ fetch: async () => json({ ...challenge, resource: { url: base + "/order/variable" } }, 402) });
  const opts = { maxUsd: 5, sign: () => { signs++; return "no"; } };
  await assert.rejects(c.prepareSwarmOrder(q, { ...opts, maxUsd: 4 }));
  await assert.rejects(c.prepareSwarmOrder({ ...q, expiresAt: "2000-01-01" }, opts));
  await assert.rejects(c.prepareSwarmOrder(q, opts)); assert.equal(signs, 0);
});
test("all seven house tools prepare bounded payments and retain refund-owed receipts", async () => {
  for (const tool of HOUSE_TOOLS) {
    const c = new NightshiftClient({ fetch: async (url, init) => init.headers["PAYMENT-SIGNATURE"] ? json({ refundOwed: true, payment: { tx: "0xtx" } }, 502) : json({ ...challenge, accepts: [{ ...challenge.accepts[0], amount: "2000" }] }, 402) });
    const r = await c.prepareHouseTool(tool, {}, { maxUsd: 0.005, sign: () => "sig" }); assert.match(r.url, new RegExp(tool));
    assert.equal((await c.submitPaid(r)).refundOwed, true);
  }
});
