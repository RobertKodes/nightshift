import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { writeAtomic } from "./atomic.js";
import { config } from "./config.js";

/**
 * The IMD Radar hackathon (imdradar.site/hackathon): NIGHTSHIFT's entry is "nightshiftimd". Every 10 minutes the
 * public entry list is read and the operators are told when something that matters happens: results appear (any
 * field the list did not have before, such as a place, score or winner), our own entry changes (its payout address
 * or text), entries are removed, or the field grows. Only reads; it never posts publicly on its own.
 */
export const HACKATHON = {
  url: "https://www.imdradar.site/hackathon",
  api: "https://www.imdradar.site/api/launchpad?view=hackathon",
  entry: "nightshiftimd",
  /** What the organisers publish about it (read 2026-10-22). */
  facts: "NIGHTSHIFT is an entry (\"nightshiftimd\") in the IMD Radar hackathon at imdradar.site/hackathon: a $10,000 community-funded prize pool paid in ETH, USDT, USDC and IMD, shared by 15 winners. IMD's agents check every entry and pick places 6 to 15; a human jury picks the top 5; first place also gets an identity.md NFT. Entries are projects built through the IMD protocol (a Uniswap v4 hook or a custom contract that really uses IMD), created 7 to 21 October 2026, judged on their live state. Results have not been announced unless the status says so. The swarm judges from an IMD research report (its “All submissions: individual evidence and gaps” section), scoring each entry out of 100: IMD integration, ecosystem impact and financial utility, originality, technical architecture and security, and demonstrated functionality.",
};

/** The fields an entry had when we started watching: anything else appearing is news (results). */
export const KNOWN_FIELDS = ["about", "chains", "contract", "createdAt", "deployer", "id", "personal", "project"];
type Entry = Record<string, unknown> & { id?: string; project?: string };
type Seen = { count: number; ours: Record<string, string>; fields: string[]; ids: string[]; at: number };

export type News = { kind: "results" | "ours" | "removed" | "count"; text: string };
/** What changed between two looks at the list (pure, for the tests). */
export function hackathonNews(before: Seen | null, entries: Entry[]): { news: News[]; seen: Seen } {
  const fields = [...new Set(entries.flatMap((e) => Object.keys(e)))].sort();
  const mine = entries.find((e) => String(e.project ?? "").toLowerCase() === HACKATHON.entry);
  const ours = Object.fromEntries(Object.entries(mine ?? {}).map(([k, v]) => [k, typeof v === "string" ? v : JSON.stringify(v)]));
  const seen: Seen = { count: entries.length, ours, fields, ids: entries.map((e) => String(e.id ?? e.project ?? "")), at: Date.now() };
  const news: News[] = [];
  if (!before) return { news, seen };
  const fresh = fields.filter((f) => !before.fields.includes(f) && !KNOWN_FIELDS.includes(f));
  if (fresh.length) {
    const show = mine ? fresh.map((f) => `${f}: ${ours[f] ?? "—"}`).join(", ") : "our entry is not in the list";
    news.push({ kind: "results", text: `🏆 IMD Radar hackathon: the entry list has new fields (${fresh.join(", ")}). Results may be out. NIGHTSHIFT: ${show}. ${HACKATHON.url}` });
  }
  for (const k of Object.keys(ours)) if (k in before.ours && before.ours[k] !== ours[k] && !fresh.includes(k)) news.push({ kind: "ours", text: `🏆 IMD Radar hackathon: our entry's ${k} changed${k === "about" ? "" : `: ${before.ours[k]} → ${ours[k]}`}.` });
  if (Object.keys(before.ours).length && !mine) news.push({ kind: "removed", text: "⚠️ IMD Radar hackathon: our entry (nightshiftimd) is no longer in the list. Ask @imdradar." });
  const gone = before.ids.filter((id) => !seen.ids.includes(id)).length;
  if (gone && mine) news.push({ kind: "removed", text: `🏆 IMD Radar hackathon: ${gone} entr${gone === 1 ? "y was" : "ies were"} removed from the list (now ${seen.count}).` });
  if (seen.count - before.count >= 5) news.push({ kind: "count", text: `🏆 IMD Radar hackathon: ${seen.count} entries now (+${seen.count - before.count}).` });
  return { news, seen: { ...seen, count: seen.count - before.count >= 5 || gone ? seen.count : before.count } };
}

