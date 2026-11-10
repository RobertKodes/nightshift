import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { IDEA_POOL } from "@nightshift/core";
import type * as EngineModule from "./engine.js";
import type * as FeedModule from "./feed.js";
import type * as ConfigModule from "./config.js";
import { renderSheet } from "./studio/render.js";

/**
 * The companies core end to end on a real engine in simulation, with no model key: found a company
 * with "Surprise me", three free shifts make its products, a buyer orders a made-for-you file and
 * buys it, and it shows in the public feed. Then the gates: moderation, the daily cap, the approval
 * gate, the upgrade to the swarm, and closing the company.
 */
let E: typeof EngineModule, F: typeof FeedModule, C: typeof ConfigModule;
let engine: EngineModule.Engine;

beforeAll(async () => {
  Object.assign(process.env, { DATA_DIR: mkdtempSync(join(tmpdir(), "companies-v2-")), NIGHTSHIFT_MODE: "sim", OPENROUTER_API_KEY: "", TELEGRAM_BOT_TOKEN: "", TELEGRAM_OFFLINE: "1", SIM_SHIFT_MINUTES: "1", SIM_START_IMD: "0", FREE_SHIFTS: "3", FREE_SHIFTS_DAILY_CAP: "50", REQUIRE_AUTH: "0" });
  [E, F, C] = await Promise.all([import("./engine.js"), import("./feed.js"), import("./config.js")]);
  engine = new E.Engine();
  // the pack's PDF is rendered in this process here (the engine forks a worker for it)
  (engine.studio as unknown as { d: { sheet: unknown } }).d.sheet = async (s: Parameters<typeof renderSheet>[0]) => renderSheet(s);
}, 120_000);

const until = async (ok: () => boolean, ms = 60_000) => { for (const t0 = Date.now(); !ok() && Date.now() - t0 < ms;) await new Promise((r) => setTimeout(r, 50)); if (!ok()) throw new Error("timed out"); };
const idle = (id: string) => () => { const c = engine.get(id)!; return c.cycle > 0 && !engine.working(c) && !c.tasks.some((t) => ["checking", "ordering", "building"].includes(t.status)); };
const feed = () => F.buildFeed({ all: [...engine.store.companies.values()], listed: (c) => engine.listed(c), metrics: (id) => engine.store.metricsOf(id), mode: "sim", chainId: 84532 }, 200);

