import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { writeAtomic } from "./atomic.js";
import type { CrewEvent } from "./crews/contracts.js";
import { isAgentClient, isProbeClient, type Usage, type UsageEvent } from "./usage.js";
import type { PayerClass } from "./proof.js";

/** The owner's private reports, money alerts and station activity. */
export type StatsSources = {
  usage: Usage;
  payerClass(payer: string, sim: boolean): PayerClass;
  live(): { visitors5m: number; visitors1m: number };
  /** Crew jobs in the window, as the ledger has them. */
  jobs(sinceMs: number): { crew: string; status: string; free: boolean; paid: { usd: number; class: string } | null; kind: string }[];
  operators(): { name: string; status: string; createdAt: number; activatedAt: number | null }[];
  /** Outside customers' payments in the window (company products and house services). */
  sales(sinceMs: number): { usd: number; what: string; wallet: string }[];
  recruiter(): { state: string; prospects: number; waiting: number; sentToday: number } | null;
};

const short = (s: string) => `${s.slice(0, 6)}…${s.slice(-4)}`;
const plain = (s: string) => s
  .replace(/(?:https?|wss?):\/\/\S+/gi, "[link]")
  .replace(/\b(?:authorization|signature|password|secret|api[_-]?key|token)\s*[:=]\s*\S+/gi, "[secret]")
  .replace(/\b(?:bearer\s+\S+|(?:sk-|nsa_|ghp_|xox[baprs]-)[\w-]+)/gi, "[secret]")
  .replace(/0x[0-9a-f]{41,}\b/gi, "[redacted]")
  .replace(/0x[0-9a-f]{11,40}\b/gi, short)
  .replace(/\b(?:\d{1,3}\.){3}\d{1,3}\b/g, "[address]")
  .replace(/(?:[a-f0-9]{0,4}:){2,}[a-f0-9:.%]*/gi, "[address]")
  .replace(/[\w=-]{32,}/g, "[redacted]")
  .replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim().slice(0, 120);
