import { describe, expect, it } from "vitest";
import { SimImdPlane } from "@nightshift/imd";
import { Ledger } from "@nightshift/ledger";
import type { LlmClient } from "@nightshift/llm";
import { heuristicDecision, llmDecision } from "./planner.js";
import { DEFAULT_POLICY } from "./policy.js";
import {
  CHANNEL_CAPS, DEFAULT_QUIET, POST_LIMIT, approvalNeeded, checkAngle, composePost, disclosure, inQuiet, numbersIn, onlyFacts, planPosts, postFacts, quietEnds, sendGate, unposted, validQuiet,
} from "./posts.js";
import { sellsFrom, sellsLines } from "./sells.js";
import { runShift } from "./shift.js";
import type { Channel, Company, Post, PostFact, Product } from "./types.js";

const DAY = 86_400_000;
const NOW = Date.parse("2026-10-20T14:00:00Z");

function product(id: string, extra: Partial<Product> = {}): Product {
  return { id, name: "The Etsy Holiday Playbook", kind: "report", pitch: "Sell more this December, with listings that work.", priceUsdc: 9_000_000n, status: "live", deliverableUrl: "f", taskId: "t-build", sales: 3, revenueUsdc: 27_000_000n, createdAt: NOW - 3600_000, ...extra };
}
function channel(kind: Channel["kind"], extra: Partial<Channel> = {}): Channel {
  return { kind, label: `@acme-${kind}`, url: `https://example.com/${kind}`, connectedAt: NOW - DAY, approveEach: false, dailyMax: 1, trusted: false, listed: true, ...extra };
}
function company(extra: Partial<Company> = {}): Company {
  return {
    id: "c1", slug: "acme", name: "Acme", idea: "weekly guides for Etsy sellers who want more holiday sales", mission: "More holiday sales for Etsy sellers.", audience: "Etsy sellers",
    createdAt: 0, owner: null, wallet: "0x0000000000000000000000000000000000000001", policy: { ...DEFAULT_POLICY }, status: "active", cycle: 4, nextShiftAt: null,
    site: { url: "https://acme.site", jobId: "j-site" }, products: [product("p1")], tasks: [], journal: [], marketing: [],
    connections: { channels: { bluesky: channel("bluesky"), discord: channel("discord") }, quiet: { ...DEFAULT_QUIET }, posts: [], log: [] },
    ...extra,
  };
}
const fact = (c: Company, books = { sales: 0, gumroad: 0 }) => postFacts(c, books, "https://getnightshift.tech", NOW);

