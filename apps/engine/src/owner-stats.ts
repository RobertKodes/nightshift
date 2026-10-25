import { existsSync, readFileSync } from "node:fs";
import { writeAtomic } from "./atomic.js";
import type { CrewEvent } from "./crews/contracts.js";
import type { Usage } from "./usage.js";

/**
 * The owner's private view of the station, in the owner's own Telegram chat with the bot: which AI
 * agents connected and what they called, who visited the site and from where, what the crews did and
 * sold, and what the recruiter found. A report twice a day (09:00 and 21:00 Europe/Bucharest), the
 * same report on /stats, and short pings as things happen: a new agent client, a paid crew job, an
 * outside operator. Pings are capped (6 an hour) and remembered on disk, so a restart repeats nothing.
 */
export type StatsSources = {
  usage: Usage;
  live(): { visitors5m: number; visitors1m: number };
  /** Crew jobs in the window, as the ledger has them. */
  jobs(sinceMs: number): { crew: string; status: string; free: boolean; paid: { usd: number; class: string } | null; kind: string }[];
  operators(): { name: string; status: string; createdAt: number; activatedAt: number | null }[];
  /** Outside customers' payments in the window (company products and house services). */
  sales(sinceMs: number): { usd: number; what: string; wallet: string }[];
  recruiter(): { state: string; prospects: number; waiting: number; sentToday: number } | null;
};

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const top = (rows: { name: string; count: number }[], n: number) => rows.slice(0, n).map((r) => `${esc(r.name)} ${r.count}`).join(" · ") || "none";
const PROBE = /collector|scanner|probe|health|check|crawler|registry|index|observatory|gateway|spike|bot\b|verify|validator|inspector|monitor/i;

/** The report: the last 24 hours, with the week for comparison. */
export function ownerReport(s: StatsSources, now = Date.now()): string {
  const day = s.usage.report(1), week = s.usage.report(7), live = s.live(), since = now - 86_400_000;
  const jobs = s.jobs(since), done = jobs.filter((j) => j.status === "done"), failed = jobs.filter((j) => j.status === "failed");
  const paid = jobs.filter((j) => j.paid && j.paid.class === "customer");
  const by = (c: string) => done.filter((j) => j.crew === c).length;
  const sales = s.sales(since), ops = s.operators(), rc = s.recruiter();
  const agents = day.mcp.clients.filter((c) => !PROBE.test(c.name)), probes = day.mcp.clients.filter((c) => PROBE.test(c.name));
  const lines = [
    `📊 <b>NIGHTSHIFT · your private stats</b> (last 24 h)`,
    "",
    `🤖 <b>AI agents</b>: ${day.mcp.sessions} MCP sessions, <b>${day.mcp.calls} tool calls</b> (7 d: ${week.mcp.sessions} sessions, ${week.mcp.calls} calls)`,
    `   agents: ${top(agents, 6)}`,
    `   directories and scanners: ${top(probes, 4)}`,
    `   tools used: ${top(day.mcp.tools, 6)}`,
    "",
    `👥 <b>Website</b>: ${day.web.visitorDays} visitors, ${day.web.views} page views (7 d: ${week.web.visitorDays} visitor-days, ${week.web.views} views). Live now: ${live.visitors5m}`,
    `   from: ${top(day.web.from, 6)}`,
    `   pages: ${top(day.web.pages, 6)}`,
    "",
    `🛠 <b>Crews</b>: ${done.length} jobs done (Watchtower ${by("watchtower")}, Research ${by("research")}, Build & Check ${by("buildcheck")}), ${failed.length} failed, <b>${paid.length} paid by customers</b>`,
    `💰 <b>Customer sales</b>: ${sales.length} ($${sales.reduce((a, x) => a + x.usd, 0).toFixed(2)})${sales.length ? ": " + sales.slice(0, 4).map((x) => `${esc(x.what)} $${x.usd.toFixed(2)}`).join(", ") : ""}`,
    `🧭 <b>Outside crews</b>: ${ops.filter((o) => o.status === "active").length} active, ${ops.filter((o) => o.createdAt > since).length} registered today`,
  ];
  if (rc) lines.push(`📣 <b>Recruiter</b>: ${rc.state}, ${rc.prospects} prospects, ${rc.waiting} invitations waiting for you, ${rc.sentToday} sent today`);
  lines.push("", "Send /stats any time for this report.");
  return lines.join("\n");
}