/** Plain, short Telegram text, with private identifiers removed. */
export const ownerText = (s: string) => plain(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const esc = ownerText;
const dollars = (usd: number) => usd.toFixed(6).replace(/(\.\d{2,}?)0+$/, "$1");
const top = (rows: { name: string; count: number }[], n: number) => rows.slice(0, n).map((r) => `${esc(r.name)} ${r.count}`).join(" · ") || "none";
const rows = (m: Record<string, number>) => Object.entries(m).map(([name, count]) => ({ name, count })).sort((a, b) => b.count - a.count);
const bump = (m: Record<string, number>, k: string, n = 1) => {
  Object.defineProperty(m, k, { value: (Object.hasOwn(m, k) ? m[k]! : 0) + n, writable: true, enumerable: true, configurable: true });
};

/** The report: the last 24 hours, with the week for comparison. */
export function ownerReport(s: StatsSources, now = Date.now()): string {
  const day = s.usage.rolling24(), week = s.usage.report(7), live = s.live(), since = now - 86_400_000;
  const jobs = s.jobs(since), done = jobs.filter((j) => j.status === "done"), failed = jobs.filter((j) => j.status === "failed");
  const paid = jobs.filter((j) => j.paid && j.paid.class === "customer");
  const by = (c: string) => done.filter((j) => j.crew === c).length;
  const sales = s.sales(since), ops = s.operators(), rc = s.recruiter();
  const agents = day.mcp.clients.filter((c) => !isProbeClient(c.name)), probes = day.mcp.clients.filter((c) => isProbeClient(c.name));
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
  if (day.since > since) lines.push(`Rolling counts available since ${new Date(day.since).toISOString().slice(0, 16).replace("T", " ")} UTC.`);
  if (rc) lines.push(`📣 <b>Recruiter</b>: ${esc(rc.state)}, ${rc.prospects} prospects, ${rc.waiting} invitations waiting for you, ${rc.sentToday} sent today`);
  lines.push("", "Send /stats any time for this report.");
  return lines.join("\n");
}

export type NotifyLevel = "all" | "money" | "off";
/** Startup alerts read the saved level before the reports are running. */
export function notificationLevel(file: string): NotifyLevel {
  try {
    const level = JSON.parse(readFileSync(file, "utf8")).level;
    return level === "off" || level === "money" ? level : "all";
  } catch { return "all"; }
}
type Kind = "money" | "error" | "activity";
export type PaymentAttempt = { service: string; payer: string; nonce: string; reason: string };
export type SettledPayment = Omit<PaymentAttempt, "reason"> & { usd: number; holderPrice: boolean; tx: string; sim?: boolean };
type Digest = {
  since: number;
  agents: Record<string, { sessions: number; calls: number; tools: Record<string, number> }>;
  probes: { sessions: number; calls: number }; unattributed: number;
  views: number; from: Record<string, number>; pages: Record<string, number>;
  jobs: Record<string, number>;
  payments: { settled: number; refused: number; usd: number; classes: Record<string, number> };
  news: string[]; spilled: number;
};
type State = {
  seenClients: string[]; seenCalls: string[]; seenOperators: string[];
  payments: Record<string, { settled?: boolean; refused?: boolean }>;
  sentAt: number[]; lastReport: string | null; level: NotifyLevel; digest: Digest;
  outbox: { text: string; kind: Kind | "report" }[];
  reserveBuys: string[];
};
const emptyDigest = (since: number): Digest => ({ since, agents: {}, probes: { sessions: 0, calls: 0 }, unattributed: 0, views: 0, from: {}, pages: {}, jobs: {}, payments: { settled: 0, refused: 0, usd: 0, classes: {} }, news: [], spilled: 0 });

/** Pings are retried on the minute; activity spills into the half-hour digest. */
export class OwnerStats {
  #st: State;
  #sending: Promise<void> | null = null;
  #ticking: Promise<void> | null = null;
  #unsubscribe: () => void;
  constructor(private readonly o: { file: string | null; sources: StatsSources; send(text: string): Promise<boolean>; now?: () => number }) {
    const st: State = { seenClients: [], seenCalls: [], seenOperators: [], payments: {}, sentAt: [], lastReport: null, level: "all", digest: emptyDigest(this.#now()), outbox: [], reserveBuys: [] };
    if (o.file && existsSync(o.file)) try { Object.assign(st, JSON.parse(readFileSync(o.file, "utf8"))); } catch { /* start over */ }
    if (!["all", "money", "off"].includes(st.level)) st.level = "all";
    this.#st = st;
    this.#unsubscribe = o.sources.usage.onActivity((e) => this.#onUsage(e));
  }
  dispose(): void { this.#unsubscribe(); }
  #now() { return (this.o.now ?? Date.now)(); }
  #save() { if (this.o.file) try { writeAtomic(this.o.file, JSON.stringify(this.#st), { mode: 0o600 }); } catch { /* retry next tick */ } }
  get level(): NotifyLevel { return this.#st.level; }
  #allows(kind: Kind | "report") { return kind === "report" || this.level === "all" || (this.level === "money" && kind !== "activity"); }

  /** /notify in the owner's private admin chat. */
  notify(args: string[]): string {
    const level = args[0]?.toLowerCase();
    if (args.length !== 1 || (level !== "all" && level !== "money" && level !== "off")) return `🔔 Notifications: <b>${this.level}</b>. Use /notify all | money | off.`;
    if (this.#st.level !== level) this.#st.digest = emptyDigest(this.#now());
    this.#st.level = level;
    this.#st.outbox = this.#st.outbox.filter((m) => this.#allows(m.kind));
    this.#save();
    return `🔔 Notifications: <b>${level}</b>. ${level === "all" ? "Money, errors, new agents and a digest every 30 minutes." : level === "money" ? "Money and errors only." : "Only the 09:00 and 21:00 Bucharest report."}`;
  }

  #enqueue(text: string, kind: Kind | "report"): void {
    if (!this.#allows(kind)) return;
    let chunk = "";
    for (const line of text.split("\n")) {
      if (chunk.length + line.length > 3800) { this.#st.outbox.push({ text: chunk, kind }); chunk = ""; }
      chunk += `${chunk ? "\n" : ""}${line}`;
    }
    if (chunk) this.#st.outbox.push({ text: chunk, kind });
    this.#save();
    void this.#flush();
  }
  #flush(): Promise<void> {
    if (this.#sending) return this.#sending;
    this.#sending = this.#drain().finally(() => { this.#sending = null; });
    return this.#sending;
  }
  async #drain(): Promise<void> {
    while (this.#st.outbox.length) {
      const m = this.#st.outbox[0]!;
      if (this.#allows(m.kind) && !(await this.o.send(m.text).catch(() => false))) break;
      // /notify may have removed this message while Telegram was answering.
      if (this.#st.outbox[0] === m) this.#st.outbox.shift();
      this.#save();
    }
  }
  #activity(text: string): void {
    if (this.level !== "all") return;
    const now = this.#now();
    this.#st.sentAt = this.#st.sentAt.filter((t) => now - t < 3_600_000);
    if (this.#st.sentAt.length >= 10) { this.#st.digest.spilled++; this.#save(); return; }
    this.#st.sentAt.push(now);
    this.#enqueue(text, "activity");
  }
  #onUsage(e: UsageEvent): void {
    const d = this.#st.digest;
    if (e.kind === "page") {
      if (this.level === "all") { d.views++; bump(d.pages, plain(e.path)); bump(d.from, plain(e.source)); }
      return;
    }
    if (this.level === "all") {
      if (isProbeClient(e.client)) d.probes[e.kind === "session" ? "sessions" : "calls"]++;
      else if (isAgentClient(e.client)) {
        const key = `$${plain(e.client)}`;
        const a = (d.agents[key] ??= { sessions: 0, calls: 0, tools: {} });
        if (e.kind === "session") a.sessions++;
        else { a.calls++; bump(a.tools, plain(e.tool)); }
      } else if (e.kind === "call") d.unattributed++;
    }
    if (!isAgentClient(e.client)) return;
    const seen = e.kind === "session" ? this.#st.seenClients : this.#st.seenCalls;
    if (seen.includes(e.client)) return;
    seen.push(e.client);
    this.#activity(e.kind === "session"
      ? `🤖 <b>New agent on the MCP</b>: <code>${esc(e.client)}</code>`
      : `🛠 <b>First tool call</b>: <code>${esc(e.client)}</code> · ${esc(e.tool)}`);
    this.#save();
  }
  #payment(p: PaymentAttempt | SettledPayment, kind: "settled" | "refused"): boolean {
    const key = createHash("sha256").update(`${p.payer.toLowerCase()}:${p.nonce.toLowerCase()}`).digest("hex");
    const seen = (this.#st.payments[key] ??= {});
    if (seen[kind]) return false;
    seen[kind] = true;
    return true;
  }

  /** Only a decoded, verified authorization may reach this hook. */
  notePaymentAttempt(p: PaymentAttempt): void {
    if (!this.#payment(p, "refused")) return;
    this.#st.digest.payments.refused++;
    this.#enqueue(`⚠️ <b>Payment refused</b>: ${esc(p.service)}\n${esc(p.payer)} · ${esc(p.reason)}\nNothing was charged.`, "money");
    this.#save();
  }
  /** The existing paid-record path calls this as soon as settlement is known. */
  notePaymentSettled(p: SettledPayment): void {
    if (!/^0x[0-9a-f]{64}$/i.test(p.tx) || !this.#payment(p, "settled")) return;
    const cls = this.o.sources.payerClass(p.payer, p.sim === true), d = this.#st.digest.payments;
    d.settled++; d.usd += p.usd; bump(d.classes, cls);
    this.#enqueue(`💰 <b>Payment settled</b>: ${esc(p.service)} · $${dollars(p.usd)}\n${esc(p.payer)} · ${cls} · holder price: ${p.holderPrice ? "yes" : "no"}\n<a href="https://basescan.org/tx/${p.tx}">BaseScan transaction</a>`, "money");
    this.#save();
  }
  noteOperatorRegistered(op: { id: string; name: string }): void {
    if (this.#st.seenOperators.includes(op.id)) return;
    this.#st.seenOperators.push(op.id);
    const text = `🧭 <b>Outside crew registered</b>: ${esc(op.name)}`;
    this.#st.digest.news.push(text);
    this.#activity(text); this.#save();
  }
  /** The reserve's generated receipt, with its two verified transaction links. */
  reserveBuy(id: string, html: string): void {
    if (this.#st.reserveBuys.includes(id)) return;
    this.#st.reserveBuys.push(id); this.#enqueue(html, "money"); this.#save();
  }

  /** Crew outcomes, with payment details supplied by recordPaid. */
  onCrewEvent(e: CrewEvent): void {
    bump(this.#st.digest.jobs, `${plain(e.crew)} ${e.status === "running" ? "started" : e.status}`);
    if (e.status === "running") return;
    if (e.kind === "onboarding") {
      const text = `🧭 <b>Outside agent onboarding ${e.status === "done" ? "passed" : "failed"}</b>: ${esc(e.summary ?? "")}`;
      this.#st.digest.news.push(text);
      if (e.status === "failed") this.#enqueue(text, "error"); else this.#activity(text);
    }
  }
  /** Existing engine alerts use the same private destination and notification level. */
  async alert(text: string, kind: "sale" | "launch" | "alert"): Promise<boolean> {
    const category = kind === "sale" ? "money" : kind === "alert" ? "error" : "activity";
    if (!this.#allows(category)) return false;
    this.#enqueue(`🌙 <b>NIGHTSHIFT</b>\n${esc(text)}`, category);
    await this.#flush();
    return !this.#st.outbox.length;
  }

  #digest(): string | null {
    const d = this.#st.digest;
    if (!Object.keys(d.agents).length && !d.probes.sessions && !d.probes.calls && !d.unattributed && !d.views && !Object.keys(d.jobs).length && !d.payments.settled && !d.payments.refused && !d.news.length) return null;
    const lines = ["📊 <b>NIGHTSHIFT · last 30 minutes</b>"];
    for (const [key, a] of Object.entries(d.agents)) lines.push(`🤖 ${esc(key.slice(1))}: ${a.sessions} sessions, ${a.calls} tool calls${a.calls ? ` · ${top(rows(a.tools), 3)}` : ""}`);
    if (d.probes.sessions || d.probes.calls) lines.push(`🔎 Directories and scanners: ${d.probes.sessions} sessions, ${d.probes.calls} tool calls`);
    if (d.unattributed) lines.push(`🛠 Unattributed tool calls: ${d.unattributed}`);
    if (d.views) lines.push(`👥 Website: ${d.views} page views`, `   from: ${top(rows(d.from), 5)}`, `   pages: ${top(rows(d.pages), 5)}`);
    if (Object.keys(d.jobs).length) lines.push(`🛠 Crews: ${top(rows(d.jobs), 5)}`);
    if (d.payments.settled || d.payments.refused) lines.push(`💰 Payments: ${d.payments.settled} settled ($${dollars(d.payments.usd)}), ${d.payments.refused} refused · ${top(rows(d.payments.classes), 5)}`);
    lines.push(...d.news);
    if (d.spilled) lines.push(`🔔 ${d.spilled} new activity pings kept for this digest (10/h limit).`);
    return lines.join("\n");
  }
  /** Every minute: retry sends, then check the digest and Bucharest report slots. */
  tick(): Promise<void> {
    if (this.#ticking) return this.#ticking;
    this.#ticking = this.#tick().finally(() => { this.#ticking = null; });
    return this.#ticking;
  }
  async #tick(): Promise<void> {
    const now = this.#now();
    if (now - this.#st.digest.since >= 1_800_000) {
      const text = this.level === "all" ? this.#digest() : null;
      this.#st.digest = emptyDigest(now);
      if (text) this.#enqueue(text, "activity");
    }
    const slot = reportSlot(now);
    if (slot && this.#st.lastReport !== slot) {
      this.#st.lastReport = slot;
      this.#enqueue(ownerReport(this.o.sources, now), "report");
    }
    this.#save();
    await this.#flush();
  }

  report(): string { return ownerReport(this.o.sources, this.#now()); }
  /** The report now, to the owner's private chat. */
  sendReport(): Promise<boolean> { return this.o.send(this.report()); }
}

let current: OwnerStats | null = null;
export const setOwnerStats = (s: OwnerStats | null) => { current = s; };
/** The running instance, for the bot's /stats and /notify. */
export const liveOwnerStats = () => current;
export const notePaymentAttempt = (p: PaymentAttempt): void => { current?.notePaymentAttempt(p); };
export const notePaymentSettled = (p: SettledPayment): void => { current?.notePaymentSettled(p); };
export const noteOperatorRegistered = (op: { id: string; name: string }): void => { current?.noteOperatorRegistered(op); };

/** "2026-10-25 09" or "2026-10-25 21" in Europe/Bucharest during the first 10 minutes of that hour, else null. */
export function reportSlot(now: number): string | null {
  const parts = Object.fromEntries(new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/Bucharest", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false }).formatToParts(new Date(now)).map((p) => [p.type, p.value]));
  const hour = Number(parts.hour) % 24, minute = Number(parts.minute);
  if ((hour !== 9 && hour !== 21) || minute >= 10) return null;
  return `${parts.year}-${parts.month}-${parts.day} ${String(hour).padStart(2, "0")}`;
}
