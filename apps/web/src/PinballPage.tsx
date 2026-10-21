import { Suspense, lazy, useEffect, useRef, useState } from "react";
import { go, Link } from "./router";
import { Icon } from "./Icon";
import { type Landed, type Live, PinballGame, type Rival, type Shot } from "./pinball/PinballGame";
import type { Input } from "./pinball/engine";
import { useSession } from "./session";
import { InstallButton, useGameApp } from "./pinball/install";
import { NxTabs as AppTabsNx } from "./nx/Shell";
const AppTabs = (_: { active: string }) => <AppTabsNx room="breakroom" />;
import { type Seat, StakeLobby, StakeResult, useEscrow } from "./stakes";
import { alertJoined, doneWaiting, keepSeat, keepWaiting, Lounge, primeAlerts, waitText } from "./games/lounge";
import "./pinball/arcade.css";
import { LITE, onHidden } from "./lite";

/** Spectator mode (/games/pinball?watch=<id>): its own chunk, loaded only when someone watches. */
const PinballWatch = lazy(() => import("./pinball/Watch").then((x) => ({ default: x.PinballWatch })));

type Currency = "FREE" | "IMD" | "SHIFT";
type Mode = "PRACTICE" | Currency;
/** A player as the server shows them; the rival's verified score, stats and finish only once the match is settled. Faces come in the first frame. */
type PlayerView = { key: string; name: string; avatar?: string | null; live: number; x: number; y: number; attacks: Shot[]; score: number | null; solo: number | null; stats: Record<string, number> | null; you: boolean; finished: boolean; error?: string };
/** Salts the server hands out, from the number this page said it holds. */
type LuckPart = { from: number; salts: number[] };
/** `seed` is the deal's commitment (the sha256 of all its salts), shown at the start; the salts come in `luck` as the stream reaches them. */
type MatchView = { id: string; escrow: string | null; seed: string | null; luck?: LuckPart | null; currency: Currency; stake: number; startedAt: number | null; now?: number; done: boolean; draw: boolean; void: string | null; winner: string | null; winnerIsYou: boolean; players: PlayerView[]; waitingSince?: number; movedTo?: string | null };
/** What is on the table (it stays mounted under the result) and what is shown over it. A board run runs on the server's clock. */
type Play = { kind: "practice"; seed: number; run: number; id?: string; deal?: string; startAt?: number; offset?: number } | { kind: "duel"; match: MatchView; player: string };
type SoloStart = { id: string; seed: string; luck: LuckPart; startedAt: number; now: number };
type Over = { score: number; stats?: Record<string, number>; rank?: number | null };
type BoardEntry = { name: string; score: number; at: number };
type Leaderboard = { board: BoardEntry[]; best: BoardEntry[]; solo?: BoardEntry[]; soloBest?: BoardEntry[] };

/** A duel's table before it is dealt: no salt, so it does not move. */
const NO_LUCK: number[] = [];

const MODES: { k: Mode; title: string; sub: string; icon: string }[] = [
  { k: "PRACTICE", title: "Practice", sub: "Solo · learn the table", icon: "play" },
  { k: "FREE", title: "Free duel", sub: "1 vs 1 · no stake", icon: "swords" },
  { k: "IMD", title: "IMD duel", sub: "Winner takes 95%", icon: "diamond" },
  { k: "SHIFT", title: "$SHIFT duel", sub: "Winner takes 95%", icon: "crescent" },
];

// Shared SVG definitions let the game use the icon set entirely from its returned JSX.
const GAME_ICONS = ["sound", "sound-off", "music", "black-hole", "frog", "orbit", "target", "shield", "bolt", "flipper", "radar"];

/**
 * The signed-in wallet's best NIGHT FROG (highest multiplier). Its onchain image is served by the
 * engine, which checks on chain that the wallet holds it before showing it to a rival.
 */
