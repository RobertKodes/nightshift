import { ARCADE, CHAMFER, COFFEE, CHART, DRIVE, FURNACE, L, MARKET, PARTS, PEG, POOL, RADAR, REACTOR, STEPS, type Seat, type SeatKind, W } from "./world";

/**
 * Where the crew can walk: the deck as a grid of quarter tiles. Walls, partitions (but their doorways), desks,
 * consoles and the big machines are solid; chairs are solid to a walker passing by but its own frog gets up out
 * of one. A walk is found with A* on the grid and then pulled straight (the longest straight runs that stay clear),
 * so nobody ever crosses a wall or a desk, and the routes look walked, not stepped.
 */
export type Pt = [number, number];
const R = 4, GW = W * R, GH = L * R;
const FREE = 0, SOFT = 1, HARD = 2;
const S2 = Math.SQRT1_2;
/** How far a frog's body keeps from anything solid, in tiles. */
const BODY = 0.22;

/** A seat's furniture in front of the frog: its centre ahead (d), half width across (hw), half depth (hd). */
const DESK: Partial<Record<SeatKind, [number, number, number]>> = {
  console: [0.22, 0.6, 0.18], control: [0.22, 0.6, 0.18], station: [0.22, 0.62, 0.18], desk: [0.22, 0.64, 0.18],
  bar: [0.24, 0.66, 0.18], table: [0.3, 0.64, 0.28], anvil: [0.22, 0.56, 0.18],
};

export class Nav {
  readonly g = new Uint8Array(GW * GH);
  private gs = new Float32Array(GW * GH);
  private from = new Int32Array(GW * GH);
  private seen = new Uint32Array(GW * GH);
  private done = new Uint32Array(GW * GH);
  private gen = 0;
  private heap = new Int32Array(GW * GH);
  private hf = new Float32Array(GW * GH);

  constructor(seats: readonly Seat[]) {
    const g = this.g;
    const mark = (x0: number, y0: number, x1: number, y1: number, inside: (x: number, y: number) => boolean, v: number) => {
      for (let j = Math.max(0, Math.floor(y0 * R)); j < Math.min(GH, Math.ceil(y1 * R)); j++) for (let i = Math.max(0, Math.floor(x0 * R)); i < Math.min(GW, Math.ceil(x1 * R)); i++) {
        const x = (i + 0.5) / R, y = (j + 0.5) / R, o = j * GW + i;
        if (g[o]! < v && inside(x, y)) g[o] = v;
      }
    };
    const disc = (cx: number, cy: number, r: number, v = HARD) => { const rr = r + BODY; mark(cx - rr, cy - rr, cx + rr, cy + rr, (x, y) => (x - cx) ** 2 + (y - cy) ** 2 < rr * rr, v); };
    /** A box facing the camera: half width along (1, -1), half depth along (1, 1). */
    const obox = (cx: number, cy: number, hw: number, hd: number, v = HARD, m = BODY) => {
      const a = hw + m, b = hd + m, e = (a + b) * S2;
      mark(cx - e, cy - e, cx + e, cy + e, (x, y) => { const dx = x - cx, dy = y - cy; return Math.abs((dx - dy) * S2) < a && Math.abs((dx + dy) * S2) < b; }, v);
    };
    // the hull: walls, the bow's cut corners, the rims
    const m = 0.42;
    mark(0, 0, W, L, (x, y) => x < m || x > W - m || y < m || y > L - m || x + y < CHAMFER + m * 1.4 || W - x + y < CHAMFER + m * 1.4, HARD);
    // the partitions, open at their doors
    for (const p of PARTS) {
      const half = 0.11 + BODY, inDoor = (u: number) => p.doors.some(([a, b]) => u > a + 0.25 && u < b - 0.25);
      if (p.axis === "y") mark(p.from, p.at - half, p.to, p.at + half, (x) => !inDoor(x), HARD);
      else mark(p.at - half, p.from, p.at + half, p.to, (_, y) => !inDoor(y), HARD);
    }
    // the bridge's raised edge: down only by its steps
    mark(0, 19.7, W, STEPS.y1 + 0.15, (x) => !(x > STEPS.x0 + 0.4 && x < STEPS.x1 - 0.4), HARD);
    // the machines
    disc(RADAR.x, RADAR.y, RADAR.r + 0.35);
    disc(REACTOR.x, REACTOR.y, REACTOR.r + 0.1);
    for (const [x, y] of DRIVE) disc(x, y, 1.7);
    disc(PEG.x, PEG.y, 0.7); disc(CHART.x, CHART.y, 0.7);
    obox(COFFEE.x, COFFEE.y, 0.6, 0.35);
    obox(FURNACE.x, FURNACE.y, 1.9, 1.3);
    obox(FURNACE.x + 2.0, FURNACE.y + 2.0, 0.16, 1.0);
    obox(FURNACE.x + 2.3, FURNACE.y + 2.3, 0.75, 0.32);
    // the games corner and the market kiosk
    mark(POOL.x - POOL.hx - BODY, POOL.y - POOL.hy - BODY, POOL.x + POOL.hx + BODY, POOL.y + POOL.hy + BODY, () => true, HARD);
    for (const [x, y] of ARCADE) mark(x - 0.4 - BODY, y - 0.35, x + 0.4 + BODY, y + 0.3 + BODY, () => true, HARD);
    disc(MARKET.x, MARKET.y, 0.42);
    // the seats: chairs are soft (their own frog gets up out of them), what stands in front is solid
    for (const s of seats) {
      const k = s.kind, d = DESK[k];
      if (k === "throne") { disc(s.x, s.y, 0.85, SOFT); continue; }
      if (k === "plinth" || k === "pod") { disc(s.x, s.y, 0.6, SOFT); continue; }
      disc(s.x - 0.1, s.y - 0.1, 0.32, SOFT);
      if (d) obox(s.x + d[0] * S2, s.y + d[0] * S2, d[1], d[2], HARD, BODY * 0.8);
      if (k === "officer" || k === "watch") for (const sg of [-1, 1]) disc(s.x + 0.1 + sg * S2 * 0.5, s.y + 0.1 - sg * S2 * 0.5, 0.08);
    }
  }

