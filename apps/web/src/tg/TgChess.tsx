import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Chess, type Color, type PieceSymbol, type Square } from "chess.js";
import { Icon } from "../Icon";
import { api as chessApi, clockText, CONTROLS, type MatchView, type PlayerView } from "../chess/types";
import { Board2D } from "./Board2D";
import { confirmAsk, gameMode, haptic } from "./telegram";

/**
 * One NIGHT CHESS game in the Mini App: a seat (play) or none (watch). The same server streams as
 * the website's board: a full frame first, then compact ones; moves and clocks are the server's.
 * Haptics on every move, on check, at the start and on the result.
 */
const PIECES: Record<PieceSymbol, string> = { p: "pawn", n: "knight", b: "bishop", r: "rook", q: "queen", k: "king" };
const VALUES: Record<PieceSymbol, number> = { p: 1, n: 3, b: 3, r: 5, q: 9, k: 0 };
const REASONS: Record<string, string> = { checkmate: "Checkmate.", timeout: "On time.", resignation: "By resignation.", stalemate: "Stalemate.", repetition: "Threefold repetition.", agreement: "Draw agreed.", abandonment: "A player left the table.", "insufficient material": "Not enough material to mate.", "50-move rule": "Fifty-move rule." };
type Frame = MatchView & { viewers?: number; spectating?: boolean };

