/**
 * The living layer over the megastructure artwork. Everything is drawn in the artwork's own pixel
 * space (1672 × 941) and mapped with the same "cover, centred" transform the <img> uses, so every
 * glow sits exactly on the structure it belongs to.
 */

export const ART_W = 1672;
export const ART_H = 941;

/** Where things are in the artwork. */
export const ANCHORS = {
  reactor: { x: 1045, y: 248, r: 236 },
  rimFlare: { x: 1246, y: 74 },
  ring: { cx: 1218, cy: 302, rx: 735, ry: 152, rot: -0.07 },
  horizon: { x0: 930, y0: 941, cx: 1350, cy: 680, x1: 1672, y1: 588 },
  clouds: { x: 1150, y: 560 },
};

type Star = { x: number; y: number; z: number; r: number; tw: number; ph: number };
type Ship = { t: number; speed: number; path: [number, number, number, number, number, number]; size: number; delay: number };
type Mote = { x: number; y: number; vx: number; vy: number; r: number; a: number };

const VIOLET = "124,92,255";
const LILAC = "196,180,255";

export interface SceneHandle { stop(): void; setPointer(x: number, y: number): void }

export function startScene(canvas: HTMLCanvasElement, opts: { reduceMotion: boolean }): SceneHandle {
  const g = canvas.getContext("2d")!;
  let W = 0;
  let H = 0;
  let dpr = 1;
  let scale = 1;
  let ox = 0;
  let oy = 0;
  const pointer = { x: 0, y: 0, tx: 0, ty: 0 };
  let raf = 0;
  let last = 0;

  const rnd = (a: number, b: number) => a + Math.random() * (b - a);
  const stars: Star[] = Array.from({ length: 320 }, () => {
    let x = 0;
    let y = 0;
    // Keep stars out of the reactor's disc and the planet.
    do { x = rnd(0, ART_W); y = rnd(0, ART_H * 0.72); } while (Math.hypot(x - ANCHORS.reactor.x, y - ANCHORS.reactor.y) < ANCHORS.reactor.r + 10);
    return { x, y, z: Math.random(), r: Math.random() < 0.06 ? rnd(1.2, 1.9) : rnd(0.3, 1), tw: rnd(0.4, 1.6), ph: rnd(0, 6.28) };
  });
  // Lights along the ring: sampled on its ellipse, each with its own rhythm.
  const ringLights = Array.from({ length: 150 }, (_, i) => {
    const a = (i / 150) * Math.PI * 2 + rnd(-0.02, 0.02);
    return { a, h: rnd(-14, 14), ph: rnd(0, 6.28), sp: rnd(0.6, 2.4), big: Math.random() < 0.12 };
  });
  const ships: Ship[] = [
    { t: 0, speed: 0.012, path: [-80, 640, 420, 560, 980, 470], size: 1.3, delay: 0 },
    { t: 0.45, speed: 0.009, path: [1760, 520, 1450, 470, 1180, 420], size: 0.9, delay: 0 },
    { t: 0.2, speed: 0.016, path: [-60, 420, 300, 380, 640, 330], size: 0.7, delay: 0 },
    { t: 0.7, speed: 0.007, path: [520, 760, 900, 690, 1320, 640], size: 1.0, delay: 0 },
  ];
  const motes: Mote[] = Array.from({ length: 70 }, () => ({ x: rnd(0, ART_W), y: rnd(0, ART_H), vx: rnd(-6, 6), vy: rnd(-3, 3), r: rnd(0.6, 2.2), a: rnd(0.15, 0.6) }));
  let flash = { at: -10, x: 0, y: 0 };

  function size() {
    const rect = canvas.getBoundingClientRect();
    W = rect.width;
    H = rect.height;
    dpr = Math.min(2, devicePixelRatio || 1);
    canvas.width = Math.round(W * dpr);
    canvas.height = Math.round(H * dpr);
    // object-fit: cover, centred
    scale = Math.max(W / ART_W, H / ART_H);
    ox = (W - ART_W * scale) / 2;
    oy = (H - ART_H * scale) / 2;
  }

  const ringPoint = (a: number, lift = 0) => {
    const { cx, cy, rx, ry, rot } = ANCHORS.ring;
    const x = Math.cos(a) * rx;
    const y = Math.sin(a) * ry + lift;
    return [cx + x * Math.cos(rot) - y * Math.sin(rot), cy + x * Math.sin(rot) + y * Math.cos(rot)] as const;
  };

  function bez(p: Ship["path"], t: number): [number, number] {
    const [x0, y0, x1, y1, x2, y2] = p;
    const u = 1 - t;
    return [u * u * x0 + 2 * u * t * x1 + t * t * x2, u * u * y0 + 2 * u * t * y1 + t * t * y2];
  }

  function frame(now: number) {
    const t = now / 1000;
    const dt = Math.min(0.05, (now - last) / 1000 || 0.016);
    last = now;
    pointer.x += (pointer.tx - pointer.x) * 0.04;
    pointer.y += (pointer.ty - pointer.y) * 0.04;

    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, W, H);
    // Art space, nudged by the pointer: the closer a layer, the more it moves.
    const layer = (depth: number) => g.setTransform(dpr * scale, 0, 0, dpr * scale, dpr * (ox + pointer.x * depth), dpr * (oy + pointer.y * depth));
    g.globalCompositeOperation = "lighter";

    // Stars, three depths
    for (const s of stars) {
      layer(2 + s.z * 6);
      const a = 0.25 + 0.75 * (0.5 + 0.5 * Math.sin(t * s.tw + s.ph));
      g.fillStyle = `rgba(${s.z > 0.8 ? LILAC : "220,225,255"},${a * (0.35 + s.z * 0.5)})`;
      g.beginPath();
      g.arc(s.x, s.y, s.r, 0, Math.PI * 2);
      g.fill();
    }

    layer(4);
    // Reactor: a breathing rim light, a flare, and slow energy arcs
    const R = ANCHORS.reactor;
    const breathe = 0.65 + 0.35 * Math.sin(t * 1.1);
    const glow = g.createRadialGradient(R.x, R.y, R.r * 0.92, R.x, R.y, R.r * 1.45);
    glow.addColorStop(0, `rgba(${VIOLET},${0.32 * breathe})`);
    glow.addColorStop(0.35, `rgba(${VIOLET},${0.12 * breathe})`);
    glow.addColorStop(1, "rgba(0,0,0,0)");
    g.fillStyle = glow;
    g.beginPath();
    g.arc(R.x, R.y, R.r * 1.45, 0, Math.PI * 2);
    g.arc(R.x, R.y, R.r * 0.98, 0, Math.PI * 2, true);
    g.fill();
    g.lineCap = "round";
    for (let k = 0; k < 3; k++) {
      const start = -1.2 + k * 0.9 + t * (0.18 + k * 0.05);
      g.strokeStyle = `rgba(${LILAC},${0.18 + 0.12 * Math.sin(t * 2 + k)})`;
      g.lineWidth = 2.2 - k * 0.5;
      g.beginPath();
      g.arc(R.x, R.y, R.r * (1.02 + k * 0.035), start, start + 0.7 + k * 0.25);
      g.stroke();
    }
    const fl = 0.55 + 0.45 * Math.sin(t * 1.7) * Math.sin(t * 0.63);
    const flare = g.createRadialGradient(ANCHORS.rimFlare.x, ANCHORS.rimFlare.y, 0, ANCHORS.rimFlare.x, ANCHORS.rimFlare.y, 140);
    flare.addColorStop(0, `rgba(255,255,255,${0.75 * fl})`);
    flare.addColorStop(0.08, `rgba(${LILAC},${0.45 * fl})`);
    flare.addColorStop(1, "rgba(0,0,0,0)");
    g.fillStyle = flare;
    g.fillRect(ANCHORS.rimFlare.x - 140, ANCHORS.rimFlare.y - 140, 280, 280);
    g.strokeStyle = `rgba(255,255,255,${0.35 * fl})`;
    g.lineWidth = 1;
    g.beginPath();
    g.moveTo(ANCHORS.rimFlare.x - 180 * fl, ANCHORS.rimFlare.y);
    g.lineTo(ANCHORS.rimFlare.x + 180 * fl, ANCHORS.rimFlare.y);
    g.stroke();

    // Ring lights: windows and beacons twinkling along the structure
    layer(5);
    for (const l of ringLights) {
      const [x, y] = ringPoint(l.a, l.h);
      const front = Math.sin(l.a) > -0.15;
      const v = Math.max(0, Math.sin(t * l.sp + l.ph));
      const a = (front ? 0.85 : 0.4) * v * v;
      if (a < 0.03) continue;
      const r = l.big ? 5 : 2.4;
      const gg = g.createRadialGradient(x, y, 0, x, y, r * 3);
      gg.addColorStop(0, `rgba(${l.big ? "255,255,255" : LILAC},${a})`);
      gg.addColorStop(1, `rgba(${VIOLET},0)`);
      g.fillStyle = gg;
      g.fillRect(x - r * 3, y - r * 3, r * 6, r * 6);
    }

    // Cloud haze drifting under the structure, and the odd lightning flash inside it
    layer(7);
    for (let k = 0; k < 3; k++) {
      const cx = ANCHORS.clouds.x + Math.sin(t * 0.05 + k * 2) * 160 - 120 + k * 140;
      const cy = ANCHORS.clouds.y + Math.cos(t * 0.04 + k) * 40 + k * 50;
      const hz = g.createRadialGradient(cx, cy, 0, cx, cy, 300);
      hz.addColorStop(0, `rgba(${VIOLET},0.07)`);
      hz.addColorStop(1, "rgba(0,0,0,0)");
      g.fillStyle = hz;
      g.fillRect(cx - 300, cy - 300, 600, 600);
    }
    if (!opts.reduceMotion && t - flash.at > 3.5 && Math.random() < 0.012) flash = { at: t, x: rnd(820, 1500), y: rnd(470, 720) };
    const fa = Math.max(0, 1 - (t - flash.at) * 3);
    if (fa > 0) {
      const lf = g.createRadialGradient(flash.x, flash.y, 0, flash.x, flash.y, 220);
      lf.addColorStop(0, `rgba(${LILAC},${0.55 * fa * (Math.random() * 0.4 + 0.6)})`);
      lf.addColorStop(1, "rgba(0,0,0,0)");
      g.fillStyle = lf;
      g.fillRect(flash.x - 220, flash.y - 220, 440, 440);
    }

    // The planet's atmosphere breathing along the horizon
    const hzn = ANCHORS.horizon;
    g.strokeStyle = `rgba(140,150,255,${0.28 + 0.12 * Math.sin(t * 0.7)})`;
    g.lineWidth = 6;
    g.shadowColor = `rgba(${VIOLET},0.9)`;
    g.shadowBlur = 24;
    g.beginPath();
    g.moveTo(hzn.x0, hzn.y0);
    g.quadraticCurveTo(hzn.cx, hzn.cy, hzn.x1, hzn.y1);
    g.stroke();
    g.shadowBlur = 0;

    // Ships: small silhouettes with violet engine trails crossing the scene
    layer(9);
    for (const s of ships) {
      if (!opts.reduceMotion) s.t += s.speed * dt * 6;
      if (s.t > 1.15) s.t = -0.15;
      const tt = Math.max(0, Math.min(1, s.t));
      const [x, y] = bez(s.path, tt);
      const [nx, ny] = bez(s.path, Math.min(1, tt + 0.01));
      const ang = Math.atan2(ny - y, nx - x);
      const fade = Math.min(1, Math.min(s.t + 0.15, 1.15 - s.t) * 5);
      if (fade <= 0) continue;
      g.save();
      g.translate(x, y);
      g.rotate(ang);
      g.globalAlpha = fade;
      const L = 26 * s.size;
      const trail = g.createLinearGradient(-L * 6, 0, -L * 0.6, 0);
      trail.addColorStop(0, `rgba(${VIOLET},0)`);
      trail.addColorStop(1, `rgba(${LILAC},0.55)`);
      g.strokeStyle = trail;
      g.lineWidth = 3 * s.size;
      g.beginPath();
      g.moveTo(-L * 6, 0);
      g.lineTo(-L * 0.6, 0);
      g.stroke();
      g.globalCompositeOperation = "source-over";
      g.fillStyle = "rgba(18,16,30,0.95)";
      g.beginPath();
      g.moveTo(L, 0);
      g.lineTo(-L * 0.6, -L * 0.22);
      g.lineTo(-L * 0.5, 0);
      g.lineTo(-L * 0.6, L * 0.22);
      g.closePath();
      g.fill();
      g.globalCompositeOperation = "lighter";
      const eg = g.createRadialGradient(-L * 0.6, 0, 0, -L * 0.6, 0, L * 0.6);
      eg.addColorStop(0, "rgba(255,255,255,0.95)");
      eg.addColorStop(0.3, `rgba(${VIOLET},0.8)`);
      eg.addColorStop(1, `rgba(${VIOLET},0)`);
      g.fillStyle = eg;
      g.fillRect(-L * 1.2, -L * 0.6, L * 1.2, L * 1.2);
      g.restore();
    }

    // Debris and dust drifting through the light
    layer(12);
    for (const m of motes) {
      if (!opts.reduceMotion) { m.x += m.vx * dt; m.y += m.vy * dt; }
      if (m.x < -20) m.x = ART_W + 20; if (m.x > ART_W + 20) m.x = -20;
      if (m.y < -20) m.y = ART_H + 20; if (m.y > ART_H + 20) m.y = -20;
      g.fillStyle = `rgba(${LILAC},${m.a * (0.6 + 0.4 * Math.sin(t + m.x))})`;
      g.beginPath();
      g.arc(m.x, m.y, m.r, 0, Math.PI * 2);
      g.fill();
    }
    g.globalCompositeOperation = "source-over";
    if (!opts.reduceMotion) raf = requestAnimationFrame(frame);
  }

  size();
  const ro = new ResizeObserver(size);
  ro.observe(canvas);
  raf = requestAnimationFrame(frame);
  return {
    stop() { cancelAnimationFrame(raf); ro.disconnect(); },
    setPointer(x: number, y: number) { pointer.tx = x; pointer.ty = y; },
  };
}
