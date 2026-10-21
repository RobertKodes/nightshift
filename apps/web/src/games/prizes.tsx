import { useEffect, useState } from "react";
import { authHeaders } from "../api";
import { Icon } from "../Icon";
import { Link } from "../router";
import "./prizes.css";

/**
 * This week's prizes in shift hours (GET /api/games/prizes): the top three of NIGHT CHESS, NIGHT POOL
 * and Space Pinball, a countdown to Monday 00:00 UTC, and the rules in two plain lines. Names only;
 * the signed-in wallet's own row is marked. PrizeLines lists a winner's own prizes for the rewards hub.
 */
export type PrizeGame = "chess" | "pool" | "pinball";
type Row = { place: number; name: string; hours: number; wins?: number; opponents?: number; score?: number; you?: true };
type Mine = { game: PrizeGame; place: number; hours: number; result: string; week: number; payAt: number; paidAt: number | null; voided: boolean };
export type Prizes = {
  on: boolean; week: { startedAt: number; endsAt: number }; now: number; hours: number[]; rules: string[];
  games: Record<PrizeGame, Row[]>; last: { game: PrizeGame; place: number; name: string; hours: number; result: string; payAt: number; paid: boolean; voided: boolean }[]; mine: Mine[];
};
const NAME: Record<PrizeGame, string> = { chess: "NIGHT CHESS", pool: "NIGHT POOL", pinball: "SPACE PINBALL" };
const ICON: Record<PrizeGame, string> = { chess: "chess-knight", pool: "pool", pinball: "orbit" };
const PLACE = ["1st", "2nd", "3rd"];

/** The prizes, read every minute while the page is visible (null until the first answer). */
export function usePrizes(every = 60_000): { p: Prizes | null; skew: number } {
  const [state, setState] = useState<{ p: Prizes | null; skew: number }>({ p: null, skew: 0 });
  useEffect(() => {
    let live = true;
    const load = () => { if (document.hidden) return; void fetch("/api/games/prizes", { headers: authHeaders() }).then((r) => r.ok ? r.json() : null).then((p: Prizes | null) => { if (live && p) setState({ p, skew: p.now - Date.now() }); }).catch(() => {}); };
    load();
    const t = setInterval(load, every);
    addEventListener("visibilitychange", load);
    return () => { live = false; clearInterval(t); removeEventListener("visibilitychange", load); };
  }, [every]);
  return state;
}
function useNow(ms = 1_000) { const [now, setNow] = useState(Date.now()); useEffect(() => { const t = setInterval(() => setNow(Date.now()), ms); return () => clearInterval(t); }, [ms]); return now; }
export const leftText = (ms: number) => {
  const s = Math.max(0, Math.floor(ms / 1000)), d = Math.floor(s / 86_400), h = Math.floor((s % 86_400) / 3_600), m = Math.floor((s % 3_600) / 60);
  return d ? `${d}d ${String(h).padStart(2, "0")}h ${String(m).padStart(2, "0")}m` : `${String(h).padStart(2, "0")}h ${String(m).padStart(2, "0")}m ${String(s % 60).padStart(2, "0")}s`;
};
const resultOf = (g: PrizeGame, r: Row) => g === "pinball" ? `${(r.score ?? 0).toLocaleString("en-US")} pts` : `${r.wins} win${r.wins === 1 ? "" : "s"}${r.opponents && r.opponents > 1 ? ` · ${r.opponents} rivals` : ""}`;

/** "This week's prizes": every game (the Game Room) or one game (its own page). */
export function WeeklyPrizes({ game }: { game?: PrizeGame }) {
  const { p, skew } = usePrizes();
  const now = useNow() + skew;
  if (!p?.on) return null;
  const games: PrizeGame[] = game ? [game] : ["chess", "pool", "pinball"];
  return <section className={`wkp ${game ? "wkp-one" : ""}`} aria-labelledby={`wkp-title-${game ?? "all"}`}>
    <div className="wkp-head">
      <div><b id={`wkp-title-${game ?? "all"}`}><Icon name="trophy" size={15} />THIS WEEK'S PRIZES</b><span>{p.hours.slice(0, 3).map((h, i) => `${PLACE[i]} +${h} h`).join(" · ")} in shift hours{game ? "" : ", per game"}</span></div>
      <span className="wkp-clock" role="timer" aria-label={`The week ends in ${leftText(p.week.endsAt - now)}`}><Icon name="clock" size={13} />ENDS IN {leftText(p.week.endsAt - now)}</span>
    </div>
    <div className="wkp-games">
      {games.map((g) => <div key={g} className="wkp-game">
        {!game && <span className="wkp-kind"><Icon name={ICON[g]!} size={15} />{NAME[g]}</span>}
        {p.games[g].length ? <ol className="wkp-rows">{p.games[g].map((r) => <li key={r.place} className={`wkp-row p${r.place} ${r.you ? "you" : ""}`}>
          <span className="wkp-place">{PLACE[r.place - 1]}</span><b>{r.name}{r.you && <i>YOU</i>}</b><small>{resultOf(g, r)}</small><strong>+{r.hours} h</strong>
        </li>)}</ol> : <p className="wkp-empty">{g === "pinball" ? "No solo score yet this week: sign in and the first run takes 1st." : "No rated win yet this week: sign in and the first one takes 1st."}</p>}
      </div>)}
    </div>
    <div className="wkp-rules">{p.rules.map((r) => <p key={r}>{r}</p>)}</div>
    {!game && p.last.some((a) => !a.voided) && <p className="wkp-last">Last week: {p.last.filter((a) => !a.voided && a.place === 1).map((a) => `${NAME[a.game]} ${a.name} +${a.hours} h`).join(" · ")}{p.last.some((a) => !a.paid && !a.voided) ? ` (added ${new Date(Math.max(...p.last.map((a) => a.payAt))).toLocaleString("en-GB", { weekday: "short", hour: "2-digit", minute: "2-digit", timeZone: "UTC" })} UTC)` : ""}</p>}
  </section>;
}

/** A winner's own prizes, for the rewards hub: "+24 shift hours", added or on the way. */
export function PrizeLines({ wallet }: { wallet: string }) {
  const [mine, setMine] = useState<Mine[] | null>(null);
  useEffect(() => {
    let live = true;
    void fetch("/api/games/prizes", { headers: authHeaders() }).then((r) => r.ok ? r.json() : null).then((p: Prizes | null) => { if (live) setMine(p?.mine ?? []); }).catch(() => {});
    return () => { live = false; };
  }, [wallet]);
  const shown = (mine ?? []).filter((m) => !m.voided).slice(0, 4);
  if (!shown.length) return null;
  const day = (t: number) => new Date(t).toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "UTC" });
  return <ul className="wkp-mine" aria-label="Your weekly game prizes">
    {shown.map((m) => <li key={`${m.week}-${m.game}`}>
      <Icon name="trophy" size={15} /><b>+{m.hours} shift hours</b>
      <span>{NAME[m.game]} weekly prize, {PLACE[m.place - 1]} · {m.result}</span>
      <small>{m.paidAt ? `added ${day(m.paidAt)}` : `added ${day(m.payAt)} after the 48 h hold`}</small>
      <Link to={`/games/${m.game}`}>Play</Link>
    </li>)}
  </ul>;
}
