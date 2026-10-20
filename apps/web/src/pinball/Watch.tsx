import { useEffect, useRef, useState } from "react";
import { Icon } from "../Icon";
import { BetPanel } from "../bets";
import { Link } from "../router";
import { stakeText } from "../games/live";
import { H, Table, W } from "./engine";
import { flat, onHidden } from "../lite";
import "../games/live.css";

/**
 * Spectator mode for a Space Pinball duel: both tables side by side, read-only, as each player sees
 * the other's (live score, ball, attacks sent), and the verified scores once the duel is settled.
 */
type Shot = { n: number; kind: string; tick: number; at: number };
type Seat = { key: string; name: string; avatar?: string | null; live: number; x: number; y: number; attacks: Shot[]; score: number | null; stats: Record<string, number> | null; finished: boolean };
type Frame = { id: string; currency: "FREE" | "IMD" | "SHIFT"; stake: number; startedAt: number | null; now: number; done: boolean; draw: boolean; void: string | null; winner: string | null; players: Seat[]; viewers?: number };

const ART = "/games/pinball";
const img = (src: string): HTMLImageElement => { const i = new Image(); i.src = src; return i; };
/** The layout is the same on every table; only the luck differs, and the seed stays hidden until the end. */
const LAYOUT = new Table(0), REST = [LAYOUT.flipper(0), LAYOUT.flipper(1)];

/** One player's table: the art, the ball gliding to each new position the server sends. */
function MiniTable({ seat, rival }: { seat: Seat; rival: boolean }) {
  const ref = useRef<HTMLCanvasElement>(null), target = useRef({ x: seat.x, y: seat.y });
  target.current = { x: seat.x, y: seat.y };
  useEffect(() => {
    const c = ref.current!, g = flat(c.getContext("2d")!);
    const A = { field: img(`${ART}/playfield.webp`), hole: img(`${ART}/blackhole.webp`), planets: [0, 1, 2, 3].map((i) => img(`${ART}/planet-${i}.webp`)) };
    const ball = { ...target.current };
    let raf = 0, prev = performance.now();
    const frame = (now: number) => {
      const dt = Math.min(0.1, (now - prev) / 1000); prev = now;
      // frames come four times a second: ease toward the latest position instead of jumping
      const k = 1 - Math.exp(-dt * 12);
      ball.x += (target.current.x - ball.x) * k; ball.y += (target.current.y - ball.y) * k;
      const s = c.width / W;
      g.setTransform(s, 0, 0, s, 0, 0);
      g.fillStyle = "#03020A"; g.fillRect(0, 0, W, H);
      if (A.field.complete) { g.globalAlpha = 0.75; g.drawImage(A.field, 0, 0, W, H); g.globalAlpha = 1; }
      const hs = LAYOUT.hole.pull * 1.25;
      if (A.hole.complete) g.drawImage(A.hole, LAYOUT.hole.x - hs, LAYOUT.hole.y - hs, hs * 2, hs * 2);
      for (const b of LAYOUT.bumpers) { const pi = A.planets[b.kind]!, rr = b.r * 1.34; if (pi.complete) g.drawImage(pi, b.x - rr, b.y - rr, rr * 2, rr * 2); }
      g.strokeStyle = "#e9e2ff"; g.lineWidth = 14; g.lineCap = "round";
      for (const f of REST) { g.beginPath(); g.moveTo(f.a.x, f.a.y); g.lineTo(f.b.x, f.b.y); g.stroke(); }
      g.fillStyle = "#e9e2ff"; g.shadowColor = rival ? "#FF4FD8" : "#7c5cff"; g.shadowBlur = 30; g.beginPath(); g.arc(ball.x, ball.y, 20, 0, 7); g.fill(); g.shadowBlur = 0;
      raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);
    // a hidden tab (or a wallet app in the background) draws nothing
    const off = onHidden((hidden) => { cancelAnimationFrame(raf); if (!hidden) { prev = performance.now(); raf = requestAnimationFrame(frame); } });
    return () => { cancelAnimationFrame(raf); off(); };
  }, [rival]);
  return <canvas ref={ref} width={360} height={540} className="arc-mini pw-table" aria-label={`Live view of ${seat.name}'s table`} />;
}

