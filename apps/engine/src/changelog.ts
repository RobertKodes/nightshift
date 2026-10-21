import { appendFileSync, existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { writeAtomic } from "./atomic.js";
import { chats } from "./community.js";
import { config } from "./config.js";
import { seasonStartOf } from "./league.js";
import { esc, kb, tgCall } from "./social.js";

/**
 * The changelog: docs/CHANGELOG.md, newest first, one entry per shipped update ("## YYYY-MM-DD ·
 * Title" and one to three "- " lines). The site shows it at /changelog (and /changelog.md, and in
 * llms.txt); every Monday at 09:00 UTC the bot posts the past week's entries to the community chat
 * and pins that message, unpinning last week's. Once a week at most; off with CHANGELOG_POST=0;
 * in sim mode it only writes to data/changelog-dryrun.log.
 */
export type Entry = { date: string; title: string; lines: string[] };
const FILE = fileURLToPath(new URL("../../../docs/CHANGELOG.md", import.meta.url));
const DAY = 86_400_000;

/** Every entry of the file, in its order (newest first). A heading without a date is not an entry. */
export function parseChangelog(md: string): Entry[] {
  const out: Entry[] = [];
  let cur: Entry | null = null;
  for (const raw of md.replace(/\r\n/g, "\n").split("\n")) {
    const line = raw.trim();
    const h = /^##\s+(\d{4}-\d{2}-\d{2})\s*[·:-]\s*(.+)$/.exec(line);
    if (h) { cur = { date: h[1]!, title: h[2]!.trim(), lines: [] }; out.push(cur); continue; }
    if (/^#/.test(line)) { cur = null; continue; }
    const item = /^[-*]\s+(.+)$/.exec(line);
    if (item && cur && cur.lines.length < 3) cur.lines.push(item[1]!.trim());
  }
  return out;
}

let cache: { at: number; entries: Entry[]; md: string } | null = null;
/** The file as it is on disk (read again at most once a minute), and its entries. */
export function changelog(file = FILE): { md: string; entries: Entry[] } {
  if (cache && Date.now() - cache.at < 60_000 && file === FILE) return cache;
  let md = "";
  try { md = readFileSync(file, "utf8"); } catch { md = ""; }
  const v = { at: Date.now(), md, entries: parseChangelog(md) };
  if (file === FILE) cache = v;
  return v;
}

/** The entries dated in the week before `weekStart` (a Monday 00:00 UTC): Monday to Sunday. */
export function weekEntries(entries: Entry[], weekStart: number): Entry[] {
  const from = new Date(weekStart - 7 * DAY).toISOString().slice(0, 10), to = new Date(weekStart).toISOString().slice(0, 10);
  return entries.filter((e) => e.date >= from && e.date < to);
}

const short = (d: string) => new Date(`${d}T00:00:00Z`).toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "UTC" });
/** The weekly post: every entry with its lines, or only the titles when that is too long for one message. */
export function weekCard(entries: Entry[], weekStart: number, base = config.publicUrl): { text: string; buttons: { text: string; url: string }[][] } | null {
  if (!entries.length) return null;
  const range = `${short(new Date(weekStart - 7 * DAY).toISOString().slice(0, 10))} to ${short(new Date(weekStart - DAY).toISOString().slice(0, 10))}`;
  const head = [`🛠 <b>THIS WEEK ON NIGHTSHIFT</b> · ${range}`, `<i>${entries.length} update${entries.length === 1 ? "" : "s"} shipped, from the changelog.</i>`, ""];
  const foot = ["", `📜 Every update: ${base}/changelog`];
  const full = entries.map((e) => [`<b>${esc(e.title)}</b> · ${short(e.date)}`, ...e.lines.map((l) => `• ${esc(l)}`)].join("\n")).join("\n\n");
  const titles = entries.map((e) => `• <b>${esc(e.title)}</b> · ${short(e.date)}`);
  let body = full;
  if ([...head, body, ...foot].join("\n").length > 3800) {
    // titles only, as many as fit
    const kept: string[] = [];
    for (const t of titles) { if ([...head, ...kept, t, "…", ...foot].join("\n").length > 3700) break; kept.push(t); }
    body = [...kept, ...(kept.length < titles.length ? [`…and ${titles.length - kept.length} more on the changelog page.`] : [])].join("\n");
  }
  return { text: [...head, body, ...foot].join("\n"), buttons: [[{ text: "📜 The full changelog", url: `${base}/changelog` }]] };
}

type State = { lastWeek?: number; pinned?: Record<string, number> };
export type ChangelogOptions = {
  entries?: () => Entry[]; now?: () => number; file?: string | null; dryRun?: string | null;
  mode?: () => "live" | "sim"; on?: () => boolean; token?: () => string; chats?: () => string[];
};

/** Mondays at 09:00 UTC: the past week's entries to the community chat, pinned, last week's unpinned. */
export class WeeklyChangelog {
  private s: State;
  constructor(private o: ChangelogOptions = {}) {
    let s: State = {};
    try { if (o.file && existsSync(o.file)) s = JSON.parse(readFileSync(o.file, "utf8")); } catch { s = {}; }
    this.s = s;
  }
  private save() { if (this.o.file) writeAtomic(this.o.file, JSON.stringify(this.s)); }
  async tick(): Promise<"off" | "wait" | "empty" | "dry-run" | "sent" | "failed"> {
    if (!(this.o.on ?? (() => config.changelogPost))()) return "off";
    const now = (this.o.now ?? Date.now)(), d = new Date(now), week = seasonStartOf(now);
    if (d.getUTCDay() !== 1 || d.getUTCHours() !== 9 || this.s.lastWeek === week) return "wait";
    // the week is taken first: a crash or a retry never posts it twice
    this.s.lastWeek = week; this.save();
    const card = weekCard(weekEntries((this.o.entries ?? (() => changelog().entries))(), week), week);
    if (!card) { console.log("weekly changelog: no entries last week, nothing posted"); return "empty"; }
    if ((this.o.mode ?? (() => config.mode))() !== "live") {
      if (this.o.dryRun) appendFileSync(this.o.dryRun, `--- ${d.toISOString()} (sim mode: not posted, not pinned)\n${card.text}\n\n`);
      return "dry-run";
    }
    const token = (this.o.token ?? (() => config.telegramToken))(), to = (this.o.chats ?? chats)();
    if (!token || !to.length) return "failed";
    let any = false;
    for (const chat of to) {
      const m = await tgCall<{ message_id: number }>(token, "sendMessage", { chat_id: chat, text: card.text, parse_mode: "HTML", link_preview_options: { is_disabled: true }, reply_markup: kb(card.buttons) });
      if (!m) continue;
      any = true;
      // the bot's admin rights: pin this week's, then take last week's down (a failed pin keeps the old one up)
      const pinned = await tgCall(token, "pinChatMessage", { chat_id: chat, message_id: m.message_id, disable_notification: true });
      const old = this.s.pinned?.[chat];
      if (pinned && old && old !== m.message_id) await tgCall(token, "unpinChatMessage", { chat_id: chat, message_id: old });
      if (pinned) (this.s.pinned ??= {})[chat] = m.message_id;
    }
    this.save();
    return any ? "sent" : "failed";
  }
}

/** The live weekly post, checked every minute. */
export function startChangelog(): WeeklyChangelog {
  const w = new WeeklyChangelog({ file: join(config.dataDir, "changelog.json"), dryRun: join(config.dataDir, "changelog-dryrun.log") });
  setInterval(() => void w.tick().catch((e) => console.error("changelog", (e as Error).message)), 60_000).unref();
  return w;
}
