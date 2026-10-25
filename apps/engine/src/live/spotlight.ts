import { createHash, randomBytes } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { writeAtomic } from "../atomic.js";
import { config } from "../config.js";
import { buildCheck, parseTarget } from "../crews/buildcheck.js";
import { crewLedger, liveWatchtower } from "../crews/live.js";
import type { JobLedger } from "../crews/ledger.js";
import { privateIp } from "../net.js";
import { isIP } from "node:net";
import { readHoldings } from "../swap.js";
import { type LiveBus, liveBus, publicText } from "./bus.js";

export const SPOTLIGHT_HOLDING = 500_000n * 10n ** 18n;
export const SPOTLIGHT_INTERVAL = 3 * 60_000;
const DAY = 86_400_000;
type Item = { id: string; kind: "token" | "agent"; target: string; caption: string };
type Stored = { queue: Item[]; used: Record<string, number>; nextAt: number; current: Item & { summary: string; ok: boolean; at: number } | null };
type Deps = {
  holds(wallet: string): Promise<boolean>; run(item: Item): Promise<{ summary: string; ok: boolean }>;
  ledger: Pick<JobLedger, "start" | "done" | "fail">; bus: LiveBus; now?: () => number; file?: string;
};
export class SpotlightError extends Error { constructor(readonly status: number, message: string) { super(message); } }

/** A public token address or a public HTTPS agent endpoint. */
export function spotlightTarget(kind: unknown, input: unknown): Pick<Item, "kind" | "target" | "caption"> {
  if (typeof input !== "string" || input.length > 500) throw new SpotlightError(400, "Enter a token address or an HTTPS agent URL, up to 500 characters.");
  const s = input.trim();
  if (kind === "token") {
    if (!/^0x[0-9a-fA-F]{40}$/.test(s)) throw new SpotlightError(400, "Enter an Ethereum token address.");
    return { kind, target: s.toLowerCase(), caption: `${s.slice(0, 6)}…${s.slice(-4)}` };
  }
  if (kind !== "agent") throw new SpotlightError(400, "Choose token or agent.");
  let u: URL;
  try { u = parseTarget(s); if (new URL(s).hash) throw new Error("fragment"); } catch { throw new SpotlightError(400, "Enter a public HTTPS URL without credentials or a fragment."); }
  const h = u.hostname.replace(/^\[|\]$/g, "");
  if (u.protocol !== "https:" || u.search || u.hash || u.port || !h.includes(".") || /(?:^|\.)(localhost|internal|local)$/i.test(h) || (isIP(h) && privateIp(h))) throw new SpotlightError(400, "Use a public HTTPS URL, without query parameters or fragments.");
  return { kind, target: u.toString(), caption: publicText(u.hostname, 80) };
}

