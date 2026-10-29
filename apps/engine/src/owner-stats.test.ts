import { describe, expect, it } from "vitest";
import { OwnerStats, ownerReport, reportSlot, type StatsSources } from "./owner-stats.js";
import { Usage } from "./usage.js";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Company } from "@nightshift/core";
import { payerClass } from "./proof.js";
import { notificationLevel, ownerText } from "./owner-stats.js";

const W = "0x123456789012345678901234567890123456abcd", TX = `0x${"ab".repeat(32)}`;
const seller = { owner: `0x${"22".repeat(20)}`, wallet: `0x${"33".repeat(20)}` } as Company;

const sources = (u: Usage, over: Partial<StatsSources> = {}): StatsSources => ({
  usage: u, payerClass: (p, sim) => payerClass(p, seller, [seller], sim), live: () => ({ visitors5m: 3, visitors1m: 1 }), jobs: () => [], operators: () => [], sales: () => [], recruiter: () => ({ state: "running", prospects: 50, waiting: 20, sentToday: 0 }), ...over,
});

const setup = (file: string | null = null) => {
  let t = Date.parse("2026-10-25T10:00:00Z"), delivers = true;
  const sent: string[] = [], u = new Usage(null, () => t);
  const make = () => new OwnerStats({ file, sources: sources(u), send: async (text) => { if (!delivers) return false; sent.push(text); return true; }, now: () => t });
  return { u, sent, make, stats: make(), add: (ms: number) => { t += ms; }, at: (ms: number) => { t = ms; }, deliver: (v: boolean) => { delivers = v; } };
};
const session = (u: Usage, name: string) => u.mcp("192.0.2.1", { method: "initialize", params: { clientInfo: { name } } });
const call = (u: Usage, tool = "watchtower_sample") => u.mcp("192.0.2.1", { method: "tools/call", params: { name: tool } });
const payment = (nonce = "one") => ({ service: "Token Verdict", payer: W, nonce, usd: 0.25, holderPrice: false, tx: TX });
const file = () => join(mkdtempSync(join(tmpdir(), "owner-stats-")), "stats.json");

