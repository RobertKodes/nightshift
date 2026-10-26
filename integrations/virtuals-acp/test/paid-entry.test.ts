import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { makePaidEntryHandler } from "../src/paid-entry.ts";
import { loadConfig } from "../src/config.ts";

const cfg = loadConfig({}), id = "01234567-0123-4123-8123-012345678901";
const quote = { quoteId: id, kind: "research", priceUsd: 4.9, expiresAt: new Date(Date.now() + 600_000).toISOString() };
const challenge = { x402Version: 2, resource: { url: cfg.nightshiftBase + "/api/v1/swarm/order" }, accepts: [{ scheme: "exact", network: "eip155:8453", asset: "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913", amount: "4900000", payTo: "0x1111111111111111111111111111111111111111" }] };
const json = (o: unknown, s = 200) => new Response(JSON.stringify(o), { status: s });
const requirement = (content: unknown) => ({ kind: "message", contentType: "requirement", content: JSON.stringify(content) } as any);
const funded = { kind: "system", event: { type: "job.funded" } } as any;
function session() {
  const calls = { budget: null as unknown, result: "", messages: [] as string[] };
  return { calls, s: { jobId: "1", chainId: 8453, status: "open", job: { description: cfg.offeringName }, entries: [], setBudget: async (b: unknown) => { calls.budget = b; }, submit: async (v: string) => { calls.result = v; }, sendMessage: async (m: string) => { calls.messages.push(m); } } };
}
test("ACP funded Swarm job saves one signature before submission and resumes a lost response after restart", async () => {
  const dir = mkdtempSync(join(tmpdir(), "nightshift-acp-test-")), file = join(dir, "state.json"), x = session();
  let signs = 0, submissions = 0;
  const fake: typeof fetch = async (url, init) => {
    if (String(url).includes("/quote")) return json(quote);
    if (String(url).includes("/jobs/")) return json({ status: "done", result: { files: ["report.md"] } });
    if (!(init?.headers as Record<string, string>)["PAYMENT-SIGNATURE"]) return json(challenge, 402);
    assert.equal(JSON.parse(readFileSync(file, "utf8")).rows["1"].request.payment, "saved-signature");
    if (++submissions === 1) throw new Error("lost response");
    return json({ orderId: "sd_test", orderToken: "private" });
  };
  const options = { file, fetch: fake, sign: async () => { signs++; return "saved-signature"; }, intervalMs: 0 };
  try {
    let handler = makePaidEntryHandler(cfg, options);
    await handler(x.s, requirement({ service: "swarm", kind: "research", brief: "Research primary rollup sources", maxUsd: 10 })); assert.ok(x.calls.budget);
    await handler(x.s, funded); assert.equal(x.calls.result, "");
    handler = makePaidEntryHandler(cfg, options); await handler(x.s, funded);
    assert.equal(signs, 1); assert.equal(submissions, 2); assert.equal(JSON.parse(x.calls.result).status, "done");
    await handler(x.s, funded); assert.equal(submissions, 2);
  } finally { if (!resolve(dir).startsWith(resolve(join(tmpdir(), "nightshift-acp-test-")))) throw new Error("Unexpected directory"); rmSync(dir, { recursive: true, force: true }); }
});
test("ACP house tool uses the exact funded budget", async () => {
  const x = session(); let signs = 0;
  const fake: typeof fetch = async (_u, init) => (init?.headers as Record<string, string>)["PAYMENT-SIGNATURE"] ? json({ ok: true, gas: [] }) : json({ ...challenge, accepts: [{ ...challenge.accepts[0], amount: "2000" }] }, 402);
  const handler = makePaidEntryHandler(cfg, { file: null, fetch: fake, sign: () => { signs++; return "sig"; } });
  await handler(x.s, requirement({ service: "gas-now", input: {}, maxUsd: 0.001 })); assert.equal(x.calls.budget, null); assert.equal(signs, 0);
  await handler(x.s, requirement({ service: "gas-now", input: {}, maxUsd: 0.002 })); assert.ok(x.calls.budget); await handler(x.s, funded); assert.equal(JSON.parse(x.calls.result).ok, true); assert.equal(signs, 1);
});
test("ACP reports a refund owed without submitting a failed job", async () => {
  const x = session();
  const fake: typeof fetch = async (u, init) => String(u).includes("/quote") ? json(quote)
    : String(u).includes("/jobs/") ? json({ status: "failed", refundOwed: true })
    : (init?.headers as Record<string, string>)["PAYMENT-SIGNATURE"] ? json({ orderId: "sd_test", orderToken: "private", refundOwed: true, payment: { tx: "0xtx" } }, 502) : json(challenge, 402);
  const handler = makePaidEntryHandler(cfg, { file: null, fetch: fake, sign: () => "sig", intervalMs: 0 });
  await handler(x.s, requirement({ service: "swarm", kind: "research", brief: "Research primary rollup sources", maxUsd: 10 })); await handler(x.s, funded);
  assert.equal(x.calls.result, ""); assert.match(x.calls.messages.at(-1)!, /refund owed/);
});
