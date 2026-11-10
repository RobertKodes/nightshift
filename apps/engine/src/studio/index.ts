import { zipSync, strToU8 } from "fflate";
import { type Company, type Decision, type Product, type Task, recipeOf } from "@nightshift/core";
import type { ChatMessage, LlmClient } from "@nightshift/llm";
import type { ProductFiles } from "../products.js";
import { type PlannerSpec, THEMES, plannerSpec } from "./planner.js";
import { type Rendered, type RenderedSheet, listingInChild, renderInChild, sheetInChild } from "./render.js";
import { SHEET_DESIGN, type SheetSpec, plainSheet, sheetMarkdown, sheetProblems, sheetSpec } from "./sheet.js";
import { customListing, writeOrder } from "./custom.js";

/**
 * The NIGHTSHIFT studio: real digital products made in-house, no swarm order. The CEO designs a
 * planner's content for its niche (the company's own strong model when it pays for one, the free
 * model otherwise); the studio renders it twice (Monday and Sunday start), checks every file, zips
 * them with a licence and an import guide, and makes the listing images. One build at a time.
 */
export interface StudioDeps {
  files: ProductFiles;
  /** The model to design with: the company's paid brain, else the free model. */
  mind: (c: Company) => Promise<{ llm: Pick<LlmClient, "chat">; model: string } | null>;
  finish: (c: Company, t: Task, r: { ok: true; summary: string } | { ok: false; error: string }) => void;
  now?: () => number;
  /** Renders one PDF, and the listing images: in a child process by default. */
  render?: (spec: PlannerSpec) => Promise<Rendered>;
  listing?: typeof listingInChild;
  /** Renders a pack of sheets: in a child process by default. */
  sheet?: (spec: SheetSpec) => Promise<RenderedSheet>;
  /** How long between tries when the free model is busy (it is asked up to three times before the plain version is made). */
  retryMs?: number;
  /** Days a buyer's made-for-you file is kept (said on the product's page). */
  keepDays?: number;
  /** Simulation: a made-for-you product may show a labelled stand-in as its sample when no model is set. */
  sim?: boolean;
}

const DESIGN = `You design the content of a hyperlinked digital planner (PDF for GoodNotes and Notability) for one niche. The layout is fixed and premium; you choose the words, the trackers and the niche's own pages, so the planner fits its buyers better than a generic one.
Answer with JSON only:
{"title": "under 40 characters, the niche in it", "subtitle": "who it is for and what it helps with, under 90 characters", "kicker": "e.g. 2027 digital planner",
 "theme": "linen | sage | blush | ocean | night", "weekStart": "mon | sun", "days": true,
 "hours": [first hour, last hour] (a schedule on each day page; past 24 runs into the next morning, e.g. [18, 32] for night shifts),
 "dayFields": [up to 4 short labels the niche writes down every day],
 "monthPanels": [3 short panel titles for each month page], "weekPanels": [2 short panel titles for each week page],
 "trackers": [up to 4 of {"kind": "habit", "title": "...", "rows": [up to 10 habits]} | {"kind": "log", "title": "...", "note": "...", "columns": [2 to 6 column names], "rows": 22} | {"kind": "pixels", "title": "...", "rows": [3 to 5 key labels]}],
 "pages": [up to 4 of {"title": "...", "note": "...", "prompts": [2 to 5 questions the buyer answers on that page]}],
 "notes": {"style": "lined | dot | grid", "pages": 8 to 20}}
Rules: use the buyers' own words; every tracker and page must be something this niche really does; no medical, legal or financial advice, no brand names, no promises of results; plain English.`;

/** The planner year: next year from September, when planners for it start to sell. */
export const plannerYear = (now: number) => { const d = new Date(now); return d.getUTCMonth() >= 8 ? d.getUTCFullYear() + 1 : d.getUTCFullYear(); };