/** One holder entry per rolling day, with a durable queue and bounded work. */
export class Spotlight {
  #st: Stored = { queue: [], used: {}, nextAt: 0, current: null };
  #pending = new Set<string>();
  #busy = false;
  #now: () => number;
  constructor(private readonly d: Deps) {
    this.#now = d.now ?? Date.now;
    if (d.file && existsSync(d.file)) {
      const st = JSON.parse(readFileSync(d.file, "utf8")) as Stored;
      if (!Array.isArray(st.queue) || st.queue.length > 20 || !st.used || typeof st.nextAt !== "number") throw new Error("Invalid Spotlight state");
      this.#st = st;
    }
  }
  #save() { if (this.d.file) writeAtomic(this.d.file, JSON.stringify(this.#st), { mode: 0o600 }); }
  view() { return { queued: this.#st.queue.length, nextAt: this.#st.nextAt, current: this.#st.current ? { ...this.#st.current, target: this.#st.current.caption } : null }; }
  async enqueue(wallet: string | null, kind: unknown, target: unknown) {
    if (!wallet || !/^0x[0-9a-fA-F]{40}$/.test(wallet)) throw new SpotlightError(401, "Sign in with your wallet first.");
    const entry = spotlightTarget(kind, target);
    const key = createHash("sha256").update(wallet.toLowerCase()).digest("hex"), now = this.#now();
    for (const [k, at] of Object.entries(this.#st.used)) if (now - at >= DAY) delete this.#st.used[k];
    if (this.#pending.has(key) || (this.#st.used[key] !== undefined && now - this.#st.used[key]! < DAY)) throw new SpotlightError(429, "One Spotlight entry per wallet every 24 hours.");
    if (this.#st.queue.length + this.#pending.size >= 20) throw new SpotlightError(429, "Spotlight has 20 entries. Try again after a slot opens.");
    this.#pending.add(key);
    try {
      let holds: boolean;
      try { holds = await this.d.holds(wallet.toLowerCase()); } catch { throw new SpotlightError(503, "Holdings could not be checked. Try again shortly."); }
      if (!holds) throw new SpotlightError(403, "Hold 500,000 $SHIFT including staked, a NIGHT FROG or a Night Watcher to enter.");
      if (this.#st.queue.length >= 20) throw new SpotlightError(429, "Spotlight is full. Try again shortly.");
      const item = { ...entry, id: randomBytes(8).toString("hex") };
      this.#st.queue.push(item); this.#st.used[key] = this.#now();
      try { this.#save(); } catch { this.#st.queue.pop(); delete this.#st.used[key]; throw new SpotlightError(503, "The entry could not be saved. Try again shortly."); }
      const position = this.#st.queue.length;
      this.d.bus.emit("spotlight.queued", { item: item.id, kind: item.kind, target: item.caption, position });
      return { item: item.id, position, nextAt: Math.max(this.#st.nextAt, this.#now()) + (position - 1) * SPOTLIGHT_INTERVAL };
    } finally { this.#pending.delete(key); }
  }
  async tick(): Promise<void> {
    if (this.#busy || this.#now() < this.#st.nextAt || !this.#st.queue.length) return;
    this.#busy = true;
    const item = this.#st.queue[0]!;
    let deadline: ReturnType<typeof setTimeout> | undefined;
    try {
      // Reserve the broadcast slot before work starts; a restart cannot shorten the interval.
      this.#st.nextAt = this.#now() + SPOTLIGHT_INTERVAL; this.#save();
      this.d.bus.emit("spotlight.started", { item: item.id, kind: item.kind, target: item.caption });
      const j = this.d.ledger.start({ key: `spotlight:${item.id}`, crew: item.kind === "token" ? "watchtower" : "buildcheck", operator: "house", kind: `spotlight.${item.kind}`, free: true });
      let result: { summary: string; ok: boolean };
      if (j.status !== "running") result = { summary: j.summary ?? j.error ?? "The earlier check was interrupted.", ok: j.status === "done" };
      else {
        try {
          result = await Promise.race([this.d.run(item), new Promise<never>((_, reject) => { deadline = setTimeout(() => reject(new Error("timeout")), 120_000); deadline.unref(); })]);
          result.summary = publicText(result.summary);
          this.d.ledger.done(j.id, { summary: result.summary });
        } catch {
          result = { summary: "The check could not finish. No all-clear was issued.", ok: false };
          this.d.ledger.fail(j.id, result.summary);
        }
      }
      this.#st.current = { ...item, ...result, at: this.#now() };
      this.#st.queue.shift(); this.#save();
      this.d.bus.emit("spotlight.result", { item: item.id, kind: item.kind, target: item.caption, ...result });
    } finally { if (deadline) clearTimeout(deadline); this.#busy = false; }
  }
}

let current: Spotlight | null = null;
export function liveSpotlight(): Spotlight {
  return current ??= new Spotlight({
    bus: liveBus, file: join(config.dataDir, "live-spotlight.json"), ledger: crewLedger(),
    holds: (wallet) => readHoldings(wallet, SPOTLIGHT_HOLDING),
    run: async (item) => {
      if (item.kind === "agent") {
        const r = await buildCheck(item.target, {}, "quick");
        return { summary: r.summary.text, ok: r.summary.fail === 0 && r.summary.unavailable === 0 };
      }
      const wt = liveWatchtower();
      if (!wt) throw new Error("Watchtower is starting");
      const r = await wt.check(item.target);
      return { summary: `${r.summary}${r.stale ? " Sources are stale." : ""}${r.unavailable.length ? ` ${r.unavailable.length} checks unavailable.` : ""}`, ok: !r.stale && r.unavailable.length === 0 && !r.changes.some((c) => c.severity === "critical" || c.severity === "high") };
    },
  });
}
