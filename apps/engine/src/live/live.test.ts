import { EventEmitter } from "node:events";
import type { IncomingMessage, ServerResponse } from "node:http";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { JobLedger } from "../crews/ledger.js";
import { LiveBus, publicText } from "./bus.js";
import { LiveDiff } from "./sources.js";
import { liveRoutes, StreamLimits, streamLimits } from "./routes.js";
import { Spotlight, SpotlightError, spotlightTarget, SPOTLIGHT_HOLDING, SPOTLIGHT_INTERVAL } from "./spotlight.js";

const WALLET = `0x${"1".repeat(40)}`, TOKEN = `0x${"a".repeat(40)}`;
const NOW = Date.parse("2026-10-26T12:00:00Z");
afterEach(() => vi.useRealTimers());

describe("public live bus", () => {
  it("keeps only the last 200 and snapshots the last 50 without exposing mutable internals", () => {
    const bus = new LiveBus(() => NOW);
    for (let i = 0; i < 220; i++) bus.emit("agent.docked", { client: `agent ${i}` });
    expect(bus.recent(200)).toHaveLength(200);
    expect(bus.recent(200)[0]!.data).toEqual({ client: "agent 20" });
    expect(bus.snapshot().events).toHaveLength(50);
    expect(bus.recent(0)).toEqual([]);
    bus.recent(200)[0]!.data = { client: "changed" };
    expect(bus.recent(200)[0]!.data).toEqual({ client: "agent 20" });
  });
  it("rebuilds payloads and removes wallets, addresses, handles, controls and secrets", () => {
    const bus = new LiveBus(() => NOW);
    const text = `<script>hello</script> @telegram_user 192.168.4.2 ${WALLET} api_key=secret123 \u202e`;
    bus.emit("tg.request", { kind: "ask", summary: text, ip: "1.2.3.4", username: "private" } as never);
    const wire = JSON.stringify(bus.recent());
    for (const value of ["telegram_user", "192.168.4.2", WALLET, "secret123", "username", "1.2.3.4", "<script>"]) expect(wire).not.toContain(value);
    expect(publicText("x".repeat(400))).toHaveLength(180);
    expect(publicText("mail@example.com https://example.com/private?q=secret 2001:db8::1")).not.toContain("example.com");
    const e = bus.emit("shift.buy", { buyer: WALLET, usd: Infinity, eth: NaN, test: true });
    expect(e.data).toEqual({ buyer: "0x1111…1111", usd: 0, eth: null, test: true });
  });
  it("isolates listeners and enriches a launch without a second rocket", () => {
    const bus = new LiveBus(() => NOW), listener = vi.fn();
    bus.on(() => { throw new Error("viewer failed"); });
    const off = bus.on(listener);
    bus.emit("imd.launch", { launch: 1, name: "First", verdict: "unchecked", summary: "pending" });
    bus.emit("imd.launch", { launch: 1, name: "First", verdict: "caution", summary: "NIGHT SNIPER found a fee" });
    expect(bus.recent()).toHaveLength(1);
    expect(bus.recent()[0]!.data).toMatchObject({ update: true });
    expect(listener).toHaveBeenCalledTimes(2); off();
    bus.emit("agent.docked", { client: "Cursor" });
    expect(listener).toHaveBeenCalledTimes(2);
  });
});

