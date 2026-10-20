import { useCallback, useEffect, useRef, useState } from "react";
import { BetPanel } from "../bets";
import { Icon } from "../Icon";
import { LITE, PHONE, pixelRatio } from "../lite";
import { go } from "../router";
import { useSession } from "../session";
import { type Seat, StakeLobby, StakeResult, tokenLabel, useEscrow } from "../stakes";
import { SEAT_KEY, doneWaiting, keepWaiting, Lounge, primeAlerts, alertJoined, useLounge, waitText } from "../games/lounge";
import "../chess/chess.css";
import "../games/live.css";
import { type Board, type CatalogItem, type MatchView, type SelfProfile, type ShotInput, locker, pool } from "./api";
import { LockerView } from "./Locker";
import { PoolGame } from "./PoolGame";
import { Practice } from "./practice";
import { FOOT_X, FOOT_Y, rack, simulate } from "./physics";
import { PoolScene } from "./table3d";
import "./pool.css";

/** The lobby's table: a rack broken again and again, as the server would play it. */
function Showcase() {
  const host = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!host.current) return;
    const s = new PoolScene(host.current, { lite: LITE, pixelRatio: pixelRatio(1.5) });
    s.setLook({ cloth: "cloth-frog", table: "table-uv", balls: "balls-classic", cue: "cue-frog" });
    let alive = true, seed = 3;
    const loop = async () => {
      while (alive) {
        const b = rack(seed++);
        s.setBalls(b);
        s.showCue(b[0]!, Math.round(Math.atan2(FOOT_Y - b[0]!.y, FOOT_X - b[0]!.x) * 180000 / Math.PI), 0.6, 0);
        await new Promise((r) => setTimeout(r, 1600));
        if (!alive) return;
        s.showCue(null, 0, 0, 0);
        const r = simulate(b, { aim: Math.round(Math.atan2(FOOT_Y - b[0]!.y, FOOT_X - b[0]!.x) * 180000 / Math.PI) + (seed % 5) * 40 - 80, power: 1000, spinX: 0, spinY: -60, elevation: 0 });
        await s.play(b, r.frames, { rate: Math.max(1, r.duration / 6), onEvent: () => {} });
        await new Promise((r) => setTimeout(r, 1800));
      }
    };
    void loop();
    return () => { alive = false; s.cancelReplay(); s.dispose(); };
  }, []);
  return <div className="np-showcase" ref={host} aria-hidden="true" />;
}

function Wordmark() {
  return <span className="np-wordmark"><Icon name="pool" size={30} /><span><b>NIGHT <em>POOL</em></b><small>· by <strong>NIGHTSHIFT</strong></small></span></span>;
}

/**
 * Haptics where the device has them: Telegram's own when the page runs inside Telegram's webview
 * with its WebApp object, else the vibration API (Android browsers, Telegram's in-app browser).
 */
const haptic = (kind: "light" | "medium" | "heavy" | "success" | "error" | "select") => {
  try {
    const h = (window as unknown as { Telegram?: { WebApp?: { HapticFeedback?: { impactOccurred(s: string): void; notificationOccurred(s: string): void; selectionChanged(): void } } } }).Telegram?.WebApp?.HapticFeedback;
    if (h) { if (kind === "select") h.selectionChanged(); else if (kind === "success" || kind === "error") h.notificationOccurred(kind); else h.impactOccurred(kind); return; }
    if (PHONE && "vibrate" in navigator) navigator.vibrate(kind === "heavy" ? 28 : kind === "medium" ? 16 : kind === "error" ? [30, 40, 30] : 8);
  } catch { /* haptics are optional */ }
};

