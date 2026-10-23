/**
 * The studio's first product: a hyperlinked digital planner for GoodNotes, Notability and print.
 * A CEO designs its content (the niche's own pages, trackers and fields) as a spec; planner.typ lays
 * it out. The spec here is the only way in: every field is checked, clamped and kept as data.
 */
export const THEMES = {
  linen: { paper: "#FBF8F3", ink: "#2B2926", soft: "#8A8178", line: "#E2DACF", accent: "#B0835A", tint: "#F1E9DE" },
  sage: { paper: "#F7F8F3", ink: "#263027", soft: "#7D877B", line: "#DCE2D6", accent: "#6F8F72", tint: "#E7EDE1" },
  blush: { paper: "#FFF8F6", ink: "#3A2A2C", soft: "#9A8487", line: "#F0DEDC", accent: "#C97B84", tint: "#F8E7E5" },
  ocean: { paper: "#F5F8FB", ink: "#1F2B38", soft: "#7A8896", line: "#D9E3EC", accent: "#3F7CA8", tint: "#E3EDF5" },
  night: { paper: "#14151B", ink: "#ECEAF2", soft: "#9593A8", line: "#3A3C4C", accent: "#8EA2FF", tint: "#24252F" },
} as const;
export type ThemeName = keyof typeof THEMES;

/** Page sizes in points: an iPad-shaped page for note apps, and A4 and US Letter to print. */
export const SIZES = { tablet: { width: 1620, height: 2160 }, a4: { width: 595, height: 842 }, letter: { width: 612, height: 792 } } as const;
export type SizeName = keyof typeof SIZES;

export type Tracker =
  | { kind: "habit"; title: string; rows: string[] }
  | { kind: "log"; title: string; note?: string; columns: string[]; rows: number }
  | { kind: "pixels"; title: string; rows: string[] };

export interface PlannerSpec {
  title: string;
  subtitle: string;
  kicker: string;
  brand: string;
  year: number;
  weekStart: "mon" | "sun";
  size: SizeName;
  theme: ThemeName;
  /** A page for every day of the year (about 365 more pages). */
  days: boolean;
  /** The day page's schedule, first and last hour; past 24 runs into the next morning (19 to 31 is 19:00 to 07:00). */
  hours: [number, number];
  /** Extra lines on every day page, in the niche's own words ("Shift", "Sleep window"). */
  dayFields: string[];
  monthPanels: string[];
  weekPanels: string[];
  trackers: Tracker[];
  /** The niche's own pages: a title and the prompts to write under. */
  pages: { title: string; note?: string; prompts: string[] }[];
  notes: { style: "lined" | "dot" | "grid"; pages: number };
  guide: [string, string][];
}

/** One line of plain text: no control characters, trimmed, at most `max` characters. */
const line = (v: unknown, max: number, fallback = ""): string => {
  const s = typeof v === "string" ? v.replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim() : "";
  return (s || fallback).slice(0, max);
};
const lines = (v: unknown, n: number, max: number): string[] => (Array.isArray(v) ? v : []).map((x) => line(x, max)).filter(Boolean).slice(0, n);
const int = (v: unknown, lo: number, hi: number, d: number) => { const x = Math.round(Number(v)); return Number.isFinite(x) ? Math.min(hi, Math.max(lo, x)) : d; };

export function guideFor(s: Pick<PlannerSpec, "days" | "trackers" | "size">): [string, string][] {
  return [
    ["Jump anywhere", "Tap a month tab on the right edge, or Year and Index at the top. Every date is a link."],
    [s.days ? "Days and weeks" : "Weeks", s.days ? "Tap a date in a month to open its day page; the week button on a day goes back to its week." : "Tap a date in a month to open its week."],
    ["Import it", s.size === "tablet" ? "Open the PDF in GoodNotes, Notability, Noteshelf or any PDF app with a pen. Keep it as one document so the links work." : "Print it at 100%, or open it in any PDF app with a pen."],
    ...(s.trackers.length ? [["Track it", "The trackers are in the index: fill a circle or a square each day."] as [string, string]] : []),
    ["Make it yours", "Write anywhere. Duplicate a page in your note app when you need more room."],
  ];
}

/** The spec from whatever the CEO wrote: unknown fields dropped, every list and number held to its bounds. */
export function plannerSpec(raw: unknown, base: { brand: string; year: number }): PlannerSpec {
  const r = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const theme = (Object.keys(THEMES) as ThemeName[]).find((k) => k === r.theme) ?? "linen";
  const size = (Object.keys(SIZES) as SizeName[]).find((k) => k === r.size) ?? "tablet";
  const hours = Array.isArray(r.hours) ? r.hours : [];
  const h0 = int(hours[0], 0, 23, 6);
  const h1 = int(hours[1], h0 + 6, h0 + 18, Math.max(h0 + 6, 22));
  const trackers: Tracker[] = (Array.isArray(r.trackers) ? r.trackers : []).slice(0, 6).flatMap((t): Tracker[] => {
    const x = (t && typeof t === "object" ? t : {}) as Record<string, unknown>;
    const title = line(x.title, 40);
    if (!title) return [];
    if (x.kind === "log") {
      const columns = lines(x.columns, 6, 22);
      return columns.length >= 2 ? [{ kind: "log", title, note: line(x.note, 60), columns, rows: int(x.rows, 8, 30, 22) }] : [];
    }
    const rows = lines(x.rows, x.kind === "pixels" ? 6 : 12, 28);
    if (!rows.length) return [];
    return [{ kind: x.kind === "pixels" ? "pixels" : "habit", title, rows }];
  });
  const pages = (Array.isArray(r.pages) ? r.pages : []).slice(0, 8).flatMap((p) => {
    const x = (p && typeof p === "object" ? p : {}) as Record<string, unknown>;
    const title = line(x.title, 40), prompts = lines(x.prompts, 6, 80);
    return title && prompts.length ? [{ title, note: line(x.note, 60), prompts }] : [];
  });
  const notes = (r.notes && typeof r.notes === "object" ? r.notes : {}) as Record<string, unknown>;
  const spec: PlannerSpec = {
    title: line(r.title, 48, "Planner"),
    subtitle: line(r.subtitle, 90),
    kicker: line(r.kicker, 40, "Digital planner"),
    brand: line(base.brand, 40),
    year: int(r.year, 2025, 2035, base.year),
    weekStart: r.weekStart === "sun" ? "sun" : "mon",
    size, theme,
    days: r.days !== false,
    hours: [h0, h1],
    dayFields: lines(r.dayFields, 4, 28),
    monthPanels: (() => { const p = lines(r.monthPanels, 3, 24); return p.length === 3 ? p : ["Goals", "Priorities", "Notes"]; })(),
    weekPanels: (() => { const p = lines(r.weekPanels, 2, 24); return p.length === 2 ? p : ["Priorities", "Notes"]; })(),
    trackers, pages,
    notes: { style: notes.style === "dot" || notes.style === "grid" ? notes.style : "lined", pages: int(notes.pages, 0, 30, 12) },
    guide: [],
  };
  spec.guide = guideFor(spec);
  return spec;
}

/** What the template reads: the spec, its theme's colours and its page size in points. */
export const templateInput = (s: PlannerSpec) => JSON.stringify({ ...s, theme: THEMES[s.theme], page: SIZES[s.size] });
