import { useState } from "react";
import { Icon } from "../Icon";
import { type GameStats, type Me, tg } from "./api";
import { useTg } from "./TgApp";
import { haptic, openLink } from "./telegram";

/** Me: the Telegram profile (name, photo, Elo per game, record, streaks) and the DMs. */
const month = (at: number) => new Date(at).toLocaleDateString("en-US", { month: "short", year: "numeric" });
const ago = (at: number) => { const m = Math.floor((Date.now() - at) / 60_000); return m < 1 ? "now" : m < 60 ? `${m}m` : m < 1440 ? `${Math.floor(m / 60)}h` : `${Math.floor(m / 1440)}d`; };

function Stat({ icon, name, s }: { icon: string; name: string; s: GameStats }) {
  const rate = s.played ? Math.round((s.wins / s.played) * 100) : 0;
  return <div className="tgx-stat">
    <div className="tgx-stat-head"><Icon name={icon} size={17} /><span>{name}</span></div>
    <strong>{s.elo}<small>ELO</small></strong>
    <div className="tgx-bar" aria-label={`${rate}% wins`}><i style={{ width: `${rate}%` }} /></div>
    <dl><div><dt>Games</dt><dd>{s.played}</dd></div><div><dt>W · L · D</dt><dd>{s.wins} · {s.losses} · {s.draws}</dd></div><div><dt>Best run</dt><dd>{s.best}</dd></div></dl>
  </div>;
}

export function MeTab() {
  const { me, setMe } = useTg();
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  if (!me) return null;
  const p = me.profile;
  const save = async () => {
    setBusy(true); setErr(null);
    try { setMe(await tg<Me>("me", { name })); setEditing(false); haptic.win(); } catch (e) { setErr((e as Error).message); haptic.error(); } finally { setBusy(false); }
  };
  const initial = (p.name.match(/[A-Za-z0-9]/)?.[0] ?? "N").toUpperCase();
  return <div className="tgx-page">
    <section className="tgx-profile">
      <span className="tgx-avatar">{p.photo ? <img src={p.photo} alt="" width="72" height="72" referrerPolicy="no-referrer" /> : <b>{initial}</b>}</span>
      <div className="tgx-profile-who">
        {editing ? <form className="tgx-name-edit" onSubmit={(e) => { e.preventDefault(); void save(); }}>
          <input autoFocus value={name} maxLength={18} onChange={(e) => setName(e.target.value)} aria-label="Display name" />
          <button type="submit" className="tgx-btn small" disabled={busy}>Save</button>
          <button type="button" className="tgx-btn small ghost" onClick={() => setEditing(false)}>Cancel</button>
        </form> : <h1>{p.name}<button type="button" className="tgx-icon" aria-label="Edit your name" onClick={() => { setName(p.name); setEditing(true); }}><Icon name="edit" size={15} /></button></h1>}
        <span className="tgx-kicker">NIGHT CREW SINCE {month(p.joinedAt).toUpperCase()}</span>
        <span className="tgx-streak"><Icon name="flame" size={14} />{p.streak} win streak · best {p.bestStreak}</span>
      </div>
    </section>
    {err && <p className="tgx-err" role="alert"><Icon name="alert" size={15} />{err}</p>}
    <div className="tgx-stats">
      <Stat icon="chess-knight" name="NIGHT CHESS" s={p.games.chess} />
      <Stat icon="orbit" name="SPACE PINBALL" s={p.games.pinball} />
    </div>

    <section className="tgx-card">
      <div className="tgx-label"><span>RECENT GAMES</span><Icon name="clock" size={14} /></div>
      {!p.recent.length ? <p className="tgx-empty">No games yet. Your first result shows up here.</p>
        : <ul className="tgx-list">{p.recent.map((r, i) => <li key={`${r.id}-${i}`} className={`tgx-row res ${r.result}`}>
          <span className={`tgx-res ${r.result}`}>{r.result === "win" ? "W" : r.result === "loss" ? "L" : "D"}</span>
          <span className="tgx-who"><b>vs {r.vs}</b><small>{r.game === "chess" ? `CHESS${r.tc ? ` · ${r.tc}` : ""}` : "PINBALL"}{r.reason ? ` · ${r.reason}` : ""} · {ago(r.at)}</small></span>
          <span className={`tgx-delta ${r.change >= 0 ? "up" : "down"}`}>{r.change >= 0 ? "+" : ""}{r.change}<small>{r.elo}</small></span>
        </li>)}</ul>}
    </section>

    <section className="tgx-card">
      <div className="tgx-label"><span>NOTIFICATIONS</span><Icon name="bolt" size={14} /></div>
      {p.dm ? <p className="tgx-wallet"><Icon name="check" size={16} /><span>The bot DMs you when someone joins your game and when a game ends. Send /quiet to the bot to stop.</span></p>
        : <><p className="tgx-note">Get a DM when someone joins your game or accepts your challenge, and the result of every game. Press Start in the bot to turn it on.</p>
          <button type="button" className="tgx-btn ghost" onClick={() => openLink(me.bot.start)}><Icon name="external" size={16} />Open @{me.bot.username}</button></>}
    </section>
    <p className="tgx-legal">Your Telegram id stays on the server: other players see your display name and Elo only. Your photo is shown to you alone.</p>
  </div>;
}
