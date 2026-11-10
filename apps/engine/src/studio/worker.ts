import { type ListingFacts, listingImages } from "./listing.js";
import type { PlannerSpec } from "./planner.js";
import { renderPlanner, renderSheet } from "./render.js";
import type { SheetSpec } from "./sheet.js";

/**
 * One studio job in its own process: Typst takes several hundred MB for a 450-page planner and keeps
 * it, so the engine forks this for each PDF and for the listing images, and the memory goes back
 * when it exits. The engine stays light and keeps answering while a planner is made.
 */
type Job = { spec: PlannerSpec; listing?: { facts: ListingFacts; keys: { hero: [string, string]; inside: [string, string][] } }; sheet?: SheetSpec };
process.once("message", (m: Job) => {
  let reply: object;
  try {
    if (m.sheet) { const r = renderSheet(m.sheet); reply = { ok: true, pdf: r.pdf, pages: r.pages, cover: r.cover, first: r.first, ms: r.ms }; }
    else if (m.listing) reply = { ok: true, images: listingImages(m.spec, m.listing.facts, m.listing.keys) };
    else { const r = renderPlanner(m.spec); reply = { ok: true, pdf: r.pdf, pages: r.pages, links: r.links, ms: r.ms }; }
  } catch (e) {
    reply = { ok: false, error: (e as Error).message };
  }
  process.send!(reply, () => process.exit(0));
});
