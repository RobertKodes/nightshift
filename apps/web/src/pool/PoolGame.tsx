import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Icon } from "../Icon";
import { LITE, PHONE, pixelRatio } from "../lite";
import { type LastShot, type MatchView, POCKET_LABEL, type PlayerView, type ShotInput } from "./api";
import { Avatar, Emote, Title, WinEffect } from "./cosmetics";
import { EV, HEAD_Y, MAX_TIP, POCKETED, R, W, L, aimAt, fits } from "./physics";
import type { Call } from "./rules";
import { PoolSound } from "./sound";
import { PoolScene, mouth } from "./table3d";

/**
 * The table and everything on it: the 3D scene, the players' cards with their frames, titles and
 * the shot clock, the aim (mouse, or drag round the cue ball on a phone, with a fine-tune strip),
 * the power bar (pull back, release), the spin selector and the cue's elevation, the call (taken
 * from the aim, changed with a tap) or a safety, the cue ball in hand, the replay of every shot
 * from the server's keyframes with sound (and Telegram's haptics), emotes, and the end screen.
 */
export type Haptic = (kind: "light" | "medium" | "heavy" | "success" | "error" | "select") => void;
type Props = {
  view: MatchView; spectate?: boolean; practice?: boolean;
  onShoot: (s: ShotInput) => Promise<void>;
  onAim?: (s: Partial<ShotInput>) => void;
  onDecide?: (choice: string) => Promise<void>;
  onEmote?: (id: string) => Promise<void>;
  onResign?: () => void; onRematch?: () => void; onLobby?: () => void; onLocker?: () => void;
  soundOn: boolean; haptic?: Haptic; skew: number;
  /** After the game: what the profile gained (XP, level, unlocks), when known. */
  reward?: { xp: number; level: number; unlocked: string[] } | null;
};
const TIP = MAX_TIP * 1000;
const clampSpin = (x: number, y: number) => { const d = Math.hypot(x, y); return d <= TIP ? { x, y } : { x: (x / d) * TIP, y: (y / d) * TIP }; };
const mdeg = (dx: number, dy: number) => { let a = Math.round(Math.atan2(dy, dx) * 180000 / Math.PI); if (a < 0) a += 360000; return a % 360000; };
const wrap = (a: number) => ((Math.round(a) % 360000) + 360000) % 360000;
const GROUP = { solids: "SOLIDS", stripes: "STRIPES" } as const;
const BALL_COLORS = ["#f4c20d", "#1d4fd8", "#d62828", "#5b2a86", "#f2711c", "#1a7f3c", "#7a1f1f"];

function MiniBall({ id }: { id: number }) {
  const c = id === 8 ? "#0d0b14" : BALL_COLORS[(id > 8 ? id - 9 : id - 1)]!;
  return <i className={`np-mini ${id > 8 ? "stripe" : ""}`} style={{ ["--c" as string]: c }}><b>{id}</b></i>;
}
function PlayerCard({ p, active, left, clock, view, timed }: { p: PlayerView; active: boolean; left: number; clock: number; view: MatchView; timed: boolean }) {
  const g = p.group, on8 = view.onEight[p.seat] && !!g;
  const own = g ? (g === "solids" ? [1, 2, 3, 4, 5, 6, 7] : [9, 10, 11, 12, 13, 14, 15]).filter((id) => view.balls.some((b) => b.id === id && b.s !== POCKETED)) : [];
  const pct = Math.max(0, Math.min(1, clock / Math.max(1, view.clock.ms)));
  return <div className={`np-player ${active ? "active" : ""} seat-${p.seat}`}>
    <span className="np-ring" style={{ ["--p" as string]: active ? pct : 0 }}><Avatar frame={p.look.frame} avatar={p.look.avatar} size={44} level={p.look.level} /></span>
    <div className="np-player-info">
      <b>{p.name}{p.agent && <i className="np-tag">AGENT</i>}{p.you && <i className="np-tag you">YOU</i>}</b>
      <span className="np-player-meta"><Title id={p.look.title} /><small>{p.rating}</small>{!p.connected && <small className="np-off">· reconnecting</small>}</span>
      <span className="np-group">{g ? on8 ? <><MiniBall id={8} /><em>ON THE 8</em></> : <>{own.map((id) => <MiniBall key={id} id={id} />)}<em>{GROUP[g]} · {left}</em></> : <em>{view.phase === "break" ? "BREAK" : "OPEN TABLE"}</em>}{view.fouls[p.seat] >= 2 && <em className="np-warn">2 FOULS</em>}</span>
    </div>
    {active && timed && <span className={`np-clock ${clock < 10_000 ? "low" : ""}`}>{Math.ceil(clock / 1000)}</span>}
  </div>;
}

