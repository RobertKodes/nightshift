import { useEffect, useRef, useState } from "react";
import { ATTACK_DELAY, type Attack, BALLS, H, type Input, MAX_TICKS, TICK, Table, W } from "./engine";

/**
 * The table on screen. Physics is the deterministic engine; everything here is looks and feel:
 * Codex-painted space art, NIGHT FROGS as targets and avatars, glow, trails, particles, shakes,
 * announcer banners, a live minimap of the rival's ball, meteors and surges from the rival,
 * synthesized sound and music. Inputs are recorded per tick for the server's lockstep replay.
 */
const ART = "/games/pinball";
export type Rival = { name: string; avatar?: string | null; live: number; x: number; y: number; attacks: { kind: Attack; tick: number }[] };
type Props = {
  seed: number;
  /** Wall-clock start (duels): the VS screen and countdown run until then. */
  startAt?: number;
  avatar?: string | null;
  name?: string;
  rival?: Rival | null;
  /** Attract mode: the table plays itself behind the lobby, no HUD, no sound. */
  demo?: boolean;
  onLive?: (s: { score: number; tick: number; x: number; y: number; sent: { kind: Attack; tick: number }[] }) => void;
  onDone?: (r: { score: number; inputs: Input[]; stats: Table["stats"] }) => void;
  /** Drawn over the table: the result, the rival search. */
  overlay?: React.ReactNode;
};

type Particle = { x: number; y: number; vx: number; vy: number; life: number; max: number; color: string; size: number };
type Popup = { x: number; y: number; text: string; life: number; color: string };
type Banner = { text: string; sub?: string; color: string; life: number; max: number };

const img = (src: string): HTMLImageElement => { const i = new Image(); i.src = src; return i; };

/** Synthesized sound and a soft synth loop: no files to load. */
function makeAudio() {
  let ctx: AudioContext | null = null, music: { stop: () => void } | null = null;
  const ok = () => { try { ctx ??= new AudioContext(); if (ctx.state === "suspended") void ctx.resume(); return ctx; } catch { return null; } };
  return {
    beep(f: number, d = 0.08, type: OscillatorType = "square", vol = 0.05) {
      const c = ok(); if (!c) return;
      const o = c.createOscillator(), g = c.createGain();
      o.type = type; o.frequency.setValueAtTime(f, c.currentTime); o.frequency.exponentialRampToValueAtTime(Math.max(40, f * 0.5), c.currentTime + d);
      g.gain.setValueAtTime(vol, c.currentTime); g.gain.exponentialRampToValueAtTime(0.0001, c.currentTime + d);
      o.connect(g).connect(c.destination); o.start(); o.stop(c.currentTime + d);
    },
    music(on: boolean) {
      if (!on) { music?.stop(); music = null; return; }
      const c = ok(); if (!c || music) return;
      const notes = [110, 165, 220, 196, 147, 220, 262, 196];
      const g = c.createGain(); g.gain.value = 0.025; g.connect(c.destination);
      let i = 0, alive = true;
      const tick = () => {
        if (!alive) return;
        const o = c.createOscillator(), e = c.createGain(); o.type = "triangle"; o.frequency.value = notes[i++ % notes.length]!;
        e.gain.setValueAtTime(0.0001, c.currentTime); e.gain.exponentialRampToValueAtTime(1, c.currentTime + 0.05); e.gain.exponentialRampToValueAtTime(0.0001, c.currentTime + 0.45);
        o.connect(e).connect(g); o.start(); o.stop(c.currentTime + 0.5);
        setTimeout(tick, 250);
      };
      tick();
      music = { stop: () => { alive = false; g.disconnect(); } };
    },
  };
}

