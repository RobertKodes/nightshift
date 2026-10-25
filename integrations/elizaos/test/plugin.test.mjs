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

test("plugin exposes four actions", () => {
  assert.deepEqual(nightshiftPlugin.actions.map((a) => a.name).sort(), [
    "NIGHTSHIFT_ASK_SWARM", "NIGHTSHIFT_BUILDCHECK_SAMPLE", "NIGHTSHIFT_VERDICT_PREVIEW", "NIGHTSHIFT_WATCHTOWER_SAMPLE",
  ]);
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
