import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Company } from "@nightshift/core";
import type { LedgerTx } from "@nightshift/ledger";
import { afterEach, describe, expect, it } from "vitest";
import { Digest, digestCard, digestFacts } from "./digest.js";
import { setTelegramTransport } from "./social.js";

const NOW = Date.UTC(2026, 9, 21, 18, 0, 30);
const H = 3_600_000;
const base = "https://getnightshift.tech";

function company(id: string, o: Partial<Company> = {}): Company {
  return { id, slug: id, name: `Co ${id}`, idea: "", mission: "", audience: "", createdAt: 0, owner: "0xowner", wallet: "0x0000000000000000000000000000000000000001", policy: {} as never, status: "active", cycle: 3, nextShiftAt: null, site: null, products: [], tasks: [], journal: [], marketing: [], ...o } as Company;
}
const task = (kind: string, at: number, extra: object = {}) => ({ id: `t-${kind}-${at}`, cycle: 1, kind, title: kind, why: "", status: "done", stepsDone: 1, stepsTotal: 1, activity: null, costImd: 0n, result: null, error: null, createdAt: at - H, updatedAt: at, ...extra }) as never;
const tx = (id: string, kind: string, at: number, postings: [string, string, bigint][]): LedgerTx => ({ id, kind, at: new Date(at), postings: postings.map(([account, asset, amount]) => ({ account, asset, amount })) });
const USDC = (usd: number) => BigInt(Math.round(usd * 1e6));
const IMD = (n: number) => BigInt(Math.round(n * 1e6)) * 10n ** 12n;

/** Two live companies, one simulated and one house company: only the live ones are ever counted. */
function records() {
  const a = company("alpha", {
    journal: [{ at: NOW - 2 * H, cycle: 4, kind: "decision", text: "Shift 4: Build \"Fee Map\". Why." }, { at: NOW - 5 * H, cycle: 3, kind: "decision", text: "Shift 3, ordered by the owner: Research." }, { at: NOW - 30 * H, cycle: 2, kind: "decision", text: "Shift 2: old." }, { at: NOW - H, cycle: 4, kind: "note", text: "Shift 9 is not a decision" }],
    products: [{ id: "p1", name: "Fee Map", kind: "dataset", status: "live" } as never, { id: "p2", name: "Draft", kind: "report", status: "building" } as never],
    tasks: [task("build_product", NOW - 2 * H, { productId: "p1" }), task("build_product", NOW - 3 * H, { productId: "p2" }), task("build_site", NOW - 4 * H, { result: { siteUrl: "https://alpha.example" } }), task("build_product", NOW - 26 * H, { productId: "p1" })],
  });
  // each task belongs to the shift that made it: shift 4 built Fee Map, shift 3 the rest
  a.tasks.forEach((t, i) => { t.cycle = i === 0 ? 4 : 3; });
  const b = company("beta", { journal: [{ at: NOW - 3 * H, cycle: 1, kind: "decision", text: "Shift 1: Put the company on the web." }] });
  const sim = company("simco", { sim: true, journal: [{ at: NOW - H, cycle: 1, kind: "decision", text: "Shift 1: x" }], products: [{ id: "s1", name: "Sim thing", kind: "tool", status: "live" } as never], tasks: [task("build_product", NOW - H, { productId: "s1" })] });
  const house = company("house", { house: true });
  const txs = [
    tx("sale:0x1", "sale", NOW - H, [["co:beta:usdc", "USDC", USDC(9)], ["ext:buyers", "USDC", -USDC(9)]]),
    tx("sale:0x2", "sale", NOW - 2 * H, [["co:alpha:usdc", "USDC", USDC(2.5)], ["ext:buyers", "USDC", -USDC(2.5)]]),
    tx("sale:old", "sale", NOW - 25 * H, [["co:alpha:usdc", "USDC", USDC(100)], ["ext:buyers", "USDC", -USDC(100)]]),
    tx("sale:sim", "sale_sim", NOW - H, [["co:simco:usdc", "USDC", USDC(50)], ["ext:buyers-sim", "USDC", -USDC(50)]]),
    tx("sale:simlive", "sale", NOW - H, [["co:simco:usdc", "USDC", USDC(7)], ["ext:buyers", "USDC", -USDC(7)]]),
    tx("sale:house", "sale", NOW - H, [["co:house:usdc", "USDC", USDC(0.05)], ["ext:buyers", "USDC", -USDC(0.05)]]),
    tx("gumroad:g1", "gumroad", NOW - H, [["co:alpha:gumroad", "USD", 1500n * 10_000n], ["ext:gumroad-buyers", "USD", -1500n * 10_000n], ["co:alpha:gumroad", "USD", -150n * 10_000n], ["ext:gumroad-fees", "USD", 150n * 10_000n]]),
    tx("b2b:t1", "b2b", NOW - H, [["co:alpha:usdc", "USDC", -USDC(3)], ["co:beta:usdc", "USDC", USDC(3)]]),
    tx("imd:o1", "imd_order", NOW - 2 * H, [["co:alpha:imd", "IMD", -IMD(0.5)], ["ext:imd-swarm", "IMD", IMD(0.5)]]),
    tx("imd:o2", "imd_order", NOW - 3 * H, [["co:beta:imd", "IMD", -IMD(1.25)], ["ext:imd-swarm", "IMD", IMD(1.25)]]),
    tx("imd:o3", "imd_order", NOW - 4 * H, [["co:beta:imd", "IMD", -IMD(4)], ["ext:imd-swarm", "IMD", IMD(4)]]),
    tx("imd-reversal:o3", "imd_reversal", NOW - 3 * H, [["co:beta:imd", "IMD", IMD(4)], ["ext:imd-swarm", "IMD", -IMD(4)]]),
    tx("imd:sim", "imd_order", NOW - 3 * H, [["co:simco:imd", "IMD", -IMD(9)], ["ext:imd-swarm", "IMD", IMD(9)]]),
  ];
  return { companies: [a, b, sim, house], txs };
}