describe("posts about real events", () => {
  it("end with the AI disclosure on every channel, and fit each platform's limit with the link kept", () => {
    const c = company();
    const f: PostFact = { ...fact(c)[0]!, text: "word ".repeat(400).trim() };
    for (const ch of ["bluesky", "telegram", "mastodon", "discord"] as const) {
      const text = composePost(c.name, f, ch);
      expect(text.endsWith(disclosure("Acme"))).toBe(true);
      expect(disclosure("Acme")).toBe("Posted by an AI agent for Acme.");
      expect(text.length).toBeLessThanOrEqual(POST_LIMIT[ch]);
      expect(text).toContain(`https://getnightshift.tech/c/acme?via=${ch}#p1`);
    }
  });

  it("are built from the company's records: a new product with its real price, a milestone the books passed", () => {
    const c = company();
    const facts = fact(c, { sales: 9, gumroad: 2 });
    const p = facts.find((x) => x.kind === "new_product")!;
    expect(p.key).toBe("product:p1");
    expect(p.text).toBe("New from Acme: The Etsy Holiday Playbook. Sell more this December, with listings that work. $9.00, paid in USDC by people and AI agents alike.");
    expect(p.numbers).toEqual([9]);
    // 9 sales over x402 and 2 on Gumroad: the books passed 10, not 25
    const m = facts.find((x) => x.kind === "sales_milestone")!;
    expect([m.key, m.text]).toEqual(["sales:10", "Acme has passed 10 sales. Thank you to every buyer."]);
  });

  it("leave out a pitch with numbers in it: the CEO wrote it, the books did not", () => {
    const c = company({ products: [product("p1", { pitch: "Join 10,000 sellers who doubled their sales." })] });
    const p = fact(c).find((x) => x.kind === "new_product")!;
    expect(p.text).not.toContain("10,000");
    expect(p.numbers).toEqual([9]);
  });

  it("never carry a number the books do not have: the CEO's own line is dropped when it invents one", () => {
    const c = company();
    const f = fact(c, { sales: 10, gumroad: 0 }).find((x) => x.kind === "sales_milestone")!;
    expect(checkAngle("We sold 500 copies this week!", f)).toEqual({ ok: false, why: "it said 500, a number that is not in the company's books" });
    expect(checkAngle("Ten sales already, 10 of them real.", f)).toEqual({ ok: true, text: "Ten sales already, 10 of them real." });
    expect(checkAngle("Thanks @alice for the tip", f).ok).toBe(false);
    expect(checkAngle("Big day #etsy", f).ok).toBe(false);
    expect(checkAngle("See more at shop.example.com", f).ok).toBe(false);
    const post = composePost(c.name, f, "bluesky", "We sold 500 copies this week!");
    expect(post).not.toContain("500");
    expect(onlyFacts(post, f, c.name)).toBe(true);
    expect(numbersIn(post.replace(/https?:\/\/\S+/g, ""))).toEqual([10]);
    expect(numbersIn("$1,250.50 and 3 items")).toEqual([1250.5, 3]);
  });

  it("are each posted once per channel", () => {
    const c = company();
    const facts = fact(c);
    expect(unposted(c, facts).map((f) => f.key)).toContain("product:p1");
    c.connections!.posts.push(...(["bluesky", "discord"] as const).map((ch): Post => ({ id: ch, at: NOW, channel: ch, factKey: "product:p1", factKind: "new_product", about: "x", text: "x", status: "posted", sentAt: NOW })));
    expect(unposted(c, facts).map((f) => f.key)).not.toContain("product:p1");
    expect(planPosts(c, facts.find((f) => f.key === "product:p1")!, null, NOW, () => "id")).toEqual([]);
  });
});

describe("approval rules", () => {
  it("hold the first post on each channel for the owner, then let posts go on their own", () => {
    const c = company();
    const f = fact(c)[0]!;
    let n = 0;
    const posts = planPosts(c, f, null, NOW, () => `p${++n}`, "t1");
    expect(posts.map((p) => [p.channel, p.status, p.wait])).toEqual([["bluesky", "approval", "the first post on a channel waits for you"], ["discord", "approval", "the first post on a channel waits for you"]]);
    expect(posts[0]!.taskId).toBe("t1");
    c.connections!.channels.bluesky!.trusted = true;
    expect(approvalNeeded(c.connections!.channels.bluesky!)).toBeNull();
    const next = planPosts(c, fact(c, { sales: 1, gumroad: 0 }).find((x) => x.kind === "sales_milestone")!, null, NOW, () => `p${++n}`);
    expect(next.find((p) => p.channel === "bluesky")?.status).toBe("queued");
  });

  it("hold every post when the owner asks for it, and nothing goes on a paused channel or one with a backlog", () => {
    const c = company();
    const x = c.connections!;
    x.channels.bluesky = channel("bluesky", { trusted: true, approveEach: true });
    x.channels.discord = channel("discord", { trusted: true, paused: { at: NOW, why: "rate limited" } });
    const posts = planPosts(c, fact(c)[0]!, null, NOW, () => "a");
    expect(posts.map((p) => [p.channel, p.status, p.wait])).toEqual([["bluesky", "approval", "you approve every post on this channel"]]);
    x.channels.bluesky = channel("bluesky", { trusted: true });
    x.posts = [1, 2, 3].map((i): Post => ({ id: `q${i}`, at: NOW, channel: "bluesky", factKey: `k${i}`, factKind: "update", about: "x", text: "x", status: "queued" }));
    expect(planPosts(c, fact(c)[0]!, null, NOW, () => "b")).toEqual([]);
  });
});