/** `plain`: no stake badge (the Telegram Mini App, which shows free games only). */
export function PinballWatch({ id, plain = false }: { id: string; plain?: boolean }) {
  const [m, setM] = useState<Frame | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [now, setNow] = useState(Date.now());
  const offset = useRef(0);
  useEffect(() => {
    document.title = "Watching live · Space Pinball · NIGHTSHIFT";
    const es = new EventSource(`/api/pinball/match/${id}/watch`);
    let last: Frame | null = null;
    es.onmessage = (e) => {
      try {
        const f = JSON.parse(e.data) as Frame;
        offset.current = f.now - Date.now(); last = f; setM(f); setErr(null);
        // a settled duel has nothing more to show: free the place in the stands
        if (f.done || f.void) es.close();
      } catch { /* a frame that cannot be read: the next one will do */ }
    };
    es.onerror = () => { if (es.readyState === EventSource.CLOSED && !last?.done) setErr(last ? "This duel has closed." : "This duel is not live any more, or the stands are full. Pick another one."); };
    const t = setInterval(() => setNow(Date.now()), 250);
    return () => { es.close(); clearInterval(t); };
  }, [id]);

  const serverNow = now + offset.current;
  const countdown = m?.startedAt ? Math.max(0, Math.ceil((m.startedAt - serverNow) / 1000)) : 0;
  const [a, b] = m?.players ?? [];
  const shown = (p: Seat) => p.score ?? p.live;
  const lead = a && b ? shown(a) - shown(b) : 0;
  const status = !m ? "CONNECTING" : m.void ? "CALLED OFF" : m.done ? "FINAL · VERIFIED BY REPLAY" : countdown ? `STARTS IN ${countdown}` : "LIVE";

  if (err && !m) return <main className="pw"><div className="arc-result pw-gone"><div className="arc-radar"><Icon name="radar" size={32} /></div><span className="arc-kicker">SPECTATOR MODE</span><h2>No duel<br />to watch</h2><p>{err}</p><div className="arc-actions"><Link to="/games/live" className="arc-btn"><Icon name="radar" size={17} />WATCH ANOTHER</Link><Link to="/games/pinball" className="arc-btn ghost">PLAY</Link></div></div></main>;

  return <main className="pw">
    <div className="pw-head">
      <span className="arc-kicker"><span className="arc-live-dot" /> SPECTATING · {m?.viewers ?? 0} WATCHING</span>
      <span className="pw-badges">{m && !plain && <span className={`lv-stake ${m.currency === "FREE" ? "" : "on"}`}>{stakeText({ currency: m.currency, amount: m.stake })}</span>}<span className={`pw-status ${m && !m.done && !countdown ? "live" : ""}`} role="status">{status}</span></span>
    </div>
    {m && a && b ? <>
      <div className="pw-tables">
        {[a, b].map((p, i) => <section key={p.key} className={`pw-seat ${m.done && m.winner === p.name && !m.draw ? "won" : ""}`} aria-label={`${p.name}'s table`}>
          <div className="pw-who">
            <div className={`arc-face ${i ? "rival" : ""}`}><img src={p.avatar ?? `${ART}/frog-${i ? 3 : 0}.webp`} alt="" /></div>
            <div className="arc-identity"><span className="arc-kicker">{i ? "PLAYER 2" : "PLAYER 1"}</span><span className="arc-label">{p.name}</span></div>
            <b className={`arc-score ${i ? "rival" : ""}`} aria-label={`${p.name}'s score: ${shown(p).toLocaleString()}`}>{shown(p).toLocaleString()}</b>
          </div>
          <MiniTable seat={p} rival={i === 1} />
          <div className="pw-foot"><span><Icon name="meteor" size={13} />{p.attacks.length} sent</span><span>{p.finished || (m.done && p.score !== null) ? "FINISHED" : m.done ? "" : countdown ? "READY" : "PLAYING"}</span></div>
        </section>)}
        <i className="pw-vs" aria-hidden="true">VS</i>
      </div>
      <div className="pw-bar" aria-hidden="true"><span style={{ width: `${Math.round((shown(a) / Math.max(1, shown(a) + shown(b))) * 100)}%` }} /></div>
      {!m.done && !m.void && <p className="pw-note">{lead === 0 ? "Level on points." : `${(lead > 0 ? a : b).name} leads by ${Math.abs(lead).toLocaleString()}.`} Live scores; the result is the server's replay of both tables.</p>}
      <BetPanel game="pinball" id={id} theme="arc" />
      {(m.done || m.void) && <div className="arc-result pw-result" role="region" aria-label="Duel result">
        <span className="arc-result-icon"><Icon name={m.void ? "alert" : m.draw ? "scales" : "trophy"} size={28} /></span>
        <span className="arc-kicker">{m.void ? "No duel" : "Final result · verified by replay"}</span>
        <h2 className="arc-result-title">{m.void ? "CALLED OFF" : m.draw ? "DRAW" : `${m.winner} WINS`}</h2>
        {m.void ? <p>{m.void}</p> : <p>{a.name} {shown(a).toLocaleString()} · {b.name} {shown(b).toLocaleString()}</p>}
        <div className="arc-actions"><Link to="/games/live" className="arc-btn"><Icon name="radar" size={17} />WATCH ANOTHER</Link><Link to="/games/pinball" className="arc-btn ghost">PLAY SPACE PINBALL</Link></div>
      </div>}
    </> : <p className="lv-empty" role="status">{err ?? "Connecting to the duel…"}</p>}
    <p className="pw-help"><Icon name="radar" size={15} />Read-only. Spectators cannot touch a flipper; the tables follow the players live.</p>
  </main>;
}
