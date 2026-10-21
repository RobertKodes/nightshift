import { useState } from "react";
import { LiveList, useLiveGames } from "./games/live";
import { Link } from "./router";

const FILTERS = [["all", "All games"], ["chess", "Night Chess"], ["pool", "Night Pool"], ["pinball", "Space Pinball"]] as const;

/** Watch live: every match being played right now, in every game. Spectators only read. */
export function LivePage() {
  const games = useLiveGames(5_000);
  const [only, setOnly] = useState<(typeof FILTERS)[number][0]>("all");
  const shown = games && (only === "all" ? games : games.filter((g) => g.game === only));
  const watching = games?.reduce((n, g) => n + g.viewers, 0) ?? 0;
  return (
    <div className="docs token-page games-page lv-page">
      <Link to="/games" className="eyebrow lv-back">← GAME ROOM</Link>
      <h1>Watch live</h1>
      <p className="lead">Every game being played right now, move by move and ball by ball. Spectators only watch.</p>
      <section className="tkn-card" aria-labelledby="lv-title">
        <div className="tkn-head"><div><b id="lv-title">LIVE NOW</b><span>{games === null ? "Connecting…" : `${games.length} game${games.length === 1 ? "" : "s"} · ${watching} watching`}</span></div><span className={`tkn-state ${games?.length ? "on" : ""}`}>{games?.length ? "LIVE" : "NO GAMES NOW"}</span></div>
        <div className="lv-filters" role="group" aria-label="Game">{FILTERS.map(([k, label]) => <button type="button" key={k} aria-pressed={only === k} className={only === k ? "on" : ""} onClick={() => setOnly(k)}>{label}</button>)}</div>
        <LiveList games={shown} />
      </section>
      <p className="lv-note">Up to 200 spectators per game. A pinball table's seed is shown only once the duel is settled.</p>
    </div>
  );
}
