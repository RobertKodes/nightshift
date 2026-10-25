import { afterEach, describe, expect, it, vi } from "vitest";
import type { WatchReport } from "../watchtower/index.js";

const report = (over: Partial<WatchReport> = {}) => ({
  address: "0xe5e58e53d0bb204aa62c995a6c8cc8a48e60c3ac", chain: "ethereum", kind: "token", baseline: { at: "x", block: 1 }, observation: {} as never,
  changes: [{ id: "owner()", field: "owner", severity: "high", before: "0xaaa", after: "0xbbb", beforeBlock: 1, afterBlock: 2, evidence: ["https://etherscan.io/block/2"], kind: "change" }],
  unavailable: [], unsupported: [], stale: false, summary: "14 checks completed, 1 change detected (high), 0 checks unavailable.", human: "", coverageNote: "", ...over,
}) as unknown as WatchReport;

afterEach(() => { vi.resetModules(); vi.doUnmock("./live.js"); vi.doUnmock("./buildcheck.js"); });

describe("growth", () => {
  it("writes a Watchtower report as one message, with what could not run and no all-clear", async () => {
    const { watchMessage } = await import("./growth.js");
    const m = watchMessage(report({ unavailable: [{ id: "liq", label: "Liquidity", status: "unavailable" }] as never, stale: true }));
    expect(m).toContain("<b>owner</b> (high): 0xaaa → 0xbbb");
    expect(m).toContain("Could not check now: Liquidity");
    expect(m).toContain("not an all-clear");
    expect(m).not.toMatch(/\bsafe\b(?! or profitable)/i);
  });

  it("badges a URL with its live quick check, colours by result, and caches it", async () => {
    const run = vi.fn(async () => ({ summary: { checks: 3, pass: 2, warn: 1, fail: 0, unavailable: 0, text: "" } }));
    vi.doMock("./buildcheck.js", async (orig) => ({ ...(await orig<typeof import("./buildcheck.js")>()), buildCheck: run }));
    const { buildcheckBadge } = await import("./growth.js");
    const a = await buildcheckBadge("https://agent.example/mcp");
    expect(a.svg).toContain("2/3 pass");
    expect(a.svg).toContain("#dfb317");
    await buildcheckBadge("https://agent.example/mcp");
    expect(run).toHaveBeenCalledTimes(1);
    expect((await buildcheckBadge("not a url")).status).toBe(400);
  });

  it("posts each public change once, only high severity, and at most 3 a day", async () => {
    let n = 0;
    const wt = { check: vi.fn(async (a: string) => report({ address: a as never, changes: [{ id: "owner()", field: "owner", severity: "high", before: "0x1", after: `0x${a.slice(-1)}${n}`, beforeBlock: 1, afterBlock: 2, evidence: [] }] as never })) };
    vi.doMock("./live.js", () => ({ liveWatchtower: () => wt, crewLedger: () => ({}), crewProfiles: () => [] }));
    const { PublicWatch } = await import("./growth.js");
    let t = Date.parse("2026-10-25T10:00:00Z");
    const posts: string[] = [];
    const tokens = ["0x0000000000000000000000000000000000000001", "0x0000000000000000000000000000000000000002", "0x0000000000000000000000000000000000000003", "0x0000000000000000000000000000000000000004"].map((address, i) => ({ address, symbol: `T${i}`, launch: i }));
    const pw = new PublicWatch({ file: `${process.env.TEMP ?? "/tmp"}/pw-${Math.random().toString(36).slice(2)}.json`, tokens: async () => tokens, post: async (x) => { posts.push(x); return true; }, now: () => t });
    expect(await pw.tick()).toEqual({ checked: 4, posted: 3 });
    t += 3 * 3_600_000;
    await pw.tick();
    expect(posts).toHaveLength(3); // same changes, and the day's three are used
    t += 24 * 3_600_000; n = 1;
    await pw.tick();
    expect(posts).toHaveLength(6);
    expect(posts[0]).toContain("Watchtower spotted a change");
  });
});
