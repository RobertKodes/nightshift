import { useEffect, useRef, useState } from "react";
import { Link } from "./router";
import { Icon } from "./Icon";
import { type Landed, type Live, PinballGame, type Rival, type Shot } from "./pinball/PinballGame";
import type { Input } from "./pinball/engine";
import { useSession } from "./session";
import { InstallButton, useGameApp } from "./pinball/install";
import { AppTabs } from "./landing/app";
import "./pinball/arcade.css";

type Currency = "FREE" | "IMD" | "SHIFT";
type Mode = "PRACTICE" | Currency;
/** A player as the server shows them; the rival's verified score, stats and finish only once the match is settled. Faces come in the first frame. */
type PlayerView = { key: string; name: string; avatar?: string | null; live: number; x: number; y: number; attacks: Shot[]; score: number | null; solo: number | null; stats: Record<string, number> | null; you: boolean; finished: boolean; error?: string };
type MatchView = { id: string; seed: number | null; currency: Currency; stake: number; startedAt: number | null; now?: number; done: boolean; draw: boolean; void: string | null; winner: string | null; winnerIsYou: boolean; players: PlayerView[] };
/** What is on the table (it stays mounted under the result) and what is shown over it. A board run runs on the server's clock. */
type Play = { kind: "practice"; seed: number; run: number; id?: string; startAt?: number; offset?: number } | { kind: "duel"; match: MatchView; player: string };
type Over = { score: number; stats?: Record<string, number>; rank?: number | null };
type BoardEntry = { name: string; score: number; at: number };
type Leaderboard = { board: BoardEntry[]; best: BoardEntry[]; solo?: BoardEntry[]; soloBest?: BoardEntry[] };

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
/** A stream post: taken, to be sent again (network, rate limit), or refused for good (the server says why). */
async function stream(path: string, body: unknown, refused: (why: string) => void): Promise<boolean | "stop"> {
  try { await api(path, body); return true; } catch (e) {
    if ((e as { status?: number }).status === 400) { refused((e as Error).message); return "stop"; }
    return false;
  }
}

