import type { LaunchRow } from "../services/imd.js";
import { DAY, MIN } from "./clock.js";
import { clean, injectionLike, isAddress } from "./safety.js";

/**
 * Finding prospects in public APIs only: GitHub's repository search (read-only, unauthenticated
 * unless a token is set) and IMD's list of recent launches. Only public business facts are kept:
 * where it came from, its public URL, the repo or launch name, its organization, a cleaned
 * description, topics, last push and stars. No people, no emails, no contact lists.
 */

export type Fetch = (url: string, init?: RequestInit) => Promise<Response>;

export const GITHUB_API = "https://api.github.com";
/** IMD's public API (the same host services/imd.ts reads). */
export const IMD_API = "https://api.imd.fun";
const HOSTS = new Set(["api.github.com", "api.imd.fun"]);

/** Focused searches: v4 hooks, x402, MCP servers on chain, agent marketplaces, IMD / identity-md. */
export const DEFAULT_QUERIES = [
  "topic:uniswap-v4",
  "\"uniswap v4\" hook in:name,description,topics",
  "x402 in:name,description,topics",
  "mcp onchain in:name,description,topics",
  "mcp crypto in:name,description,topics",
  "\"agent marketplace\" in:name,description,topics",
  "identity-md OR imd.fun in:name,description,readme",
];

export type Candidate = {
  source: "github" | "imd";
  /** Stable identity: "github:owner/repo" or "imd:<launch number>". */
  key: string;
  url: string;
  name: string;
  /** The organization (GitHub owner, lowercase) a contact would count against. */
  org: string;
  description: string;
  topics: string[];
  pushedAt: string | null;
  stars: number;
  openIssues: number;
  /** A token address (IMD launches), for a Watchtower sample link. */
  address: string | null;
  /** The launch's public source repo, if it has one. */
  repo: string | null;
  /** Why this one must not be contacted, e.g. text written to steer an AI. */
  flags: string[];
};

/** fetch() to the two permitted hosts only, with a timeout. */
async function get(fetch: Fetch, url: string, headers: Record<string, string> = {}): Promise<Response> {
  const u = new URL(url);
  if (u.protocol !== "https:" || !HOSTS.has(u.hostname)) throw new Error(`host not permitted: ${u.hostname}`);
  // the signal ends a real request; the timer also covers a fetch that ignores it
  return new Promise<Response>((ok, fail) => {
    const t = setTimeout(() => fail(new Error(`${u.hostname} gave no answer in 25 s`)), 25_000);
    t.unref?.();
    fetch(url, { method: "GET", headers, signal: AbortSignal.timeout(20_000) }).then((r) => { clearTimeout(t); ok(r); }, (e: unknown) => { clearTimeout(t); fail(e); });
  });
}

const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) && v >= 0 ? Math.min(Math.floor(v), 1e9) : 0);
const iso = (v: unknown) => { const t = typeof v === "string" ? Date.parse(v) : NaN; return Number.isFinite(t) ? new Date(t).toISOString() : null; };

/** One search result as a candidate, or null when it is not a plain public repo. */
export function fromRepo(it: unknown): Candidate | null {
  if (!it || typeof it !== "object") return null;
  const r = it as Record<string, unknown>;
  const full = typeof r.full_name === "string" ? r.full_name : "";
  if (!/^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})\/[A-Za-z0-9_.-]{1,100}$/.test(full) || full.includes("..")) return null;
  if (r.fork === true || r.archived === true || r.private === true) return null;
  const owner = full.split("/")[0]!;
  const raw = typeof r.description === "string" ? r.description : "";
  const description = clean(raw, 280);
  const topics = (Array.isArray(r.topics) ? r.topics : []).filter((t): t is string => typeof t === "string" && /^[a-z0-9][a-z0-9-]{0,49}$/.test(t)).slice(0, 20);
  return {
    source: "github", key: `github:${full.toLowerCase()}`, url: `https://github.com/${full}`, name: full, org: owner.toLowerCase(),
    description, topics, pushedAt: iso(r.pushed_at), stars: num(r.stargazers_count), openIssues: num(r.open_issues_count),
    address: null, repo: null, flags: injectionLike(raw) || injectionLike(description) ? ["instruction-like text"] : [],
  };
}

export type GithubResult = { candidates: Candidate[]; errors: string[]; limited: { until: number | null; hard: boolean } | null; calls: number };

/** When GitHub says we may try again: Retry-After, or the rate-limit reset time. */
function retryAt(r: Response, now: number): number | null {
  const ra = Number(r.headers.get("retry-after"));
  if (Number.isFinite(ra) && ra > 0) return now + ra * 1000;
  const reset = Number(r.headers.get("x-ratelimit-reset"));
  if (Number.isFinite(reset) && reset > 0) return Math.max(now + MIN, reset * 1000);
  return null;
}

