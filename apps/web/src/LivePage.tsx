import { useState } from "react";
import { LiveList, useLiveGames } from "./games/live";

const FILTERS = [["all", "All games"], ["chess", "Night Chess"], ["pinball", "Space Pinball"]] as const;

/** Watch live: every match being played right now, in both games. Spectators only read. */
export function LivePage() {
  const games = useLiveGames(5_000);
  const [only, setOnly] = useState<(typeof FILTERS)[number][0]>("all");
  const shown = games && (only === "all" ? games : games.filter((g) => g.game === only));
  const watching = games?.reduce((n, g) => n + g.viewers, 0) ?? 0;
  return (
    <div className="docs token-page games-page lv-page">
      <span className="eyebrow">GAME ROOM · WATCH LIVE</span>
      <h1>Watch live. <em>Every game, as it happens.</em></h1>
      <p className="lead">Pick a table and pull up a chair. You see what the players see, move by move and ball by ball, straight from the server. Spectators only watch: nobody in the stands can move a piece or touch a flipper.</p>
      <section className="tkn-card" aria-labelledby="lv-title">
        <div className="tkn-head"><div><b id="lv-title">LIVE NOW</b><span>{games === null ? "Connecting…" : `${games.length} game${games.length === 1 ? "" : "s"} · ${watching} watching`}</span></div><span className={`tkn-state ${games?.length ? "on" : ""}`}>{games?.length ? "LIVE" : "QUIET"}</span></div>
        <div className="lv-filters" role="group" aria-label="Game">{FILTERS.map(([k, label]) => <button type="button" key={k} aria-pressed={only === k} className={only === k ? "on" : ""} onClick={() => setOnly(k)}>{label}</button>)}</div>
        <LiveList games={shown} />
      </section>
      <p className="lv-note">Up to 200 spectators per game. A pinball table's seed is shown only once the duel is settled.</p>
    </div>
  );
}
