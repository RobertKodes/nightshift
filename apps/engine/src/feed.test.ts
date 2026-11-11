import { describe, expect, it } from "vitest";
import { type Company, DEFAULT_POLICY, type Product, type Task } from "@nightshift/core";
import { INTERNAL_WALLETS } from "./crews/contracts.js";
import { buildFeed, cachedFeed } from "./feed.js";
import type { Metrics } from "./store.js";

const T0 = Date.parse("2026-11-01T00:00:00Z"), H = 3600_000;
const TX = (n: number) => `0x${String(n).padStart(64, "0")}`;
const OUTSIDE = "0x1111111111111111111111111111111111111111";

const product = (id: string, name: string, usd: number, extra: Partial<Product> = {}): Product => ({ id, name, kind: "template", pitch: "x", priceUsdc: BigInt(usd * 1e6), status: "live", deliverableUrl: null, taskId: `t-${id}`, sales: 0, revenueUsdc: 0n, createdAt: T0 + H, ...extra });
const task = (id: string, kind: Task["kind"], title: string, at: number, extra: Partial<Task> = {}): Task => ({ id, cycle: 1, kind, title, why: "", status: "done", stepsDone: 0, stepsTotal: 0, activity: null, costImd: 0n, result: null, error: null, createdAt: at, updatedAt: at, ...extra });
const company = (id: string, extra: Partial<Company> = {}): Company => ({
  id, slug: id, name: id.toUpperCase(), idea: "x", mission: `The mission of ${id}.`, audience: "y", createdAt: T0, owner: `0x${id.replace(/[^0-9a-f]/g, "a").padEnd(40, "0").slice(0, 40)}`,
  wallet: `0x${id.replace(/[^0-9a-f]/g, "b").padEnd(40, "1").slice(0, 40)}` as `0x${string}`, policy: { ...DEFAULT_POLICY }, status: "active", cycle: 1, nextShiftAt: null, site: null, products: [], tasks: [], journal: [], marketing: [], ...extra,
});