type State = { seenClients: string[]; sentAt: number[]; lastReport: string | null };

/** The pings and the twice-daily report, with what was already said kept on disk. */
export class OwnerStats {
  #st: State;
  #queue: string[] = [];
  constructor(private readonly o: { file: string | null; sources: StatsSources; send(text: string): Promise<boolean>; now?: () => number }) {
    let st: State = { seenClients: [], sentAt: [], lastReport: null };
    if (o.file && existsSync(o.file)) try { st = { ...st, ...(JSON.parse(readFileSync(o.file, "utf8")) as State) }; } catch { /* start over */ }
    this.#st = st;
  }
  #now() { return (this.o.now ?? Date.now)(); }
  #save() { if (this.o.file) try { writeAtomic(this.o.file, JSON.stringify(this.#st)); } catch { /* best effort */ } }

  /** A crew event: paid jobs and onboarding results are worth a ping. */
  onCrewEvent(e: CrewEvent): void {
    if (e.status === "done" && e.paid && e.house) this.#queue.push(`💰 <b>Paid crew job</b>: ${esc(e.crew)} · ${esc(e.summary ?? e.kind)}`);
    if (e.kind === "onboarding" && e.status !== "running") this.#queue.push(`🧭 <b>Outside agent onboarding ${e.status === "done" ? "passed" : "failed"}</b>: ${esc(e.summary ?? "")}`);
  }

  /** Every minute: new agent clients, queued pings (6 an hour at most), and the report at 09:00 and 21:00 Bucharest. */
  async tick(): Promise<void> {
    const now = this.#now();
    const seen = new Set(this.#st.seenClients);
    const fresh = this.o.sources.usage.report(1).mcp.clients.filter((c) => !seen.has(c.name) && c.name !== "(other)");
    if (fresh.length) {
      for (const c of fresh) seen.add(c.name);
      this.#st.seenClients = [...seen].slice(-2000);
      const agents = fresh.filter((c) => !PROBE.test(c.name)), probes = fresh.filter((c) => PROBE.test(c.name));
      if (agents.length) this.#queue.push(`🤖 <b>New agent on the MCP</b>: ${agents.map((c) => `<code>${esc(c.name)}</code>`).join(", ")}`);
      if (probes.length) this.#queue.push(`🔎 New directory or scanner: ${probes.map((c) => esc(c.name)).join(", ")}`);
      this.#save();
    }
    this.#st.sentAt = this.#st.sentAt.filter((t) => now - t < 3_600_000);
    while (this.#queue.length && this.#st.sentAt.length < 6) {
      const text = this.#queue.shift()!;
      if (await this.o.send(text).catch(() => false)) this.#st.sentAt.push(now);
    }
    if (this.#queue.length > 50) this.#queue.splice(0, this.#queue.length - 50);
    const slot = reportSlot(now);
    if (slot && this.#st.lastReport !== slot) {
      this.#st.lastReport = slot;
      this.#save();
      await this.o.send(ownerReport(this.o.sources, now)).catch(() => false);
    }
    this.#save();
  }

  report(): string { return ownerReport(this.o.sources, this.#now()); }
  /** The report now, to the owner's private chat. */
  sendReport(): Promise<boolean> { return this.o.send(this.report()); }
}

let current: OwnerStats | null = null;
export const setOwnerStats = (s: OwnerStats | null) => { current = s; };
/** The running instance, for the bot's /stats. */
export const liveOwnerStats = () => current;

/** "2026-10-25 09" or "2026-10-25 21" in Europe/Bucharest during the first 10 minutes of that hour, else null. */
export function reportSlot(now: number): string | null {
  const parts = Object.fromEntries(new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/Bucharest", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false }).formatToParts(new Date(now)).map((p) => [p.type, p.value]));
  const hour = Number(parts.hour) % 24, minute = Number(parts.minute);
  if ((hour !== 9 && hour !== 21) || minute >= 10) return null;
  return `${parts.year}-${parts.month}-${parts.day} ${String(hour).padStart(2, "0")}`;
}
