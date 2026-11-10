import { describe, expect, it } from "vitest";
import { found, surpriseIdea, IDEA_POOL, honestListing } from "./planner.js";
import { screenCompany, screenText } from "./screen.js";
import type { LlmClient } from "@nightshift/llm";

const says = (content: string) => ({ chat: async () => ({ message: { role: "assistant", content }, costUsd: 0, servedModel: "m", finishReason: "stop" }) }) as unknown as LlmClient;
const busy = { chat: async () => { throw new Error("429 rate limited"); } } as unknown as LlmClient;

describe("what may not be a company", () => {
  it("refuses adult, illegal, scam, fake-review, spam and cure ideas, with a clear reason", () => {
    const refused: [string, string][] = [
      ["porn models", "adult"],
      ["An OnlyFans promotion agency for creators", "adult"],
      ["Sell p0rn video packs to subscribers", "adult"],
      ["Fake IDs and forged documents for students", "illegal"],
      ["Counterfeit designer bags shipped worldwide", "illegal"],
      ["A signal group with guaranteed returns of 20% a week", "scam"],
      ["Pump and dump alerts for new tokens", "scam"],
      ["Buy followers and fake reviews for Amazon sellers", "deception"],
      ["A cold DM bot that does mass DMs to Instagram users", "spam"],
      ["Sell phishing kits to beginners", "illegal"],
      ["Herbal drops that cure cancer in 30 days", "health"],
      ["Essay mill for university students", "illegal"],
    ];
    for (const [idea, category] of refused) {
      const r = screenText(idea);
      expect(r.ok, idea).toBe(false);
      if (!r.ok) { expect(r.category, idea).toBe(category); expect(r.reason).toMatch(/cannot be a NIGHTSHIFT company/); }
    }
  });

  it("lets ordinary ideas through, including ones that work against the bad things", () => {
    for (const idea of [
      "Résumé rewrites for nurses moving to clinic jobs",
      "A scam checker that helps pensioners spot phishing emails",
      "Phishing awareness training checklists for small offices",
      "Weekly planners for adult learners going back to college",
      "Budget templates for people in Essex and Sussex",
      "Sex education lesson plans are not what we sell: we sell classroom seating charts",
      "Templates for reporting fake reviews to marketplaces",
      "A 30-day content calendar for cocktail bars",
      "Checklist packs for first-time gun-safe buyers who want to store hunting rifles legally",
      ...IDEA_POOL,
    ]) expect(screenText(idea), idea).toEqual({ ok: true });
  });

  it("screens the whole company: its name, its mission and what it sells", () => {
    const base = { name: "Glow", idea: "templates for coaches", mission: "Templates for coaches.", audience: "coaches" };
    expect(screenCompany(base).ok).toBe(true);
    expect(screenCompany({ ...base, mission: "porn models" }).ok).toBe(false);
    expect(screenCompany({ ...base, products: [{ name: "Fake reviews pack", pitch: "50 five-star reviews", status: "live" }] }).ok).toBe(false);
    // what it stopped selling no longer counts against it
    expect(screenCompany({ ...base, products: [{ name: "Fake reviews pack", pitch: "50 five-star reviews", status: "retired" }] }).ok).toBe(true);
  });

  it("refuses at founding before any model is asked, and takes the founding model's own verdict", async () => {
    let asked = 0;
    const counting = { chat: async () => { asked++; return { message: { role: "assistant", content: "{}" } }; } } as unknown as LlmClient;
    const f = await found("porn models for adult sites", counting, "m");
    expect(f.refused).toMatch(/adult or sexual content/);
    expect(asked).toBe(0);
    // an idea the word list does not know, refused by the model with one of our categories
    const g = await found("Sell lists of home addresses of people who are away on holiday", says(JSON.stringify({ name: "Away", mission: "x", audience: "y", allowed: false, category: "illegal" })), "m");
    expect(g.refused).toMatch(/illegal goods or services/);
    // a model that refuses without one of the categories is not believed
    const h = await found("Weekly meal plans for night-shift nurses", says(JSON.stringify({ name: "NightMeals", mission: "Meals planned for nights.", audience: "night-shift nurses", allowed: false, category: "boring" })), "m");
    expect(h.refused).toBeUndefined();
    expect(h.name).toBe("NightMeals");
  });

  it("founds with the plain founding when the free model is busy or writes something unusable: founding never fails", async () => {
    const f = await found("Checklist packs for first-time landlords renting out one flat", busy, "m");
    expect(f.refused).toBeUndefined();
    expect(f.name.length).toBeGreaterThan(2);
    expect(f.audience).toBe("first-time landlords renting out one flat");
    // the model named it something the screen refuses: the plain founding names it instead
    const g = await found("Checklist packs for first-time landlords renting out one flat", says(JSON.stringify({ name: "PornHub", mission: "xxx videos", audience: "adults", allowed: true })), "m");
    expect(g.refused).toBeUndefined();
    expect(g.mission).toMatch(/^Checklist packs/);
  });
});

describe("surprise me", () => {
  it("takes the free model's idea when it is usable", async () => {
    const r = await surpriseIdea(says('Sure! {"idea": "Cover letters for baristas applying to their first café manager job in a new city"}'), "m");
    expect(r).toEqual({ idea: "Cover letters for baristas applying to their first café manager job in a new city", by: "model" });
  });

  it("answers from the pool when the model is busy, refuses, repeats a taken idea or invents something not allowed", async () => {
    for (const llm of [null, busy, says("no json here"), says('{"idea": "short"}'), says('{"idea": "Sell fake reviews and bought followers to new Amazon sellers every week"}'), says(`{"idea": "${IDEA_POOL[0]}"}`)]) {
      const r = await surpriseIdea(llm, "m", [IDEA_POOL[0]], () => 0);
      expect(r.by).toBe("pool");
      expect(IDEA_POOL).toContain(r.idea);
      expect(r.idea).not.toBe(IDEA_POOL[0]);
      expect(screenText(r.idea).ok).toBe(true);
    }
  });
});

describe("an honest listing", () => {
  it("says what the product is, never what nobody measured", () => {
    expect(honestListing("For night-shift nurses: your résumé rewritten for the role you name.")).toBe(true);
    for (const bad of ["Trusted by 2,000 customers", "Rated 5 stars by buyers", "Guaranteed interviews or your money back", "The #1 best-selling planner", "Proven to get 40% more replies"]) expect(honestListing(bad), bad).toBe(false);
  });
});
