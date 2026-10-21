import { useEffect, useState } from "react";
import { Icon } from "../Icon";
import { Link } from "../router";
import { tokenLabel } from "../stakes";
import "./live.css";

/** A game being played right now, as GET /api/games/live lists it. */
export type LiveGame = {
  game: "chess" | "pinball" | "pool"; id: string; players: { name: string; avatar?: string; agent?: boolean }[];
  stake: { currency: "FREE" | "IMD" | "SHIFT"; amount: number }; startedAt: number; watch: string; viewers: number; tc?: string; rules?: string;
  /** The house exhibition: two house bots, never rated, staked or bet on. */
  house?: boolean;
};

/** The live list, polled while the page is visible. `null` until the first answer. */
export function useLiveGames(every = 8_000): LiveGame[] | null {
  const [games, setGames] = useState<LiveGame[] | null>(null);
  useEffect(() => {
    let live = true;
    const load = () => { if (document.hidden) return; void fetch("/api/games/live").then((r) => r.ok ? r.json() : null).then((d) => { if (live && d) setGames(d.games ?? []); }).catch(() => { if (live) setGames((g) => g ?? []); }); };
    load();
    const t = setInterval(load, every);
    addEventListener("visibilitychange", load);
    return () => { live = false; clearInterval(t); removeEventListener("visibilitychange", load); };
  }, [every]);
  return games;
}

export const stakeText = (s: LiveGame["stake"]) => s.currency === "FREE" ? "FREE" : `${s.amount.toLocaleString()} ${tokenLabel(s.currency)}`;
const since = (at: number, now: number) => {
  const s = Math.floor((now - at) / 1000);
  return s < 0 ? "starting" : s < 60 ? `${s}s` : `${Math.floor(s / 60)}m ${String(s % 60).padStart(2, "0")}s`;
};
function useNow(ms = 1_000) { const [now, setNow] = useState(Date.now()); useEffect(() => { const t = setInterval(() => setNow(Date.now()), ms); return () => clearInterval(t); }, [ms]); return now; }

/** One live game: the game, who plays, for what, how many watch, and the way in. */
export function LiveRow({ g, now }: { g: LiveGame; now: number }) {
  const [a, b] = g.players;
  const who = (p?: LiveGame["players"][number]) => <span className="lv-name">{p?.name ?? "Player"}{p?.agent && <i className="lv-agent" title="An AI agent plays this seat">AGENT</i>}</span>;
  return <li className="lv-row">
    <span className={`lv-game ${g.game}`} aria-hidden="true"><Icon name={g.game === "chess" ? "chess-knight" : g.game === "pool" ? "pool" : "orbit"} size={20} /></span>
    <div className="lv-who">
      <span className="lv-kind">{g.game === "chess" ? `NIGHT CHESS${g.tc ? ` · ${g.tc}` : ""}` : g.game === "pool" ? `NIGHT POOL · ${g.rules === "quick" ? "QUICK" : "WPA"}` : "SPACE PINBALL"}{g.house && <i className="lv-house" title="Two house bots play an exhibition: never rated, never staked">HOUSE · exhibition, not rated</i>}</span>
      <b>{who(a)}<em>vs</em>{who(b)}</b>
    </div>
    <span className={`lv-stake ${g.stake.currency === "FREE" ? "" : "on"}`}>{g.house ? "EXHIBITION" : stakeText(g.stake)}</span>
    <span className="lv-meta"><span title="Spectators"><Icon name="user" size={13} />{g.viewers}</span><span title="Playing for"><Icon name="clock" size={13} />{since(g.startedAt, now)}</span></span>
    <Link to={g.watch} className="lv-watch"><Icon name="radar" size={15} /><span>WATCH</span></Link>
  </li>;
}

/** The games list, or what to do when nobody plays. */
export function LiveList({ games, limit }: { games: LiveGame[] | null; limit?: number }) {
  const now = useNow();
  if (games === null) return <p className="lv-empty" role="status">Looking for live games…</p>;
  if (!games.length) return <p className="lv-empty">No games right now. Start one: <Link to="/games/pool">Night Pool</Link>, <Link to="/games/chess">Night Chess</Link> or <Link to="/games/pinball">Space Pinball</Link>.</p>;
  return <ul className="lv-list" aria-live="polite">{games.slice(0, limit).map((g) => <LiveRow key={`${g.game}-${g.id}`} g={g} now={now} />)}</ul>;
}

/** The "Live now" strip on the Game Room page. */
export function LiveNow() {
  const games = useLiveGames();
  return <section className="tkn-card lv-strip" aria-labelledby="lv-strip-title">
    <div className="tkn-head"><div><b id="lv-strip-title">LIVE NOW</b><span>{games?.length ? `${games.length} game${games.length === 1 ? "" : "s"} being played · watch any of them` : "Every game, as it happens"}</span></div><span className={`tkn-state ${games?.length ? "on" : ""}`}>{games?.length ? "LIVE" : "QUIET"}</span></div>
    <LiveList games={games} limit={4} />
    {!!games?.length && <Link to="/games/live" className="lv-all">All live games<Icon name="arrow" size={15} /></Link>}
  </section>;
}
