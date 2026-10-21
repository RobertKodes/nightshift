import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Icon } from "../Icon";
import { LITE, PHONE, pixelRatio } from "../lite";
import { type LastShot, type MatchView, POCKET_LABEL, type PlayerView, type ShotInput } from "./api";
import { Avatar, Emote, Title, WinEffect } from "./cosmetics";
import { EV, HEAD_Y, MAX_TIP, POCKETED, R, W, L, aimAt, fits, sincos } from "./physics";
import type { Call } from "./rules";
import { PoolSound } from "./sound";
import { PoolScene, mouth } from "./table3d";

/**
 * The table and everything on it, played like 8 Ball Pool: the 3D scene (straight down by default,
 * a 3D tilt on the toggle), the players' cards with their frames, titles and the shot clock's ring,
 * the aim (the cue follows the mouse round the cue ball, a click locks it; on a touch screen a drag
 * anywhere turns it), the fine-tune wheel on the right with the spin ball over it, the power bar on
 * the left (pull it down, let go to shoot, let go at the top to cancel; on a computer also a drag
 * back on the table or a held Space), the call (taken from the aim, a pocket changed with one
 * click) or a safety, the cue ball in hand, banners for the turn, the ball in hand and fouls, the
 * first-time hints, the replay of every shot from the server's keyframes with sound (and
 * Telegram's haptics), emotes, and the end screen. Only the input and the camera are here: the
 * shot sent is the same integers the server plays.
 */
export type Haptic = (kind: "light" | "medium" | "heavy" | "success" | "error" | "select") => void;
type Props = {
  view: MatchView; spectate?: boolean; practice?: boolean;
  onShoot: (s: ShotInput) => Promise<void>;
  onAim?: (s: Partial<ShotInput>) => void;
  onDecide?: (choice: string) => Promise<void>;
  onEmote?: (id: string) => Promise<void>;
  onResign?: () => void; onRematch?: () => void; onLobby?: () => void; onLocker?: () => void;
  soundOn: boolean; onSound?: () => void; haptic?: Haptic; skew: number;
  /** After the game: what the profile gained (XP, level, unlocks), when known. */
  reward?: { xp: number; level: number; unlocked: string[] } | null;
};
const TIP = MAX_TIP * 1000;
/** Let go of the power below this (the top of the bar) and nothing is played. */
const DEAD = 40;
/** A drag back on the table this long (metres) is a full-power stroke. */
const FULL_PULL = 0.3;
/** The fine-tune wheel: thousandths of a degree per pixel. */
const FINE = 12;
const clampSpin = (x: number, y: number) => { const d = Math.hypot(x, y); return d <= TIP ? { x, y } : { x: (x / d) * TIP, y: (y / d) * TIP }; };
const mdeg = (dx: number, dy: number) => { let a = Math.round(Math.atan2(dy, dx) * 180000 / Math.PI); if (a < 0) a += 360000; return a % 360000; };
const wrap = (a: number) => ((Math.round(a) % 360000) + 360000) % 360000;
const clamp01 = (v: number) => Math.max(0, Math.min(1, v));
const GROUP = { solids: "SOLIDS", stripes: "STRIPES" } as const;
const BALL_COLORS = ["#f4c20d", "#1d4fd8", "#d62828", "#5b2a86", "#f2711c", "#1a7f3c", "#7a1f1f"];
/** A touch screen plays by dragging; a mouse aims by pointing. */
const TOUCH = PHONE || (typeof matchMedia !== "undefined" && matchMedia("(pointer: coarse)").matches);
const HINTS_KEY = "np-hints";
const DEBUG = typeof location !== "undefined" && new URLSearchParams(location.search).has("np-debug");
const HINTS = TOUCH ? [
  ["target", "Drag to aim", "Drag anywhere on the table: the cue turns round the cue ball. The wheel on the right fine-tunes it."],
  ["bolt", "Pull the power bar and let go", "Pull the cue on the left down, then let go to shoot. Let go at the top and nothing is played."],
  ["orbit", "Tap the ball for spin", "The cue ball at the top right: tap where the tip should strike for follow, draw or english."],
] : [
  ["target", "Move the mouse to aim", "The cue follows the mouse round the cue ball. Click to lock it there; the wheel, the strip on the right and the arrow keys fine-tune it."],
  ["bolt", "Pull the power bar and let go", "Drag the cue on the left down and let go to shoot; back at the top it cancels. A drag back on the table or a held Space works too."],
  ["orbit", "Click the ball for spin", "The cue ball at the top right: click where the tip should strike for follow, draw or english."],
] as const;

