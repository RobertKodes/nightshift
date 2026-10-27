import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { writeAtomic } from "./atomic.js";
import { config } from "./config.js";
import { FORGED_ID } from "./forge.js";
import { seasonStartOf } from "./league.js";

/**
 * COMMAND ROOM missions: each week a NIGHT FROGS holder sends their frogs out on missions. A
 * mission is a real thing done on NIGHTSHIFT that the server can check (an agent trading in the
 * Night League, beating the league's benchmark, a rated chess game). When it is done, the frog that crewed it
 * brings back bonus shift hours: the mission's base hours times that frog's multiplier (7 for #1,
 * 3 for #2–25, 2 for Genesis, 1 for the rest). One frog per mission, one mission per frog, each
 * mission once a week; a Night Watcher (`crew`, forged from 10) leads every mission with its tier's
 * multiplier, so forging never costs a wallet missions. Shift hours are the same points soft staking already pays.
 */
export type Facts = {
  /** Trades this season by the wallet's own league agents. */
  leagueTrades: number;
  /** Best league return of the wallet's agents, and the IMD Holder benchmark's. */
  leagueBestPct: number | null; benchmarkPct: number | null;
  /** Rated arena games, all time, of the wallet's agents. */
  arenaGames: number;
};
export type MissionDef = { id: string; title: string; brief: string; hours: number; station: "league" | "arena"; done: (f: Facts, baseline: Facts) => boolean; progress: (f: Facts, baseline: Facts) => string; link: string };

export const MISSIONS: MissionDef[] = [
  { id: "desk-duty", title: "Desk duty", station: "league", hours: 24, link: "/league", brief: "Your agent makes 3 trades in this week's Night League.",
    done: (f) => f.leagueTrades >= 3, progress: (f) => `${Math.min(3, f.leagueTrades)}/3 trades` },
  { id: "beat-the-holder", title: "Beat the holder", station: "league", hours: 48, link: "/league", brief: "Your best agent is ahead of the IMD Holder benchmark when you report back.",
    done: (f) => f.leagueBestPct !== null && f.benchmarkPct !== null && f.leagueTrades > 0 && f.leagueBestPct > f.benchmarkPct,
    progress: (f) => f.leagueBestPct === null ? "no agent in the league" : `${f.leagueBestPct.toFixed(2)}% vs ${f.benchmarkPct?.toFixed(2) ?? "?"}%` },
  { id: "board-watch", title: "Board watch", station: "arena", hours: 24, link: "/arena", brief: "One of your agents plays a rated NIGHT CHESS game after the frog sets out.",
    done: (f, b) => f.arenaGames > b.arenaGames, progress: (f, b) => `${Math.max(0, f.arenaGames - b.arenaGames)}/1 game` },
];

const label = (id: number) => (id === FORGED_ID ? "The Captain" : id > FORGED_ID ? `Night Watcher #${id - FORGED_ID}` : `Frog #${id}`);
type Crew = { id: number; multiplier: number; crew?: boolean };
type Run = { mission: string; frog: number; startedAt: number; baseline: Facts; doneAt: number | null; hours: number };
type State = { week: number; runs: Record<string, Run[]>; total: Record<string, number> };
export class MissionError extends Error { constructor(public status: number, message: string, public code: string) { super(message); } }

export class Missions {
  private s: State;
  constructor(private file: string | null, private now: () => number = Date.now) {
    const fresh: State = { week: seasonStartOf(now()), runs: {}, total: {} };
    let s = fresh;
    try { if (file && existsSync(file)) s = { ...fresh, ...JSON.parse(readFileSync(file, "utf8")) }; } catch { s = fresh; }
    this.s = s;
  }
  private save() { if (this.file) writeAtomic(this.file, JSON.stringify(this.s)); }
  private roll() { const w = seasonStartOf(this.now()); if (w > this.s.week) { this.s.week = w; this.s.runs = {}; this.save(); } }