describe("the daily company digest", () => {
  afterEach(() => setTelegramTransport(null));

  it("puts the backup line next to a launched site", () => {
    const cid = "bafybeifmibbcoyqpiq7t6u2su7jr7vwegpakyw4ezcjr723mrmmrcbdfve";
    const url = "https://ns-nightwatch-981.identitymd.eth.limo";
    const c = company("nightwatch", { site: { url, jobId: "j", cid }, tasks: [task("build_site", NOW - H, { result: { siteUrl: url } })] });
    const facts = digestFacts([c], [], NOW, base);
    expect(facts.sites[0]?.siteBackup).toBe(`https://imd-ipfs.xyz/ipfs/${cid}/`);
    expect(digestCard(facts, base)?.text).toContain(`href="https://imd-ipfs.xyz/ipfs/${cid}/">Backup link (if the site does not open)</a>`);
  });

  it("counts a site once however many builds ended at its address", () => {
    const site = (n: number) => ({ ...(task("build_site", NOW - n * H) as object), cycle: n, result: { siteUrl: "https://lead.example" } });
    const f = digestFacts([company("lead", { tasks: [site(1), site(2), site(3)] as never })], [], NOW, base);
    expect(f.sites).toEqual([{ company: "Co lead", url: "https://lead.example" }]);
  });

  it("counts shifts that left only their task (a model's or the owner's move with no journal line), each once", () => {
    const c = company("gamma", { tasks: [7, 8, 9].map((n) => ({ ...(task("marketing", NOW - n * 60_000) as object), cycle: n })) as never });
    const f = digestFacts([c], [], NOW, base);
    expect(f.shifts).toBe(3);
    expect(f.companiesWorking).toBe(1);
  });

  it("is built from the live companies' records and the ledger only", () => {
    const { companies, txs } = records();
    const f = digestFacts(companies, txs, NOW, base);
    expect(f.shifts).toBe(3);
    expect(f.companiesWorking).toBe(2);
    expect(f.products).toEqual([{ name: "Fee Map", kind: "dataset", company: "Co alpha", link: `${base}/c/alpha` }]);
    expect(f.sites).toEqual([{ company: "Co alpha", url: "https://alpha.example" }]);
    // $9 + $2.50 on chain + $15 on Gumroad (gross); the sim and house companies' sales are not here
    expect(f.sales).toEqual({ count: 3, usd: 26.5 });
    expect(f.b2b).toEqual({ count: 1, usd: 3 });
    // the reversed order was never charged
    expect(f.imd.count).toBe(2);
    expect(f.imd.imd).toBeCloseTo(1.75);
    expect(f.top).toEqual({ name: "Co alpha", slug: "alpha", why: "$17.50 in 2 sales" });
    const card = digestCard(f, base)!;
    expect(card.text).toContain("<b>3 shifts</b> run by 2 companies");
    expect(card.text).toContain(`<a href="${base}/c/alpha">Fee Map</a> · dataset · Co alpha`);
    expect(card.text).toContain("<b>3 sales</b> · <b>$26.50</b>");
    expect(card.text).toContain("1 sale between NIGHTSHIFT companies · $3.00 (counted apart)");
    expect(card.text).toContain("<b>2 IMD orders</b> paid · <b>1.75 IMD</b>");
    expect(card.text).not.toMatch(/Sim thing|simco|house/i);
    expect(card.buttons.flat().map((b) => b.url)).toEqual([`${base}/companies`, `${base}/market`]);
    // every number in the message is one of the facts
    const numbers = (card.text.replace(/<[^>]+>/g, "").replace(/https?:\S+/g, "").match(/\d+(\.\d+)?/g) ?? []).map(Number);
    expect(numbers.every((n) => [3, 2, 1, 26.5, 3.0, 1.75, 17.5, 24].includes(n))).toBe(true);
  });

  it("skips a quiet day: no post at all", async () => {
    const { companies } = records();
    const quiet = digestFacts(companies, [], NOW + 3 * 86_400_000, base);
    expect(digestCard(quiet, base)).toBeNull();
    const calls: string[] = [];
    setTelegramTransport(async (url) => { calls.push(url); return { ok: true, status: 200, json: async () => ({ ok: true, result: { message_id: 1 } }) }; });
    const d = new Digest({ companies: () => companies, ledger: async () => [], now: () => NOW + 3 * 86_400_000, mode: () => "live", on: () => true, hour: () => 18, token: () => "1:x", chats: () => ["@c"] });
    expect(await d.tick()).toBe("quiet");
    expect(calls).toEqual([]);
  });

  it("posts once a day at the digest hour in live mode, with its buttons; only a dry-run log in sim mode", async () => {
    const { companies, txs } = records();
    const sent: { method: string; body: Record<string, unknown> }[] = [];
    setTelegramTransport(async (url, init) => { sent.push({ method: url.split("/").pop()!, body: JSON.parse(init.body ?? "{}") }); return { ok: true, status: 200, json: async () => ({ ok: true, result: { message_id: 7 } }) }; });
    let now = NOW - H; // 17:00: not yet
    const dir = mkdtempSync(join(tmpdir(), "digest-"));
    const opts = { companies: () => companies, ledger: async () => txs, now: () => now, on: () => true, hour: () => 18, token: () => "1:x", chats: () => ["@getnightshift"], file: join(dir, "digest.json"), dryRun: join(dir, "dry.log") };
    const live = new Digest({ ...opts, mode: () => "live" });
    expect(await live.tick()).toBe("wait");
    now = NOW;
    expect(await live.tick()).toBe("sent");
    expect(sent).toHaveLength(1);
    expect(sent[0]!.method).toBe("sendMessage");
    expect(sent[0]!.body.chat_id).toBe("@getnightshift");
    expect(String(sent[0]!.body.text)).toContain("NIGHTSHIFT DAILY");
    expect(JSON.stringify(sent[0]!.body.reply_markup)).toContain("/companies");
    now += 10 * 60_000;
    expect(await live.tick()).toBe("wait");
    // a restart the same evening remembers the day
    expect(await new Digest({ ...opts, mode: () => "live" }).tick()).toBe("wait");
    expect(sent).toHaveLength(1);
    // sim mode: never Telegram, only the dry-run log
    const sim = new Digest({ ...opts, file: join(dir, "sim.json"), mode: () => "sim" });
    expect(await sim.tick()).toBe("dry-run");
    expect(sent).toHaveLength(1);
    expect(readFileSync(join(dir, "dry.log"), "utf8")).toContain("sim mode: not posted");
    // off: nothing
    expect(await new Digest({ ...opts, file: null, on: () => false, mode: () => "live" }).tick()).toBe("off");
  });
});