function MiniBall({ id }: { id: number }) {
  const c = id === 8 ? "#0d0b14" : BALL_COLORS[(id > 8 ? id - 9 : id - 1)]!;
  return <i className={`np-mini ${id > 8 ? "stripe" : ""}`} style={{ ["--c" as string]: c }}><b>{id}</b></i>;
}
function PlayerCard({ p, active, left, clock, view, timed }: { p: PlayerView; active: boolean; left: number; clock: number; view: MatchView; timed: boolean }) {
  const g = p.group, on8 = view.onEight[p.seat] && !!g;
  const own = g ? (g === "solids" ? [1, 2, 3, 4, 5, 6, 7] : [9, 10, 11, 12, 13, 14, 15]).filter((id) => view.balls.some((b) => b.id === id && b.s !== POCKETED)) : [];
  const pct = timed ? Math.max(0, Math.min(1, clock / Math.max(1, view.clock.ms))) : 1;
  return <div className={`np-player ${active ? "active" : ""} seat-${p.seat}`}>
    <span className={`np-ring ${active && timed && clock < 10_000 ? "low" : ""}`} style={{ ["--p" as string]: active ? pct : 0 }}><Avatar frame={p.look.frame} avatar={p.look.avatar} size={44} level={p.look.level} /></span>
    <div className="np-player-info">
      <b>{p.name}{p.agent && <i className="np-tag">AGENT</i>}{p.you && <i className="np-tag you">YOU</i>}{active && <i className="np-tag turn">{p.you ? "YOUR TURN" : "TO PLAY"}</i>}</b>
      <span className="np-player-meta"><Title id={p.look.title} /><small>{p.rating}</small>{!p.connected && <small className="np-off">· reconnecting</small>}</span>
      <span className="np-group">{g ? on8 ? <><MiniBall id={8} /><em>ON THE 8</em></> : <>{own.map((id) => <MiniBall key={id} id={id} />)}<em>{GROUP[g]} · {left}</em></> : <em>{view.phase === "break" ? "BREAK" : "OPEN TABLE"}</em>}{view.fouls[p.seat] >= 2 && <em className="np-warn">2 FOULS</em>}</span>
    </div>
    {active && timed && <span className={`np-clock ${clock < 10_000 ? "low" : ""}`}>{Math.ceil(clock / 1000)}</span>}
  </div>;
}
type Drag =
  | { kind: "cue" }
  | { kind: "rotate"; last: { x: number; y: number } }
  | { kind: "stroke"; aim: number; from: { x: number; y: number } }
  | { kind: "power"; y0: number }
  | { kind: "fine"; y0: number; a0: number; off0: number };
type Banner = { kind: "turn" | "hand" | "foul"; title: string; sub?: string; key: number };

