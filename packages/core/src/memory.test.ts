import { describe, expect, it } from "vitest";
import { type ImdPlane, type JobResult, SimImdPlane } from "@nightshift/imd";
import { Ledger } from "@nightshift/ledger";
import type { LlmClient } from "@nightshift/llm";
import { inputHash } from "imd-mcp/lib";
import { aboutOf, repeatOf, sameTopic, topicOf } from "./memory.js";
import { llmDecision, playbook, ruledOut } from "./planner.js";
import { DEFAULT_POLICY } from "./policy.js";
import { advance, missingAddress, recoverAddresses, runShift } from "./shift.js";
import type { Company, Task } from "./types.js";

const HOUR = 60 * 60 * 1000;

function company(extra: Partial<Company> = {}): Company {
  return {
    id: "c1", slug: "acme", name: "Acme", idea: "weekly AI tool reviews for solo founders who have no time to test tools",
    mission: "Save solo founders ten hours a week on picking AI tools.", audience: "solo founders",
    createdAt: 0, owner: null, wallet: "0x0000000000000000000000000000000000000001",
    policy: { ...DEFAULT_POLICY, dailyBudgetUsd: 1000, approvalOverUsd: 100 }, status: "active", cycle: 0, nextShiftAt: null,
    site: null, products: [], tasks: [], journal: [], marketing: [], ...extra,
  };
}

const delivered = async (id: string, _a: string, input: unknown): Promise<Omit<JobResult, "jobId">> => (input as { skill?: string }).skill === "build-website"
  ? { siteUrl: `http://sites/${id}`, repoUrl: null, files: {}, summary: null }
  : { siteUrl: null, repoUrl: null, files: { report: `http://files/${id}.md` }, summary: null };

/** A company on autopilot with the playbook CEO: one shift an hour, days passing while it rests. */
async function simulate(shifts: number, opts: { sells?: boolean; imd?: (now: { t: number }) => ImdPlane } = {}) {
  const now = { t: Date.parse("2026-10-21T00:00:00Z") };
  const sales: number[] = [];
  const c = company({ createdAt: now.t });
  const d = {
    imd: opts.imd?.(now) ?? new SimImdPlane({ jobMs: 10 * 60_000, now: () => now.t, deliver: delivered }),
    ledger: new Ledger(), llm: null, model: "none", imdUsd: () => 6, buyBase: () => "http://buy/acme", emit: () => {}, now: () => now.t,
    stats: () => { const n = sales.filter((at) => at > now.t - 7 * 24 * HOUR).length; return { visits7d: n * 20, sales7d: n, revenue7dUsd: n * 9, imdUsd: 6 }; },
  };
  const rests: string[] = [];
  for (let guard = 0; c.tasks.length < shifts && guard < 500; guard++) {
    now.t += HOUR;
    await advance(c, d);
    await recoverAddresses(c, d);
    // a buyer every other hour once there is a page, on the first product it sells
    const p = c.products.find((x) => x.status === "live");
    if (opts.sells && c.site && p && guard % 2 === 0) { p.sales += 1; sales.push(now.t); }
    const before = c.journal.length;
    if (!(await runShift(c, d))) {
      const saver = c.journal.slice(before).find((j) => j.text.startsWith("Saver:"));
      if (saver) { rests.push(saver.text); now.t = Math.max(now.t, c.restUntil ?? now.t); }
    }
  }
  return { c, rests, now };
}

/** No two tasks of a kind in the list are about the same thing. */
function twins(c: Company, tasks: Task[]): string[] {
  const out: string[] = [];
  tasks.forEach((a, i) => tasks.slice(i + 1).forEach((b) => {
    if (a.kind === b.kind && sameTopic(topicOf(c, a.about ?? a.title), topicOf(c, b.about ?? b.title))) out.push(`${a.title} / ${b.title}`);
  }));
  return out;
}

