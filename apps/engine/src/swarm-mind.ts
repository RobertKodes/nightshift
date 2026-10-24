import { appendFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { LlmClient } from "@nightshift/llm";
import { writeAtomic } from "./atomic.js";

/**
 * SWARM MIND: the IMD swarm's memory, searchable and askable. Everything the swarm has published
 * (research, audits, contracts, sites, tokens, media) is read from IMD's public API a few at a time:
 * each work's request, and for research and audits the start of the report itself. Questions are
 * answered from those works only, each answer citing the works it used, linked to the explorer.
 */
export type Kind = "research" | "audits" | "contracts" | "sites" | "media" | "code" | "release" | "other";
export interface Work {
  id: string;
  jobId: string | null;
  kinds: Kind[];
  title: string;
  /** What was asked for (the job's objective), cut to 1,500 characters. */
  ask: string;
  /** The start of the report, for research and audits (the swarm's own words), cut to 5,000 characters. */
  text: string;
  at: number;
  url: string;
  /** An audit's findings, when it has them. */
  findings?: number;
}

export interface MindDeps {
  get: (url: string) => Promise<unknown>;
  text: (url: string) => Promise<string | null>;
  dir: string | null;
  now?: () => number;
  api?: string;
}

const STOP = new Set("a an and are as at be but by can do for from has have how i if in into is it its no not of on or so than that the their them then there these they this to was we what when where which who why will with would you your about after all also any been both each just more most other our out over some such them too use used very via vs".split(" "));
/** One form of a word: "burns", "burning", "burned" and "burn" are one word. */
const stem = (w: string) => (/^0x/.test(w) ? w : w.length > 5 && w.endsWith("ing") ? w.slice(0, -3) : w.length > 4 && w.endsWith("ed") ? w.slice(0, -2) : w.length > 4 && w.endsWith("es") ? w.slice(0, -2) : w.length > 3 && w.endsWith("s") && !w.endsWith("ss") ? w.slice(0, -1) : w);
/** Words of a text: code names split ("CappedBurnHook": capped burn hook), 0x addresses and $TICKERS kept whole, stopwords out. */
export function words(s: string): string[] {
  return (s.replace(/([a-z])([A-Z])/g, "$1 $2").toLowerCase().match(/0x[0-9a-f]{6,40}|\$?[a-z0-9][a-z0-9_-]*/g) ?? []).map((w) => w.replace(/^\$/, "")).filter((w) => w.length > 1 && !STOP.has(w)).map(stem);
}

const firstLine = (s: string) => s.split("\n").map((x) => x.replace(/^[#>*\s-]+/, "").trim()).find(Boolean)?.slice(0, 160) ?? "Untitled work";
/** Markdown made readable as plain text: code, images and link targets out. */
const plain = (md: string) => md.replace(/```[\s\S]*?```/g, " ").replace(/!\[[^\]]*\]\([^)]*\)/g, " ").replace(/\[([^\]]+)\]\([^)]*\)/g, "$1").replace(/[#>*_`|]+/g, " ").replace(/\s+/g, " ").trim();

/** One publication from IMD's /publications, as SWARM MIND keeps it (text filled in later). */
export function workOf(p: Record<string, unknown>): Work | null {
  const id = String(p.id ?? "");
  if (!id) return null;
  const kinds = (Array.isArray(p.types) ? p.types : []).map(String).filter((k) => ["research", "audits", "contracts", "sites", "media", "code", "release"].includes(k)) as Kind[];
  const first = [p.research, p.audits, p.contracts, p.code, p.sites, p.media].flatMap((x) => (Array.isArray(x) ? x : [])).find((x) => x && typeof x === "object" && (x as { jobId?: string }).jobId) as { jobId?: string } | undefined;
  const jobId = first?.jobId ?? (id.startsWith("job:") ? id.slice(4) : null);
  const audit = (Array.isArray(p.audits) ? p.audits : [])[0] as { findings?: number; repoUrl?: string } | undefined;
  const raw = String(p.title ?? "");
  // an audit is named by the code it audited: its request usually opens with the scope, not a title
  const repo = /github\.com\/([\w.-]+\/[\w.-]+?)(?:\.git)?\/?$/.exec(audit?.repoUrl ?? "")?.[1];
  return {
    id, jobId, kinds: kinds.length ? kinds : ["other"], title: repo ? `Audit of ${repo}` : firstLine(raw), ask: raw.replace(/\s+/g, " ").trim().slice(0, 1500), text: "",
    at: Date.parse(String(p.publishedAt ?? "")) || 0,
    url: jobId ? `https://explorer.imd.fun/jobs/${jobId}` : id.startsWith("launch:") ? `https://explorer.imd.fun/launches/${id.slice(7)}` : "https://explorer.imd.fun",
    ...(typeof audit?.findings === "number" ? { findings: audit.findings } : {}),
  };
}

/** BM25 over the works: the title counts three times, the request and the report once. */
export class Index {
  readonly #post = new Map<string, [number, number][]>();
  readonly #len: number[] = [];
  #avg = 1;
  constructor(readonly works: Work[]) {
    works.forEach((w, i) => {
      const ws = [...words(w.title), ...words(w.title), ...words(w.title), ...words(w.ask), ...words(w.text)];
      this.#len[i] = ws.length;
      const tf = new Map<string, number>();
      for (const x of ws) tf.set(x, (tf.get(x) ?? 0) + 1);
      for (const [x, n] of tf) { let p = this.#post.get(x); if (!p) this.#post.set(x, (p = [])); p.push([i, n]); }
    });
    this.#avg = this.#len.reduce((a, b) => a + b, 0) / Math.max(1, works.length);
  }
  /** In how many works a word appears (to tell a day's topic from a word every work uses). */
  df(word: string): number { return this.#post.get(word)?.length ?? 0; }
  search(q: string, limit = 8): { work: Work; score: number }[] {
    const scores = new Map<number, number>(), N = this.works.length;
    for (const x of new Set(words(q))) {
      const p = this.#post.get(x);
      if (!p) continue;
      const idf = Math.log(1 + (N - p.length + 0.5) / (p.length + 0.5));
      for (const [i, n] of p) scores.set(i, (scores.get(i) ?? 0) + idf * ((n * 2.2) / (n + 1.2 * (0.25 + 0.75 * this.#len[i]! / this.#avg))));
    }
    return [...scores].sort((a, b) => b[1] - a[1] || this.works[b[0]]!.at - this.works[a[0]]!.at).slice(0, limit).map(([i, score]) => ({ work: this.works[i]!, score }));
  }
}

/** The best passage of a work for a question: the window of the report (or request) that shares the most words with it. */
export function passage(w: Work, q: string, size = 700): string {
  const src = w.text || w.ask, want = new Set(words(q));
  if (src.length <= size) return src;
  let best = 0, at = 0;
  for (let i = 0; i < src.length - size; i += 140) {
    const n = words(src.slice(i, i + size)).filter((x) => want.has(x)).length;
    if (n > best) { best = n; at = i; }
  }
  return `${at ? "…" : ""}${src.slice(at, at + size).trim()}…`;
}

const ASK = `You answer questions from the IMD swarm's own published work: research reports, audits, contracts and sites that IMD's agent swarm made. Use only the numbered sources given. Cite each claim with its source number in brackets, like [2]. If the sources do not answer the question, say so plainly and say what they do cover. Never invent numbers, names, links or results. No investment or financial advice. Answer in under 160 words, in plain words, in the asker's language.`;

export function createMind(d: MindDeps) {
  const api = d.api ?? "https://api.imd.fun";
  const now = d.now ?? Date.now;
  const works = new Map<string, Work>();
  const st = { page: 1, total: 0, backfilled: false, texted: new Set<string>(), tried: new Set<string>(), at: 0 };
  let index: Index | null = null, indexedAt = -1;
  const answers = new Map<string, { at: number; r: Answer }>();

  const file = (n: string) => (d.dir ? join(d.dir, n) : null);
  if (d.dir) {
    mkdirSync(d.dir, { recursive: true });
    const wf = file("works.jsonl")!;
    if (existsSync(wf)) for (const l of readFileSync(wf, "utf8").split("\n")) { if (!l.trim()) continue; try { const w = JSON.parse(l) as Work; works.set(w.id, w); } catch { /* a torn line */ } }
    try { const s = JSON.parse(readFileSync(file("state.json")!, "utf8")) as { page: number; total: number; backfilled: boolean; texted: string[]; tried: string[] }; Object.assign(st, { ...s, texted: new Set(s.texted), tried: new Set(s.tried) }); } catch { /* new */ }
  }
  const keep = (w: Work) => { works.set(w.id, w); if (d.dir) appendFileSync(file("works.jsonl")!, `${JSON.stringify(w)}\n`); };
  const save = () => { if (d.dir) writeAtomic(file("state.json")!, JSON.stringify({ ...st, texted: [...st.texted], tried: [...st.tried] })); };

  /** The report's start, for a research or audit work: the first Markdown file the job delivered. */
  async function report(w: Work): Promise<string> {
    if (!w.jobId) return "";
    const r = (await d.get(`${api}/jobs/${w.jobId}/result`).catch(() => null)) as { files?: { mediaType?: string; url?: string; bytes?: number }[] } | null;
    const f = (r?.files ?? []).filter((x) => x.mediaType === "text/markdown" && x.url).sort((a, b) => (b.bytes ?? 0) - (a.bytes ?? 0))[0];
    const md = f?.url ? await d.text(f.url).catch(() => null) : null;
    return md ? plain(md).slice(0, 5000) : "";
  }

  /** Each minute: one page of publications (newest first, then on back through the history), and a few reports read. */
  async function tick(pages = 2, reports = 4): Promise<void> {
    for (let k = 0; k < pages; k++) {
      // once the history is read, only the newest page is checked for new work
      const page = st.backfilled ? 1 : st.page;
      const r = (await d.get(`${api}/publications?sort=newest&page=${page}`).catch(() => null)) as { items?: Record<string, unknown>[]; count?: number; totalPages?: number } | null;
      if (!r?.items) break;
      st.total = r.count ?? st.total;
      let fresh = 0;
      for (const p of r.items) { const w = workOf(p); if (w && !works.has(w.id)) { keep(w); fresh++; } }
      if (!st.backfilled) { st.page += 1; if (st.page > (r.totalPages ?? 0)) { st.backfilled = true; st.page = 1; } }
      if (st.backfilled && !fresh) break;
    }
    // the reports: newest research and audits first
    const todo = [...works.values()].filter((w) => (w.kinds.includes("research") || w.kinds.includes("audits")) && !st.texted.has(w.id) && !st.tried.has(w.id)).sort((a, b) => b.at - a.at).slice(0, reports);
    for (const w of todo) {
      const text = await report(w);
      if (text) { w.text = text; st.texted.add(w.id); keep(w); } else st.tried.add(w.id);
    }
    st.at = now();
    save();
  }

  const current = () => {
    if (!index || indexedAt !== works.size + st.texted.size) { index = new Index([...works.values()]); indexedAt = works.size + st.texted.size; }
    return index;
  };

  function search(q: string, limit = 8) {
    return current().search(q, limit).map(({ work }) => ({ id: work.id, title: work.title, kinds: work.kinds, at: work.at, url: work.url, findings: work.findings ?? null, passage: passage(work, q, 280) }));
  }

  type Answer = { answer: string; sources: { n: number; title: string; kinds: Kind[]; at: number; url: string }[]; model: string | null };
  /** An answer from the swarm's own work, with its sources. Without a model: the works that match, no answer. */
  async function ask(q: string, llm: Pick<LlmClient, "chat"> | null, model: string): Promise<Answer> {
    const key = words(q).sort().join(" ");
    const hit = answers.get(key);
    if (hit && now() - hit.at < 3_600_000) return hit.r;
    const found = current().search(q, 6);
    const sources = found.map(({ work }, i) => ({ n: i + 1, title: work.title, kinds: work.kinds, at: work.at, url: work.url }));
    if (!found.length) return { answer: "Nothing the swarm published matches that yet. Try other words, or ask about a token, a contract, an audit or a research topic.", sources: [], model: null };
    if (!llm) return { answer: "Here is what the swarm published on it:", sources, model: null };
    const ctx = found.map(({ work }, i) => `[${i + 1}] ${work.title} (${work.kinds.join(", ")}, ${new Date(work.at).toISOString().slice(0, 10)})\n${passage(work, q)}`).join("\n\n");
    const r = await llm.chat({ model, temperature: 0.2, maxTokens: 900, messages: [{ role: "system", content: ASK }, { role: "user", content: `Sources:\n${ctx}\n\nQuestion: ${q}` }] });
    const text = (r.message.content ?? "").replace(/<think>[\s\S]*?<\/think>/gi, "").trim();
    const out: Answer = { answer: text || "The swarm's work on this is listed below.", sources, model: r.servedModel ?? model };
    answers.set(key, { at: now(), r: out });
    if (answers.size > 500) answers.delete(answers.keys().next().value!);
    return out;
  }

  function stats() {
    const all = [...works.values()], by: Record<string, number> = {};
    for (const w of all) for (const k of w.kinds) by[k] = (by[k] ?? 0) + 1;
    const latest = [...all].sort((a, b) => b.at - a.at).slice(0, 8).map((w) => ({ title: w.title, kinds: w.kinds, at: w.at, url: w.url }));
    return { works: all.length, published: st.total, reports: st.texted.size, byKind: by, backfilled: st.backfilled, at: st.at, latest };
  }

  /** The works published in the last `ms` milliseconds, newest first. */
  const recent = (ms: number) => [...works.values()].filter((w) => now() - w.at < ms).sort((a, b) => b.at - a.at);
  /** How common a word is across all the swarm's works (0 to 1). */
  const share = (word: string) => current().df(word) / Math.max(1, works.size);
  return { tick, search, ask, stats, recent, share, size: () => works.size };
}
export type Mind = ReturnType<typeof createMind>;
