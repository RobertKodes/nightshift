import { createHash, randomBytes } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { writeAtomic } from "./atomic.js";
import { BOT } from "./live.js";

/**
 * Who uses the station, counted without storing anyone. Per UTC day: MCP sessions by the name the
 * client announces (initialize.clientInfo), tool calls by tool, distinct MCP callers, and page views
 * by path and by the site that sent the visitor. "Distinct" is a hash of the address with a salt
 * that lives in memory only and is dropped with the day, so no address can be read back from the
 * file. 90 days kept.
 */
export type Day = {
  mcp: { sessions: number; calls: number; callers: number; clients: Record<string, number>; tools: Record<string, number> };
  web: { views: number; visitors: number; paths: Record<string, number>; from: Record<string, number> };
};
type Point = { at: number; who: string; event: UsageEvent };
type File = { days: Record<string, Day>; hours: Record<string, Point[]>; hourlySince: number };

export type UsageEvent =
  | { kind: "session"; client: string }
  | { kind: "call"; client: string; tool: string }
  | { kind: "page"; path: string; source: string };

/** The same client classification for the private reports and public proof. */
export const isProbeClient = (name: string) => /director(?:y|ies)|collector|scanner|probe|health|check|crawler|registry|index|observatory|gateway|spike|bot\b|verify|validator|inspector|monitor/i.test(name);
export const isAgentClient = (name: string) => name !== "unnamed" && name !== "(other)" && !isProbeClient(name);

const KEEP_DAYS = 90, MAX_KEYS = 300;
const blank = (): Day => ({ mcp: { sessions: 0, calls: 0, callers: 0, clients: {}, tools: {} }, web: { views: 0, visitors: 0, paths: {}, from: {} } });
const dayOf = (t: number) => new Date(t).toISOString().slice(0, 10);
/** A name as a client gives it, kept short and plain: "claude-code", "Cursor", "my-agent/1.2". */
export const clientName = (s: unknown) => String(s ?? "").replace(/[^\w .@/+-]/g, "").trim().slice(0, 40) || "unnamed";
const bump = (m: Record<string, number>, k: string, by = 1) => {
  if (m[k] === undefined && Object.keys(m).length >= MAX_KEYS) k = "(other)";
  m[k] = (m[k] ?? 0) + by;
};

export class Usage {
  #f: File = { days: {}, hours: {}, hourlySince: 0 };
  #seen = new Set<string>();
  #today = "";
  #salt = randomBytes(16);
  #clientSalt = randomBytes(16);
  #dirty = false;
  #clients = new Map<string, { name: string; at: number }>();
  #listeners = new Set<(event: UsageEvent) => void>();