describe("a company never does the same work twice", () => {
  for (const sells of [false, true]) {
    it(`over 25 shifts with the playbook ${sells ? "while it sells" : "while nothing sells"}: no product, research, order or post twice`, async () => {
      const { c } = await simulate(25, { sells });
      expect(c.tasks.length).toBeGreaterThanOrEqual(25);
      const names = c.products.map((p) => p.name.toLowerCase());
      expect(new Set(names).size).toBe(names.length);
      // products are things buyers use, never reports
      expect(c.products.every((p) => p.kind !== "report")).toBe(true);
      expect(twins(c, c.tasks.filter((t) => t.kind === "build_product"))).toEqual([]);
      expect(twins(c, c.tasks.filter((t) => t.kind === "research"))).toEqual([]);
      expect(twins(c, c.tasks.filter((t) => t.kind === "improve_site"))).toEqual([]);
      const orders = c.tasks.filter((t) => t.imd).map((t) => inputHash(t.imd!.action, t.imd!.input));
      expect(new Set(orders).size).toBe(orders.length);
      expect(c.tasks.filter((t) => t.kind === "build_site")).toHaveLength(1);
      const posts = c.marketing.map((m) => m.text);
      expect(new Set(posts).size).toBe(posts.length);
      const titles = c.tasks.map((t) => t.title);
      expect(new Set(titles).size).toBe(titles.length);
      // a price is never changed again before the last change had days to show what it does
      const reprices = c.tasks.filter((t) => t.kind === "reprice");
      for (const [i, t] of reprices.entries()) for (const u of reprices.slice(i + 1)) if (t.productId === u.productId) expect(u.createdAt - t.createdAt).toBeGreaterThanOrEqual(3 * 24 * HOUR);
      // it moved on according to its results
      if (sells) expect(c.tasks.some((t) => /Sell more to the buyers of|Lead the page with/.test(t.title))).toBe(true);
      else expect(c.tasks.some((t) => t.kind === "marketing") && c.products.length).toBeGreaterThanOrEqual(3);
    }, 60_000);
  }

  it("does not try failing work a third time the same way, tries something else, then pauses with the reason for the owner", async () => {
    // every job the swarm takes fails
    const failing = (now: { t: number }) => {
      const sim = new SimImdPlane({ jobMs: 10 * 60_000, now: () => now.t, deliver: delivered });
      return { mode: "sim" as const, capabilities: () => sim.capabilities(), check: (a: never, i: unknown) => sim.check(a, i), open: (a: never, i: unknown, h?: never) => sim.open(a, i, h),
        order: (o: string) => sim.order(o), result: (j: string) => sim.result(j),
        job: async (j: string) => ({ jobId: j, state: "failed" as const, stepsDone: 1, stepsTotal: 4, activity: null }) } as unknown as ImdPlane;
    };
    const { c, rests } = await simulate(40, { imd: failing });
    const tried = c.tasks.filter((t) => t.imd);
    expect(tried.length).toBeGreaterThan(4);
    expect(tried.every((t) => t.status === "failed")).toBe(true);
    const bodies = new Map<string, number>();
    for (const t of tried) { const h = inputHash(t.imd!.action, t.imd!.input); bodies.set(h, (bodies.get(h) ?? 0) + 1); }
    expect(Math.max(...bodies.values())).toBeLessThanOrEqual(2);
    for (const t of tried) expect(tried.filter((u) => u.kind === t.kind && sameTopic(topicOf(c, u.about!), topicOf(c, t.about!))).length).toBeLessThanOrEqual(2);
    // a different approach each time: other kinds of tool, then research
    expect(new Set(tried.map((t) => t.title)).size).toBeGreaterThan(4);
    expect(tried.some((t) => t.kind === "research")).toBe(true);
    // and once every approach failed twice, it rests and says why instead of looping
    expect(rests.length).toBeGreaterThan(0);
    expect(c.restReason).toMatch(/repeats earlier work .*failed 2 times/);
  }, 60_000);
});