describe("source diffs", () => {
  it("emits changed pulse values while retaining the real read timestamp", () => {
    const bus = new LiveBus(() => NOW), diff = new LiveDiff(bus, () => NOW);
    diff.pulse({ agentsOnline: 3, jobsDoneLastDay: 12, at: NOW - 1000, ok: true });
    diff.pulse({ agentsOnline: 3, jobsDoneLastDay: 12, at: NOW, ok: true });
    diff.pulse(null);
    expect(bus.recent()).toHaveLength(1); expect(bus.stats.pulseAt).toBe(NOW);
    diff.pulse({ agentsOnline: 4, jobsDoneLastDay: 12, at: NOW, ok: true });
    expect(bus.recent()).toHaveLength(2);
  });
  it("baselines client names and suppresses repeats, count increases and UTC rollover", () => {
    const bus = new LiveBus(() => NOW), diff = new LiveDiff(bus, () => NOW);
    diff.clients([{ name: "Cursor", count: 1 }]);
    diff.clients([{ name: "Cursor", count: 3 }, { name: "Claude", count: 1 }]);
    diff.clients([]); diff.clients([{ name: "Claude", count: 5 }]);
    expect(bus.recent().map((e) => e.data)).toEqual([{ client: "Claude" }]);
    diff.clients([{ name: "Cursor", count: 1 }], "2026-10-27");
    expect(bus.recent()).toHaveLength(1);
  });
  it("dispatches one drone per completion and no historical launch on startup", () => {
    let now = NOW;
    const bus = new LiveBus(() => now), diff = new LiveDiff(bus, () => now);
    const job = { id: "one", state: "executing", template: "audit", updatedAt: new Date(NOW).toISOString() };
    diff.jobs([job]); now += 1000;
    diff.jobs([{ ...job, state: "completed" }]); diff.jobs([{ ...job, state: "completed" }]);
    expect(bus.recent().filter((e) => e.type === "imd.job")).toHaveLength(1);
    const launch = { launchNumber: 1, status: "live", createdAt: new Date(NOW).toISOString() };
    diff.launches([launch]); diff.launches([launch, { ...launch, launchNumber: 2 }]); diff.launches([launch, { ...launch, launchNumber: 2 }]);
    expect(bus.recent().filter((e) => e.type === "imd.launch")).toHaveLength(1);
  });
});

function fixture(o: { holds?: (wallet: string) => Promise<boolean>; file?: string } = {}) {
  let now = NOW;
  const bus = new LiveBus(() => now), ledger = new JobLedger({ file: null, now: () => now });
  const run = vi.fn(async () => ({ summary: "2 checks unavailable <b>not an all-clear</b>", ok: false }));
  const deps = { bus, ledger, run, holds: o.holds ?? (async () => true), now: () => now, file: o.file };
  return { bus, ledger, run, deps, queue: new Spotlight(deps), advance: (ms: number) => { now += ms; } };
}
describe("holder Spotlight", () => {
  it("requires a signed-in holder and the exact 500k threshold", async () => {
    const f = fixture({ holds: async () => false });
    expect(SPOTLIGHT_HOLDING).toBe(500_000n * 10n ** 18n);
    await expect(f.queue.enqueue(null, "token", TOKEN)).rejects.toMatchObject({ status: 401 });
    await expect(f.queue.enqueue(WALLET, "token", TOKEN)).rejects.toMatchObject({ status: 403 });
    expect(f.queue.view().queued).toBe(0);
  });
  it("allows one entry per rolling 24 hours, case-insensitively, including simultaneous calls", async () => {
    let release!: (value: boolean) => void;
    const f = fixture({ holds: () => new Promise<boolean>((resolve) => { release = resolve; }) });
    const first = f.queue.enqueue(WALLET, "token", TOKEN);
    await expect(f.queue.enqueue(WALLET.toUpperCase().replace("0X", "0x"), "token", TOKEN)).rejects.toMatchObject({ status: 429 });
    release(true); await first;
    await expect(f.queue.enqueue(WALLET, "token", TOKEN)).rejects.toMatchObject({ status: 429 });
    f.advance(86_400_000);
    const second = f.queue.enqueue(WALLET, "token", TOKEN); release(true); await second;
    expect(f.queue.view().queued).toBe(2);
  });
  it("caps the queue at 20 holders", async () => {
    const f = fixture();
    for (let i = 1; i <= 20; i++) await f.queue.enqueue(`0x${i.toString(16).padStart(40, "0")}`, "token", TOKEN);
    await expect(f.queue.enqueue(`0x${"f".repeat(40)}`, "token", TOKEN)).rejects.toMatchObject({ status: 429 });
    expect(f.queue.view().queued).toBe(20);
  });
  it("runs the real checker at most once per three minutes and records free ledger results", async () => {
    const f = fixture(); await f.queue.enqueue(WALLET, "token", TOKEN);
    await f.queue.enqueue(`0x${"2".repeat(40)}`, "agent", "https://example.com/mcp");
    await f.queue.tick(); await f.queue.tick();
    expect(f.run).toHaveBeenCalledTimes(1); expect(f.queue.view().queued).toBe(1);
    const job = f.ledger.list()[0]!; expect(job.kind).toBe("spotlight.token"); expect(job.free).toBe(true); expect(job.payment).toBeNull();
    expect(f.queue.view().current!.summary).not.toContain("<b>");
    f.advance(SPOTLIGHT_INTERVAL); await f.queue.tick(); expect(f.run).toHaveBeenCalledTimes(2);
  });
  it("persists the queue and cooldown across a restart", async () => {
    const dir = mkdtempSync(join(tmpdir(), "nightshift-live-"));
    try {
      const f = fixture({ file: join(dir, "spotlight.json") }); await f.queue.enqueue(WALLET, "token", TOKEN);
      const restarted = new Spotlight(f.deps);
      expect(restarted.view().queued).toBe(1);
      await expect(restarted.enqueue(WALLET, "token", TOKEN)).rejects.toMatchObject({ status: 429 });
    } finally { rmSync(dir, { recursive: true }); }
  });
  it("refuses dangerous and credential-bearing URLs", () => {
    for (const url of ["http://example.com", "https://127.0.0.1", "https://user:pass@example.com", "https://example.com/?key=secret", "https://example.com/#secret", "https://host.internal"]) expect(() => spotlightTarget("agent", url)).toThrow(SpotlightError);
    expect(spotlightTarget("agent", "https://example.com/mcp").caption).toBe("example.com");
  });
});

