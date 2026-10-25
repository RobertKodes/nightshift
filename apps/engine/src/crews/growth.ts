import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { writeAtomic } from "../atomic.js";
import { config } from "../config.js";
import type { WatchReport } from "../watchtower/index.js";
import { type BuildCheckReport, buildCheck, parseTarget } from "./buildcheck.js";
import { crewLedger, crewProfiles, liveWatchtower } from "./live.js";

/**
 * Where the crews meet people who are not on the website yet: three bot commands in the community
 * chat, Watchtower watching the IMD market's own tokens in public (real changes posted with their
 * evidence), and a README badge any builder can embed with a live Build & Check result. Every job here
 * is a real run of the crew's service; the public monitoring is NIGHTSHIFT's own and is not counted as
 * customer work anywhere.
 */
type Button = { text: string; url: string };
type Reply = { text: string; buttons?: Button[][] };
const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const short = (a: string) => `${a.slice(0, 6)}…${a.slice(-4)}`;
const val = (v: unknown) => esc(String(typeof v === "string" ? v : JSON.stringify(v) ?? "none").slice(0, 48));
const SHIFT = "0xe5e58e53d0bb204aa62c995a6c8cc8a48e60c3ac";

/** A daily allowance for one bot command, across every chat (the bot is not told who asked). */
function quota(max: number) {
  let day = "", n = 0;
  return () => { const d = new Date().toISOString().slice(0, 10); if (d !== day) { day = d; n = 0; } if (n >= max) return false; n++; return true; };
}
const watchQuota = quota(60), checkQuota = quota(30);

/** A Watchtower report as one Telegram message: what changed, with before and after, and what could not run. */
export function watchMessage(r: WatchReport): string {
  const lines = [`🛰 <b>Watchtower</b> · <code>${esc(r.address)}</code> (${r.kind})`, esc(r.summary)];
  if (r.changes.length) { lines.push(""); for (const c of r.changes.slice(0, 5)) lines.push(`• <b>${esc(c.field)}</b> (${c.severity}): ${val(c.before)} → ${val(c.after)}`); }
  if (r.unavailable.length) lines.push(`⚠️ Could not check now: ${esc(r.unavailable.map((u) => u.label).slice(0, 4).join(", "))}`);
  if (r.stale) lines.push("⚠️ A source did not answer: this is not an all-clear.");
  lines.push("", "<i>Coverage is not a probability that a token is safe or profitable.</i>");
  return lines.join("\n");
}

/** /watchtower <token or v4 hook address>: the free check, right in the chat. */
export async function telegramWatchtower(args: string[]): Promise<Reply> {
  const a = (args[0] ?? "").trim();
  const page = `${config.publicUrl}/watchtower`;
  if (!/^0x[0-9a-fA-F]{40}$/.test(a)) return { text: `🛰 <b>Watchtower</b>\nWhat changed on an Ethereum token or Uniswap v4 hook since the last look: owner, upgrades, fees, pause, supply and liquidity, with block evidence.\n\nTry: <code>/watchtower ${SHIFT}</code>`, buttons: [[{ text: "🛰 Open Watchtower", url: page }]] };
  const wt = liveWatchtower();
  if (!wt) return { text: "🛰 Watchtower is starting. Try again in a minute." };
  if (!watchQuota()) return { text: "🛰 The chat's free checks for today are used. Run it free on the website, or let an agent pay $0.05 a check.", buttons: [[{ text: "🛰 Open Watchtower", url: `${page}?address=${a}` }]] };
  const l = crewLedger(), job = l.start({ crew: "watchtower", operator: "house", kind: "watch.telegram", free: true });
  try {
    const r = await wt.check(a);
    l.done(job.id, { summary: `Telegram check: ${r.changes.length} change${r.changes.length === 1 ? "" : "s"}, ${r.unavailable.length} unavailable` });
    return { text: watchMessage(r), buttons: [[{ text: "📄 Full report", url: `${page}?address=${a}` }, { text: "⏱ Watch it 7 days", url: page }]] };
  } catch (e) {
    l.fail(job.id, "the check could not run");
    return { text: `🛰 Watchtower could not check ${short(a)} right now: ${esc((e as Error).message).slice(0, 160)}` };
  }
}

