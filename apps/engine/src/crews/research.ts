/**
 * Research Desk: a short evidence report from SWARM MIND, the IMD swarm's published work. The
 * answer and every source come from what SWARM MIND returned: a source is listed only with its
 * explorer.imd.fun link, a citation that points at no listed source is marked, and with no
 * sources there is no answer at all (nothing is filled in from elsewhere).
 */

/** The fixed question the crew page shows as its live sample (answered by calling researchReport). */
export const RESEARCH_SAMPLE = "What has the IMD swarm published about Uniswap v4 hooks?";

export const QUESTION_MIN = 3, QUESTION_MAX = 500;
const EXPLORER = "https://explorer.imd.fun";
const MAX_SOURCES = 10;

export type ResearchSource = { n: number; title: string; url: string; kind: string; date: string | null; cited: boolean };
export type ResearchReport = {
  question: string; answer: string; sources: ResearchSource[]; coverage: string; gaps: string[];
  generatedAt: string; markdown: string;
  /** The model SWARM MIND used to write the answer, or null (no model: the matching works only). */
  model: string | null;
};
export type MindLike = { ask(q: string): Promise<unknown>; search(q: string): unknown };

export class ResearchError extends Error { constructor(readonly status: number, message: string) { super(message); } }

const plain = (s: unknown, n: number) => String(s ?? "").replace(/[\u0000-\u001f\u007f]+/g, " ").replace(/\s+/g, " ").trim().slice(0, n);

/** The question, cleaned and bounded (3 to 500 characters), or a 400. */
export function researchQuestion(q: unknown): string {
  const s = plain(q, 10_000);
  if (s.length < QUESTION_MIN || s.length > QUESTION_MAX) throw new ResearchError(400, `Ask a question of ${QUESTION_MIN} to ${QUESTION_MAX} characters.`);
  return s;
}

/** A work's explorer link, only when it is one (https://explorer.imd.fun/...). */
function explorerUrl(u: unknown): string | null {
  try { const url = new URL(String(u ?? "")); return url.origin === EXPLORER ? url.toString() : null; } catch { return null; }
}