describe("caps and quiet hours", () => {
  const posted = (ch: Channel["kind"], at: number): Post => ({ id: `s${at}`, at, channel: ch, factKey: `k${at}`, factKind: "update", about: "x", text: "x", status: "posted", sentAt: at });

  it("allow one post a day per channel by default, up to each platform's safe maximum", () => {
    const quiet = { from: 0, to: 0, tz: "UTC" }; // off
    const ch = channel("bluesky");
    expect(sendGate(ch, [], quiet, NOW)).toEqual({ go: true });
    const one = [posted("bluesky", NOW - 3 * 3600_000)];
    expect(sendGate(ch, one, quiet, NOW)).toEqual({ go: false, wait: "cap", why: "1 post a day on Bluesky", until: NOW - 3 * 3600_000 + DAY });
    // another channel's post does not count here
    expect(sendGate(channel("discord"), one, quiet, NOW)).toEqual({ go: true });
    // raised to 3, Bluesky still keeps two hours between posts
    ch.dailyMax = 3;
    expect(sendGate(ch, one, quiet, NOW).go).toBe(true);
    expect(sendGate(ch, [posted("bluesky", NOW - 30 * 60_000)], quiet, NOW)).toMatchObject({ go: false, wait: "gap" });
    // never past the platform's maximum, whatever is stored
    ch.dailyMax = 50;
    expect(sendGate(ch, [0, 1, 2].map((i) => posted("bluesky", NOW - (5 + i * 3) * 3600_000)), quiet, NOW)).toMatchObject({ go: false, wait: "cap", why: `${CHANNEL_CAPS.bluesky.max} posts a day on Bluesky` });
  });

  it("hold posts in the owner's quiet hours, in the owner's time zone", () => {
    const utc = { from: 22, to: 8, tz: "UTC" };
    const night = Date.parse("2026-10-20T23:30:00Z");
    expect(inQuiet(night, utc)).toBe(true);
    expect(inQuiet(Date.parse("2026-10-20T08:00:00Z"), utc)).toBe(false);
    const g = sendGate(channel("discord"), [], utc, night);
    expect(g).toMatchObject({ go: false, wait: "quiet", why: "quiet hours until 08:00 (UTC)" });
    expect(new Date((g as { until: number }).until).toISOString()).toBe("2026-10-21T08:00:00.000Z");
    // 20:00 UTC is 23:00 in Bucharest (summer time on 20 October)
    const ro = { from: 22, to: 8, tz: "Europe/Bucharest" };
    expect(inQuiet(Date.parse("2026-10-20T20:00:00Z"), ro)).toBe(true);
    expect(inQuiet(Date.parse("2026-10-20T16:00:00Z"), ro)).toBe(false);
    expect(new Date(quietEnds(Date.parse("2026-10-20T20:00:00Z"), ro)).toISOString()).toBe("2026-10-21T05:00:00.000Z");
    expect(() => validQuiet({ from: 25, to: 8, tz: "UTC" })).toThrow(/0 to 23/);
    expect(() => validQuiet({ from: 22, to: 8, tz: "Mars/Olympus" })).toThrow(/time zone/);
    expect(validQuiet({ from: "21", to: "7", tz: "Europe/Bucharest" } as never)).toEqual({ from: 21, to: 7, tz: "Europe/Bucharest" });
  });

  it("stop a paused channel until its owner resumes it", () => {
    expect(sendGate(channel("mastodon", { paused: { at: NOW, why: "Mastodon: Too many requests" } }), [], DEFAULT_QUIET, NOW)).toMatchObject({ go: false, wait: "paused" });
  });
});

