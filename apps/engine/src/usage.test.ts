import { describe, expect, it } from "vitest";
import { Usage, clientName, isAgentClient, isProbeClient, type UsageEvent } from "./usage.js";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

describe("usage counts", () => {
  it("persists a rolling 24 hours across UTC midnight, with an exact partial-hour cutoff", () => {
    let t = Date.parse("2026-10-25T00:10:00Z");
    const file = join(mkdtempSync(join(tmpdir(), "usage-hours-")), "usage.json"), u = new Usage(file, () => t);
    const page = (ip: string) => u.page(ip, "/crews", "https://t.co/link", "Mozilla/5.0 Safari", new URLSearchParams(), "nightshift.example");
    page("192.0.2.1");
    t += 20 * 60_000; page("192.0.2.2");
    u.mcp("192.0.2.2", { method: "initialize", params: { clientInfo: { name: "Cursor" } } });
    u.mcp("192.0.2.2", { method: "tools/call", params: { name: "start_here" } });
    t = Date.parse("2026-10-26T00:20:00Z"); page("192.0.2.2");
    const r = u.rolling24();
    expect(r.web).toMatchObject({ views: 2, visitorDays: 1, from: [{ name: "t.co", count: 2 }] });
    expect(r.mcp).toMatchObject({ sessions: 1, calls: 1, clients: [{ name: "Cursor", count: 1 }] });
    expect(u.report(1).web.views).toBe(1); expect(u.report(7).web.views).toBe(3);
    u.save(); const loaded = new Usage(file, () => t);
    expect(loaded.rolling24()).toEqual(r);
    expect(readFileSync(file, "utf8")).not.toContain("192.0.2");
    t += 10 * 60_000; expect(loaded.rolling24().mcp.calls).toBe(0);
    t += 8 * 86_400_000; loaded.rolling24(); loaded.save();
    expect(JSON.parse(readFileSync(file, "utf8")).hours).toEqual({});
    expect(loaded.report(7).web.views).toBe(3);
  });
  it("attributes stateless calls by caller, server and client hint, without emitting addresses", () => {
    let t = Date.parse("2026-10-25T10:00:00Z");
    const u = new Usage(null, () => t), events: UsageEvent[] = [];
    const stop = u.onActivity((e) => events.push(e));
    const init = (name: string) => ({ method: "initialize", params: { clientInfo: { name } } });
    const call = { method: "tools/call", params: { name: "start_here" } };
    u.mcp("192.0.2.1", init("Cursor"), "public", "cursor");
    u.mcp("192.0.2.1", init("registry-probe"), "public", "scanner");
    u.mcp("192.0.2.1", call, "public", "cursor");
    u.mcp("192.0.2.1", call, "public", "scanner");
    u.mcp("192.0.2.1", call, "nightshift", "cursor");
    expect(events.slice(2)).toEqual([
      { kind: "call", client: "Cursor", tool: "start_here" },
      { kind: "call", client: "registry-probe", tool: "start_here" },
      { kind: "call", client: "unnamed", tool: "nightshift:start_here" },
    ]);
    expect(JSON.stringify(events)).not.toContain("192.0.2.1");
    t += 3_600_000; u.mcp("192.0.2.1", call, "public", "cursor");
    expect(events.at(-1)).toMatchObject({ client: "unnamed" });
    stop(); u.mcp("192.0.2.1", call); expect(events).toHaveLength(6);
    expect(isProbeClient("mcp-directory")).toBe(true);
    expect(isAgentClient("mcp-directory")).toBe(false);
    expect(isAgentClient("claude-code")).toBe(true);
  });

  it("counts MCP sessions by announced client and tool calls by tool, callers once a day", () => {
    let t = Date.parse("2026-10-25T10:00:00Z");
    const u = new Usage(null, () => t);
    u.mcp("1.1.1.1", { jsonrpc: "2.0", id: 1, method: "initialize", params: { clientInfo: { name: "claude-code", version: "2.1" } } });
    u.mcp("1.1.1.1", [{ method: "tools/call", params: { name: "start_here" } }, { method: "tools/call", params: { name: "imd_market" } }]);
    u.mcp("2.2.2.2", { method: "initialize", params: { clientInfo: { name: "Cursor <script>" } } });
    u.mcp("2.2.2.2", { method: "tools/list" });
    u.mcp("3.3.3.3", { method: "tools/call", params: { name: "nightshift_order" } }, "nightshift");
    const w = u.publicWeek();
    expect(w).toMatchObject({ sessions: 2, toolCalls: 3, callerDays: 3 });
    expect(w.clients.map((c) => c.name).sort()).toEqual(["Cursor script", "claude-code"]);
    // the owner server's tools stay out of the public view
    expect(w.tools.map((x) => x.name).sort()).toEqual(["imd_market", "start_here"]);
    t += 86_400_000;
    u.mcp("1.1.1.1", { method: "initialize", params: {} });
    const r = u.report(7);
    expect(r.days).toHaveLength(2);
    expect(r.mcp.callerDays).toBe(4);
    expect(r.mcp.clients.find((c) => c.name === "unnamed")?.count).toBe(1);
  });

  it("keeps active client attribution through midnight", () => {
    let t = Date.parse("2026-10-25T23:50:00Z");
    const u = new Usage(null, () => t), events: UsageEvent[] = [];
    u.onActivity((e) => events.push(e));
    u.mcp("192.0.2.1", { method: "initialize", params: { clientInfo: { name: "Cursor" } } });
    for (let i = 0; i < 4; i++) { t += 1_800_000; u.mcp("192.0.2.1", { method: "tools/call", params: { name: "start_here" } }); }
    expect(events.slice(1).every((e) => e.kind === "call" && e.client === "Cursor")).toBe(true);
  });

  it("counts pages by path and where visitors came from, and leaves bots out", () => {
    const u = new Usage(null, () => Date.parse("2026-10-25T10:00:00Z"));
    const ua = "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) Safari/604.1";
    u.page("1.1.1.1", "/launch", "https://t.co/abc", ua, new URLSearchParams(), "getnightshift.tech");
    u.page("1.1.1.1", "/co/0f3c2b1a-1111-2222-3333-444455556666", "https://getnightshift.tech/my", ua, new URLSearchParams(), "getnightshift.tech");
    u.page("2.2.2.2", "/", undefined, ua, new URLSearchParams("utm_source=Telegram"), "getnightshift.tech");
    u.page("3.3.3.3", "/", "https://www.google.com/", "Googlebot/2.1", new URLSearchParams(), "getnightshift.tech");
    const r = u.report(1).web;
    expect(r).toMatchObject({ views: 3, visitorDays: 2 });
    expect(Object.fromEntries(r.from.map((f) => [f.name, f.count]))).toEqual({ "t.co": 1, "tag:telegram": 1 });
    expect(r.pages.map((p) => p.name).sort()).toEqual(["/", "/co/:id", "/launch"]);
  });

  it("keeps client names short and plain", () => {
    expect(clientName("a".repeat(80))).toHaveLength(40);
    expect(clientName(undefined)).toBe("unnamed");
    expect(clientName("my-agent/1.2 (x)")).toBe("my-agent/1.2 x");
  });
});
