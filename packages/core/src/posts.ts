import type { Channel, ChannelKind, Company, Post, PostFact, QuietHours } from "./types.js";
import { fromUsdc } from "./types.js";

/**
 * What a company may say on the accounts its owner connected, and when. Posts are about real events
 * only, built from the company's records and books, never from numbers the model wrote; each one says
 * an AI agent wrote it; each channel has a daily cap, a gap between posts and the owner's quiet hours;
 * and the owner approves the first post on every channel (or every post, if they ask).
 */

const DAY = 24 * 60 * 60 * 1000;

/** The longest post each platform takes (Bluesky counts graphemes; this counts code units, so it stays under). */
export const POST_LIMIT: Record<ChannelKind, number> = { bluesky: 300, mastodon: 500, telegram: 4096, discord: 2000 };

/** The most posts a day an owner may allow on each platform, and the least time between two: safe defaults per platform. */
export const CHANNEL_CAPS: Record<ChannelKind, { max: number; gapMinutes: number }> = {
  bluesky: { max: 3, gapMinutes: 120 },
  mastodon: { max: 2, gapMinutes: 180 },
  telegram: { max: 2, gapMinutes: 0 },
  discord: { max: 1, gapMinutes: 0 },
};

export const CHANNEL_NAME: Record<ChannelKind, string> = { bluesky: "Bluesky", telegram: "Telegram", mastodon: "Mastodon", discord: "Discord" };
export const CHANNELS: ChannelKind[] = ["bluesky", "telegram", "mastodon", "discord"];

/** One post a day per channel and nothing at night, until the owner says otherwise. */
export const DEFAULT_DAILY = 1;
export const DEFAULT_QUIET: QuietHours = { from: 22, to: 8, tz: "UTC" };

/** The line every post ends with. */
export const disclosure = (company: string) => `Posted by an AI agent for ${company}.`;

/** Every number in a text, links left out: "$1,250.50" reads as 1250.5. */
export function numbersIn(text: string): number[] {
  return [...text.replace(/https?:\/\/\S+/g, " ").matchAll(/\d[\d,]*(?:\.\d+)?/g)]
    .map((m) => Number(m[0].replace(/,/g, "")))
    .filter((n) => Number.isFinite(n));
}

/** A link to the company's own page carries the channel it was posted on, so visits can be counted by channel. */
export function tagged(link: string, ch: ChannelKind): string {
  try {
    const u = new URL(link);
    if (!u.pathname.startsWith("/c/")) return link;
    u.searchParams.set("via", ch);
    return u.toString();
  } catch { return link; }
}

/**
 * The CEO's own words for a post, kept only when they add no number the facts do not have, no link
 * (links come from the records), no @mention (it never addresses people) and no hashtag.
 */