describe("the CEO's post move", () => {
  const stats = { visits7d: 10, sales7d: 1, revenue7dUsd: 9, imdUsd: 6 };

  it("the playbook posts about a real event once channels are connected, and drafts nothing then", () => {
    const c = company();
    const postable = fact(c);
    const d = heuristicDecision(c, { ...stats, channels: ["Bluesky @acme"], postable });
    expect([d.kind, d.fact]).toEqual(["post", "product:p1"]);
    // without channels it drafts, as before
    expect(heuristicDecision({ ...c, connections: undefined }, stats).kind).toBe("marketing");
  });

  it("the model may only post about a listed event, on connected channels", async () => {
    const c = company();
    const answer = (o: object): LlmClient => ({ chat: async () => ({ message: { role: "assistant", content: JSON.stringify(o) }, costUsd: 0, servedModel: "m", finishReason: "stop" }) }) as unknown as LlmClient;
    const s = { ...stats, channels: ["Bluesky @acme"], postable: fact(c) };
    expect((await llmDecision(answer({ kind: "post", title: "Post", why: "news", brief: "", fact: "product:p1", post: "Fresh for December." }), "m", c, s))?.decision.fact).toBe("product:p1");
    expect(await llmDecision(answer({ kind: "post", title: "Post", why: "news", brief: "", fact: "sales:5000" }), "m", c, s)).toBeNull();
    expect(await llmDecision(answer({ kind: "post", title: "Post", why: "news", brief: "", fact: "product:p1" }), "m", c, stats)).toBeNull();
  });

  it("a shift hands the event to the owner's channels and records what they did", async () => {
    const c = company();
    const queued: [string, string | undefined][] = [];
    const t = await runShift(c, {
      imd: new SimImdPlane({ jobMs: 10, deliver: async () => ({ siteUrl: null, repoUrl: null, files: {}, summary: null }) }), ledger: new Ledger(), llm: null, model: "none", imdUsd: () => 6,
      stats: () => stats, buyBase: () => "http://buy", emit: () => {}, now: () => NOW,
      context: async () => ({ channels: ["Bluesky @acme"], postable: fact(c) }),
      posts: { queue: async (_c, task, key, angle) => { queued.push([key, angle]); return { ok: true, note: `Wrote a post for shift ${task.cycle}.` }; } },
    });
    expect(queued).toEqual([["product:p1", undefined]]);
    expect([t?.kind, t?.status, t?.result?.note]).toEqual(["post", "done", "Wrote a post for shift 5."]);
    expect(t?.costImd).toBe(0n);
    // the CEO's view is kept as numbers only, not the whole context
    expect(Object.keys(t!.mind!.saw).sort()).toEqual(["direction", "imdUsd", "liveProducts", "revenue7dUsd", "sales7d", "visits7d"]);
  });
});

describe("learning what sells", () => {
  it("reads only the company's own sales, visits and the NIGHTSHIFT market's own listings", () => {
    const c = company({ b2b: { bought: [], sold: [{ at: NOW, ledgerId: "b2b:x", taskId: "t", productId: "p1", product: "x", kind: "report", usdc: 2_500_000n, with: { id: "o", name: "Other", slug: "other" }, tid: undefined } as never] } });
    const s = sellsFrom(c, {
      sales: [{ at: NOW, productId: "p1", usdc: "9000000" }, { at: NOW, productId: "p1", usdc: "9000000" }],
      ledger: [{ id: "gumroad:s1", at: new Date(NOW), kind: "gumroad", meta: { productId: "p1" }, postings: [{ account: "co:c1:gumroad", asset: "USD", amount: 9_000_000n }, { account: "ext:gumroad-buyers", asset: "USD", amount: -9_000_000n }] }],
      visits: [NOW - 1000, NOW - 2000, NOW - 8 * DAY], via: [{ at: NOW, ch: "bluesky" }, { at: NOW, ch: "bluesky" }, { at: NOW, ch: "discord" }],
      market: [{ company: "Acme", slug: "acme", name: "The Etsy Holiday Playbook", kind: "report", priceUsd: 9, sales: 2 }, { company: "Toolwise", slug: "toolwise", name: "AI tool reviews", kind: "report", priceUsd: 5, sales: 40 }, { company: "Other", slug: "other", name: "Pin templates", kind: "template", priceUsd: 15, sales: 0 }],
    }, NOW);
    expect(s.products[0]).toMatchObject({ x402: { n: 2, usd: 18 }, gumroad: { n: 1, usd: 9 }, b2b: { n: 1, usd: 2.5 } });
    expect([s.visits7d, s.via]).toEqual([2, { bluesky: 2, discord: 1 }]);
    expect(s.market).toEqual({ products: 3, medianUsd: 9, top: [{ name: "AI tool reviews", company: "Toolwise", kind: "report", priceUsd: 5, sales: 40 }] });
    expect(sellsLines(s)).toEqual([
      '- "The Etsy Holiday Playbook" (report, $9.00 now, live): 2 sold over x402 for $18.00 · 1 on Gumroad for $9.00 · 1 to other companies for $2.50',
      "- Visits in 7 days: 2; from the company's own posts: bluesky 2, discord 1",
      '- The NIGHTSHIFT market: 3 products on sale, median price $9.00. Best sellers of other companies: "AI tool reviews" by Toolwise (report, $5.00, 40 sold)',
    ]);
  });
});