function useFrogAvatar(wallet: string | null): { id: number; src: string } | null {
  const [frog, setFrog] = useState<{ id: number; src: string } | null>(null);
  useEffect(() => {
    setFrog(null);
    if (!wallet) return;
    let live = true;
    void (async () => {
      const d = await fetch(`/api/frogs/staking?wallet=${wallet}`).then((r) => r.json()).catch(() => null);
      const best = (d?.me?.frogs ?? []).sort((a: { multiplier: number }, b: { multiplier: number }) => b.multiplier - a.multiplier)[0];
      if (!best) return;
      const src = `/api/pinball/frog/${Number(best.id)}`, im = new Image();
      im.onload = () => { if (live) setFrog({ id: Number(best.id), src }); };
      im.src = src;
    })();
    return () => { live = false; };
  }, [wallet]);
  return frog;
}

async function api<T>(path: string, body?: unknown): Promise<T> {
  const r = await fetch(`/api/pinball/${path}`, { method: body ? "POST" : "GET", headers: body ? { "Content-Type": "application/json" } : {}, body: body ? JSON.stringify(body) : undefined });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw Object.assign(new Error(j.error ?? `HTTP ${r.status}`), { status: r.status });
  return j as T;
}
/** A stream post: taken, to be sent again (network, rate limit), or refused for good (the server says why). The reply may carry new salts. */
async function stream(path: string, body: unknown, refused: (why: string) => void, got?: (l: LuckPart | null | undefined) => void): Promise<boolean | "stop"> {
  try { const r = await api<{ luck?: LuckPart | null }>(path, body); got?.(r.luck); return true; } catch (e) {
    if ((e as { status?: number }).status === 400) { refused((e as Error).message); return "stop"; }
    return false;
  }
}

function Confetti() {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    if (matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const c = ref.current!, g = c.getContext("2d")!; let raf = 0, prev = performance.now();
    const bits = Array.from({ length: LITE ? 30 : 80 }, () => ({ x: Math.random() * c.width, y: -Math.random() * c.height, vy: 90 + Math.random() * 170, vx: (Math.random() - 0.5) * 70, r: Math.random() * 6, c: ["#F2EFFF", "#A48BFF", "#7C5CFF"][Math.floor(Math.random() * 3)]! }));
    const f = (now: number) => {
      const dt = (now - prev) / 1000; prev = now; g.clearRect(0, 0, c.width, c.height);
      for (const b of bits) { b.y += b.vy * dt; b.x += b.vx * dt; b.r += dt * 4; if (b.y > c.height) { b.y = -10; b.x = Math.random() * c.width; } g.save(); g.translate(b.x, b.y); g.rotate(b.r); g.fillStyle = b.c; g.fillRect(-5, -2, 10, 4); g.restore(); }
      raf = requestAnimationFrame(f);
    };
    raf = requestAnimationFrame(f);
    const off = onHidden((hidden) => { cancelAnimationFrame(raf); if (!hidden) { prev = performance.now(); raf = requestAnimationFrame(f); } });
    return () => { cancelAnimationFrame(raf); off(); };
  }, []);
  return <canvas ref={ref} width={600} height={900} className="arc-confetti" />;
}