function world() {
  const acme = company("acme", {
    products: [product("p1", "Ward CV", 4), product("p2", "Old pack", 3, { status: "retired" })],
    tasks: [
      task("t-p1", "build_product", "Make Ward CV", T0 + 2 * H),
      task("t2", "reprice", "Raise the price", T0 + 5 * H, { productId: "p1", result: { note: "$3.00 → $4.00" } }),
      task("t3", "improve_listing", "Rewrite the listing of Ward CV", T0 + 6 * H),
      task("t4", "ask_owner", "Ask the owner to share the shop link once", T0 + 7 * H, { result: { note: "private words to the owner" } }),
      task("t5", "marketing", "Draft a post", T0 + 8 * H, { result: { note: "a draft nobody approved" } }),
      task("t6", "research", "Find buyers", T0 + 9 * H, { status: "failed" }),
    ],
    marketing: [{ at: T0 + 8 * H, channel: "x", text: "a draft nobody approved", status: "drafted" }, { at: T0 + 10 * H, channel: "bluesky:project", text: "Ward CV is open.", status: "posted", url: "https://bsky.app/profile/x/post/1" }],
    journal: [{ at: T0 + 3 * H, cycle: 1, kind: "note", text: "a private log line" }],
    connections: {
      channels: { bluesky: { kind: "bluesky", label: "@acme", url: "https://bsky.app/profile/acme", connectedAt: T0, approveEach: true, dailyMax: 3, trusted: true, listed: true }, mastodon: { kind: "mastodon", label: "@acme@m", url: null, connectedAt: T0, approveEach: true, dailyMax: 3, trusted: true, listed: false } },
      quiet: { from: 22, to: 7, tz: "UTC" }, log: [],
      posts: [
        { id: "a", at: T0 + 11 * H, channel: "bluesky", factKey: "product:p1", factKind: "new_product", about: "Ward CV is on sale", text: "…", status: "posted", url: "https://bsky.app/profile/acme/post/2", sentAt: T0 + 12 * H },
        { id: "b", at: T0 + 11 * H, channel: "bluesky", factKey: "k", factKind: "update", about: "waiting for the owner", text: "…", status: "approval" },
        { id: "c", at: T0 + 11 * H, channel: "mastodon", factKey: "k2", factKind: "update", about: "on a channel the owner does not show", text: "…", status: "posted", sentAt: T0 + 12 * H },
      ],
    },
  });
  acme.products[0]!.gumroad = { id: "g", user: "u", url: "https://gum.co/x", state: "published", approved: true, file: true, cover: true, synced: "", createdAt: T0, sales: 2, revenueCents: 800 };
  const other = company("other", { products: [product("q1", "Names pack", 3)] });
  const hidden = company("hidden", { hidden: { at: T0, reason: "adult", by: "auto" }, products: [product("h1", "Hidden thing", 5)] });
  const house = company("house", { house: true, products: [product("s1", "Token Verdict", 1)] });
  const demo = company("demo", { sim: true });
  const all = [acme, other, hidden, house, demo];
  const metrics: Record<string, Metrics> = {
    acme: { visits: [], sales: [
      { at: T0 + 20 * H, productId: "p1", usdc: "4000000", payer: OUTSIDE, tx: TX(1), sim: false, network: "eip155:8453" },
      // not demand: the owner, another company's owner, another company's wallet, a NIGHTSHIFT wallet, a testnet payment, no settlement
      { at: T0 + 21 * H, productId: "p1", usdc: "4000000", payer: acme.owner!, tx: TX(2), sim: false, network: "eip155:8453" },
      { at: T0 + 22 * H, productId: "p1", usdc: "4000000", payer: other.owner!, tx: TX(3), sim: false, network: "eip155:8453" },
      { at: T0 + 23 * H, productId: "p1", usdc: "4000000", payer: other.wallet, tx: TX(4), sim: false, network: "eip155:8453" },
      { at: T0 + 24 * H, productId: "p1", usdc: "4000000", payer: [...INTERNAL_WALLETS][0]!, tx: TX(5), sim: false, network: "eip155:8453" },
      { at: T0 + 25 * H, productId: "p1", usdc: "4000000", payer: OUTSIDE, tx: TX(6), sim: false, network: "eip155:84532" },
      { at: T0 + 26 * H, productId: "p1", usdc: "4000000", payer: OUTSIDE, tx: null, sim: false, network: "eip155:8453" },
      { at: T0 + 27 * H, productId: "p1", usdc: "4000000", payer: OUTSIDE, tx: null, sim: true },
      { at: T0 + 30 * H, productId: "gone", usdc: "2500000", payer: "0x2222222222222222222222222222222222222222", tx: TX(7), sim: false, network: "eip155:8453" },
    ] },
    hidden: { visits: [], sales: [{ at: T0 + 20 * H, productId: "h1", usdc: "5000000", payer: OUTSIDE, tx: TX(8), sim: false, network: "eip155:8453" }] },
    house: { visits: [], sales: [{ at: T0 + 20 * H, productId: "s1", usdc: "1000000", payer: OUTSIDE, tx: TX(9), sim: false, network: "eip155:8453" }] },
  };
  const input = (mode: "sim" | "live") => ({ all, listed: (c: Company) => !c.hidden && !(mode === "live" && c.sim), metrics: (id: string) => metrics[id] ?? { visits: [], sales: [] }, mode, chainId: 8453, now: T0 + 100 * H });
  return { input, acme, other };
}

