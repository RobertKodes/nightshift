import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { crewLedger } from "./crew.js";

const PAYER = "0x6c4c78f2c3bdf4c4318fe305fb1c8bc1694d19b5";
const sub = (seat: string, accepted: boolean, role = "build") => ({ nodeKey: role, role, seat: { tokenId: seat, agentId: `a${seat}` }, outcome: accepted ? "accepted" : "rejected", accepted, usage: { model: "m1", runtime: "claude", wallClockMs: 1_800_000, outputTokens: 100 } });

/** A fake api.imd.fun: two admitted orders and one refused, with a count of every call. */
function imd(over: Partial<Record<string, unknown>> = {}) {
  const calls: string[] = [];
  let down = false;
  const data: Record<string, unknown> = {
    [`/requests/paid-by/${PAYER}`]: { orders: [
      { orderId: "o1", action: "launch.open", status: "admitted", paidAt: "2026-10-20T10:00:00.000Z", result: { jobId: "j1" } },
      { orderId: "o2", action: "job.open", status: "admitted", paidAt: "2026-10-19T10:00:00.000Z", result: { jobId: "j2" } },
      { orderId: "o3", action: "job.open", status: "refused", paidAt: null, result: null },
    ] },
    "/jobs/j1": { state: "completed", objective: "Build and deploy a vault. More text." },
    "/jobs/j1/submissions": { submissions: [sub("7", true), sub("9", true, "review"), sub("7", false, "tests")] },
    "/jobs/j2": { state: "running", objective: "Audit the repo" },
    "/jobs/j2/submissions": { submissions: [sub("9", true, "review")] },
    ...over,
  };
  const fetchJson = async <T,>(url: string): Promise<T> => {
    const path = url.replace("https://api.imd.fun", "");
    calls.push(path);
    if (down || !(path in data)) throw new Error(`${path} answered 503`);
    return structuredClone(data[path]) as T;
  };
  return { fetchJson, calls, data, setDown: (v: boolean) => { down = v; } };
}

describe("crew ledger", () => {
  it("lists every paid job with its seats, and totals that add up", async () => {
    const api = imd();
    const l = crewLedger({ file: null, fetchJson: api.fetchJson, payers: [PAYER] });
    await l.refresh();
    const c = await l.get();
    expect(c.ok).toBe(true);
    expect(c.error).toBeNull();
    expect(c.orders).toBe(2);
    expect(c.paidImd).toBe(1);
    expect(c.jobs.map((j) => [j.id, j.title, j.state, j.seats, j.accepted])).toEqual([
      ["j1", "Build and deploy a vault", "completed", [7, 9], 2],
      ["j2", "Audit the repo", "running", [9], 1],
    ]);
    expect(c.jobs[0]!.explorer).toBe("https://explorer.imd.fun/jobs/j1");
    expect(c.seats).toBe(2);
    expect(c.acceptedSteps).toBe(3);
    const seven = c.crew.find((m) => m.seat === 7)!;
    expect(seven).toMatchObject({ accepted: 1, attempts: 2, jobs: 1, roles: ["build", "tests"], hours: 1 });
    expect(c.crew.find((m) => m.seat === 9)).toMatchObject({ accepted: 2, jobs: 2 });
  });

  it("reads a finished job once, and keeps the last known numbers when IMD stops answering", async () => {
    const file = join(mkdtempSync(join(tmpdir(), "crew-")), "crew.json");
    const api = imd();
    let t = 1_000_000;
    const l = crewLedger({ file, fetchJson: api.fetchJson, payers: [PAYER], now: () => t });
    await l.refresh();
    api.calls.length = 0;
    t += 60_000;
    await l.refresh();
    // the completed job is not read again; the running one is
    expect(api.calls).not.toContain("/jobs/j1/submissions");
    expect(api.calls).toContain("/jobs/j2/submissions");

    api.setDown(true);
    t += 60_000;
    await l.refresh();
    const c = await l.get();
    expect(c.ok).toBe(false);
    expect(c.error).toMatch(/^IMD's API is not answering/);
    expect(c.jobs).toHaveLength(2);
    expect(c.seats).toBe(2);
    expect(c.at).toBe(1_060_000);
    expect(c.checkedAt).toBe(1_120_000);

    // a restart serves the copy on disk at once, without waiting on IMD
    const again = crewLedger({ file, fetchJson: api.fetchJson, payers: [PAYER], now: () => t });
    const before = api.calls.length;
    const d = await again.get();
    expect(d.jobs).toHaveLength(2);
    expect(api.calls.length).toBe(before);
  });

  it("answers at once with an honest empty roster when IMD has never answered", async () => {
    const api = imd();
    api.setDown(true);
    const l = crewLedger({ file: null, fetchJson: api.fetchJson, payers: [PAYER], firstWaitMs: 50 });
    const c = await l.get();
    expect(c.ok).toBe(false);
    expect(c.at).toBe(0);
    expect(c.jobs).toEqual([]);
    expect(c.error).toMatch(/IMD/);
  });

  it("adds NIGHTSHIFT's own records and counts each job once", async () => {
    const api = imd({ "/jobs/j3": { state: "completed", objective: "Put the company on the web" }, "/jobs/j3/submissions": { submissions: [sub("11", true)] } });
    const l = crewLedger({ file: null, fetchJson: api.fetchJson, payers: [PAYER], extra: () => [
      { id: "j1", action: "launch.open", title: "dup", paidAt: null, by: "NIGHTSHIFT", imd: 0.5 },
      { id: "j3", action: "job.open", title: "Put the company on the web", paidAt: "2026-10-21T00:00:00.000Z", by: "LeadNest", imd: 0.5 },
    ] });
    await l.refresh();
    const c = await l.get();
    expect(c.jobs.map((j) => [j.id, j.by])).toEqual([["j3", "LeadNest"], ["j1", "NIGHTSHIFT"], ["j2", "NIGHTSHIFT"]]);
    expect(c.paidImd).toBe(1.5);
    expect(c.seats).toBe(3);
  });
});
