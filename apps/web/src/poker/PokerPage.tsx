import { useCallback, useEffect, useRef, useState } from "react";
import { BetPanel } from "../bets";
import { Icon } from "../Icon";
import { go } from "../router";
import { useSession } from "../session";
import { type Seat, StakeLobby, StakeResult, tokenLabel, useEscrow } from "../stakes";
import { SEAT_KEY, alertJoined, doneWaiting, keepWaiting, Lounge, primeAlerts, waitText } from "../games/lounge";
import { useStakedSeat } from "../games/staked";
import { WeeklyPrizes } from "../games/prizes";
import { handleFor, nameOr, typedName } from "../games/handle";
import { Emote } from "../pool/cosmetics";
import "../chess/chess.css";
import "../games/live.css";
import { type Action, type Board, type HandView, type MatchView, type PlayerView, type TablesList, chips, newClientSeed, poker } from "./api";
import { FreeTable, TABLE_SEAT } from "./FreeTable";
import { CardDefs } from "./Card";
import { HandHistory } from "./History";
import { ActionBar, PokerTable, useNow } from "./Table";
import { PokerSound } from "./sound";
import { VerifyDeck } from "./Verify";
import "./poker.css";

const REASONS: Record<string, string> = {
  busted: "One player holds every chip.", resignation: "A player left the table and gave up the match.", abandonment: "A player was away from the table too long on their turns.",
  void: "Void: a player never came to the table or never chose an action, so nobody loses. Both stakes go back.", paused: "The house exhibition stepped aside: the tables are busy, and real games come first.",
};
function Wordmark() {
  return <span className="pk-wordmark"><Icon name="cards" size={30} /><span><b>NIGHT <em>POKER</em></b><small>· by <strong>NIGHTSHIFT</strong></small></span></span>;
}
/** The player's name, edited in place (as NIGHT POOL's). */
function NameEdit({ value, disabled, onChange }: { value: string; disabled?: boolean; onChange: (v: string) => void }) {
  const [edit, setEdit] = useState(false), [draft, setDraft] = useState(value);
  const keep = () => { const v = draft.trim().slice(0, 18); if (v) onChange(v); setEdit(false); };
  return edit
    ? <input className="pk-name-input" autoFocus value={draft} maxLength={18} autoComplete="nickname" aria-label="Your player name" onChange={(e) => setDraft(e.target.value)} onBlur={keep} onKeyDown={(e) => { if (e.key === "Enter") keep(); if (e.key === "Escape") setEdit(false); }} />
    : <button type="button" className="pk-name-btn" disabled={disabled} onClick={() => { setDraft(value); setEdit(true); }} aria-label={`Your player name: ${value}. Change it`}><b>{value}</b><Icon name="edit" size={14} /></button>;
}

/** A frozen river for the lobby: the real table, your full house, the rival's cards still down. */
const DEMO_HAND: HandView = {
  n: 14, street: "river", button: 1, sb: 30, bb: 60, sbSeat: 1, bbSeat: 0, board: [48, 45, 23, 20, 2], currentBet: 480, minRaise: 480, pot: 1_920, pots: [],
  seats: [{ seat: 0, stack: 1_740, bet: 480, folded: false, allIn: false, cards: [49, 22] }, { seat: 1, stack: 1_300, bet: 480, folded: false, allIn: false, cards: null }],
  toAct: null, commit: null, result: null, log: [], runout: null,
};
const DEMO_PLAYERS: PlayerView[] = [
  { seat: 0, name: "You", rating: 1240, you: true, connected: true, bot: false, avatar: "/games/pinball/frog-2.webp", level: null, emotes: [], bank: 45_000, awayUntil: null, grace: null },
  { seat: 1, name: "Frog #7", rating: 1200, you: false, connected: true, bot: true, avatar: "/api/pinball/frog/7-128.png", level: null, emotes: [], bank: 45_000, awayUntil: null, grace: null },
];