const file = () => join(config.dataDir, "hackathon.json");
let last: Seen | null = null;
/** For the assistant: the entry list as last read, in one line. */
export function hackathonStatus(): string {
  const s = last ?? (() => { try { return existsSync(file()) ? JSON.parse(readFileSync(file(), "utf8")) as Seen : null; } catch { return null; } })();
  if (!s) return "Not read yet.";
  const results = s.fields.filter((f) => !KNOWN_FIELDS.includes(f));
  return `${s.count} entries in the list; ${results.length ? `results fields published: ${results.join(", ")}` : "no results published yet"}; read ${Math.round((Date.now() - s.at) / 60000)} min ago.`;
}

export function followHackathon(tell: (text: string, topic: string) => Promise<unknown>, read: typeof fetch = fetch): void {
  const tick = async () => {
    const before = last ?? (existsSync(file()) ? (JSON.parse(readFileSync(file(), "utf8")) as Seen) : null);
    const r = await read(HACKATHON.api, { headers: { "user-agent": "NIGHTSHIFT hackathon watcher (getnightshift.tech)" }, signal: AbortSignal.timeout(20_000) });
    if (!r.ok) return;
    const body = (await r.json()) as { entries?: Entry[] };
    if (!Array.isArray(body.entries) || !body.entries.length) return;
    const { news, seen } = hackathonNews(before, body.entries);
    last = seen;
    writeAtomic(file(), JSON.stringify(seen));
    for (const n of news) await tell(n.text, `hackathon-${n.kind}`);
  };
  setInterval(() => void tick().catch((e) => console.error("hackathon", (e as Error).message)), 10 * 60_000);
  void tick().catch(() => {});
}

/** IMD oracle requests about the hackathon: the organisers' test runs, and the real judging. */
type OracleReq = { id: string; status: string; question?: string; jobId?: string };
export const isJudging = (r: OracleReq) => /hackathon/i.test(r.question ?? "") && /(select|rank|score)/i.test(r.question ?? "");
export const isTest = (r: OracleReq) => /^\s*test(ing)?\b/i.test(r.question ?? "");
type Judged = Record<string, string>;
/** What to say about the judging requests since the last look: the real ones publicly, test runs privately. */
export function judgingNews(before: Judged | null, reqs: OracleReq[]): { pub: string[]; priv: string[]; seen: Judged } {
  const seen: Judged = { ...(before ?? {}) }, pub: string[] = [], priv: string[] = [];
  for (const r of reqs.filter(isJudging)) {
    const was = seen[r.id];
    seen[r.id] = r.status;
    if (!before) continue; // the first look only learns what already exists
    const link = `https://api.imd.fun/oracle/requests/${r.id}`;
    if (isTest(r)) { if (was === undefined) priv.push(`🧪 IMD Radar hackathon: the organisers ran a TEST of the swarm judging (${r.status}). ${link}`); continue; }
    if (was === undefined) pub.push(`🐝 <b>THE SWARM IS JUDGING THE IMD RADAR HACKATHON</b>

IMD's agents have started scoring all the entries, NIGHTSHIFT among them. Places 6 to 15 come from the swarm, the top 5 from a human jury.

We'll post here the moment the swarm is done. Fingers crossed, crew. 🐸`);
    else if (was !== r.status && /attested|answered|complete|resolved/i.test(r.status)) pub.push(`🐝 <b>THE SWARM HAS FINISHED JUDGING THE HACKATHON</b>

IMD's agents have finished scoring the IMD Radar hackathon. The organisers announce the winners next, and we'll share NIGHTSHIFT's result as soon as it's public.`);
    else if (was !== r.status) priv.push(`🐝 IMD Radar hackathon judging is now ${r.status}. ${link}`);
  }
  return { pub, priv, seen };
}
const jfile = () => join(config.dataDir, "hackathon-judging.json");
/** Every 5 minutes: IMD's latest oracle requests, for the hackathon judging. */
export function followJudging(publicPost: (html: string) => Promise<unknown>, tell: (text: string, topic: string) => Promise<unknown>, read: typeof fetch = fetch): void {
  const tick = async () => {
    const before = existsSync(jfile()) ? (JSON.parse(readFileSync(jfile(), "utf8")) as Judged) : null;
    const r = await read("https://api.imd.fun/oracle/requests?limit=50", { signal: AbortSignal.timeout(20_000) });
    if (!r.ok) return;
    const body = (await r.json()) as { requests?: OracleReq[] };
    if (!Array.isArray(body.requests)) return;
    const { pub, priv, seen } = judgingNews(before, body.requests);
    writeAtomic(jfile(), JSON.stringify(seen));
    for (const t of priv) await tell(t, "hackathon-judging");
    for (const t of pub) await publicPost(t);
  };
  setInterval(() => void tick().catch((e) => console.error("hackathon judging", (e as Error).message)), 5 * 60_000);
  void tick().catch(() => {});
}
