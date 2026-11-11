import { describe, expect, it } from "vitest";
import { deriveFeed, feedHref, kindOf, parseFeed, parseItem, since, txUrl } from "./feed";
import { NAV, READING, SYSTEMS, groupOf, isOn, tabsOf } from "./nav";
import { SECTIONS } from "../site/sitemap";

const company = { id: "c1", slug: "leadnest", name: "LeadNest" };
const hash = `0x${"ab".repeat(32)}`;

describe("the engine's feed", () => {
  it("keeps well-formed items, newest first, and drops malformed ones", () => {
    const feed = parseFeed({
      items: [
        { at: 100, kind: "founded", company, text: "Founded." },
        { at: 300, kind: "sale", company, text: "Sold a planner.", amountUsd: 9, tx: hash, chainId: 8453 },
        { at: 200, kind: "nonsense", company, text: "x" },
        { at: 250, kind: "shift", company: { slug: "", name: "" }, text: "x" },
        { kind: "post", company, text: "no time" },
      ],
      stats: { companies: 14, earned: 18, earners: 2, salesUsd: 18, sales: 2 },
    });
    expect(feed?.source).toBe("feed");
    expect(feed?.items.map((i) => i.at)).toEqual([300, 100]);
    expect(feed?.stats).toEqual({ companies: 14, earned: 2, salesUsd: 18, sales: 2 });
  });
  it("is not fooled by another shape", () => {
    expect(parseFeed({ error: "not found" })).toBeNull();
    expect(parseFeed([])).toBeNull();
    expect(parseItem(null)).toBeNull();
  });
});

describe("where a sale is checked", () => {
  it("links the explorer of its chain, Base when none is named", () => {
    expect(txUrl({ tx: hash })).toBe(`https://basescan.org/tx/${hash}`);
    expect(txUrl({ tx: hash, chainId: 1 })).toBe(`https://etherscan.io/tx/${hash}`);
    expect(txUrl({ tx: `https://basescan.org/tx/${hash}` })).toBe(`https://basescan.org/tx/${hash}`);
  });
  it("links nothing it cannot stand behind", () => {
    expect(txUrl({})).toBeNull();
    expect(txUrl({ tx: "0x1234" })).toBeNull();
    expect(txUrl({ tx: hash, chainId: 999_999 })).toBeNull();
    expect(txUrl({ tx: "javascript:alert(1)" })).toBeNull();
  });
  it("keeps a row's own link inside the site", () => {
    const item = { at: 1, kind: "sale" as const, company, text: "x" };
    expect(feedHref(item)).toBe("/c/leadnest");
    expect(feedHref({ ...item, href: "/c/leadnest#p1" })).toBe("/c/leadnest#p1");
    expect(feedHref({ ...item, href: "https://evil.example" })).toBe("/c/leadnest");
    expect(feedHref({ ...item, href: "//evil.example" })).toBe("/c/leadnest");
  });
});

