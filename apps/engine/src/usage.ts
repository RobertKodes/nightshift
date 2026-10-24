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
type File = { days: Record<string, Day> };

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
  #f: File = { days: {} };
  #seen = new Set<string>();
  #today = "";
  #salt = randomBytes(16);
  #dirty = false;
  constructor(private readonly file: string | null, private readonly now = Date.now) {
    if (file && existsSync(file)) try { this.#f = JSON.parse(readFileSync(file, "utf8")) as File; } catch { /* start over */ }
    this.#f.days ??= {};
  }

  #day(): Day {
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
  mcp(ip: string, body: unknown, server = "public"): void {
    const msgs = (Array.isArray(body) ? body : [body]).filter((m): m is { method?: unknown; params?: Record<string, unknown> } => Boolean(m) && typeof m === "object");
    if (!msgs.length) return;
    const d = this.#day();
    let touched = false;
    for (const m of msgs) {
      if (m.method === "initialize") {
        const info = (m.params?.clientInfo ?? {}) as { name?: unknown };
        d.mcp.sessions++; bump(d.mcp.clients, clientName(info.name)); touched = true;
      } else if (m.method === "tools/call") {
        d.mcp.calls++; bump(d.mcp.tools, `${server === "public" ? "" : `${server}:`}${clientName(m.params?.name)}`); touched = true;
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
    const tag = (query.get("utm_source") ?? query.get("via") ?? "").toLowerCase().replace(/[^a-z0-9._-]/g, "").slice(0, 30);
    let host = "";
    try { host = referer ? new URL(referer).hostname.replace(/^www\./, "").toLowerCase() : ""; } catch { /* no referrer */ }
    if (tag) bump(d.web.from, `tag:${tag}`);
    else if (host && host !== ownHost.replace(/^www\./, "")) bump(d.web.from, host);
    else if (!host) bump(d.web.from, "direct");
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
