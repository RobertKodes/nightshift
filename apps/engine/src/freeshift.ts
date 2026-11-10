import { existsSync, readFileSync } from "node:fs";
import type { Company } from "@nightshift/core";
import { writeAtomic } from "./atomic.js";

/**
 * Free shifts: a new company works at once, with no funding, on free resources only (free models and
 * in-house production: no IMD order, no paid model, no gas). The first few run minutes apart, so the
 * founder watches the company make its first products; after that an unfunded company keeps going at
 * a slower pace, and funding it (to hire the IMD swarm) is an upgrade, never a wall. Free work is not
 * unlimited for the engine: a daily cap for all companies together queues the rest for tomorrow.
 */
const DAY = 24 * 3600_000;

/** One counter for the whole engine per UTC day, kept in a small file so a restart does not reset it. */
export class DailyCap {
  #day = "";
  #used = 0;
  constructor(private readonly file: string, private readonly cap: () => number, private readonly now: () => number = Date.now) {
    try {
      if (existsSync(file)) { const s = JSON.parse(readFileSync(file, "utf8")) as { day?: string; used?: number }; this.#day = String(s.day ?? ""); this.#used = Math.max(0, Number(s.used) || 0); }
    } catch { /* a broken file starts the day again */ }
  }
  #roll(): void {
    const day = new Date(this.now()).toISOString().slice(0, 10);
    if (day !== this.#day) { this.#day = day; this.#used = 0; }
  }
  used(): number { this.#roll(); return this.#used; }
  left(): number { return Math.max(0, this.cap() - this.used()); }
  room(): boolean { return this.left() > 0; }
  /** Counts one, when there is room. */
  take(): boolean {
    if (!this.room()) return false;
    this.#used += 1;
    try { writeAtomic(this.file, JSON.stringify({ day: this.#day, used: this.#used })); } catch { /* best effort: lost, the cap is a little looser today */ }
    return true;
  }
  /** When the next UTC day starts. */
  resetsAt(): number { const d = new Date(this.now()); return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + 1); }
}

export interface FreePace { shifts: number; gapMs: number; slowMs: number }

/** When an unfunded company's next free shift is due after one ran at `at`. */
export function nextFreeAt(c: Pick<Company, "free">, pace: FreePace, at: number): number {
  return at + ((c.free?.used ?? 0) < pace.shifts ? pace.gapMs : pace.slowMs);
}

/**
 * May an unfunded company's owner run a shift by hand now? Yes while its first free shifts are left;
 * afterwards only when its slower turn has come: the button is not a way around the pace.
 */
export function ownerMayRunFree(c: Pick<Company, "free">, pace: FreePace, now: number): { ok: true } | { ok: false; nextAt: number; why: string } {
  const f = c.free ?? { used: 0 };
  if (f.used < pace.shifts) return { ok: true };
  const nextAt = (f.lastAt ?? 0) + pace.slowMs;
  if (now >= nextAt) return { ok: true };
  const hours = Math.max(1, Math.ceil((nextAt - now) / 3600_000));
  return { ok: false, nextAt, why: `Its ${pace.shifts} free shifts are used: on free resources the next shift runs in about ${hours} hour${hours === 1 ? "" : "s"}. Fund the company to hire the IMD swarm and run shifts whenever you want.` };
}

/** What the owner's page says about where the company stands: free or funded, and when it works next. */
export function planView(c: Pick<Company, "free" | "nextShiftAt" | "status" | "hidden">, pace: FreePace, funded: boolean, cap: { left: number; resetsAt: number }) {
  const used = c.free?.used ?? 0;
  return {
    funded,
    free: {
      used, total: pace.shifts, left: Math.max(0, pace.shifts - used),
      /** "first": the quick free shifts after founding; "slow": free resources at the slower pace. */
      pace: used < pace.shifts ? "first" as const : "slow" as const,
      everyHours: Math.round((pace.slowMs / 3600_000) * 10) / 10,
      everyMinutes: Math.round(pace.slowMs / 60_000),
      /** Waiting for tomorrow: the engine's free shifts for today are used. */
      queued: !funded && Boolean(c.free?.queuedAt) && cap.left <= 0 ? { until: cap.resetsAt } : null,
    },
    nextShiftAt: c.status === "active" && !c.hidden ? c.nextShiftAt : null,
  };
}

export const paceOf = (cfg: { freeShifts: number; freeShiftMinutes: number; freeSlowHours: number; mode: "sim" | "live"; simShiftMinutes: number }): FreePace => ({
  shifts: cfg.freeShifts,
  // the demo keeps its own quick pace
  gapMs: (cfg.mode === "sim" ? Math.min(cfg.simShiftMinutes, cfg.freeShiftMinutes) : cfg.freeShiftMinutes) * 60_000,
  slowMs: cfg.mode === "sim" ? Math.max(cfg.simShiftMinutes * 5, 10) * 60_000 : cfg.freeSlowHours * 3600_000,
});

export const FREE_DAY = DAY;