  private comp: Uint8Array | null = null;
  /** The deck everyone can reach: the free cells joined to the engine room's floor. */
  private reachMap() {
    if (this.comp) return this.comp;
    const c = new Uint8Array(GW * GH), q: number[] = [];
    const s = this.nearest(16, 71, HARD, 20);
    if (s) { const o = this.cellOf(s[0], s[1]); c[o] = 1; q.push(o); }
    for (let h = 0; h < q.length; h++) {
      const o = q[h]!, i = o % GW, j = Math.floor(o / GW);
      for (const [di, dj] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
        const ni = i + di, nj = j + dj;
        if (ni < 0 || nj < 0 || ni >= GW || nj >= GH) continue;
        const n = nj * GW + ni;
        if (!c[n] && this.g[n] === FREE) { c[n] = 1; q.push(n); }
      }
    }
    return (this.comp = c);
  }
  /** Whether a point is on the deck everyone can reach. */
  reach(x: number, y: number) { const o = this.cellOf(x, y); return o >= 0 && this.reachMap()[o] === 1; }
  /** Every reachable free point (cell centres) in a box, for spawning and wandering. */
  cellsIn(x0: number, y0: number, x1: number, y1: number): Pt[] {
    const out: Pt[] = [], m = this.reachMap();
    for (let j = Math.max(0, Math.ceil(y0 * R)); j < Math.min(GH, Math.floor(y1 * R)); j++) for (let i = Math.max(0, Math.ceil(x0 * R)); i < Math.min(GW, Math.floor(x1 * R)); i++) if (m[j * GW + i]) out.push([(i + 0.5) / R, (j + 0.5) / R]);
    return out;
  }
  private cellOf(x: number, y: number) { const i = Math.floor(x * R), j = Math.floor(y * R); return i < 0 || j < 0 || i >= GW || j >= GH ? -1 : j * GW + i; }
  free(x: number, y: number) { const o = this.cellOf(x, y); return o >= 0 && this.g[o] === FREE; }
  private centre(o: number): Pt { return [((o % GW) + 0.5) / R, (Math.floor(o / GW) + 0.5) / R]; }

  /** Whether the straight line a → b stays on free cells. */
  clear(a: Pt, b: Pt) {
    const d = Math.hypot(b[0] - a[0], b[1] - a[1]), n = Math.max(1, Math.ceil(d / 0.1));
    for (let k = 1; k < n; k++) if (!this.free(a[0] + ((b[0] - a[0]) * k) / n, a[1] + ((b[1] - a[1]) * k) / n)) return false;
    return true;
  }

  /** The nearest free point to (x, y), reached without crossing anything solid (soft cells may be crossed). */
  nearest(x: number, y: number, through = SOFT, max = 12): Pt | null {
    const o0 = this.cellOf(x, y);
    if (o0 < 0) return null;
    if (this.g[o0] === FREE) return [x, y];
    const g = ++this.gen, q = [o0];
    this.seen[o0] = g;
    for (let h = 0; h < q.length && h < 4000; h++) {
      const o = q[h]!, i = o % GW, j = Math.floor(o / GW);
      if (this.g[o] === FREE) return this.centre(o);
      if (Math.max(Math.abs(i - (o0 % GW)), Math.abs(j - Math.floor(o0 / GW))) > max) continue;
      for (const [di, dj] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
        const ni = i + di, nj = j + dj;
        if (ni < 0 || nj < 0 || ni >= GW || nj >= GH) continue;
        const n = nj * GW + ni;
        if (this.seen[n] === g || this.g[n]! > through) continue;
        this.seen[n] = g; q.push(n);
      }
    }
    return null;
  }