function json(text: string): unknown {
  try { return JSON.parse(text.slice(text.indexOf("{"), text.lastIndexOf("}") + 1)); } catch { return null; }
}

/** A plain planner for the niche when no model answered: still complete, just less specific. */
const plainSpec = (c: Company, p: Product, year: number): unknown => ({
  title: p.name.slice(0, 40), subtitle: `For ${c.audience}`.slice(0, 90), kicker: `${year} digital planner`, theme: "linen", days: true,
  trackers: [{ kind: "habit", title: "Habits", rows: ["Water", "Move", "Sleep", "Read"] }, { kind: "pixels", title: "Mood in pixels", rows: ["Great", "Good", "Low"] }],
  pages: [{ title: "Goals", prompts: ["This year I want to", "Why it matters", "First three steps"] }], notes: { style: "dot", pages: 12 },
});

const LICENSE = (brand: string, year: number) => `Licence for this planner, ${brand} (${year})

You may: use it yourself, print it for yourself, and import it into any note app on your own devices.
You may not: share, resell, give away or upload the files, or the pages from them, anywhere.

Fonts: Poppins and DM Serif Display, under the SIL Open Font Licence 1.1.
Made by ${brand}, an AI-run company on NIGHTSHIFT (getnightshift.tech), with AI-assisted design.
`;

const PACK_LICENSE = (brand: string) => `Licence for this pack, ${brand}

You may: use it yourself, print it for yourself and for your own team, and edit your copy.
You may not: share, resell, give away or upload the files, or the sheets from them, anywhere.

Fonts: Poppins and DM Serif Display, under the SIL Open Font Licence 1.1.
Made by ${brand}, an AI-run company on NIGHTSHIFT (getnightshift.tech), with AI-assisted writing.
`;

const HOWTO = (s: PlannerSpec) => `How to use your planner

1. Unzip this file. You get ${s.size === "tablet" ? "two PDFs: one with weeks starting on Monday, one on Sunday" : "the PDFs"}.
2. GoodNotes: tap + then Import, and pick the PDF. Notability: tap Import, then the PDF. Any PDF app with a pen works too.
3. Keep it as one document so every link works: tap a month tab on the right edge, Year or Index at the top, or any date.
4. Write anywhere with your pen. Duplicate a page in your note app when you need more room.
`;

export class Studio {
  #queue: Promise<void> = Promise.resolve();
  readonly #busy = new Set<string>();
  constructor(private readonly d: StudioDeps) {}

  /** True while this task is being made (so a restart can tell a lost build from a running one). */
  building(taskId: string): boolean { return this.#busy.has(taskId); }

  build(c: Company, t: Task, p: Product, decision: Decision): void {
    this.#busy.add(t.id);
    this.#queue = this.#queue.then(() => this.#make(c, t, p, decision)).catch(() => {}).finally(() => this.#busy.delete(t.id));
  }

  async design(c: Company, p: Product, brief: string, year: number): Promise<PlannerSpec> {
    let raw: unknown = null;
    const m = await this.d.mind(c).catch(() => null);
    if (m) {
      const messages: ChatMessage[] = [
        { role: "system", content: DESIGN },
        { role: "user", content: `Company: ${c.name}\nWho buys: ${c.audience}\nIdea: ${c.idea}\nPlanner: ${p.name}: ${p.pitch}\nWhat it needs: ${brief || "(nothing more)"}\nYear: ${year}` },
      ];
      raw = await m.llm.chat({ model: m.model, messages, temperature: 0.5, maxTokens: 1800 }).then((r) => json(r.message.content ?? "")).catch(() => null);
    }
    return plannerSpec({ ...(raw && typeof raw === "object" ? raw : plainSpec(c, p, year) as object), year }, { brand: c.name, year });
  }

  /** The model's JSON for a design, asked again when it is busy: three tries, then null and the plain version is made. */
  async #ask(c: Company, system: string, user: string, maxTokens: number): Promise<unknown> {
    const m = await this.d.mind(c).catch(() => null);
    if (!m) return null;
    for (let i = 0; i < 3; i++) {
      try {
        const r = await m.llm.chat({ model: m.model, messages: [{ role: "system", content: system }, { role: "user", content: user }], temperature: 0.5, maxTokens });
        const raw = json(r.message.content ?? "");
        if (raw && typeof raw === "object") return raw;
      } catch { /* busy: wait and ask again */ }
      if (i < 2) await new Promise((r) => setTimeout(r, (this.d.retryMs ?? 8000) * (i + 1)));
    }
    return null;
  }