/** /buildcheck <https url>: the free quick check of an agent service. */
export async function telegramBuildcheck(args: string[]): Promise<Reply> {
  const u = (args[0] ?? "").trim();
  const page = `${config.publicUrl}/crews/buildcheck`;
  if (!u.startsWith("https://")) return { text: "🧪 <b>Build &amp; Check</b>\nDoes your agent service work for other agents? Reachability, MCP initialize and tools/list, the x402 payment terms. Each check comes with the command to rerun it.\n\nTry: <code>/buildcheck https://getnightshift.tech/mcp/public</code>", buttons: [[{ text: "🧪 Open Build & Check", url: page }]] };
  if (!checkQuota()) return { text: "🧪 The chat's free checks for today are used. Run it on the website.", buttons: [[{ text: "🧪 Open Build & Check", url: page }]] };
  const l = crewLedger(), job = l.start({ crew: "buildcheck", operator: "house", kind: "buildcheck.telegram", free: true });
  try {
    const r = await buildCheck(u, {}, "quick");
    l.done(job.id, { summary: `Telegram check: ${r.summary.text}` });
    const icon = { pass: "✅", warn: "⚠️", fail: "❌", unavailable: "❔" } as const;
    const lines = [`🧪 <b>Build &amp; Check</b> · ${esc(r.origin)}`, esc(r.summary.text), "", ...r.checks.map((c) => `${icon[c.status]} <b>${esc(c.label)}</b>: ${esc(c.detail).slice(0, 140)}`)];
    return { text: lines.join("\n"), buttons: [[{ text: "🏷 Get the README badge", url: `${page}?badge=${encodeURIComponent(u)}` }]] };
  } catch (e) {
    l.fail(job.id, "the check could not run");
    return { text: `🧪 Build &amp; Check could not run: ${esc((e as Error).message).slice(0, 160)}` };
  }
}

/** /crews: who does the work, with their measured results. */
export function telegramCrews(): Reply {
  const lines = ["👥 <b>NIGHTSHIFT crews</b>", "AI agents that each sell one service, to people and agents, paid per job over x402.", ""];
  for (const c of crewProfiles()) {
    const m = c.metrics, from = c.pricing.length ? `from $${Math.min(...c.pricing.map((p) => p.usd))}` : "free sample";
    lines.push(`• <b>${esc(c.name)}</b> (${c.operator.kind === "house" ? "operated by NIGHTSHIFT" : "outside crew"}): ${esc(c.service).slice(0, 110)} · ${from} · ${m.done} jobs done`);
  }
  return { text: lines.join("\n"), buttons: [[{ text: "👥 The crews", url: `${config.publicUrl}/crews` }, { text: "🤖 Connect an agent", url: `${config.publicUrl}/agents/start` }]] };
}

// ------------------------------------------------------------------ the README badge

const badgeCache = new Map<string, { at: number; r: BuildCheckReport | null }>();
let badgeRuns: number[] = [];
/**
 * An SVG badge with a live quick Build & Check result for one https URL, cached 6 hours. New URLs are
 * checked at most 30 times an hour in total; past that the badge says "checking" and tries later.
 */
export async function buildcheckBadge(url: string): Promise<{ svg: string; status: number }> {
  let target: string;
  try { target = parseTarget(url).toString(); } catch { return { svg: badgeSvg("agent check", "bad url", "#9f9f9f"), status: 400 }; }
  const hit = badgeCache.get(target), now = Date.now();
  let r = hit && now - hit.at < 6 * 3_600_000 ? hit.r : undefined;
  if (r === undefined) {
    badgeRuns = badgeRuns.filter((t) => now - t < 3_600_000);
    if (badgeRuns.length >= 30) return { svg: badgeSvg("agent check", "checking", "#9f9f9f"), status: 200 };
    badgeRuns.push(now);
    r = await buildCheck(target, {}, "quick").catch(() => null);
    if (badgeCache.size > 2000) badgeCache.clear();
    badgeCache.set(target, { at: now, r });
  }
  if (!r) return { svg: badgeSvg("agent check", "unreachable", "#e05d44"), status: 200 };
  const s = r.summary, color = s.fail ? "#e05d44" : s.warn || s.unavailable ? "#dfb317" : "#44cc11";
  return { svg: badgeSvg("NIGHTSHIFT check", `${s.pass}/${s.checks} pass`, color), status: 200 };
}
function badgeSvg(left: string, right: string, color: string): string {
  const w = (t: string) => 10 + t.length * 6.6, lw = w(left), rw = w(right);
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${lw + rw}" height="20" role="img" aria-label="${left}: ${right}"><title>${left}: ${right}</title><rect width="${lw}" height="20" fill="#2b2140"/><rect x="${lw}" width="${rw}" height="20" fill="${color}"/><g fill="#fff" font-family="Verdana,DejaVu Sans,sans-serif" font-size="11"><text x="${lw / 2}" y="14" text-anchor="middle">${left}</text><text x="${lw + rw / 2}" y="14" text-anchor="middle">${right}</text></g></svg>`;
}

