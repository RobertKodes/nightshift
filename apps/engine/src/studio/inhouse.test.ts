import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { strFromU8, unzipSync } from "fflate";
import { describe, expect, it } from "vitest";
import { type Company, DEFAULT_POLICY, type Product, type Task } from "@nightshift/core";
import { ProductFiles } from "../products.js";
import { Studio } from "./index.js";
import { renderSheet } from "./render.js";
import { plainSheet, sheetMarkdown, sheetProblems, sheetSpec } from "./sheet.js";

const company = (): Company => ({
  id: "c1", slug: "wardcv", name: "WardCV", idea: "checklists for ward nurses moving to clinic jobs", mission: "x", audience: "ward nurses", createdAt: 0, owner: null,
  wallet: "0x0000000000000000000000000000000000000001", policy: { ...DEFAULT_POLICY }, status: "active", cycle: 1, nextShiftAt: null, site: null, products: [], tasks: [], journal: [], marketing: [],
});
const product = (extra: Partial<Product>): Product => ({ id: "p1", name: "The ward nurses checklist pack", kind: "template", pitch: "Checklists for ward nurses.", priceUsdc: 3_000_000n, status: "building", deliverableUrl: null, taskId: "t1", sales: 0, revenueUsdc: 0n, createdAt: 0, ...extra });
const says = (answers: unknown[]) => ({ model: "free-model", llm: { chat: async () => { const a = answers.length > 1 ? answers.shift() : answers[0]; if (a instanceof Error) throw a; return { message: { role: "assistant", content: typeof a === "string" ? a : JSON.stringify(a) }, finishReason: "stop", servedModel: "free-model" } as never; } } });

/** A pack as a model would write it for the niche. */
const PACK = {
  title: "Ward to clinic: the move pack", subtitle: "For ward nurses changing to clinic work, from notice to first week.", theme: "sage",
  intro: "Use it from the day you decide to move. Each sheet is one stage of the change.",
  sections: [
    { kind: "checklist", title: "Before you hand in notice", note: "Tick these first.", items: ["Read the notice period in your contract", "Ask HR how unused leave is paid", "Save your training record as a PDF", "List the wards and specialties you covered", "Ask two colleagues if they will be referees", "Check your registration renewal date", "Download your last three rotas", "Note your current band and hours"] },
    { kind: "steps", title: "Applying to a clinic", note: "In this order.", items: ["Pick three clinics within your commute.", "Read each one's services page and note the patient group.", "Match your ward skills to what they list.", "Rewrite your summary for clinic work.", "Send the application before the weekend.", "Call on day five if you heard nothing."] },
    { kind: "fill", title: "Your handover to the ward", note: "Write it once, leave it behind.", items: ["Patients or tasks only I know about", "Where I keep my notes", "Who covers my mentees", "Equipment I ordered", "What I would change on this ward"] },
    { kind: "table", title: "Application tracker", note: "One line per clinic.", columns: ["Clinic", "Sent", "Reply", "Next step"], rows: 12 },
    { kind: "checklist", title: "First week at the clinic", note: "Small things that make week one easy.", items: ["Learn the booking system's three main screens", "Find the emergency kit and check its date", "Ask how results are flagged", "Write down every login on day one", "Learn the names of the reception team", "Ask what a normal list looks like", "Find out who to call when a clinician is late"] },
  ],
};

