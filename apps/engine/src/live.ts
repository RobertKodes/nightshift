/**
 * Who is on the site right now, without storing anyone: unique client addresses seen in the last
 * 5 minutes (bots left out), and pages holding a live connection open. Kept in memory only.
 */
const seen = new Map<string, number>();
let open = 0;
const BOT = /bot|crawl|spider|slurp|preview|monitor|curl|wget|python|headless|lighthouse|facebookexternalhit|embed/i;

export function sawVisitor(ip: string, ua: string | undefined, now = Date.now()): void {
  if (!ip || BOT.test(ua ?? "")) return;
  seen.set(ip, now);
  if (seen.size > 50_000) for (const [k, t] of seen) if (now - t > 300_000) seen.delete(k);
}
export const pageOpened = () => { open++; };
export const pageClosed = () => { open = Math.max(0, open - 1); };

export function liveStats(now = Date.now()): { visitors5m: number; visitors1m: number; openPages: number } {
  let five = 0, one = 0;
  for (const [k, t] of seen) {
    if (now - t > 300_000) { seen.delete(k); continue; }
    five++;
    if (now - t <= 60_000) one++;
  }
  return { visitors5m: five, visitors1m: one, openPages: open };
}