  /** Where a seated frog steps to when it gets up: behind its seat, else beside it (never through its desk). */
  exitOf(s: Seat): Pt | null {
    const back: Pt = [s.x - 0.25 * S2, s.y - 0.25 * S2];
    const tries: Pt[] = [[-0.85, -0.85], [-1.2, -1.2], [-0.6, 0.6], [0.6, -0.6], [-1.1, 0.4], [0.4, -1.1], [-0.4, 1.1], [1.1, -0.4]].map(([a, b]) => [s.x + a! * S2 * 1.2, s.y + b! * S2 * 1.2]);
    for (const p of tries) if (this.free(p[0], p[1]) && this.clearSoft(back, p)) return p;
    return this.nearest(back[0], back[1], SOFT, 10);
  }
  /** Like `clear`, but soft cells (chairs) may be crossed. */
  private clearSoft(a: Pt, b: Pt) {
    const d = Math.hypot(b[0] - a[0], b[1] - a[1]), n = Math.max(1, Math.ceil(d / 0.1));
    for (let k = 0; k <= n; k++) { const o = this.cellOf(a[0] + ((b[0] - a[0]) * k) / n, a[1] + ((b[1] - a[1]) * k) / n); if (o < 0 || this.g[o] === HARD) return false; }
    return true;
  }

  /** A walk from free point a to free point b: corners only, or null when there is none. */
  path(a: Pt, b: Pt): Pt[] | null {
    const s = this.cellOf(a[0], a[1]), t = this.cellOf(b[0], b[1]);
    if (s < 0 || t < 0 || this.g[s] !== FREE || this.g[t] !== FREE) return null;
    if (this.clear(a, b)) return [a, b];
    const gen = ++this.gen, gs = this.gs, from = this.from, seen = this.seen, heap = this.heap, hf = this.hf;
    const ti = t % GW, tj = Math.floor(t / GW);
    const h = (o: number) => { const dx = Math.abs((o % GW) - ti), dy = Math.abs(Math.floor(o / GW) - tj); return dx + dy + (Math.SQRT2 - 2) * Math.min(dx, dy); };
    let n = 0;
    const push = (o: number, f: number) => { let i = n++; while (i > 0) { const p = (i - 1) >> 1; if (hf[p]! <= f) break; heap[i] = heap[p]!; hf[i] = hf[p]!; i = p; } heap[i] = o; hf[i] = f; };
    const pop = () => {
      const top = heap[0]!, lo = heap[--n]!, lf = hf[n]!;
      let i = 0;
      for (;;) { let c = 2 * i + 1; if (c >= n) break; if (c + 1 < n && hf[c + 1]! < hf[c]!) c++; if (hf[c]! >= lf) break; heap[i] = heap[c]!; hf[i] = hf[c]!; i = c; }
      heap[i] = lo; hf[i] = lf;
      return top;
    };
    seen[s] = gen; gs[s] = 0; from[s] = -1; push(s, h(s));
    let found = false, steps = 0;
    while (n > 0 && steps++ < 200000) {
      const o = pop();
      if (o === t) { found = true; break; }
      if (this.done[o] === gen) continue;
      this.done[o] = gen;
      const i = o % GW, j = Math.floor(o / GW), go = gs[o]!;
      for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) {
        if (!di && !dj) continue;
        const ni = i + di, nj = j + dj;
        if (ni < 0 || nj < 0 || ni >= GW || nj >= GH) continue;
        const q = nj * GW + ni;
        if (this.g[q] !== FREE) continue;
        if (di && dj && (this.g[j * GW + ni] !== FREE || this.g[nj * GW + i] !== FREE)) continue;
        const ng = go + (di && dj ? Math.SQRT2 : 1);
        if (seen[q] === gen && gs[q]! <= ng) continue;
        seen[q] = gen; gs[q] = ng; from[q] = o; push(q, ng + h(q));
      }
    }
    if (!found) return null;
    const cells: number[] = [];
    for (let o = t; o >= 0; o = from[o]!) cells.push(o);
    cells.reverse();
    // pulled straight: from each corner, the farthest cell still in a clear line
    const pts: Pt[] = cells.map((o) => this.centre(o));
    pts[0] = a; pts[pts.length - 1] = b;
    const out: Pt[] = [a];
    let i = 0;
    while (i < pts.length - 1) {
      let j = i + 1;
      while (j + 1 < pts.length && this.clear(pts[i]!, pts[j + 1]!)) j++;
      out.push(pts[j]!); i = j;
    }
    return out;
  }
}