describe("SSE admission and cleanup", () => {
  it("enforces 2,000 global and six per IP, with idempotent release", () => {
    const limits = new StreamLimits();
    const slots = Array.from({ length: 6 }, () => limits.acquire("one"));
    expect(limits.acquire("one").status).toBe(429);
    slots[0]!.release?.(); slots[0]!.release?.(); expect(limits.total).toBe(5);
    for (let i = 0; i < 1995; i++) expect(limits.acquire(`client-${i}`).status).toBe(200);
    expect(limits.acquire("overflow").status).toBe(503);
  });
  it("sends a snapshot, keepalives and live events, and releases on disconnect", async () => {
    vi.useFakeTimers();
    const req = Object.assign(new EventEmitter(), { method: "GET", url: "/api/live/stream", headers: {}, socket: { remoteAddress: "203.0.113.1" } }) as unknown as IncomingMessage;
    const writes: string[] = [];
    const res = Object.assign(new EventEmitter(), { writeHead: vi.fn(), flushHeaders: vi.fn(), write: (s: string) => { writes.push(s); return writes.length !== 1; }, destroy: vi.fn() }) as unknown as ServerResponse;
    const ctx = { json: vi.fn(), body: async () => ({}), limited: () => false, owner: null };
    // Avoid reading a production Spotlight file in this transport test.
    const spotlightModule = await import("./spotlight.js");
    const view = vi.spyOn(spotlightModule, "liveSpotlight").mockReturnValue({ view: () => ({ queued: 0, nextAt: 0, current: null }) } as Spotlight);
    try {
      const before = streamLimits.total; await liveRoutes(req, res, "/api/live/stream", ctx);
      expect(streamLimits.total).toBe(before + 1); expect(writes.join("")).toContain("event: ready");
      res.emit("drain");
      await vi.advanceTimersByTimeAsync(20_000); expect(writes.join("")).toContain(": keepalive");
      const { liveBus } = await import("./bus.js"); liveBus.emit("agent.docked", { client: "test" }); expect(writes.join("")).toContain("event: live");
      res.emit("close"); expect(streamLimits.total).toBe(before);
      const count = writes.length; await vi.advanceTimersByTimeAsync(40_000); expect(writes).toHaveLength(count);
    } finally { view.mockRestore(); res.emit("close"); }
  });
});
