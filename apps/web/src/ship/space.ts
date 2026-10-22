import { rng } from "./iso";

/**
 * Deep space behind the ship: a nebula wash, a crescent moon (the NIGHTSHIFT mark) far off, and three layers of
 * stars that drift at different speeds as the camera moves, so the ship floats in front of them. The window
 * openings in the ship's walls are left clear, so the same stars show through them.
 */
type Star = { x: number; y: number; r: number; a: number; tw: number; hue: number };
const TILE = 1400;

export class Space {
  private wash: HTMLCanvasElement | null = null;
  private moon: HTMLCanvasElement | null = null;
  private size = "";
  private layers: { f: number; stars: Star[] }[];
  private planet: HTMLCanvasElement | null = null;
  /** The pointer, -1..1 across the view: the backdrop leans a few pixels with it. */
  lean = { x: 0, y: 0 };
  private eased = { x: 0, y: 0 };

  constructor() {
    const g = rng(42);
    const layer = (n: number, f: number, rmin: number, rmax: number) => ({
      f, stars: Array.from({ length: n }, () => ({ x: g() * TILE, y: g() * TILE, r: rmin + g() * (rmax - rmin), a: 0.25 + g() * 0.75, tw: g() * 6.28, hue: g() })),
    });
    this.layers = [layer(260, 0.015, 0.4, 0.9), layer(140, 0.04, 0.6, 1.3), layer(46, 0.09, 0.9, 1.9)];
  }

  private build(w: number, h: number, dpr: number) {
    const c = document.createElement("canvas");
    c.width = Math.max(1, Math.round(w * dpr / 2)); c.height = Math.max(1, Math.round(h * dpr / 2));
    const x = c.getContext("2d")!;
    x.scale(c.width / w, c.height / h);
    const bg = x.createLinearGradient(0, 0, 0, h);
    bg.addColorStop(0, "#05040f"); bg.addColorStop(0.6, "#03020a"); bg.addColorStop(1, "#06030e");
    x.fillStyle = bg; x.fillRect(0, 0, w, h);
    const blob = (cx: number, cy: number, r: number, col: string) => { const g = x.createRadialGradient(cx, cy, 0, cx, cy, r); g.addColorStop(0, col); g.addColorStop(1, "rgba(0,0,0,0)"); x.fillStyle = g; x.fillRect(0, 0, w, h); };
    blob(w * 0.12, h * 0.18, Math.max(w, h) * 0.55, "rgba(92,52,190,.20)");
    blob(w * 0.9, h * 0.85, Math.max(w, h) * 0.5, "rgba(255,92,168,.07)");
    blob(w * 0.75, h * 0.1, Math.max(w, h) * 0.35, "rgba(74,216,255,.06)");
    blob(w * 0.3, h * 0.95, Math.max(w, h) * 0.4, "rgba(124,92,255,.08)");
    blob(w * 0.55, h * 0.45, Math.max(w, h) * 0.3, "rgba(255,92,168,.04)");
    blob(w * 0.05, h * 0.6, Math.max(w, h) * 0.25, "rgba(74,216,255,.05)");
    this.wash = c;
    // the moon: a crescent, lit from the right, with a faint ring of atmosphere
    const m = document.createElement("canvas"), R = 150;
    m.width = m.height = R * 2 + 60;
    const mx = m.getContext("2d")!, o = R + 30;
    const halo = mx.createRadialGradient(o, o, R * 0.9, o, o, R + 30); halo.addColorStop(0, "rgba(196,180,255,.18)"); halo.addColorStop(1, "rgba(196,180,255,0)");
    mx.fillStyle = halo; mx.fillRect(0, 0, m.width, m.height);
    mx.save(); mx.beginPath(); mx.arc(o, o, R, 0, Math.PI * 2); mx.clip();
    const lit = mx.createRadialGradient(o + R * 0.55, o - R * 0.25, R * 0.1, o + R * 0.2, o, R * 1.15);
    lit.addColorStop(0, "#d9d0ff"); lit.addColorStop(0.35, "#8a7ed0"); lit.addColorStop(0.7, "#2a2160"); lit.addColorStop(1, "#0a0820");
    mx.fillStyle = lit; mx.fillRect(0, 0, m.width, m.height);
    mx.fillStyle = "#07051a"; mx.beginPath(); mx.arc(o - R * 0.42, o - R * 0.12, R * 1.02, 0, Math.PI * 2); mx.fill();
    // craters on the lit edge
    const g = rng(9);
    for (let k = 0; k < 14; k++) { const a = -1.1 + g() * 2.2, d = R * (0.72 + g() * 0.24); mx.fillStyle = `rgba(40,30,90,${0.15 + g() * 0.2})`; mx.beginPath(); mx.arc(o + Math.cos(a) * d, o + Math.sin(a) * d, 3 + g() * 9, 0, Math.PI * 2); mx.fill(); }
    mx.restore();
    this.moon = m;
    // a ringed gas giant, far off
    const p = document.createElement("canvas"), PR = 120;
    p.width = PR * 5; p.height = PR * 3;
    const px = p.getContext("2d")!, ox = PR * 2.5, oy = PR * 1.5;
    const ring = (back: boolean) => {
      px.save(); px.translate(ox, oy); px.rotate(-0.32); px.scale(1, 0.24);
      px.beginPath(); px.arc(0, 0, PR * 2.1, back ? Math.PI : 0, back ? Math.PI * 2 : Math.PI);
      px.arc(0, 0, PR * 1.45, back ? Math.PI * 2 : Math.PI, back ? Math.PI : 0, true); px.closePath();
      const rg = px.createRadialGradient(0, 0, PR * 1.45, 0, 0, PR * 2.1);
      rg.addColorStop(0, "rgba(255,170,210,.0)"); rg.addColorStop(0.2, "rgba(255,170,210,.35)"); rg.addColorStop(0.55, "rgba(200,170,255,.22)"); rg.addColorStop(0.8, "rgba(255,190,230,.3)"); rg.addColorStop(1, "rgba(255,170,210,0)");
      px.fillStyle = rg; px.fill(); px.restore();
    };
    ring(true);
    px.save(); px.beginPath(); px.arc(ox, oy, PR, 0, Math.PI * 2); px.clip();
    const body = px.createLinearGradient(ox - PR, oy - PR, ox + PR, oy + PR);
    body.addColorStop(0, "#5a2a6e"); body.addColorStop(0.45, "#2a1446"); body.addColorStop(1, "#0a0618");
    px.fillStyle = body; px.fillRect(0, 0, p.width, p.height);
    for (let k = 0; k < 9; k++) { px.fillStyle = k % 2 ? "rgba(255,140,200,.07)" : "rgba(120,90,220,.08)"; px.fillRect(0, oy - PR + k * (PR / 4.5) + Math.sin(k) * 6, p.width, PR / 9); }
    const sh = px.createRadialGradient(ox - PR * 0.5, oy - PR * 0.45, PR * 0.2, ox + PR * 0.2, oy + PR * 0.2, PR * 1.3);
    sh.addColorStop(0, "rgba(0,0,0,0)"); sh.addColorStop(1, "rgba(3,2,10,.85)");
    px.fillStyle = sh; px.fillRect(0, 0, p.width, p.height);
    px.restore();
    ring(false);
    this.planet = p;
  }