/** Repositories pushed in the last 30 days matching the queries. Stops at the first 403/429 or an empty quota. */
export async function searchGithub(fetch: Fetch, queries: readonly string[], now: number, token = ""): Promise<GithubResult> {
  const since = new Date(now - 30 * DAY).toISOString().slice(0, 10);
  const headers: Record<string, string> = { accept: "application/vnd.github+json", "user-agent": "nightshift-recruiter", "x-github-api-version": "2022-11-28" };
  if (token) headers.authorization = `Bearer ${token}`;
  const out = new Map<string, Candidate>();
  const errors: string[] = [];
  let limited: GithubResult["limited"] = null, calls = 0;
  for (const q of queries.slice(0, 10)) {
    const url = `${GITHUB_API}/search/repositories?q=${encodeURIComponent(`${q} pushed:>=${since} fork:false archived:false`)}&sort=updated&order=desc&per_page=20`;
    let r: Response;
    try { calls++; r = await get(fetch, url, headers); } catch (e) { errors.push(`GitHub search failed: ${(e as Error)?.message ?? e}`); continue; }
    if (r.status === 403 || r.status === 429) { limited = { until: retryAt(r, now), hard: true }; break; }
    if (!r.ok) { errors.push(`GitHub search answered ${r.status}`); continue; }
    const j = (await r.json().catch(() => null)) as { items?: unknown } | null;
    for (const it of Array.isArray(j?.items) ? (j!.items as unknown[]).slice(0, 30) : []) {
      const c = fromRepo(it);
      if (!c) continue;
      const had = out.get(c.key);
      out.set(c.key, had ? { ...had, topics: [...new Set([...had.topics, ...c.topics])].slice(0, 20) } : c);
    }
    if (r.headers.get("x-ratelimit-remaining") === "0") { limited = { until: retryAt(r, now), hard: false }; break; }
  }
  return { candidates: [...out.values()], errors, limited, calls };
}

const CHAIN: Record<number, string> = { 1: "Ethereum", 4663: "Robinhood Chain", 11155111: "Sepolia" };

/** Builders who just launched on IMD: launches from the last 30 days that are not parked or failed. */
export async function imdLaunches(fetch: Fetch, now: number): Promise<Candidate[]> {
  const r = await get(fetch, `${IMD_API}/launches?limit=50`);
  if (!r.ok) throw new Error(`IMD launches answered ${r.status}`);
  const j = (await r.json().catch(() => null)) as { launches?: unknown } | null;
  const out: Candidate[] = [];
  for (const row of Array.isArray(j?.launches) ? (j!.launches as unknown[]).slice(0, 50) : []) {
    if (!row || typeof row !== "object") continue;
    const l = row as Partial<LaunchRow>;
    const n = Number(l.launchNumber);
    if (!Number.isInteger(n) || n <= 0 || n > 10_000_000) continue;
    if (typeof l.id !== "string" || !/^[0-9a-f-]{36}$/i.test(l.id)) continue;
    const created = Date.parse(String(l.createdAt));
    if (!Number.isFinite(created) || created < now - 30 * DAY) continue;
    const status = clean(l.status, 30).toLowerCase().replace(/[^a-z_ -]/g, "");
    if (/park|fail|reject|cancel|refund/.test(status)) continue;
    const kind = clean(l.kind, 40).toLowerCase().replace(/[^a-z0-9_-]/g, "");
    const token = Array.isArray(l.artifacts) ? l.artifacts.find((a) => a && typeof a === "object" && a.role === "token") : undefined;
    const address = isAddress(token?.address) ? token!.address.toLowerCase() : null;
    const m = typeof l.sourceRepoUrl === "string" ? l.sourceRepoUrl.match(/^https:\/\/github\.com\/([A-Za-z0-9][A-Za-z0-9-]{0,38})\/([A-Za-z0-9_-][A-Za-z0-9_.-]{0,99}?)(?:\.git)?\/?$/) : null;
    const chain = CHAIN[Number(l.chainId)] ?? "";
    out.push({
      source: "imd", key: `imd:${n}`, url: `${IMD_API}/launches/${l.id.toLowerCase()}`, name: `IMD launch #${n}`, org: `imd-launch-${n}`,
      description: clean(`IMD launch #${n}: ${kind || "launch"}, ${status || "status unknown"}${chain ? `, on ${chain}` : ""}${address ? ", token deployed" : ""}`, 280),
      topics: ["imd", ...(kind ? [kind] : [])], pushedAt: new Date(created).toISOString(), stars: 0, openIssues: 0,
      address, repo: m ? `https://github.com/${m[1]}/${m[2]}` : null, flags: [],
    });
  }
  return out;
}