describe("the CEO's memory", () => {
  const llm = (answer: object, seen: string[]): LlmClient => ({
    chat: async (req: { messages: { content: string | null }[] }) => { seen.push(String(req.messages.at(-1)!.content)); return { message: { role: "assistant", content: JSON.stringify(answer) }, costUsd: 0, servedModel: "m", finishReason: "stop" }; },
  }) as unknown as LlmClient;
  const now = { t: Date.parse("2026-10-21T00:00:00Z") };
  const deps = (l: LlmClient | null, imd: ImdPlane = new SimImdPlane({ jobMs: 10_000, now: () => now.t, deliver: delivered })) => ({
    imd, ledger: new Ledger(), llm: l, model: "m", imdUsd: () => 6, buyBase: () => "http://buy/acme", emit: () => {}, now: () => now.t,
    stats: () => ({ visits7d: 0, sales7d: 0, revenue7dUsd: 0, imdUsd: 6 }),
  });
  const task = (x: Partial<Task>): Task => ({ id: Math.random().toString(36).slice(2), cycle: 1, kind: "research", title: "t", why: "", status: "done", stepsDone: 0, stepsTotal: 0, activity: null, costImd: 5n * 10n ** 17n, result: null, error: null, createdAt: now.t - 5 * HOUR, updatedAt: now.t - 5 * HOUR, ...x });
  const RESEARCH = "What do solo founders pay for today around AI tool reviews? List five products with evidence of demand, price points and who sells them.";
  const shop = () => company({
    site: { url: "http://acme.site", jobId: "j-site" },
    marketing: [{ at: now.t, channel: "x", text: "hi", status: "drafted" }],
    products: [{ id: "p1", name: "Acme Checker", kind: "tool", pitch: "Checks your AI stack.", priceUsdc: 9_000_000n, status: "live", deliverableUrl: "http://t", taskId: "t1", sales: 2, revenueUsdc: 18_000_000n, createdAt: now.t - 10 * HOUR }],
    tasks: [
      task({ cycle: 2, kind: "research", title: "Find the next thing to sell", about: RESEARCH, imd: { action: "job.open", input: { objective: RESEARCH } } }),
      task({ cycle: 3, kind: "improve_site", title: "Add pricing table", status: "failed", error: "the swarm failed the job", about: "Add a pricing table under the hero." }),
      task({ cycle: 4, kind: "improve_site", title: "Add a pricing table", status: "failed", error: "the swarm failed the job", about: "Add a pricing table under the hero, please." }),
    ],
  });

  it("is in the planner's prompt: what it made, sold, researched and what failed twice", async () => {
    const seen: string[] = [];
    const c = shop();
    await runShift(c, deps(llm({ kind: "marketing", title: "Post", why: "y", brief: "", post: "Try Acme Checker today." }, seen)));
    const prompt = seen[0]!;
    expect(prompt).toMatch(/its memory: never repeat any of it/);
    expect(prompt).toContain('"Acme Checker" (tool, live, 2 sold, $18.00)');
    expect(prompt).toContain('Research it has (use it, never order it again): "Find the next thing to sell"');
    expect(prompt).toMatch(/improve_site "Add a pricing table" 2 times \(the swarm failed the job\), do not try it again that way/);
    expect(prompt).toMatch(/Site: live at http:\/\/acme\.site/);
  });

  it("passes over a model's move that repeats earlier work, and the playbook moves on instead", async () => {
    const c = shop();
    const t = (await runShift(c, deps(llm({ kind: "research", title: "Market check", why: "y", brief: `${RESEARCH} Be thorough.` }, []))))!;
    expect(t.mind?.by).toBe("playbook");
    expect(t.mind?.fallback).toMatch(/the model's move repeats earlier work \(the same research was already ordered in shift 2/);
    expect(t.title).not.toBe("Market check");
    expect(t.mind?.avoided?.[0]).toMatch(/^Market check: /);
    // the same site change that failed twice is not ordered a third time, even worded differently
    const again = repeatOf(c, { kind: "improve_site", title: "Pricing table", why: "", brief: "Add a pricing table under the hero!" });
    expect(again).toMatch(/failed 2 times/);
  });

  it("spaces posts out whoever decides them: no second post within 20 hours, never the same title twice", () => {
    const at = Date.parse("2026-10-21T12:25:00Z");
    const c = company({ site: { url: "http://sites/acme", at: 0 } as Company["site"], marketing: [{ at, channel: "x", text: "Missed calls are lost jobs.", status: "drafted" }],
      tasks: [{ id: "t7", cycle: 7, kind: "marketing", title: "Contractor post: missed calls", why: "", status: "done", createdAt: at, updatedAt: at } as Task] });
    const post = { kind: "marketing" as const, title: "Contractor post: missed calls", why: "no visits", brief: "", post: "Every missed call is a job lost to a rival." };
    // the live case: the model asked for another post a minute later
    expect(repeatOf(c, post, null, at + 60_000)).toMatch(/drafted 1 h ago|next one waits about 20 hours/);
    // a day later the spacing allows a post, but not one with the same title
    expect(repeatOf(c, post, null, at + 21 * HOUR)).toMatch(/same title went out in shift 7/);
    expect(repeatOf(c, { ...post, title: "Weekend jobs you can still win" }, null, at + 21 * HOUR)).toBeNull();
  });

  it("reads the move out of an answer that thinks out loud around it", async () => {
    const say = (content: string) => ({ chat: async () => ({ message: { role: "assistant", content }, costUsd: 0, servedModel: "m", finishReason: "stop" }) }) as unknown as LlmClient;
    const c = shop();
    const answer = `Options: {research} or {marketing}. Final answer:\n${JSON.stringify({ kind: "marketing", title: "Post", why: "few visits", post: "Try Acme Checker." })} done`;
    const r = await llmDecision(say(answer), "m", c, { visits7d: 0, sales7d: 0, revenue7dUsd: 0, imdUsd: 6 });
    expect(r?.decision).toMatchObject({ kind: "marketing", post: "Try Acme Checker." });
    // a report the model asks for is built as a tool: products are things buyers use
    const p = await llmDecision(say(JSON.stringify({ kind: "build_product", title: "x", why: "y", brief: "b", product: { name: "Guide", kind: "report", pitch: "p", priceUsd: 9 } })), "m", c, { visits7d: 0, sales7d: 0, revenue7dUsd: 0, imdUsd: 6 });
    expect(p?.decision.product?.kind).toBe("tool");
  });

  it("keeps to the owner's direction when the playbook decides, as LeadNest's owner wrote it", async () => {
    // live: "No more building now, use the website to drive leads", and the playbook bought a third site
    const c = company({ direction: "No more building now, use the website to drive leads",
      products: [{ id: "p1", name: "Acme Checker", kind: "tool", pitch: "x", priceUsdc: 9_000_000n, status: "live", deliverableUrl: "http://t", taskId: "t0", sales: 1, revenueUsdc: 9_000_000n, createdAt: now.t }] });
    expect(playbook(c, { visits7d: 0, sales7d: 1, revenue7dUsd: 9, imdUsd: 6 }, now.t).map((m) => m.kind).filter((k) => /build|improve/.test(k))).toEqual([]);
    expect(ruledOut("No more research for now. Build and sell.", "research")).toBe(true);
    expect(ruledOut("No more research for now. Build and sell.", "build_product")).toBe(false);
    expect(ruledOut("Only Shopify sellers. Never build a report.", "build_product")).toBe(false);
    // a direction that rules out everything it knows is a pause the owner desk explains, not a loop
    const all = { ...c, site: { url: "http://s", jobId: "j" }, marketing: [{ at: now.t, channel: "x", text: "hi", status: "drafted" as const }], direction: "No more research, no more building, stop posting, do not change prices." };
    expect(await runShift(all, deps(null))).toBeNull();
    expect(all.restReason).toMatch(/the owner's direction rules out every move/);
  });

  it("dedupes IMD orders by what they are about, not only by their exact body", () => {
    const c = shop();
    const near = { kind: "research" as const, title: "x", why: "", brief: `${RESEARCH} Thanks.` };
    const order = { action: "job.open", input: { objective: near.brief } };
    // the exact-body saver would let it through
    expect(inputHash(order.action, order.input)).not.toBe(inputHash("job.open", c.tasks[0]!.imd!.input));
    expect(repeatOf(c, near, order)).toMatch(/already ordered in shift 2/);
    expect(repeatOf(c, { kind: "research", title: "y", why: "", brief: "Which newsletters and directories list new AI tools, and how does a tool get featured there?" })).toBeNull();
    expect(aboutOf({ ...c, direction: "Only Shopify sellers." }, near)).toContain("Direction: Only Shopify sellers.");
    // a new direction from the owner makes the same question new work; rewording the same direction does not
    const asked = { kind: "research" as const, title: "Find the next thing to sell", why: "", brief: RESEARCH };
    expect(repeatOf(c, asked)).toMatch(/already ordered/);
    const directed = { ...c, direction: "Focus on agent builders who ship on x402" };
    expect(repeatOf(directed, asked)).toBeNull();
    directed.tasks = [...c.tasks, task({ cycle: 5, kind: "research", title: "Find the next thing to sell", about: aboutOf(directed, asked) })];
    expect(repeatOf({ ...directed, direction: "Focus on agent builders who ship on x402." }, asked)).toMatch(/already ordered in shift 5/);
  });

  it("waits for IMD to publish a delivered site's address instead of buying the site again", async () => {
    const sim = new SimImdPlane({ jobMs: 10_000, now: () => now.t, deliver: delivered });
    let published = false;
    const imd = { mode: "sim" as const, capabilities: () => sim.capabilities(), check: (a: never, i: unknown) => sim.check(a, i), open: (a: never, i: unknown, h?: never) => sim.open(a, i, h),
      order: (o: string) => sim.order(o), job: (j: string) => sim.job(j),
      // the job is completed before its site has an address, as on api.imd.fun
      result: async (j: string) => ({ ...(await sim.result(j)), ...(published ? {} : { siteUrl: null }) }) } as unknown as ImdPlane;
    const c = company({ products: [{ id: "p1", name: "Acme Checker", kind: "tool", pitch: "x", priceUsdc: 9_000_000n, status: "live", deliverableUrl: "http://t", taskId: "t0", sales: 0, revenueUsdc: 0n, createdAt: now.t }] });
    const d = deps(null, imd);
    const t = (await runShift(c, d))!;
    expect(t.kind).toBe("build_site");
    now.t += 20_000;
    await advance(c, d);
    await advance(c, d);
    expect([t.status, c.site]).toEqual(["building", null]);
    expect(t.activity).toMatch(/waiting for IMD to publish the address/);
    expect(await runShift(c, d)).toBeNull(); // still its work in progress: nothing else is bought
    published = true;
    now.t += 31_000;
    await advance(c, d);
    expect(t.status).toBe("done");
    expect(c.site?.url).toBe(`http://sites/${t.imd!.jobId}`);
    expect(c.tasks.filter((x) => x.kind === "build_site")).toHaveLength(1);
  });

  it("stops following an order IMD no longer answers about, instead of being in progress for ever", async () => {
    const sim = new SimImdPlane({ jobMs: 10_000, now: () => now.t, deliver: delivered });
    const live = { mode: "live" as const, capabilities: () => sim.capabilities(), check: (a: never, i: unknown) => sim.check(a, i), open: (a: never, i: unknown, h?: never) => sim.open(a, i, h),
      order: (o: string) => sim.order(o), result: (j: string) => sim.result(j), job: async () => { throw Object.assign(new Error("HTTP 502"), { status: 502 }); } } as unknown as ImdPlane;
    const c = company();
    const d = deps(null, live);
    const t = (await runShift(c, d))!;
    now.t += 20_000;
    await advance(c, d);
    await advance(c, d);
    expect([t.status, t.activity]).toEqual(["building", "retrying: HTTP 502"]);
    now.t += 7 * HOUR;
    await advance(c, d);
    expect(t.status).toBe("failed");
    expect(t.costImd).toBe(5n * 10n ** 17n); // it was paid: it still counts
    expect(await runShift(c, d)).not.toBeNull(); // and the company moves on
  });

  it("collects the address of a site delivered before it was published, as the live companies had, and never rebuilds it", async () => {
    const c = company({
      products: [{ id: "p1", name: "Acme Checker", kind: "tool", pitch: "x", priceUsdc: 9_000_000n, status: "live", deliverableUrl: "http://t", taskId: "t0", sales: 0, revenueUsdc: 0n, createdAt: now.t }],
      tasks: [task({ cycle: 3, kind: "build_site", title: "Put the company on the web", imd: { action: "job.open", input: { objective: "Build the website" }, jobId: "job-3" }, result: { siteUrl: null, files: {} } })],
    });
    expect(repeatOf(c, { kind: "build_site", title: "Put the company on the web", why: "", brief: "A one-page site." })).toMatch(/built in shift 3/);
    const sim = new SimImdPlane({ jobMs: 10_000, now: () => now.t, deliver: delivered });
    const imd = { mode: "sim" as const, capabilities: () => sim.capabilities(), check: (a: never, i: unknown) => sim.check(a, i), open: (a: never, i: unknown, h?: never) => sim.open(a, i, h),
      order: (o: string) => sim.order(o), job: (j: string) => sim.job(j),
      result: async (j: string) => j === "job-3" ? { jobId: j, siteUrl: "https://ns-acme.site.identitymd.eth.limo", repoUrl: null, files: {}, summary: null } : sim.result(j) } as unknown as ImdPlane;
    const d = deps(null, imd);
    expect(missingAddress(c)).toHaveLength(1);
    // the next shift does something new while the address is collected
    const t = (await runShift(c, d))!;
    expect(t.kind).not.toBe("build_site");
    await recoverAddresses(c, d);
    expect(c.site).toEqual({ url: "https://ns-acme.site.identitymd.eth.limo", jobId: "job-3" });
    expect(missingAddress(c)).toHaveLength(0);
  });
});
