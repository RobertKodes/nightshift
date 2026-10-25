import test from "node:test";
import assert from "node:assert/strict";
import { makeEntryHandler, parseToken } from "../src/handler.ts";
import { loadConfig } from "../src/config.ts";

const TOKEN = "0xdAC17F958D2ee523a2206206994597C13D831ec7";
const cfg = loadConfig({});
const req = (content: string) => ({
  kind: "message" as const, onChainJobId: "1", chainId: 8453, from: "0xbuyer",
  contentType: "requirement" as const, content, timestamp: 1,
});
const funded = {
  kind: "system" as const, onChainJobId: "1", chainId: 8453, timestamp: 2,
  event: { type: "job.funded" as const, jobId: "1" },
} as any;

function fakeSession(entries: any[]) {
  const calls: any = { budget: null, submitted: null, messages: [] as string[] };
  return {
    calls,
    s: {
      jobId: "1", chainId: 8453, status: "open", entries, job: { description: cfg.offeringName },
      setBudget: async (a: unknown) => { calls.budget = a; },
      submit: async (d: string) => { calls.submitted = d; },
      sendMessage: async (m: string) => { calls.messages.push(m); },
    },
  };
}

test("parseToken accepts JSON or bare address, rejects junk", () => {
  assert.equal(parseToken(JSON.stringify({ token: TOKEN })), TOKEN);
  assert.equal(parseToken(TOKEN), TOKEN);
  assert.equal(parseToken('{"token":"nope"}'), null);
});

test("requirement -> sets a USDC budget", async () => {
  const r = req(JSON.stringify({ token: TOKEN }));
  const { s, calls } = fakeSession([r]);
  await makeEntryHandler(cfg, (async () => { throw new Error("no fetch yet"); }) as any)(s, r);
  assert.ok(calls.budget, "budget set");
});

test("bad requirement -> message, no budget", async () => {
  const r = req('{"token":"x"}');
  const { s, calls } = fakeSession([r]);
  await makeEntryHandler(cfg)(s, r);
  assert.equal(calls.budget, null);
  assert.match(calls.messages[0], /40-hex/);
});

test("job.funded -> fetches the free preview and submits it", async () => {
  const r = req(JSON.stringify({ token: TOKEN }));
  const { s, calls } = fakeSession([r, funded]);
  let url = "";
  const fakeFetch = (async (u: string) => { url = u; return new Response('{"preview":true}', { status: 200 }); }) as any;
  await makeEntryHandler(cfg, fakeFetch)(s, funded);
  assert.equal(url, `https://getnightshift.tech/api/v1/verdict/ethereum/${TOKEN}/preview`);
  assert.equal(calls.submitted, '{"preview":true}');
});

test("upstream error is reported, nothing submitted", async () => {
  const r = req(TOKEN);
  const { s, calls } = fakeSession([r, funded]);
  await makeEntryHandler(cfg, (async () => new Response('{"error":"boom"}', { status: 500 })) as any)(s, funded);
  assert.equal(calls.submitted, null);
  assert.match(calls.messages[0], /500/);
});
