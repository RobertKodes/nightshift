import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { unzipSync } from "fflate";
import { describe, expect, it } from "vitest";
import { type Company, DEFAULT_POLICY, type Product, type Task } from "@nightshift/core";
import { ProductFiles } from "../products.js";
import { Studio, plannerYear } from "./index.js";
import { plannerSpec } from "./planner.js";
import { listingImages } from "./listing.js";
import { pageSvg, renderPlanner } from "./render.js";

const company = (): Company => ({
  id: "c1", slug: "nightplan", name: "NightPlan", idea: "planners for night-shift nurses", mission: "x", audience: "night-shift nurses", createdAt: 0, owner: null,
  wallet: "0x0000000000000000000000000000000000000001", policy: { ...DEFAULT_POLICY }, status: "active", cycle: 1, nextShiftAt: null, site: null, products: [], tasks: [], journal: [], marketing: [],
});

describe("the studio's planner", () => {
  it("keeps the spec to its bounds and as data", () => {
    const s = plannerSpec({ title: "#import \"x\": *  " + "x".repeat(80), theme: "neon", size: "huge", hours: [22, 99], trackers: [{ kind: "log", title: "Log", columns: ["only one"] }, { kind: "habit", title: "Habits", rows: Array(30).fill("Walk") }], notes: { pages: 500 } }, { brand: "NightPlan", year: 2027 });
    expect(s.title.length).toBeLessThanOrEqual(48);
    expect(s.theme).toBe("linen");
    expect(s.size).toBe("tablet");
    expect(s.hours).toEqual([22, 40]);
    // a log needs two columns; a habit tracker keeps 12 rows at most
    expect(s.trackers).toHaveLength(1);
    expect(s.trackers[0]).toMatchObject({ kind: "habit" });
    expect((s.trackers[0] as { rows: string[] }).rows).toHaveLength(12);
    expect(s.notes.pages).toBe(30);
    expect(s.guide.length).toBeGreaterThan(2);
  });

  it("renders a planner where every page links to the others, text with Typst syntax kept as text", () => {
    const s = plannerSpec({ title: "Plan #set page(width: 1pt) *bold*", days: false, notes: { pages: 2 }, trackers: [{ kind: "pixels", title: "Mood", rows: ["Good", "Low"] }] }, { brand: "NightPlan", year: 2027 });
    const r = renderPlanner(s);
    // cover, guide, index, year, 12 months, 53 weeks, a tracker, 2 notes pages
    expect(r.pages).toBe(1 + 1 + 1 + 1 + 12 + 53 + 1 + 2);
    expect(r.links).toBeGreaterThan(r.pages * 10);
    expect(r.pdf.subarray(0, 5).toString()).toBe("%PDF-");
    expect(pageSvg(s, "cover")).toContain("<svg");
  }, 60_000);

  it("plans for next year from September", () => {
    expect(plannerYear(Date.parse("2026-10-24T00:00:00Z"))).toBe(2027);
    expect(plannerYear(Date.parse("2026-03-01T00:00:00Z"))).toBe(2026);
  });

  it("makes the download and the listing images, then puts the product on sale", async () => {
    const files = new ProductFiles(mkdtempSync(join(tmpdir(), "studio-")), "secret", null, "m", "http://x");
    const c = company();
    const p: Product = { id: "p1", name: "Night Shift Planner", kind: "template", format: "planner", pitch: "Nights, planned.", priceUsdc: 12_000_000n, status: "building", deliverableUrl: null, taskId: "t1", sales: 0, revenueUsdc: 0n, createdAt: 0 };
    const t = { id: "t1", status: "building", studio: { format: "planner", at: 0, brief: "" } } as unknown as Task;
    c.products.push(p);
    const done: unknown[] = [];
    // the CEO's design: a night-shift day and a shift log
    const mind = { llm: { chat: async () => ({ message: { role: "assistant", content: JSON.stringify({ title: "Night Shift Planner", days: false, hours: [18, 32], trackers: [{ kind: "log", title: "Shift log", columns: ["Date", "Shift", "Sleep"], rows: 20 }], notes: { pages: 1 } }) } }) as never }, model: "m" };
    const studio = new Studio({ files, mind: async () => mind, finish: (_c, _t, r) => done.push(r), now: () => Date.parse("2026-10-24T00:00:00Z"), render: async (s) => renderPlanner(s), listing: async (s, f, k) => listingImages(s, f, k) });
    studio.build(c, t, p, { kind: "build_product", title: "Make it", why: "", brief: "", product: { name: p.name, kind: "template", pitch: p.pitch, priceUsd: 12, format: "planner" } });
    for (let i = 0; i < 200 && !done.length; i++) await new Promise((r) => setTimeout(r, 100));
    expect(done[0]).toMatchObject({ ok: true });
    expect(p.studio).toMatchObject({ year: 2027, images: ["hero", "inside", "included"] });
    const zip = unzipSync(new Uint8Array(files.bytes(c, p)!.data));
    expect(Object.keys(zip).sort()).toEqual(["How to use.txt", "LICENSE.txt", "Night Shift Planner 2027 (Monday start).pdf", "Night Shift Planner 2027 (Sunday start).pdf"]);
    expect(files.image(c, p, "hero")!.subarray(1, 4).toString()).toBe("PNG");
    expect(files.has(c, p)).toBe(true);
    expect(files.read(c, p)).toBeNull();
  }, 120_000);
});
