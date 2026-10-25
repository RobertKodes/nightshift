import { describe, expect, it } from "vitest";
import { OwnerStats, ownerReport, reportSlot, type StatsSources } from "./owner-stats.js";
import { Usage } from "./usage.js";

const sources = (u: Usage, over: Partial<StatsSources> = {}): StatsSources => ({
  usage: u, live: () => ({ visitors5m: 3, visitors1m: 1 }), jobs: () => [], operators: () => [], sales: () => [], recruiter: () => ({ state: "running", prospects: 50, waiting: 20, sentToday: 0 }), ...over,
});

describe("owner stats", () => {
  it("reports agents apart from directories, the site, the crews and the recruiter", () => {
    const t = Date.parse("2026-10-25T10:00:00Z");
    const u = new Usage(null, () => t);
    u.mcp("1.1.1.1", { method: "initialize", params: { clientInfo: { name: "claude-code" } } });
    u.mcp("1.1.1.1", { method: "tools/call", params: { name: "watchtower_sample" } });
    u.mcp("2.2.2.2", { method: "initialize", params: { clientInfo: { name: "rokmcp-collector" } } });
    u.page("3.3.3.3", "/crews", "https://t.co/x", "Mozilla/5.0 Safari", new URLSearchParams(), "getnightshift.tech");
    const r = ownerReport(sources(u, { jobs: () => [{ crew: "watchtower", status: "done", free: false, paid: { usd: 0.05, class: "customer" }, kind: "watchtower-check" }] }), t);
    expect(r).toContain("2 MCP sessions, <b>1 tool calls</b>");
    expect(r).toMatch(/agents: claude-code 1/);
    expect(r).toMatch(/directories and scanners: rokmcp-collector 1/);
    expect(r).toContain("from: t.co 1");
    expect(r).toContain("<b>1 paid by customers</b>");
    expect(r).toContain("20 invitations waiting for you");
  });

  it("pings each new agent client once, caps pings at 6 an hour, and survives a restart", async () => {
    let t = Date.parse("2026-10-25T10:00:00Z");
    const u = new Usage(null, () => t), sent: string[] = [];
    const file = `${process.env.TEMP ?? "/tmp"}/owner-stats-${Math.random().toString(36).slice(2)}.json`;
    const make = () => new OwnerStats({ file, sources: sources(u), send: async (x) => { sent.push(x); return true; }, now: () => t });
    u.mcp("1.1.1.1", { method: "initialize", params: { clientInfo: { name: "my-agent" } } });
    const a = make();
    await a.tick();
    expect(sent.filter((x) => x.includes("New agent"))).toHaveLength(1);
    await a.tick();
    expect(sent.filter((x) => x.includes("New agent"))).toHaveLength(1);
    const b = make();
    await b.tick();
    expect(sent.filter((x) => x.includes("New agent"))).toHaveLength(1);
    for (let i = 0; i < 9; i++) b.onCrewEvent({ at: t, crew: "watchtower", kind: "watchtower-check", status: "done", summary: "paid", paid: true, house: true });
    t += 60_000; await b.tick();
    expect(sent.length).toBe(6);
    t += 3_600_000; await b.tick();
    expect(sent.length).toBe(10);
  });

  it("sends the report at 09:00 and 21:00 Bucharest, once each", async () => {
    expect(reportSlot(Date.parse("2026-10-25T07:05:00Z"))).toBe("2026-10-25 09"); // winter time from today, 25 October: UTC+2
    expect(reportSlot(Date.parse("2026-10-25T19:00:00Z"))).toBe("2026-10-25 21");
    expect(reportSlot(Date.parse("2026-10-25T07:15:00Z"))).toBeNull();
    expect(reportSlot(Date.parse("2026-07-01T06:05:00Z"))).toBe("2026-07-01 09"); // summer time: UTC+3
    let t = Date.parse("2026-10-25T07:01:00Z");
    const sent: string[] = [];
    const s = new OwnerStats({ file: null, sources: sources(new Usage(null, () => t)), send: async (x) => { sent.push(x); return true; }, now: () => t });
    await s.tick(); t += 60_000; await s.tick();
    expect(sent.filter((x) => x.includes("your private stats"))).toHaveLength(1);
  });
});
