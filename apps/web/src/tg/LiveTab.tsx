import { useEffect, useState } from "react";
import { Icon } from "../Icon";
import { go } from "../router";
import { type LiveGame, useLiveGames } from "../games/live";
import { useTg } from "./TgApp";
import { haptic } from "./telegram";

/** Live: every free game being played now, both games, with a Watch view inside the Mini App. */
const since = (at: number, now: number) => { const s = Math.floor((now - at) / 1000); return s < 0 ? "starting" : s < 60 ? `${s}s` : `${Math.floor(s / 60)}m`; };

export function LiveTab() {
  const games = useLiveGames(5_000);
  const { link, share } = useTg();
  const [now, setNow] = useState(Date.now());
  const [filter, setFilter] = useState<"all" | "chess" | "pinball">("all");
  useEffect(() => { const t = setInterval(() => setNow(Date.now()), 1_000); return () => clearInterval(t); }, []);
  // the Mini App shows free games only: no stakes, no tokens
  const free = (games ?? []).filter((g) => g.stake.currency === "FREE");
  const list = free.filter((g) => filter === "all" || g.game === filter);
  const watch = (g: LiveGame) => { haptic.tap(); go(`/tg/watch/${g.game}/${g.id}`); };
  return <div className="tgx-page">
    <section className="tgx-hero sm">
      <span className="tgx-kicker"><i className="tgx-live" /> LIVE NOW · {games ? free.length : "…"}</span>
      <h1>Pull up a <em>chair</em>.</h1>
      <p>Every game on the night shift, as it is played. Read-only: nobody in the stands touches a piece.</p>
    </section>
    <div className="tgx-seg three" role="tablist" aria-label="Filter">{(["all", "chess", "pinball"] as const).map((f) => <button type="button" role="tab" key={f} aria-selected={filter === f} className={filter === f ? "on" : ""} onClick={() => { haptic.select(); setFilter(f); }}><span>{f === "all" ? "ALL" : f === "chess" ? "CHESS" : "PINBALL"}</span></button>)}</div>
    {games === null ? <p className="tgx-note">Looking for live games…</p> : !list.length ? <div className="tgx-card tgx-empty-card"><Icon name="radar" size={26} /><p>No games right now. Start one from Play and the night crew can watch it here.</p><button type="button" className="tgx-btn" onClick={() => go("/tg")}>Play now</button></div>
      : <ul className="tgx-list live">{list.map((g) => {
        const [a, b] = g.players;
        return <li key={`${g.game}-${g.id}`} className="tgx-row">
          <span className={`tgx-gi ${g.game}`}><Icon name={g.game === "chess" ? "chess-knight" : "orbit"} size={17} /></span>
          <button type="button" className="tgx-who as-btn" onClick={() => watch(g)}>
            <b>{a?.name ?? "Player"}<em>vs</em>{b?.name ?? "Player"}{g.players.some((p) => p.agent) && <i className="tgx-tag">AGENT</i>}</b>
            <small>{g.game === "chess" ? `CHESS${g.tc ? ` · ${g.tc}` : ""}` : "PINBALL"} · RATED</small>
            <small><Icon name="user" size={11} />{g.viewers} watching · {since(g.startedAt, now)}</small>
          </button>
          <span className="tgx-row-tools">
            <button type="button" className="tgx-icon" aria-label={`Share ${a?.name ?? ""} vs ${b?.name ?? ""}`} onClick={() => share(link(`watch_${g.game}_${g.id}`), `👀 Watch ${a?.name ?? ""} vs ${b?.name ?? ""} live`)}><Icon name="external" size={15} /></button>
            <button type="button" className="tgx-btn small" onClick={() => watch(g)}><Icon name="radar" size={14} />Watch</button>
          </span>
        </li>;
      })}</ul>}
  </div>;
}