export function PoolGame(props: Props) {
  const { view, spectate = false, soundOn } = props;
  const host = useRef<HTMLDivElement>(null), scene = useRef<PoolScene | null>(null), sound = useRef<PoolSound | null>(null);
  const [aim, setAim] = useState(90000), [power, setPower] = useState(0), [spin, setSpin] = useState({ x: 0, y: 0 }), [elev, setElev] = useState(0);
  const [cue, setCue] = useState<{ x: number; y: number } | null>(null), [cueOk, setCueOk] = useState(true);
  const [override, setOverride] = useState<{ ball?: number; pocket?: number } | null>(null), [safety, setSafety] = useState(false), [picking, setPicking] = useState(false);
  const [panel, setPanel] = useState<"spin" | "emote" | null>(null), [view3d, setView3d] = useState(false);
  const [busy, setBusy] = useState(false), [err, setErr] = useState<string | null>(null), [toast, setToast] = useState<string | null>(null);
  const [replaying, setReplaying] = useState(false), [now, setNow] = useState(Date.now());
  const played = useRef(-1), aimRef = useRef(aim), drag = useRef<{ kind: "aim" | "cue" | "power" | "fine"; x0: number; y0: number; a0: number; t0: number; moved: boolean; ang0?: number } | null>(null);
  const lastAimSent = useRef(0), powerBar = useRef<HTMLDivElement>(null);
  aimRef.current = aim;
  const you = view.you, me = you !== null ? view.players[you] : undefined;
  const shooterSeat = view.decision ? view.decision.by : view.turn, shooter = view.players[shooterSeat];
  const t = now + props.skew;
  // the status by this page's clock (the server says "countdown" until its next frame)
  const status = view.done ? "finished" : !view.startedAt ? "waiting" : t < view.startedAt ? "countdown" : "playing";
  const playing = status === "playing";
  const myTurn = !spectate && you !== null && playing && view.turn === you && !view.decision && t >= view.clock.turnAt && !replaying;
  const inHand = myTurn && view.inHand !== "none";
  const cueBall = view.balls.find((b) => b.id === 0);
  const cuePos = inHand ? cue ?? (cueBall && cueBall.s !== POCKETED ? { x: cueBall.x, y: cueBall.y } : { x: W / 2, y: HEAD_Y - 0.12 }) : cueBall && cueBall.s !== POCKETED ? { x: cueBall.x, y: cueBall.y } : null;
  const host0 = view.players[0]?.look, shooterLook = shooter?.look ?? host0;
  const guideLen = (me?.look.guide ?? 1);

  // ---- the scene
  useEffect(() => {
    if (!host.current) return;
    const s = new PoolScene(host.current, { lite: LITE, pixelRatio: pixelRatio(1.75) });
    scene.current = s; sound.current = new PoolSound();
    // ?np-debug: the scene on window, for automated screenshots that aim at a ball
    if (new URLSearchParams(location.search).has("np-debug")) (window as unknown as { __npScene?: PoolScene }).__npScene = s;
    return () => { s.dispose(); scene.current = null; sound.current?.close(); };
  }, []);
  useEffect(() => { if (sound.current) sound.current.enabled = soundOn; }, [soundOn]);
  useEffect(() => { const id = setInterval(() => { if (!document.hidden) setNow(Date.now()); }, 250); return () => clearInterval(id); }, []);
  // the table's look is the host's (seat 1's cloth, frame and balls); the cue is the shooter's
  useEffect(() => { scene.current?.setLook({ cloth: host0?.cloth ?? "cloth-night", table: host0?.table ?? "table-shift", balls: host0?.balls ?? "balls-classic", cue: shooterLook?.cue ?? "cue-crew" }); }, [host0?.cloth, host0?.table, host0?.balls, shooterLook?.cue]);

  // ---- a new shot: replay it from the keyframes
  const replay = useCallback((last: LastShot) => {
    const s = scene.current;
    if (!s || !last.frames || !last.start) return;
    played.current = last.n;
    setReplaying(true); setPanel(null); setPicking(false);
    const budget = Math.max(1, last.replayMs - 700) / 1000, rate = Math.max(1, last.duration / budget);
    sound.current?.cue(last.shot.power / 1000);
    props.haptic?.(last.shot.power > 700 ? "heavy" : "medium");
    s.showCue(null, 0, 0, 0); s.showGuide(view.balls, null);
    void s.play(last.start, last.frames, { rate, onEvent: (e) => {
      if (e.kind === EV.BALL) { sound.current?.ball(e.speed); if (e.speed > 1.2) props.haptic?.("light"); }
      else if (e.kind === EV.RAIL || e.kind === EV.JAW) sound.current?.rail(e.speed);
      else if (e.kind === EV.POCKET) { sound.current?.pocket(); props.haptic?.(e.a === 0 ? "error" : "medium"); }
    } }).then(() => { setReplaying(false); setToast(last.verdict.text); });
  }, [view.balls, props.haptic]);
  useEffect(() => {
    const last = view.last;
    if (last && last.n > played.current && last.frames && t < last.at + last.replayMs + 4_000) replay(last);
    else if (last) played.current = Math.max(played.current, last.n);
  }, [view.last?.n]);
  useEffect(() => { if (!replaying) scene.current?.setBalls(view.balls); }, [view.balls, replaying]);
  useEffect(() => { if (!toast) return; const id = setTimeout(() => setToast(null), 4_200); return () => clearTimeout(id); }, [toast]);
  // a new turn: the aim starts at the nearest ball of the shooter's, the spin and the call reset
  useEffect(() => {
    setOverride(null); setSafety(false); setPicking(false); setCue(null); setPower(0); setSpin({ x: 0, y: 0 }); setElev(0);
    const c = cueBall && cueBall.s !== POCKETED ? cueBall : null, target = view.balls.filter((b) => view.targets.includes(b.id) && b.s !== POCKETED).sort((p, q) => (c ? Math.hypot(p.x - c.x, p.y - c.y) - Math.hypot(q.x - c.x, q.y - c.y) : 0))[0];
    if (view.phase === "break") setAim(90000);
    else if (c && target) setAim(mdeg(target.x - c.x, target.y - c.y));
  }, [view.turn, view.last?.n, view.racks, view.decision?.kind]);

  // ---- the call: from the aim, unless the player picked one
  const aimInfo = useMemo(() => cuePos ? aimAt(view.balls.map((b) => (b.id === 0 ? { ...b, x: cuePos.x, y: cuePos.y, s: 0 } : b)), aim) : null, [view.balls, cuePos?.x, cuePos?.y, aim]);
  const predicted = useMemo<{ ball: number; pocket: number } | null>(() => {
    if (!aimInfo || aimInfo.hit?.kind !== "ball" || !aimInfo.object || !view.targets.includes(aimInfo.hit.id)) return null;
    const ob = view.balls.find((b) => b.id === (aimInfo.hit as { id: number }).id)!;
    let best = -1, k = -1;
    for (let i = 0; i < 6; i++) { const m = mouth(i), dx = m.x - ob.x, dy = m.y - ob.y, d = Math.hypot(dx, dy), dot = (dx * aimInfo.object.x + dy * aimInfo.object.y) / d; if (dot > best) { best = dot; k = i; } }
    return best > 0.82 ? { ball: ob.id, pocket: k } : null;
  }, [aimInfo, view.targets]);
  const needsCall = view.phase !== "break" && (view.rules === "wpa" || (view.targets.length === 1 && view.targets[0] === 8) || (override?.ball === 8));
  const call: Call = view.phase === "break" ? null : safety && view.rules === "wpa" ? "safety"
    : override?.pocket !== undefined ? { ball: override.ball ?? predicted?.ball ?? view.targets[0] ?? 1, pocket: override.pocket }
    : needsCall ? predicted : null;
  const callText = view.phase === "break" ? "BREAK" : call === "safety" ? "SAFETY" : call ? `${call.ball === 8 ? "8-BALL" : `BALL ${call.ball}`} → ${POCKET_LABEL[call.pocket]!.toUpperCase()}` : needsCall ? "CALL A POCKET" : "ANY BALL OF YOURS";

  // ---- what the scene shows
  const rivalAim = !myTurn && !replaying && view.aim && view.aim.seat === view.turn && t >= view.clock.turnAt ? view.aim : null;
  useEffect(() => {
    const s = scene.current;
    if (!s || replaying) return;
    if (myTurn && cuePos) {
      s.showGuide(view.balls, { aim, cue: cuePos, length: guideLen, targets: view.targets });
      s.showCue(cuePos, aim, power / 1000, elev);
      if (inHand) s.moveCueBall(cuePos.x, cuePos.y, cueOk);
      s.showMarks({ call: call && call !== "safety" ? call : null, targets: view.targets, balls: view.balls, kitchen: view.inHand === "kitchen", pockets: picking });
    } else if (rivalAim) {
      const c = rivalAim.cue ?? cuePos;
      if (c) { s.showGuide(view.balls, { aim: rivalAim.aim, cue: c, length: 1, targets: view.targets }); s.showCue(c, rivalAim.aim, rivalAim.power / 1000, rivalAim.elevation); if (rivalAim.cue) s.moveCueBall(c.x, c.y, true); }
      s.showMarks({ call: null, targets: [], balls: view.balls, kitchen: false });
    } else { s.showGuide(view.balls, null); s.showCue(null, 0, 0, 0); s.showMarks({ call: null, targets: [], balls: view.balls, kitchen: false }); }
    if (view3d && cuePos) s.setView("aim", myTurn ? aim : rivalAim?.aim ?? aim, cuePos); else s.setView("top");
  }, [myTurn, replaying, aim, power, elev, cuePos?.x, cuePos?.y, cueOk, view.balls, view.targets, picking, JSON.stringify(call), rivalAim?.aim, rivalAim?.power, view3d, guideLen]);
  // the aim goes to the rival and the stands, a few times a second
  useEffect(() => {
    if (!myTurn || !props.onAim) return;
    const nowMs = Date.now();
    if (nowMs - lastAimSent.current < 120) { const id = setTimeout(() => { lastAimSent.current = Date.now(); props.onAim?.({ aim, power, spinX: Math.round(spin.x), spinY: Math.round(spin.y), elevation: elev, ...(inHand ? { cue: cuePos! } : {}) }); }, 130); return () => clearTimeout(id); }
    lastAimSent.current = nowMs;
    props.onAim({ aim, power, spinX: Math.round(spin.x), spinY: Math.round(spin.y), elevation: elev, ...(inHand ? { cue: cuePos! } : {}) });
  }, [aim, power, spin.x, spin.y, elev, cuePos?.x, cuePos?.y, myTurn]);
  // the last ten seconds tick
  const clockLeft = Math.max(0, view.clock.deadline - t);
  const lastTick = useRef(0);
  useEffect(() => { const s = Math.ceil(clockLeft / 1000); if (myTurn && s <= 10 && s > 0 && s !== lastTick.current) { lastTick.current = s; sound.current?.tick(); } }, [Math.ceil(clockLeft / 1000), myTurn]);

  // ---- shooting
  const shoot = useCallback(async (p: number) => {
    if (!myTurn || busy || !cuePos) return;
    if (p < 15) { setPower(0); return; }
    if (inHand && !cueOk) { setErr("Put the cue ball where it fits: on the cloth, touching no ball" + (view.inHand === "kitchen" ? ", behind the head string." : ".")); setPower(0); return; }
    if (needsCall && call === null) { setErr(view.rules === "wpa" ? "Call a pocket (tap the call) or play a safety." : "Call the pocket for the 8-ball: tap the call."); setPicking(true); setPower(0); return; }
    setBusy(true); setErr(null); sound.current?.unlock();
    try { await props.onShoot({ aim: wrap(aim), power: Math.round(p), spinX: Math.round(spin.x), spinY: Math.round(spin.y), elevation: Math.round(elev), call, ...(view.inHand !== "none" ? { cue: cuePos } : {}) }); }
    catch (e) { setErr((e as Error).message); }
    finally { setBusy(false); setPower(0); }
  }, [myTurn, busy, cuePos, inHand, cueOk, needsCall, call, aim, spin, elev, view.inHand, view.rules]);

  // ---- pointers on the table
  const onDown = (e: React.PointerEvent) => {
    const s = scene.current;
    sound.current?.unlock();
    if (!s || !myTurn) return;
    const p = s.toTable(e.clientX, e.clientY);
    if (!p || !cuePos) return;
    (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
    if (picking) {
      // a pocket or a ball for the call: the nearest pocket mouth, or a ball of the shooter's
      const ball = view.balls.find((b) => b.s !== POCKETED && view.targets.includes(b.id) && Math.hypot(b.x - p.x, b.y - p.y) < R * 1.6);
      if (ball) { setOverride((o) => ({ ...o, ball: ball.id })); props.haptic?.("select"); return; }
      let k = 0, best = Infinity;
      for (let i = 0; i < 6; i++) { const m = mouth(i), d = Math.hypot(m.x - p.x, m.y - p.y); if (d < best) { best = d; k = i; } }
      if (best < 0.14) { setOverride((o) => ({ ...o, pocket: k })); setPicking(false); setSafety(false); props.haptic?.("select"); }
      return;
    }
    const touchR = Math.max(R * 2.2, (PHONE ? 34 : 18) / Math.max(1, s.pxPerMetre()));
    if (inHand && Math.hypot(p.x - cuePos.x, p.y - cuePos.y) < touchR) { drag.current = { kind: "cue", x0: e.clientX, y0: e.clientY, a0: aimRef.current, t0: performance.now(), moved: false }; return; }
    drag.current = { kind: "aim", x0: e.clientX, y0: e.clientY, a0: aimRef.current, t0: performance.now(), moved: false, ang0: Math.atan2(p.y - cuePos.y, p.x - cuePos.x) };
  };
  const onMove = (e: React.PointerEvent) => {
    const s = scene.current, d = drag.current;
    if (!s || !myTurn || !cuePos) return;
    const p = s.toTable(e.clientX, e.clientY);
    if (!p) return;
    // a mouse aims wherever it points, pressed or not
    if (!d && e.pointerType === "mouse" && !picking) { if (Math.hypot(p.x - cuePos.x, p.y - cuePos.y) > R * 1.2) setAim(mdeg(p.x - cuePos.x, p.y - cuePos.y)); return; }
    if (!d) return;
    if (Math.hypot(e.clientX - d.x0, e.clientY - d.y0) > 4) d.moved = true;
    if (d.kind === "cue") {
      const x = Math.max(R, Math.min(W - R, p.x)), y = Math.max(R, Math.min((view.inHand === "kitchen" ? HEAD_Y - 0.0005 : L - R), p.y));
      setCue({ x, y }); setCueOk(fits(view.balls.filter((b) => b.id !== 0), 0, x, y) && (view.inHand !== "kitchen" || y < HEAD_Y));
    } else if (d.kind === "aim") {
      if (e.pointerType === "mouse") { if (Math.hypot(p.x - cuePos.x, p.y - cuePos.y) > R * 1.2) setAim(mdeg(p.x - cuePos.x, p.y - cuePos.y)); return; }
      // on a touch screen: grab the line and turn it round the cue ball
      const ang = Math.atan2(p.y - cuePos.y, p.x - cuePos.x), delta = ang - (d.ang0 ?? ang);
      setAim(wrap(d.a0 + delta * 180000 / Math.PI));
    }
  };
  const onUp = (e: React.PointerEvent) => {
    const s = scene.current, d = drag.current;
    drag.current = null;
    if (!s || !d || !myTurn || !cuePos) return;
    // a quick tap points the cue at the tapped spot
    if (d.kind === "aim" && !d.moved && performance.now() - d.t0 < 300 && e.pointerType !== "mouse") {
      const p = s.toTable(e.clientX, e.clientY);
      if (p && Math.hypot(p.x - cuePos.x, p.y - cuePos.y) > R * 1.5) setAim(mdeg(p.x - cuePos.x, p.y - cuePos.y));
    }
  };
  // the power bar: pull back (down), release to shoot
  const powerDown = (e: React.PointerEvent) => { if (!myTurn) return; sound.current?.unlock(); (e.target as HTMLElement).setPointerCapture?.(e.pointerId); drag.current = { kind: "power", x0: e.clientX, y0: e.clientY, a0: 0, t0: performance.now(), moved: false }; };
  const powerMove = (e: React.PointerEvent) => { const d = drag.current, bar = powerBar.current; if (!d || d.kind !== "power" || !bar) return; const h = bar.getBoundingClientRect().height; setPower(Math.max(0, Math.min(1000, ((e.clientY - d.y0) / (h * 0.92)) * 1000))); };
  const powerUp = () => { const d = drag.current; drag.current = null; if (d?.kind === "power") void shoot(power); };
  // the fine-tune strip: a tenth of a degree per few pixels
  const fineDown = (e: React.PointerEvent) => { if (!myTurn) return; (e.target as HTMLElement).setPointerCapture?.(e.pointerId); drag.current = { kind: "fine", x0: e.clientX, y0: e.clientY, a0: aimRef.current, t0: 0, moved: false }; };
  const fineMove = (e: React.PointerEvent) => { const d = drag.current; if (!d || d.kind !== "fine") return; setAim(wrap(d.a0 - (e.clientY - d.y0) * 20)); };
  // the keyboard: arrows fine-tune, space charges and shoots
  const charging = useRef<number | null>(null);
  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      if (!myTurn || (e.target as HTMLElement)?.tagName === "INPUT") return;
      if (e.key === "ArrowLeft" || e.key === "ArrowRight") { e.preventDefault(); setAim((a) => wrap(a + (e.key === "ArrowLeft" ? 1 : -1) * (e.shiftKey ? 500 : 50))); }
      if (e.key === " " && charging.current === null) { e.preventDefault(); const start = performance.now(); charging.current = window.setInterval(() => setPower(Math.min(1000, ((performance.now() - start) / 1400) * 1000)), 30); }
    };
    const up = (e: KeyboardEvent) => { if (e.key === " " && charging.current !== null) { clearInterval(charging.current); charging.current = null; setPower((p) => { void shoot(p); return p; }); } };
    addEventListener("keydown", down); addEventListener("keyup", up);
    return () => { removeEventListener("keydown", down); removeEventListener("keyup", up); if (charging.current !== null) { clearInterval(charging.current); charging.current = null; } };
  }, [myTurn, shoot]);
  const onWheel = (e: React.WheelEvent) => { if (!myTurn) return; setAim((a) => wrap(a + Math.sign(e.deltaY) * (e.shiftKey ? 200 : 25))); };

  // ---- the spin panel
  const spinDrag = (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.type === "pointerdown") (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId);
    else if (!(e.buttons & 1) && e.pointerType === "mouse") return;
    const r = e.currentTarget.getBoundingClientRect(), x = ((e.clientX - r.left) / r.width - 0.5) * 2, y = -((e.clientY - r.top) / r.height - 0.5) * 2;
    setSpin(clampSpin(x * 1000, y * 1000)); props.haptic?.("select");
  };
  const winnerP = view.winner !== null ? view.players[view.winner] : undefined;
  const ended = view.done && view.startedAt;
  const countdown = status === "countdown" ? Math.max(0, Math.ceil(((view.startedAt ?? 0) - t) / 1000)) : 0;
  const deciding = view.decision && !spectate && you === view.decision.by;
  const DECISIONS: Record<string, [string, string]> = { accept: ["Accept the table", "Shoot from where the balls lie."], rebreak: ["Re-rack and break", "A new rack; you break."], "rebreak-other": ["Re-rack, they break", "A new rack; the breaker breaks again."], spot: ["Spot the 8", view.decision?.kind === "eight-break-foul" ? "The 8 goes on the foot spot; you take the cue ball in the kitchen." : "The 8 goes on the foot spot; play on."] };

  return <div className={`np-table ${myTurn ? "my-turn" : ""} ${spectate ? "spectating" : ""}`}>
    <div className="np-hud">
      {view.players.map((p) => <PlayerCard key={p.seat} p={p} active={playing && shooterSeat === p.seat && !replaying} left={view.left[p.seat]} clock={clockLeft} view={view} timed={!props.practice} />)}
      {view.emotes.map((em) => <span key={`${em.seat}-${em.at}`} className={`np-bubble seat-${em.seat}`}><Emote id={em.id} /></span>)}
    </div>
    <div className="np-stage" ref={host} onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp} onPointerCancel={() => { drag.current = null; }} onWheel={onWheel}>
      {myTurn && <div className={`np-power ${power > 0 ? "on" : ""}`} ref={powerBar} onPointerDown={(e) => { e.stopPropagation(); powerDown(e); }} onPointerMove={(e) => { e.stopPropagation(); powerMove(e); }} onPointerUp={(e) => { e.stopPropagation(); powerUp(); }} role="slider" aria-label="Shot power: drag down, release to shoot" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(power / 10)}>
        <span className="np-power-track"><i style={{ height: `${power / 10}%` }} /></span><b>{power > 0 ? `${Math.round(power / 10)}%` : "PULL"}</b><Icon name="arrow" size={14} />
      </div>}
      {myTurn && PHONE && <div className="np-fine" onPointerDown={(e) => { e.stopPropagation(); fineDown(e); }} onPointerMove={(e) => { e.stopPropagation(); fineMove(e); }} onPointerUp={(e) => { e.stopPropagation(); drag.current = null; }} aria-label="Fine-tune the aim: drag up or down"><i /><i /><i /><i /><i /><i /><i /></div>}
      {countdown > 0 && <div className="np-overlay np-vs"><div className="np-vs-row">{view.players.map((p) => <div key={p.seat} className="np-vs-card"><Avatar frame={p.look.frame} avatar={p.look.avatar} size={72} level={p.look.level} /><b>{p.name}</b><Title id={p.look.title} /><small>{p.rating} ELO{view.breaker === p.seat ? " · BREAKS" : ""}</small></div>)}</div><strong className="np-count" key={countdown}>{countdown}</strong><span className="np-kicker">{view.rules === "wpa" ? "WPA RULES · CALLED SHOTS" : "QUICK RULES · CALL THE 8"}</span></div>}
      {view.decision && !replaying && <div className="np-overlay np-decide" role="dialog" aria-modal="true" aria-labelledby="np-decide-title"><div className="np-dialog">
        <span className="np-kicker">{view.decision.kind === "illegal-break" ? "ILLEGAL BREAK · WPA 4.3(d)" : view.decision.kind === "eight-break" ? "THE 8 ON THE BREAK · WPA 4.3(e)" : "THE 8 ON A FOUL BREAK · WPA 4.3(f)"}</span>
        <h2 id="np-decide-title">{deciding ? "Your choice." : `${view.players[view.decision.by]?.name ?? "Your rival"} chooses.`}</h2>
        {deciding ? <div className="np-choices">{view.decision.options.map((o) => <button key={o} type="button" className="np-btn" disabled={busy} onClick={() => { setBusy(true); void props.onDecide?.(o).catch((e) => setErr((e as Error).message)).finally(() => setBusy(false)); }}><b>{DECISIONS[o]![0]}</b><small>{DECISIONS[o]![1]}</small></button>)}</div> : <p>The table waits for their choice ({Math.ceil(clockLeft / 1000)} s).</p>}
      </div></div>}
      {ended && !replaying && <div className={`np-overlay np-end ${view.winnerIsYou ? "won" : ""}`} role="region" aria-label="Game result">
        {winnerP && <WinEffect id={winnerP.look.effect} play={!replaying} lite={LITE} />}
        <div className="np-dialog">
          <span className="np-kicker">{props.practice ? "PRACTICE" : "FINAL · SIMULATED BY THE SERVER"}</span>
          <h2>{winnerP ? spectate || you === null ? `${winnerP.name} wins` : view.winnerIsYou ? "Rack won." : "Rack lost." : "Draw."}</h2>
          <p>{view.reason === "resignation" ? `${view.players[view.winner === 0 ? 1 : 0]?.name ?? "A player"} resigned.` : view.reason === "abandonment" ? "A player was away too long on their turn." : (view.rackReason ?? "").replace(/: the rack is (won|lost)\.$/, ".")}</p>
          {winnerP && <div className="np-end-card"><Avatar frame={winnerP.look.frame} avatar={winnerP.look.avatar} size={64} level={winnerP.look.level} /><div><b>{winnerP.name}</b><Title id={winnerP.look.title} /></div></div>}
          {props.reward && <p className="np-reward"><Icon name="bolt" size={15} /><b>+{props.reward.xp} XP</b> · level {props.reward.level}{props.reward.unlocked.length ? ` · unlocked: ${props.reward.unlocked.join(", ")}` : ""}</p>}
          <div className="np-end-actions">
            {props.onRematch && <button type="button" className="np-btn" disabled={view.rematchRequested} onClick={props.onRematch}><Icon name="swap" size={16} />{view.rematchRequested ? "WAITING FOR YOUR RIVAL" : view.rivalWantsRematch ? "ACCEPT THE REMATCH" : "REMATCH"}</button>}
            {props.onLocker && <button type="button" className="np-btn ghost" onClick={props.onLocker}><Icon name="bag" size={16} />LOCKER</button>}
            {props.onLobby && <button type="button" className="np-btn ghost" onClick={props.onLobby}>BACK TO THE LOUNGE</button>}
          </div>
        </div>
      </div>}
      {toast && !ended && <div className="np-toast" role="status">{toast}</div>}
    </div>
    <div className="np-bar">
      {myTurn ? <>
        <button type="button" className={`np-chip spin ${panel === "spin" ? "on" : ""}`} onClick={() => setPanel(panel === "spin" ? null : "spin")} aria-label="Spin and elevation"><span className="np-spin-dot" style={{ ["--sx" as string]: `${spin.x / 10}%`, ["--sy" as string]: `${-spin.y / 10}%` }} /><span>SPIN{elev ? ` · ${Math.round(elev / 1000)}°` : ""}</span></button>
        <button type="button" className={`np-chip call ${picking ? "on" : ""} ${needsCall && call === null ? "warn" : ""}`} onClick={() => { setPicking(!picking); props.haptic?.("select"); }} disabled={view.phase === "break"}><Icon name="target" size={15} /><span>{picking ? "TAP A POCKET" : callText}</span></button>
        {view.rules === "wpa" && view.phase !== "break" && <button type="button" className={`np-chip safe ${safety ? "on" : ""}`} onClick={() => setSafety(!safety)} aria-pressed={safety} aria-label="Call a safety"><Icon name="shield" size={15} /><span>SAFETY</span></button>}
        {override && <button type="button" className="np-chip" onClick={() => { setOverride(null); setPicking(false); }}><Icon name="close" size={14} /><span>AUTO CALL</span></button>}
      </> : <span className="np-status">{replaying ? "Balls rolling…" : view.done ? "" : status === "waiting" ? "Waiting for a rival…" : view.decision ? "A choice after the break…" : !playing ? "" : spectate || you === null ? `${shooter?.name ?? ""} to shoot` : t < view.clock.turnAt ? "…" : `${shooter?.name ?? "Your rival"} is lining up a shot`}</span>}
      <span className="np-bar-end">
        {!spectate && me && props.onEmote && <button type="button" className={`np-chip icon ${panel === "emote" ? "on" : ""}`} onClick={() => setPanel(panel === "emote" ? null : "emote")} aria-label="Emotes"><Icon name="frog" size={17} /></button>}
        <button type="button" className={`np-chip icon np-view ${view3d ? "on" : ""}`} onClick={() => setView3d(!view3d)} aria-label={view3d ? "Top view" : "Cue view"} aria-pressed={view3d}><Icon name={view3d ? "grid" : "target"} size={16} /></button>
        {!spectate && me && !view.done && props.onResign && <button type="button" className="np-chip icon" onClick={props.onResign} aria-label="Resign"><Icon name="flag" size={16} /></button>}
      </span>
    </div>
    {panel === "spin" && myTurn && <div className="np-panel np-spin" role="dialog" aria-label="Spin">
      <div className="np-spin-face" onPointerDown={spinDrag} onPointerMove={spinDrag}><i className="np-spin-limit" /><b style={{ left: `${50 + spin.x / 20}%`, top: `${50 - spin.y / 20}%` }} /></div>
      <div className="np-spin-side">
        <span className="np-kicker">WHERE THE TIP STRIKES</span>
        <p>{spin.y > 60 ? "Follow" : spin.y < -60 ? "Draw" : "Centre"}{Math.abs(spin.x) > 60 ? ` · ${spin.x > 0 ? "right" : "left"} english` : ""}</p>
        <label>ELEVATION {Math.round(elev / 1000)}°<input type="range" min={0} max={45} step={1} value={Math.round(elev / 1000)} onChange={(e) => setElev(Number(e.target.value) * 1000)} /></label>
        <button type="button" className="np-btn ghost small" onClick={() => { setSpin({ x: 0, y: 0 }); setElev(0); }}>RESET</button>
      </div>
    </div>}
    {panel === "emote" && me && <div className="np-panel np-emotes" role="dialog" aria-label="Emotes">{me.look.emotes.map((id) => <button key={id} type="button" onClick={() => { setPanel(null); void props.onEmote?.(id).catch((e) => setErr((e as Error).message)); }}><Emote id={id} /></button>)}</div>}
    {err && <div className="np-error" role="alert"><Icon name="alert" size={15} /><span>{err}</span><button type="button" onClick={() => setErr(null)} aria-label="Dismiss"><Icon name="close" size={14} /></button></div>}
  </div>;
}