function Confetti() {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    if (matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const c = ref.current!, g = c.getContext("2d")!; let raf = 0, prev = performance.now();
    const bits = Array.from({ length: 80 }, () => ({ x: Math.random() * c.width, y: -Math.random() * c.height, vy: 90 + Math.random() * 170, vx: (Math.random() - 0.5) * 70, r: Math.random() * 6, c: ["#F2EFFF", "#A48BFF", "#7C5CFF"][Math.floor(Math.random() * 3)]! }));
    const f = (now: number) => {
      const dt = (now - prev) / 1000; prev = now; g.clearRect(0, 0, c.width, c.height);
      for (const b of bits) { b.y += b.vy * dt; b.x += b.vx * dt; b.r += dt * 4; if (b.y > c.height) { b.y = -10; b.x = Math.random() * c.width; } g.save(); g.translate(b.x, b.y); g.rotate(b.r); g.fillStyle = b.c; g.fillRect(-5, -2, 10, 4); g.restore(); }
      raf = requestAnimationFrame(f);
    };
    raf = requestAnimationFrame(f);
    return () => cancelAnimationFrame(raf);
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
  const [mode, setMode] = useState<Mode>("FREE");
  const [stakes, setStakes] = useState<{ live: boolean; options: Record<Currency, number[]> } | null>(null);
  const [stake, setStake] = useState(0);
  const [err, setErr] = useState<string | null>(null);
  const [leaderboard, setLeaderboard] = useState<Leaderboard>({ board: [], best: [] });
  const [boardTab, setBoardTab] = useState<"board" | "best">("board");
  const [boardKind, setBoardKind] = useState<"duel" | "solo">("duel");
  const board = (boardKind === "duel" ? leaderboard[boardTab] : boardTab === "board" ? leaderboard.solo : leaderboard.soloBest) ?? [];
  const es = useRef<EventSource | null>(null);
  // server time minus ours; the smallest delivery delay gives the best estimate, so keep the largest sample
  const clock = useRef(0);
  const sync = (m: MatchView) => { if (m.now) clock.current = Math.max(clock.current === 0 ? -Infinity : clock.current, m.now - Date.now()); };
  // faces come in a stream's first frame (and when the players change), by each player's public key
  const faces = useRef(new Map<string, string | null>());
  const withFaces = (m: MatchView): MatchView => ({ ...m, players: m.players.map((p) => { if (p.avatar !== undefined) faces.current.set(p.key, p.avatar); return { ...p, avatar: faces.current.get(p.key) ?? null }; }) });
  const me = name.trim() || "Night crew";

  useGameApp();
  useEffect(() => { document.title = "Space Pinball · NIGHTSHIFT"; }, []);
  useEffect(() => {
    void api<{ live: boolean; options: Record<Currency, number[]> }>("stakes").then(setStakes).catch(() => {});
    void api<Leaderboard>("board").then(setLeaderboard).catch(() => {});
  }, [play === null]);
  useEffect(() => () => es.current?.close(), []);

  const follow = (id: string, player: string) => {
    es.current?.close();
    const s = new EventSource(`/api/pinball/match/${id}/events?player=${player}`);
    s.onmessage = (m) => {
      const match = withFaces(JSON.parse(m.data) as MatchView);
      sync(match);
      const mine = match.players.find((p) => p.you);
      if (mine?.error) setErr(mine.error);
      // the rival never connected: back to the lobby, or (the match reopened) back to the search
      if (match.void) { s.close(); setPlay(null); setWaiting(null); setErr(match.void); return; }
      if (match.startedAt) { setWaiting(null); setPlay((p) => (p?.kind === "duel" && p.match.id === match.id ? { ...p, match } : { kind: "duel", match, player })); }
      else { setPlay((p) => (p?.kind === "duel" && p.match.id === match.id ? null : p)); setWaiting({ match, player }); }
    };
    es.current = s;
  };

  const start = async () => {
    setErr(null); setOver(null);
    try { localStorage.setItem("pb-name", name); } catch { /* private window */ }
    if (mode === "PRACTICE") {
      es.current?.close();
      // the server deals the table and runs its clock so the run can go on the solo board; offline, practice still works
      const r = await api<{ id: string; seed: number; startedAt: number; now: number }>("solo", { name: me }).catch((e) => { if ((e as { status?: number }).status === 409) setErr((e as Error).message); return null; });
      setPlay({ kind: "practice", seed: r?.seed ?? Math.floor(Math.random() * 2 ** 32), run: Date.now(), id: r?.id, startAt: r?.startedAt, offset: r ? r.now - Date.now() : 0 });
      return;
    }
    try {
      clock.current = 0;
      const r = await api<{ match: MatchView; player: string }>("queue", { name: me, currency: mode, stake, avatar: frog ? `frog:${frog.id}` : "/games/pinball/frog-0.webp" });
      r.match = withFaces(r.match);
      sync(r.match);
      if (r.match.startedAt) setPlay({ kind: "duel", match: r.match, player: r.player }); else setWaiting(r);
      follow(r.match.id, r.player);
    } catch (e) { setErr((e as Error).message); }
  };

  const finished = async (r: { score: number; inputs: Input[]; stats: Record<string, number>; landed: Landed[]; tick: number }) => {
    setOver({ score: r.score, stats: r.stats });
    if (play?.kind === "practice" && play.id) {
      const v = await api<{ score: number; rank: number | null }>(`solo/${play.id}/finish`, { inputs: r.inputs }).catch((e) => { setErr((e as Error).message); return null; });
      if (v) { setOver({ score: v.score, stats: r.stats, rank: v.rank }); void api<Leaderboard>("board").then(setLeaderboard).catch(() => {}); }
    }
    if (play?.kind === "duel") await api(`match/${play.match.id}/finish`, { player: play.player, inputs: r.inputs, landed: r.landed, tick: r.tick }).catch((e) => setErr((e as Error).message));
  };
  // the inputs go to the server while the game runs: a duel's to its match, a board run's to its run
  const onLive = play?.kind === "duel" ? (s: Live) => stream(`match/${play.match.id}/progress`, { player: play.player, ...s }, setErr)
    : play?.kind === "practice" && play.id ? (s: Live) => stream(`solo/${play.id}/progress`, s, setErr) : undefined;
  const toLobby = () => { es.current?.close(); setPlay(null); setOver(null); setWaiting(null); };

  const opp = play?.kind === "duel" ? play.match.players.find((p) => !p.you) : null;
  const rival: Rival | null = opp ? { name: opp.name, avatar: opp.avatar, live: opp.score ?? opp.live, x: opp.x, y: opp.y, attacks: opp.attacks } : null;
  const locked = (mode === "IMD" || mode === "SHIFT") && !stakes?.live;

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
          <div className="arc-actions"><button type="button" className="arc-btn" onClick={() => void start()}><Icon name={m ? "swords" : "play"} size={17} />{m ? "REMATCH" : "PLAY AGAIN"}</button><button type="button" className="arc-btn ghost" onClick={toLobby}>LOBBY</button></div>
          {err && <p className="arc-err" role="alert">{err}</p>}
        </div>
      </div>
    );
  })();

  const search = waiting && <div className="arc-overlay arc-search" role="region" aria-label="Finding a rival">
    <div className="arc-result">
      <div className="arc-radar"><Icon name="radar" size={32} /></div>
      <span className="arc-kicker" role="status">Matchmaking · searching</span>
      <h2>Finding<br />your rival</h2>
      <div className="arc-vs">
        <div><div className="arc-face"><img src={avatar ?? "/games/pinball/frog-0.webp"} alt="" /></div><span>{me}</span></div>
        <i>VS</i>
        <div><div className="arc-face arc-face-pending"><Icon name="user" size={28} /></div><span>Awaiting player</span></div>
      </div>
      <div className="arc-stats">
        <div><b>1 / 2</b><span>players</span></div><div><b>{waiting.match.currency === "FREE" ? "Free" : waiting.match.currency === "SHIFT" ? "$SHIFT" : "IMD"}</b><span>duel</span></div>
        <div><b>{waiting.match.stake.toLocaleString()}</b><span>stake</span></div><div><b>3 s</b><span>attack delay</span></div>
      </div>
      <p>Invite a friend to this page. The next player to find a rival joins your table.</p>
      <button type="button" autoFocus className="arc-btn ghost" onClick={() => { es.current?.close(); void api(`match/${waiting.match.id}/leave`, { player: waiting.player }).catch(() => {}); setWaiting(null); }}>CANCEL SEARCH</button>
    </div>
  </div>;

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
              const lk = (x.k === "IMD" || x.k === "SHIFT") && !stakes?.live;
              return <button type="button" key={x.k} aria-pressed={mode === x.k} className={`arc-mode ${mode === x.k ? "on" : ""} ${lk ? "locked" : ""}`} onClick={() => { setMode(x.k); setStake(x.k === "IMD" || x.k === "SHIFT" ? stakes?.options[x.k]?.[0] ?? 0 : 0); }}>
                <i className="arc-mode-icon"><Icon name={x.icon} size={23} /></i><b>{x.title}</b><span>{lk ? "Opens with the escrow" : x.sub}</span>
                <i className="arc-mode-mark">{lk ? <Icon name="lock" size={13} /> : mode === x.k ? <Icon name="check" size={13} /> : null}</i>
              </button>;
            })}
          </div>

          {(mode === "IMD" || mode === "SHIFT") && <div className="arc-stake">
            <span className="arc-kicker">STAKE / {mode === "SHIFT" ? "$SHIFT" : "IMD"}</span>
            <div className="arc-chips" aria-label="Stake amount">{(stakes?.options[mode] ?? []).map((v) => <button type="button" key={v} aria-pressed={stake === v} className={stake === v ? "on" : ""} onClick={() => setStake(v)}>{v >= 1e6 ? `${v / 1e6}M` : v >= 1e3 ? `${v / 1e3}K` : v}</button>)}</div>
            <p>{locked ? "Stake tiers open with the escrow. Both players stake equally; the winner receives 95% of the pot." : <>Each player stakes {stake.toLocaleString()} {mode === "SHIFT" ? "$SHIFT" : "IMD"}. Winner receives <b>{(stake * 1.9).toLocaleString()}</b>. The 5% fee supports stakers, NIGHT FROGS holders and SHIFT + IMD burns.</>}</p>
          </div>}

          <button type="button" className="arc-btn play" disabled={locked || !!waiting} onClick={() => void start()}><Icon name={locked ? "lock" : waiting ? "radar" : mode === "PRACTICE" ? "play" : "swords"} size={20} /><span>{waiting ? "FINDING YOUR RIVAL" : mode === "PRACTICE" ? "PLAY PRACTICE" : locked ? "OPENS WITH THE ESCROW" : "FIND A RIVAL"}</span>{!locked && !waiting && <Icon name="arrow" size={18} />}</button>
          {err && <p className="arc-err" role="alert">{err}</p>}

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
              {board.length > 0 ? <ol>{board.map((b, i) => <li key={`${b.name}-${b.at}-${i}`}><span className={`arc-rank rank-${i + 1}`}>{String(i + 1).padStart(2, "0")}</span><span>{b.name}</span><b>{b.score.toLocaleString()}</b></li>)}</ol> : <p className="arc-board-empty">{`No verified ${boardKind === "duel" ? "duels" : "solo runs"} yet${boardTab === "board" ? " tonight" : ""}. Be the first on the board.`}</p>}
            </div>
          </div>
          <p className="arc-legal">18+ for staked play. Money games may be gambling, including in Romania. Staked duels open only where allowed.</p>
        </section>
      </main>}

      {play && <main className="arc-game">
        <PinballGame
          key={play.kind === "practice" ? `p${play.run}` : `${play.match.id}-${play.match.seed ?? "vs"}`}
          seed={play.kind === "practice" ? play.seed : play.match.seed ?? 0}
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
