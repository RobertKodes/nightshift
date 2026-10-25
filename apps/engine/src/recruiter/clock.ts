/**
 * Time for the owner: everything is stored in UTC, and shown or scheduled in Europe/Bucharest
 * (EET in winter, EEST in summer), with the daylight-saving changes handled by Intl.
 */
export const OWNER_TZ = "Europe/Bucharest";
export const MIN = 60_000, HOUR = 60 * MIN, DAY = 24 * HOUR;

const fmt = new Intl.DateTimeFormat("en-US", { timeZone: OWNER_TZ, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23" });

export type Local = { y: number; m: number; d: number; hh: number; mm: number; ss: number; day: string };

/** The owner's wall clock at instant `t`. */
export function local(t: number): Local {
  const p: Record<string, string> = {};
  for (const x of fmt.formatToParts(t)) p[x.type] = x.value;
  const y = Number(p.year), m = Number(p.month), d = Number(p.day), hh = Number(p.hour) % 24, mm = Number(p.minute), ss = Number(p.second);
  return { y, m, d, hh, mm, ss, day: `${p.year}-${p.month}-${p.day}` };
}

/** How far the owner's clock is ahead of UTC at instant `t`, in ms. */
function offset(t: number): number {
  const l = local(t);
  return Date.UTC(l.y, l.m - 1, l.d, l.hh, l.mm, l.ss) - Math.floor(t / 1000) * 1000;
}

/** The UTC instant of a wall-clock time in Bucharest (month 1-12). */
export function localToUtc(y: number, m: number, d: number, hh: number, mm = 0): number {
  const guess = Date.UTC(y, m - 1, d, hh, mm);
  const first = guess - offset(guess);
  return guess - offset(first);
}

/** The next day's date in Bucharest, as numbers. */
export function nextDay(l: Pick<Local, "y" | "m" | "d">): { y: number; m: number; d: number } {
  const t = new Date(Date.UTC(l.y, l.m - 1, l.d + 1));
  return { y: t.getUTCFullYear(), m: t.getUTCMonth() + 1, d: t.getUTCDate() };
}

/** "2026-10-25 09:00" on the owner's clock. */
export function fmtLocal(t: number): string {
  const l = local(t);
  return `${l.day} ${String(l.hh).padStart(2, "0")}:${String(l.mm).padStart(2, "0")}`;
}

/** An instant as both clocks, for the dashboard. */
export const stamp = (t: number) => ({ utc: new Date(t).toISOString(), bucharest: `${fmtLocal(t)} (${OWNER_TZ})` });

/** The UTC day key used by the counters. */
export const utcDay = (t: number) => new Date(t).toISOString().slice(0, 10);