export function checkAngle(angle: string | null | undefined, f: PostFact): { ok: true; text: string } | { ok: false; why: string } {
  const a = (angle ?? "").replace(/\s+/g, " ").trim();
  if (!a) return { ok: true, text: "" };
  if (a.length > 180) return { ok: false, why: "longer than 180 characters" };
  if (/https?:\/\/|www\.|\b[a-z0-9-]+\.(com|io|app|xyz|net|org|tech|fun)\b/i.test(a)) return { ok: false, why: "it had a link; links come from the records only" };
  if (/(^|\s)@\w/.test(a)) return { ok: false, why: "it mentioned someone; posts never address people" };
  if (/(^|\s)#\w/.test(a)) return { ok: false, why: "it had a hashtag" };
  const extra = numbersIn(a).filter((n) => !f.numbers.includes(n));
  if (extra.length) return { ok: false, why: `it said ${extra[0]}, a number that is not in the company's books` };
  return { ok: true, text: a };
}

/** True when every number in the post (outside its links) is one the facts or the company's own name carry. */
export function onlyFacts(text: string, f: PostFact, company: string): boolean {
  const allowed = new Set([...f.numbers, ...numbersIn(company)]);
  return numbersIn(text).every((n) => allowed.has(n));
}

/**
 * The post for one channel: the words (the CEO's checked angle, then the facts), the link, and the
 * disclosure on its own line. Too long, the words are cut at a word, never a number, the link or the disclosure.
 */
export function composePost(company: string, f: PostFact, ch: ChannelKind, angle?: string | null): string {
  const a = checkAngle(angle, f);
  const words = [a.ok ? a.text : "", f.text].filter(Boolean).join(" ");
  const tail = `\n${tagged(f.link, ch)}\n\n${disclosure(company)}`;
  const room = POST_LIMIT[ch] - tail.length;
  const body = words.length <= room ? words : `${words.slice(0, Math.max(0, room - 1)).replace(/\s+\S*$/, "").trimEnd()}…`;
  return `${body}${tail}`;
}

/** What the books say, counted from the ledger: sales to people and outside agents (USDC over x402) and on Gumroad. B2B is never in it. */
export interface Books { sales: number; gumroad: number }

const MILESTONES = [1, 10, 25, 50, 100, 250, 500, 1000, 2500, 5000, 10000];
const RECENT = 14 * DAY;

/**
 * The real events a company may post about, newest kind first: a product that went on sale, a sales
 * milestone the books passed, an update (the site, a new price) and a shift worth replaying. Every
 * word and number comes from the company's records; a pitch with numbers in it is left out, since
 * the CEO wrote it.
 */
export function postFacts(c: Company, books: Books, base: string, now = Date.now()): PostFact[] {
  const out: PostFact[] = [];
  const page = `${base}/c/${c.slug}`;
  const price = (v: bigint) => `$${fromUsdc(v).toFixed(2)}`;
  const fact = (x: Omit<PostFact, "numbers">): PostFact => ({ ...x, numbers: numbersIn(x.text) });
  const pitch = (s: string) => (/\d/.test(s) ? "" : ` ${s.trim().replace(/([^.!?])$/, "$1.")}`);
  for (const p of c.products.filter((x) => x.status === "live" && now - x.createdAt < RECENT).sort((a, b) => b.createdAt - a.createdAt)) {
    out.push(fact({ key: `product:${p.id}`, kind: "new_product", title: `New product: ${p.name}`, text: `New from ${c.name}: ${p.name}.${pitch(p.pitch)} ${price(p.priceUsdc)}, paid in USDC by people and AI agents alike.`, link: `${page}#${p.id}`, productId: p.id }));
  }
  const total = books.sales + books.gumroad;
  const m = [...MILESTONES].reverse().find((x) => total >= x);
  if (m) out.push(fact({ key: `sales:${m}`, kind: "sales_milestone", title: m === 1 ? "The first sale" : `${m} sales`, text: m === 1 ? `${c.name} made its first sale. Thank you to the buyer.` : `${c.name} has passed ${m} sales. Thank you to every buyer.`, link: page }));
  const done = [...c.tasks].reverse().filter((t) => t.status === "done" && now - t.updatedAt < RECENT);
  const site = done.find((t) => (t.kind === "build_site" || t.kind === "improve_site") && t.imd?.jobId);
  if (site && c.site) out.push(fact({ key: `site:${site.imd!.jobId}`, kind: "update", title: site.kind === "build_site" ? "The website is live" : "The website changed", text: site.kind === "build_site" ? `${c.name} has a website now, built by the IMD agent swarm.` : `${c.name} updated its website, with the IMD agent swarm.`, link: c.site.url, taskId: site.id }));
  const repriced = done.find((t) => t.kind === "reprice" && now - t.updatedAt < 3 * DAY);
  const rp = repriced && c.products.find((p) => p.status === "live" && p.id === repriced.productId);
  if (rp) out.push(fact({ key: `price:${rp.id}:${rp.priceUsdc}`, kind: "update", title: `New price for ${rp.name}`, text: `${rp.name} from ${c.name} is now ${price(rp.priceUsdc)}.`, link: `${page}#${rp.id}`, productId: rp.id, taskId: repriced.id }));
  const shift = done.find((t) => ["research", "build_product", "build_site", "improve_site"].includes(t.kind) && now - t.updatedAt < 3 * DAY);
  if (shift) out.push(fact({ key: `shift:${shift.id}`, kind: "replay", title: `Replay of shift ${shift.cycle}`, text: `Shift ${shift.cycle} at ${c.name}: ${shift.title}. Every step the AI CEO and the IMD swarm took is on the record, with what it cost.`, link: `${page}?shift=${shift.id}`, taskId: shift.id }));
  return out;
}

/** Facts some connected channel has not carried yet (each fact goes out at most once per channel, whatever came of it). */
export function unposted(c: Company, facts: PostFact[]): PostFact[] {
  const conn = c.connections;
  const open = Object.values(conn?.channels ?? {}).filter((ch): ch is Channel => Boolean(ch && !ch.paused));
  return facts.filter((f) => open.some((ch) => !conn!.posts.some((p) => p.channel === ch.kind && p.factKey === f.key)));
}

/** Why a post on this channel waits for the owner, or null when it may go out on its own. */
export function approvalNeeded(ch: Channel): string | null {
  if (ch.approveEach) return "you approve every post on this channel";
  if (!ch.trusted) return "the first post on a channel waits for you";
  return null;
}

/** The hour (0 to 23) at a moment in a time zone; UTC when the zone is unknown. */
export function hourIn(at: number, tz: string): number {
  try { return Number(new Intl.DateTimeFormat("en-GB", { hour: "numeric", hourCycle: "h23", timeZone: tz }).format(at)) % 24; } catch { return new Date(at).getUTCHours(); }
}

export function inQuiet(at: number, q: QuietHours): boolean {
  if (q.from === q.to) return false;
  const h = hourIn(at, q.tz);
  return q.from < q.to ? h >= q.from && h < q.to : h >= q.from || h < q.to;
}

/** When the quiet hours around `at` end (within five minutes). */
export function quietEnds(at: number, q: QuietHours): number {
  let t = at;
  for (let i = 0; i <= 24 * 12 && inQuiet(t, q); i++) t += 5 * 60_000;
  return t;
}

export function validQuiet(q: Partial<QuietHours>): QuietHours {
  const from = Number(q.from), to = Number(q.to), tz = String(q.tz ?? "UTC").trim() || "UTC";
  if (!Number.isInteger(from) || from < 0 || from > 23 || !Number.isInteger(to) || to < 0 || to > 23) throw new Error("Quiet hours are whole hours from 0 to 23.");
  try { new Intl.DateTimeFormat("en-GB", { timeZone: tz }); } catch { throw new Error(`Unknown time zone: ${tz.slice(0, 40)}`); }
  return { from, to, tz };
}

export type Gate = { go: true } | { go: false; wait: "paused" | "quiet" | "cap" | "gap"; why: string; until: number | null };

/** Whether a post may go out on this channel now: not paused, outside the quiet hours, under the daily cap, past the gap. */
export function sendGate(ch: Channel, posts: Post[], quiet: QuietHours, now: number): Gate {
  const name = CHANNEL_NAME[ch.kind];
  if (ch.paused) return { go: false, wait: "paused", why: `${name} is paused: ${ch.paused.why}`, until: null };
  if (inQuiet(now, quiet)) return { go: false, wait: "quiet", why: `quiet hours until ${String(quiet.to).padStart(2, "0")}:00 (${quiet.tz})`, until: quietEnds(now, quiet) };
  const sent = posts.filter((p) => p.channel === ch.kind && p.status === "posted" && p.sentAt !== undefined && now - p.sentAt < DAY).sort((a, b) => a.sentAt! - b.sentAt!);
  const max = Math.max(1, Math.min(ch.dailyMax, CHANNEL_CAPS[ch.kind].max));
  if (sent.length >= max) return { go: false, wait: "cap", why: `${max} post${max === 1 ? "" : "s"} a day on ${name}`, until: sent[sent.length - max]!.sentAt! + DAY };
  const gap = CHANNEL_CAPS[ch.kind].gapMinutes * 60_000;
  const last = sent.at(-1);
  if (gap && last && now - last.sentAt! < gap) return { go: false, wait: "gap", why: `at least ${gap / 3600_000} hours between posts on ${name}`, until: last.sentAt! + gap };
  return { go: true };
}

/** Posts waiting on one channel, at most: a CEO never piles up a backlog. */
export const MAX_WAITING = 3;

/**
 * The posts for one fact: one per connected channel that has not carried it, held for the owner
 * where the rules say so. Nothing goes on a paused channel or one with a backlog.
 */
export function planPosts(c: Company, f: PostFact, angle: string | null | undefined, now: number, id: () => string, taskId?: string): Post[] {
  const conn = c.connections;
  if (!conn) return [];
  const out: Post[] = [];
  for (const kind of CHANNELS) {
    const ch = conn.channels[kind];
    if (!ch || ch.paused) continue;
    if (conn.posts.some((p) => p.channel === kind && p.factKey === f.key)) continue;
    if (conn.posts.filter((p) => p.channel === kind && (p.status === "approval" || p.status === "queued")).length >= MAX_WAITING) continue;
    const ask = approvalNeeded(ch);
    out.push({ id: id(), at: now, channel: kind, factKey: f.key, factKind: f.kind, about: f.title, text: composePost(c.name, f, kind, angle), status: ask ? "approval" : "queued", ...(ask ? { wait: ask } : {}), ...(taskId ? { taskId } : {}) });
  }
  return out;
}