/** /games/pool: the lobby, the table (online, staked, practice), the stands, and the locker. */
export function PoolPage() {
  const { address, signIn, busy: signing } = useSession();
  const params = new URLSearchParams(location.search);
  const [name, setName] = useState(() => { try { return localStorage.getItem("np-name") ?? ""; } catch { return ""; } });
  const [rules, setRules] = useState<"wpa" | "quick">(() => { try { return localStorage.getItem("np-rules") === "quick" ? "quick" : "wpa"; } catch { return "wpa"; } });
  const [money, setMoney] = useState<"FREE" | "IMD" | "SHIFT">(() => { const t = params.get("token"); return t === "IMD" || t === "SHIFT" ? t : "FREE"; });
  const escrow = useEscrow();
  const feed = useLounge();
  const [match, setMatch] = useState<MatchView | null>(null);
  const [mode, setMode] = useState<"online" | "practice" | "watch">(() => (params.get("watch") ? "watch" : "online"));
  const [err, setErr] = useState<string | null>(null), [busy, setBusy] = useState(false), [closedNote, setClosedNote] = useState<string | null>(null);
  const [board, setBoard] = useState<Board>({ best: [], board: [] }), [tab, setTab] = useState<"board" | "best">("board");
  const [soundOn, setSoundOn] = useState(() => { try { return localStorage.getItem("np-sound") !== "off"; } catch { return true; } });
  const [skew, setSkew] = useState(0);
  const [showLocker, setShowLocker] = useState(() => location.pathname.endsWith("/locker"));
  const [me, setMe] = useState<SelfProfile | null>(null), [catalog, setCatalog] = useState<CatalogItem[]>([]);
  const [reward, setReward] = useState<{ xp: number; level: number; unlocked: string[] } | null>(null);
  const before = useRef<SelfProfile | null>(null);
  const source = useRef<EventSource | null>(null), token = useRef(""), current = useRef<MatchView | null>(null), practice = useRef<Practice | null>(null), mounted = useRef(true);
  const watchId = params.get("watch");

  // the frames of a shot arrive once: a later frame of the same shot keeps them
  const receive = useCallback((v: MatchView) => {
    if (!mounted.current) return;
    const old = current.current;
    if (old?.id === v.id && v.version < old.version) return;
    if (old?.id === v.id && v.last && !v.last.frames && old.last?.n === v.last.n && old.last.frames) v = { ...v, last: { ...v.last, frames: old.last.frames, start: old.last.start } };
    setSkew(v.now - Date.now());
    if (mode !== "watch" && !practice.current) {
      if (v.movedTo) { follow(v.movedTo, token.current); return; }
      if (v.done && !v.startedAt) {
        doneWaiting("pool", v.id); source.current?.close(); source.current = null; current.current = null; setMatch(null);
        try { sessionStorage.removeItem(SEAT_KEY.pool); } catch { /* private window */ }
        if (v.expired) setClosedNote(v.expired === "away" ? "Your table closed: you were away for more than 90 seconds." : "Nobody sat down in 30 minutes, so your table closed.");
        return;
      }
      if (v.startedAt) { doneWaiting("pool", v.id); if (old?.id === v.id && !old.startedAt && !v.done) alertJoined("pool", "/games/pool"); }
      else if (!v.done && !v.escrow) keepWaiting({ game: "pool", id: v.id, player: token.current, tc: null, since: v.waitingSince });
    }
    current.current = v; setMatch(v);
    if (v.rematchId && mode !== "watch") follow(v.rematchId, token.current);
  }, [mode]);
  const follow = useCallback((id: string, player: string) => {
    source.current?.close();
    token.current = player;
    const watch = !player;
    const es = new EventSource(watch ? `/api/pool/match/${id}/watch` : `/api/pool/match/${id}/events?player=${encodeURIComponent(player)}`);
    source.current = es;
    if (!watch) try { sessionStorage.setItem(SEAT_KEY.pool, JSON.stringify({ id, player })); } catch { /* private window */ }
    es.onmessage = (e) => { if (source.current !== es) return; try { receive(JSON.parse(e.data) as MatchView); } catch { /* the next frame has everything */ } };
    es.onerror = () => {
      if (source.current !== es || !mounted.current) return;
      if (watch) { if (es.readyState === EventSource.CLOSED) { source.current = null; if (!current.current) setErr("This table is not live any more."); } return; }
      void fetch(`/api/pool/match/${id}?player=${encodeURIComponent(player)}`).then(async (r) => {
        if (source.current !== es) return;
        if (r.status === 400 || r.status === 404) { es.close(); source.current = null; current.current = null; setMatch(null); setErr("That table has closed. Find a new rival."); try { sessionStorage.removeItem(SEAT_KEY.pool); } catch { /* private window */ } }
        else if (r.ok) receive(await r.json() as MatchView);
      }).catch(() => {});
    };
  }, [receive]);

  useEffect(() => {
    mounted.current = true;
    const title = document.title; document.title = watchId ? "Watching live · NIGHT POOL" : "NIGHT POOL · NIGHTSHIFT";
    const load = () => void pool<Board>("board").then((b) => { if (mounted.current) setBoard(b); }).catch(() => {});
    load();
    if (watchId) follow(watchId, "");
    else try { const s = JSON.parse(sessionStorage.getItem(SEAT_KEY.pool) ?? "null") as { id: string; player: string } | null; if (s) follow(s.id, s.player); } catch { /* none */ }
    void locker<{ items: CatalogItem[] }>("catalog").then((c) => setCatalog(c.items)).catch(() => {});
    const t = setInterval(load, 30_000);
    return () => { mounted.current = false; source.current?.close(); clearInterval(t); document.title = title; };
  }, []);
  useEffect(() => { try { localStorage.setItem("np-sound", soundOn ? "on" : "off"); } catch { /* private window */ } }, [soundOn]);
  useEffect(() => { if (!address) { setMe(null); return; } void locker<SelfProfile>("me").then((p) => { setMe(p); }).catch(() => {}); }, [address]);
  // what the game gave: the profile before it started, and after it ended
  useEffect(() => { if (match?.startedAt && !match.done && me && !before.current) before.current = me; }, [match?.startedAt, match?.done, me]);
  useEffect(() => {
    if (!match?.done || !address || !before.current || mode === "practice") return;
    const b = before.current; before.current = null;
    setTimeout(() => void locker<SelfProfile>("me").then((p) => { setMe(p); setReward({ xp: p.xp - b.xp, level: p.level, unlocked: p.items.filter((o) => !b.items.some((x) => x.id === o.id)).map((o) => o.edition) }); }).catch(() => {}), 600);
  }, [match?.done]);
  // practice: the frog plays its turns
  useEffect(() => {
    if (mode !== "practice") return;
    const id = setInterval(() => { const p = practice.current; if (p && p.bot()) receive(p.view()); }, 300);
    return () => clearInterval(id);
  }, [mode, receive]);

  const start = async (practiceMode = false) => {
    if (busy) return;
    setBusy(true); setErr(null); setClosedNote(null); setReward(null); primeAlerts();
    try { localStorage.setItem("np-name", name); localStorage.setItem("np-rules", rules); } catch { /* private window */ }
    try {
      source.current?.close(); current.current = null;
      if (practiceMode) { setMode("practice"); practice.current = new Practice(name, rules, me ? { ...lookOf(me), level: me.level, guide: 1 } : undefined); receive(practice.current.view()); }
      else { practice.current = null; setMode("online"); const r = await pool<{ match: MatchView; player: string }>("queue", { name, rules }); token.current = r.player; receive(r.match); follow(r.match.id, r.player); }
    } catch (e) { setErr((e as Error).message); } finally { setBusy(false); }
  };
  const lobby = () => {
    if (current.current) doneWaiting("pool", current.current.id);
    source.current?.close(); source.current = null; practice.current = null; current.current = null; setMatch(null); setErr(null); setReward(null);
    try { sessionStorage.removeItem(SEAT_KEY.pool); } catch { /* private window */ }
    if (mode === "watch") { history.replaceState(null, "", "/games/pool"); setMode("online"); }
  };
  const act = async <T,>(path: string, body: Record<string, unknown>) => pool<T>(`match/${current.current!.id}/${path}`, { player: token.current, ...body });
  const onShoot = async (s: ShotInput) => {
    if (practice.current) { practice.current.shoot(0, s); receive(practice.current.view()); return; }
    receive(await act<MatchView>("shot", s));
  };
  const onDecide = async (choice: string) => { if (practice.current) { practice.current.choose(0, choice); receive(practice.current.view()); return; } receive(await act<MatchView>("decide", { choice })); };
  const onAim = (s: Partial<ShotInput>) => { if (!practice.current && current.current && token.current) void act("aim", s).catch(() => {}); };
  const onEmote = async (id: string) => { if (practice.current) return; await act("emote", { emote: id }); };
  const cancel = async () => { if (!match) return; try { await act("leave", {}); } catch (e) { setErr((e as Error).message); return; } lobby(); };
  const seat = (s: Seat) => { practice.current = null; setMode("online"); follow(s.id, s.player); };
  const loungeSeat = (_g: string, id: string, player: string) => { practice.current = null; setMode("online"); setClosedNote(null); follow(id, player); };
  const lockerApi = {
    equip: (kind: string, value: string | string[]) => locker<SelfProfile>("equip", { kind, value }).then((p) => { setMe(p); return p; }),
    avatar: (n: number) => locker<SelfProfile>("avatar", { avatar: n }).then((p) => { setMe(p); return p; }),
    purchase: (item: string, asset: string) => locker<{ status: string; price: string; asset: string; message: string; left: number | null }>("purchase", { item, asset }) };
  const inGame = !!match?.startedAt || mode === "practice" || (mode === "watch" && !!match);
  const waiting = !!match && !match.startedAt && mode === "online";
  const now = Date.now() + skew;

  if (showLocker) return <div className="np np-page">
    <header className="np-top"><a href="/games/pool" className="np-back" onClick={(e) => { e.preventDefault(); setShowLocker(false); history.replaceState(null, "", "/games/pool"); }}><Icon name="arrow" size={16} /><span>NIGHT POOL</span></a><Wordmark /><span /></header>
    <main className="np-locker-page">{me && catalog.length ? <LockerView me={me} catalog={catalog} api={lockerApi} /> : <div className="np-panel-card"><span className="np-kicker">YOUR LOCKER</span><h2>Sign in to open your locker.</h2><p>Your profile, your level and every numbered item you earn are kept with your wallet. In Telegram they are kept with your Telegram profile, and the same once you link the wallet there.</p><button type="button" className="np-btn" disabled={signing} onClick={() => void signIn()}><Icon name="user" size={16} />{signing ? "SIGNING IN" : "SIGN IN"}</button></div>}</main>
  </div>;

  return <div className={`np np-page ${inGame ? "np-playing" : ""}`}>
    <header className="np-top">
      <a href="/games" className="np-back" onClick={(e) => { e.preventDefault(); if (inGame && match && !match.done && mode === "online") { if (confirm("Leave the table? Your clock keeps running; resign to end the game.")) go("/games"); } else go("/games"); }}><Icon name="arrow" size={16} /><span>{mode === "watch" ? "LIVE GAMES" : "GAME ROOM"}</span></a>
      <a href="/games/pool" className="np-brand" onClick={(e) => { e.preventDefault(); if (!inGame || match?.done || mode !== "online") lobby(); }} aria-label="Night Pool by NIGHTSHIFT"><Wordmark /></a>
      <div className="np-account">
        {inGame && <button type="button" className="np-icon-btn" aria-label={soundOn ? "Mute" : "Sound on"} aria-pressed={soundOn} onClick={() => setSoundOn(!soundOn)}><Icon name={soundOn ? "sound" : "sound-off"} size={18} /></button>}
        {address ? <button type="button" className="np-wallet" onClick={() => { setShowLocker(true); history.replaceState(null, "", "/games/pool/locker"); }}><Icon name="bag" size={15} /><span>LOCKER{me ? ` · LV ${me.level}` : ""}</span></button> : <button type="button" className="np-btn ghost small" disabled={signing} onClick={() => void signIn()}><Icon name="user" size={15} /><span>{signing ? "SIGNING IN" : "SIGN IN"}</span></button>}
      </div>
    </header>

    {!inGame && <main className="np-lobby">
      <section className="np-hero" aria-labelledby="np-title">
        <span className="np-kicker"><i className="np-live" /> NIGHTSHIFT GAME ROOM / 04</span>
        <h1 id="np-title">Rack them up.<br /><em>Call your pocket.</em></h1>
        <p>3D 8-ball on WPA rules. Every shot is simulated by the server and replayed for both players and the stands, ball by ball.</p>
        <div className="np-cabinet"><Showcase /><div className="np-cabinet-bar"><span><Icon name="pool" size={14} /> NIGHT POOL · 7-FOOT TABLE</span><span>WPA 8-BALL</span></div></div>
      </section>
      <section className="np-panel-card" aria-label="Set up your game">
        <div className="np-panel-head"><span className="np-kicker">CLOCK IN, NIGHT CREW</span><span className="np-free">{money === "FREE" ? "FREE · RATED" : "STAKED · 18+"}</span></div>
        <label className="np-label" htmlFor="np-name">YOUR PLAYER NAME</label>
        <div className="np-name"><input id="np-name" value={name} maxLength={18} placeholder="Night crew" autoComplete="nickname" disabled={busy || waiting} onChange={(e) => setName(e.target.value)} /><Icon name="edit" size={17} /></div>
        <div className="np-section"><span>01 / THE RULES</span><Icon name="book" size={14} /></div>
        <div className="np-choice" role="group" aria-label="Rules">{(["wpa", "quick"] as const).map((k) => <button type="button" key={k} className={rules === k ? "on" : ""} aria-pressed={rules === k} disabled={waiting} onClick={() => setRules(k)}><b>{k === "wpa" ? "WPA" : "QUICK"}</b><small>{k === "wpa" ? "Call ball and pocket, or a safety. The world rules." : "Call the 8 only. Any ball of yours keeps you shooting."}</small></button>)}</div>
        <div className="np-section"><span>02 / PLAY FOR</span><Icon name="diamond" size={14} /></div>
        <div className="np-choice three" role="group" aria-label="Stake">{(["FREE", "IMD", "SHIFT"] as const).map((k) => <button type="button" key={k} className={money === k ? "on" : ""} aria-pressed={money === k} disabled={waiting} onClick={() => setMoney(k)}><b>{k === "FREE" ? "FREE" : tokenLabel(k)}</b><small>{k === "FREE" ? "Rated · no stake" : escrow?.live ? "Winner takes 95%" : "Opens with the signer"}</small></button>)}</div>
        {money === "FREE" ? <button type="button" className="np-btn primary" disabled={busy || waiting} onClick={() => void start()}><Icon name="swords" size={18} /><span>{busy ? "OPENING YOUR TABLE" : "FIND A RIVAL"}</span><Icon name="arrow" size={17} /></button>
          : <StakeLobby game="pool" token={money} name={name} address={address} signIn={signIn} onSeat={seat} theme="nc" />}
        <button type="button" className="np-btn ghost" disabled={busy || waiting} onClick={() => void start(true)}><img className="np-frog" src="/games/pinball/frog-3.webp" alt="" width={26} height={26} />PRACTICE WITH FROG #7<span className="np-muted">OFFLINE</span></button>
        {closedNote && <p className="np-error" role="status"><Icon name="clock" size={15} />{closedNote}</p>}
        {err && <p className="np-error" role="alert"><Icon name="alert" size={15} />{err}</p>}
        {money === "FREE" && <Lounge game="pool" onSeat={loungeSeat} />}
        <div className="np-section"><span>03 / HOW IT PLAYS</span></div>
        <div className="np-how">{[["target", "Aim", "Move the mouse, or drag round the cue ball. Fine-tune on the strip or the arrow keys."], ["bolt", "Power", "Pull the bar down and let go. Space works too."], ["orbit", "Spin", "Tap SPIN: follow, draw, english, and the cue's elevation for a masse."], ["shield", "Fair", "The server simulates every shot: the same physics for both players and the stands."]].map(([i, t, c]) => <div key={t}><Icon name={i!} size={20} /><b>{t}</b><p>{c}</p></div>)}</div>
        <div className="np-leaders"><div className="np-section"><span><Icon name="trophy" size={14} /> THE NIGHT CREW</span><span>ELO</span></div>
          <div className="np-tabs" role="group" aria-label="Leaderboard period">{([["board", "Tonight"], ["best", "All time"]] as const).map(([k, l]) => <button type="button" key={k} aria-pressed={tab === k} className={tab === k ? "on" : ""} onClick={() => setTab(k)}>{l}</button>)}</div>
          {board[tab].length ? <ol>{board[tab].map((p, i) => <li key={`${p.name}-${i}`}><span className="np-rank">{String(i + 1).padStart(2, "0")}</span><div><b>{p.name}</b><small>{p.wins} W / {p.games} G</small></div><strong>{p.rating}</strong></li>)}</ol> : <p className="np-empty">No rated racks {tab === "board" ? "in the last 24 hours" : "yet"}. Break the first.</p>}
        </div>
        <p className="np-legal"><Icon name="lock" size={14} /><span>Free tables need no wallet. Staked duels in IMD and $SHIFT are for adults 18+ only, where allowed. Cosmetics never change how a shot plays.</span></p>
      </section>
    </main>}

    {waiting && match && <div className="np-overlay np-search" role="dialog" aria-modal="true" aria-labelledby="np-wait"><div className="np-dialog">
      <div className="np-radar"><Icon name="radar" size={34} /></div>
      <span className="np-kicker">{match.escrow ? "STAKED DUEL" : `MATCHMAKING · ${match.rules === "wpa" ? "WPA" : "QUICK"} RULES`}</span>
      <h2 id="np-wait">{match.escrow ? <>Waiting for<br />your <em>rival.</em></> : <>Racking<br />the <em>table.</em></>}</h2>
      <p>{match.escrow ? "Both stakes are in. The break starts when your rival connects, or within 5 minutes." : "Your table is open in the lounge. Browse the site meanwhile: you hear it when someone sits down."}</p>
      <span className="np-kicker">{match.escrow ? `${match.stake} ${tokenLabel(match.currency)} EACH` : `WAITING ${waitText(now - match.waitingSince)}`}</span>
      {!match.escrow && <><button type="button" className="np-btn" onClick={() => go("/games")}><Icon name="radar" size={16} />BROWSE WHILE YOU WAIT</button><button type="button" className="np-btn ghost" onClick={() => void cancel()}>CANCEL</button></>}
    </div></div>}

    {inGame && match && <main className="np-game">
      <PoolGame view={match} spectate={mode === "watch"} practice={mode === "practice"} soundOn={soundOn} skew={skew} reward={reward} haptic={mode === "watch" ? undefined : haptic}
        onShoot={onShoot} onAim={onAim} onDecide={onDecide} onEmote={mode === "online" ? onEmote : undefined}
        onResign={mode !== "watch" ? () => { if (confirm("Resign this rack?")) { if (practice.current) lobby(); else void act<MatchView>("resign", {}).then(receive).catch((e) => setErr((e as Error).message)); } } : undefined}
        onRematch={mode === "online" && !match.escrow ? () => void act<MatchView>("rematch", {}).then(receive).catch((e) => setErr((e as Error).message)) : mode === "practice" ? () => void start(true) : undefined}
        onLobby={lobby} onLocker={address ? () => { setShowLocker(true); history.replaceState(null, "", "/games/pool/locker"); } : undefined} />
      <aside className="np-side">
        <div className="np-side-head"><span className="np-kicker">{mode === "practice" ? "PRACTICE · FROG #7" : mode === "watch" ? <><i className="np-live" /> SPECTATING · {match.viewers ?? 0} WATCHING</> : <><i className="np-live" /> LIVE · {match.rules === "wpa" ? "WPA" : "QUICK"} RULES</>}</span>{match.currency !== "FREE" && <span className="np-stake">{match.stake} {tokenLabel(match.currency)}</span>}</div>
        <ol className="np-log">{[...match.log].reverse().map((l) => <li key={`${l.n}-${l.at}`} className={l.foul ? "foul" : ""}><span>{match.players[l.seat]?.name}</span>{l.text}</li>)}{!match.log.length && <li>The break is next.</li>}</ol>
        {match.escrow && match.done && <StakeResult matchId={match.escrow} address={address} />}
        {mode === "watch" && <BetPanel game="pool" id={match.id} theme="nc" />}
        <p className="np-help"><Icon name="target" size={14} />Mouse or drag to aim · pull the bar to shoot · tap the call to change it.</p>
      </aside>
    </main>}
    {mode === "watch" && !match && <div className="np-overlay"><div className="np-dialog"><span className="np-kicker">SPECTATOR MODE</span><h2>{err ? "No table to watch." : "Finding the table…"}</h2><button type="button" className="np-btn" onClick={() => go("/games/live")}>WATCH ANOTHER</button></div></div>}
  </div>;
}
/** The look a signed-in player brings to the practice table. */
function lookOf(p: SelfProfile) {
  const e = p.equip;
  return { cue: e.cue, cloth: e.cloth, table: e.table, balls: e.balls, frame: e.frame, banner: e.banner, title: e.title, effect: e.effect, emotes: e.emote, avatar: `/games/pinball/frog-${p.avatar}.webp` };
}