export function PoolGame(props: Props) {
  const { view, spectate = false, soundOn } = props;
  const host = useRef<HTMLDivElement>(null), scene = useRef<PoolScene | null>(null), sound = useRef<PoolSound | null>(null);
  const [aim, setAim] = useState(90000), [power, setPower] = useState(0), [spin, setSpin] = useState({ x: 0, y: 0 }), [elev, setElev] = useState(0);
  const [cue, setCue] = useState<{ x: number; y: number } | null>(null), [cueOk, setCueOk] = useState(true);
  const [override, setOverride] = useState<{ ball?: number; pocket?: number } | null>(null), [safety, setSafety] = useState(false), [picking, setPicking] = useState(false);
  const [panel, setPanel] = useState<"spin" | "emote" | null>(null);
  const [view3d, setView3d] = useState(() => { try { return localStorage.getItem("np-view") === "3d"; } catch { return false; } });
  const [busy, setBusy] = useState(false), [err, setErr] = useState<string | null>(null), [toast, setToast] = useState<string | null>(null);
  const [replaying, setReplaying] = useState(false), [now, setNow] = useState(Date.now());
  // the aim is locked (a click, the wheel, the strip, the keys): the mouse no longer turns the cue
  const [locked, setLocked] = useState(false), [overCue, setOverCue] = useState(false), [grabbing, setGrabbing] = useState(false);
  const [fineOff, setFineOff] = useState(0), [layout, setLayout] = useState(0);
  const [hint, setHint] = useState<number | null>(null), [banner, setBanner] = useState<Banner | null>(null);
  const played = useRef(-1), aimRef = useRef(aim), powerRef = useRef(power), drag = useRef<Drag | null>(null);
  const lastAimSent = useRef(0), powerBar = useRef<HTMLDivElement>(null), bannerKey = useRef(0), queue = useRef<Banner[]>([]);
  // the mouse's last stop on the cloth: a quick move off the cloth (to the bar) puts the aim back there
  const hover = useRef<{ x: number; y: number; t: number; inside: boolean; rested: { aim: number; t: number } | null }>({ x: 0, y: 0, t: 0, inside: false, rested: null });
  aimRef.current = aim; powerRef.current = power;
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
  // ?np-debug: the table's state on window too, for automated play (where the balls are)
  if (DEBUG) Object.assign(window, { __npView: view, __npInput: { aim, power, locked, spin, elev, cue: inHand ? cuePos : cue, myTurn } });

  const say = useCallback((b: Omit<Banner, "key">) => {
    const next = { ...b, key: ++bannerKey.current };
    setBanner((cur) => { if (cur) { queue.current.push(next); return cur; } return next; });
  }, []);
  useEffect(() => {
    if (!banner) return;
    const id = setTimeout(() => setBanner(queue.current.shift() ?? null), 1700);
    return () => clearTimeout(id);
  }, [banner?.key]);

  // ---- the scene
  useEffect(() => {
    if (!host.current) return;
    const s = new PoolScene(host.current, { lite: LITE, pixelRatio: pixelRatio(1.75) });
    scene.current = s; sound.current = new PoolSound();
    // ?np-debug: the scene on window, for automated screenshots that aim at a ball
    if (DEBUG) (window as unknown as { __npScene?: PoolScene }).__npScene = s;
    // the pocket buttons follow the table when the page resizes
    const ro = new ResizeObserver(() => requestAnimationFrame(() => {
      // on a phone held upright the power bar and the wheel lie over the rails: the table keeps its cloth clear of them
      const side = (q: string) => { const el = host.current?.parentElement?.querySelector<HTMLElement>(q); return el && getComputedStyle(el).position === "absolute" ? el.offsetWidth : 0; };
      scene.current?.setInsets(side(".np-power"), side(".np-right"));
      setLayout((n) => n + 1);
    })); ro.observe(host.current);
    return () => { ro.disconnect(); s.dispose(); scene.current = null; sound.current?.close(); };
  }, []);
  useEffect(() => { if (sound.current) sound.current.enabled = soundOn; }, [soundOn]);
  useEffect(() => { const id = setInterval(() => { if (!document.hidden) setNow(Date.now()); }, 250); return () => clearInterval(id); }, []);
  // the table's look is the host's (seat 1's cloth, frame and balls); the cue is the shooter's
  useEffect(() => { scene.current?.setLook({ cloth: host0?.cloth ?? "cloth-night", table: host0?.table ?? "table-shift", balls: host0?.balls ?? "balls-classic", cue: shooterLook?.cue ?? "cue-crew" }); }, [host0?.cloth, host0?.table, host0?.balls, shooterLook?.cue]);
  useEffect(() => {
    scene.current?.setView(view3d ? "tilt" : "top"); setLayout((n) => n + 1);
    try { localStorage.setItem("np-view", view3d ? "3d" : "2d"); } catch { /* private window */ }
  }, [view3d]);

  // ---- a new shot: replay it from the keyframes
  const viewRef = useRef(view), replayId = useRef(0);
  viewRef.current = view;
  const replay = useCallback((last: LastShot) => {
    const s = scene.current;
    if (!s || !last.frames || !last.start) return;
    played.current = last.n;
    const id = ++replayId.current;
    setReplaying(true); setPanel(null); setPicking(false); setHint(null);
    const budget = Math.max(1, last.replayMs - 700) / 1000, rate = Math.max(1, last.duration / budget);
    sound.current?.cue(last.shot.power / 1000);
    props.haptic?.(last.shot.power > 700 ? "heavy" : "medium");
    s.showCue(null, 0, 0, 0); s.showGuide(view.balls, null);
    void s.play(last.start, last.frames, { rate, onEvent: (e) => {
      if (e.kind === EV.BALL) { sound.current?.ball(e.speed); if (e.speed > 1.2) props.haptic?.("light"); }
      else if (e.kind === EV.RAIL || e.kind === EV.JAW) sound.current?.rail(e.speed);
      else if (e.kind === EV.POCKET) { sound.current?.pocket(); props.haptic?.(e.a === 0 ? "error" : "medium"); }
    } }).then(() => {
      // a replay cut short by the next one leaves the table to it; the last one puts every ball where the shot left it
      if (id !== replayId.current) return;
      setReplaying(false); scene.current?.setBalls(viewRef.current.balls);
      // a foul of yours (or anyone's, in the stands) gets the banner; the rival's shows as your ball in hand
      if (last.verdict.foul && (spectate || you === null || last.seat === you)) say({ kind: "foul", title: "FOUL", sub: last.verdict.text });
      else setToast(last.verdict.text);
    });
  }, [view.balls, props.haptic, spectate, you, say]);
  useEffect(() => {
    const last = view.last;
    if (last && last.n > played.current && last.frames && t < last.at + last.replayMs + 4_000) replay(last);
    else if (last) played.current = Math.max(played.current, last.n);
  }, [view.last?.n]);
  useEffect(() => { if (!replaying) scene.current?.setBalls(view.balls); }, [view.balls, replaying]);
  useEffect(() => { if (!toast) return; const id = setTimeout(() => setToast(null), 4_200); return () => clearTimeout(id); }, [toast]);
  // a new turn: the aim starts at the nearest ball of the shooter's, the spin and the call reset, the mouse aims again
  useEffect(() => {
    setOverride(null); setSafety(false); setPicking(false); setCue(null); setPower(0); setSpin({ x: 0, y: 0 }); setElev(0); setLocked(false);
    hover.current.rested = null;
    const c = cueBall && cueBall.s !== POCKETED ? cueBall : null, target = view.balls.filter((b) => view.targets.includes(b.id) && b.s !== POCKETED).sort((p, q) => (c ? Math.hypot(p.x - c.x, p.y - c.y) - Math.hypot(q.x - c.x, q.y - c.y) : 0))[0];
    if (view.phase === "break") setAim(90000);
    else if (c && target) setAim(mdeg(target.x - c.x, target.y - c.y));
  }, [view.turn, view.last?.n, view.racks, view.decision?.kind]);
  // your turn: a banner (the ball in hand after the rival's foul), and the hints the first time
  const wasMine = useRef(false);
  useEffect(() => {
    if (myTurn && !wasMine.current) {
      const rivalFoul = view.last && view.last.seat !== you && view.last.verdict.foul ? view.last.verdict.text : undefined;
      if (inHand) say({ kind: "hand", title: "BALL IN HAND", sub: rivalFoul ?? (view.inHand === "kitchen" ? "Place it behind the head string." : "Place it anywhere on the cloth.") });
      else say({ kind: "turn", title: "YOUR TURN", sub: view.phase === "break" ? "Break the rack." : view.targets.length === 1 && view.targets[0] === 8 ? "Call the 8's pocket." : undefined });
      props.haptic?.("select");
      let seen = true;
      try { seen = localStorage.getItem(HINTS_KEY) === "1"; } catch { /* private window */ }
      if (!seen) setHint(0);
    }
    wasMine.current = myTurn;
  }, [myTurn]);
  const endHints = () => { setHint(null); try { localStorage.setItem(HINTS_KEY, "1"); } catch { /* private window */ } };

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
    : override?.pocket !== undefined ? { ball: override.ball ?? (aimInfo?.hit?.kind === "ball" && view.targets.includes(aimInfo.hit.id) ? aimInfo.hit.id : undefined) ?? predicted?.ball ?? view.targets[0] ?? 1, pocket: override.pocket }
    : needsCall ? predicted : null;
  const callText = view.phase === "break" ? "BREAK" : call === "safety" ? "SAFETY" : call ? `${call.ball === 8 ? "8-BALL" : `BALL ${call.ball}`} → ${POCKET_LABEL[call.pocket]!.toUpperCase()}` : needsCall ? "CALL A POCKET" : "ANY BALL OF YOURS";
  const stroke = { power: Math.round(power), spinX: Math.round(spin.x), spinY: Math.round(spin.y), elevation: Math.round(elev) };

  // ---- what the scene shows
  const rivalAim = !myTurn && !replaying && view.aim && view.aim.seat === view.turn && t >= view.clock.turnAt ? view.aim : null;
  useEffect(() => {
    const s = scene.current;
    if (!s || replaying) return;
    if (myTurn && cuePos) {
      s.showGuide(view.balls, { aim, cue: cuePos, length: guideLen, targets: view.targets, stroke });
      s.showCue(cuePos, aim, power / 1000, elev);
      if (inHand) s.moveCueBall(cuePos.x, cuePos.y, cueOk);
      s.showMarks({ call: call && call !== "safety" ? call : null, targets: view.targets, balls: view.balls, kitchen: view.inHand === "kitchen", pockets: picking, hand: inHand ? { ...cuePos, ok: cueOk } : null });
    } else if (rivalAim) {
      const c = rivalAim.cue ?? cuePos;
      if (c) { s.showGuide(view.balls, { aim: rivalAim.aim, cue: c, length: 1, targets: view.targets, stroke: { power: rivalAim.power, spinX: rivalAim.spinX, spinY: rivalAim.spinY, elevation: rivalAim.elevation } }); s.showCue(c, rivalAim.aim, rivalAim.power / 1000, rivalAim.elevation); if (rivalAim.cue) s.moveCueBall(c.x, c.y, true); }
      s.showMarks({ call: null, targets: [], balls: view.balls, kitchen: false });
    } else { s.showGuide(view.balls, null); s.showCue(null, 0, 0, 0); s.showMarks({ call: null, targets: [], balls: view.balls, kitchen: false }); }
  }, [myTurn, replaying, aim, power, elev, spin.x, spin.y, cuePos?.x, cuePos?.y, cueOk, view.balls, view.targets, picking, JSON.stringify(call), rivalAim?.aim, rivalAim?.power, rivalAim?.spinX, rivalAim?.spinY, guideLen]);
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
  useEffect(() => { const s = Math.ceil(clockLeft / 1000); if (myTurn && !props.practice && s <= 10 && s > 0 && s !== lastTick.current) { lastTick.current = s; sound.current?.tick(); } }, [Math.ceil(clockLeft / 1000), myTurn]);

  // ---- shooting
  const shoot = useCallback(async (p: number) => {
    if (!myTurn || busy || !cuePos) return;
    if (p < DEAD) { setPower(0); return; }
    if (inHand && !cueOk) { setErr("Put the cue ball where it fits: on the cloth, touching no ball" + (view.inHand === "kitchen" ? ", behind the head string." : ".")); setPower(0); return; }
    if (needsCall && call === null) { setErr(view.rules === "wpa" ? "Call a pocket (click one of the pockets) or play a safety." : "Call the pocket for the 8-ball: click a pocket."); setPicking(true); setPower(0); return; }
    setBusy(true); setErr(null); sound.current?.unlock(); setHint(null);
    try { await props.onShoot({ aim: wrap(aim), power: Math.round(p), spinX: Math.round(spin.x), spinY: Math.round(spin.y), elevation: Math.round(elev), call, ...(view.inHand !== "none" ? { cue: cuePos } : {}) }); }
    catch (e) { setErr((e as Error).message); }
    finally { setBusy(false); setPower(0); }
  }, [myTurn, busy, cuePos, inHand, cueOk, needsCall, call, aim, spin, elev, view.inHand, view.rules]);

  // ---- pointers on the table
  const onCloth = (p: { x: number; y: number }) => p.x > -0.005 && p.x < W + 0.005 && p.y > -0.005 && p.y < L + 0.005;
  /** The mouse left the cloth: after a quick move from a stop, the aim goes back to where the mouse stopped. */
  const leaveCloth = () => {
    const h = hover.current;
    if (h.inside && !locked && h.rested && performance.now() - h.rested.t < 900) setAim(h.rested.aim);
    h.inside = false; h.rested = null;
  };
  const pull = (from: { x: number; y: number }, p: { x: number; y: number }, a: number) => { const [dy, dx] = sincos(a); return ((from.x - p.x) * dx + (from.y - p.y) * dy) / FULL_PULL * 1000; };
  const onDown = (e: React.PointerEvent) => {
    const s = scene.current;
    sound.current?.unlock();
    if ((e.target as HTMLElement).closest?.(".np-pocket, .np-pill")) return;
    if (panel) { setPanel(null); return; }
    if (!s || !myTurn || busy) return;
    const p = s.toTable(e.clientX, e.clientY);
    if (!p || !cuePos) return;
    (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId);
    const touch = e.pointerType !== "mouse";
    if (picking) {
      // a pocket or a ball for the call: the nearest pocket mouth, or a ball of the shooter's
      const ball = view.balls.find((b) => b.s !== POCKETED && view.targets.includes(b.id) && Math.hypot(b.x - p.x, b.y - p.y) < R * 1.6);
      if (ball) { setOverride((o) => ({ ...o, ball: ball.id })); props.haptic?.("select"); return; }
      let k = 0, best = Infinity;
      for (let i = 0; i < 6; i++) { const m = mouth(i), d = Math.hypot(m.x - p.x, m.y - p.y); if (d < best) { best = d; k = i; } }
      if (best < 0.14) { setOverride((o) => ({ ...o, pocket: k })); setPicking(false); setSafety(false); props.haptic?.("select"); }
      return;
    }
    const ppm = Math.max(1, s.pxPerMetre());
    if (inHand && Math.hypot(p.x - cuePos.x, p.y - cuePos.y) < Math.max(R * 2.2, (touch ? 30 : 14) / ppm)) { drag.current = { kind: "cue" }; setGrabbing(true); return; }
    if (touch) { drag.current = { kind: "rotate", last: p }; return; }
    if (e.button === 2) { setLocked(false); hover.current.rested = null; return; }
    if (e.button !== 0) return;
    // a press on the cue behind the ball, or on the aim line once the aim is locked (fine-tuned), keeps the aim;
    // anywhere else points the cue there; both lock it and start a stroke
    const [sy, cx] = sincos(aimRef.current), rx = p.x - cuePos.x, ry = p.y - cuePos.y, along = rx * cx + ry * sy;
    const onLine = Math.abs(-rx * sy + ry * cx) < Math.max(R * 1.4, 12 / ppm);
    const keep = onLine && (along < -R * 1.2 || (locked && along > 0));
    let a = aimRef.current;
    if (!keep && Math.hypot(rx, ry) > R * 1.5) { a = mdeg(rx, ry); setAim(a); }
    setLocked(true);
    drag.current = { kind: "stroke", aim: a, from: p };
  };
  const onMove = (e: React.PointerEvent) => {
    const s = scene.current, d = drag.current;
    if (!s || !myTurn || !cuePos) return;
    const p = s.toTable(e.clientX, e.clientY);
    if (!p) return;
    if (!d) {
      if (e.pointerType !== "mouse" || picking || busy) return;
      const ppm = Math.max(1, s.pxPerMetre());
      setOverCue(inHand && Math.hypot(p.x - cuePos.x, p.y - cuePos.y) < Math.max(R * 2.2, 14 / ppm));
      // the cue follows the mouse over the cloth until a click locks it; off the cloth (or over a pocket button) it stays
      if (locked) return;
      if ((e.target as HTMLElement).closest?.(".np-pocket, .np-pill") || !onCloth(p)) { leaveCloth(); return; }
      const h = hover.current, at = performance.now();
      if (!h.inside || Math.hypot(e.clientX - h.x, e.clientY - h.y) > 6) {
        if (h.inside && at - h.t > 220) h.rested = { aim: aimRef.current, t: at };
        h.x = e.clientX; h.y = e.clientY; h.t = at;
      }
      h.inside = true;
      if (Math.hypot(p.x - cuePos.x, p.y - cuePos.y) > R * 1.5) setAim(mdeg(p.x - cuePos.x, p.y - cuePos.y));
      return;
    }
    if (d.kind === "cue") {
      const x = Math.max(R, Math.min(W - R, p.x)), y = Math.max(R, Math.min((view.inHand === "kitchen" ? HEAD_Y - 0.0005 : L - R), p.y));
      setCue({ x, y }); setCueOk(fits(view.balls.filter((b) => b.id !== 0), 0, x, y) && (view.inHand !== "kitchen" || y < HEAD_Y));
    } else if (d.kind === "rotate") {
      // a drag anywhere turns the cue by as much as the finger goes round the cue ball (slower close to it)
      const rx = p.x - cuePos.x, ry = p.y - cuePos.y, r = Math.hypot(rx, ry) || 1, mx = p.x - d.last.x, my = p.y - d.last.y;
      const turn = ((-ry * mx + rx * my) / r) / Math.max(r, 90 / Math.max(1, s.pxPerMetre()));
      d.last = p;
      if (turn) setAim((a) => wrap(a + turn * 180000 / Math.PI));
    } else if (d.kind === "stroke") setPower(Math.max(0, Math.min(1000, pull(d.from, p, d.aim))));
  };
  const onUp = (e: React.PointerEvent) => {
    const s = scene.current, d = drag.current;
    drag.current = null; setGrabbing(false);
    if (!s || !d || !myTurn || !cuePos) return;
    if (d.kind === "stroke") {
      const p = s.toTable(e.clientX, e.clientY), pw = p ? Math.max(0, Math.min(1000, pull(d.from, p, d.aim))) : 0;
      if (pw >= DEAD) void shoot(pw); else setPower(0);
    }
  };
  const onCancel = () => { if (drag.current?.kind === "stroke") setPower(0); drag.current = null; setGrabbing(false); };
  // the power bar: pull the cue down, let go to shoot; back at the top, letting go cancels
  const powerDown = (e: React.PointerEvent) => {
    if (!myTurn || busy) return;
    sound.current?.unlock(); setLocked(true); setPanel(null);
    if (hint !== null) endHints();
    (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId);
    drag.current = { kind: "power", y0: e.clientY };
  };
  const powerAt = (y: number, y0: number) => { const bar = powerBar.current, h = bar ? bar.getBoundingClientRect().height : 300; return clamp01((y - y0) / (h * 0.82)) * 1000; };
  const powerMove = (e: React.PointerEvent) => { const d = drag.current; if (d?.kind !== "power") return; setPower(powerAt(e.clientY, d.y0)); };
  const powerUp = (e: React.PointerEvent) => { const d = drag.current; drag.current = null; if (d?.kind !== "power") return; const p = powerAt(e.clientY, d.y0); if (p >= DEAD) { props.haptic?.("medium"); void shoot(p); } else setPower(0); };
  // the fine-tune wheel: a hundredth of a degree a pixel or so
  const fineDown = (e: React.PointerEvent) => { if (!myTurn) return; setLocked(true); (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId); drag.current = { kind: "fine", y0: e.clientY, a0: aimRef.current, off0: fineOff }; };
  const fineMove = (e: React.PointerEvent) => { const d = drag.current; if (d?.kind !== "fine") return; const dy = e.clientY - d.y0; setAim(wrap(d.a0 - dy * FINE)); setFineOff(d.off0 + dy); };
  // the keyboard: arrows fine-tune, space charges and shoots, Escape cancels or lets the mouse aim again
  const charging = useRef<number | null>(null), chargeStart = useRef(0), shootRef = useRef(shoot);
  const charged = (start: number) => Math.min(1000, ((performance.now() - start) / 1400) * 1000);
  shootRef.current = shoot;
  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      if (!myTurn || (e.target as HTMLElement)?.tagName === "INPUT") return;
      if (e.key === "ArrowLeft" || e.key === "ArrowRight" || e.key === "ArrowUp" || e.key === "ArrowDown") { e.preventDefault(); setLocked(true); setAim((a) => wrap(a + (e.key === "ArrowLeft" || e.key === "ArrowUp" ? 1 : -1) * (e.shiftKey ? 500 : 50))); }
      if (e.key === " " && charging.current === null && !e.repeat) { e.preventDefault(); setLocked(true); const start = performance.now(); chargeStart.current = start; charging.current = window.setInterval(() => setPower(charged(start)), 30); }
      if (e.key === "Escape") { if (charging.current !== null) { clearInterval(charging.current); charging.current = null; setPower(0); } else if (panel) setPanel(null); else { setLocked(false); hover.current.rested = null; } }
    };
    // the power is the time Space was held (not the last frame drawn: a slow device would play it softer)
    const up = (e: KeyboardEvent) => { if (e.key === " " && charging.current !== null) { e.preventDefault(); clearInterval(charging.current); charging.current = null; const p = charged(chargeStart.current); setPower(p); void shootRef.current(p); } };
    addEventListener("keydown", down); addEventListener("keyup", up);
    return () => { removeEventListener("keydown", down); removeEventListener("keyup", up); };
  }, [myTurn, panel]);
  useEffect(() => { if (!myTurn && charging.current !== null) { clearInterval(charging.current); charging.current = null; setPower(0); } }, [myTurn]);
  useEffect(() => () => { if (charging.current !== null) clearInterval(charging.current); }, []);
  // the mouse wheel fine-tunes (and locks) the aim; not passive, so the page does not scroll
  const stage = useRef<HTMLDivElement>(null), wheelOk = useRef(false);
  wheelOk.current = myTurn;
  useEffect(() => {
    const el = stage.current;
    if (!el) return;
    const wheel = (e: WheelEvent) => {
      if (!wheelOk.current || (e.target as HTMLElement).closest?.(".np-panel, .np-overlay")) return;
      e.preventDefault(); setLocked(true);
      const step = Math.sign(e.deltaY) * (e.shiftKey ? 400 : 60);
      setAim((a) => wrap(a - step)); setFineOff((o) => o + Math.sign(e.deltaY) * 6);
    };
    el.addEventListener("wheel", wheel, { passive: false });
    return () => el.removeEventListener("wheel", wheel);
  }, []);

  // ---- the spin panel
  const spinDrag = (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.type === "pointerdown") (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId);
    else if (!(e.buttons & 1) && e.pointerType === "mouse") return;
    else if (e.pointerType !== "mouse" && !(e.currentTarget as HTMLElement).hasPointerCapture?.(e.pointerId)) return;
    const r = e.currentTarget.getBoundingClientRect(), x = ((e.clientX - r.left) / r.width - 0.5) * 2, y = -((e.clientY - r.top) / r.height - 0.5) * 2;
    setSpin(clampSpin(x * 1000, y * 1000)); props.haptic?.("select");
  };
  // ---- the pockets to call: one click each, where the call is needed
  const showPockets = myTurn && !busy && view.phase !== "break" && (picking || needsCall) && !!scene.current;
  const pocketAt = useMemo(() => { const s = scene.current; return s ? Array.from({ length: 6 }, (_, k) => { const m = mouth(k); return s.toScreen(m.x, m.y); }) : []; }, [layout, showPockets]);

  const winnerP = view.winner !== null ? view.players[view.winner] : undefined;
  const ended = view.done && view.startedAt;
  const countdown = status === "countdown" ? Math.max(0, Math.ceil(((view.startedAt ?? 0) - t) / 1000)) : 0;
  const deciding = view.decision && !spectate && you === view.decision.by;
  const DECISIONS: Record<string, [string, string]> = { accept: ["Accept the table", "Shoot from where the balls lie."], rebreak: ["Re-rack and break", "A new rack; you break."], "rebreak-other": ["Re-rack, they break", "A new rack; the breaker breaks again."], spot: ["Spot the 8", view.decision?.kind === "eight-break-foul" ? "The 8 goes on the foot spot; you take the cue ball in the kitchen." : "The 8 goes on the foot spot; play on."] };
  const pill = !myTurn || replaying || busy ? null : inHand ? (TOUCH ? "BALL IN HAND · DRAG THE CUE BALL" : "BALL IN HAND · DRAG THE CUE BALL · THE MOUSE AIMS") : TOUCH ? null : locked ? "AIM LOCKED · RIGHT-CLICK OR ESC: THE MOUSE AIMS" : "THE CUE FOLLOWS THE MOUSE · CLICK TO LOCK";
  const pulling = drag.current?.kind === "power" || drag.current?.kind === "stroke" || charging.current !== null;

  return <div className={`np-table ${myTurn ? "my-turn" : ""} ${spectate ? "spectating" : ""} ${TOUCH ? "touch" : "mouse"}`}>
    <div className="np-hud">
      {view.players.map((p) => <PlayerCard key={p.seat} p={p} active={playing && shooterSeat === p.seat && !replaying} left={view.left[p.seat]} clock={clockLeft} view={view} timed={!props.practice} />)}
      {view.emotes.map((em) => <span key={`${em.seat}-${em.at}`} className={`np-bubble seat-${em.seat}`}><Emote id={em.id} /></span>)}
    </div>
    <div className="np-stage" ref={stage}>
      <div className={`np-power ${myTurn ? "" : "off"} ${power > 0 ? "on" : ""} ${power > 0 && power < DEAD ? "dead" : ""}`} ref={powerBar} onPointerDown={powerDown} onPointerMove={powerMove} onPointerUp={powerUp} onPointerCancel={() => { drag.current = null; setPower(0); }} role="slider" aria-label="Shot power: pull down, let go to shoot; let go at the top to cancel" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(power / 10)} aria-disabled={!myTurn}>
        <span className="np-power-top">{power > 0 && power < DEAD ? "CANCEL" : power > 0 ? `${Math.round(power / 10)}%` : "POWER"}</span>
        <span className="np-power-track"><i className="np-power-fill" style={{ height: `${power * 0.082}%` }} /><i className="np-power-cue" style={{ transform: `translateY(${power * 0.082}%)` }} /></span>
        <span className="np-power-foot"><Icon name="arrow" size={14} /></span>
      </div>
      <div className={`np-felt ${overCue || grabbing ? "grab" : ""} ${grabbing ? "grabbing" : ""} ${locked ? "locked" : ""}`} ref={host} onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp} onPointerCancel={onCancel} onPointerLeave={(e) => { if (e.pointerType === "mouse" && !drag.current) leaveCloth(); }} onContextMenu={(e) => e.preventDefault()}>
        {showPockets && pocketAt.map((q, k) => <button key={k} type="button" className={`np-pocket ${call && call !== "safety" && call.pocket === k ? "on" : ""}`} style={{ left: q.x, top: q.y }} onPointerDown={(e) => e.stopPropagation()} onClick={() => { setOverride((o) => ({ ...o, pocket: k })); setPicking(false); setSafety(false); setErr(null); props.haptic?.("select"); }} aria-label={`Call the ${POCKET_LABEL[k]} pocket`} aria-pressed={!!call && call !== "safety" && call.pocket === k}><i /></button>)}
        {pill && <span className="np-pill" aria-live="polite">{pill}</span>}
        {banner && <div className={`np-banner ${banner.kind}`} key={banner.key} role="status"><b>{banner.title}</b>{banner.sub && <small>{banner.sub}</small>}</div>}
        {toast && !ended && !banner && <div className="np-toast" role="status">{toast}</div>}
        {pulling && power > 0 && <span className="np-pull-read">{power < DEAD ? "LET GO HERE TO CANCEL" : `${Math.round(power / 10)}%`}</span>}
      </div>
      <div className={`np-right ${myTurn ? "" : "off"}`}>
        <button type="button" className={`np-spinball ${panel === "spin" ? "on" : ""} ${spin.x || spin.y ? "set" : ""}`} disabled={!myTurn} onClick={() => setPanel(panel === "spin" ? null : "spin")} aria-label="Spin: where the tip strikes the cue ball" aria-expanded={panel === "spin"}><span className="np-spin-dot" style={{ ["--sx" as string]: `${spin.x / 20}%`, ["--sy" as string]: `${-spin.y / 20}%` }} />{elev > 0 && <small>{Math.round(elev / 1000)}°</small>}</button>
        <div className="np-fine" style={{ ["--off" as string]: `${fineOff}px` }} onPointerDown={fineDown} onPointerMove={fineMove} onPointerUp={() => { drag.current = null; }} onPointerCancel={() => { drag.current = null; }} role="slider" aria-label="Fine-tune the aim: drag up or down" aria-valuemin={0} aria-valuemax={360} aria-valuenow={Math.round(aim / 1000)} aria-disabled={!myTurn}><i /></div>
      </div>
      {panel === "spin" && myTurn && <div className="np-panel np-spin" role="dialog" aria-label="Spin">
        <div className="np-spin-face" onPointerDown={spinDrag} onPointerMove={spinDrag}><i className="np-spin-limit" /><i className="np-spin-cross" /><b style={{ left: `${50 + spin.x / 20}%`, top: `${50 - spin.y / 20}%` }} /></div>
        <div className="np-spin-side">
          <span className="np-kicker">WHERE THE TIP STRIKES</span>
          <p>{spin.y > 60 ? "Follow" : spin.y < -60 ? "Draw" : "Centre"}{Math.abs(spin.x) > 60 ? ` · ${spin.x > 0 ? "right" : "left"} english` : ""}</p>
          <small className="np-spin-note">The guide bends with it.</small>
          <label>ELEVATION {Math.round(elev / 1000)}°<input type="range" min={0} max={45} step={1} value={Math.round(elev / 1000)} onChange={(e) => setElev(Number(e.target.value) * 1000)} /></label>
          <div className="np-spin-acts"><button type="button" className="np-btn ghost small" onClick={() => { setSpin({ x: 0, y: 0 }); setElev(0); }}>RESET</button><button type="button" className="np-btn small" onClick={() => setPanel(null)}>DONE</button></div>
        </div>
      </div>}
      {hint !== null && myTurn && <div className={`np-hints step-${hint}`} role="dialog" aria-label="How to play">
        <div className="np-hint-card">
          <span className="np-kicker">{hint + 1} / {HINTS.length}</span>
          <Icon name={HINTS[hint]![0]} size={26} />
          <b>{HINTS[hint]![1]}</b>
          <p>{HINTS[hint]![2]}</p>
          <div className="np-hint-acts"><button type="button" className="np-btn ghost small" onClick={endHints}>SKIP</button><button type="button" className="np-btn small" onClick={() => (hint >= HINTS.length - 1 ? endHints() : setHint(hint + 1))}>{hint >= HINTS.length - 1 ? "PLAY" : "NEXT"}</button></div>
        </div>
      </div>}
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
    </div>
    <div className="np-bar">
      {myTurn ? <>
        <button type="button" className={`np-chip call ${picking ? "on" : ""} ${needsCall && call === null ? "warn" : ""}`} onClick={() => { setPicking(!picking); props.haptic?.("select"); }} disabled={view.phase === "break"}><Icon name="target" size={15} /><span>{picking ? "CLICK A POCKET OR A BALL" : callText}</span></button>
        {view.rules === "wpa" && view.phase !== "break" && <button type="button" className={`np-chip safe ${safety ? "on" : ""}`} onClick={() => setSafety(!safety)} aria-pressed={safety} aria-label="Call a safety"><Icon name="shield" size={15} /><span>SAFETY</span></button>}
        {override && <button type="button" className="np-chip auto" onClick={() => { setOverride(null); setPicking(false); }} aria-label="Call from the aim again"><Icon name="close" size={14} /><span>AUTO CALL</span></button>}
      </> : <span className="np-status">{replaying ? "Balls rolling…" : view.done ? "" : status === "waiting" ? "Waiting for a rival…" : view.decision ? "A choice after the break…" : !playing ? "" : spectate || you === null ? `${shooter?.name ?? ""} to shoot` : t < view.clock.turnAt ? "…" : `${shooter?.name ?? "Your rival"} is lining up a shot`}</span>}
      <span className="np-bar-end">
        {!spectate && me && props.onEmote && <button type="button" className={`np-chip icon ${panel === "emote" ? "on" : ""}`} onClick={() => setPanel(panel === "emote" ? null : "emote")} aria-label="Emotes"><Icon name="frog" size={17} /></button>}
        <button type="button" className={`np-chip np-view ${view3d ? "on" : ""}`} onClick={() => setView3d(!view3d)} aria-label={view3d ? "Flat top view" : "3D view"} aria-pressed={view3d}><Icon name={view3d ? "layers" : "grid"} size={15} /><span>{view3d ? "3D" : "2D"}</span></button>
        {props.onSound && <button type="button" className="np-chip icon np-sound" onClick={props.onSound} aria-label={soundOn ? "Mute" : "Sound on"} aria-pressed={soundOn}><Icon name={soundOn ? "sound" : "sound-off"} size={16} /></button>}
        {!spectate && me && !view.done && props.onResign && <button type="button" className="np-chip icon" onClick={props.onResign} aria-label="Resign"><Icon name="flag" size={16} /></button>}
      </span>
    </div>
    {panel === "emote" && me && <div className="np-panel np-emotes" role="dialog" aria-label="Emotes">{me.look.emotes.map((id) => <button key={id} type="button" onClick={() => { setPanel(null); void props.onEmote?.(id).catch((e) => setErr((e as Error).message)); }}><Emote id={id} /></button>)}</div>}
    {err && <div className="np-error" role="alert"><Icon name="alert" size={15} /><span>{err}</span><button type="button" onClick={() => setErr(null)} aria-label="Dismiss"><Icon name="close" size={14} /></button></div>}
  </div>;
}