// ------------------------------------------------------------------ Watchtower on the IMD market, in public

type PublicState = { posted: string[]; postedDay: string; postsToday: number; lastRun: number };
/**
 * Every 2 hours, Watchtower looks at the tradable IMD tokens (NIGHTSHIFT's own monitoring, not a
 * customer job) and posts material changes to the community chat: high or critical severity only,
 * each change once, at most 3 posts a day, every post with its before and after values and evidence.
 */
export class PublicWatch {
  #st: PublicState;
  #busy = false;
  constructor(private readonly o: { file: string; tokens(): Promise<{ address: string; symbol: string; launch: number | null }[]>; post(text: string, buttons: Button[][]): Promise<boolean>; everyMs?: number; now?: () => number }) {
    let st: PublicState = { posted: [], postedDay: "", postsToday: 0, lastRun: 0 };
    if (existsSync(o.file)) try { st = { ...st, ...(JSON.parse(readFileSync(o.file, "utf8")) as PublicState) }; } catch { /* start over */ }
    this.#st = st;
  }
  #save() { try { writeAtomic(this.o.file, JSON.stringify(this.#st)); } catch { /* best effort */ } }
  async tick(): Promise<{ checked: number; posted: number } | null> {
    const now = (this.o.now ?? Date.now)(), every = this.o.everyMs ?? 2 * 3_600_000;
    if (this.#busy || now - this.#st.lastRun < every) return null;
    const wt = liveWatchtower();
    if (!wt) return null;
    this.#busy = true;
    try {
      this.#st.lastRun = now; this.#save();
      const day = new Date(now).toISOString().slice(0, 10);
      if (this.#st.postedDay !== day) { this.#st.postedDay = day; this.#st.postsToday = 0; }
      const tokens = (await this.o.tokens().catch(() => [])).slice(0, 25);
      let checked = 0, posted = 0;
      for (const t of tokens) {
        const r = await wt.check(t.address).catch(() => null);
        if (!r) continue;
        checked++;
        const big = r.changes.filter((c) => c.severity === "high" || c.severity === "critical");
        if (!big.length || r.stale) continue;
        const key = createHash("sha256").update(`${t.address}:${big.map((c) => `${c.id ?? c.field}=${JSON.stringify(c.after)}`).join("|")}`).digest("hex").slice(0, 20);
        if (this.#st.posted.includes(key) || this.#st.postsToday >= 3) continue;
        const name = `$${esc(t.symbol)}${t.launch ? ` (IMD #${t.launch})` : ""}`;
        const lines = [`🛰 <b>Watchtower spotted a change</b> · ${name}`, "", ...big.slice(0, 4).map((c) => `• <b>${esc(c.field)}</b> (${c.severity}): ${val(c.before)} → ${val(c.after)}, between block ${c.beforeBlock} and ${c.afterBlock}`), "", `Evidence: <a href="https://etherscan.io/address/${t.address}">Etherscan</a>${big[0]!.evidence[0] ? ` · <a href="${esc(big[0]!.evidence[0]!)}">source</a>` : ""}`, "Check any token free: <code>/watchtower &lt;address&gt;</code>", "<i>A change is not a verdict on the token: it is what changed, with the evidence.</i>"];
        if (await this.o.post(lines.join("\n"), [[{ text: "🛰 Full report", url: `${config.publicUrl}/watchtower?address=${t.address}` }]]).catch(() => false)) {
          this.#st.posted = [...this.#st.posted, key].slice(-500); this.#st.postsToday++; posted++; this.#save();
        }
      }
      return { checked, posted };
    } finally { this.#busy = false; }
  }
}
export const publicWatchFile = () => join(config.dataDir, "public-watch.json");
