import { useEffect, useRef, useState } from "react";
import { Icon } from "../Icon";
import { go } from "../router";
import { GAME_NAME, type Game, type LoungeFeed, TCS, type TimeControl, waitText } from "../games/lounge";
import { type InviteView, type Seated, tg } from "./api";
import { useTg } from "./TgApp";
import { practiceRecord } from "./TgChess";
import { haptic, shareInline } from "./telegram";

/** Play: the two games, the clock, the lounge's open tables and the seats to pick up. Every game here is free: rated, no stakes. */
const TC_INFO: Record<TimeControl, string> = { "3+2": "BLITZ +2s", "5+0": "BLITZ", "10+0": "RAPID" };

function useFeed(): LoungeFeed | null {
  const [feed, setFeed] = useState<LoungeFeed | null>(null);
  useEffect(() => {
    let on = true;
    const load = () => { if (!document.hidden) void tg<LoungeFeed>("lounge").then((f) => { if (on) setFeed(f); }).catch(() => {}); };
    load();
    const t = setInterval(load, 4_000);
    addEventListener("visibilitychange", load);
    return () => { on = false; clearInterval(t); removeEventListener("visibilitychange", load); };
  }, []);
  return feed;
}

type Entry = { name: string; score: number; at: number };
/** Space Pinball's solo board, the website's: tonight's (last 24 hours) and all-time best verified runs. */
function SoloBoard({ name, best, runs }: { name: string; best: number | null; runs: number }) {
  const [board, setBoard] = useState<{ solo: Entry[]; soloBest: Entry[] } | null>(null);
  const [tab, setTab] = useState<"solo" | "soloBest">("solo");
  useEffect(() => {
    let on = true;
    const load = () => { if (!document.hidden) void fetch("/api/pinball/board").then((r) => r.json()).then((b) => { if (on) setBoard(b as { solo: Entry[]; soloBest: Entry[] }); }).catch(() => {}); };
    load();
    const t = setInterval(load, 30_000);
    return () => { on = false; clearInterval(t); };
  }, []);
  const rows = (board?.[tab] ?? []).slice(0, 10);
  return <section className="tgx-card" aria-label="Solo board">
    <div className="tgx-label"><span>SOLO BOARD</span><span className="tgx-mini" role="tablist" aria-label="Board">{([["solo", "TONIGHT"], ["soloBest", "ALL TIME"]] as const).map(([k, l]) => <button type="button" role="tab" key={k} aria-selected={tab === k} className={tab === k ? "on" : ""} onClick={() => { haptic.select(); setTab(k); }}>{l}</button>)}</span></div>
    {best !== null && <p className="tgx-best"><Icon name="trophy" size={15} /><span>Your best <b>{best.toLocaleString()}</b> · {runs} solo {runs === 1 ? "run" : "runs"}</span></p>}
    {!board ? <p className="tgx-note">Reading the board…</p> : !rows.length ? <p className="tgx-empty">No verified solo runs {tab === "solo" ? "tonight" : "yet"}. Play solo and take the top spot.</p>
      : <ol className="tgx-list tgx-board">{rows.map((e, i) => <li key={`${e.name}-${e.at}-${i}`} className={`tgx-row ${e.name === name ? "mine" : ""}`}>
        <span className={`tgx-place ${i < 3 ? `p${i + 1}` : ""}`}>{i + 1}</span>
        <span className="tgx-who"><b>{e.name}{e.name === name && <i className="tgx-tag">YOU</i>}</b></span>
        <strong className="tgx-score">{e.score.toLocaleString()}</strong>
      </li>)}</ol>}
  </section>;
}

