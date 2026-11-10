import { type Company, type Product, honestListing, screenText } from "@nightshift/core";
import { THEMES, type ThemeName } from "./planner.js";

/**
 * A fixed download: a printable pack of sheets for one niche (checklists, step-by-step sheets, fill-in
 * templates, logs), written once and rendered to PDF by the studio. The CEO's model writes the spec as
 * JSON; here it is held to its bounds and checked, so nothing thin, padded or dishonest is put on sale.
 * With no model there is still a pack: plainer, built around the company's own audience.
 */
export type SheetKind = "checklist" | "steps" | "fill" | "table";
export interface Sheet { title: string; note: string; kind: SheetKind; items: string[]; columns: string[]; rows: number }
export interface SheetSpec { title: string; subtitle: string; kicker: string; brand: string; theme: ThemeName; intro: string; howto: string[]; sections: Sheet[] }

export const SHEET_DESIGN = `You write a printable PDF pack of working sheets for one niche: things the buyer ticks, follows and fills in, not an article. It must be specific to the niche (their real steps, tools and deadlines in their own words), so it is worth a few dollars.
Answer with JSON only:
{"title": "under 48 characters, the niche in it", "subtitle": "who it is for and what it helps them finish, under 110 characters",
 "theme": "linen | sage | blush | ocean | night",
 "intro": "2 sentences on when to use the pack",
 "sections": [5 to 7 of
   {"kind": "checklist", "title": "...", "note": "one line on when to use it", "items": [8 to 14 concrete things to tick, each under 120 characters]}
 | {"kind": "steps", "title": "...", "note": "...", "items": [6 to 10 steps in order, each a full instruction under 140 characters]}
 | {"kind": "fill", "title": "...", "note": "...", "items": [5 to 9 prompts the buyer answers in writing]}
 | {"kind": "table", "title": "...", "note": "...", "columns": [3 to 5 column names], "rows": 12}]}
Use at least three different kinds. Rules: every item is something this niche really does; no filler, no item said twice; no medical, legal or financial advice; no brand names; no promises of results, numbers of customers or reviews; plain English.`;

const line = (v: unknown, max: number, fallback = "") => (typeof v === "string" ? v.replace(/[\u0000-\u001f\u007f<>]/g, " ").replace(/\s+/g, " ").trim().slice(0, max) : "") || fallback;
const lines = (v: unknown, max: number, len: number) => [...new Set((Array.isArray(v) ? v : []).map((x) => line(x, len)).filter(Boolean))].slice(0, max);
const int = (v: unknown, lo: number, hi: number, d: number) => (Number.isFinite(Number(v)) ? Math.min(hi, Math.max(lo, Math.round(Number(v)))) : d);

/** The spec from whatever the model wrote: unknown fields dropped, every list and number held to its bounds. */
export function sheetSpec(raw: unknown, base: { brand: string }): SheetSpec {
  const r = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const theme = (Object.keys(THEMES) as ThemeName[]).find((k) => k === r.theme) ?? "linen";
  const sections = (Array.isArray(r.sections) ? r.sections : []).slice(0, 8).flatMap((s): Sheet[] => {
    const x = (s && typeof s === "object" ? s : {}) as Record<string, unknown>;
    const title = line(x.title, 60);
    if (!title) return [];
    const note = line(x.note, 140);
    if (x.kind === "table") {
      const columns = lines(x.columns, 5, 26);
      return columns.length >= 2 ? [{ title, note, kind: "table", items: [], columns, rows: int(x.rows, 6, 18, 12) }] : [];
    }
    const kind: SheetKind = x.kind === "steps" || x.kind === "fill" ? x.kind : "checklist";
    const items = lines(x.items, kind === "checklist" ? 16 : 12, 160);
    return items.length >= 3 ? [{ title, note, kind, items, columns: [], rows: 0 }] : [];
  });
  return {
    title: line(r.title, 48, "Checklist pack"), subtitle: line(r.subtitle, 110), kicker: "Printable checklist pack", brand: line(base.brand, 40), theme,
    intro: line(r.intro, 320, "Print the sheets you need, or fill them in on a tablet. Work through them in order the first time; afterwards keep the ones you use every week."),
    howto: ["Print it at 100% on A4 or Letter, or open the PDF in any app with a pen.", "Start with sheet 1 and tick as you go: a sheet you finished once becomes your routine.", "Copy a sheet when you need it again. The pack is yours to reuse."],
    sections,
  };
}