describe("the public live feed", () => {
  it("lists what the companies did, newest first, in the agreed shape", () => {
    const { input } = world();
    const f = buildFeed(input("live"), 50);
    expect(f.items.map((x) => `${x.kind}:${x.company.slug}`)).toEqual([
      "sale:acme", "sale:acme", "post:acme", "post:acme", "shift:acme", "price:acme", "product:acme", "product:other", "founded:acme", "founded:other",
    ]);
    for (const x of f.items) {
      expect(Object.keys(x).every((k) => ["at", "kind", "company", "text", "amountUsd", "tx", "chainId", "href"].includes(k))).toBe(true);
      expect(Object.keys(x.company).sort()).toEqual(["id", "name", "slug"]);
      expect(typeof x.at).toBe("number");
      expect(x.text.length).toBeGreaterThan(5);
      // the page shows the company's name before the text: the text never repeats it
      expect(x.text).not.toContain(x.company.name);
    }
    expect(f.items[0]).toEqual({ at: T0 + 30 * H, kind: "sale", company: { id: "acme", slug: "acme", name: "ACME" }, text: "sold a product for $2.50", amountUsd: 2.5, tx: TX(7), chainId: 8453, href: "/c/acme" });
    expect(f.items[1]).toMatchObject({ kind: "sale", text: 'sold "Ward CV" for $4.00', amountUsd: 4, tx: TX(1), href: "/c/acme#p1" });
    expect(f.items.find((x) => x.kind === "price")).toMatchObject({ text: 'changed the price of "Ward CV": $3.00 → $4.00', amountUsd: 4 });
    expect(f.items.find((x) => x.kind === "shift")).toMatchObject({ text: "shift 1: Rewrite the listing of Ward CV", href: "/c/acme?shift=t3" });
    expect(f.items.find((x) => x.kind === "product")).toMatchObject({ text: 'put "Ward CV" on sale', amountUsd: 4, href: "/c/acme#p1", at: T0 + 2 * H });
    expect(f.items.filter((x) => x.kind === "post").map((x) => x.href)).toEqual(["https://bsky.app/profile/acme/post/2", "https://bsky.app/profile/x/post/1"]);
  });

  it("counts as sales only what the proof page counts as demand, and shows no buyer", () => {
    const { input, acme, other } = world();
    const f = buildFeed(input("live"), 200);
    // the owner's, another owner's, another company's, a NIGHTSHIFT wallet's, a testnet and an unsettled payment are not sales
    expect(f.stats).toEqual({ companies: 2, sales: 2, salesUsd: 6.5, earned: 14.5, earners: 1 });
    const text = JSON.stringify(f);
    for (const wallet of [OUTSIDE, acme.owner!, other.owner!, other.wallet, acme.wallet]) expect(text.toLowerCase()).not.toContain(wallet.toLowerCase());
    expect(text).not.toContain("0x2222");
  });

  it("leaves out hidden companies, the house, retired demos, and everything that is the owner's alone", () => {
    const { input } = world();
    const text = JSON.stringify(buildFeed(input("live"), 200));
    for (const secret of ['"HIDDEN"', "Hidden thing", '"HOUSE"', "Token Verdict", '"DEMO"', "a draft nobody approved", "private words to the owner", "Ask the owner", "a private log line", "waiting for the owner", "on a channel the owner does not show", "Old pack", "Find buyers"]) expect(text, secret).not.toContain(secret);
  });

  it("in the simulator shows the simulator's sales, marked, and never as real money earned on Gumroad", () => {
    const { input } = world();
    const f = buildFeed(input("sim"), 200);
    const sales = f.items.filter((x) => x.kind === "sale");
    expect(sales).toHaveLength(1);
    expect(sales[0]).toMatchObject({ text: '[sim] sold "Ward CV" for $4.00', amountUsd: 4 });
    expect(sales[0]).not.toHaveProperty("tx");
    expect(f.stats).toEqual({ companies: 3, sales: 1, salesUsd: 4, earned: 4, earners: 1 });
  });

  it("holds to the limit and is the same answer for every visitor for a few seconds", () => {
    const { input } = world();
    expect(buildFeed(input("live"), 3).items).toHaveLength(3);
    expect(buildFeed(input("live"), 0).items).toHaveLength(10);
    expect(buildFeed(input("live"), 5000).items).toHaveLength(10);
    let built = 0, clock = 0;
    const feed = cachedFeed((limit) => { built++; return buildFeed(input("live"), limit); }, 15_000, () => clock);
    expect(feed(2).items).toHaveLength(2);
    expect(feed(50).items).toHaveLength(10);
    expect(built).toBe(1);
    clock = 15_001;
    expect(feed(50).stats.sales).toBe(2);
    expect(built).toBe(2);
  });
});