type Raw = { n?: unknown; title?: unknown; kinds?: unknown; kind?: unknown; at?: unknown; url?: unknown };
const kindOf = (r: Raw) => (Array.isArray(r.kinds) ? r.kinds.map((k) => plain(k, 20)).filter(Boolean).join(", ") : plain(r.kind, 40)) || "other";
const dateOf = (at: unknown) => (typeof at === "number" && at > 0 ? new Date(at).toISOString().slice(0, 10) : null);
/** Markdown link text and URLs that cannot break out of their brackets. */
const mdText = (s: string) => s.replace(/([\\[\]()*_`#<>|])/g, "\\$1");

export async function researchReport(mind: MindLike, question: string, now: () => number = Date.now): Promise<ResearchReport> {
  const q = researchQuestion(question);
  let asked: { answer?: unknown; sources?: unknown; model?: unknown } | null;
  try { asked = (await mind.ask(q)) as typeof asked; } catch { throw new ResearchError(503, "SWARM MIND could not answer right now. Try again in a minute."); }
  let searched: unknown;
  try { searched = await Promise.resolve(mind.search(q)); } catch { searched = []; }

  const sources: ResearchSource[] = [];
  const gaps: string[] = [];
  let dropped = 0;
  const seen = new Set<string>();
  // the answer's own sources first, keeping their numbers: the answer cites them as [n]
  const askRaw = (Array.isArray(asked?.sources) ? asked!.sources : []) as Raw[];
  askRaw.forEach((r, i) => {
    const url = explorerUrl(r?.url);
    if (!url) { dropped++; return; }
    if (seen.has(url) || sources.length >= MAX_SOURCES) return;
    seen.add(url);
    const n = typeof r.n === "number" && Number.isInteger(r.n) && r.n > 0 ? r.n : i + 1;
    sources.push({ n, title: plain(r.title, 160) || "Untitled work", url, kind: kindOf(r), date: dateOf(r.at), cited: false });
  });
  const fromAsk = sources.length, answerable = fromAsk > 0;
  // then related works from the search, numbered after any number the answer could cite
  let next = askRaw.reduce((m, r, i) => Math.max(m, typeof r?.n === "number" && Number.isInteger(r.n) ? r.n : i + 1), sources.reduce((m, s) => Math.max(m, s.n), 0)) + 1;
  for (const r of (Array.isArray(searched) ? searched : []) as Raw[]) {
    if (sources.length >= MAX_SOURCES) break;
    const url = explorerUrl(r?.url);
    if (!url) { dropped++; continue; }
    if (seen.has(url)) continue;
    seen.add(url);
    sources.push({ n: next++, title: plain(r.title, 160) || "Untitled work", url, kind: kindOf(r), date: dateOf(r.at), cited: false });
  }

  const model = typeof asked?.model === "string" && asked.model ? plain(asked.model, 80) : null;
  let answer: string;
  if (!sources.length) {
    answer = "SWARM MIND found no published IMD swarm work on this question, so there is no sourced answer to give.";
    gaps.push("SWARM MIND returned no published work for this question: there is nothing to cite, so no answer is given.");
  } else if (!answerable) {
    answer = "SWARM MIND wrote no answer from linked sources. The published works that match the question are listed below.";
    gaps.push("No written answer: the works below matched the search but none came with the answer.");
  } else if (!model) {
    answer = "SWARM MIND had no model available, so there is no written answer. The published works that match the question are listed below.";
    gaps.push("No written answer: no model was available, so only the matching works are listed.");
  } else {
    const valid = new Set(sources.slice(0, fromAsk).map((s) => s.n));
    const bad = new Set<number>();
    answer = plain(asked?.answer, 3_000).replace(/\[(\d{1,3})\]/g, (m, d: string) => {
      const n = Number(d);
      if (valid.has(n)) { sources.find((s) => s.n === n)!.cited = true; return m; }
      bad.add(n);
      return "[?]";
    });
    if (!answer) { answer = "SWARM MIND returned an empty answer. The published works that match the question are listed below."; gaps.push("The written answer was empty."); }
    if (bad.size) gaps.push(`The answer cited ${[...bad].map((n) => `[${n}]`).join(", ")}, which is not among the linked sources; marked [?].`);
    if (!sources.some((s) => s.cited)) gaps.push("The answer cites none of the sources directly: check it against them.");
  }
  if (dropped) gaps.push(`${dropped} result${dropped === 1 ? "" : "s"} without an explorer.imd.fun link ${dropped === 1 ? "was" : "were"} left out.`);

  const dates = sources.map((s) => s.date).filter((d): d is string => !!d).sort();
  if (dates.length && now() - Date.parse(dates.at(-1)!) > 90 * 86_400_000) gaps.push(`The newest matching work is from ${dates.at(-1)}: later changes are not covered.`);
  gaps.push("Covers only what the IMD swarm published, read through SWARM MIND: no outside sources.");

  const byKind = new Map<string, number>();
  for (const s of sources) for (const k of s.kind.split(", ")) byKind.set(k, (byKind.get(k) ?? 0) + 1);
  const coverage = sources.length
    ? `${sources.length} published work${sources.length === 1 ? "" : "s"} from SWARM MIND (${[...byKind].map(([k, n]) => `${k} ${n}`).join(", ")})${dates.length ? `, dated ${dates[0]}${dates.length > 1 && dates.at(-1) !== dates[0] ? ` to ${dates.at(-1)}` : ""}` : ""}; ${sources.filter((s) => s.cited).length} cited in the answer.`
    : "No published work matched: SWARM MIND returned no sources.";

  const generatedAt = new Date(now()).toISOString();
  const markdown = [
    `# Research: ${mdText(q)}`, "", mdText(answer), "",
    "## Sources", "",
    ...(sources.length ? sources.map((s) => `${s.n}. [${mdText(s.title)}](${s.url}) (${s.kind}${s.date ? `, ${s.date}` : ""})${s.cited ? "" : " (related, not cited)"}`) : ["None: SWARM MIND returned no published work for this question."]), "",
    "## Coverage", "", mdText(coverage), "",
    "## Gaps", "", ...gaps.map((g) => `- ${mdText(g)}`), "",
    `_Research Desk (NIGHTSHIFT), from SWARM MIND, ${generatedAt}._`,
  ].join("\n");
  return { question: q, answer, sources, coverage, gaps, generatedAt, markdown, model };
}
