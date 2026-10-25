import { describe, expect, it } from "vitest";
import { BuildCheckError, LIMITS, buildCheck } from "./buildcheck.js";
import { CHALLENGE, fakeFetch, json, mcpRoutes } from "./crews.fake.js";

const MCP = "https://svc.example/mcp";
const API = "https://svc.example/api/v1/thing";
const O = "https://svc.example";
const now = () => Date.parse("2026-10-25T10:00:00Z");
const status = (r: Awaited<ReturnType<typeof buildCheck>>) => Object.fromEntries(r.checks.map((c) => [c.id, c.status]));

describe("build & check", () => {
  it("passes an MCP server (JSON answers) in quick mode, and fails x402 where there are no terms", async () => {
    const f = fakeFetch(mcpRoutes(MCP));
    const r = await buildCheck(MCP, { fetch: f.fetch, now }, "quick");
    expect(status(r)).toEqual({ reachable: "pass", mcp: "pass", x402: "fail" });
    const mcp = r.checks.find((c) => c.id === "mcp")!;
    expect(mcp.detail).toContain("fake-mcp 1.2.3, protocol 2025-06-18");
    expect(mcp.detail).toContain("2 tools: lookup, report");
    expect(mcp.reproduce).toMatch(/^curl -sS -X POST 'https:\/\/svc\.example\/mcp' .*"method":"initialize".* && curl .*"method":"tools\/list"/);
    expect(r.summary).toEqual({ checks: 3, pass: 2, warn: 0, fail: 1, unavailable: 0, text: "3 checks: 2 pass, 0 warn, 1 fail, 0 unavailable" });
    expect(r.requests).toBe(4); // GET, initialize, initialized, tools/list
    // never a cookie or a credential, never a redirect followed by the fetch itself
    for (const c of f.calls) {
      expect(c.headers.cookie).toBeUndefined();
      expect(c.headers.authorization).toBeUndefined();
      expect(c.init.credentials).toBe("omit");
      expect(c.init.redirect).toBe("manual");
      expect(new URL(c.url).origin).toBe(O);
    }
  });

  it("reads MCP answers sent as SSE and keeps the session for tools/list", async () => {
    const f = fakeFetch(mcpRoutes(MCP, { sse: true, session: "sess-42", tools: [{ name: "a", description: "x".repeat(1_001) }, { name: "b" }] }));
    const r = await buildCheck(MCP, { fetch: f.fetch, now }, "quick");
    const mcp = r.checks.find((c) => c.id === "mcp")!;
    expect(mcp.status).toBe("warn");
    expect(mcp.detail).toContain("1 without a description");
    expect(mcp.detail).toContain("1 with a description over 1,000 characters");
    const list = f.calls.find((c) => c.body?.includes("tools/list"))!;
    expect(list.headers["mcp-session-id"]).toBe("sess-42");
    expect(list.headers["mcp-protocol-version"]).toBe("2025-06-18");
  });

  it("passes x402 terms in the body or the PAYMENT-REQUIRED header, and warns without discovery metadata", async () => {
    const body = fakeFetch({ [`GET ${API}`]: () => json(402, CHALLENGE) });
    const r1 = await buildCheck(API, { fetch: body.fetch, now }, "quick");
    expect(status(r1)).toEqual({ reachable: "pass", mcp: "fail", x402: "pass" });
    expect(r1.checks[2]!.detail).toContain("exact on eip155:8453, amount 100000");
    expect(r1.checks[2]!.reproduce).toBe(`curl -sS -i '${API}'`);

    const header = fakeFetch({ [`GET ${API}`]: () => new Response("", { status: 402, headers: { "payment-required": Buffer.from(JSON.stringify(CHALLENGE)).toString("base64") } }) });
    expect(status(await buildCheck(API, { fetch: header.fetch, now }, "quick")).x402).toBe("pass");

    const { extensions: _e, ...bare } = CHALLENGE;
    const noBazaar = fakeFetch({ [`GET ${API}`]: () => json(402, { ...bare, resource: { ...bare.resource, description: "d".repeat(600) } }) });
    const r3 = await buildCheck(API, { fetch: noBazaar.fetch, now }, "quick");
    expect(r3.checks[2]).toMatchObject({ status: "warn" });
    expect(r3.checks[2]!.detail).toContain("extensions.bazaar is missing");
    expect(r3.checks[2]!.detail).toContain("600 characters");

    const badTerms = fakeFetch({ [`GET ${API}`]: () => json(402, { ...CHALLENGE, accepts: [{ ...CHALLENGE.accepts[0], scheme: "upto", amount: "0" }] }) });
    expect(status(await buildCheck(API, { fetch: badTerms.fetch, now }, "quick")).x402).toBe("fail");
  });

  it("never counts a check that could not run as a pass", async () => {
    // the target answers GET, but every POST times out
    const f = fakeFetch({ [`GET ${API}`]: () => json(402, CHALLENGE), [`POST ${API}`]: () => { throw Object.assign(new Error("timeout"), { name: "TimeoutError" }); } });
    const r = await buildCheck(API, { fetch: f.fetch, now }, "quick");
    expect(r.checks[1]).toMatchObject({ id: "mcp", status: "unavailable" });
    expect(r.checks[1]!.detail).toContain("no answer within 8 s");
    expect(r.summary).toMatchObject({ pass: 2, unavailable: 1 });
    // nothing answers: the rest is not run, and nothing passes
    const dead = fakeFetch({}, () => null);
    const d = await buildCheck(MCP, { fetch: dead.fetch, now }, "full");
    expect(d.checks.map((c) => c.status)).toEqual(["fail", "unavailable", "unavailable", "unavailable", "unavailable"]);
    expect(d.summary.pass).toBe(0);
    expect(d.requests).toBe(1);
    expect(d.checks.every((c) => c.reproduce.startsWith("curl "))).toBe(true);
  });

  it("refuses a redirect to another host and follows one on the same origin", async () => {
    const away = fakeFetch({ [`GET ${MCP}`]: () => new Response(null, { status: 302, headers: { location: "https://evil.example/steal" } }) });
    const r = await buildCheck(MCP, { fetch: away.fetch, now }, "quick");
    expect(r.checks[0]).toMatchObject({ id: "reachable", status: "fail" });
    expect(r.checks[0]!.detail).toContain("another host (evil.example)");
    expect(away.calls.every((c) => !c.url.includes("evil.example"))).toBe(true);

    const near = fakeFetch({ [`GET ${O}/old`]: () => new Response(null, { status: 301, headers: { location: "/api/v1/thing" } }), [`GET ${API}`]: () => json(402, CHALLENGE) });
    const n = await buildCheck(`${O}/old`, { fetch: near.fetch, now }, "quick");
    expect(n.checks[0]!.detail).toContain("after a redirect to /api/v1/thing");
    expect(status(n).x402).toBe("pass");
  });

  it("makes at most 12 requests, even against an endless same-origin redirect", async () => {
    let i = 0;
    // the target answers; every other request is redirected (307 keeps a POST a POST) to a new path on the same origin
    const loop = fakeFetch({ [`GET ${O}/start`]: () => json(200, {}) }, () => new Response(null, { status: 307, headers: { location: `/hop-${i++}` } }));
    const r = await buildCheck(`${O}/start`, { fetch: loop.fetch, now }, "full");
    expect(loop.calls).toHaveLength(LIMITS.requests);
    expect(r.requests).toBe(LIMITS.requests);
    expect(status(r)).toEqual({ reachable: "pass", mcp: "fail", x402: "fail", openapi: "fail", discovery: "unavailable" });
    expect(r.checks[4]!.detail).toContain("the 12-request limit was reached");
  });

  it("runs all five checks in full mode: OpenAPI and the discovery documents", async () => {
    const spec = { openapi: "3.1.0", info: { title: "svc", version: "1" }, paths: { "/api/v1/thing": { get: { summary: "A thing" } }, "/api/v1/other": { get: { summary: "Other" }, post: {} } } };
    const f = fakeFetch({
      ...mcpRoutes(MCP),
      [`GET ${O}/openapi.json`]: () => json(200, spec),
      [`GET ${O}/llms.txt`]: () => new Response("# svc\n- thing", { status: 200, headers: { "content-type": "text/plain" } }),
      [`GET ${O}/.well-known/agent-card.json`]: () => new Response("<!doctype html><html></html>", { status: 200, headers: { "content-type": "text/html" } }),
      [`GET ${O}/.well-known/mcp.json`]: () => json(200, { name: "svc" }),
    });
    const r = await buildCheck(MCP, { fetch: f.fetch, now }, "full");
    expect(status(r)).toEqual({ reachable: "pass", mcp: "pass", x402: "fail", openapi: "warn", discovery: "warn" });
    expect(r.checks[3]!.detail).toBe("OpenAPI 3.1.0 at /openapi.json: 2 paths, 3 operations, 2 with a summary.");
    expect(r.checks[4]!.detail).toContain("/llms.txt: present (13 bytes)");
    expect(r.checks[4]!.detail).toContain("/.well-known/agent-card.json: absent (an HTML page, HTTP 200)");
    expect(r.checks[4]!.detail).toContain("/.well-known/mcp.json: present");
    expect(r.requests).toBe(8);
    expect(r.summary.text).toBe("5 checks: 2 pass, 2 warn, 1 fail, 0 unavailable");
  });

  it("refuses targets it must not touch, and does not request a plain http one", async () => {
    for (const bad of ["", "not a url", "ftp://svc.example/x", "https://user:pw@svc.example/", "https://svc.example:8443/"]) {
      await expect(buildCheck(bad, { fetch: fakeFetch({}).fetch, now }, "quick")).rejects.toBeInstanceOf(BuildCheckError);
    }
    const f = fakeFetch({});
    const r = await buildCheck("http://svc.example/mcp", { fetch: f.fetch, now }, "quick");
    expect(r.checks.map((c) => c.status)).toEqual(["fail", "unavailable", "unavailable"]);
    expect(f.calls).toHaveLength(0);
  });
});