export function TgChess({ id, player, onMoved, onExit, onShare, onRunning, onDone }: {
  id: string; player: string | null;
  /** The game continues at another id (a lounge fold, a rematch): the same seat follows. */
  onMoved: (id: string) => void;
  onExit: () => void;
  /** Share this open table: a t.me link a friend opens to sit down here. */
  onShare?: (id: string) => void;
  /** Your game is on (started, not over): the back button asks first. */
  onRunning?: (on: boolean) => void;
  /** The game just ended (seen live, not on a reload of a finished one). */
  onDone?: () => void;
}) {
  const watch = player === null;
  const [m, setM] = useState<Frame | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [closed, setClosed] = useState<string | null>(null);
  const [connected, setConnected] = useState(false);
  const [selected, setSelected] = useState<Square | null>(null);
  const [promotion, setPromotion] = useState<{ from: Square; to: Square } | null>(null);
  const [busy, setBusy] = useState(false);
  const [flip, setFlip] = useState(false);
  const [now, setNow] = useState(Date.now());
  // the parent's callbacks change on every render: kept in refs, so the stream is opened once per game
  const doneRef = useRef(onDone); doneRef.current = onDone;
  const movedRef = useRef(onMoved); movedRef.current = onMoved;
  const cur = useRef<Frame | null>(null), offset = useRef(0), es = useRef<EventSource | null>(null), pending = useRef(false), mounted = useRef(true);

  /** A newer state of the game (a stream frame or a move's answer): haptics for what changed since the last one. */
  const apply = useCallback((f: Frame) => {
    const old = cur.current;
    if (old && old.id === f.id && f.version < old.version) return;
    offset.current = f.now - Date.now();
    if (old && f.ply > old.ply && f.lastMove) {
      haptic.move(!!f.lastMove.captured);
      if (f.check) haptic.check();
      setSelected(null); setPromotion(null);
    }
    if (old && !old.startedAt && f.startedAt) haptic.start();
    if (old && !old.done && f.done && f.startedAt) { if (f.winner === null) haptic.select(); else if (watch || f.winnerIsYou) haptic.win(); else haptic.lose(); doneRef.current?.(); }
    cur.current = f; setM(f);
  }, [watch]);
  const connect = useCallback(() => {
    es.current?.close();
    const s = new EventSource(watch ? `/api/chess/match/${id}/watch` : `/api/chess/match/${id}/events?player=${encodeURIComponent(player!)}`);
    es.current = s;
    s.onopen = () => setConnected(true);
    s.onmessage = (e) => {
      if (es.current !== s) return;
      let f: Frame;
      try { f = JSON.parse(e.data) as Frame; } catch { return; }
      const old = cur.current;
      if (!f.moves) {
        // a compact frame: it adds one move to the list we have, or we read the whole game again
        if (!old || old.id !== f.id || f.ply > old.ply + 1 || f.ply < old.ply) { connect(); return; }
        f = { ...f, moves: f.ply === old.ply ? old.moves : [...old.moves, f.lastMove!] };
      }
      if (!watch && f.movedTo) { s.close(); movedRef.current(f.movedTo); return; }
      if (f.done && !f.startedAt && !watch) { setClosed(f.expired === "timeout" ? "Nobody joined in 30 minutes, so the table closed." : f.players.length === 2 ? "Your rival never sat down. The game closed without a result." : "The table closed."); s.close(); }
      if (watch && f.done) s.close();
      apply(f);
    };
    s.onerror = () => {
      if (es.current !== s) return;
      setConnected(false);
      if (s.readyState === EventSource.CLOSED) {
        // a table that is gone answers 400/404: say so instead of reconnecting forever
        if (watch) { if (!cur.current?.done) setErr(cur.current ? "This game has closed." : "This game is not live any more."); return; }
        void fetch(`/api/chess/match/${id}?player=${encodeURIComponent(player!)}`).then(async (r) => {
          if (!mounted.current) return;
          if (r.ok) { const f = (await r.json()) as Frame; cur.current = f; setM(f); setTimeout(() => mounted.current && connect(), 1500); }
          else setErr("That table has closed.");
        }).catch(() => setTimeout(() => mounted.current && connect(), 3000));
      }
    };
  }, [id, player, watch, apply]);

  useEffect(() => {
    mounted.current = true; cur.current = null; setM(null); setErr(null); setClosed(null);
    connect();
    const t = setInterval(() => { if (!document.hidden) setNow(Date.now()); }, 200);
    return () => { mounted.current = false; clearInterval(t); es.current?.close(); es.current = null; };
  }, [connect]);
  const running = !!m && !m.done && !!m.startedAt && now + offset.current >= m.startedAt;
  const playing = !watch && !!m && !m.done && !!m.startedAt;
  useEffect(() => { gameMode(playing); onRunning?.(playing); return () => gameMode(false); }, [playing]);
  useEffect(() => { if (m?.rematchId && !watch) movedRef.current(m.rematchId); }, [m?.rematchId]);

  const game = useMemo(() => new Chess(m?.fen), [m?.fen]);
  const you: Color | null = watch ? null : m?.you ?? null;
  const orientation: Color = watch ? (flip ? "b" : "w") : you ?? "w";
  const myTurn = !!m && running && !!you && m.turn === you && !busy;
  const targets = useMemo(() => (selected ? game.moves({ square: selected, verbose: true }).map((x) => ({ square: x.to as Square, capture: !!x.captured })) : []), [game, selected]);

  const move = async (from: Square, to: Square, promo?: string) => {
    if (!m || pending.current) return;
    pending.current = true; setBusy(true); setErr(null);
    try { apply(await chessApi<MatchView>(`match/${m.id}/move`, { player, from, to, promotion: promo })); }
    catch (e) { setErr((e as Error).message); haptic.error(); }
    finally { pending.current = false; setBusy(false); setSelected(null); setPromotion(null); }
  };
  const pick = (sq: Square) => {
    if (!myTurn) return;
    if (selected) {
      const legal = game.moves({ square: selected, verbose: true }).filter((x) => x.to === sq);
      if (legal.length) { if (legal.some((x) => x.promotion)) setPromotion({ from: selected, to: sq }); else void move(selected, sq); return; }
    }
    const p = game.get(sq);
    if (p?.color === you && sq !== selected) { setSelected(sq); haptic.select(); } else setSelected(null);
  };
  const act = async (kind: "resign" | "draw" | "rematch" | "leave", choice?: string) => {
    if (!m || pending.current) return;
    if (kind === "resign" && !(await confirmAsk("Resign this game? It goes to your rival."))) return;
    pending.current = true; setBusy(true); setErr(null);
    try {
      if (kind === "leave") { await chessApi(`match/${m.id}/leave`, { player }); onExit(); return; }
      apply(await chessApi<MatchView>(`match/${m.id}/${kind}`, { player, action: choice }));
    } catch (e) { setErr((e as Error).message); } finally { pending.current = false; setBusy(false); }
  };

  if (closed) return <div className="tgx-center"><div className="tgx-card tgx-note"><Icon name="clock" size={26} /><h2>Table closed</h2><p>{closed}</p><button type="button" className="tgx-btn" onClick={onExit}>Back to the lounge</button></div></div>;
  if (!m) return <div className="tgx-center"><div className="tgx-card tgx-note"><span className="tgx-radar"><Icon name="radar" size={30} /></span><h2>{err ? "No game here" : watch ? "Finding the table" : "Taking your seat"}</h2><p>{err ?? "Connecting to the live game…"}</p>{err && <button type="button" className="tgx-btn" onClick={onExit}>Back</button>}</div></div>;

  const clocks = { ...m.clocks };
  if (running) clocks[m.turn] = Math.max(0, clocks[m.turn] - Math.max(0, now + offset.current - Math.max(m.now, m.startedAt!)));
  const countdown = m.startedAt && !m.done ? Math.max(0, Math.ceil((m.startedAt - now - offset.current) / 1000)) : 0;
  const captures: Record<Color, PieceSymbol[]> = { w: [], b: [] };
  for (const x of m.moves ?? []) if (x.captured) captures[x.color].push(x.captured);
  const material: Record<Color, number> = { w: 0, b: 0 };
  for (const row of game.board()) for (const p of row) if (p) material[p.color] += VALUES[p.type];
  const top = m.players.find((p) => p.color !== orientation), bottom = m.players.find((p) => p.color === orientation);
  const seat = (p: PlayerView | undefined) => p && <div className={`tgc-seat ${running && m.turn === p.color ? "on" : ""} ${clocks[p.color] < 20_000 && running ? "low" : ""}`}>
    <span className={`tgc-token ${p.color}`} aria-hidden="true"><Icon name="chess-king" size={18} /></span>
    <div className="tgc-who"><b>{p.name}{p.you && <em>YOU</em>}</b><small>{p.rating} Elo{!p.connected && !m.done ? " · away" : ""}{captures[p.color].length ? " · " : ""}{captures[p.color].map((c, i) => <Icon key={i} name={`chess-${PIECES[c]}`} size={12} />)}{material[p.color] > material[p.color === "w" ? "b" : "w"] && <strong> +{material[p.color] - material[p.color === "w" ? "b" : "w"]}</strong>}</small></div>
    <span className="tgc-clock" aria-label={`${p.name}: ${clockText(clocks[p.color])}`}>{clockText(clocks[p.color])}</span>
  </div>;
  const rival = m.players.find((p) => !p.you);
  const status = m.done ? "Game over" : !m.startedAt ? (m.players.length === 2 ? `Waiting for ${rival?.name ?? "your rival"} to sit down` : "Waiting for a rival") : countdown ? `Starting in ${countdown}` : watch ? `${m.players.find((p) => p.color === m.turn)?.name ?? ""} to move${m.check ? " · check" : ""}` : m.turn === you ? (m.check ? "Check! Your move" : selected ? "Tap a marked square" : "Your move") : (rival && !rival.connected ? "Your rival is away: 45 s on their turn and you win" : "Your rival is thinking…");
  const won = watch ? !!m.winner : m.winnerIsYou;
  const winnerName = m.winner ? m.players.find((p) => p.color === m.winner)?.name : null;
  const last = (m.moves ?? []).slice(-6);

  return <div className="tgc">
    <div className="tgc-head">
      <span className="tgx-kicker">{watch ? <><i className="tgx-live" /> WATCHING{typeof m.viewers === "number" ? ` · ${m.viewers}` : ""}</> : m.startedAt ? <><i className="tgx-live" /> LIVE DUEL</> : "NIGHT CHESS"} · {m.tc} {CONTROLS[m.tc]?.label.toUpperCase()}</span>
      {watch && <button type="button" className="tgx-icon" aria-label="Flip the board" onClick={() => setFlip(!flip)}><Icon name="swap" size={18} /></button>}
    </div>
    {seat(top)}
    <div className="tgc-board">
      <Board2D fen={m.fen} orientation={orientation} selectable={myTurn ? you : null} selected={selected} targets={targets} lastMove={m.lastMove} check={m.check} onSquare={watch ? undefined : pick} />
      {countdown > 0 && <div className="tgc-over"><span className="tgx-kicker">YOUR RIVAL IS HERE</span><strong className="tgc-count" key={countdown}>{countdown}</strong></div>}
      {promotion && <div className="tgc-over" role="dialog" aria-label="Choose a piece"><span className="tgx-kicker">PROMOTE TO</span><div className="tgc-promo">{(["q", "r", "b", "n"] as PieceSymbol[]).map((p) => <button type="button" key={p} disabled={busy} onClick={() => void move(promotion.from, promotion.to, p)} aria-label={PIECES[p]}><Icon name={`chess-${PIECES[p]}`} size={30} /></button>)}</div><button type="button" className="tgx-btn ghost" onClick={() => setPromotion(null)}>Cancel</button></div>}
      {!m.startedAt && !m.done && !watch && <div className="tgc-over" role="status"><span className="tgx-radar"><Icon name="radar" size={30} /></span><b>{m.players.length === 2 ? <>Waiting for <em>{rival?.name}</em></> : <>Finding your <em>rival</em></>}</b><p>{m.players.length === 2 ? "The clock starts once you are both at the table." : "Your table is open in the lounge. Keep this screen open: whoever joins starts at once."}</p>
        <div className="tgc-row">{m.players.length === 1 && onShare && <button type="button" className="tgx-btn" onClick={() => onShare(m.id)}><Icon name="external" size={16} />Invite a friend</button>}<button type="button" className="tgx-btn ghost" disabled={busy} onClick={() => void act("leave")}>Cancel</button></div></div>}
    </div>
    {seat(bottom)}
    {m.done && m.startedAt ? <div className={`tgc-result ${won ? "won" : m.winner ? "lost" : ""}`} role="region" aria-label="Result">
      <span className="tgx-kicker">FINAL · VERIFIED BY THE SERVER</span>
      <h2>{!m.winner ? "Draw" : watch ? `${winnerName} wins` : m.winnerIsYou ? "Victory" : "Defeat"}</h2>
      <p>{REASONS[m.reason ?? ""] ?? m.reason}{m.ply < 4 ? " Too short to count toward Elo." : ""}</p>
      <div className="tgc-row">{!watch && !m.escrow && <button type="button" className="tgx-btn" disabled={busy || m.rematchRequested} onClick={() => void act("rematch")}><Icon name="swap" size={16} />{m.rematchRequested ? "Waiting…" : m.rivalWantsRematch ? "Accept rematch" : "Rematch"}</button>}<button type="button" className="tgx-btn ghost" onClick={onExit}><Icon name={watch ? "radar" : "home"} size={16} />{watch ? "Live games" : "Lounge"}</button></div>
    </div> : <p className={`tgc-status ${m.check ? "check" : ""}`} role="status">{connected ? status : "Reconnecting… the clocks run on the server."}</p>}
    {!!last.length && <ol className="tgc-moves" aria-label="Last moves">{last.map((x, i) => <li key={i} className={x.color}>{x.san}</li>)}</ol>}
    {err && <p className="tgx-err" role="alert"><Icon name="alert" size={15} />{err}</p>}
    {!watch && m.startedAt && !m.done && <div className="tgc-actions">
      {m.drawOffer === "rival" ? <><button type="button" className="tgx-btn" disabled={busy} onClick={() => void act("draw", "accept")}>Accept draw</button><button type="button" className="tgx-btn ghost" disabled={busy} onClick={() => void act("draw", "decline")}>Decline</button></>
        : <button type="button" className="tgx-btn ghost" disabled={busy || countdown > 0 || m.drawOffer === "you"} onClick={() => void act("draw", "offer")}><Icon name="scales" size={16} />{m.drawOffer === "you" ? "Draw offered" : "Offer draw"}</button>}
      <button type="button" className="tgx-btn ghost danger" disabled={busy} onClick={() => void act("resign")}><Icon name="flag" size={16} />Resign</button>
    </div>}
  </div>;
}