export function PinballPage() {
  const { address, signIn, busy } = useSession();
  const frog = useFrogAvatar(address ?? null);
  const avatar = frog?.src ?? null;
  const [play, setPlay] = useState<Play | null>(null);
  const [waiting, setWaiting] = useState<{ match: MatchView; player: string } | null>(null);
  const [over, setOver] = useState<Over | null>(null);
  const [name, setName] = useState(() => { try { return localStorage.getItem("pb-name") ?? ""; } catch { return ""; } });
  // ?accept=<match>&token=IMD (from the lounge): the stake lobby, where that challenge is accepted
  const [mode, setMode] = useState<Mode>(() => { const t = new URLSearchParams(location.search).get("token"); return t === "IMD" || t === "SHIFT" ? t : "FREE"; });
  const [now, setNow] = useState(Date.now());
  const escrow = useEscrow();
  const [err, setErr] = useState<string | null>(null);
  const [leaderboard, setLeaderboard] = useState<Leaderboard>({ board: [], best: [] });
  const [boardTab, setBoardTab] = useState<"board" | "best">("board");
  const [boardKind, setBoardKind] = useState<"duel" | "solo">("duel");
  const board = (boardKind === "duel" ? leaderboard[boardTab] : boardTab === "board" ? leaderboard.solo : leaderboard.soloBest) ?? [];
  const es = useRef<EventSource | null>(null);
  /** The open duel this page waits in: someone sitting down there is announced once. */
  const openId = useRef<string | null>(null);
  // server time minus ours; the smallest delivery delay gives the best estimate, so keep the largest sample
  const clock = useRef(0);
  const sync = (m: MatchView) => { if (m.now) clock.current = Math.max(clock.current === 0 ? -Infinity : clock.current, m.now - Date.now()); };
  // faces come in a stream's first frame (and when the players change), by each player's public key
  const faces = useRef(new Map<string, string | null>());
  const withFaces = (m: MatchView): MatchView => ({ ...m, players: m.players.map((p) => { if (p.avatar !== undefined) faces.current.set(p.key, p.avatar); return { ...p, avatar: faces.current.get(p.key) ?? null }; }) });
  const me = name.trim() || "Night crew";
  // the dealt game's salts: one array per deal (its commitment), filled in order as frames and replies bring them
  const luck = useRef<{ deal: string | null; salts: number[] }>({ deal: null, salts: [] });
  const take = (deal: string | null | undefined, l?: LuckPart | null) => {
    if (!deal) return;
    if (luck.current.deal !== deal) luck.current = { deal, salts: [] };
    const h = luck.current.salts;
    if (l && l.from <= h.length) h.push(...l.salts.slice(h.length - l.from));
  };
  const saltsFor = (deal: string | null | undefined) => (deal && luck.current.deal === deal ? luck.current.salts : undefined);
  const [watchId, setWatchId] = useState(() => new URLSearchParams(location.search).get("watch"));
  // the path stays /games/pinball between watching and playing: follow the query instead
  useEffect(() => { const on = () => setWatchId(new URLSearchParams(location.search).get("watch")); addEventListener("popstate", on); return () => removeEventListener("popstate", on); }, []);

  useGameApp();
  useEffect(() => { if (!watchId) document.title = "Space Pinball · NIGHTSHIFT"; }, [watchId]);
  useEffect(() => {
    void api<Leaderboard>("board").then(setLeaderboard).catch(() => {});
  }, [play === null]);
  useEffect(() => () => es.current?.close(), []);
  useEffect(() => { if (!waiting) return; const t = setInterval(() => setNow(Date.now()), 1_000); return () => clearInterval(t); }, [!!waiting]);
  // a seat from the lounge, or a duel left waiting while browsing: taken up again here
  useEffect(() => {
    if (watchId) return;
    try { const saved = JSON.parse(sessionStorage.getItem("pb-match") ?? "null") as { id: string; player: string } | null; if (saved) follow(saved.id, saved.player); } catch { /* no saved seat */ }
  }, [watchId]);

  const follow = (id: string, player: string) => {
    es.current?.close();
    const s = new EventSource(`/api/pinball/match/${id}/events?player=${player}`);
    s.onmessage = (m) => {
      const match = withFaces(JSON.parse(m.data) as MatchView);
      sync(match);
      take(match.seed, match.luck);
      const mine = match.players.find((p) => p.you);
      if (mine?.error) setErr(mine.error);
      // the rival never connected: back to the lobby, or (the match reopened) back to the search
      // folded into an older table in the lounge: the same seat, followed there
      if (match.movedTo) { keepSeat("pinball", { id: match.movedTo, player }); keepWaiting(null); follow(match.movedTo, player); return; }
      if (match.void) { s.close(); doneWaiting("pinball", match.id); keepSeat("pinball", null); setPlay(null); setWaiting(null); setErr(match.void); return; }
      if (match.done && !match.startedAt) { s.close(); doneWaiting("pinball", match.id); keepSeat("pinball", null); setPlay(null); setWaiting(null); return; }
      if (match.startedAt) {
        // a duel cannot be picked up again after a reload: the seat is kept only while waiting
        doneWaiting("pinball", match.id); keepSeat("pinball", null);
        if (openId.current === match.id) { openId.current = null; alertJoined("pinball", "/games/pinball"); }
        setWaiting(null);
        setPlay((p) => (p?.kind === "duel" && p.match.id === match.id ? { ...p, match } : { kind: "duel", match, player }));
      }
      else {
        setPlay((p) => (p?.kind === "duel" && p.match.id === match.id ? null : p)); setWaiting({ match, player });
        if (!match.escrow) { openId.current = match.id; keepSeat("pinball", { id: match.id, player }); keepWaiting({ game: "pinball", id: match.id, player, tc: null, since: match.waitingSince ?? Date.now() }); }
      }
    };
    s.onerror = () => {
      // a restart or a closed table: the saved seat is gone, back to the lobby
      if (es.current !== s) return;
      void fetch(`/api/pinball/match/${id}?player=${encodeURIComponent(player)}`).then((r) => { if (es.current === s && r.status === 404) { s.close(); doneWaiting("pinball", id); keepSeat("pinball", null); setWaiting(null); setErr("That table has closed. Find a new rival."); } }).catch(() => {});
    };
    es.current = s;
  };

  const start = async (want: Mode = mode) => {
    setErr(null); setOver(null);
    try { localStorage.setItem("pb-name", name); } catch { /* private window */ }
    if (want === "PRACTICE") {
      es.current?.close();
      // the server deals the table and runs its clock so the run can go on the solo board; offline, practice still works
      const r = await api<SoloStart>("solo", { name: me }).catch((e) => { if ((e as { status?: number }).status === 409) setErr((e as Error).message); return null; });
      if (r) take(r.seed, r.luck);
      setPlay({ kind: "practice", seed: Math.floor(Math.random() * 2 ** 32), run: Date.now(), id: r?.id, deal: r?.seed, startAt: r?.startedAt, offset: r ? r.now - Date.now() : 0 });
      return;
    }
    try {
      clock.current = 0; primeAlerts();
      const r = await api<{ match: MatchView; player: string }>("queue", { name: me, currency: "FREE", stake: 0, avatar: frog ? `frog:${frog.id}` : "/games/pinball/frog-0.webp" });
      r.match = withFaces(r.match);
      sync(r.match);
      take(r.match.seed, r.match.luck);
      if (r.match.startedAt) setPlay({ kind: "duel", match: r.match, player: r.player }); else setWaiting(r);
      follow(r.match.id, r.player);
    } catch (e) { setErr((e as Error).message); }
  };

  const finished = async (r: { score: number; inputs: Input[]; stats: Record<string, number>; landed: Landed[]; tick: number }) => {
    setOver({ score: r.score, stats: r.stats });
    if (play?.kind === "practice" && play.id) {
      const id = play.id;
      const v = await api<{ score: number; rank: number | null }>(`solo/${id}/finish`, { inputs: r.inputs }).catch((e) => { setErr((e as Error).message); return null; });
      if (v) { setOver({ score: v.score, stats: r.stats, rank: v.rank }); void api<Leaderboard>("board").then(setLeaderboard).catch(() => {}); }
    }
    if (play?.kind === "duel") await api(`match/${play.match.id}/finish`, { player: play.player, inputs: r.inputs, landed: r.landed, tick: r.tick }).catch((e) => setErr((e as Error).message));
  };
  // the inputs go to the server while the game runs: a duel's to its match, a board run's to its run
  const onLive = play?.kind === "duel" ? (s: Live) => stream(`match/${play.match.id}/progress`, { player: play.player, ...s }, setErr, (l) => take(play.match.seed, l))
    : play?.kind === "practice" && play.id ? (s: Live) => stream(`solo/${play.id}/progress`, s, setErr, (l) => take(play.deal, l)) : undefined;
  /** Both stakes are in: take the seat the lobby gave this wallet, as any duel. */
  const seat = (s: Seat) => { setErr(null); setOver(null); clock.current = 0; follow(s.id, s.player); };
  /** A seat from the lounge on this page: the same as a seat from the queue. */
  const loungeSeat = (_game: string, id: string, player: string) => { setErr(null); setOver(null); clock.current = 0; try { localStorage.setItem("pb-name", name); } catch { /* private window */ } follow(id, player); };
  const toLobby = () => { es.current?.close(); setPlay(null); setOver(null); setWaiting(null); };

  const opp = play?.kind === "duel" ? play.match.players.find((p) => !p.you) : null;
  const rival: Rival | null = opp ? { name: opp.name, avatar: opp.avatar, live: opp.score ?? opp.live, x: opp.x, y: opp.y, attacks: opp.attacks } : null;
  const staked = mode === "IMD" || mode === "SHIFT";

  const result = over && (() => {
    const m = play?.kind === "duel" ? play.match : null;
    const mine = m?.players.find((p) => p.you), other = m?.players.find((p) => !p.you);
    const won = !!m?.done && !m.draw && m.winnerIsYou;
    const title = !m ? "GAME OVER" : !m.done ? "SCORE IS IN" : m.draw ? "DRAW" : won ? "VICTORY" : "DEFEAT";
    const stats = mine?.stats ?? over.stats;
    return (
      <div className={`arc-overlay ${won ? "won" : m?.done && !m.draw ? "lost" : ""}`} role="region" aria-label="Game result">
        {won && <Confetti />}
        <div className="arc-result">
          <span className="arc-result-icon"><Icon name={won ? "trophy" : !m ? "orbit" : !m.done ? "radar" : m.draw ? "scales" : "swords"} size={28} /></span>
          <span className="arc-kicker">{m ? (m.done ? "Final result · verified by replay" : "Waiting for your rival to finish") : over.rank ? `Verified by replay · #${over.rank} on the solo board` : "Practice complete"}</span>
          <h2 key={title} className="arc-result-title">{title}</h2>
          {m ? <div className="arc-vs">
            <div><div className="arc-face"><img src={mine?.avatar ?? "/games/pinball/frog-0.webp"} alt="" /></div><span>{mine?.name ?? me}</span><b>{(mine?.score ?? over.score).toLocaleString()}</b></div>
            <i>VS</i>
            <div className="rival"><div className="arc-face rival"><img src={other?.avatar ?? "/games/pinball/frog-3.webp"} alt="" /></div><span>{other?.name ?? "Rival"}</span><b>{other?.score != null ? other.score.toLocaleString() : `${(other?.live ?? 0).toLocaleString()}…`}</b></div>
          </div> : <div className="arc-solo-result"><div className="arc-face"><img src={avatar ?? "/games/pinball/frog-0.webp"} alt="" /></div><span className="arc-label">{me}</span><b className="arc-big">{over.score.toLocaleString()}</b><span className="arc-kicker">Final score</span></div>}
          {stats && <div className="arc-stats">
            <div><b>{stats.bumpers ?? 0}</b><span>planet hits</span></div><div><b>{stats.holes ?? 0}</b><span>black holes</span></div>
            <div><b>{stats.sent ?? 0}</b><span>attacks sent</span></div><div><b>{stats.received ?? 0}</b><span>attacks taken</span></div>
          </div>}
          {m?.escrow && <StakeResult matchId={m.escrow} address={address ?? null} />}
          <div className="arc-actions">{m?.escrow ? <button type="button" className="arc-btn" onClick={toLobby}><Icon name="swords" size={17} />NEW CHALLENGE</button> : <button type="button" className="arc-btn" onClick={() => void start()}><Icon name={m ? "swords" : "play"} size={17} />{m ? "REMATCH" : "PLAY AGAIN"}</button>}<button type="button" className="arc-btn ghost" onClick={toLobby}>LOBBY</button></div>
          {err && <p className="arc-err" role="alert">{err}</p>}
        </div>
      </div>
    );
  })();

  const search = waiting && <div className="arc-overlay arc-search" role="region" aria-label="Finding a rival">
    <div className="arc-result">
      <div className="arc-radar"><Icon name="radar" size={32} /></div>
      <span className="arc-kicker" role="status">{waiting.match.escrow ? "Staked duel · both stakes in" : "Matchmaking · searching"}</span>
      <h2>{waiting.match.escrow ? <>Waiting for<br />your rival</> : <>Finding<br />your rival</>}</h2>
      <div className="arc-vs">
        <div><div className="arc-face"><img src={avatar ?? "/games/pinball/frog-0.webp"} alt="" /></div><span>{me}</span></div>
        <i>VS</i>
        <div><div className="arc-face arc-face-pending"><Icon name="user" size={28} /></div><span>Awaiting player</span></div>
      </div>
      <div className="arc-stats">
        <div><b>1 / 2</b><span>players</span></div><div><b>{waiting.match.currency === "FREE" ? "Free" : waiting.match.currency === "SHIFT" ? "$SHIFT" : "IMD"}</b><span>duel</span></div>
        <div><b>{waiting.match.stake.toLocaleString()}</b><span>stake</span></div><div><b>3 s</b><span>attack delay</span></div>
      </div>
      {waiting.match.escrow ? <p>The duel starts as soon as your rival connects, or within 5 minutes. A player who never plays scores 0. Keep this page open.</p> : <>
        <p>Your duel is open in the lounge, waiting {waitText(now - (waiting.match.waitingSince ?? now))}. The next player to find a rival joins your table. Browse the site meanwhile: you hear it when someone joins.</p>
        <div className="arc-actions"><button type="button" autoFocus className="arc-btn" onClick={() => go("/games")}><Icon name="radar" size={17} />BROWSE WHILE YOU WAIT</button>
        <button type="button" className="arc-btn ghost" onClick={() => { es.current?.close(); void api(`match/${waiting.match.id}/leave`, { player: waiting.player }).catch(() => {}); doneWaiting("pinball", waiting.match.id); keepSeat("pinball", null); setWaiting(null); }}>CANCEL SEARCH</button></div>
      </>}
    </div>
  </div>;

  // a spectator: both tables read-only, no seat, nothing to post
  if (watchId) return (
    <div className="arc arc-watching">
      <svg className="arc-icon-defs" width="0" height="0" aria-hidden="true"><defs>{GAME_ICONS.map((icon) => <g id={`arc-icon-${icon}`} key={icon}><Icon name={icon} size={24} /></g>)}</defs></svg>
      <div className="arc-bg" aria-hidden="true" />
      <header className="arc-top">
        <Link to="/games/live" className="arc-back"><Icon name="arrow" size={17} /><span>LIVE GAMES</span></Link>
        <Link to="/games/pinball" className="arc-logo" aria-label="Space Pinball by NIGHTSHIFT"><img src="/brand/space-pinball-logo.svg" alt="Space Pinball by NIGHTSHIFT" width={410} height={156} /></Link>
        <div className="arc-who"><InstallButton /></div>
      </header>
      <Suspense fallback={<div className="arc-boot" />}><PinballWatch id={watchId} /></Suspense>
      <AppTabs active="games" />
    </div>
  );

  return (
    <div className={`arc ${play ? "arc-is-playing" : ""}`}>
      <svg className="arc-icon-defs" width="0" height="0" aria-hidden="true"><defs>{GAME_ICONS.map((icon) => <g id={`arc-icon-${icon}`} key={icon}><Icon name={icon} size={24} /></g>)}</defs></svg>
      <div className="arc-bg" aria-hidden="true" />
      <header className="arc-top">
        <Link to="/games" className="arc-back"><Icon name="arrow" size={17} /><span>GAME ROOM</span></Link>
        <Link to="/games/pinball" className="arc-logo" aria-label="Space Pinball by NIGHTSHIFT"><img src="/brand/space-pinball-logo.svg" alt="Space Pinball by NIGHTSHIFT" width={410} height={156} /></Link>
        <div className="arc-who"><InstallButton />{address ? <span className="arc-addr" title={address}>{avatar ? <img src={avatar} alt="" /> : <Icon name="user" size={16} />}{address.slice(0, 6)}…{address.slice(-4)}</span> : <button type="button" className="arc-btn sm ghost" disabled={busy} onClick={() => void signIn()}><Icon name="user" size={15} /><span>{busy ? "SIGNING IN" : "SIGN IN"}</span></button>}</div>
      </header>

      {!play && <main className="arc-lobby">
        <section className="arc-stage" aria-labelledby="arc-title">
          <div className="arc-intro">
            <span className="arc-kicker"><span className="arc-live-dot" /> THE AFTER-HOURS ARCADE / 01</span>
            <h1 id="arc-title">Space <em>Pinball</em></h1>
            <p>A little skill. A little chaos. All night.</p>
          </div>
          <div className="arc-cabinet">
            <div className="arc-marquee"><span><Icon name="orbit" size={17} /> NIGHTSHIFT ORIGINAL</span><span className="arc-live" title="A bot plays this table while you choose your mode">DEMO · AUTOPLAY</span></div>
            <div className="arc-screen"><PinballGame seed={7} demo />{search}</div>
            <div className="arc-insert"><Icon name="flipper" size={16} /><span>THREE BALLS. MAKE THEM COUNT.</span><span>01</span></div>
          </div>
        </section>

        <section className="arc-panel" aria-label="Set up your game">
          <div className="arc-panel-head"><span className="arc-kicker">TAKE YOUR PLACE</span><Icon name="frog" size={22} /></div>
          <div className="arc-player">
            <div className="arc-face big"><img src={avatar ?? "/games/pinball/frog-0.webp"} alt="" /></div>
            <div>
              <label className="arc-kicker" htmlFor="arc-name">YOUR PLAYER NAME · TAP TO EDIT</label>
              <label className="arc-name-field" htmlFor="arc-name">
                <input id="arc-name" className="arc-name" maxLength={18} autoComplete="nickname" placeholder="Type your name" value={name} onChange={(e) => setName(e.target.value)} />
                <Icon name="edit" size={16} />
              </label>
              <span className="arc-player-note">{avatar ? "Your NIGHT FROG. Your seat at the table." : address ? "No NIGHT FROG in this wallet" : "Sign in to bring your NIGHT FROG"}</span>
            </div>
          </div>

          <div className="arc-section-head"><span className="arc-kicker">01 / CHOOSE YOUR MODE</span><span>Solo or head-to-head</span></div>
          <div className="arc-modes" aria-label="Game mode">
            {MODES.map((x) => {
              const lk = (x.k === "IMD" || x.k === "SHIFT") && !escrow?.live;
              return <button type="button" key={x.k} aria-pressed={mode === x.k} className={`arc-mode ${mode === x.k ? "on" : ""} ${lk ? "locked" : ""}`} onClick={() => setMode(x.k)}>
                <i className="arc-mode-icon"><Icon name={x.icon} size={23} /></i><b>{x.title}</b><span>{lk ? "Opens with the signer" : x.sub}</span>
                <i className="arc-mode-mark">{lk ? <Icon name="lock" size={13} /> : mode === x.k ? <Icon name="check" size={13} /> : null}</i>
              </button>;
            })}
          </div>

          {staked ? <StakeLobby game="pinball" token={mode} name={me} address={address ?? null} signIn={signIn} onSeat={seat} theme="arc" />
            : <button type="button" className="arc-btn play" disabled={!!waiting} onClick={() => void start()}><Icon name={waiting ? "radar" : mode === "PRACTICE" ? "play" : "swords"} size={20} /><span>{waiting ? "FINDING YOUR RIVAL" : mode === "PRACTICE" ? "PLAY PRACTICE" : "FIND A RIVAL"}</span>{!waiting && <Icon name="arrow" size={18} />}</button>}
          {err && <p className="arc-err" role="alert">{err}</p>}
          {mode === "FREE" && <Lounge game="pinball" onSeat={loungeSeat} />}

          <div className="arc-section-head"><span className="arc-kicker">02 / HOW IT PLAYS</span><span>Same table. Same seed.</span></div>
          <div className="arc-how">
            <div><i><Icon name="black-hole" size={22} /></i><b>Black hole + orbit</b><span>+2,000 / +500. Send a meteor to your rival in 3 s.</span></div>
            <div><i><Icon name="frog" size={22} /></i><b>Frog crew ×3</b><span>+1,500, a multiplier and 5 s of heavy gravity for your rival.</span></div>
            <div><i><Icon name="target" size={22} /></i><b>Skill shot</b><span>Release in the green band. Collect +1,000.</span></div>
            <div><i><Icon name="scales" size={22} /></i><b>Fair by replay</b><span>Both games replayed on the server. Every attack accounted for.</span></div>
          </div>

          <div className="arc-board">
            <div className="arc-section-head"><span className="arc-kicker"><Icon name="trophy" size={15} /> VERIFIED BEST</span><span>{boardTab === "board" ? "LAST 24 HOURS" : "ALL-TIME RECORDS"}</span></div>
            <div className="arc-board-tabs kind" role="group" aria-label="Leaderboard">
              {([{ key: "duel", label: "Duels" }, { key: "solo", label: "Solo" }] as const).map((k) => <button type="button" key={k.key} aria-pressed={boardKind === k.key} className={boardKind === k.key ? "on" : ""} onClick={() => setBoardKind(k.key)}>{k.label}</button>)}
            </div>
            <div className="arc-board-tabs" role="tablist" aria-label="Leaderboard period">
              {([{ key: "board", label: "Tonight" }, { key: "best", label: "All time" }] as const).map((tab) => <button
                type="button" role="tab" key={tab.key} id={`arc-tab-${tab.key}`} aria-selected={boardTab === tab.key}
                aria-controls="arc-board-scores" tabIndex={boardTab === tab.key ? 0 : -1}
                onClick={() => setBoardTab(tab.key)}
                onKeyDown={(event) => {
                  if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
                  event.preventDefault();
                  const next = event.key === "Home" ? "board" : event.key === "End" ? "best" : boardTab === "board" ? "best" : "board";
                  setBoardTab(next);
                  document.getElementById(`arc-tab-${next}`)?.focus();
                }}
              >{tab.label}</button>)}
            </div>
            <div id="arc-board-scores" role="tabpanel" aria-labelledby={`arc-tab-${boardTab}`} tabIndex={0}>
              {board.length > 0 ? <ol>{board.map((b, i) => <li className={i<3 ? `ns-place-${i+1}` : undefined} key={`${b.name}-${b.at}-${i}`}><span className={`ns-rank ${i<3 ? "ns-medal" : ""}`} aria-label={`Place ${i+1}`}>{i<3 && <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.2" aria-hidden="true"><path d="m8 14-2 8 6-3 6 3-2-8"/><circle cx="12" cy="9" r="7"/></svg>}<span aria-hidden="true">{i<3 ? i+1 : String(i+1).padStart(2,"0")}</span></span><span>{b.name}</span><b>{b.score.toLocaleString()}</b></li>)}</ol> : <p className="arc-board-empty">{`No verified ${boardKind === "duel" ? "duels" : "solo runs"} yet${boardTab === "board" ? " tonight" : ""}. Be the first on the board.`}</p>}
            </div>
          </div>
          <p className="arc-legal">18+ for staked play. Money games may be gambling, including in Romania. Staked duels open only where allowed.</p>
        </section>
      </main>}

      {play && <main className="arc-game">
        <PinballGame
          key={play.kind === "practice" ? `p${play.run}` : `${play.match.id}-${play.match.seed ?? "vs"}`}
          seed={play.kind === "practice" ? play.seed : 0}
          // a dealt game (a duel, a board run) plays its server's luck; a duel waits on an empty one until it is dealt
          luck={play.kind === "practice" ? (play.id ? saltsFor(play.deal) : undefined) : saltsFor(play.match.seed) ?? NO_LUCK}
          startAt={play.kind === "duel" ? play.match.startedAt ?? undefined : play.startAt}
          clockOffset={play.kind === "duel" ? clock.current : play.offset ?? 0}
          name={me} avatar={avatar} rival={rival}
          onLive={onLive}
          onDone={(r) => void finished(r)}
          overlay={search ?? result}
        />
      </main>}

      {/* the app's tabs in the lobby; while a game runs the touch controls take the bottom of the screen */}
      {!play && <AppTabs active="games" />}
    </div>
  );
}
