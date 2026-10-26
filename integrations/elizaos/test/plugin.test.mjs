// Runs the actions with a fake runtime and a fake fetch. No network.
import test from "node:test";
import assert from "node:assert/strict";
import { makeActions, nightshiftPlugin } from "../dist/index.js";

const TOKEN = "0xdAC17F958D2ee523a2206206994597C13D831ec7";
const runtime = { getSetting: () => undefined };
const msg = (text) => ({ entityId: "e", roomId: "r", content: { text } });
const json = (o, s = 200) => new Response(JSON.stringify(o), { status: s, headers: { "content-type": "application/json" } });

function fakeFetch(log) {
  return async (url, init) => {
    log.push([String(url), init?.body]);
    if (String(url).endsWith("/mcp/public")) {
      const name = JSON.parse(init.body).params.name;
      return json({ result: { content: [{ type: "text", text: JSON.stringify({ tool: name, ok: true }) }] } });
    }
    if (String(url).includes("/api/watchtower/sample")) return json({ error: "not found" }, 404);
    return json({ sample: true });
  };
}
const byName = (actions, n) => actions.find((a) => a.name === n);

test("plugin exposes free tools and Swarm Desk payment actions", () => {
  assert.deepEqual(nightshiftPlugin.actions.map((a) => a.name).sort(), [
    "NIGHTSHIFT_ASK_SWARM", "NIGHTSHIFT_BUILDCHECK_SAMPLE", "NIGHTSHIFT_HOUSE_TOOL", "NIGHTSHIFT_SWARM_JOB", "NIGHTSHIFT_SWARM_ORDER", "NIGHTSHIFT_SWARM_QUOTE", "NIGHTSHIFT_VERDICT_PREVIEW", "NIGHTSHIFT_WATCHTOWER_SAMPLE",
  ]);
});

test("paid actions require host policy and persist signatures before sending", async () => {
  const m = msg('{"tool":"gas-now","input":{}}');
  assert.equal(await byName(makeActions(), "NIGHTSHIFT_HOUSE_TOOL").validate(runtime, m), false);
  let saved, signs = 0;
  const f = async (_url, init) => init.headers["PAYMENT-SIGNATURE"] ? (assert.equal(saved.payment, "sig"), json({ gas: [], payment: { tx: "0xtx" } })) : json({ x402Version: 2, accepts: [{ scheme: "exact", network: "eip155:8453", asset: "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913", amount: "2000", payTo: "0x1111111111111111111111111111111111111111" }] }, 402);
  const action = byName(makeActions(f, { maxUsd: 0.002, sign: () => { signs++; return "sig"; }, save: r => { saved = r; } }), "NIGHTSHIFT_HOUSE_TOOL");
  assert.equal(await action.validate(runtime, m), true); assert.equal((await action.handler(runtime, m)).success, true); assert.equal(signs, 1);
});

test("ask-swarm calls the MCP tool and replies through the callback", async () => {
  const log = [], replies = [];
  const a = byName(makeActions(fakeFetch(log)), "NIGHTSHIFT_ASK_SWARM");
  assert.equal(await a.validate(runtime, msg("what is IMD?")), true);
  const r = await a.handler(runtime, msg("what is IMD?"), undefined, undefined, async (c) => { replies.push(c); return []; });
  assert.equal(r.success, true);
  assert.equal(JSON.parse(log[0][1]).params.name, "swarm_mind_ask");
  assert.match(replies[0].text, /swarm_mind_ask/);
});

test("verdict-preview needs an address; validate is false without one", async () => {
  const a = byName(makeActions(fakeFetch([])), "NIGHTSHIFT_VERDICT_PREVIEW");
  assert.equal(await a.validate(runtime, msg("hello")), false);
  assert.equal(await a.validate(runtime, msg("preview " + TOKEN)), true);
  const r = await a.handler(runtime, msg("hello"));
  assert.equal(r.success, false);
});

test("buildcheck-sample extracts the URL and hits the free sample route", async () => {
  const log = [];
  const a = byName(makeActions(fakeFetch(log)), "NIGHTSHIFT_BUILDCHECK_SAMPLE");
  const r = await a.handler(runtime, msg("check https://example.com please"));
  assert.equal(r.success, true);
  assert.match(log[0][0], /\/api\/crews\/buildcheck\/sample\?url=https%3A%2F%2Fexample\.com/);
});

test("server error becomes a failed ActionResult with the HTTP status", async () => {
  const replies = [];
  const a = byName(makeActions(fakeFetch([])), "NIGHTSHIFT_WATCHTOWER_SAMPLE");
  const r = await a.handler(runtime, msg(TOKEN), undefined, undefined, async (c) => { replies.push(c); return []; });
  assert.equal(r.success, false);
  assert.match(replies[0].text, /HTTP 404/);
});
