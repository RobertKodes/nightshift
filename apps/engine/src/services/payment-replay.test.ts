import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { PaymentPayload } from "@nightshift/x402";
import { Checkout, PendingError } from "../checkout.js";
import { Store } from "../store.js";
import type { Ctx } from "./context.js";
import { services, type Io, type Payer } from "./routes.js";
import type { Watchtower } from "../watchtower/watchtower.js";
import { registerServiceTools } from "./mcp.js";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { PaymentRequests, requestDigest, REQUEST_CONFLICT } from "./payment-requests.js";

const work = vi.hoisted(() => ({ calls: 0 }));
vi.mock("./fast-tools.js", () => ({ fastTools: () => ({ run: async () => ({ serial: ++work.calls }), latency: () => null }) }));
vi.mock("./verdict.js", async (load) => ({ ...await load<typeof import("./verdict.js")>(), tokenVerdict: async () => ({ serial: ++work.calls }) }));
vi.mock("./hook.js", async (load) => ({ ...await load<typeof import("./hook.js")>(), inspectHook: async () => ({ serial: ++work.calls }) }));
vi.mock("./feed.js", () => ({ feed: () => Object.fromEntries(["launches", "launch", "tokens", "swarm", "agent"].map((k) => [k, async () => ({ serial: ++work.calls })])) }));
const A = `0x${"11".repeat(20)}` as const, B = `0x${"22".repeat(20)}` as const, TX = `0x${"ab".repeat(32)}` as const;
const NONCE = `0x${"33".repeat(32)}` as const;
const ctx = { d: { now: () => Date.UTC(2026, 9, 27) } } as Ctx;
afterEach(() => { vi.restoreAllMocks(); });
async function harness() {
  work.calls = 0;
  const dir = mkdtempSync(join(tmpdir(), "paid-replay-"));
  let settles = 0, pending = false;
  const make = async () => {
    const store = new Store(dir); await store.load();
    const checkout = new Checkout(store.settlements, () => store.save(), {
      used: async () => false, find: async () => null,
      sign: async () => { settles++; return { hash: TX, raw: TX, nonce: 1 }; },
      broadcast: async () => {}, state: async () => pending ? "pending" : "success", refused: () => false,
    }, async () => {}, 0);
    const payer: Payer = { mode: "live", chainId: 8453, payTo: () => B, requests: checkout.requests,
      check: async (o) => ({ ok: true, payer: A, payment: { payload: { authorization: { from: A, to: B, nonce: NONCE, value: String(o.priceUsdc) } } } as PaymentPayload }),
      settle: (o, p) => checkout.settle("nightshift-services", B, o.id, p), sim: async () => {}, isPending: (e) => e instanceof PendingError };
    let watch: { id: string; status: string };
    const wt = { check: async () => ({ serial: ++work.calls }),
      startWatch: async () => { watch = { id: `watch-${++work.calls}`, status: "pending" }; return { watch, report: { serial: work.calls }, manageToken: "secret", telegramCode: "code" }; },
      confirmPayment: () => { watch.status = "active"; return true; }, getWatch: () => ({ watch }),
    } as unknown as Watchtower;
    const s = services(ctx, payer, { watchtower: wt, research: async () => ({ serial: ++work.calls }), buildCheck: async () => ({ serial: ++work.calls }) });
    return { s, checkout, store };
  };
  return { make, settled: () => settles, pending: (v: boolean) => { pending = v; } };
}
const io = (url: string): Io => { const u = new URL(url, "https://house.test"); return { method: "GET", path: u.pathname, query: u.searchParams, header: () => "signed", ip: "test", base: u.origin, limited: () => false }; };
const cases = [
  ["token", `/api/v1/token-price?chain=ethereum&token=${A}`, `/api/v1/token-price?chain=ethereum&token=${B}`],
  ["chain", `/api/v1/token-price?chain=ethereum&token=${A}`, `/api/v1/token-price?chain=base&token=${A}`],
  ["verdict", `/api/v1/verdict/ethereum/${A}`, `/api/v1/verdict/ethereum/${B}`],
  ["hook", `/api/v1/hook/${A}`, `/api/v1/hook/${B}`],
  ["feed endpoint", "/api/v1/imd/launches", "/api/v1/imd/tokens"],
  ["feed query", "/api/v1/imd/launches?limit=2", "/api/v1/imd/launches?limit=3"],
  ["watch check", `/api/v1/watchtower/check/ethereum/${A}`, `/api/v1/watchtower/check/ethereum/${B}`],
  ["watch term", `/api/v1/watchtower/watch/ethereum/${A}`, `/api/v1/watchtower/watch/ethereum/${B}`],
  ["research", "/api/v1/research?q=How+does+the+swarm+work", "/api/v1/research?q=What+can+the+swarm+build"],
  ["buildcheck", "/api/v1/buildcheck?url=https://one.example/api", "/api/v1/buildcheck?url=https://two.example/api"],
];
describe("paid request replay", () => {
  it.each(cases)("refuses changed %s and returns the exact answer across restart", async (_kind, first, changed) => {
    const h = await harness(), a = await h.make();
    const answer = await a.s.handle(io(first!)); expect(answer?.status).toBe(200);
    expect(await a.s.handle(io(changed!))).toMatchObject({ status: 409, body: { error: REQUEST_CONFLICT } });
    const b = await h.make();
    expect(await b.s.handle(io(first!))).toEqual(answer);
    expect(await b.s.handle(io(changed!))).toMatchObject({ status: 409 });
    expect(work.calls).toBe(1); expect(h.settled()).toBe(1);
  });
  it("coalesces concurrent retries and canonicalizes validated query order", async () => {
    const h = await harness(), { s } = await h.make();
    const a = `/api/v1/token-price?chain=ethereum&token=${A}`, b = `/api/v1/token-price?token=${A.toUpperCase().replace("0X", "0x")}&chain=ethereum`;
    const replies = await Promise.all([s.handle(io(a)), s.handle(io(b)), s.handle(io(a))]);
    expect(replies[1]).toEqual(replies[0]); expect(replies[2]).toEqual(replies[0]);
    expect(work.calls).toBe(1); expect(h.settled()).toBe(1);
  });
  it("refuses a changed request racing the original payment", async () => {
    const h = await harness(), { s } = await h.make();
    const [first, changed] = await Promise.all([s.handle(io(`/api/v1/token-price?chain=base&token=${A}`)), s.handle(io(`/api/v1/token-price?chain=base&token=${B}`))]);
    expect(first?.status).toBe(200); expect(changed?.status).toBe(409);
    expect(work.calls).toBe(1); expect(h.settled()).toBe(1);
  });
  it("saves the computed answer before a pending settlement, then recovers after restart", async () => {
    const h = await harness(); h.pending(true);
    const a = await h.make(), url = `/api/v1/token-price?chain=base&token=${A}`;
    expect(await a.s.handle(io(url))).toMatchObject({ status: 202 });
    h.pending(false); const b = await h.make(); await b.checkout.resolve();
    expect(await b.s.handle(io(url))).toMatchObject({ status: 200, body: { serial: 1 } });
    expect(work.calls).toBe(1); expect(h.settled()).toBe(1);
  });
  it("rejects duplicate or invalid feed filters before binding or computing", async () => {
    const h = await harness(), { s, store } = await h.make();
    for (const query of ["limit=2&limit=3", "since=bad", "before=NaN", "extra=1"]) expect(await s.handle(io(`/api/v1/imd/launches?${query}`))).toMatchObject({ status: 400 });
    expect(store.settlements.size).toBe(0); expect(work.calls).toBe(0);
  });
  it("enforces the same binding on MCP paid tools", async () => {
    const h = await harness(), { s } = await h.make();
    const tools = new Map<string, (args: object) => Promise<{ content: { text: string }[]; isError?: boolean }>>();
    const server = { registerTool: (name: string, _config: unknown, handler: never) => { tools.set(name, handler); } } as unknown as McpServer;
    registerServiceTools(server, s, { ip: "mcp", base: "https://house.test", limited: () => false });
    const call = tools.get("token_price")!;
    const first = await call({ chain: "ethereum", token: A, payment: "signed" });
    expect(await call({ chain: "ethereum", token: A, payment: "signed" })).toEqual(first);
    const changed = await call({ chain: "ethereum", token: B, payment: "signed" });
    expect(changed.isError).toBe(true); expect(JSON.parse(changed.content[0]!.text).error).toBe(REQUEST_CONFLICT);
    expect(work.calls).toBe(1);
  });
  it("bounds saved answers, retains them for 24 hours and never recomputes expired payments", async () => {
    let now = 0; const records = new Map(); const requests = new PaymentRequests(records, async () => {}, () => now);
    const r = { key: "payer:nonce", companyId: "house", productId: "tool", payer: A, value: 1n, at: 0 };
    const run = vi.fn(async (_q: unknown, keep: (key: "answer" | "response", v: unknown) => Promise<void>) => { await keep("answer", { value: "ok" }); const out = { status: 200, body: { value: "ok" } }; await keep("response", out); return out; });
    const digest = requestDigest("GET", "/tool", { b: "2", a: "1" });
    expect(digest).toBe(requestDigest("GET", "/tool", { a: "1", b: "2" }));
    await requests.use(r, digest, run); now = 86_400_000 - 1;
    expect(await requests.use(r, digest, run)).toMatchObject({ status: 200 }); expect(run).toHaveBeenCalledTimes(1);
    records.get(r.key).booked = true; now++;
    await expect(requests.use(r, digest, run)).rejects.toMatchObject({ status: 410 });
    await expect(requests.use({ ...r, key: "other", request: undefined, booked: false }, digest, async (_q, keep) => { await keep("answer", { text: "x".repeat(1024 * 1024 + 1) }); return { status: 200, body: {} }; })).rejects.toMatchObject({ status: 503 });
  });
});
