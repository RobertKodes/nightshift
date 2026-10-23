import { describe, expect, it } from "vitest";
import { type Company, DEFAULT_POLICY, type MarketOffer } from "@nightshift/core";
import { type ChatFacts, answerOwner, chatFacts, parseAnswer, remember } from "./ceo-chat.js";

function company(extra: Partial<Company> = {}): Company {
  return {
    id: "c1", slug: "nightplan", name: "NightPlan", idea: "weekly planners for night-shift nurses", mission: "Plan a week of night shifts in ten minutes.", audience: "night-shift nurses",
    createdAt: 0, owner: "0xaaaa00000000000000000000000000000000aaaa", wallet: "0x0000000000000000000000000000000000000001", policy: { ...DEFAULT_POLICY }, status: "active", cycle: 3, nextShiftAt: null,
    site: null, marketing: [], tasks: [], journal: [],
    products: [{ id: "p1", name: "Night Shift Planner", kind: "template", pitch: "A week of nights, planned.", priceUsdc: 9_000_000n, status: "live", deliverableUrl: "f", taskId: "t0", sales: 2, revenueUsdc: 18_000_000n, createdAt: 0 }],
    ...extra,
  };
}

const offer = (id: string, name: string, seller = "Shiftwise"): MarketOffer => ({
  seller: { id: `s-${id}`, name: seller, slug: seller.toLowerCase(), owner: "0xbbbb00000000000000000000000000000000bbbb", sim: false },
  product: { id, name, kind: "dataset", pitch: "Real rota patterns.", priceUsdc: 2_500_000n },
  preview: null,
});

const facts = (o: Partial<ChatFacts> = {}): ChatFacts => ({
  stats: { visits7d: 40, sales7d: 2, revenue7dUsd: 18, imdUsd: 6 }, offers: [offer("m1", "Night rota dataset")], usdcUsd: 18, swarmUsd: 3,
  pageUrl: "https://getnightshift.tech/c/nightplan", connected: ["bluesky"], brainLeftUsd: null, ...o,
});

describe("the CEO chat's buttons", () => {
  it("turns the answer's button lines into actions and keeps the words", () => {
    const raw = `<think>plan</think>Post the planner on Pinterest today and ask the swarm for a bundle.
[POST pinterest | Plan a week of night shifts in ten minutes: https://getnightshift.tech/c/nightplan]
- [TODO | Open a Pinterest business account for NightPlan]
**[ORDER product | Night Shift Bundle | 19 | template | Planner, meal plan and sleep log in one pack | A bundle of the planner, a 7-night meal plan and a sleep log for nurses on nights]**
[BUY M1 | real rota patterns for the next planner]
[CONNECT gumroad | to sell the bundle to people]`;
    const { text, actions } = parseAnswer(raw, company(), facts().offers);
    expect(text).toBe("Post the planner on Pinterest today and ask the swarm for a bundle.");
    expect(actions.map((a) => a.type)).toEqual(["post", "todo", "order", "buy"]);
    expect(actions[0]).toMatchObject({ type: "post", where: "pinterest" });
    expect(actions[2]).toMatchObject({ type: "order", kind: "build_product", name: "Night Shift Bundle", priceUsd: 19, productKind: "template" });
    expect(actions[3]).toMatchObject({ type: "buy", sellerId: "s-m1", productId: "m1", priceUsd: 2.5 });
  });

  it("reads a post that runs over several lines as one button", () => {
    const raw = `Post this thread today.
[POST bluesky | Thread 1/3: Most roofers chase dead leads.

1/ Pull this week's permits from your county site.
2/ Call the owner, not the GC.]
[TODO | Record a 60 second walk-through of the playbook]`;
    const { text, actions } = parseAnswer(raw, company(), []);
    expect(text).toBe("Post this thread today.");
    expect(actions).toHaveLength(2);
    expect(actions[0]).toMatchObject({ type: "post", where: "bluesky" });
    expect((actions[0] as { text: string }).text).toBe("Thread 1/3: Most roofers chase dead leads.\n\n1/ Pull this week's permits from your county site.\n2/ Call the owner, not the GC.");
    // a button cut off at the end of the answer is dropped, not shown half-written
    expect(parseAnswer("Do this.\n[TODO | Record a flip-through]\n[TODO | Create 3 pins: (1) a tablet", company(), [])).toMatchObject({ text: "Do this.", actions: [{ type: "todo", text: "Record a flip-through" }] });
    // line breaks written as the two characters "\n" become real ones
    expect((parseAnswer("[POST x | One.\\n\\nTwo.]", company(), []).actions[0] as { text: string }).text).toBe("One.\n\nTwo.");
  });

  it("drops buttons that break the rules", () => {
    const raw = `Ok.
[BUY M7 | not on the list]
[CONNECT bluesky | already connected]
[ORDER site change | the company has no site yet so this cannot be ordered]
[ORDER product | X | 9000 | tool | too pricey to pass | something long enough to be a brief]
[POST myspace | nope]
[ORDER research | short]
[POST twitter | Nights, planned in ten minutes.]`;
    const c = company({ connections: { channels: { bluesky: { kind: "bluesky", label: "@n", url: null, connectedAt: 0, approveEach: true, dailyMax: 3, trusted: false, listed: true, botFlag: false } }, quiet: { from: 0, to: 0 } as never, posts: [], log: [] } as never });
    const { actions } = parseAnswer(raw, c, facts().offers);
    expect(actions).toMatchObject([{ type: "post", where: "x" }]);
  });

  it("knows only its own company, plus what is on sale from others", () => {
    const f = chatFacts(company(), facts());
    expect(f).toMatch(/Company: NightPlan/);
    expect(f).toMatch(/Night Shift Planner/);
    expect(f).toMatch(/M1: "Night rota dataset" \(dataset, \$2\.50\) by Shiftwise/);
    expect(f).toMatch(/What sells as a digital product/);
    expect(f).not.toMatch(/c2|Other Company/);
  });

  it("answers from the facts with the chat so far, and offers the buttons", async () => {
    const c = company();
    remember(c, { id: "a", at: 1, from: "owner", text: "hi" }, { id: "b", at: 2, from: "ceo", text: "Hello.", actions: [{ id: "x", type: "todo", text: "Open a Pinterest account" }] });
    let sent: { role: string; content: string | null }[] = [];
    const llm = { chat: async (r: { messages: { role: string; content: string | null }[] }) => { sent = r.messages; return { message: { role: "assistant", content: "Do this.\n[TODO | Record a 20 second flip-through of the planner]" }, servedModel: "free-model" } as never; } };
    const line = await answerOwner(llm as never, "free", c, "what now?", facts());
    expect(sent[0]!.content).toMatch(/You are the CEO of NightPlan/);
    expect(sent[1]!.content).toMatch(/Open to-dos for the owner:\n- Open a Pinterest account/);
    expect(sent.at(-1)).toEqual({ role: "user", content: "what now?" });
    expect(line).toMatchObject({ from: "ceo", text: "Do this.", model: "free-model", actions: [{ type: "todo", text: "Record a 20 second flip-through of the planner" }] });
  });
});
