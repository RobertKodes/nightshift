import { useState } from "react";
import { LiveList, useLiveGames } from "./games/live";
import { Link } from "./router";
import SplitFlapText from "./rb/SplitFlapText";
import { PxHero, PxPanel, PxTag } from "./saas/kit";
import { LxBg, useRich } from "./saas/pages/learn-kit";
import "./saas/pages/learn.css";
import "./saas/pages/arcade.css";

const FILTERS = [["all", "All games"], ["chess", "Night Chess"], ["pool", "Night Pool"], ["poker", "Night Poker"], ["pinball", "Space Pinball"]] as const;
const flap = (n: number | null) => (n === null ? "---" : String(Math.min(n, 999)).padStart(3, "0"));

/** Watch games: every match being played right now, in every game. Spectators only read. */
export function LivePage() {
  const games = useLiveGames(5_000);
  const rich = useRich();
  const [only, setOnly] = useState<(typeof FILTERS)[number][0]>("all");
  const shown = games && (only === "all" ? games : games.filter((g) => g.game === only));
  const watching = games?.reduce((n, g) => n + g.viewers, 0) ?? 0;
  return (
    <div className="lx gx gx-watch">
      <Link to="/games" className="px-more gx-back">← GAME ROOM</Link>
      <PxHero
        kicker="GAME ROOM · SPECTATORS"
        title="Watch"
        accent="games"
        live
        bg={<LxBg rich={rich} />}
        lead="Every game being played right now, move by move, ball by ball and hand by hand. Spectators only watch."
        aside={
          <aside className="gx-marquee" aria-label="Live right now">
            <div className="px-term-h">
              <span className="px-term-dots" aria-hidden="true"><i /><i /><i /></span>
              <b>SPECTATOR BOARD</b>
              <span className="px-term-state"><i />{games === null ? "CONNECTING" : "EVERY 5 S"}</span>
            </div>
            <div className="gx-marquee-b">
              <div className="gx-nums">
                <div className="lx-board"><span>GAMES LIVE</span><SplitFlapText text={flap(games ? games.length : null)} padTo={3} charset="0123456789-" tileColor="#0d1410" textColor="#b8ff3d" fontSize={24} gap={3} tileRadius={2} flipDuration={0.18} stagger={0.02} intro={false} /></div>
                <div className="lx-board"><span>WATCHING</span><SplitFlapText text={flap(games ? watching : null)} padTo={3} charset="0123456789-" tileColor="#0d1410" textColor="#e9f4ea" fontSize={24} gap={3} tileRadius={2} flipDuration={0.18} stagger={0.02} intro={false} /></div>
              </div>
            </div>
            <div className="px-term-f"><span>root@nightshift:~$</span><span>watch --all --read-only</span><span className="px-term-cursor" aria-hidden="true" /></div>
          </aside>
        }
      />
      <section className="lx-sec" aria-labelledby="lv-title">
        <PxPanel
          title={<span id="lv-title">LIVE NOW</span>}
          state={games?.length ? "live" : undefined}
          right={games === null ? "Connecting…" : `${games.length} game${games.length === 1 ? "" : "s"} · ${watching} watching`}
          className="gx-live-panel"
        >
          {!games?.length && <div className="gx-none"><PxTag tone="dim">NO GAMES NOW</PxTag></div>}
          <div className="gx-filters" role="group" aria-label="Game">{FILTERS.map(([k, label]) => <button type="button" key={k} aria-pressed={only === k} className={only === k ? "on" : ""} onClick={() => setOnly(k)}>{label}</button>)}</div>
          <LiveList games={shown} />
        </PxPanel>
      </section>
      <p className="gx-note">Up to 200 spectators per game. A pinball table's seed is shown only once the duel is settled; a poker hand's cards only at a showdown.</p>
    </div>
  );
}
