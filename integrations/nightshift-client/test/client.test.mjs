import test from "node:test";
import assert from "node:assert/strict";
import { NightshiftClient, NightshiftError, PriceExceedsMaxError } from "../dist/index.js";

const json = (obj, status = 200, headers = {}) =>
  new Response(JSON.stringify(obj), { status, headers: { "content-type": "application/json", ...headers } });
const rpcText = (o) => ({ result: { content: [{ type: "text", text: JSON.stringify(o) }] } });

test("mcp parses plain JSON reply", async () => {
  const calls = [];
  const c = new NightshiftClient({ fetch: async (u, i) => { calls.push([u, i]); return json(rpcText({ hello: 1 })); } });
  assert.deepEqual(await c.startHere(), { hello: 1 });
  assert.equal(calls[0][0], "https://getnightshift.tech/mcp/public");
  assert.equal(JSON.parse(calls[0][1].body).params.name, "start_here");
});

test("mcp parses SSE reply", async () => {
  const sse = `event: message\ndata: ${JSON.stringify({ jsonrpc: "2.0", id: 1, ...rpcText({ a: "b" }) })}\n\n`;
  const c = new NightshiftClient({ fetch: async () => new Response(sse, { headers: { "content-type": "text/event-stream" } }) });
  assert.deepEqual(await c.askSwarm("what is IMD"), { a: "b" });
});

test("typed error carries status and server message", async () => {
  const c = new NightshiftClient({ fetch: async () => json({ error: "The token must be a 0x address" }, 400) });
  await assert.rejects(() => c.get("/x"), (e) => e instanceof NightshiftError && e.status === 400 && /0x address/.test(e.message));
});

test("watchtowerSample 404 surfaces as NightshiftError 404", async () => {
  const c = new NightshiftClient({ fetch: async () => json({ error: "not found" }, 404) });
  await assert.rejects(() => c.watchtowerSample("0xabc"), (e) => e.status === 404);
});

const terms = { x402Version: 2, accepts: [{ scheme: "exact", network: "eip155:8453", asset: "0xusdc", amount: "20000", payTo: "0xpay" }] };
const b64 = Buffer.from(JSON.stringify(terms)).toString("base64");

test("paidGet refuses when price exceeds maxUsd and never signs", async () => {
  let signed = false;
  const c = new NightshiftClient({ fetch: async () => json(terms, 402, { "payment-required": b64 }) });
  await assert.rejects(() => c.paidGet("https://x/y", { maxUsd: 0.01, sign: () => { signed = true; return "s"; } }), PriceExceedsMaxError);
  assert.equal(signed, false);
});

test("paidGet signs within budget and retries with PAYMENT-SIGNATURE", async () => {
  const seen = [];
  const c = new NightshiftClient({ fetch: async (u, i) => {
    seen.push(i.headers["PAYMENT-SIGNATURE"]);
    return i.headers["PAYMENT-SIGNATURE"] ? json({ ok: true }) : json(terms, 402, { "payment-required": b64 });
  } });
  const out = await c.paidGet("https://x/y", { maxUsd: 0.05, sign: (r) => "sig-for-" + r.amount });
  assert.deepEqual(out, { ok: true });
  assert.deepEqual(seen, [undefined, "sig-for-20000"]);
});

test("paidGet requires maxUsd", async () => {
  const c = new NightshiftClient({ fetch: async () => { throw new Error("must not fetch"); } });
  await assert.rejects(() => c.paidGet("https://x", { maxUsd: 0, sign: () => "s" }), NightshiftError);
});