describe("the feed from the older routes", () => {
  const companies = [
    { id: "a", slug: "leadnest", name: "LeadNest", createdAt: 1000, pnl: { revenueUsd: 9, sales: 1 } },
    { id: "b", slug: "nightwatch-981", name: "NIGHTWATCH", createdAt: 2000, pnl: { revenueUsd: 9, sales: 1 } },
    { id: "c", slug: "nightwatch", name: "NIGHTWATCH", createdAt: 3000, pnl: { revenueUsd: 0, sales: 0 } },
    { id: "d", slug: "hashnest", name: "HashNest", createdAt: 4000, pnl: { revenueUsd: 0, sales: 0 } },
  ];
  const landing = { activity: [
    { at: 5000, company: "LeadNest", slug: "leadnest", text: "Missed-Call Text-Back Generator: price $4.00 → $3.00." },
    { at: 6000, company: "LeadNest", slug: "leadnest", text: "Drafted a post: \"hello\"" },
    { company: "LeadNest", slug: "leadnest", text: "no time, left out" },
  ] };
  const proof = { payments: { latest: [
    { at: "1970-01-01T00:00:07.000Z", what: "NIGHTWATCH Checker (NIGHTWATCH)", usd: 9, tx: `https://basescan.org/tx/${hash}` },
    { at: "1970-01-01T00:00:08.000Z", what: "IMD Data Feed", usd: 0.001, tx: `https://basescan.org/tx/${hash}` },
  ] } };

  it("counts who has earned, honestly", () => {
    const feed = deriveFeed(companies, landing, proof);
    expect(feed.source).toBe("derived");
    expect(feed.stats).toEqual({ companies: 4, earned: 2, salesUsd: 18, sales: 2 });
  });
  it("shows foundings, CEO activity and company sales, newest first", () => {
    const feed = deriveFeed(companies, landing, proof);
    expect(feed.items.map((i) => i.kind)).toEqual(["sale", "post", "price", "founded", "founded", "founded", "founded"]);
    const sale = feed.items[0]!;
    // two companies are called NIGHTWATCH; the sale belongs to the one that has sold
    expect(sale.company.slug).toBe("nightwatch-981");
    expect(sale.amountUsd).toBe(9);
    expect(txUrl(sale)).toBe(`https://basescan.org/tx/${hash}`);
  });
  it("leaves a sale out when it cannot tell whose it is", () => {
    const both = companies.map((c) => (c.slug === "nightwatch" ? { ...c, pnl: { revenueUsd: 5, sales: 1 } } : c));
    expect(deriveFeed(both, landing, proof).items.some((i) => i.kind === "sale")).toBe(false);
  });
  it("survives missing routes", () => {
    expect(deriveFeed(companies, null, null).items).toHaveLength(4);
    expect(deriveFeed(null, null, null)).toEqual({ items: [], stats: { companies: 0, earned: 0, salesUsd: 0, sales: 0 }, source: "derived" });
  });
  it("reads a line's kind from its words", () => {
    expect(kindOf("Planner: price $7.00 → $4.00.")).toBe("price");
    expect(kindOf("Drafted a post: \"x\"")).toBe("post");
    expect(kindOf("Studio: \"Planner\" is on sale. 465 pages.")).toBe("product");
    expect(kindOf("Tracker is live at $12.00.")).toBe("product");
    expect(kindOf("Ordered research from the swarm.")).toBe("shift");
  });
  it("says how long ago in plain words", () => {
    const now = 10 * 86_400_000;
    expect(since(now - 5_000, now)).toBe("just now");
    expect(since(now - 12 * 60_000, now)).toBe("12 min ago");
    expect(since(now - 3 * 3_600_000, now)).toBe("3 h ago");
    expect(since(now - 5 * 86_400_000, now)).toBe("5 d ago");
  });
});

describe("the one navigation file", () => {
  const parked = ["/swap", "/deals", "/launchpad", "/forge", "/ship", "/play", "/live", "/partners", "/story", "/tg"];
  const listed = [...NAV.flatMap((g) => g.links), ...SYSTEMS, ...READING, ...SECTIONS.flatMap((s) => s.items)].map((l) => l.to);

  it("keeps parked pages out of every menu and the index", () => {
    for (const to of parked) expect(listed).not.toContain(to);
  });
  it("has the short main menu, in order", () => {
    expect(NAV.map((g) => g.label)).toEqual(["Companies", "Market", "Live", "Games", "$SHIFT", "Observatory", "Start here"]);
  });
  it("keeps the agent pages off the main menu and on the Observatory", () => {
    const main = NAV.flatMap((g) => g.links).map((l) => l.to);
    for (const to of ["/services", "/mind", "/watchtower", "/crews", "/mcp", "/arena", "/league", "/sniper", "/impact"]) {
      expect(main).not.toContain(to);
      expect(SYSTEMS.map((l) => l.to)).toContain(to);
      expect(groupOf(to)).toBe("observatory");
    }
  });
  it("knows which group a page belongs to", () => {
    expect(groupOf("/")).toBe("live");
    expect(groupOf("/games/chess")).toBe("games");
    expect(groupOf("/c/leadnest")).toBe("companies");
    expect(groupOf("/swap")).toBeNull();
    expect(tabsOf("market")).toEqual([]);
    expect(tabsOf("observatory")).toBe(SYSTEMS);
    expect(isOn("/games/chess", "/games")).toBe(true);
    expect(isOn("/", "/#feed")).toBe(true);
    expect(isOn("/companies", "/#feed")).toBe(false);
  });
});