export function PinballGame({ seed, startAt, avatar, name = "You", rival, demo, onLive, onDone, overlay }: Props) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const mini = useRef<HTMLCanvasElement>(null);
  const keys = useRef({ left: 0, right: 0, plunger: 0 });
  const rivalRef = useRef<Rival | null | undefined>(rival);
  rivalRef.current = rival;
  const audio = useRef(makeAudio());
  const [sound, setSound] = useState(!demo);
  const [music, setMusic] = useState(false);
  const soundRef = useRef(sound); soundRef.current = sound;
  const [hud, setHud] = useState({ score: 0, mult: 1, balls: BALLS, time: MAX_TICKS / 240 });
  const done = useRef(false);

  useEffect(() => { audio.current.music(music && !demo); return () => audio.current.music(false); }, [music, demo]);

  useEffect(() => {
    const cv = canvas.current!;
    const g = cv.getContext("2d")!;
    const A = {
      field: img(`${ART}/playfield.webp`), hole: img(`${ART}/blackhole.webp`),
      planets: [0, 1, 2, 3].map((i) => img(`${ART}/planet-${i}.webp`)),
      frogs: [0, 1, 2, 3, 4].map((i) => img(`${ART}/frog-${i}.webp`)),
      me: avatar ? img(avatar) : img(`${ART}/frog-0.webp`),
      rival: rivalRef.current?.avatar ? img(rivalRef.current.avatar) : img(`${ART}/frog-3.webp`),
    };
    const t = new Table(seed);
    const inputs: Input[] = [];
    const sent: { kind: Attack; tick: number }[] = [];
    const scheduled = new Set<string>();
    let last = "", acc = 0, prev = performance.now(), raf = 0, shake = 0, seen = 0, slingFlash = 0, holeFrog = 0, flash = 0, liveAt = 0, hudAt = 0;
    let demoL = 0, demoR = 0;
    const parts: Particle[] = [], pops: Popup[] = [], banners: Banner[] = [], trail: { x: number; y: number }[] = [];
    const say = (text: string, color: string, sub?: string, life = 1.4) => { const same = banners.find((x) => x.text === text); if (same) { same.life = same.max = life; same.sub = sub; return; } banners.push({ text, sub, color, life, max: life }); if (banners.length > 3) banners.shift(); };
    const beep = (f: number, d?: number, type?: OscillatorType, vol?: number) => { if (soundRef.current && !demo) audio.current.beep(f, d, type, vol); };
    const burst = (x: number, y: number, color: string, n = 18, speed = 260) => {
      for (let i = 0; i < n; i++) { const a = Math.random() * Math.PI * 2, s = speed * (0.3 + Math.random()); parts.push({ x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s, life: 0, max: 0.4 + Math.random() * 0.6, color, size: 1.5 + Math.random() * 3 }); }
    };
    const stars = Array.from({ length: 70 }, () => ({ x: Math.random() * W, y: Math.random() * H, z: 0.3 + Math.random() * 0.7 }));

    const frame = (now: number) => {
      const dt = Math.min(0.1, (now - prev) / 1000); prev = now;
      const wait = startAt ? Math.max(0, startAt - Date.now()) : 0;
      // the rival's attacks land ATTACK_DELAY after they were earned, as on the server
      for (const a of rivalRef.current?.attacks ?? []) {
        const k = `${a.kind}:${a.tick}`;
        if (scheduled.has(k)) continue;
        scheduled.add(k); t.receive(a.kind, a.tick + ATTACK_DELAY);
        say(a.kind === "meteor" ? "INCOMING METEOR" : "GRAVITY SURGE INCOMING", "#FF4F68", `from ${rivalRef.current?.name ?? "your rival"} · 3 s`);
        beep(180, 0.35, "sawtooth", 0.06);
      }
      if (wait <= 0 && !t.over) {
        acc += dt;
        while (acc >= TICK && !t.over) {
          if (demo) {
            // the attract-mode bot
            const b = t.ball; if (demoL > 0) demoL--; if (demoR > 0) demoR--;
            if (demoL === 0 && b.y > 745 && b.y < 815 && b.x < 300) demoL = 40;
            if (demoR === 0 && b.y > 745 && b.y < 815 && b.x >= 300) demoR = 40;
            keys.current = { left: demoL > 15 ? 1 : 0, right: demoR > 15 ? 1 : 0, plunger: t.inLane ? (t.plunge < 180 ? 1 : 0) : 0 };
          }
          const k = keys.current, s = `${k.left}${k.right}${k.plunger}`;
          if (s !== last) { inputs.push([t.tick, k.left as 0 | 1, k.right as 0 | 1, k.plunger as 0 | 1]); t.input = { ...k }; last = s; }
          t.step();
          acc -= TICK;
        }
        if (demo && t.over) { Object.assign(t, new Table(seed + Math.floor(now))); seen = 0; }
      }
      for (; seen < t.events.length; seen++) {
        const e = t.events[seen]!, b = t.ball;
        if (e.send) sent.push({ kind: e.send, tick: e.tick });
        switch (e.kind) {
          case "bumper": beep(520 + Math.random() * 220, 0.07); burst(b.x, b.y, "#3FE6FF", 14); shake = Math.max(shake, 3); break;
          case "sling": beep(300, 0.05, "triangle"); slingFlash = 10; break;
          case "target": beep(880, 0.09, "sawtooth", 0.04); burst(b.x, b.y, "#B8FF4A", 22); break;
          case "targets": beep(1200, 0.3, "sawtooth", 0.05); say("FROG CREW!", "#B8FF4A", rival ? "+MULT · GRAVITY SURGE SENT" : "+1,500 · +MULT"); shake = 8; flash = 0.4; break;
          case "hole": beep(110, 0.7, "sine", 0.12); burst(t.hole.x, t.hole.y, "#FF4FD8", 70, 440); shake = 12; holeFrog = 1.6; flash = 0.6; say(`BLACK HOLE · x${t.mult}`, "#FF4FD8", rival ? "METEOR SENT" : "+2,000"); break;
          case "orbit": beep(660, 0.3, "triangle", 0.06); say("ORBIT!", "#FFC46B", rival ? "METEOR SENT" : "+500"); break;
          case "skill": beep(990, 0.4, "triangle", 0.07); say("SKILL SHOT!", "#3FE6FF", "+1,000"); flash = 0.3; break;
          case "save": beep(440, 0.3, "sine", 0.06); say("BALL SAVED", "#B8FF4A"); break;
          case "meteor-in": beep(70, 0.6, "sawtooth", 0.1); shake = 14; flash = 0.5; burst(t.meteors.at(-1)?.x ?? 290, t.meteors.at(-1)?.y ?? 300, "#FF7A3D", 50, 380); break;
          case "surge-in": beep(60, 0.8, "sawtooth", 0.08); say("GRAVITY SURGE", "#FF4F68", "5 s heavier"); shake = 10; break;
          case "drain": beep(90, 0.5, "sawtooth", 0.08); shake = 6; if (t.ballsLeft > 0) say(`BALL ${BALLS - t.ballsLeft + 1}`, "#F2EFFF", `${t.ballsLeft} left`); break;
          case "launch": beep(240, 0.2, "sine", 0.06); break;
        }
        if (e.points > 0) pops.push({ x: b.x, y: b.y - 18, text: `+${e.points.toLocaleString()}`, life: 0.9, color: e.points >= 1000 ? "#FFC46B" : "#F2EFFF" });
      }
      draw(now, dt, wait);
      drawMini();
      if (onLive && !demo && now - liveAt > 250) { liveAt = now; onLive({ score: t.score, tick: t.tick, x: t.ball.x, y: t.ball.y, sent: sent.slice(-20) }); }
      if (!demo && (now - hudAt > 120 || t.over)) { hudAt = now; setHud({ score: t.score, mult: t.mult, balls: t.ballsLeft, time: Math.max(0, (MAX_TICKS - t.tick) / 240) }); }
      if (!demo && t.over && !done.current) { done.current = true; onDone?.({ score: t.score, inputs, stats: { ...t.stats } }); }
      raf = requestAnimationFrame(frame);
    };

    const drawMini = () => {
      const m = mini.current, r = rivalRef.current;
      if (!m || !r) return;
      const c = m.getContext("2d")!, s = m.width / W;
      c.setTransform(s, 0, 0, s, 0, 0);
      c.fillStyle = "#03020A"; c.fillRect(0, 0, W, H);
      if (A.field.complete) { c.globalAlpha = 0.7; c.drawImage(A.field, 0, 0, W, H); c.globalAlpha = 1; }
      c.fillStyle = "#FF4FD8"; c.shadowColor = "#FF4FD8"; c.shadowBlur = 30; c.beginPath(); c.arc(r.x, r.y, 22, 0, 7); c.fill(); c.shadowBlur = 0;
    };

    const draw = (now: number, dt: number, wait: number) => {
      const s = cv.width / W;
      g.setTransform(s, 0, 0, s, 0, 0);
      const sx = shake ? (Math.random() - 0.5) * shake : 0, sy = shake ? (Math.random() - 0.5) * shake : 0;
      shake = Math.max(0, shake - dt * 30);
      g.save(); g.translate(sx, sy);
      g.fillStyle = "#03020A"; g.fillRect(-20, -20, W + 40, H + 40);
      if (A.field.complete) g.drawImage(A.field, 0, 0, W, H);
      g.fillStyle = "rgba(3,2,10,.26)"; g.fillRect(0, 0, W, H);
      // drifting stars over the art, for depth
      for (const st of stars) { st.y += st.z * 14 * dt; if (st.y > H) st.y = 0; g.fillStyle = `rgba(242,239,255,${0.25 + st.z * 0.5})`; g.fillRect(st.x, st.y, st.z * 2, st.z * 2); }

      g.lineCap = "round";
      const pulse = 0.65 + 0.35 * Math.sin(now / 300);
      for (const w of t.walls) {
        const sling = w.tag === "sling";
        g.strokeStyle = sling ? (slingFlash > 0 ? "#FFFFFF" : "#FF4FD8") : `rgba(63,230,255,${0.6 + pulse * 0.35})`;
        g.lineWidth = sling ? 5 : 3; g.shadowColor = sling ? "#FF4FD8" : "#3FE6FF"; g.shadowBlur = sling ? 20 : 12;
        g.beginPath(); g.moveTo(w.a.x, w.a.y); g.lineTo(w.b.x, w.b.y); g.stroke();
      }
      if (slingFlash > 0) slingFlash--;
      g.shadowBlur = 0;

      const hs = t.hole.pull * 1.25;
      g.save(); g.translate(t.hole.x, t.hole.y);
      g.rotate(now / 800); if (A.hole.complete) g.drawImage(A.hole, -hs, -hs, hs * 2, hs * 2);
      g.rotate(-now / 400); g.globalAlpha = 0.35; if (A.hole.complete) g.drawImage(A.hole, -hs * 0.7, -hs * 0.7, hs * 1.4, hs * 1.4);
      g.restore(); g.globalAlpha = 1;

      t.bumpers.forEach((b, i) => {
        const pi = A.planets[b.kind]!, r = b.r * 1.34 + (b.flash ? 5 : 0);
        g.save(); g.translate(b.x, b.y); g.rotate(now / (2400 + i * 700));
        g.shadowColor = ["#B07CFF", "#3FE6FF", "#FFC46B", "#FF4FD8"][b.kind]!; g.shadowBlur = b.flash ? 50 : 14;
        if (pi.complete) g.drawImage(pi, -r, -r, r * 2, r * 2);
        g.restore();
        if (b.flash) { g.strokeStyle = `rgba(242,239,255,${b.flash / 18})`; g.lineWidth = 3; g.beginPath(); g.arc(b.x, b.y, b.r + 22 - b.flash, 0, 7); g.stroke(); }
      });

      // meteors from the rival: burning rocks with a warning ring
      for (const m of t.meteors) {
        const left = (m.until - t.tick) / 240;
        g.save(); g.translate(m.x, m.y); g.rotate(now / 500);
        g.shadowColor = "#FF7A3D"; g.shadowBlur = 30;
        const grd = g.createRadialGradient(-m.r * 0.3, -m.r * 0.3, 2, 0, 0, m.r);
        grd.addColorStop(0, "#FFB36B"); grd.addColorStop(0.5, "#8A3A1E"); grd.addColorStop(1, "#2A0F08");
        g.fillStyle = grd; g.beginPath();
        for (let i = 0; i < 9; i++) { const a = (i / 9) * Math.PI * 2, rr = m.r * (0.82 + 0.18 * Math.sin(i * 2.3)); g.lineTo(Math.cos(a) * rr, Math.sin(a) * rr); }
        g.closePath(); g.fill(); g.restore();
        g.strokeStyle = `rgba(255,79,104,${left < 2 ? 0.3 + 0.3 * Math.sin(now / 80) : 0.35})`; g.lineWidth = 2; g.setLineDash([6, 6]);
        g.beginPath(); g.arc(m.x, m.y, m.r + 10, 0, 7); g.stroke(); g.setLineDash([]); g.shadowBlur = 0;
      }

      t.targets.forEach((x, i) => {
        const fi = A.frogs[i % A.frogs.length]!;
        g.save(); g.globalAlpha = x.down ? 0.16 : 1;
        g.shadowColor = "#B8FF4A"; g.shadowBlur = x.down ? 0 : 14 + pulse * 10;
        g.beginPath(); g.arc(x.x, x.y, x.r + 4, 0, 7); g.fillStyle = "#08070D"; g.fill();
        if (fi.complete) g.drawImage(fi, x.x - x.r - 3, x.y - x.r - 3, (x.r + 3) * 2, (x.r + 3) * 2);
        g.restore();
      });

      for (const side of [0, 1] as const) {
        const f = t.flipper(side);
        g.strokeStyle = "#FFC46B"; g.shadowColor = "#FFC46B"; g.shadowBlur = 16; g.lineWidth = 18;
        g.beginPath(); g.moveTo(f.a.x, f.a.y); g.lineTo(f.b.x, f.b.y); g.stroke();
        g.shadowBlur = 0; g.strokeStyle = "#FFF2AA"; g.lineWidth = 6; g.beginPath(); g.moveTo(f.a.x, f.a.y); g.lineTo(f.b.x, f.b.y); g.stroke();
        g.fillStyle = "#08070D"; g.beginPath(); g.arc(f.a.x, f.a.y, 6, 0, 7); g.fill();
      }

      const b = t.ball;
      if (t.held === 0) { trail.push({ x: b.x, y: b.y }); if (trail.length > 16) trail.shift(); } else trail.length = 0;
      trail.forEach((p, i) => { g.fillStyle = `rgba(63,230,255,${(i / trail.length) * 0.35})`; g.beginPath(); g.arc(p.x, p.y, 11 * (i / trail.length), 0, 7); g.fill(); });
      if (t.held === 0) {
        const grd = g.createRadialGradient(b.x - 3, b.y - 3, 1, b.x, b.y, 12);
        grd.addColorStop(0, "#FFFFFF"); grd.addColorStop(0.6, "#C8F6FF"); grd.addColorStop(1, "#3FE6FF");
        g.fillStyle = grd; g.shadowColor = "#3FE6FF"; g.shadowBlur = 24; g.beginPath(); g.arc(b.x, b.y, 11, 0, 7); g.fill(); g.shadowBlur = 0;
      }
      if (t.inLane) {
        const p = t.plunge / 240;
        g.fillStyle = "#08070D"; g.fillRect(546, 690, 24, 170);
        g.fillStyle = "rgba(63,230,255,.25)"; g.fillRect(546, 860 - 170 * 0.82, 24, 170 * 0.12); // the skill-shot window
        g.fillStyle = p >= 0.7 && p <= 0.82 ? "#3FE6FF" : p > 0.82 ? "#FF4FD8" : "#FFC46B"; g.fillRect(546, 860 - 170 * p, 24, 170 * p);
      }
      if (t.tick < t.surgeUntil) { const k = 0.25 + 0.15 * Math.sin(now / 90); const grd = g.createRadialGradient(W / 2, H / 2, H * 0.3, W / 2, H / 2, H * 0.75); grd.addColorStop(0, "rgba(255,79,104,0)"); grd.addColorStop(1, `rgba(255,79,104,${k})`); g.fillStyle = grd; g.fillRect(0, 0, W, H); }

      for (let i = parts.length - 1; i >= 0; i--) {
        const p = parts[i]!; p.life += dt; p.x += p.vx * dt; p.y += p.vy * dt; p.vx *= 0.96; p.vy *= 0.96;
        if (p.life >= p.max) { parts.splice(i, 1); continue; }
        g.globalAlpha = 1 - p.life / p.max; g.fillStyle = p.color; g.beginPath(); g.arc(p.x, p.y, p.size, 0, 7); g.fill();
      }
      g.globalAlpha = 1;
      g.textAlign = "center"; g.font = "700 20px 'JetBrains Mono', monospace";
      for (let i = pops.length - 1; i >= 0; i--) {
        const p = pops[i]!; p.life -= dt; p.y -= 40 * dt;
        if (p.life <= 0) { pops.splice(i, 1); continue; }
        g.globalAlpha = Math.min(1, p.life * 2); g.fillStyle = p.color; g.shadowColor = p.color; g.shadowBlur = 12; g.fillText(p.text, p.x, p.y);
      }
      g.globalAlpha = 1; g.shadowBlur = 0;

      if (holeFrog > 0) {
        holeFrog -= dt;
        const k = Math.min(1, (1.6 - holeFrog) * 4);
        g.save(); g.globalAlpha = Math.min(1, holeFrog * 2); g.translate(W / 2, H / 2 + 40); g.scale(k, k);
        g.shadowColor = "#FF4FD8"; g.shadowBlur = 50; g.beginPath(); g.arc(0, 0, 64, 0, 7); g.fillStyle = "#08070D"; g.fill();
        if (A.me.complete) { g.save(); g.beginPath(); g.arc(0, 0, 60, 0, 7); g.clip(); g.drawImage(A.me, -60, -60, 120, 120); g.restore(); }
        g.restore();
      }
      // announcer banners
      banners.forEach((bn, i) => {
        bn.life -= dt;
        const p = 1 - bn.life / bn.max, y = 220 + i * 92, k = p < 0.12 ? p / 0.12 : 1;
        g.save(); g.globalAlpha = Math.max(0, Math.min(1, bn.life * 3)); g.translate(W / 2, y); g.scale(0.6 + 0.4 * k, 0.6 + 0.4 * k);
        g.fillStyle = "rgba(3,2,10,.72)"; g.fillRect(-W / 2 + 30, -38, W - 60, bn.sub ? 76 : 56);
        g.fillStyle = bn.color; g.fillRect(-W / 2 + 30, -38, 5, bn.sub ? 76 : 56);
        g.font = "800 34px 'JetBrains Mono', monospace"; g.fillStyle = bn.color; g.shadowColor = bn.color; g.shadowBlur = 20; g.fillText(bn.text, 0, 4);
        if (bn.sub) { g.shadowBlur = 0; g.font = "600 15px 'JetBrains Mono', monospace"; g.fillStyle = "#F2EFFF"; g.fillText(bn.sub, 0, 28); }
        g.restore();
      });
      for (let i = banners.length - 1; i >= 0; i--) if (banners[i]!.life <= 0) banners.splice(i, 1);
      if (flash > 0) { g.fillStyle = `rgba(242,239,255,${flash * 0.35})`; g.fillRect(0, 0, W, H); flash = Math.max(0, flash - dt * 1.6); }

      // the VS screen and the countdown
      if (wait > 0) {
        g.fillStyle = "rgba(3,2,10,.82)"; g.fillRect(0, 0, W, H);
        const secs = Math.ceil(wait / 1000), r = rivalRef.current;
        const face = (im: HTMLImageElement, x: number, color: string, label: string) => {
          g.save(); g.shadowColor = color; g.shadowBlur = 40; g.beginPath(); g.arc(x, 330, 92, 0, 7); g.fillStyle = "#08070D"; g.fill();
          g.beginPath(); g.arc(x, 330, 88, 0, 7); g.clip(); if (im.complete) g.drawImage(im, x - 88, 242, 176, 176); g.restore();
          g.strokeStyle = color; g.lineWidth = 4; g.beginPath(); g.arc(x, 330, 90, 0, 7); g.stroke();
          g.fillStyle = "#F2EFFF"; g.font = "700 22px 'JetBrains Mono', monospace"; g.fillText(label, x, 460);
        };
        const slide = Math.min(1, (6000 - wait) / 600);
        face(A.me, 150 * slide, "#7C5CFF", name);
        if (r) face(A.rival, W - 150 * slide, "#FF4FD8", r.name);
        g.font = "900 64px 'JetBrains Mono', monospace"; g.fillStyle = "#FFC46B"; g.shadowColor = "#FFC46B"; g.shadowBlur = 30; g.fillText("VS", W / 2, 350); g.shadowBlur = 0;
        g.font = "900 150px 'JetBrains Mono', monospace"; g.fillStyle = "#F2EFFF"; g.globalAlpha = 0.5 + 0.5 * ((wait % 1000) / 1000);
        g.fillText(secs > 3 ? "" : String(secs), W / 2, 700); g.globalAlpha = 1;
        g.font = "600 16px 'JetBrains Mono', monospace"; g.fillStyle = "#C4B4FF"; g.fillText("Same table · same seed · meteors fly both ways", W / 2, 780);
      }
      g.restore();
    };

    raf = requestAnimationFrame(frame);
    if (demo) return () => cancelAnimationFrame(raf);
    const key = (down: boolean) => (e: KeyboardEvent) => {
      const k = e.key.toLowerCase();
      if (["arrowleft", "a", "z", "shift"].includes(k)) { keys.current.left = down ? 1 : 0; e.preventDefault(); }
      if (["arrowright", "l", "/", "m"].includes(k)) { keys.current.right = down ? 1 : 0; e.preventDefault(); }
      if ([" ", "arrowdown", "enter"].includes(k)) { keys.current.plunger = down ? 1 : 0; e.preventDefault(); }
    };
    const kd = key(true), ku = key(false);
    window.addEventListener("keydown", kd); window.addEventListener("keyup", ku);
    return () => { cancelAnimationFrame(raf); window.removeEventListener("keydown", kd); window.removeEventListener("keyup", ku); };
  }, [seed, demo]);

  const touch = (k: "left" | "right" | "plunger", v: 0 | 1) => (e: React.PointerEvent) => { e.preventDefault(); keys.current[k] = v; };
  if (demo) return <canvas ref={canvas} width={W} height={H} className="arc-canvas" />;
  const lead = rival ? hud.score - rival.live : 0;
  const share = rival ? Math.round((hud.score / Math.max(1, hud.score + rival.live)) * 100) : 50;
  return (
    <div className={`arc-play ${rival ? "arc-duel" : "arc-practice"}`}>
      <section className="arc-mobile-hud" aria-label="Live game scores and controls">
        <div className={`arc-mobile-matchup ${rival ? "" : "solo"}`}>
          <div className="arc-mobile-player">
            <div className="arc-face"><img src={avatar ?? `${ART}/frog-0.webp`} alt="" /></div>
            <div className="arc-identity"><span className="arc-kicker">YOU</span><span className="arc-label">{name}</span></div>
            <b className="arc-score" aria-label={`Your score: ${hud.score.toLocaleString()}`}>{hud.score.toLocaleString()}</b>
          </div>
          {rival && <div className="arc-mobile-player">
            <div className="arc-face rival"><img src={rival.avatar ?? `${ART}/frog-3.webp`} alt="" /></div>
            <div className="arc-identity"><span className="arc-kicker">RIVAL</span><span className="arc-label">{rival.name}</span></div>
            <b className="arc-score rival" aria-label={`Rival's score: ${rival.live.toLocaleString()}`}>{rival.live.toLocaleString()}</b>
          </div>}
        </div>
        <div className="arc-mobile-meta">
          <div className="arc-meters">
            <div><span>MULT</span><b>×{hud.mult}</b></div>
            <div><span>BALLS</span><b>{hud.balls}<small> / {BALLS}</small></b></div>
            <div><span>TIME</span><b>{Math.floor(hud.time / 60)}:{String(Math.floor(hud.time % 60)).padStart(2, "0")}</b></div>
          </div>
          <div className="arc-tools">
            <button type="button" onClick={() => setSound(!sound)} className={sound ? "on" : ""} aria-pressed={sound} aria-label={`Sound ${sound ? "on" : "off"}`}><svg className="icon" width="17" height="17" viewBox="0 0 24 24" aria-hidden="true"><use href={`#arc-icon-${sound ? "sound" : "sound-off"}`} /></svg></button>
            <button type="button" onClick={() => setMusic(!music)} className={music ? "on" : ""} aria-pressed={music} aria-label={`Music ${music ? "on" : "off"}`}><svg className="icon" width="17" height="17" viewBox="0 0 24 24" aria-hidden="true"><use href="#arc-icon-music" /></svg></button>
          </div>
        </div>
      </section>
      <div className="arc-machine">
        <aside className="arc-side arc-you" aria-label="Your game">
          <div className="arc-side-head"><span className="arc-kicker">01 / YOUR TABLE</span><span className="arc-live">LIVE</span></div>
          <div className="arc-combatant">
            <div className="arc-face"><img src={avatar ?? `${ART}/frog-0.webp`} alt="" /></div>
            <div className="arc-identity"><span className="arc-kicker">PLAYER ONE</span><span className="arc-label">{name}</span></div>
          </div>
          <div className="arc-score-block"><span className="arc-kicker">YOUR SCORE</span><b className="arc-score">{hud.score.toLocaleString()}</b></div>
          <div className="arc-meters">
            <div><span>MULT</span><b>×{hud.mult}</b></div>
            <div><span>BALLS</span><b>{hud.balls}<small> / {BALLS}</small></b></div>
            <div><span>TIME</span><b>{Math.floor(hud.time / 60)}:{String(Math.floor(hud.time % 60)).padStart(2, "0")}</b></div>
          </div>
          <div className="arc-keys">
            <span className="arc-kicker">AT YOUR FINGERTIPS</span>
            <div><kbd>←</kbd><kbd>A</kbd><span>Left flipper</span></div>
            <div><kbd>→</kbd><kbd>L</kbd><span>Right flipper</span></div>
            <div><kbd>SPACE</kbd><span>Hold to charge.<br />Release in the blue band.</span></div>
          </div>
          <div className="arc-tools">
            <button type="button" onClick={() => setSound(!sound)} className={sound ? "on" : ""} aria-pressed={sound} aria-label={`Sound ${sound ? "on" : "off"}`} title={`Sound ${sound ? "on" : "off"}`}><svg className="icon" width="17" height="17" viewBox="0 0 24 24" aria-hidden="true"><use href={`#arc-icon-${sound ? "sound" : "sound-off"}`} /></svg><span>Sound</span><small>{sound ? "ON" : "OFF"}</small></button>
            <button type="button" onClick={() => setMusic(!music)} className={music ? "on" : ""} aria-pressed={music} aria-label={`Music ${music ? "on" : "off"}`} title={`Music ${music ? "on" : "off"}`}><svg className="icon" width="17" height="17" viewBox="0 0 24 24" aria-hidden="true"><use href="#arc-icon-music" /></svg><span>Music</span><small>{music ? "ON" : "OFF"}</small></button>
          </div>
          <p className="arc-side-note"><svg className="icon" width="19" height="19" viewBox="0 0 24 24" aria-hidden="true"><use href="#arc-icon-shield" /></svg><span>Ball save is on for the first<br />4 seconds of every ball.</span></p>
        </aside>

        <div className="arc-table">
          <canvas ref={canvas} width={W * 2} height={H * 2} className="arc-canvas" aria-label="Space Pinball playfield" />
          {overlay}
        </div>

        <aside className={`arc-side arc-them ${rival ? "" : "arc-guide"}`} aria-label={rival ? "Rival's game" : "Practice guide"}>
          {rival ? <>
            <div className="arc-side-head"><span className="arc-kicker">02 / RIVAL'S TABLE</span><span className="arc-live">LIVE</span></div>
            <div className="arc-combatant">
              <div className="arc-face rival"><img src={rival.avatar ?? `${ART}/frog-3.webp`} alt="" /></div>
              <div className="arc-identity"><span className="arc-kicker">YOUR RIVAL</span><span className="arc-label">{rival.name}</span></div>
            </div>
            <div className="arc-score-block"><span className="arc-kicker">RIVAL'S SCORE</span><b className="arc-score rival">{rival.live.toLocaleString()}</b></div>
            <div className="arc-contest">
              <div className="arc-tug" role="meter" aria-label="Your share of points" aria-valuemin={0} aria-valuemax={100} aria-valuenow={share} title="Your share of the points"><i style={{ width: `${share}%` }} /></div>
              <p className={`arc-lead ${lead >= 0 ? "good" : "bad"}`}>{lead === 0 ? "All square" : lead > 0 ? `You lead by ${lead.toLocaleString()}` : `${(-lead).toLocaleString()} behind`}</p>
            </div>
            <div className="arc-mini-wrap"><div className="arc-section-head"><span className="arc-kicker"><svg className="icon" width="14" height="14" viewBox="0 0 24 24" aria-hidden="true"><use href="#arc-icon-radar" /></svg> LIVE FEED</span><span>RIVAL</span></div><canvas ref={mini} width={400} height={600} className="arc-mini" aria-label="Live view of your rival's ball" /></div>
            <p className="arc-side-note"><svg className="icon" width="18" height="18" viewBox="0 0 24 24" aria-hidden="true"><use href="#arc-icon-bolt" /></svg><span>Send a little chaos.<br />Keep your ball alive.</span></p>
          </> : <>
            <div className="arc-side-head"><span className="arc-kicker">THE FIELD GUIDE</span><svg className="icon" width="20" height="20" viewBox="0 0 24 24" aria-hidden="true"><use href="#arc-icon-orbit" /></svg></div>
            <h2 className="arc-guide-title">Find your<br /><em>rhythm.</em></h2>
            <ul className="arc-tips">
              <li><svg className="icon" width="21" height="21" viewBox="0 0 24 24" aria-hidden="true"><use href="#arc-icon-black-hole" /></svg><div><b>Black hole</b><span>+2,000 and +1 multiplier, up to ×5.</span></div></li>
              <li><svg className="icon" width="21" height="21" viewBox="0 0 24 24" aria-hidden="true"><use href="#arc-icon-frog" /></svg><div><b>Frog crew</b><span>All three: +1,500 and +1 multiplier.</span></div></li>
              <li><svg className="icon" width="21" height="21" viewBox="0 0 24 24" aria-hidden="true"><use href="#arc-icon-orbit" /></svg><div><b>Orbit</b><span>Sweep the top fast for +500.</span></div></li>
              <li><svg className="icon" width="21" height="21" viewBox="0 0 24 24" aria-hidden="true"><use href="#arc-icon-target" /></svg><div><b>Skill shot</b><span>Release in the blue band for +1,000.</span></div></li>
              <li><svg className="icon" width="21" height="21" viewBox="0 0 24 24" aria-hidden="true"><use href="#arc-icon-shield" /></svg><div><b>Ball save</b><span>Your first 4 seconds are covered.</span></div></li>
            </ul>
            <p className="arc-lead arc-practice-note">In a duel, black holes and orbits send meteors. The frog crew sends a gravity surge.</p>
          </>}
        </aside>
      </div>

      <div className="arc-touch" aria-label="Touch controls">
        <button type="button" aria-label="Left flipper" onPointerDown={touch("left", 1)} onPointerUp={touch("left", 0)} onPointerLeave={touch("left", 0)} onPointerCancel={touch("left", 0)}><svg className="icon arc-flip-left" width="22" height="22" viewBox="0 0 24 24" aria-hidden="true"><use href="#arc-icon-flipper" /></svg><span>LEFT FLIP</span></button>
        <button type="button" className="arc-launch" aria-label="Hold to charge, release to launch" onPointerDown={touch("plunger", 1)} onPointerUp={touch("plunger", 0)} onPointerLeave={touch("plunger", 0)} onPointerCancel={touch("plunger", 0)}><svg className="icon" width="20" height="20" viewBox="0 0 24 24" aria-hidden="true"><use href="#arc-icon-bolt" /></svg><span>LAUNCH</span><small>HOLD + RELEASE</small></button>
        <button type="button" aria-label="Right flipper" onPointerDown={touch("right", 1)} onPointerUp={touch("right", 0)} onPointerLeave={touch("right", 0)} onPointerCancel={touch("right", 0)}><svg className="icon" width="22" height="22" viewBox="0 0 24 24" aria-hidden="true"><use href="#arc-icon-flipper" /></svg><span>RIGHT FLIP</span></button>
      </div>
    </div>
  );
}