  /** Draws the backdrop in CSS px (the context is scaled by dpr); `cx, cy` is the camera centre in world px. */
  draw(c: CanvasRenderingContext2D, w: number, h: number, dpr: number, cx: number, cy: number, zoom: number, t: number, still: boolean) {
    const key = `${w}x${h}@${dpr}`;
    if (key !== this.size || !this.wash) { this.size = key; this.build(w, h, dpr); }
    c.drawImage(this.wash!, 0, 0, w, h);
    const s = Math.min(1.2, 0.55 + zoom * 0.5);
    // the moon drifts a little against the camera
    const mxp = w * 0.14 - cx * zoom * 0.012, myp = h * 0.2 - cy * zoom * 0.012;
    this.eased.x += (this.lean.x - this.eased.x) * 0.06; this.eased.y += (this.lean.y - this.eased.y) * 0.06;
    const lx = still ? 0 : this.eased.x, ly = still ? 0 : this.eased.y;
    c.globalAlpha = 0.95; c.drawImage(this.moon!, mxp - 180 * s - lx * 6, myp - 180 * s - ly * 4, 360 * s, 360 * s); c.globalAlpha = 1;
    const ppx = w * 0.88 - cx * zoom * 0.02 - lx * 10, ppy = h * 0.86 - cy * zoom * 0.02 - ly * 6, ps = 0.55 + zoom * 0.25;
    c.globalAlpha = 0.8; c.drawImage(this.planet!, ppx - 300 * ps, ppy - 180 * ps, 600 * ps, 360 * ps); c.globalAlpha = 1;
    for (const L of this.layers) {
      const ox = -cx * zoom * L.f - lx * L.f * 300, oy = -cy * zoom * L.f - ly * L.f * 200;
      for (const st of L.stars) {
        let x = (st.x + ox) % TILE, y = (st.y + oy) % TILE;
        if (x < 0) x += TILE; if (y < 0) y += TILE;
        const a = still ? st.a : st.a * (0.7 + 0.3 * Math.sin(t * 1.3 + st.tw));
        c.fillStyle = st.hue < 0.12 ? `rgba(255,190,230,${a})` : st.hue < 0.25 ? `rgba(170,230,255,${a})` : `rgba(235,232,255,${a})`;
        for (let gx = x; gx < w; gx += TILE) for (let gy = y; gy < h; gy += TILE) c.fillRect(gx, gy, st.r, st.r);
      }
    }
  }
}