export function PlayTab() {
  const { me, seated, toast, share, reload } = useTg();
  // a challenge accepted while you look at Play: your seats are read again, and a new one is announced
  const known = useRef<Set<string> | null>(null);
  useEffect(() => { const t = setInterval(() => { if (!document.hidden) void reload().catch(() => {}); }, 6_000); return () => clearInterval(t); }, [reload]);
  useEffect(() => {
    const ids = new Set((me?.seats ?? []).map((s) => `${s.game}:${s.id}`));
    if (known.current) for (const s of me?.seats ?? []) if (!known.current.has(`${s.game}:${s.id}`) && s.rival) { haptic.start(); toast(`${s.rival} is at your ${s.game === "chess" ? "NIGHT CHESS" : "Space Pinball"} table. Tap Resume to sit down.`); }
    known.current = ids;
  }, [me?.seats]);
  const feed = useFeed();
  const [game, setGame] = useState<Game>(() => (sessionStorage.getItem("tg-game") === "pinball" ? "pinball" : "chess"));
  const [tc, setTc] = useState<TimeControl>("3+2");
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [now, setNow] = useState(Date.now());
  useEffect(() => { try { sessionStorage.setItem("tg-game", game); } catch { /* private window */ } }, [game]);
  useEffect(() => { const t = setInterval(() => setNow(Date.now()), 1_000); return () => clearInterval(t); }, []);
  if (!me) return null;
  const p = me.profile;

  const play = async (action: "queue" | "any" | "join", id?: string, g: Game = game) => {
    if (busy) return;
    setBusy(`${action}:${id ?? ""}`); setErr(null); haptic.tap();
    try { const s = await tg<Seated>("play", { game: g, action, tc, id }); seated({ game: s.game, id: s.match.id, player: s.player }); }
    catch (e) { setErr((e as Error).message); haptic.error(); }
    finally { setBusy(null); }
  };
  const challenge = async () => {
    if (busy) return;
    setBusy("invite"); setErr(null); haptic.tap();
    try {
      const r = await tg<{ invite: InviteView; link: string; share: string }>("invite", { tc });
      // Telegram's chat picker with "@bot chess 3+2" typed in; where the client cannot, its share sheet
      if (!shareInline(r.share)) share(r.link, `♟ ${p.name} challenges you to NIGHT CHESS (${tc})`);
      toast("Pick a chat: the first to accept plays you. You get a DM to take your seat.");
    } catch (e) { setErr((e as Error).message); } finally { setBusy(null); }
  };
  const open = (feed?.open ?? []).filter((g) => g.game === game);
  const mine = new Set((feed?.mine ?? []).map((m) => `${m.game}:${m.id}`));
  const waiting = (t: TimeControl) => (feed ? feed.waiting.chess[t] + feed.waiting.chess.any : 0);

  return <div className="tgx-page">
    {!!me.seats.length && <section className="tgx-resume" aria-label="Your games">
      {me.seats.slice(0, 3).map((s) => <button type="button" key={`${s.game}-${s.id}`} className="tgx-resume-row" onClick={() => { haptic.tap(); seated(s); }}>
        <span className={`tgx-gi ${s.game}`}><Icon name={s.game === "chess" ? "chess-knight" : "orbit"} size={18} /></span>
        <span><b>{s.status === "waiting" ? "Your table is open" : s.rival ? `You vs ${s.rival}` : "Your game"}</b><small>{GAME_NAME[s.game]}{s.tc ? ` · ${s.tc}` : ""} · {s.status === "waiting" ? "waiting for a rival" : "in progress"}</small></span>
        <em>RESUME <Icon name="arrow" size={14} /></em>
      </button>)}
    </section>}

    <section className="tgx-hero">
      <span className="tgx-kicker"><i className="tgx-live" /> NIGHTSHIFT GAME ROOM</span>
      <h1>Clock in, <em>{p.name}</em>.</h1>
      <p>Real rivals, server-kept clocks, verified scores. Your Elo follows your Telegram profile.</p>
    </section>

    <div className="tgx-seg" role="tablist" aria-label="Game">
      {(["chess", "pinball"] as const).map((g) => <button type="button" role="tab" key={g} aria-selected={game === g} className={game === g ? "on" : ""} onClick={() => { haptic.select(); setGame(g); setErr(null); }}>
        <Icon name={g === "chess" ? "chess-knight" : "orbit"} size={18} /><span>{g === "chess" ? "NIGHT CHESS" : "SPACE PINBALL"}</span><small>{g === "chess" ? `${p.games.chess.elo} Elo` : `${p.games.pinball.elo} Elo`}</small>
      </button>)}
    </div>

    <section className="tgx-card">
      {game === "chess" && <>
        <div className="tgx-label"><span>01 · THE CLOCK</span><Icon name="clock" size={14} /></div>
        <div className="tgx-tcs" role="group" aria-label="Time control">{TCS.map((t) => <button type="button" key={t} className={tc === t ? "on" : ""} aria-pressed={tc === t} onClick={() => { haptic.select(); setTc(t); }}><b>{t}</b><small>{TC_INFO[t]}</small><small className={waiting(t) ? "wait on" : "wait"}>{waiting(t) ? `${waiting(t)} WAITING` : "—"}</small></button>)}</div>
      </>}
      <div className="tgx-actions">
        <button type="button" className="tgx-btn big" disabled={!!busy} onClick={() => void play(game === "chess" ? "queue" : "any")}><Icon name="swords" size={18} />{busy?.startsWith("queue") || busy?.startsWith("any:") ? "Opening your table…" : "Find a rival"}</button>
        {game === "chess" && <div className="tgx-actions two">
          <button type="button" className="tgx-btn ghost" disabled={!!busy} onClick={() => void play("any")}><Icon name="bolt" size={16} />Play anyone</button>
          <button type="button" className="tgx-btn ghost" disabled={!!busy} onClick={() => void challenge()}><Icon name="external" size={16} />Invite a friend</button>
        </div>}
        {game === "chess" && <button type="button" className="tgx-btn ghost" disabled={!!busy} onClick={() => { haptic.tap(); go(`/tg/practice/${encodeURIComponent(tc)}`); }}><Icon name="frog" size={16} />Practice vs Frog #7{(({ w, l, d }) => (w + l + d ? ` · ${w}W ${l}L ${d}D` : ""))(practiceRecord())}</button>}
        {game === "pinball" && <button type="button" className="tgx-btn ghost big" disabled={!!busy} onClick={() => { haptic.tap(); try { localStorage.setItem("pb-name", p.name); } catch { /* private window */ } go("/tg/pinball/solo"); }}><Icon name="play" size={18} />Play solo</button>}
        {game === "pinball" && <p className="tgx-note">Solo: your run, your best score on the board. Duel: same table, same seed, played at the same time, and your score lands meteors on your rival's table. Every score is replayed by the server.</p>}
        {game === "chess" && <p className="tgx-note">Practice: you play white against Frog #7, the house bot, on this clock. Not rated.</p>}
      </div>
      {err && <p className="tgx-err" role="alert"><Icon name="alert" size={15} />{err}</p>}
    </section>

    {game === "pinball" && <SoloBoard name={p.name} best={p.solo ? p.solo.best : null} runs={p.solo?.runs ?? 0} />}

    <section className="tgx-card" aria-label="The lounge">
      <div className="tgx-label"><span>THE LOUNGE · OPEN TABLES</span><span>{game === "chess" ? Object.values(feed?.waiting.chess ?? {}).reduce((a, b) => a + b, 0) : feed?.waiting.pinball ?? 0} WAITING</span></div>
      {!feed ? <p className="tgx-note">Looking for open tables…</p> : !open.length ? <p className="tgx-empty">No open {game === "chess" ? "chess" : "pinball"} tables right now. Open one: the next player sits down with you.</p>
        : <ul className="tgx-list">{open.slice(0, 20).map((g) => {
          const own = mine.has(`${g.game}:${g.id}`);
          return <li key={g.id} className={`tgx-row ${own ? "mine" : ""} ${g.away ? "away" : ""}`}>
            <span className={`tgx-gi ${g.game}`}><Icon name={g.game === "chess" ? "chess-knight" : "orbit"} size={17} /></span>
            <span className="tgx-who"><b>{g.host.name}{g.host.agent && <i className="tgx-tag">AGENT</i>}</b><small>{g.tc ? `${g.any ? "ANY CLOCK" : g.tc}` : "DUEL"}{g.host.rating ? ` · ${g.host.rating} Elo` : ""} · {g.away ? "host away" : `waiting ${waitText(now - g.since)}`}</small></span>
            {own ? <em className="tgx-own-tag">YOURS</em> : <button type="button" className="tgx-btn small" disabled={!!busy || g.away} onClick={() => void play("join", g.id, g.game)}>{busy === `join:${g.id}` ? "…" : "Join"}</button>}
          </li>;
        })}</ul>}
    </section>
    <p className="tgx-legal">Every game in the Game Room is free and rated by Elo.</p>
  </div>;
}