/** /games/poker: the lobby, the heads-up table (online, staked, practice), the rail, and the deck check. */
export function PokerPage() {
  const { address, signIn, busy: signing } = useSession();
  const params = new URLSearchParams(location.search);
  const verifying = location.pathname === "/games/poker/verify";
  const [name, setName] = useState(() => { try { const n = localStorage.getItem("nk-name"); return typedName(n) ? n! : handleFor(); } catch { return handleFor(); } });
  useEffect(() => { try { if (!typedName(localStorage.getItem("nk-name"))) setName(handleFor(address)); } catch { /* private window */ } }, [address]);
  const playName = nameOr(name, address);
  const [money, setMoney] = useState<"FREE" | "IMD" | "SHIFT">(() => { const t = params.get("token"); return t === "IMD" || t === "SHIFT" ? t : "FREE"; });
  const escrow = useEscrow();
  const [match, setMatch] = useState<MatchView | null>(null);
  const [mode, setMode] = useState<"online" | "practice" | "watch">(() => (params.get("watch") ? "watch" : "online"));
  const [err, setErr] = useState<string | null>(null), [busy, setBusy] = useState(false), [closedNote, setClosedNote] = useState<string | null>(null);
  const [board, setBoard] = useState<Board>({ best: [], board: [] }), [tab, setTab] = useState<"board" | "best">("board");
  const [soundOn, setSoundOn] = useState(() => { try { return localStorage.getItem("nk-sound") !== "off"; } catch { return true; } });
  const [skew, setSkew] = useState(0);
  const [emotes, setEmotes] = useState(false);
  const [confirmLeave, setConfirmLeave] = useState(false);
  /** After the match: the result put aside to look through the hands and their seeds. */
  const [review, setReview] = useState(false);
  useEffect(() => { setReview(false); }, [match?.id]);
  const source = useRef<EventSource | null>(null), token = useRef(""), current = useRef<MatchView | null>(null), mounted = useRef(true), sound = useRef<PokerSound | null>(null);
  const seeded = useRef(new Set<string>());
  const watchId = params.get("watch");
  // a free table (?table=<id>): from the rail, or from this tab's seat after a reload
  const [tableId, setTableId] = useState<string | null>(() => params.get("table") ?? (() => { try { return (JSON.parse(sessionStorage.getItem(TABLE_SEAT) ?? "null") as { id: string } | null)?.id ?? null; } catch { return null; } })());
  const [tables, setTables] = useState<TablesList | null>(null);
  useEffect(() => {
    if (tableId || verifying) return;
    let alive = true;
    const load = () => { if (!document.hidden) void poker<TablesList>("tables").then((t) => { if (alive) setTables(t); }).catch(() => {}); };
    load();
    const t = setInterval(load, 5_000);
    return () => { alive = false; clearInterval(t); };
  }, [tableId, verifying, address]);
  const openTable = (id: string | null) => { setTableId(id); history.replaceState(null, "", id ? `/games/poker?table=${id}` : "/games/poker"); window.scrollTo(0, 0); };

  /** Sounds for what changed: a new hand dealt, an action, your turn, a pot won. */
  const sounds = (old: MatchView | null, v: MatchView) => {
    const s = sound.current, h = v.hand, o = old?.id === v.id ? old.hand : null;
    if (!s || !h) return;
    if (!o || o.n !== h.n) { s.deal(); return; }
    if (h.log.length > o.log.length) { const k = h.log.at(-1)!.kind; if (k === "check") s.check(); else if (k === "fold") s.fold(); else s.chips(k === "call" ? 2 : 4); }
    if (h.board.length > o.board.length) s.deal();
    if (v.legal && !old?.legal) s.turn();
    if (h.result && !o.result && v.you !== null && (h.result.won[String(v.you)] ?? 0) > 0) s.win();
  };
  const receive = useCallback((v: MatchView) => {
    if (!mounted.current) return;
    const old = current.current;
    if (old?.id === v.id && v.version < old.version) return;
    setSkew(v.now - Date.now());
    if (mode !== "watch") {
      if (v.movedTo) { follow(v.movedTo, token.current); return; }
      if (v.done && !v.startedAt) {
        doneWaiting("poker", v.id); source.current?.close(); source.current = null; current.current = null; setMatch(null);
        try { sessionStorage.removeItem(SEAT_KEY.poker); } catch { /* private window */ }
        if (v.expired) setClosedNote(v.expired === "away" ? "Your table closed: you were away for more than 90 seconds." : "Nobody sat down in 30 minutes, so your table closed.");
        return;
      }
      if (v.startedAt) { doneWaiting("poker", v.id); if (old?.id === v.id && !old.startedAt && !v.done) alertJoined("poker", "/games/poker"); }
      else if (!v.done && !v.escrow && !v.practice) keepWaiting({ game: "poker", id: v.id, player: token.current, tc: null, since: v.waitingSince });
    }
    sounds(old, v);
    current.current = v; setMatch(v);
    if (v.rematchId && mode !== "watch") follow(v.rematchId, token.current);
  }, [mode]);
  const follow = useCallback((id: string, player: string) => {
    source.current?.close();
    token.current = player;
    const watch = !player;
    const es = new EventSource(watch ? `/api/poker/match/${id}/watch` : `/api/poker/match/${id}/events?player=${encodeURIComponent(player)}`);
    source.current = es;
    if (!watch) try { sessionStorage.setItem(SEAT_KEY.poker, JSON.stringify({ id, player })); } catch { /* private window */ }
    es.onmessage = (e) => { if (source.current !== es) return; try { receive(JSON.parse(e.data) as MatchView); } catch { /* the next frame has everything */ } };
    es.onerror = () => {
      if (source.current !== es || !mounted.current) return;
      if (watch) { if (es.readyState === EventSource.CLOSED) { source.current = null; if (!current.current) setErr("This table is not live any more."); } return; }
      void fetch(`/api/poker/match/${id}?player=${encodeURIComponent(player)}`).then(async (r) => {
        if (source.current !== es) return;
        if (r.status === 400 || r.status === 404) { es.close(); source.current = null; current.current = null; setMatch(null); setErr("That table has closed. Find a new rival."); try { sessionStorage.removeItem(SEAT_KEY.poker); } catch { /* private window */ } }
        else if (r.ok) receive(await r.json() as MatchView);
      }).catch(() => {});
    };
  }, [receive]);

  useEffect(() => {
    mounted.current = true; sound.current = new PokerSound();
    const title = document.title; document.title = verifying ? "Verify a hand · NIGHT POKER" : watchId ? "Watching live · NIGHT POKER" : "NIGHT POKER · NIGHTSHIFT";
    const load = () => void poker<Board>("board").then((b) => { if (mounted.current) setBoard(b); }).catch(() => {});
    load();
    if (watchId) follow(watchId, "");
    else if (!verifying) try { const s = JSON.parse(sessionStorage.getItem(SEAT_KEY.poker) ?? "null") as { id: string; player: string } | null; if (s) follow(s.id, s.player); } catch { /* none */ }
    const unlock = () => sound.current?.unlock();
    addEventListener("pointerdown", unlock); addEventListener("keydown", unlock);
    const t = setInterval(load, 30_000);
    return () => { mounted.current = false; source.current?.close(); clearInterval(t); sound.current?.close(); removeEventListener("pointerdown", unlock); removeEventListener("keydown", unlock); document.title = title; };
  }, []);
  useEffect(() => { if (sound.current) sound.current.enabled = soundOn; try { localStorage.setItem("nk-sound", soundOn ? "on" : "off"); } catch { /* private window */ } }, [soundOn]);
  // this browser's own seed for every hand: sent as soon as the hand is committed, before its deal
  useEffect(() => {
    const n = match?.next;
    if (!match || mode === "watch" || !n || n.seedSent || !token.current) return;
    const key = `${match.id}:${n.n}`;
    if (seeded.current.has(key)) return;
    seeded.current.add(key);
    void poker(`match/${match.id}/seed`, { player: token.current, hand: n.n, seed: newClientSeed() }).catch(() => {});
  }, [match?.id, match?.next?.n, match?.next?.seedSent, mode]);
  useEffect(() => { if (!match?.done) return; void poker<Board>("board").then(setBoard).catch(() => {}); }, [match?.done]);

  const start = async (practiceMode = false) => {
    if (busy) return;
    setBusy(true); setErr(null); setClosedNote(null); sound.current?.unlock(); if (!practiceMode) primeAlerts();
    try { if (typedName(name) && name !== handleFor(address)) localStorage.setItem("nk-name", name); } catch { /* private window */ }
    try {
      source.current?.close(); current.current = null;
      const r = await poker<{ match: MatchView; player: string }>(practiceMode ? "practice" : "queue", { name: playName });
      setMode(practiceMode ? "practice" : "online"); token.current = r.player; receive(r.match); follow(r.match.id, r.player);
    } catch (e) { setErr((e as Error).message); } finally { setBusy(false); }
  };
  useEffect(() => { if (params.get("practice") && !watchId) { history.replaceState(null, "", "/games/poker"); void start(true); } }, []);
  const lobby = () => {
    if (current.current) doneWaiting("poker", current.current.id);
    source.current?.close(); source.current = null; current.current = null; setMatch(null); setErr(null); setConfirmLeave(false);
    try { sessionStorage.removeItem(SEAT_KEY.poker); } catch { /* private window */ }
    if (mode === "watch") { history.replaceState(null, "", "/games/poker"); setMode("online"); }
    else setMode("online");
  };
  const post = async <T,>(path: string, body: Record<string, unknown> = {}) => poker<T>(`match/${current.current!.id}/${path}`, { player: token.current, ...body });
  const act = async (a: Action) => {
    if (busy) return;
    setBusy(true); setErr(null); sound.current?.unlock();
    try { receive(await post<MatchView>("act", a)); } catch (e) { setErr((e as Error).message); } finally { setBusy(false); }
  };
  const cancel = async () => { if (!match) return; try { await post("leave"); } catch (e) { setErr((e as Error).message); return; } lobby(); };
  const resign = async () => { try { receive(await post<MatchView>("resign")); setConfirmLeave(false); } catch (e) { setErr((e as Error).message); } };
  const seat = (s: Seat) => { setMode("online"); follow(s.id, s.player); };
  const loungeSeat = (_g: string, id: string, player: string) => { setMode("online"); setClosedNote(null); follow(id, player); };
  // a staked seat found by the wallet (any tab, after a reload, from the banner's ?seat=): taken here unless another match is on
  useStakedSeat("poker", seat, { busy: !!match && !match.done && !match.escrow && (mode === "practice" || !!match.startedAt), following: match?.escrow ? match.id : null, open: (s) => { if (!params.get("token")) setMoney((m) => (m === "FREE" ? s.token : m)); } });

  const inGame = !!match && (!!match.startedAt || mode === "watch");
  const waiting = !!match && !match.startedAt && mode !== "watch";
  const now = useNow(500) + skew;
  useEffect(() => { if (inGame) window.scrollTo(0, 0); }, [inGame, match?.id]);
  const me = match?.players.find((p) => p.you) ?? null, rival = match?.players.find((p) => !p.you) ?? null;
  const spectate = mode === "watch";
  const countdown = match?.startedAt ? Math.max(0, Math.ceil((match.startedAt - now) / 1000)) : 0;
  const dealing = !!match && !match.done && (!match.hand || match.hand.street === "done") && match.next?.dealAt ? Math.max(0, match.next.dealAt - now) : null;
  const toActName = match?.hand && match.hand.toAct !== null ? match.players[match.hand.toAct]?.name ?? "" : "";
  const actor = match?.hand && match.hand.toAct !== null ? match.players[match.hand.toAct] ?? null : null;
  const away = actor && !actor.connected ? `${actor.name} is reconnecting${actor.awayUntil ? ` · ${waitText(Math.max(0, actor.awayUntil - now))} left` : ""}` : null;
  const status = !match ? "" : away && !match.done ? away : match.done ? "Match over" : countdown > 0 ? `The first hand in ${countdown}` : !match.hand ? "Shuffling the first deck…" : match.hand.street === "done" ? "Next hand…" : match.legal ? "Your turn" : spectate ? `${toActName} to act` : `${toActName || "Your rival"} is thinking…`;
  const levelLeft = match?.levelAt ? Math.max(0, match.levelAt - now) : null;

  if (tableId && !watchId) return <div className="pk pk-page pk-playing">
    <CardDefs />
    <header className="pk-top">
      <a href="/games/poker" className="pk-back" onClick={(e) => { e.preventDefault(); openTable(null); }}><Icon name="arrow" size={16} /><span>NIGHT POKER</span></a>
      <a href="/games/poker" className="pk-brand" aria-label="Night Poker by NIGHTSHIFT" onClick={(e) => { e.preventDefault(); openTable(null); }}><Wordmark /></a>
      <div className="pk-account">
        <button type="button" className="pk-icon-btn" aria-label={soundOn ? "Mute" : "Sound on"} aria-pressed={soundOn} onClick={() => { sound.current?.unlock(); setSoundOn(!soundOn); }}><Icon name={soundOn ? "sound" : "sound-off"} size={18} /></button>
        {address ? <span className="pk-wallet"><Icon name="user" size={15} /><span>{address.slice(0, 6)}…{address.slice(-4)}</span></span> : <button type="button" className="pk-btn ghost small" disabled={signing} onClick={() => void signIn()}><Icon name="user" size={15} /><span>{signing ? "SIGNING IN" : "SIGN IN"}</span></button>}
      </div>
    </header>
    <FreeTable id={tableId} name={playName} address={address} sound={sound.current} onExit={() => openTable(null)} />
  </div>;

  if (verifying) return <div className="pk pk-page">
    <header className="pk-top"><a href="/games/poker" className="pk-back" onClick={(e) => { e.preventDefault(); go("/games/poker"); }}><Icon name="arrow" size={16} /><span>NIGHT POKER</span></a><Wordmark /><span /></header>
    <CardDefs /><VerifyDeck />
  </div>;

  return <div className={`pk pk-page ${inGame ? "pk-playing" : ""}`}>
    <CardDefs />
    <header className="pk-top">
      <a href="/games" className="pk-back" onClick={(e) => { e.preventDefault(); if (inGame && match && !match.done && !spectate) setConfirmLeave(true); else go(spectate ? "/games/live" : "/games"); }}><Icon name="arrow" size={16} /><span>{spectate ? "LIVE GAMES" : "GAME ROOM"}</span></a>
      <a href="/games/poker" className="pk-brand" onClick={(e) => { e.preventDefault(); if (!inGame || match?.done || spectate) lobby(); }} aria-label="Night Poker by NIGHTSHIFT"><Wordmark /></a>
      <div className="pk-account">
        {inGame && <button type="button" className="pk-icon-btn" aria-label={soundOn ? "Mute" : "Sound on"} aria-pressed={soundOn} onClick={() => { sound.current?.unlock(); setSoundOn(!soundOn); }}><Icon name={soundOn ? "sound" : "sound-off"} size={18} /></button>}
        {address ? <span className="pk-wallet"><Icon name="user" size={15} /><span>{address.slice(0, 6)}…{address.slice(-4)}</span></span> : <button type="button" className="pk-btn ghost small" disabled={signing} onClick={() => void signIn()}><Icon name="user" size={15} /><span>{signing ? "SIGNING IN" : "SIGN IN"}</span></button>}
      </div>
    </header>

    {!inGame && <main className="pk-lobby">
      <section className="pk-front" aria-labelledby="pk-title">
        <h1 id="pk-title">No-Limit Texas Hold'em</h1>
        <div className="pk-cabinet"><PokerTable hand={DEMO_HAND} players={DEMO_PLAYERS} seats={2} you={0} clock={null} skew={0} emotes={[]} /></div>
      </section>
      <section className="pk-panel pk-play" aria-label="Play">
        <div className="pk-playas"><span className="pk-label">Playing as</span><NameEdit value={playName} disabled={busy || waiting} onChange={(n) => { setName(n); try { localStorage.setItem("nk-name", n); } catch { /* private window */ } }} /></div>
        <div className="pk-money" role="group" aria-label="Play for">{(["FREE", "SHIFT", "IMD"] as const).map((k) => <button type="button" key={k} className={money === k ? "on" : ""} aria-pressed={money === k} disabled={waiting} onClick={() => setMoney(k)}>{k === "FREE" ? "FREE" : tokenLabel(k)}{k !== "FREE" && !escrow?.live && <Icon name="lock" size={12} />}</button>)}</div>
        <ul className="pk-facts"><li><b>2,000</b><span>chips each · 100 big blinds</span></li><li><b>3 min</b><span>blind levels</span></li><li><b>20 s</b><span>a move · +45 s time bank</span></li></ul>
        {money === "FREE" ? <>
          <button type="button" className="pk-btn primary" disabled={busy || waiting} onClick={() => void start()}><Icon name="swords" size={18} /><span>{busy ? "OPENING YOUR TABLE" : "FIND A RIVAL · RATED"}</span><Icon name="arrow" size={17} /></button>
          <button type="button" className="pk-btn ghost" disabled={busy || waiting} onClick={() => void start(true)}><img className="pk-frog-mini" src="/api/pinball/frog/7-128.png" alt="" width="22" height="22" /><span>PRACTICE VS FROG #7 · NOT RATED</span></button>
        </> : <StakeLobby game="poker" token={money} name={playName} address={address} signIn={signIn} onSeat={seat} theme="nc" />}
        {closedNote && <p className="pk-error" role="status"><Icon name="clock" size={15} />{closedNote}</p>}
        {err && <p className="pk-error" role="alert"><Icon name="alert" size={15} />{err}</p>}
        <a className="pk-fair-link" href="/games/poker/verify" onClick={(e) => { e.preventDefault(); go("/games/poker/verify"); }}><Icon name="shield" size={15} /><span><b>Provably fair deck</b>Each hand is committed before the deal and shuffled with your browser's seed. Check any hand.</span><Icon name="arrow" size={14} /></a>
      </section>
      <section className="pk-more" aria-label="Open tables and the leaderboard">
        <section className="pk-tables" aria-labelledby="pk-tables-title">
          <div className="pk-section"><span id="pk-tables-title">Free tables, up to six</span><span>{tables?.chips != null ? `${chips(tables.chips)} play chips` : ""}</span></div>
          <p className="pk-note">Blinds {tables ? `${tables.blinds[0]}/${tables.blinds[1]}` : "10/20"}, buy in with {tables ? `${chips(tables.buyIn.min)} to ${chips(tables.buyIn.max)}` : "800 to 2,000"} play chips{address ? `; ${chips(tables?.daily ?? 10_000)} in your wallet each day` : "; sign in to keep them, 10,000 a day"}. House frogs fill the empty seats and stand up for people. Never rated, staked or bet on.</p>
          {tables === null ? <p className="pk-empty">Looking for the tables…</p> : <ul className="pk-table-list">{tables.tables.map((t) => <li key={t.id}>
            <div><b>{t.name}</b><small>{t.people + t.frogs}/{t.seats} seated · {t.people} {t.people === 1 ? "person" : "people"}{t.frogs ? ` · ${t.frogs} house ${t.frogs === 1 ? "frog" : "frogs"}` : ""}{t.hand ? ` · hand #${t.hand}` : ""}</small>
              <span className="pk-table-names">{t.players.map((p) => <i key={p.name} className={p.house ? "house" : ""}>{p.name}</i>)}</span></div>
            <button type="button" className={`pk-btn small ${t.people + t.frogs >= t.seats ? "ghost" : ""}`} onClick={() => openTable(t.id)}>{t.people + t.frogs >= t.seats ? "Watch" : "Sit down"}</button>
          </li>)}</ul>}
        </section>
        {money === "FREE" && <Lounge game="poker" onSeat={loungeSeat} />}
        <WeeklyPrizes game="poker" />
        <div className="pk-leaders"><div className="pk-section"><span>Leaderboard</span><span>Elo</span></div>
          <div className="pk-tabs" role="group" aria-label="Leaderboard period">{([["board", "Tonight"], ["best", "All time"]] as const).map(([k, l]) => <button type="button" key={k} aria-pressed={tab === k} className={tab === k ? "on" : ""} onClick={() => setTab(k)}>{l}</button>)}</div>
          {board[tab].length ? <ol>{board[tab].map((p, i) => <li key={`${p.name}-${i}`}><span className="pk-rank">{String(i + 1).padStart(2, "0")}</span><div><b>{p.name}</b><small>{p.wins} W / {p.games} G</small></div><strong>{p.rating}</strong></li>)}</ol> : <p className="pk-empty">No rated match {tab === "board" ? "in the last 24 hours" : "yet"}.</p>}
        </div>
        <p className="pk-legal"><Icon name="lock" size={14} /><span>Free tables need no wallet. Staked matches in IMD and $SHIFT are for adults 18+ only, where allowed. The winner takes 95% of the pot.</span></p>
      </section>
    </main>}

    {waiting && match && <div className="pk-overlay" role="dialog" aria-modal="true" aria-labelledby="pk-wait"><div className="pk-dialog">
      <div className="pk-radar"><Icon name="radar" size={34} /></div>
      <span className="pk-kicker">{match.escrow ? "STAKED MATCH" : "MATCHMAKING · HEADS-UP"}</span>
      <h2 id="pk-wait">{match.escrow ? "Waiting for your rival" : "Waiting for a rival"}</h2>
      <p>{match.escrow ? <>Both stakes are in. The first hand is dealt only once you are both at the table, after a 10-second countdown. {rival?.connected ? <b>Your rival is here.</b> : <>Your rival has not opened the table yet: they see a "Take your seat" banner on any page.</>}{match.showBy && <> If you are not both here in <b>{waitText(Math.max(0, match.showBy - now))}</b>, the match is void and both stakes go back.</>}</> : "Your table is open in the lounge. Browse the site meanwhile: you hear it when someone sits down."}</p>
      <span className="pk-kicker">{match.escrow ? `${match.players.filter((p) => p.connected).length} / 2 AT THE TABLE · ${match.stake} ${tokenLabel(match.currency)} EACH` : `WAITING ${waitText(now - match.waitingSince)}`}</span>
      {!match.escrow && <><button type="button" className="pk-btn" onClick={() => go("/games")}><Icon name="radar" size={16} />BROWSE WHILE YOU WAIT</button><button type="button" className="pk-btn ghost" onClick={() => void cancel()}>CANCEL</button></>}
    </div></div>}

    {inGame && match && <main className="pk-game">
      <section className="pk-stage">
        <div className="pk-hud">
          <span className="pk-kicker">{mode === "practice" ? <>PRACTICE · FROG #7 · NOT RATED</> : match.house ? <><i className="pk-live" /> HOUSE · EXHIBITION, NOT RATED · {match.viewers ?? 0} WATCHING</> : spectate ? <><i className="pk-live" /> SPECTATING{match.currency !== "FREE" ? ` · STAKED ${Number(match.stake ?? 0).toLocaleString()} ${tokenLabel(match.currency)} EACH` : ""} · {match.viewers ?? 0} WATCHING</> : match.escrow ? <><i className="pk-live" /> STAKED · {Number(match.stake ?? 0).toLocaleString()} {tokenLabel(match.currency)} EACH</> : <><i className="pk-live" /> HEADS-UP · RATED</>}</span>
          <span className="pk-blinds"><b>BLINDS {chips(match.blinds[0])}/{chips(match.blinds[1])}</b>{levelLeft !== null && !match.done && <small>{chips(match.nextBlinds[0])}/{chips(match.nextBlinds[1])} in {waitText(levelLeft)}</small>}{match.hand && <small>HAND #{match.hand.n}</small>}</span>
        </div>
        <PokerTable hand={match.hand} players={match.players} seats={2} you={spectate ? null : match.you} clock={match.clock} skew={skew} emotes={match.emotes} turn={!!match.legal}
          center={countdown > 0 && !match.done ? <div className="pk-count"><span className="pk-kicker">{spectate ? "BOTH PLAYERS ARE HERE" : "YOUR RIVAL IS HERE"}</span><strong key={countdown}>{countdown}</strong></div>
            : dealing !== null && dealing > 0 && !match.hand?.result ? <span className="pk-kicker">{match.hand ? "NEXT HAND" : "DEALING"}</span> : null} />
        {match.done && review && <div className="pk-bar pk-over"><span className="pk-kicker">MATCH OVER · {match.winner === null ? "NO WINNER" : spectate ? `${match.players[match.winner]?.name ?? ""} WON` : match.winnerIsYou ? "YOU WON" : "YOU LOST"}</span><button type="button" className="pk-btn small" onClick={() => setReview(false)}>THE RESULT</button><button type="button" className="pk-btn ghost small" onClick={lobby}>BACK TO THE LOBBY</button></div>}
        {!spectate && !match.done && <div className="pk-bar">
          <ActionBar hand={match.hand} legal={match.legal} you={match.you} busy={busy} waitingOn={status} onAct={(a) => void act(a)} />
          {me && me.emotes.length > 0 && mode === "online" && <div className="pk-emote-wrap">
            <button type="button" className={`pk-icon-btn ${emotes ? "on" : ""}`} aria-label="Emotes" aria-expanded={emotes} onClick={() => setEmotes(!emotes)}><Icon name="frog" size={18} /></button>
            {emotes && <div className="pk-emotes" role="menu">{me.emotes.map((id) => <button type="button" key={id} role="menuitem" onClick={() => { setEmotes(false); void post("emote", { emote: id }).catch((e) => setErr((e as Error).message)); }}><Emote id={id} /></button>)}</div>}
          </div>}
        </div>}
        {spectate && !match.done && <p className="pk-rail-note" role="status">{status}. Hole cards stay hidden until a showdown.</p>}
        {err && <p className="pk-error floating" role="alert"><Icon name="alert" size={15} />{err}<button type="button" aria-label="Dismiss" onClick={() => setErr(null)}><Icon name="close" size={14} /></button></p>}
      </section>
      <aside className="pk-side">
        <div className="pk-section"><span>Hands</span><span>{match.history.length} played</span></div>
        <HandHistory history={match.history} players={match.players} you={spectate ? null : match.you} seats={2} sealed="revealed when the match ends" />
        {!match.done && (match.next || match.hand?.commit) && <p className="pk-fair"><Icon name="shield" size={14} /><span>{match.next ? <>Hand #{match.next.n} is committed: <code>{match.next.commit.slice(0, 16)}…</code>{spectate ? "" : match.next.seedSent ? " · your seed is in" : " · sending your seed"}</> : <>Hand #{match.hand!.n} was committed before the deal: <code>{match.hand!.commit!.slice(0, 16)}…</code> · its seed is shown when the match ends</>}</span></p>}
        {match.escrow && match.done && <StakeResult matchId={match.escrow} address={address} />}
        {spectate && !match.house && <BetPanel game="poker" id={match.id} theme="nc" />}
        {!spectate && !match.done && <button type="button" className="pk-btn ghost small" onClick={() => setConfirmLeave(true)}><Icon name="flag" size={14} />LEAVE THE MATCH</button>}
      </aside>
    </main>}

    {inGame && match?.done && !review && <div className="pk-overlay pk-end" role="dialog" aria-modal="true" aria-labelledby="pk-end"><div className="pk-dialog">
      <span className="pk-kicker">{mode === "practice" ? "PRACTICE COMPLETE" : "FINAL RESULT · SERVER VERIFIED"}</span>
      <h2 id="pk-end">{match.winner === null ? (match.reason === "void" ? "Void" : "No result") : spectate ? `${match.players[match.winner]?.name ?? ""} wins` : match.winnerIsYou ? "Victory" : "Defeat"}</h2>
      <p>{REASONS[match.reason ?? ""] ?? ""}</p>
      <div className="pk-final">{match.players.map((p) => <span key={p.seat} className={match.winner === p.seat ? "won" : ""}><img src={p.avatar ?? "/games/pinball/frog-0.webp"} alt="" width="40" height="40" /><b>{p.you ? "You" : p.name}</b><small>{p.rating && !match.practice && !match.house ? `${p.rating} ELO` : p.bot ? "HOUSE" : ""}</small></span>)}</div>
      {match.escrow && <StakeResult matchId={match.escrow} address={address} />}
      {!match.escrow && mode === "online" && match.rivalWantsRematch && <p className="pk-note">Your rival wants another match.</p>}
      <div className="pk-result-actions">
        {spectate ? <><button type="button" className="pk-btn" onClick={() => go("/games/live")}><Icon name="radar" size={16} />WATCH ANOTHER</button><button type="button" className="pk-btn ghost" onClick={() => { lobby(); void start(true); }}>PRACTICE VS FROG #7</button></>
          : mode === "practice" ? <><button type="button" className="pk-btn" onClick={() => void start(true)}><Icon name="swap" size={16} />PLAY FROG #7 AGAIN</button><button type="button" className="pk-btn ghost" onClick={lobby}>BACK TO THE LOBBY</button></>
          : <>{!match.escrow && <button type="button" className="pk-btn" disabled={match.rematchRequested} onClick={() => void post<MatchView>("rematch").then(receive).catch((e) => setErr((e as Error).message))}><Icon name={match.rematchRequested ? "radar" : "swap"} size={16} />{match.rematchRequested ? "WAITING FOR YOUR RIVAL" : "REMATCH"}</button>}<button type="button" className="pk-btn ghost" onClick={lobby}>BACK TO THE LOBBY</button></>}
      </div>
      <button type="button" className="pk-btn ghost small" onClick={() => setReview(true)}><Icon name="shield" size={14} />REVIEW THE HANDS AND THEIR SEEDS</button>
      <p className="pk-note">Every server seed of this match is now in the hand history: open a hand and verify its deck.</p>
    </div></div>}

    {confirmLeave && match && <div className="pk-overlay" role="dialog" aria-modal="true" aria-labelledby="pk-leave" onKeyDown={(e) => { if (e.key === "Escape") setConfirmLeave(false); }}><div className="pk-dialog">
      <Icon name="flag" size={28} />
      <h2 id="pk-leave">Leave the table?</h2>
      <p>{match.escrow ? "Leaving gives the match and your stake to your rival." : mode === "practice" ? "The practice match ends." : "Leaving gives this match to your rival."}</p>
      <button type="button" className="pk-btn" onClick={() => void resign().then(() => { if (mode === "practice") lobby(); })}>{mode === "practice" ? "END PRACTICE" : "LEAVE AND LOSE THE MATCH"}</button>
      <button type="button" className="pk-btn ghost" autoFocus onClick={() => setConfirmLeave(false)}>KEEP PLAYING</button>
    </div></div>}
    {spectate && !match && <div className="pk-overlay"><div className="pk-dialog"><span className="pk-kicker">SPECTATOR MODE</span><h2>{err ? "No table to watch." : "Finding the table…"}</h2><button type="button" className="pk-btn" onClick={() => go("/games/live")}>WATCH ANOTHER</button></div></div>}
  </div>;
}
