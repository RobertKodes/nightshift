import { type PlannerSpec, THEMES } from "./planner.js";
import { pageSvg, scenePng } from "./render.js";

/**
 * The listing images every marketplace wants, made from the planner's real pages: a hero (the
 * planner on tablets), "what's inside" (six pages, named), and "what's included" (the facts of the
 * file). 2000 px squares, the size Etsy and Gumroad show best. Words come in as data, never as code.
 */
/** `files`: what tells the files apart, e.g. ["Monday start", "Sunday start"]. */
export interface ListingFacts { pages: number; links: number; files: string[] }

const SCENE_HEAD = `#let d = json(bytes(sys.inputs.data))
#let th = d.theme
#let paper = rgb(th.paper)
#let ink = rgb(th.ink)
#let soft = rgb(th.soft)
#let accent = rgb(th.accent)
#let tint = rgb(th.tint)
#let dark = d.dark
#set page(width: 2000pt, height: 2000pt, margin: 0pt, fill: if dark { gradient.linear(rgb("#0b0c14"), rgb("#1b1830"), angle: 60deg) } else { gradient.linear(tint, paper, angle: 60deg) })
#set text(font: "Poppins", fill: if dark { rgb("#f2f1f7") } else { ink })
#let device(file, w, angle: 0deg) = rotate(angle, reflow: false, box(fill: rgb("#101014"), radius: 0.055 * w, inset: 0.035 * w, stroke: 2pt + rgb("#2a2a33"), box(clip: true, radius: 0.02 * w, image(file, width: w))))
#let chip(t) = box(inset: (x: 26pt, y: 14pt), radius: 40pt, fill: if dark { rgb("#ffffff14") } else { rgb("#ffffffcc") }, stroke: 1.5pt + accent.transparentize(40%), text(size: 34pt, weight: "medium", t))
`;

const scene = (body: string) => `${SCENE_HEAD}${body}`;

const HERO = scene(`
#place(top + left, dx: 120pt, dy: 110pt, block(width: 1760pt)[
  #text(size: 40pt, weight: "semibold", fill: accent, tracking: 0.2em, upper(d.kicker))
  #v(18pt)
  #text(font: "DM Serif Display", size: 120pt, d.title)
  #v(6pt)
  #text(size: 44pt, fill: if dark { rgb("#c9c7d6") } else { soft }, d.subtitle)
])
#place(top + left, dx: 820pt, dy: 600pt, device("p2.svg", 860pt, angle: 5deg))
#place(top + left, dx: 150pt, dy: 640pt, device("p1.svg", 860pt, angle: -4deg))
#place(bottom + left, dx: 120pt, dy: -90pt, d.chips.map(chip).join(h(18pt)))
`);

const INSIDE = scene(`
#place(top + center, dy: 90pt, text(font: "DM Serif Display", size: 104pt, "What's inside"))
#place(top + left, dx: 110pt, dy: 280pt, grid(columns: (560pt,) * 3, column-gutter: 60pt, row-gutter: 60pt,
  ..d.names.enumerate().map(((i, n)) => stack(dir: ttb, spacing: 22pt,
    box(fill: rgb("#101014"), radius: 26pt, inset: 16pt, box(clip: true, radius: 10pt, image("p" + str(i + 1) + ".svg", width: 528pt))),
    align(center, text(size: 40pt, weight: "medium", n))))))
`);

const INCLUDED = scene(`
#place(top + left, dx: 130pt, dy: 140pt, block(width: 1000pt)[
  #text(font: "DM Serif Display", size: 104pt, "What's included")
  #v(40pt)
  #for f in d.features [
    #grid(columns: (70pt, 1fr), align: (left + top, left + top), text(size: 54pt, fill: accent, "✓"), text(size: 46pt, f))
    #v(22pt)
  ]
])
#place(top + left, dx: 1220pt, dy: 380pt, device("p1.svg", 640pt, angle: 3deg))
#place(bottom + left, dx: 130pt, dy: -110pt, text(size: 34pt, fill: if dark { rgb("#a9a7b8") } else { soft }, d.footer))
`);

export function listingImages(spec: PlannerSpec, facts: ListingFacts, keys: { hero: [string, string]; inside: [string, string][] }): { name: string; png: Buffer }[] {
  const theme = THEMES[spec.theme];
  const dark = spec.theme === "night";
  const base = { theme, dark, title: spec.title, subtitle: spec.subtitle, kicker: spec.kicker };
  const chips = [`${facts.pages} hyperlinked pages`, spec.size === "tablet" ? "GoodNotes · Notability" : "Print ready", String(spec.year)];
  const svg = (k: string) => pageSvg(spec, k);
  const features = [
    `${facts.pages} pages, ${facts.links.toLocaleString("en-US")} links: tap a tab or a date and jump there`,
    `Year, 12 months, ${spec.days ? "every week and every day" : "every week"} of ${spec.year}`,
    ...spec.trackers.slice(0, 3).map((t) => `${t.title}${t.kind === "habit" ? ", every month" : ""}`),
    ...spec.pages.slice(0, 2).map((p) => p.title),
    facts.files.length > 1 ? `${facts.files.length} PDFs: ${facts.files.join(" and ")}` : "One PDF",
  ].slice(0, 8);
  const make = (src: string, files: Record<string, string>, x: object) => scenePng(src, files, 2000, { data: JSON.stringify({ ...base, ...x }) });
  return [
    { name: "hero", png: make(HERO, { "p1.svg": svg(keys.hero[0]), "p2.svg": svg(keys.hero[1]) }, { chips }) },
    { name: "inside", png: make(INSIDE, Object.fromEntries(keys.inside.map(([k], i) => [`p${i + 1}.svg`, svg(k)])), { names: keys.inside.map(([, n]) => n) }) },
    { name: "included", png: make(INCLUDED, { "p1.svg": svg(keys.inside[1]?.[0] ?? keys.hero[1]) }, { features, footer: `Made by ${spec.brand}. AI-assisted design. Personal use licence.` }) },
  ];
}
