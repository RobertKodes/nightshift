import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { AgentEconomy } from "./agent-economy.js";
import type { ProofPayment } from "./proof.js";

const T0 = Date.parse("2026-10-26T10:00:00Z");
const pay = (n: number, over: Partial<ProofPayment> = {}): ProofPayment => ({ key: `payer:${n}`, at: T0, payer: `0x${n.toString(16).padStart(40, "0")}`, units: "1000", usd: 0.001, cls: "customer", house: true, product: "Token Verdict", service: "token-verdict-quick", tx: `0x${n.toString(16).padStart(64, "0")}`, company: "House", ...over });
const setup = (file: string | null = null) => {
  let t = T0;
  const history: ProofPayment[] = [], sent: string[] = [];
  const make = () => new AgentEconomy({ file, payments: () => history, url: "https://nightshift.example", now: () => t, post: async (text, buttons) => { expect(buttons[0]![0]!.url).toContain("/agents/start"); sent.push(text); return true; } });
  const economy = make();
  return { economy, history, sent, make, add: (ms: number) => { t += ms; }, at: (ms: number) => { t = ms; }, note: (p: ProofPayment, a = economy) => { history.push(p); a.notePayment(p); } };
};

describe("public agent economy", () => {
  it("posts real customer settlements with proof totals, safe wallet, links and returning status", async () => {
    const x = setup(), first = pay(1);
    x.note(first); await x.economy.tick();
    x.note(pay(2, { payer: first.payer })); await x.economy.tick();
    expect(x.sent[0]).toContain("An agent just paid NIGHTSHIFT");
    expect(x.sent[0]).toContain("$0.001"); expect(x.sent[0]).toContain("0x0000…0001"); expect(x.sent[0]).not.toContain(first.payer);
    expect(x.sent[0]).toContain(`https://basescan.org/tx/${first.tx}`); expect(x.sent[0]).toContain("settled over x402 on Base");
    expect(x.sent[0]).toContain("1 paid calls"); expect(x.sent[1]).toContain("A returning customer paid again");
    expect(x.sent[1]).toContain("1 returning wallets"); expect(x.sent.join(" ")).not.toContain("AI agent");
  });
  it("never posts internal, owner, b2b, test or unconfirmed payments", async () => {
    const x = setup();
    for (const [n, cls] of (["internal", "owner", "b2b", "test"] as const).entries()) x.note(pay(n, { cls }));
    x.note(pay(9, { tx: null })); await x.economy.tick(); expect(x.sent).toEqual([]);
  });
  it("does not celebrate revenue rounded up to a milestone", async () => {
    const x = setup(); x.note(pay(1, { units: "995000", usd: 0.995 })); await x.economy.tick();
    expect(x.sent.some((s) => s.includes("$1 in settled customer revenue!"))).toBe(false);
    x.note(pay(2, { units: "5000", usd: 0.005 })); await x.economy.tick();
    expect(x.sent.some((s) => s.includes("$1 in settled customer revenue!"))).toBe(true);
  });
  it("dedupes across restarts and bundles overflow within the shared 6/hour cap", async () => {
    const file = join(mkdtempSync(join(tmpdir(), "economy-")), "posts.json"), x = setup(file);
    for (let i = 1; i <= 15; i++) x.note(pay(i));
    await x.economy.tick(); expect(x.sent).toHaveLength(6);
    const individual = x.sent.filter((s) => s.includes("An agent just paid NIGHTSHIFT") || s.includes("A returning customer paid again")).length;
    const b = x.make(); b.notePayment(x.history[0]!); await b.tick(); expect(x.sent).toHaveLength(6);
    x.add(3_600_000); await b.tick();
    expect(x.sent.some((s) => s.includes(`${15 - individual} more paid calls`))).toBe(true);
    const count = x.sent.length; const c = x.make(); c.notePayment(x.history[0]!); await c.tick(); expect(x.sent).toHaveLength(count);
  });
  it("announces every reached milestone once, including the first paid services", async () => {
    const x = setup(join(mkdtempSync(join(tmpdir(), "milestones-")), "posts.json"));
    for (let i = 1; i <= 1000; i++) x.history.push(pay(i, { payer: `0x${(i % 100).toString(16).padStart(40, "0")}`, usd: 0.1, units: "100000", service: ["watchtower-watch", "swarm-order", "research-report", "buildcheck-report"][i % 4]! }));
    x.economy.notePayment(x.history.at(-1)!); await x.economy.tick();
    const milestone = x.sent.find((s) => s.includes("economy is growing"))!;
    for (const n of [10, 25, 50, 100, 250, 500, 1000]) expect(milestone).toContain(`${n.toLocaleString("en-US")} real paid calls!`);
    for (const n of [5, 10, 25, 50, 100]) expect(milestone).toContain(`${n} paying wallets!`);
    for (const n of [1, 5, 10, 25, 50, 100]) expect(milestone).toContain(`$${n} in settled customer revenue!`);
    for (const name of ["Watchtower watch", "Swarm Desk job", "Research Desk report", "Build &amp; Check report", "first returning wallet"]) expect(milestone).toContain(name);
    const b = x.make(); x.note(pay(1001), b); await b.tick();
    expect(x.sent.filter((s) => s.includes("economy is growing"))).toHaveLength(1);
  });
  it("recaps at 20:00 Bucharest only when that local day has customers", async () => {
    const x = setup();
    x.at(Date.parse("2026-10-26T18:00:00Z")); await x.economy.tick(); expect(x.sent).toEqual([]);
    x.history.push(pay(1, { at: Date.parse("2026-10-26T17:50:00Z") }));
    await x.economy.tick(); await x.economy.tick();
    expect(x.sent).toHaveLength(1); expect(x.sent[0]).toContain("Agent economy · 2026-10-26"); expect(x.sent[0]).toContain("Top service: Token Verdict"); expect(x.sent[0]).toContain("This week so far");
    x.add(86_400_000); await x.economy.tick(); expect(x.sent).toHaveLength(1);
  });
  it("persists /announce off and delays reserve buys without dropping them", async () => {
    const x = setup(join(mkdtempSync(join(tmpdir(), "announce-off-")), "posts.json"));
    x.economy.command(["off"]); const b = x.make(); expect(b.enabled).toBe(false);
    x.note(pay(1), b); b.noteBuy("one", "Agents bought SHIFT"); await b.tick(); expect(x.sent).toEqual([]);
    b.command(["on"]); await b.tick(); expect(x.sent).toEqual(["Agents bought SHIFT"]);
    b.noteBuy("one", "Agents bought SHIFT"); await b.tick(); expect(x.sent).toHaveLength(1);
  });
});