describe("a fixed download from the studio", () => {
  it("holds a model's pack to its bounds and keeps every word as data", () => {
    const s = sheetSpec({ ...PACK, title: `${"x".repeat(80)}<script>`, theme: "neon", sections: [...PACK.sections, { kind: "table", title: "One column", columns: ["Only"] }, { kind: "checklist", title: "Too few", items: ["a", "b"] }, { title: "" }, "junk"] }, { brand: "WardCV" });
    expect(s.title.length).toBeLessThanOrEqual(48);
    expect(s.title).not.toContain("<");
    expect(s.theme).toBe("linen");
    expect(s.sections).toHaveLength(5);
    expect(s.sections[3]).toMatchObject({ kind: "table", rows: 12, columns: ["Clinic", "Sent", "Reply", "Next step"] });
    expect(sheetProblems(sheetSpec(PACK, { brand: "WardCV" }))).toEqual([]);
  });

  it("refuses a pack that is thin, padded, dishonest or not allowed", () => {
    const thin = sheetSpec({ ...PACK, sections: PACK.sections.slice(0, 2) }, { brand: "W" });
    expect(sheetProblems(thin).join(" ")).toMatch(/only 2 sheets/);
    const same = sheetSpec({ ...PACK, sections: PACK.sections.map((s) => ({ ...s, kind: "checklist", items: ["Do the thing", "Do the thing ", "Do the other thing", "Check it", "Do the thing"] })) }, { brand: "W" });
    expect(sheetProblems(same).join(" ")).toMatch(/too thin|every sheet is the same kind/);
    expect(sheetProblems(sheetSpec({ ...PACK, subtitle: "Trusted by 10,000 customers, guaranteed to get you hired." }, { brand: "W" })).join(" ")).toMatch(/promises results or quotes numbers nobody measured/);
    expect(sheetProblems(sheetSpec({ ...PACK, intro: "Fill in [Your Name] here." }, { brand: "W" })).join(" ")).toMatch(/placeholder/);
    expect(sheetProblems(sheetSpec({ ...PACK, sections: [...PACK.sections.slice(0, 4), { kind: "checklist", title: "Extras", items: ["Buy fake reviews for the clinic", "Order counterfeit badges", "Ask a friend", "Check twice", "Sleep"] }] }, { brand: "W" })).join(" ")).toMatch(/may not be sold here/);
    // the plain pack, made with no model, always passes
    expect(sheetProblems(sheetSpec(plainSheet(company(), product({})), { brand: "WardCV" }))).toEqual([]);
  });

  it("renders the pack to a PDF with a cover and one page per sheet, text with Typst syntax kept as text", () => {
    const s = sheetSpec({ ...PACK, title: "Pack #set page(width: 1pt) *bold*" }, { brand: "WardCV" });
    const r = renderSheet(s);
    expect(r.pdf.subarray(0, 5).toString()).toBe("%PDF-");
    // cover, how to use, five sheets
    expect(r.pages).toBe(7);
    expect(r.cover.subarray(1, 4).toString()).toBe("PNG");
    expect(r.first.subarray(1, 4).toString()).toBe("PNG");
  }, 60_000);

  it("makes the download from the model's pack and puts the product on sale with its preview", async () => {
    const files = new ProductFiles(mkdtempSync(join(tmpdir(), "studio-dl-")), "secret", null, "m", "http://x");
    const c = company(), p = product({ format: "download" });
    const t = { id: "t1", status: "building", studio: { format: "download", at: 0, brief: "" } } as unknown as Task;
    c.products.push(p);
    const done: unknown[] = [];
    const studio = new Studio({ files, mind: async () => says([PACK]), finish: (_c, _t, r) => done.push(r), sheet: async (s) => renderSheet(s), retryMs: 1 });
    studio.build(c, t, p, { kind: "build_product", title: "Make it", why: "", brief: "for the move to clinic work", product: { name: p.name, kind: "template", pitch: p.pitch, priceUsd: 3, format: "download" } });
    for (let i = 0; i < 300 && !done.length; i++) await new Promise((r) => setTimeout(r, 100));
    expect(done[0]).toMatchObject({ ok: true });
    expect((done[0] as { summary: string }).summary).toMatch(/7 pages, 5 sheets and 26 lines .* Written by the CEO's model\./);
    expect(p.download).toMatchObject({ pages: 7, sections: 5, items: 26 });
    const zip = unzipSync(new Uint8Array(files.bytes(c, p)!.data));
    expect(Object.keys(zip).sort()).toEqual(["LICENSE.txt", "Ward to clinic the move pack (editable).md", "Ward to clinic the move pack.pdf"]);
    expect(strFromU8(zip["LICENSE.txt"]!)).toMatch(/You may not: share, resell/);
    // the editable copy is also what the market's free preview reads
    const md = files.read(c, p)!;
    expect(md).toContain("- [ ] Read the notice period in your contract");
    expect(md).toContain("| Clinic | Sent | Reply | Next step |");
    expect(md).toBe(sheetMarkdown(sheetSpec(PACK, { brand: "WardCV" }), c, p));
    expect(files.image(c, p, "hero")!.subarray(1, 4).toString()).toBe("PNG");
    expect(files.image(c, p, "inside")!.subarray(1, 4).toString()).toBe("PNG");
  }, 120_000);

  it("makes the plain pack when the free model stays busy or writes something that does not pass: the build never fails for that", async () => {
    for (const [answers, by] of [[[new Error("429 busy")], /no model answered/], [[{ ...PACK, sections: PACK.sections.slice(0, 1) }], /did not pass the checks/], [["not json at all"], /no model answered/]] as const) {
      const files = new ProductFiles(mkdtempSync(join(tmpdir(), "studio-dl-")), "secret", null, "m", "http://x");
      const c = company(), p = product({ format: "download" });
      const t = { id: "t1", status: "building", studio: { format: "download", at: 0, brief: "" } } as unknown as Task;
      const done: { ok: boolean; summary?: string }[] = [];
      new Studio({ files, mind: async () => says([...answers]), finish: (_c, _t, r) => done.push(r), sheet: async (s) => renderSheet(s), retryMs: 1 })
        .build(c, t, p, { kind: "build_product", title: "Make it", why: "", brief: "", product: { name: p.name, kind: "template", pitch: p.pitch, priceUsd: 3, format: "download" } });
      for (let i = 0; i < 300 && !done.length; i++) await new Promise((r) => setTimeout(r, 100));
      expect(done[0]).toMatchObject({ ok: true });
      expect(done[0]!.summary).toMatch(by);
      expect(files.has(c, p)).toBe(true);
    }
  }, 180_000);
});

describe("a made-for-you product from the studio", () => {
  const GOOD_NAMES = `# Names for a mobile bike repair service

## Descriptive

1. **Doorstep Bike Repair**: says where the work happens. Slogan: "Fixed where you park."
2. **Commuter Cycle Care**: names the rider it serves. Slogan: "Ready before your ride."
3. **The Bike Mechanic Van**: plain and easy to remember. Slogan: "We come to you."
4. **Office Bike Service**: fits the workplace plan. Slogan: "Tune-ups at your desk."
5. **Monthly Bike Check**: sells the plan in the name. Slogan: "One visit, a smooth month."

## Invented

6. **Velora**: soft and easy to say. Slogan: "Ride on."
7. **Spokely**: friendly and short. Slogan: "Good as new, by noon."
8. **Cyclara**: sounds like care. Slogan: "Care that comes to you."
9. **Pedalio**: light and quick. Slogan: "Back in the saddle."
10. **Rollo Fix**: playful, two beats. Slogan: "Rolling again today."

## Metaphor

11. **Pit Stop**: borrowed from racing. Slogan: "In, fixed, out."
12. **House Call**: the doctor comes to you. Slogan: "The mechanic makes visits."
13. **Green Light**: the commute goes on. Slogan: "Go."
14. **Tailwind**: the help behind you. Slogan: "The push you needed."
15. **First Gear**: the start of every ride. Slogan: "Start smooth."

## Short and punchy

16. **Fixd**: four letters. Slogan: "Done."
17. **Chain**: the part that matters. Slogan: "Keep it moving."
18. **Tune**: what you get. Slogan: "Ride in tune."
19. **Crank**: bold and mechanical. Slogan: "Turn it up."
20. **Bolt**: fast and tight. Slogan: "Tight and right."

## Top three

1. House Call: the idea is clear in two words, and friendly.
2. Doorstep Bike Repair: nobody needs it explained.
3. Tailwind: warm, and easy to build a brand on.

## Before you use one

- Search the trademark register of your country for the name
- Search the company register
- Check the domain and the social handles
`;

  it("puts up the order form and a page with a sample written from a made-up buyer", async () => {
    const files = new ProductFiles(mkdtempSync(join(tmpdir(), "studio-cu-")), "secret", null, "m", "http://x");
    const c = company(), p = product({ format: "custom", custom: { recipe: "names", delivered: 0 }, name: "Clinic name pack", pitch: "20 names for your new clinic." });
    const t = { id: "t1", status: "building", studio: { format: "custom", at: 0, brief: "", recipe: "names" } } as unknown as Task;
    const done: { ok: boolean; summary?: string }[] = [];
    new Studio({ files, mind: async () => says([GOOD_NAMES]), finish: (_c, _t, r) => done.push(r), retryMs: 1 })
      .build(c, t, p, { kind: "build_product", title: "Set it up", why: "", brief: "", product: { name: p.name, kind: "template", pitch: p.pitch, priceUsd: 3, format: "custom", recipe: "names" } });
    for (let i = 0; i < 100 && !done.length; i++) await new Promise((r) => setTimeout(r, 50));
    expect(done[0]).toMatchObject({ ok: true });
    expect(done[0]!.summary).toMatch(/order form \(2 required answers\).*with a sample written from a made-up example/);
    const page = files.read(c, p)!;
    expect(page).toContain("# Clinic name pack");
    expect(page).toContain("## Sample");
    expect(page).toContain("_Made from a made-up example, not from a customer._");
    expect(page).toContain("**House Call**");
    expect(page).toContain("Nobody checked trademarks, company registers or domains");
    // a made-for-you product has a page, never a file to hand to every buyer
    expect(files.bytes(c, p)).toBeNull();
    expect(files.has(c, p)).toBe(true);
  });

  it("goes on sale without a sample when the free model is busy, and with a labelled stand-in only in the simulator", async () => {
    for (const [sim, want] of [[false, /the sample is added when the free model has a moment/], [true, /with a sample written from a made-up example/]] as const) {
      const files = new ProductFiles(mkdtempSync(join(tmpdir(), "studio-cu-")), "secret", null, "m", "http://x");
      const c = company(), p = product({ format: "custom", custom: { recipe: "resume", delivered: 0 } });
      const t = { id: "t1", status: "building", studio: { format: "custom", at: 0, brief: "", recipe: "resume" } } as unknown as Task;
      const done: { ok: boolean; summary?: string }[] = [];
      new Studio({ files, mind: async () => (sim ? null : says([new Error("429 busy")])), finish: (_c, _t, r) => done.push(r), retryMs: 1, sim })
        .build(c, t, p, { kind: "build_product", title: "Set it up", why: "", brief: "", product: { name: p.name, kind: "template", pitch: p.pitch, priceUsd: 4, format: "custom", recipe: "resume" } });
      for (let i = 0; i < 200 && !done.length; i++) await new Promise((r) => setTimeout(r, 50));
      expect(done[0]).toMatchObject({ ok: true });
      expect(done[0]!.summary).toMatch(want);
      expect(files.read(c, p)!.includes("## Sample")).toBe(sim);
      if (sim) expect(files.read(c, p)).toContain("Simulation sample: no model wrote this");
    }
  });
});
