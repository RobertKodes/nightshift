import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { DailyCap, nextFreeAt, ownerMayRunFree, paceOf, planView } from "./freeshift.js";

const H = 3600_000;
const pace = { shifts: 3, gapMs: 10 * 60_000, slowMs: 72 * H };

describe("the engine's daily cap on free work", () => {
  it("counts up to the cap, refuses past it, and starts again with the UTC day", () => {
    const now = { t: Date.parse("2026-11-10T23:50:00Z") };
    const file = join(mkdtempSync(join(tmpdir(), "cap-")), "free-shifts.json");
    const cap = new DailyCap(file, () => 3, () => now.t);
    expect([cap.take(), cap.take(), cap.take()]).toEqual([true, true, true]);
    expect(cap.room()).toBe(false);
    expect(cap.take()).toBe(false);
    expect(cap.used()).toBe(3);
    expect(cap.left()).toBe(0);
    expect(new Date(cap.resetsAt()).toISOString()).toBe("2026-11-11T00:00:00.000Z");
    // a restart does not hand out the day's free shifts again
    expect(new DailyCap(file, () => 3, () => now.t).room()).toBe(false);
    expect(JSON.parse(readFileSync(file, "utf8"))).toEqual({ day: "2026-11-10", used: 3 });
    now.t += 11 * 60_000;
    expect(cap.used()).toBe(0);
    expect(cap.take()).toBe(true);
  });

  it("follows the cap as the operator changes it, and a cap of 0 gives nothing away", () => {
    let limit = 1;
    const cap = new DailyCap(join(mkdtempSync(join(tmpdir(), "cap-")), "c.json"), () => limit, () => 0);
    expect(cap.take()).toBe(true);
    expect(cap.take()).toBe(false);
    limit = 2;
    expect(cap.take()).toBe(true);
    limit = 0;
    expect(cap.room()).toBe(false);
  });

  it("reads a broken file as a fresh day", () => {
    const file = join(mkdtempSync(join(tmpdir(), "cap-")), "c.json");
    writeFileSync(file, "{not json");
    expect(new DailyCap(file, () => 2, () => 0).take()).toBe(true);
  });
});

describe("the pace of free shifts", () => {
  it("runs the first three minutes apart, then every 72 hours", () => {
    expect(nextFreeAt({ free: { used: 1 } }, pace, 1000)).toBe(1000 + 10 * 60_000);
    expect(nextFreeAt({ free: { used: 2 } }, pace, 1000)).toBe(1000 + 10 * 60_000);
    expect(nextFreeAt({ free: { used: 3 } }, pace, 1000)).toBe(1000 + 72 * H);
    expect(nextFreeAt({}, pace, 0)).toBe(10 * 60_000);
  });

  it("lets the owner run a free shift by hand while the first ones are left, then only on its slower turn", () => {
    expect(ownerMayRunFree({}, pace, 0)).toEqual({ ok: true });
    expect(ownerMayRunFree({ free: { used: 2, lastAt: 0 } }, pace, 1)).toEqual({ ok: true });
    const late = ownerMayRunFree({ free: { used: 3, lastAt: 0 } }, pace, 2 * H);
    expect(late).toMatchObject({ ok: false, nextAt: 72 * H });
    if (!late.ok) expect(late.why).toMatch(/next shift runs in about 70 hours\. Fund the company to hire the IMD swarm/);
    expect(ownerMayRunFree({ free: { used: 3, lastAt: 0 } }, pace, 72 * H)).toEqual({ ok: true });
  });

  it("tells the owner where the company stands", () => {
    const cap = { left: 5, resetsAt: 99 };
    expect(planView({ free: { used: 1 }, nextShiftAt: 500, status: "active" }, pace, false, cap)).toEqual({ funded: false, free: { used: 1, total: 3, left: 2, pace: "first", everyHours: 72, everyMinutes: 4320, queued: null }, nextShiftAt: 500 });
    expect(planView({ free: { used: 4 }, nextShiftAt: 500, status: "active" }, pace, false, cap).free).toMatchObject({ left: 0, pace: "slow" });
    // queued for tomorrow only while today's free shifts are really gone
    expect(planView({ free: { used: 1, queuedAt: 7 }, nextShiftAt: 500, status: "active" }, pace, false, { left: 0, resetsAt: 99 }).free.queued).toEqual({ until: 99 });
    expect(planView({ free: { used: 1, queuedAt: 7 }, nextShiftAt: 500, status: "active" }, pace, true, { left: 0, resetsAt: 99 }).free.queued).toBeNull();
    // paused or hidden: no next shift
    expect(planView({ nextShiftAt: 500, status: "paused" }, pace, true, cap).nextShiftAt).toBeNull();
    expect(planView({ nextShiftAt: 500, status: "active", hidden: { at: 1, reason: "x", by: "auto" } }, pace, true, cap).nextShiftAt).toBeNull();
  });

  it("keeps the demo quick", () => {
    expect(paceOf({ freeShifts: 3, freeShiftMinutes: 10, freeSlowHours: 72, mode: "live", simShiftMinutes: 2 })).toEqual({ shifts: 3, gapMs: 600_000, slowMs: 72 * H });
    expect(paceOf({ freeShifts: 3, freeShiftMinutes: 10, freeSlowHours: 72, mode: "sim", simShiftMinutes: 2 })).toEqual({ shifts: 3, gapMs: 120_000, slowMs: 600_000 });
  });
});
