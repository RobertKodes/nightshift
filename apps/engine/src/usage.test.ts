import { describe, expect, it } from "vitest";
import { Usage, clientName } from "./usage.js";

describe("usage counts", () => {
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