describe("owner stats", () => {
  it("uses rolling website and MCP counts shortly after UTC midnight", () => {
    let t = Date.parse("2026-10-25T23:50:00Z");
    const u = new Usage(null, () => t);
    session(u, "Cursor"); call(u);
    u.page("192.0.2.2", "/crews", undefined, "Mozilla/5.0 Safari", new URLSearchParams(), "nightshift.example");
    t = Date.parse("2026-10-26T00:20:00Z");
    const r = ownerReport(sources(u), t);
    expect(r).toContain("1 MCP sessions, <b>1 tool calls</b>"); expect(r).toContain("1 visitors, 1 page views");
    expect(u.report(1).web.views).toBe(0);
  });
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
    expect(r).toContain("0 invitations sent today, 20 waiting for you");
  });

  it("pings first real sessions and first tools once across restarts, never probes", async () => {
    const x = setup(file());
    session(x.u, "Cursor"); call(x.u); call(x.u, "another_tool"); session(x.u, "Cursor");
    for (const name of ["mcp-directory", "rokmcp-collector", "health-probe", "unnamed"]) { session(x.u, name); call(x.u); }
    await x.stats.tick();
    expect(x.sent).toHaveLength(2);
    expect(x.sent[0]).toContain("New agent on the MCP");
    expect(x.sent[1]).toContain("First tool call"); expect(x.sent[1]).toContain("watchtower_sample");
    x.stats.dispose(); const b = x.make();
    session(x.u, "Cursor"); call(x.u); await b.tick(); expect(x.sent).toHaveLength(2);
  });

  it("caps activity at 10/hour and spills the rest into the digest", async () => {
    const x = setup();
    for (let i = 0; i < 12; i++) session(x.u, `agent-${i}`);
    await x.stats.tick(); expect(x.sent).toHaveLength(10);
    x.add(1_800_000); await x.stats.tick(); expect(x.sent).toHaveLength(11);
    expect(x.sent[10]).toContain("2 new activity pings kept for this digest");
    expect(x.sent[10]).toContain("agent-10: 1 sessions"); expect(x.sent[10]).toContain("agent-11: 1 sessions");
    x.add(1_800_000); session(x.u, "agent-next-hour"); await x.stats.tick();
    expect(x.sent.filter((s) => s.includes("New agent"))).toHaveLength(11);
  });

  it("sends all settled payments outside the activity cap, deduped per payer+nonce on disk", async () => {
    const x = setup(file());
    for (let i = 0; i < 10; i++) session(x.u, `agent-${i}`);
    for (let i = 0; i < 15; i++) {
      x.stats.notePaymentSettled(payment(String(i)));
      x.stats.notePaymentSettled({ ...payment(String(i)), payer: W.toUpperCase() });
    }
    await x.stats.tick();
    const money = x.sent.filter((s) => s.includes("Payment settled")); expect(money).toHaveLength(15);
    expect(money[0]).toContain("Token Verdict · $0.25");
    expect(money[0]).toContain("0x1234…abcd · customer · holder price: no");
    expect(money[0]).toContain(`https://basescan.org/tx/${TX}`); expect(money[0]).not.toContain(W);
    x.stats.dispose(); const b = x.make(); b.notePaymentSettled(payment("0")); await b.tick();
    expect(x.sent.filter((s) => s.includes("Payment settled"))).toHaveLength(15);
  }, 20_000);

  it("uses proof's payer classes and says when the holder price was used", async () => {
    const x = setup();
    x.stats.notePaymentSettled({ ...payment("owner"), payer: seller.owner!, holderPrice: true });
    x.stats.notePaymentSettled({ ...payment("internal"), payer: "0x3322e6dd06ade8377f1f1bcb766f6133d7b64d69" });
    x.stats.notePaymentSettled({ ...payment("b2b"), payer: seller.wallet });
    x.stats.notePaymentSettled({ ...payment("test"), sim: true }); await x.stats.tick();
    expect(x.sent[0]).toContain("owner · holder price: yes"); expect(x.sent[1]).toContain("internal · holder price: no");
    expect(x.sent[2]).toContain("b2b · holder price: no"); expect(x.sent[3]).toContain("test · holder price: no");
    x.stats.notePaymentSettled({ ...payment("half-cent"), usd: 0.005, holderPrice: true }); await x.stats.tick();
    expect(x.sent.at(-1)).toContain("$0.005");
  });

  it("sends refusals with the reason once, then allows settlement for the same nonce", async () => {
    const x = setup(file());
    const p = { service: "IMD Data Feed", payer: W, nonce: "same", reason: "insufficient USDC balance" };
    x.stats.notePaymentAttempt(p); x.stats.notePaymentAttempt(p); x.stats.notePaymentSettled(payment("same")); await x.stats.tick();
    expect(x.sent).toHaveLength(2); expect(x.sent[0]).toContain("Payment refused"); expect(x.sent[0]).toContain("IMD Data Feed");
    expect(x.sent[0]).toContain("insufficient USDC balance"); expect(x.sent[0]).toContain("Nothing was charged."); expect(x.sent[1]).toContain("Payment settled");
    x.stats.dispose(); const b = x.make(); b.notePaymentAttempt(p); b.notePaymentSettled(payment("same")); await b.tick(); expect(x.sent).toHaveLength(2);
  });

  it("persists failed money sends and retries after a restart", async () => {
    const path = file(), x = setup(path);
    x.deliver(false); x.stats.notePaymentSettled(payment()); await x.stats.tick(); expect(x.sent).toEqual([]);
    expect(readFileSync(path, "utf8")).not.toContain(W);
    x.stats.dispose(); x.deliver(true); const b = x.make(); b.notePaymentSettled(payment()); await b.tick();
    expect(x.sent).toHaveLength(1); await b.tick(); expect(x.sent).toHaveLength(1);
  });

  it("digests exact activity across midnight, with probes, sources, top pages, jobs and payments", async () => {
    const x = setup(); x.at(Date.parse("2026-10-25T23:50:00Z")); await x.stats.tick();
    session(x.u, "Cursor"); call(x.u); call(x.u, "start_here"); session(x.u, "registry-probe"); call(x.u);
    const page = (path: string, ref?: string, tag = "") => x.u.page("192.0.2.2", path, ref, "Mozilla/5.0 Safari", new URLSearchParams(tag), "getnightshift.tech");
    page("/crews", "https://t.co/link"); page("/crews", undefined, "ref=Telegram"); page("/geek");
    x.stats.onCrewEvent({ at: 0, crew: "watchtower", kind: "watch.check", status: "done", summary: "Checked", paid: true, house: true });
    x.stats.notePaymentSettled(payment()); x.stats.notePaymentAttempt({ service: "Feed", payer: W, nonce: "no", reason: "too many payments" });
    x.add(1_800_000); await x.stats.tick();
    const digest = x.sent.find((s) => s.includes("last 30 minutes"))!;
    for (const text of ["Cursor: 1 sessions, 2 tool calls", "watchtower_sample 1", "start_here 1", "Directories and scanners: 1 sessions, 1 tool calls", "Website: 3 page views", "t.co 1", "tag:telegram 1", "/crews 2", "watchtower done 1", "1 settled ($0.25), 1 refused"]) expect(digest).toContain(text);
    expect(digest).not.toContain("192.0.2"); x.add(1_800_000); await x.stats.tick();
    expect(x.sent.filter((s) => s.includes("last 30 minutes"))).toHaveLength(1);
  });

  it("skips empty digests and pings registrations only once", async () => {
    const x = setup(); x.add(1_800_000); await x.stats.tick(); expect(x.sent).toEqual([]);
    x.stats.noteOperatorRegistered({ id: "outside", name: "Orbit Crew" }); x.stats.noteOperatorRegistered({ id: "outside", name: "Orbit Crew" });
    await x.stats.tick(); expect(x.sent).toHaveLength(1); expect(x.sent[0]).toContain("Outside crew registered");
  });

  it("persists /notify, respects money and off, and preserves /stats and scheduled reports", async () => {
    const path = file(), x = setup(path); expect(x.stats.level).toBe("all"); x.stats.notify(["money"]);
    expect(notificationLevel(path)).toBe("money");
    x.stats.dispose(); const b = x.make(); expect(b.level).toBe("money");
    session(x.u, "Cursor"); call(x.u); b.noteOperatorRegistered({ id: "outside", name: "Orbit Crew" });
    b.notePaymentSettled(payment()); b.notePaymentAttempt({ service: "Feed", payer: W, nonce: "refused", reason: "unavailable" });
    await b.alert("Settlement gas is low", "alert"); await b.alert("Token launched", "launch");
    x.add(1_800_000); await b.tick(); expect(x.sent).toHaveLength(3); expect(b.report()).toContain("your private stats");
    expect(b.notify(["invalid"])).toContain("Use /notify all | money | off"); expect(b.level).toBe("money");
    b.notify(["off"]); b.dispose(); const c = x.make(); expect(c.level).toBe("off");
    expect(notificationLevel(path)).toBe("off");
    c.notePaymentSettled(payment("off")); await c.alert("Gas low", "alert"); session(x.u, "next-agent");
    x.add(1_800_000); await c.tick(); expect(x.sent).toHaveLength(3);
    x.at(Date.parse("2026-10-25T19:00:00Z")); await c.tick(); expect(x.sent).toHaveLength(4); expect(x.sent[3]).toContain("your private stats");
    c.notify(["all"]); session(x.u, "new-agent"); await c.tick(); expect(x.sent.at(-1)).toContain("New agent");
  });

  it("removes private values and limits raw user text to 120 characters", async () => {
    const x = setup();
    const raw = `192.0.2.33 2001:db8::1 ${W} secret=hunter2 Bearer abc.def.ghi https://user:pass@example.com/?key=hidden ${"z".repeat(150)}`;
    x.stats.notePaymentAttempt({ service: "Service <script>", payer: W, nonce: "secret-nonce", reason: raw }); await x.stats.alert(raw, "alert"); await x.stats.tick();
    const all = x.sent.join("\n");
    for (const value of ["192.0.2.33", "2001:db8::1", W, "hunter2", "abc.def.ghi", "user:pass", "hidden", "secret-nonce", "z".repeat(121)]) expect(all).not.toContain(value);
    expect(all).toContain("0x1234…abcd"); expect(all).toContain("Service &lt;script&gt;"); expect(ownerText("a ".repeat(200)).length).toBeLessThanOrEqual(120);
    expect(ownerText(W.slice(0, 40))).not.toContain(W.slice(0, 40));
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