describe("two-minute founding with free shifts", () => {
  let id = "";

  it("founds from Surprise me, with no funding step, and the first shift starts at once", async () => {
    const s = await engine.surprise();
    expect(s.by).toBe("pool");
    expect(IDEA_POOL).toContain(s.idea);
    // founded on one of the ideas it hands out (a fixed one here, so the products below are known)
    const c = await engine.create(IDEA_POOL[0], {}, null, { via: "web" });
    id = c.id;
    // nothing public and nothing paid without the owner
    expect(c.policy).toMatchObject({ approvalOverUsd: 0, aiDailyUsd: 0, autoPost: false, autopilot: true });
    expect(c.free).toEqual({ used: 0 });
    expect(await engine.funded(c)).toBe(false);
    expect(await engine.ledger.balance(`co:${c.id}:imd`, "IMD")).toBe(0n);
    await until(idle(id));
    expect(c.cycle).toBe(1);
    expect(c.products[0]).toMatchObject({ status: "live", format: "custom" });
    expect(c.journal.some((j) => /Waiting for funds/.test(j.text))).toBe(false);
    expect((await engine.plan(c)).free).toMatchObject({ used: 1, left: 2, pace: "first" });
    expect(engine.freeCap.used()).toBe(1);
    // the next free shift is minutes away, not a day
    expect(c.nextShiftAt! - Date.now()).toBeLessThanOrEqual(60_000);
  }, 90_000);

  it("makes its shop in three free shifts: no IMD order, no paid model, no gas", async () => {
    const c = engine.get(id)!;
    for (let i = 0; i < 2; i++) { await engine.shiftNow(c, true); await until(idle(id)); }
    expect(c.cycle).toBe(3);
    expect(c.products.filter((p) => p.status === "live").map((p) => p.format)).toEqual(["custom", "download", "custom"]);
    expect(c.products.every((p) => engine.files.has(c, p) && Number(p.priceUsdc) <= 5_000_000)).toBe(true);
    expect(c.tasks.every((t) => t.costImd === 0n && !t.imd)).toBe(true);
    expect(c.asks).toHaveLength(1);
    expect(await engine.ledger.balance(`co:${c.id}:imd`, "IMD")).toBe(0n);
    expect(c.journal.some((j) => /last of the 3 free shifts.*keeps working on free resources.*an upgrade, not a requirement/.test(j.text))).toBe(true);
    expect((await engine.plan(c)).free).toMatchObject({ used: 3, left: 0, pace: "slow" });
    // on the market for people and agents, with what to send for the made-for-you ones
    expect(engine.market().filter((m) => m.slug === c.slug)).toHaveLength(3);
  }, 180_000);

  it("after the free shifts the owner cannot press past the slower pace, and is offered the upgrade", async () => {
    const c = engine.get(id)!;
    await expect(engine.shiftNow(c, true)).rejects.toThrow(/Its 3 free shifts are used.*Fund the company to hire the IMD swarm/);
    expect(c.cycle).toBe(3);
  });

  it("writes a buyer's file before taking any money, sells it once, and shows the sale in the feed", async () => {
    const c = engine.get(id)!;
    const p = c.products.find((x) => x.format === "custom")!;
    const recipe = engine.made.recipe(p);
    expect(() => engine.made.create(c, p, { nothing: "here" })).toThrow(/The form is not complete/);
    const o = engine.made.create(c, p, recipe.sample);
    const ready = await engine.made.ready(o.id, 10_000);
    expect(ready?.status).toBe("ready");
    expect(engine.made.view(ready!).preview!.outline.length).toBeGreaterThan(0);
    expect(p.sales).toBe(0);
    const link = await engine.deliverOrder(c, p, ready!, { payer: "0xdemo000000000000000000000000000000buyer", tx: null, sim: true });
    expect(link).toContain(`/download/${c.slug}/${p.id}/`);
    expect(link).toContain(`ref=o-${o.id}`);
    expect(p.sales).toBe(1);
    expect(p.custom!.delivered).toBe(1);
    expect(engine.made.get(o.id)).toMatchObject({ status: "paid", paid: { sim: true } });
    const f = feed();
    expect(f.stats).toMatchObject({ companies: 1, sales: 1, salesUsd: Number(p.priceUsdc) / 1e6 });
    expect(f.items.map((x) => x.kind)).toEqual(expect.arrayContaining(["founded", "product", "sale"]));
    expect(f.items.find((x) => x.kind === "sale")).toMatchObject({ company: { id: c.id, slug: c.slug, name: c.name }, text: `[sim] sold "${p.name}" for $${(Number(p.priceUsdc) / 1e6).toFixed(2)}` });
    // the owner's question and the buyer never reach the feed
    expect(JSON.stringify(f)).not.toMatch(/0xdemo|I will not message anyone/);
  });

  it("never fails a shift for the daily cap: it queues for tomorrow and says so once", async () => {
    const c = await engine.create(IDEA_POOL[3], { autopilot: false }, null);
    expect(c.cycle).toBe(0);
    const cap = C.config.freeShiftsDailyCap;
    C.config.freeShiftsDailyCap = engine.freeCap.used();
    try {
      await engine.shiftNow(c);
      await engine.shiftNow(c);
      expect(c.cycle).toBe(0);
      expect(c.free!.queuedAt).toBeGreaterThan(0);
      expect(c.journal.filter((j) => /Today's free shifts for all companies are used\. This one is queued/.test(j.text))).toHaveLength(1);
      expect((await engine.plan(c)).free.queued).toEqual({ until: engine.freeCap.resetsAt() });
    } finally { C.config.freeShiftsDailyCap = cap; }
    await engine.shiftNow(c);
    await until(idle(c.id));
    expect(c.cycle).toBe(1);
    expect(c.free).toMatchObject({ used: 1 });
    expect(c.free!.queuedAt).toBeUndefined();
  }, 60_000);
});

describe("moderation", () => {
  it("refuses an illegal, adult or scam idea at founding, with the reason, and creates nothing", async () => {
    const before = engine.store.companies.size;
    for (const [idea, why] of [["porn models for adult sites, weekly sets", /adult or sexual content/], ["A signal channel with guaranteed returns of 20% every week", /scam, fraud or a promise of guaranteed money/], ["Sell fake reviews to new Amazon sellers by the hundred", /fake reviews/]] as const) {
      const err = await engine.create(idea, {}, null).catch((e: Error) => e);
      expect(err).toBeInstanceOf(E.ModerationError);
      expect((err as Error).message).toMatch(why);
      expect((err as Error).message).toMatch(/Describe a different idea/);
    }
    expect(engine.store.companies.size).toBe(before);
  });

  it("hides an existing company that should not be here, everywhere, without deleting anything", async () => {
    const c = await engine.create("Weekly photo packs of fitness models for gym owners", { autopilot: false }, "0x00000000000000000000000000000000000000aa");
    c.products.push({ id: "old1", name: "Starter pack", kind: "template", pitch: "x", priceUsdc: 3_000_000n, status: "live", deliverableUrl: null, taskId: "t", sales: 0, revenueUsdc: 0n, createdAt: 1 });
    engine.files.put(c, c.products[0]!, "# Starter pack\n\ntext");
    expect(engine.market().some((m) => m.slug === c.slug)).toBe(true);
    // as the live company was: its mission says what it really sells
    c.mission = "porn models";
    expect(engine.screenExisting()).toBe(1);
    expect(c.hidden).toMatchObject({ by: "auto" });
    expect(c.hidden!.reason).toMatch(/adult or sexual content/);
    expect(engine.listed(c)).toBe(false);
    expect(engine.market().some((m) => m.slug === c.slug)).toBe(false);
    expect(feed().items.some((x) => x.company.id === c.id)).toBe(false);
    expect((await engine.b2b.offers(c)).some((o) => o.seller.id === c.id)).toBe(false);
    await expect(engine.shiftNow(c, true)).rejects.toThrow(/hidden by moderation/);
    // nothing was deleted: the owner still has the company, its product and its log
    expect(engine.get(c.id)).toBe(c);
    expect(c.products).toHaveLength(1);
    expect(c.journal.at(-1)!.text).toMatch(/Hidden by moderation.*Nothing was deleted/);
    expect(engine.screenExisting()).toBe(0);
    // the owner cannot rename it into something else that is refused...
    expect(() => engine.updateProfile(c, { mission: "Escort listings for busy people in every city" })).toThrow(E.ModerationError);
    expect(c.mission).toBe("porn models");
    // ...and an honest edit shows it again
    engine.updateProfile(c, { mission: "Stock photo packs of gym equipment for gym owners' websites." });
    expect(c.hidden).toBeUndefined();
    expect(engine.market().some((m) => m.slug === c.slug)).toBe(true);
  });

  it("lets the operator hide a company by hand and clear one the screen got wrong", async () => {
    const c = await engine.create("Checklist packs for small cafés preparing for a health inspection", { autopilot: false }, null);
    engine.moderate(c, true, "copied listings");
    expect(c.hidden).toMatchObject({ by: "admin", reason: "copied listings" });
    expect(c.nextShiftAt).toBeNull();
    engine.moderate(c, false);
    expect(c.hidden).toBeUndefined();
    // cleared by a person: the automatic screen leaves it alone from now on
    c.mission = "A scam checker that also sells xxx stickers";
    expect(engine.screenExisting()).toBe(0);
    expect(c.hidden).toBeUndefined();
  });
});

describe("the approval gate on the engine", () => {
  it("a drafted post is public only after its owner approves it", async () => {
    const c = await engine.create("Business name and slogan packs for mobile dog groomers", { autopilot: false }, null);
    c.marketing.push({ at: 111, channel: "x", text: "Names for your grooming van.", status: "drafted" }, { at: 222, channel: "x", text: "A second draft.", status: "drafted" });
    engine.decideDraft(c, 111, true);
    engine.decideDraft(c, 222, false);
    expect(c.marketing.map((m) => m.status)).toEqual(["approved", "rejected"]);
    expect(() => engine.decideDraft(c, 111, true)).toThrow(/No such draft is waiting/);
    // only posts that really went out are in the feed
    expect(feed().items.some((x) => x.kind === "post" && x.company.id === c.id)).toBe(false);
  });

  it("the owner answers the CEO's question, and funding turns free shifts into full ones where every purchase waits", async () => {
    const c = [...engine.store.companies.values()].find((x) => x.asks?.length)!;
    const ask = c.asks![0]!;
    engine.answerAsk(c, ask.id, "done");
    expect(ask).toMatchObject({ status: "done" });
    expect(() => engine.answerAsk(c, "nope", "done")).toThrow(/No such question/);
    await engine.simFund(c);
    expect(await engine.funded(c, true)).toBe(true);
    await engine.shiftNow(c);
    // founded with "every purchase waits": the first paid move is held for the owner, and nothing is spent
    const held = c.tasks.find((t) => t.status === "awaiting_approval")!;
    expect(held).toBeDefined();
    expect(held.held).toMatchObject({ via: "swarm" });
    expect(await engine.ledger.balance(`co:${c.id}:imd`, "IMD")).toBe(20n * 10n ** 18n);
    expect((await engine.plan(c)).funded).toBe(true);
  }, 60_000);
});

describe("no lock-in", () => {
  it("closes a company in one step: it stops selling, is archived, and can be restored", async () => {
    const c = await engine.create("Checklist packs for tenants doing a move-out clean to get the deposit back", { autopilot: false }, null);
    expect(await engine.holdsFunds(c)).toBe(false);
    const r = await engine.shutdown(c, null);
    expect(r).toEqual({ txs: [], returned: [] });
    expect(engine.get(c.id)).toBeUndefined();
    expect(engine.archived(c.id)).toMatchObject({ id: c.id, status: "paused" });
    expect(feed().items.some((x) => x.company.id === c.id)).toBe(false);
    const back = await engine.restore(c.id, null);
    expect(back.id).toBe(c.id);
  });
});