  /** Activity without addresses, for the owner's notifications. */
  onActivity(listener: (event: UsageEvent) => void): () => void {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }
  #emit(event: UsageEvent, ip: string): void {
    const at = this.now(), hour = String(Math.floor(at / 3_600_000));
    const who = createHash("sha256").update(this.#clientSalt).update(ip).digest("base64url").slice(0, 22);
    (this.#f.hours[hour] ??= []).push({ at, who, event });
    for (const listener of this.#listeners) try { listener(event); } catch { /* counting never depends on a listener */ }
  }
  constructor(private readonly file: string | null, private readonly now = Date.now) {
    if (file && existsSync(file)) try { this.#f = JSON.parse(readFileSync(file, "utf8")) as File; } catch { /* start over */ }
    this.#f.days ??= {};
    this.#f.hours ??= {};
    this.#f.hourlySince ||= this.now();
  }

  #day(): Day {
    const cutoff = this.now() - 8 * 86_400_000;
    for (const h of Object.keys(this.#f.hours)) {
      if (Number(h) * 3_600_000 > cutoff) continue;
      const points = this.#f.hours[h]!.filter((p) => p.at > cutoff);
      if (points.length === this.#f.hours[h]!.length) continue;
      if (points.length) this.#f.hours[h] = points; else delete this.#f.hours[h];
      this.#dirty = true;
    }
    const d = dayOf(this.now());
    if (d !== this.#today) {
      // a new day: yesterday's hashes and salt are gone for good
      this.#today = d; this.#seen.clear(); this.#salt = randomBytes(16);
      for (const k of Object.keys(this.#f.days).sort().slice(0, -KEEP_DAYS)) delete this.#f.days[k];
    }
    return (this.#f.days[d] ??= blank());
  }
  /** True the first time this address is seen today for `kind`. */
  #first(kind: string, ip: string): boolean {
    const h = createHash("sha256").update(this.#salt).update(kind).update(ip).digest("base64url").slice(0, 16);
    if (this.#seen.has(h)) return false;
    if (this.#seen.size < 200_000) this.#seen.add(h);
    return true;
  }

  /** One MCP request body (one JSON-RPC message or a batch). */
  mcp(ip: string, body: unknown, server = "public", clientHint = ""): void {
    const msgs = (Array.isArray(body) ? body : [body]).filter((m): m is { method?: unknown; params?: Record<string, unknown> } => Boolean(m) && typeof m === "object");
    if (!msgs.length) return;
    const d = this.#day();
    // Stateless MCP has no session id: correlate briefly by a salted caller and client hint.
    const key = createHash("sha256").update(this.#clientSalt).update(JSON.stringify([server, ip, clientHint])).digest("base64url");
    const hit = this.#clients.get(key);
    let client = hit && this.now() - hit.at < 3_600_000 ? hit.name : "unnamed";
    if (hit && client !== "unnamed") hit.at = this.now();
    let touched = false;
    for (const m of msgs) {
      if (m.method === "initialize") {
        const info = (m.params?.clientInfo ?? {}) as { name?: unknown };
        client = clientName(info.name);
        if (this.#clients.size >= 20_000) this.#clients.delete(this.#clients.keys().next().value!);
        this.#clients.set(key, { name: client, at: this.now() });
        d.mcp.sessions++; bump(d.mcp.clients, client); touched = true;
        this.#emit({ kind: "session", client }, ip);
      } else if (m.method === "tools/call") {
        const tool = `${server === "public" ? "" : `${server}:`}${clientName(m.params?.name)}`;
        d.mcp.calls++; bump(d.mcp.tools, tool); touched = true;
        this.#emit({ kind: "call", client, tool }, ip);
      }
    }
    if (touched && this.#first("mcp", ip)) d.mcp.callers++;
    if (touched) this.#dirty = true;
  }

  /**
   * One page the site served to a browser. `from` is where the visitor came from: the referring site
   * (its host, ours left out) or a campaign tag in the link (?utm_source= or ?via=).
   */
  page(ip: string, path: string, referer: string | undefined, ua: string | undefined, query: URLSearchParams, ownHost: string): void {
    if (!ua || BOT.test(ua)) return;
    const d = this.#day();
    d.web.views++;
    if (this.#first("web", ip)) d.web.visitors++;
    const clean = path.replace(/\/+$/, "").replace(/[0-9a-f]{8}-[0-9a-f-]{27,}/gi, ":id").replace(/\/0x[0-9a-f]{6,}/gi, "/:address").replace(/\/\d{2,}(?=\/|$)/g, "/:n").slice(0, 80) || "/";
    bump(d.web.paths, clean);
    const tag = (query.get("utm_source") ?? query.get("via") ?? query.get("ref") ?? "").toLowerCase().replace(/[^a-z0-9._-]/g, "").slice(0, 70);
    let host = "";
    try { host = referer ? new URL(referer).hostname.replace(/^www\./, "").toLowerCase() : ""; } catch { /* no referrer */ }
    const source = tag ? `tag:${tag}` : host && host !== ownHost.replace(/^www\./, "") ? host : host ? "internal" : "direct";
    if (source !== "internal") bump(d.web.from, source);
    this.#emit({ kind: "page", path: clean, source }, ip);
    this.#dirty = true;
  }

  /** The last `n` days, newest last, with their sums. */
  report(n = 30) {
    this.#day();
    const keys = Object.keys(this.#f.days).sort().slice(-n);
    const sum = blank();
    for (const k of keys) {
      const d = this.#f.days[k]!;
      sum.mcp.sessions += d.mcp.sessions; sum.mcp.calls += d.mcp.calls; sum.mcp.callers += d.mcp.callers;
      sum.web.views += d.web.views; sum.web.visitors += d.web.visitors;
      for (const [a, b] of Object.entries(d.mcp.clients)) bump(sum.mcp.clients, a, b);
      for (const [a, b] of Object.entries(d.mcp.tools)) bump(sum.mcp.tools, a, b);
      for (const [a, b] of Object.entries(d.web.paths)) bump(sum.web.paths, a, b);
      for (const [a, b] of Object.entries(d.web.from)) bump(sum.web.from, a, b);
    }
    const top = (m: Record<string, number>, k = 15) => Object.entries(m).sort((a, b) => b[1] - a[1]).slice(0, k).map(([name, count]) => ({ name, count }));
    return {
      days: keys.map((k) => ({ day: k, mcpSessions: this.#f.days[k]!.mcp.sessions, mcpCalls: this.#f.days[k]!.mcp.calls, mcpCallers: this.#f.days[k]!.mcp.callers, views: this.#f.days[k]!.web.views, visitors: this.#f.days[k]!.web.visitors })),
      mcp: { sessions: sum.mcp.sessions, calls: sum.mcp.calls, callerDays: sum.mcp.callers, clients: top(sum.mcp.clients), tools: top(sum.mcp.tools, 25) },
      web: { views: sum.web.views, visitorDays: sum.web.visitors, pages: top(sum.web.paths, 25), from: top(sum.web.from, 25) },
    };
  }

  /** Exact rolling counts, including the partial hour at either end. */
  rolling24() {
    this.#day();
    const now = this.now(), since = now - 86_400_000, sum = blank();
    const visitors = new Set<string>(), callers = new Set<string>();
    for (const [hour, points] of Object.entries(this.#f.hours)) {
      if ((Number(hour) + 1) * 3_600_000 <= since) continue;
      for (const { at, who, event: e } of points) {
        if (at <= since || at > now) continue;
        if (e.kind === "page") {
          sum.web.views++; visitors.add(who); bump(sum.web.paths, e.path);
          if (e.source !== "internal") bump(sum.web.from, e.source);
        } else {
          callers.add(who);
          if (e.kind === "session") { sum.mcp.sessions++; bump(sum.mcp.clients, e.client); }
          else { sum.mcp.calls++; bump(sum.mcp.tools, e.tool); }
        }
      }
    }
    const top = (m: Record<string, number>, n: number) => Object.entries(m).sort((a, b) => b[1] - a[1]).slice(0, n).map(([name, count]) => ({ name, count }));
    return {
      since: Math.max(since, this.#f.hourlySince),
      mcp: { sessions: sum.mcp.sessions, calls: sum.mcp.calls, callerDays: callers.size, clients: top(sum.mcp.clients, 15), tools: top(sum.mcp.tools, 25) },
      web: { views: sum.web.views, visitorDays: visitors.size, pages: top(sum.web.paths, 25), from: top(sum.web.from, 25) },
    };
  }

  /** Visits that arrived with each campaign tag (?utm_source=, ?via=, ?ref=), over the kept days. */
  tagCounts(): Record<string, number> {
    const out: Record<string, number> = {};
    for (const d of Object.values(this.#f.days)) for (const [k, n] of Object.entries(d.web.from)) if (k.startsWith("tag:")) out[k.slice(4)] = (out[k.slice(4)] ?? 0) + n;
    return out;
  }

  /** What anyone may see: this week's agent activity, as counts. */
  publicWeek() {
    const r = this.report(7);
    return { days: 7, sessions: r.mcp.sessions, toolCalls: r.mcp.calls, callerDays: r.mcp.callerDays, clients: r.mcp.clients.slice(0, 8), tools: r.mcp.tools.filter((t) => !t.name.includes(":")).slice(0, 8) };
  }

  save(): void {
    if (!this.#dirty || !this.file) return;
    this.#dirty = false;
    try { writeAtomic(this.file, JSON.stringify(this.#f)); } catch { this.#dirty = true; }
  }
}

let current: Usage | null = null;
/** The station's counter, saved once a minute. */
export function liveUsage(dataDir: string): Usage {
  if (current) return current;
  const u = (current = new Usage(join(dataDir, "usage.json")));
  setInterval(() => u.save(), 60_000).unref();
  process.once("beforeExit", () => u.save());
  return u;
}