  /** A fixed download: the model writes the sheets for the niche, the studio checks them, renders the PDF and packs it. */
  async #makeDownload(c: Company, t: Task, p: Product, decision: Decision): Promise<void> {
    t.activity = "the studio is writing the pack";
    const raw = await this.#ask(c, SHEET_DESIGN, `Company: ${c.name}\nWho buys: ${c.audience}\nIdea: ${c.idea}\nPack: ${p.name}: ${p.pitch}\nWhat it needs: ${decision.brief || "(nothing more)"}`, 3200);
    let spec = sheetSpec(raw ?? plainSheet(c, p), { brand: c.name });
    let by = raw ? "the CEO's model" : "the studio's plain version (no model answered)";
    // what the model wrote is sold only if it passes; otherwise the plain pack, which always does
    if (raw && sheetProblems(spec).length) { spec = sheetSpec(plainSheet(c, p), { brand: c.name }); by = "the studio's plain version (the model's draft did not pass the checks)"; }
    const problems = sheetProblems(spec);
    if (problems.length) throw new Error(`the pack did not pass its checks: ${problems.join("; ")}`);
    t.activity = "the studio is rendering the PDF";
    const r = await (this.d.sheet ?? sheetInChild)(spec);
    if (r.pages < 5) throw new Error(`only ${r.pages} pages came out`);
    if (r.pdf.length > 20e6) throw new Error(`a PDF of ${(r.pdf.length / 1e6).toFixed(0)} MB is too big to sell`);
    const name = spec.title.normalize("NFKD").replace(/[̀-ͯ]/g, "").replace(/[^\w .()-]+/g, "").trim() || "Checklist pack";
    const md = sheetMarkdown(spec, c, p);
    const files = { [`${name}.pdf`]: new Uint8Array(r.pdf), [`${name} (editable).md`]: strToU8(md), "LICENSE.txt": strToU8(PACK_LICENSE(c.name)) };
    const zip = zipSync(files, { level: 0 });
    this.d.files.putBundle(c, p, zip);
    this.d.files.put(c, p, md);
    this.d.files.putImage(c, p, "hero", r.cover);
    this.d.files.putImage(c, p, "inside", r.first);
    const items = spec.sections.reduce((a, x) => a + x.items.length, 0);
    p.download = { pages: r.pages, sections: spec.sections.length, items, files: Object.keys(files), bytes: zip.length };
    this.d.finish(c, t, { ok: true, summary: `${r.pages} pages, ${spec.sections.length} sheets and ${items} lines to tick, follow or fill in, as a PDF with an editable copy. Written by ${by}.` });
  }

  /** A made-for-you product: nothing to render now. The studio writes its page and, with a model, a sample from a made-up buyer. */
  async #makeCustom(c: Company, t: Task, p: Product): Promise<void> {
    const r = recipeOf(p.custom?.recipe);
    if (!r) throw new Error("no such made-for-you file");
    t.activity = "the studio is writing a sample from a made-up example";
    const m = await this.d.mind(c).catch(() => null);
    const w = await writeOrder(m, r, r.sample, c, { tries: 2, pauseMs: this.d.retryMs ?? 8000, sim: this.d.sim, now: this.d.now });
    const sample = w.ok ? w.text : null;
    this.d.files.put(c, p, customListing(c, p, r, sample, this.d.keepDays ?? 30));
    this.d.finish(c, t, { ok: true, summary: `The order form (${r.fields.filter((f) => f.required).length} required answers) and the page are up${sample ? ", with a sample written from a made-up example" : "; the sample is added when the free model has a moment"}. Each buyer's file is written when they order and checked before they pay.` });
  }

  async #make(c: Company, t: Task, p: Product, decision: Decision): Promise<void> {
    try {
      if (p.format === "download") return await this.#makeDownload(c, t, p, decision);
      if (p.format === "custom") return await this.#makeCustom(c, t, p);
      const year = plannerYear((this.d.now ?? Date.now)());
      t.activity = "the studio is designing the planner";
      const spec = await this.design(c, p, decision.brief, year);
      t.activity = "the studio is rendering it";
      // one after the other, each in its own process: never two planners in memory at once
      const render = this.d.render ?? renderInChild;
      const mon = await render({ ...spec, weekStart: "mon" });
      const sun = await render({ ...spec, weekStart: "sun" });
      // the checks before anything is sold: a full planner, every page reachable, a file the shops take
      for (const r of [mon, sun]) {
        if (r.pages < 30) throw new Error(`only ${r.pages} pages came out`);
        if (r.links < r.pages) throw new Error(`only ${r.links} links in ${r.pages} pages`);
        if (r.pdf.length > 40e6) throw new Error(`a PDF of ${(r.pdf.length / 1e6).toFixed(0)} MB is too big to sell`);
      }
      const name = `${spec.title} ${spec.year}`.replace(/[^\w .()-]+/g, "").trim();
      const files = { [`${name} (Monday start).pdf`]: new Uint8Array(mon.pdf), [`${name} (Sunday start).pdf`]: new Uint8Array(sun.pdf), "How to use.txt": strToU8(HOWTO(spec)), "LICENSE.txt": strToU8(LICENSE(c.name, spec.year)) };
      // PDFs are already compressed: stored as they are, the ZIP is quick to make and to open
      const zip = zipSync(files, { level: 0 });
      t.activity = "the studio is making the listing images";
      const month = new Date((this.d.now ?? Date.now)()).getUTCMonth() + 1;
      const week = Math.min(52, Math.max(1, Math.round((month - 0.5) * 4.35)));
      const day = Math.min(360, Math.max(1, Math.round((month - 0.5) * 30.4)));
      const inside = ([["year", "Year at a glance"], [`month-${month}`, "12 months"], [`week-${week}`, "Every week"], ...(spec.days ? [[`day-${day}`, "Every day"] as [string, string]] : []),
        ...spec.trackers.slice(0, 2).map((x, i): [string, string] => [`tracker-${i}-${x.kind === "habit" ? month : 1}`, x.title]), ...spec.pages.slice(0, 1).map((x, i): [string, string] => [`page-${i}`, x.title])] as [string, string][]).slice(0, 6);
      const images = await (this.d.listing ?? listingInChild)({ ...spec, weekStart: "mon" }, { pages: mon.pages, links: mon.links, files: ["Monday start", "Sunday start"] }, { hero: ["cover", `month-${month}`], inside });
      this.d.files.putBundle(c, p, zip);
      for (const i of images) this.d.files.putImage(c, p, i.name, i.png);
      p.studio = { pages: mon.pages, links: mon.links, files: Object.keys(files), bytes: zip.length, images: images.map((i) => i.name), year: spec.year, theme: spec.theme in THEMES ? spec.theme : "linen" };
      this.d.finish(c, t, { ok: true, summary: `${mon.pages} pages and ${mon.links.toLocaleString("en-US")} links in each PDF, Monday and Sunday start, ${(zip.length / 1e6).toFixed(1)} MB, with ${images.length} listing images.` });
    } catch (e) {
      this.d.finish(c, t, { ok: false, error: (e as Error).message });
    }
  }
}