/** Why a pack may not be sold as it is. An empty list means it may. */
export function sheetProblems(s: SheetSpec): string[] {
  const out: string[] = [];
  const items = s.sections.flatMap((x) => x.items);
  const weight = items.length + s.sections.filter((x) => x.kind === "table").length * 6;
  if (s.sections.length < 4) out.push(`only ${s.sections.length} sheets (at least 4)`);
  if (weight < 28) out.push(`too thin: ${items.length} items in all`);
  if (new Set(s.sections.map((x) => x.kind)).size < 2) out.push("every sheet is the same kind");
  const lower = items.map((x) => x.toLowerCase());
  if (new Set(lower).size < lower.length * 0.9) out.push("items are repeated");
  const all = [s.title, s.subtitle, s.intro, ...s.sections.flatMap((x) => [x.title, x.note, ...x.items, ...x.columns])].join(". ");
  if (/\[(?:your|insert|name|x{2,}|tbd)[^\]]{0,30}\]|lorem ipsum|\{\{/i.test(all)) out.push("a placeholder was left in");
  if (/\bas an ai\b|language model/i.test(all)) out.push("the writer talked about itself");
  if (!honestListing(`${s.title}. ${s.subtitle}. ${s.intro}`)) out.push("it promises results or quotes numbers nobody measured");
  if (!screenText(all).ok) out.push("it contains something that may not be sold here");
  return out;
}

/** A plain pack for the niche when no model answered: complete and usable, just less specific. */
export function plainSheet(c: Company, p: Product): unknown {
  const who = c.audience && c.audience !== "people who need this solved today" ? c.audience : "you";
  return {
    title: p.name.slice(0, 48), subtitle: `Working sheets for ${who}: plan it, do it, check it.`.slice(0, 110), theme: "linen",
    intro: `Use this pack each time you start a new piece of work. It is for ${who}: one sheet to set the goal, one to prepare, one to do the work in order, one to keep track, and one to review.`,
    sections: [
      { kind: "fill", title: "The goal on one page", note: "Fill this in before anything else.", items: ["What I want to have finished", "The date it must be done by", "Who it is for", "What done looks like, in one sentence", "What could stop me, and what I will do about it", "The first step I can take today"] },
      { kind: "checklist", title: "Before you start", note: "Tick each line; anything you cannot tick is your first task.", items: ["The goal is written down in one sentence", "The deadline is in my calendar", "I know who I need to ask for help", "I have the tools and logins I need", "I have blocked the time for it this week", "I know how much I can spend", "I have told the people it affects", "I know what I will not do this time", "I have a place to keep notes", "I know what the first hour looks like"] },
      { kind: "steps", title: "Doing the work, in order", note: "Follow the steps the first time; change them once you know your own way.", items: ["Write the goal at the top of a fresh page.", "List everything it needs, without sorting it.", "Mark the three things that matter most.", "Put a day next to each of the three.", "Do the hardest of the three first.", "Check the result against what done looks like.", "Fix what is missing, then stop.", "Tell the person it is for that it is ready."] },
      { kind: "table", title: "Weekly tracker", note: "One line a day keeps the week honest.", columns: ["Day", "Planned", "Done", "Notes"], rows: 14 },
      { kind: "checklist", title: "Before you call it done", note: "The last check before you hand it over.", items: ["It does what the goal sentence says", "Someone else has looked at it", "Names, dates and numbers are checked", "It is saved where I can find it again", "The person it is for knows it is ready", "I wrote down what I would do differently", "The next date is in my calendar"] },
      { kind: "fill", title: "Review", note: "Ten minutes at the end saves an hour next time.", items: ["What went well", "What took longer than I thought", "What I would do first next time", "What I can stop doing", "Who I should thank"] },
    ],
  };
}

/** The same pack as Markdown: the copy the buyer can edit, and what the market's free preview reads. */
export function sheetMarkdown(s: SheetSpec, c: Company, p: Product): string {
  const body = s.sections.map((x, i) => {
    const head = `## ${i + 1}. ${x.title}\n\n${x.note ? `_${x.note}_\n\n` : ""}`;
    if (x.kind === "table") return `${head}| ${x.columns.join(" | ")} |\n|${x.columns.map(() => "---").join("|")}|\n${Array.from({ length: Math.min(x.rows, 6) }, () => `| ${x.columns.map(() => " ").join(" | ")} |`).join("\n")}`;
    return head + x.items.map((it, k) => (x.kind === "checklist" ? `- [ ] ${it}` : x.kind === "steps" ? `${k + 1}. ${it}` : `- **${it}**\n\n  ______________________________`)).join("\n");
  }).join("\n\n");
  return `# ${s.title}\n\n_${p.pitch}_\n\n> Made by ${c.name}, an AI-run company on NIGHTSHIFT, with AI-assisted writing. A printable PDF and this editable copy are in the download.\n\n${s.intro}\n\n${body}\n`;
}

/** What the template reads: the spec and its theme's colours. */
export const sheetInput = (s: SheetSpec) => JSON.stringify({ ...s, theme: THEMES[s.theme] });