  board(wallet: string, frogs: Crew[], facts: Facts) {
    this.roll();
    const w = wallet.toLowerCase(), runs = this.s.runs[w] ?? [];
    return {
      week: { startedAt: this.s.week, endsAt: this.s.week + 7 * 86_400_000 }, hoursEarned: this.s.total[w] ?? 0,
      frogs: frogs.map((f) => ({ ...f, on: runs.find((r) => r.frog === f.id)?.mission ?? null })),
      missions: MISSIONS.map((m) => {
        const r = runs.find((x) => x.mission === m.id);
        return { id: m.id, title: m.title, brief: m.brief, station: m.station, link: m.link, hours: m.hours,
          frog: r?.frog ?? null, bonus: r ? m.hours * (frogs.find((f) => f.id === r.frog)?.multiplier ?? 1) : null,
          state: !r ? "open" : r.doneAt ? "done" : m.done(facts, r.baseline) ? "ready" : "underway",
          progress: m.progress(facts, r?.baseline ?? facts), earned: r?.doneAt ? r.hours : 0 };
      }),
    };
  }

  /** Sends one of the wallet's frogs on a mission. */
  start(wallet: string, frogs: Crew[], missionId: string, frogId: number, facts: Facts): void {
    this.roll();
    const w = wallet.toLowerCase();
    if (!MISSIONS.some((m) => m.id === missionId)) throw new MissionError(400, "No such mission.", "bad_input");
    if (!frogs.some((f) => f.id === frogId)) throw new MissionError(403, "That frog is not in your wallet (holdings are read every hour).", "not_your_frog");
    const runs = (this.s.runs[w] ??= []);
    if (runs.some((r) => r.mission === missionId)) throw new MissionError(409, "That mission is already crewed this week.", "taken");
    // the week counts per frog, not per wallet: a frog passed to another wallet cannot crew the same week again
    const crew = frogs.find((f) => f.id === frogId)!.crew;
    if (Object.values(this.s.runs).flat().some((r) => r.frog === frogId && (r.mission === missionId || !crew))) throw new MissionError(409, `${label(frogId)} is already out on a mission this week.`, "busy");
    runs.push({ mission: missionId, frog: frogId, startedAt: this.now(), baseline: facts, doneAt: null, hours: 0 });
    this.save();
  }

  /** Every frog sent out this week, by any wallet: who sent it, on what, since when and whether it is home. The Ship's mission bay reads it. */
  out(): { wallet: string; frog: number; mission: string; startedAt: number; done: boolean }[] {
    this.roll();
    return Object.entries(this.s.runs).flatMap(([wallet, runs]) => runs.map((r) => ({ wallet, frog: r.frog, mission: r.mission, startedAt: r.startedAt, done: r.doneAt !== null })));
  }

  /** Brings a finished mission home: returns the hours to credit (0 if it is not done yet). */
  report(wallet: string, frogs: Crew[], missionId: string, facts: Facts): number {
    this.roll();
    const w = wallet.toLowerCase();
    const r = (this.s.runs[w] ?? []).find((x) => x.mission === missionId);
    const m = MISSIONS.find((x) => x.id === missionId);
    if (!r || !m) throw new MissionError(404, "No frog is on that mission this week.", "not_started");
    if (r.doneAt) throw new MissionError(409, "Already reported.", "done");
    const frog = frogs.find((f) => f.id === r.frog);
    if (!frog) throw new MissionError(403, `${label(r.frog)} has left your wallet; its mission cannot be reported.`, "frog_gone");
    if (!m.done(facts, r.baseline)) throw new MissionError(409, `Not done yet: ${m.progress(facts, r.baseline)}.`, "not_done");
    r.doneAt = this.now(); r.hours = m.hours * frog.multiplier;
    this.s.total[w] = (this.s.total[w] ?? 0) + r.hours;
    this.save();
    return r.hours;
  }
}

let missions: Missions | null = null;
export const liveMissions = () => (missions ??= new Missions(join(config.dataDir, "missions.json")));
