import * as THREE from "three";
import { type BallsDesign, type ClothDesign, type CueDesign, ITEMS, type TableDesign } from "./catalog";
import { type Aim, type Ball, CONTACT, EV, type Frame, HEAD_Y, JAWS, L, LINES, POCKETED, POCKETS, R, Replay, STILL, W, aimAt, duration, simulate, sincos } from "./physics";
import { CUE_LENGTH, ballMaterial, canvas, clothTexture, cueModel, woodTexture } from "./art";

/**
 * The NIGHT POOL table in three.js: PBR felt with its nap and sheen, lacquered wood rails, metal
 * pocket castings, leather-lined pockets, lacquered balls that reflect the lamp, soft shadows from
 * the lamp over the table (blob shadows in lite), the cue, the aim guide and the replay of the
 * server's keyframes. Table coordinates are the physics' (x across, y along, metres); in the scene
 * X = x − W/2, Z = L/2 − y, Y up, so the head rail (where the breaker stands) is nearest the camera.
 */
export const CW = 0.0508, FW = 0.11, RAIL_H = 0.64 * 2 * R;
const TOP = RAIL_H + 0.006;
const sx = (x: number) => x - W / 2, sz = (y: number) => L / 2 - y;
export type Look = { cloth: string; table: string; balls: string; cue: string };
/** The guide to draw: the aim, the cue ball, the guide's length (a share of the standard one), the shooter's balls, and the stroke (spin, elevation and power bend the cue ball's path). */
export type Guide = { aim: number; cue: { x: number; y: number }; length: number; targets: number[]; stroke?: { power: number; spinX: number; spinY: number; elevation: number } } | null;
/** The camera: straight down (8 Ball Pool's view), tilted (3D), behind the cue, or on the cue itself (the locker). */
export type View = "top" | "tilt" | "aim" | "cue";
type Bent = { pre: THREE.Vector3[]; post: THREE.Vector3[]; obj: THREE.Vector3[]; ghost: { x: number; y: number } | null; hit: boolean };
type BallMesh = { mesh: THREE.Mesh; shadow: THREE.Mesh | null; id: number; sunk: number | null; drop: { from: THREE.Vector3; to: THREE.Vector3; at: number } | null };
export type ShotEvent = { kind: number; a: number; b: number; speed: number };

const design = <T,>(id: string, fallback: string) => (ITEMS.get(id)?.design ?? ITEMS.get(fallback)!.design) as T;
/** The pocket's mouth: where to aim and where its marker glows, a little in from the centre toward the cloth. */
export function mouth(k: number): { x: number; y: number } {
  const [px, py] = POCKETS[k]!, d = Math.hypot(W / 2 - px, L / 2 - py);
  return { x: px + (W / 2 - px) / d * 0.035, y: py + (L / 2 - py) / d * 0.035 };
}

export class PoolScene {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.PerspectiveCamera(32, 1, 0.05, 40);
  private table = new THREE.Group();
  private ballGroup = new THREE.Group();
  private guide = new THREE.Group();
  private marks = new THREE.Group();
  private balls = new Map<number, BallMesh>();
  private cue: THREE.Group | null = null;
  private cueId = "";
  private look: Look = { cloth: "cloth-night", table: "table-shift", balls: "balls-classic", cue: "cue-crew" };
  private raf = 0;
  private dirty = true;
  private replay: { rp: Replay; frames: Frame[]; next: number; t: number; rate: number; end: number; onEvent: (e: ShotEvent) => void; done: () => void; last: number } | null = null;
  private observer: ResizeObserver;
  private disposed = false;
  private view: View = "top";
  private aimCam = { aim: 90000, cue: { x: W / 2, y: L / 4 } };
  private kitchen: THREE.Mesh;
  private pulse: THREE.Mesh[] = [];
  private shadowTex: THREE.Texture | null = null;
  private clock = 0;
  readonly lite: boolean;
  constructor(private host: HTMLElement, o: { lite: boolean; pixelRatio: number }) {
    this.lite = o.lite;
    this.renderer = new THREE.WebGLRenderer({ antialias: !o.lite, alpha: true, powerPreference: "high-performance" });
    this.renderer.setPixelRatio(o.pixelRatio);
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping; this.renderer.toneMappingExposure = 1;
    this.renderer.shadowMap.enabled = !o.lite; this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.setClearColor(0x000000, 0);
    this.renderer.domElement.style.touchAction = "none";
    this.renderer.domElement.setAttribute("aria-hidden", "true");
    host.appendChild(this.renderer.domElement);
    this.environment();
    this.lights();
    this.scene.add(this.table, this.ballGroup, this.guide, this.marks);
    this.kitchen = new THREE.Mesh(new THREE.PlaneGeometry(W, HEAD_Y), new THREE.MeshBasicMaterial({ color: 0x7c5cff, transparent: true, opacity: 0.1, depthWrite: false }));
    this.kitchen.rotation.x = -Math.PI / 2; this.kitchen.position.set(0, 0.0012, sz(HEAD_Y / 2)); this.kitchen.visible = false;
    this.scene.add(this.kitchen);
    this.build();
    this.observer = new ResizeObserver(() => this.resize()); this.observer.observe(host);
    this.resize();
    this.loop();
  }

  // ---- building the room and the table

  private environment() {
    // the room the balls reflect: a dark hall, the lamp's bright panel above, violet glow at the sides
    const [c, g] = canvas(1024, 512);
    const sky = g.createLinearGradient(0, 0, 0, 512); sky.addColorStop(0, "#1a1236"); sky.addColorStop(0.5, "#07051a"); sky.addColorStop(1, "#020108");
    g.fillStyle = sky; g.fillRect(0, 0, 1024, 512);
    g.fillStyle = "#fff6e8"; g.fillRect(380, 18, 264, 60);
    g.fillStyle = "#7c5cff"; g.fillRect(40, 190, 120, 140); g.fillRect(860, 180, 130, 150);
    g.fillStyle = "#b8ff4a"; g.fillRect(610, 260, 40, 20);
    const t = new THREE.CanvasTexture(c); t.mapping = THREE.EquirectangularReflectionMapping; t.colorSpace = THREE.SRGBColorSpace;
    const pmrem = new THREE.PMREMGenerator(this.renderer);
    this.scene.environment = pmrem.fromEquirectangular(t).texture;
    pmrem.dispose(); t.dispose();
  }
  private lights() {
    this.scene.add(new THREE.HemisphereLight(0xe9e2ff, 0x140b2a, 0.3));
    const lamp = new THREE.SpotLight(0xfff3e2, 7.5, 5, 0.85, 0.75, 1.2);
    lamp.position.set(0, 1.55, 0.1); lamp.target.position.set(0, 0, 0);
    lamp.castShadow = !this.lite;
    lamp.shadow.mapSize.set(2048, 2048); lamp.shadow.bias = -0.0002; lamp.shadow.normalBias = 0.01; lamp.shadow.radius = 6; lamp.shadow.camera.near = 0.5; lamp.shadow.camera.far = 3;
    this.scene.add(lamp, lamp.target);
    const fill = new THREE.DirectionalLight(0x9c84ff, 0.35); fill.position.set(-2, 1.2, -1.5); this.scene.add(fill);
    const warm = new THREE.DirectionalLight(0xffd9b0, 0.2); warm.position.set(1.5, 2, 2); this.scene.add(warm);
  }
  private clear(g: THREE.Group) {
    for (const o of [...g.children]) { g.remove(o); o.traverse((x) => { const m = x as THREE.Mesh; if (m.isMesh) { m.geometry.dispose(); for (const mat of [m.material].flat()) { const st = mat as THREE.MeshStandardMaterial; st.map?.dispose(); st.bumpMap?.dispose(); mat.dispose(); } } }); }
  }
  /** The cloth, cushions, rails, pockets and sights for the current look. */
  private build() {
    this.clear(this.table);
    const cloth = design<ClothDesign>(this.look.cloth, "cloth-night"), td = design<TableDesign>(this.look.table, "table-shift");
    const { map, bump } = clothTexture(cloth, this.lite ? 1024 : 2048);
    const felt = this.lite ? new THREE.MeshStandardMaterial({ map, roughness: 0.92 })
      : new THREE.MeshPhysicalMaterial({ map, bumpMap: bump, bumpScale: 0.35, roughness: 0.9, sheen: 1, sheenColor: new THREE.Color(cloth.sheen), sheenRoughness: 0.75 });
    const bed = new THREE.Mesh(new THREE.PlaneGeometry(W + 2 * CW, L + 2 * CW), felt);
    bed.rotation.x = -Math.PI / 2; bed.receiveShadow = true;
    this.table.add(bed);
    // cushions: six rubber pieces, each a rail between its two jaw faces, and the rounded jaw tips
    const cushionMat = this.lite ? new THREE.MeshStandardMaterial({ color: cloth.color, roughness: 0.9 }) : new THREE.MeshPhysicalMaterial({ color: cloth.color, roughness: 0.88, sheen: 1, sheenColor: new THREE.Color(cloth.sheen), sheenRoughness: 0.7 });
    const pieces: [number, number, number][] = [[0, 17, 16], [1, 2, 3], [4, 5, 6], [7, 8, 9], [10, 11, 12], [13, 14, 15]];
    for (const [ja, rail, jb] of pieces) {
      const A = LINES[ja]!, M = LINES[rail]!, B = LINES[jb]!;
      const pts = [[A[0], A[1]], [A[2], A[3]], [M[0], M[1]], [M[2], M[3]], [B[2], B[3]], [B[0], B[1]]];
      const shape = new THREE.Shape(pts.map(([x, y]) => new THREE.Vector2(sx(x!), -sz(y!))));
      const geo = new THREE.ExtrudeGeometry(shape, { depth: RAIL_H, bevelEnabled: !this.lite, bevelThickness: 0.003, bevelSize: 0.002, bevelSegments: 2 });
      geo.rotateX(-Math.PI / 2);
      const m = new THREE.Mesh(geo, cushionMat); m.castShadow = !this.lite; m.receiveShadow = true;
      this.table.add(m);
    }
    for (const [x, y, r] of JAWS) { const tip = new THREE.Mesh(new THREE.CylinderGeometry(r, r, RAIL_H, 20), cushionMat); tip.position.set(sx(x), RAIL_H / 2, sz(y)); this.table.add(tip); }
    // the wooden rails between the pockets, and the apron under them
    const wood = this.lite ? new THREE.MeshStandardMaterial({ map: woodTexture(td), roughness: 0.45 }) : new THREE.MeshPhysicalMaterial({ map: woodTexture(td), roughness: 0.42, clearcoat: td.gloss, clearcoatRoughness: 0.12 });
    const box = (x0: number, x1: number, y0: number, y1: number, top = TOP, bottom = -0.05, mat: THREE.Material = wood) => {
      const m = new THREE.Mesh(new THREE.BoxGeometry(Math.abs(x1 - x0), top - bottom, Math.abs(y1 - y0)), mat);
      m.position.set(sx((x0 + x1) / 2), (top + bottom) / 2, sz((y0 + y1) / 2)); m.castShadow = !this.lite; m.receiveShadow = true; this.table.add(m); return m;
    };
    const o = CW + FW, pc = 0.115, ps = 0.075;
    box(pc, W - pc, -o, -CW); box(pc, W - pc, L + CW, L + o);
    for (const [x0, x1] of [[-o, -CW], [W + CW, W + o]] as const) { box(x0, x1, pc, L / 2 - ps); box(x0, x1, L / 2 + ps, L - pc); }
    const apron = new THREE.MeshStandardMaterial({ color: new THREE.Color(td.rail).multiplyScalar(0.75), roughness: 0.6 });
    box(-o, W + o, -o, L + o, -0.05, -0.2, apron);
    // a soft pool of shadow on the floor under the table
    const [fc, fg] = canvas(256, 256), grad = fg.createRadialGradient(128, 128, 20, 128, 128, 128);
    grad.addColorStop(0, "rgba(0,0,0,.75)"); grad.addColorStop(1, "rgba(0,0,0,0)"); fg.fillStyle = grad; fg.fillRect(0, 0, 256, 256);
    const floor = new THREE.Mesh(new THREE.PlaneGeometry((W + 2 * o) * 1.7, (L + 2 * o) * 1.4), new THREE.MeshBasicMaterial({ map: new THREE.CanvasTexture(fc), transparent: true, depthWrite: false }));
    floor.rotation.x = -Math.PI / 2; floor.position.y = -0.45; this.table.add(floor);
    // metal castings round each pocket, cut out where the pocket is
    const metal = new THREE.MeshStandardMaterial({ color: new THREE.Color(td.metal).multiplyScalar(0.72), metalness: 1, roughness: 0.36, envMapIntensity: 0.75, side: THREE.DoubleSide });
    const castings: { shape: THREE.Shape }[] = [];
    POCKETS.forEach(([cx, cy, r], k) => {
      const side = k === 1 || k === 4, s = new THREE.Shape(), P = (x: number, y: number) => new THREE.Vector2(sx(x), -sz(y));
      const left = cx < W / 2, low = cy < L / 2, ox = left ? -o : W + o, ix = left ? -CW : W + CW, rr = r + 0.004;
      // the arc round the pocket on the side away from the cloth
      const arc = (from: number, to: number, outX: number, outY: number, steps: number) => {
        let sweep = to - from;
        while (sweep > Math.PI * 2) sweep -= Math.PI * 2;
        while (sweep < -Math.PI * 2) sweep += Math.PI * 2;
        const mid = from + sweep / 2;
        if (Math.cos(mid) * outX + Math.sin(mid) * outY < 0) sweep = sweep > 0 ? sweep - Math.PI * 2 : sweep + Math.PI * 2;
        for (let i = 1; i <= steps; i++) { const ang = from + sweep * (i / steps), p = P(cx + rr * Math.cos(ang), cy + rr * Math.sin(ang)); s.lineTo(p.x, p.y); }
      };
      const line = (pts: THREE.Vector2[]) => { for (const p of pts) s.lineTo(p.x, p.y); };
      if (side) {
        const dy = Math.sqrt(rr * rr - (ix - cx) * (ix - cx)), start = P(ox, cy - ps);
        s.moveTo(start.x, start.y); line([P(ix, cy - ps), P(ix, cy - dy)]);
        arc(Math.atan2(-dy, ix - cx), Math.atan2(dy, ix - cx), left ? -1 : 1, 0, 28);
        line([P(ix, cy + ps), P(ox, cy + ps)]); s.closePath();
      } else {
        const iy = low ? -CW : L + CW, oy = low ? -o : L + o, ex = left ? pc : W - pc, ey = low ? pc : L - pc;
        const hx = Math.sqrt(rr * rr - (iy - cy) * (iy - cy)), hy = Math.sqrt(rr * rr - (ix - cx) * (ix - cx));
        const ax = cx + (left ? hx : -hx), ay = cy + (low ? hy : -hy), start = P(ox, oy);
        s.moveTo(start.x, start.y); line([P(ex, oy), P(ex, iy), P(ax, iy)]);
        arc(Math.atan2(iy - cy, ax - cx), Math.atan2(ay - cy, ix - cx), left ? -1 : 1, low ? -1 : 1, 32);
        line([P(ix, ey), P(ox, ey)]); s.closePath();
      }
      castings.push({ shape: s });
      // the pocket itself: a leather throat going down, a dark net at the bottom
      const throat = new THREE.Mesh(new THREE.CylinderGeometry(r, r * 0.9, 0.12, 28, 1, true), new THREE.MeshStandardMaterial({ color: 0x0c0810, roughness: 0.9, side: THREE.DoubleSide }));
      throat.position.set(sx(cx), RAIL_H - 0.06, sz(cy)); this.table.add(throat);
      const hole = new THREE.Mesh(new THREE.CircleGeometry(r, 28), new THREE.MeshBasicMaterial({ color: 0x020104 }));
      hole.rotation.x = -Math.PI / 2; hole.position.set(sx(cx), 0.0008, sz(cy)); this.table.add(hole);
    });
    for (const c of castings) {
      const geo = new THREE.ExtrudeGeometry(c.shape, { depth: 0.008, bevelEnabled: !this.lite, bevelThickness: 0.002, bevelSize: 0.002, bevelSegments: 2 });
      geo.rotateX(-Math.PI / 2); geo.translate(0, TOP - 0.004, 0);
      const m = new THREE.Mesh(geo, metal); m.castShadow = !this.lite; this.table.add(m);
    }
    // the sights: three between each pair of pockets
    const sight = new THREE.MeshStandardMaterial({ color: td.diamonds, emissive: new THREE.Color(td.diamonds), emissiveIntensity: 0.35, roughness: 0.3 });
    const dot = (x: number, y: number) => { const m = new THREE.Mesh(new THREE.CircleGeometry(0.0075, 4), sight); m.rotation.x = -Math.PI / 2; m.position.set(sx(x), TOP + 0.0005, sz(y)); this.table.add(m); };
    const mid = CW + FW / 2;
    for (const f of [0.25, 0.5, 0.75]) { dot(W * f, -mid); dot(W * f, L + mid); }
    for (const f of [0.125, 0.25, 0.375, 0.625, 0.75, 0.875]) { dot(-mid, L * f); dot(W + mid, L * f); }
    if (td.glow) {
      const glow = new THREE.MeshBasicMaterial({ color: td.glow, transparent: true, opacity: 0.85 });
      for (const [w, d, x, z] of [[W + 2 * o, 0.006, 0, sz(-o)], [W + 2 * o, 0.006, 0, sz(L + o)], [0.006, L + 2 * o, sx(-o), 0], [0.006, L + 2 * o, sx(W + o), 0]] as const) {
        const m = new THREE.Mesh(new THREE.BoxGeometry(w, 0.008, d), glow); m.position.set(x, -0.055, z); this.table.add(m);
      }
    }
    if (td.claws) {
      const gold = new THREE.MeshStandardMaterial({ color: td.metal, metalness: 1, roughness: 0.25 });
      for (const [x, y] of [[-o, -o], [W + o, -o], [-o, L + o], [W + o, L + o]] as const) for (let i = 0; i < 3; i++) {
        const claw = new THREE.Mesh(new THREE.ConeGeometry(0.012, 0.06, 10), gold);
        claw.position.set(sx(x) + (i - 1) * 0.02 * (x < 0 ? 1 : -1), -0.12, sz(y)); claw.rotation.z = (i - 1) * 0.4; this.table.add(claw);
      }
    }
    this.dirty = true;
  }
  /** The table's look (the host's cloth, frame and ball set) and the shooter's cue. */
  setLook(next: Partial<Look>) {
    const before = this.look;
    this.look = { ...this.look, ...next };
    if (before.cloth !== this.look.cloth || before.table !== this.look.table) this.build();
    if (before.balls !== this.look.balls) { for (const b of this.balls.values()) { this.ballGroup.remove(b.mesh); if (b.shadow) this.ballGroup.remove(b.shadow); } this.balls.clear(); }
    if (this.cueId !== this.look.cue) this.makeCue();
    this.dirty = true;
  }
  private makeCue() {
    if (this.cue) { this.scene.remove(this.cue); this.cue.traverse((x) => { const m = x as THREE.Mesh; if (m.isMesh) { m.geometry.dispose(); (m.material as THREE.Material).dispose(); } }); }
    this.cueId = this.look.cue;
    this.cue = cueModel(design<CueDesign>(this.look.cue, "cue-crew"), this.lite);
    this.cue.visible = false;
    this.scene.add(this.cue);
  }

  // ---- balls

  private ballMesh(id: number): BallMesh {
    let b = this.balls.get(id);
    if (b) return b;
    const set = design<BallsDesign>(this.look.balls, "balls-classic");
    const mesh = new THREE.Mesh(new THREE.SphereGeometry(R, this.lite ? 24 : 40, this.lite ? 16 : 28), ballMaterial(id, set, this.lite));
    mesh.castShadow = !this.lite;
    // a little turn so the numbers do not all face the same way
    mesh.rotation.set(id * 0.7, id * 1.3, id * 0.4);
    let shadow: THREE.Mesh | null = null;
    if (this.lite) {
      if (!this.shadowTex) {
        const [c, g] = canvas(64, 64), grad = g.createRadialGradient(32, 32, 4, 32, 32, 32);
        grad.addColorStop(0, "rgba(0,0,0,.6)"); grad.addColorStop(1, "rgba(0,0,0,0)"); g.fillStyle = grad; g.fillRect(0, 0, 64, 64);
        this.shadowTex = new THREE.CanvasTexture(c);
      }
      shadow = new THREE.Mesh(new THREE.PlaneGeometry(R * 3, R * 3), new THREE.MeshBasicMaterial({ map: this.shadowTex, transparent: true, depthWrite: false }));
      shadow.rotation.x = -Math.PI / 2; this.ballGroup.add(shadow);
    }
    this.ballGroup.add(mesh);
    b = { mesh, shadow, id, sunk: null, drop: null };
    this.balls.set(id, b);
    return b;
  }
  private place(b: BallMesh, x: number, y: number, h = R) {
    b.mesh.position.set(sx(x), h, sz(y));
    if (b.shadow) { b.shadow.position.set(sx(x) + 0.006, 0.0011, sz(y) + 0.008); b.shadow.visible = h > -0.01 && b.mesh.visible; }
  }
  /** Every ball where it rests (no animation). */
  setBalls(balls: readonly Ball[]) {
    if (this.replay) return;
    for (const ball of balls) {
      const b = this.ballMesh(ball.id);
      b.drop = null;
      b.mesh.visible = ball.s !== POCKETED; b.mesh.scale.setScalar(1);
      this.place(b, ball.x, ball.y);
    }
    this.dirty = true;
  }
  /** Only the cue ball, while it is placed by hand. */
  moveCueBall(x: number, y: number, ok: boolean) {
    const b = this.ballMesh(0);
    b.mesh.visible = true; this.place(b, x, y);
    (b.mesh.material as THREE.MeshStandardMaterial).emissive = new THREE.Color(ok ? 0x000000 : 0x661020);
    this.dirty = true;
  }
  /**
   * Replays a shot from its keyframes, as the server simulated it: positions and spins from the
   * closed-form motion between keyframes, the balls rolling with their spin, dropping into
   * pockets. `rate` speeds a long tail up; `onEvent` hears each collision (sounds, haptics).
   */
  play(start: readonly Ball[], frames: readonly Frame[], o: { rate: number; onEvent: (e: ShotEvent) => void }): Promise<void> {
    this.cancelReplay();
    this.setBalls(start);
    const rp = new Replay(start, frames);
    const end = frames.length ? frames[frames.length - 1]!.t : 0;
    return new Promise((done) => { this.replay = { rp, frames: [...frames], next: 0, t: 0, rate: o.rate, end, onEvent: o.onEvent, done, last: performance.now() }; this.dirty = true; });
  }
  cancelReplay() { if (this.replay) { const d = this.replay.done; this.replay = null; d(); } }
  get replaying() { return !!this.replay; }
  private stepReplay(now: number) {
    const r = this.replay!;
    // the replay keeps to the clock on a slow device too (the next turn starts by the server's clock), only a long stall is cut
    const dt = Math.min(0.25, (now - r.last) / 1000);
    r.last = now;
    r.t = Math.min(r.end, r.t + dt * r.rate);
    while (r.next < r.frames.length && r.frames[r.next]!.t <= r.t) {
      const f = r.frames[r.next++]!;
      const speed = Math.max(0, ...f.balls.map((b) => Math.hypot(b.vx, b.vy)));
      if (f.k === EV.POCKET) {
        const b = this.ballMesh(f.a), [px, py] = POCKETS[f.b]!;
        b.drop = { from: b.mesh.position.clone(), to: new THREE.Vector3(sx(px), -0.05, sz(py)), at: r.t };
      }
      r.onEvent({ kind: f.k, a: f.a, b: f.b, speed });
    }
    const balls = r.rp.at(r.t);
    for (const s of balls) {
      const b = this.ballMesh(s.id);
      if (b.drop) {
        const k = Math.min(1, (r.t - b.drop.at) / 0.22);
        b.mesh.position.lerpVectors(b.drop.from, b.drop.to, k);
        b.mesh.scale.setScalar(1 - 0.35 * k);
        if (b.shadow) b.shadow.visible = false;
        if (k >= 1) b.mesh.visible = false;
        continue;
      }
      if (s.s === POCKETED) { b.mesh.visible = false; if (b.shadow) b.shadow.visible = false; continue; }
      b.mesh.visible = true;
      this.place(b, s.x, s.y);
      // the ball turns with its spin: table (x, y, z up) to scene (X, Y up, −Z)
      const w = new THREE.Vector3(s.wx, s.wz, -s.wy), mag = w.length();
      if (mag > 1e-6) b.mesh.quaternion.premultiply(new THREE.Quaternion().setFromAxisAngle(w.normalize(), mag * dt * r.rate));
    }
    if (r.t >= r.end) { const done = r.done; this.replay = null; done(); }
    this.dirty = true;
  }

  // ---- the cue, the guide, the marks

  /** The cue behind the cue ball along the aim, pulled back with the power, tilted by the elevation. */
  showCue(cue: { x: number; y: number } | null, aim: number, pull: number, elevation: number) {
    if (!this.cue) this.makeCue();
    const c = this.cue!;
    if (!cue) { if (c.visible) { c.visible = false; this.dirty = true; } return; }
    const [s, co] = sincos(aim), dir = new THREE.Vector3(co, 0, -s);
    const tilt = Math.max(4, elevation / 1000) * Math.PI / 180;
    const back = R + 0.012 + pull * 0.24;
    const tipPos = new THREE.Vector3(sx(cue.x), R + Math.sin(tilt) * back * 0.15, sz(cue.y)).addScaledVector(dir, -back);
    // the cue's +y axis points from the tip to the butt: away from the ball, raised by the tilt
    const axis = dir.clone().multiplyScalar(-Math.cos(tilt)).add(new THREE.Vector3(0, Math.sin(tilt), 0)).normalize();
    c.position.copy(tipPos);
    c.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), axis);
    c.visible = true;
    this.dirty = true;
  }
  private ribbon(from: THREE.Vector3, to: THREE.Vector3, width: number, color: number, opacity: number) { this.strip([from, to], width, color, opacity); }
  /** A flat line on the cloth through these points (scene coordinates), as one triangle strip. */
  private strip(pts: THREE.Vector3[], width: number, color: number, opacity: number) {
    if (pts.length < 2) return;
    const pos: number[] = [], idx: number[] = [], h = width / 2;
    for (let i = 0; i < pts.length; i++) {
      const a = pts[Math.max(0, i - 1)]!, b = pts[Math.min(pts.length - 1, i + 1)]!, p = pts[i]!;
      let dx = b.x - a.x, dz = b.z - a.z;
      const d = Math.hypot(dx, dz) || 1; dx /= d; dz /= d;
      pos.push(p.x - dz * h, 0.0025, p.z + dx * h, p.x + dz * h, 0.0025, p.z - dx * h);
      if (i) { const k = 2 * i; idx.push(k - 2, k - 1, k, k - 1, k + 1, k); }
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3)); geo.setIndex(idx);
    const m = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ color, transparent: true, opacity, depthWrite: false, side: THREE.DoubleSide }));
    m.renderOrder = 3;
    this.guide.add(m);
  }
  private ring(x: number, y: number, r0: number, r1: number, color: number, opacity: number, h = 0.002) {
    const m = new THREE.Mesh(new THREE.RingGeometry(r0, r1, 40), new THREE.MeshBasicMaterial({ color, transparent: true, opacity, depthWrite: false, side: THREE.DoubleSide }));
    m.rotation.x = -Math.PI / 2; m.position.set(sx(x), h, sz(y)); m.renderOrder = 3;
    return m;
  }
  private bent: { key: string; out: Bent | null } = { key: "", out: null };
  /**
   * The paths the stroke really gives, from the physics the server plays, with only the cue ball
   * and the first ball on its line on the table and every path cut short: the cue ball to the
   * contact (squirt and swerve from english and elevation), then the object ball (throw) and the
   * cue ball after it (follow and draw bend it), or the cue ball off the first cushion (english
   * widens or narrows the bounce). Before the bar is pulled, the stroke is a medium one.
   */
  private bend(balls: readonly Ball[], g: NonNullable<Guide>, a: Aim, objLen: number, cueLen: number): Bent | null {
    const st = g.stroke!, ob = a.hit?.kind === "ball" ? balls.find((b) => b.id === (a.hit as { id: number }).id) : undefined;
    const key = [g.aim, g.cue.x, g.cue.y, st.power, st.spinX, st.spinY, st.elevation, ob?.id ?? -1, ob?.x, ob?.y, objLen, cueLen, g.length].join("|");
    if (this.bent.key === key) return this.bent.out;
    let out: Bent | null = null;
    try {
      const rest = (b: Ball, x: number, y: number): Ball => ({ ...b, x, y, vx: 0, vy: 0, wx: 0, wy: 0, wz: 0, s: STILL });
      const cue = rest({ id: 0 } as Ball, g.cue.x, g.cue.y), start = ob ? [cue, rest(ob, ob.x, ob.y)] : [cue];
      const res = simulate(start, { aim: g.aim, power: Math.max(st.power, 450), spinX: st.spinX, spinY: st.spinY, elevation: st.elevation });
      const hit = res.frames.find((f) => f.k === EV.BALL), bounce = res.frames.find((f) => (f.k === EV.RAIL || f.k === EV.JAW) && f.a === 0);
      const turn = hit?.t ?? bounce?.t ?? Infinity, end = res.duration, rp = new Replay(start, res.frames);
      const preMax = hit || bounce ? Infinity : 0.9 * g.length, postMax = hit ? cueLen : 0.16 * g.length;
      const v = (b: Ball) => new THREE.Vector3(sx(b.x), 0, sz(b.y));
      const pre = [v(cue)], post: THREE.Vector3[] = [], obj: THREE.Vector3[] = [];
      let t = 0, preLen = 0, cueAfter = 0, objAfter = 0, pc = cue, po = start[1], ghost: { x: number; y: number } | null = null;
      if (Number.isFinite(turn)) {
        const at = rp.at(turn), c = at.find((b) => b.id === 0)!, o = ob ? at.find((b) => b.id === ob.id) : undefined;
        if (hit) ghost = { x: c.x, y: c.y };
        post.push(v(c)); if (o && hit) obj.push(v(o));
      }
      for (let i = 0; t < end && i < 3000; i++) {
        const next = Math.min(end, t + 0.004), crossing = t < turn && next > turn;
        t = next;
        const now = rp.at(t), c = now.find((b) => b.id === 0)!, o = ob ? now.find((b) => b.id === ob.id) : undefined;
        if (crossing) { const at = rp.at(turn); pc = at.find((b) => b.id === 0)!; po = ob ? at.find((b) => b.id === ob.id) : undefined; }
        if (c.s !== POCKETED) {
          const d = Math.hypot(c.x - pc.x, c.y - pc.y);
          if (t <= turn) { preLen += d; if (preLen <= preMax) pre.push(v(c)); }
          else if (cueAfter < postMax) { cueAfter += d; post.push(v(c)); }
          pc = c;
        }
        if (o && hit && t > turn && o.s !== POCKETED && objAfter < objLen) { objAfter += Math.hypot(o.x - po!.x, o.y - po!.y); obj.push(v(o)); }
        if (o) po = o;
        const cueDone = c.s === POCKETED || (t > turn && cueAfter >= postMax) || (!Number.isFinite(turn) && preLen > preMax);
        if (cueDone && (!hit || !o || o.s === POCKETED || objAfter >= objLen)) break;
      }
      if (ghost) pre.push(new THREE.Vector3(sx(ghost.x), 0, sz(ghost.y)));
      else if (bounce && post.length) pre.push(post[0]!.clone());
      out = { pre, post, obj, ghost, hit: !!hit };
    } catch { out = null; }
    this.bent = { key, out };
    return out;
  }
  /**
   * The aim guide, 8 Ball Pool style: a line to the ghost ball, the ghost ball, and short lines for
   * where the object ball and the cue ball head (their length a share of the standard one: `length`).
   * With the stroke, the lines are the physics' own: english, follow, draw and elevation bend them.
   */
  showGuide(balls: readonly Ball[], g: Guide): Aim | null {
    this.clear(this.guide);
    this.dirty = true;
    if (!g) return null;
    // the cue ball where it is placed (in hand after a scratch it is still "pocketed" in the rack)
    const a = aimAt(balls.map((b) => (b.id === 0 ? { ...b, x: g.cue.x, y: g.cue.y, s: 0 } : b)), g.aim);
    const from = new THREE.Vector3(sx(g.cue.x), 0, sz(g.cue.y)), ghost = new THREE.Vector3(sx(a.ghost.x), 0, sz(a.ghost.y));
    const dir = ghost.clone().sub(from).normalize(), start = from.clone().addScaledVector(dir, R);
    const target = a.hit?.kind === "ball" ? balls.find((b) => b.id === (a.hit as { id: number }).id) : undefined;
    const ok = !!target && g.targets.includes(target.id);
    const cut = a.object ? Math.abs(a.object.x * dir.x - a.object.y * dir.z) : 0;
    const objLen = (0.07 + 0.25 * cut) * g.length, cueLen = (0.05 + 0.2 * Math.sqrt(Math.max(0, 1 - cut * cut))) * g.length;
    if (target && !ok) this.guide.add(this.ring(target.x, target.y, R + 0.002, R + 0.006, 0xff5c7a, 0.85));
    const bent = g.stroke ? this.bend(balls, g, a, objLen, cueLen) : null;
    if (bent && bent.pre.length > 1) {
      // the line leaves the cue ball's edge and stops at the ghost ball's
      const pre = bent.pre.filter((p) => p.distanceTo(from) > R);
      if (bent.ghost && pre.length > 1) { const tip = pre[pre.length - 1]!, back = pre[pre.length - 2]!.clone().sub(tip).normalize(); pre[pre.length - 1] = tip.clone().addScaledVector(back, R); }
      this.strip([start, ...pre], 0.0022, 0xffffff, bent.ghost ? 0.85 : 0.6);
      if (bent.ghost) this.guide.add(this.ring(bent.ghost.x, bent.ghost.y, R - 0.0016, R, 0xffffff, 0.9));
      if (bent.obj.length > 1) this.strip(bent.obj, 0.0028, ok ? 0xb8ff4a : 0xff5c7a, 0.9);
      if (bent.post.length > 1) this.strip(bent.post, 0.002, 0xa48bff, 0.8);
      return a;
    }
    if (!a.hit) { this.ribbon(start, start.clone().addScaledVector(dir, 0.9 * g.length), 0.0022, 0xffffff, 0.55); return a; }
    this.ribbon(start, ghost.clone().addScaledVector(dir, -R), 0.0022, 0xffffff, 0.85);
    this.guide.add(this.ring(a.ghost.x, a.ghost.y, R - 0.0016, R, 0xffffff, 0.9));
    if (target && a.object && a.cue) {
      const ob = new THREE.Vector3(sx(target.x), 0, sz(target.y));
      this.ribbon(ob, ob.clone().add(new THREE.Vector3(a.object.x, 0, -a.object.y).multiplyScalar(objLen)), 0.0028, ok ? 0xb8ff4a : 0xff5c7a, 0.9);
      this.ribbon(ghost, ghost.clone().add(new THREE.Vector3(a.cue.x, 0, -a.cue.y).multiplyScalar(cueLen)), 0.002, 0xa48bff, 0.8);
    } else if (a.cue) this.ribbon(ghost, ghost.clone().add(new THREE.Vector3(a.cue.x, 0, -a.cue.y).multiplyScalar(0.16 * g.length)), 0.002, 0xa48bff, 0.7);
    return a;
  }
  /** Marks on the cloth: the called ball and pocket, the shooter's balls, the kitchen. */
  showMarks(o: { call: { ball: number; pocket: number } | null; targets: number[]; balls: readonly Ball[]; kitchen: boolean; pockets?: boolean; hand?: { x: number; y: number; ok: boolean } | null }) {
    this.clear(this.marks);
    this.pulse = [];
    this.kitchen.visible = o.kitchen;
    // the cue ball in hand: a lime ring where it may go, a red one where it may not
    if (o.hand) { const q = this.ring(o.hand.x, o.hand.y, R + 0.004, R + 0.009, o.hand.ok ? 0xb8ff4a : 0xff5c7a, 0.9, 0.0018); this.marks.add(q); this.pulse.push(q); }
    for (const id of o.targets) { const b = o.balls.find((x) => x.id === id && x.s !== POCKETED); if (b) this.marks.add(this.ring(b.x, b.y, R + 0.0015, R + 0.0045, 0xb8ff4a, 0.55, 0.0015)); }
    if (o.pockets) POCKETS.forEach((_, k) => { const m = mouth(k); this.marks.add(this.ring(m.x, m.y, 0.022, 0.026, 0xe9e2ff, 0.4, 0.003)); });
    if (o.call) {
      const m = mouth(o.call.pocket), p = this.ring(m.x, m.y, 0.018, 0.03, 0xb8ff4a, 0.9, 0.004);
      this.marks.add(p); this.pulse.push(p);
      const b = o.balls.find((x) => x.id === o.call!.ball);
      if (b) { const q = this.ring(b.x, b.y, R + 0.003, R + 0.0075, 0xb8ff4a, 0.95, 0.0016); this.marks.add(q); this.pulse.push(q); }
    }
    this.dirty = true;
  }

  // ---- camera and pointer

  private insets: [number, number] = [0, 0];
  /** Screen pixels covered by controls at the left and the right of the table (a phone held upright). */
  setInsets(left: number, right: number) { if (left !== this.insets[0] || right !== this.insets[1]) { this.insets = [left, right]; this.frame(); } }
  setView(v: View, aim?: number, cue?: { x: number; y: number }) {
    const same = v === this.view && (v === "top" || v === "tilt");
    this.view = v; if (aim !== undefined) this.aimCam.aim = aim; if (cue) this.aimCam.cue = cue;
    if (!same) this.frame();
  }
  /**
   * The camera over the whole table, as close as it fits: straight down with a long lens (8 Ball
   * Pool's flat view) or tilted toward the player (3D). The long side of the table runs along the
   * long side of the screen; every corner of the rails is kept on the screen.
   */
  private overhead(aspect: number, tilt: number) {
    const portrait = aspect < 1, o = CW + FW + 0.012, fov = tilt ? 30 : 16;
    this.camera.fov = fov; this.camera.aspect = aspect;
    // landscape: the head rail (the break) on the left, as players expect; portrait: at the bottom
    const up = portrait ? new THREE.Vector3(0, 0, -1) : new THREE.Vector3(-1, 0, 0);
    const toward = portrait ? new THREE.Vector3(0, Math.cos(tilt), Math.sin(tilt)) : new THREE.Vector3(Math.sin(tilt), Math.cos(tilt), 0);
    const corners: THREE.Vector3[] = [], cloth: THREE.Vector3[] = [], m = 0.075;
    for (const x of [-W / 2 - o, W / 2 + o]) for (const z of [-L / 2 - o, L / 2 + o]) for (const y of [TOP, -0.05]) corners.push(new THREE.Vector3(x, y, z));
    for (const x of [-W / 2 - m, W / 2 + m]) for (const z of [-L / 2 - m, L / 2 + m]) cloth.push(new THREE.Vector3(x, TOP, z));
    // controls laid over the sides of the screen may cover the rails, never the cloth or its pockets
    const w = this.host.clientWidth || 1, inL = -1 + 2 * (this.insets[0] + 4) / w, inR = 1 - 2 * (this.insets[1] + 4) / w;
    const fits = (d: number) => {
      this.camera.up.copy(up); this.camera.position.copy(toward).multiplyScalar(d); this.camera.lookAt(0, 0, 0);
      this.camera.updateProjectionMatrix(); this.camera.updateMatrixWorld();
      return corners.every((c) => { const p = c.clone().project(this.camera); return Math.abs(p.x) <= 0.985 && Math.abs(p.y) <= 0.975; })
        && cloth.every((c) => { const p = c.clone().project(this.camera); return p.x >= inL && p.x <= inR; });
    };
    let lo = 0.5, hi = 60;
    for (let i = 0; i < 28; i++) { const mid = (lo + hi) / 2; if (fits(mid)) hi = mid; else lo = mid; }
    fits(hi);
    this.camera.far = hi + 6; this.camera.near = Math.max(0.05, hi - 3);
  }
  private frame() {
    const w = this.host.clientWidth || 1, h = this.host.clientHeight || 1, aspect = w / h;
    this.camera.aspect = aspect;
    if (this.view === "cue") {
      // the cue itself, from the side: its butt half, where the inlays are
      const [s, c] = sincos(this.aimCam.aim), dir = new THREE.Vector3(c, 0, -s), side = new THREE.Vector3(s, 0, c);
      const at = new THREE.Vector3(sx(this.aimCam.cue.x), R + 0.05, sz(this.aimCam.cue.y)).addScaledVector(dir, -1.02);
      this.camera.fov = 30; this.camera.up.set(0, 1, 0);
      this.camera.position.copy(at).addScaledVector(side, 0.62).add(new THREE.Vector3(0, 0.22, 0));
      this.camera.lookAt(at);
    } else if (this.view === "aim") {
      const [s, c] = sincos(this.aimCam.aim), dir = new THREE.Vector3(c, 0, -s), at = new THREE.Vector3(sx(this.aimCam.cue.x), R, sz(this.aimCam.cue.y));
      this.camera.fov = 45; this.camera.up.set(0, 1, 0);
      this.camera.position.copy(at).addScaledVector(dir, -0.85).add(new THREE.Vector3(0, 0.38, 0));
      this.camera.lookAt(at.clone().addScaledVector(dir, 0.6));
    } else { this.overhead(aspect, this.view === "tilt" ? 0.5 : 0); return void (this.dirty = true); }
    this.camera.near = 0.05; this.camera.far = 40;
    this.camera.updateProjectionMatrix();
    this.dirty = true;
  }
  private resize() {
    const w = this.host.clientWidth || 1, h = this.host.clientHeight || 1;
    this.renderer.setSize(w, h, false);
    this.renderer.domElement.style.width = "100%"; this.renderer.domElement.style.height = "100%";
    this.frame();
  }
  /** The point on the cloth under a screen position (table coordinates), or null off the table plane. */
  toTable(clientX: number, clientY: number): { x: number; y: number } | null {
    const r = this.renderer.domElement.getBoundingClientRect();
    const ndc = new THREE.Vector2(((clientX - r.left) / r.width) * 2 - 1, -((clientY - r.top) / r.height) * 2 + 1);
    const ray = new THREE.Raycaster(); ray.setFromCamera(ndc, this.camera);
    const hit = new THREE.Vector3();
    if (!ray.ray.intersectPlane(new THREE.Plane(new THREE.Vector3(0, 1, 0), -R), hit)) return null;
    return { x: hit.x + W / 2, y: L / 2 - hit.z };
  }
  /** Where a table point is on the screen (CSS pixels in the host). */
  toScreen(x: number, y: number): { x: number; y: number } {
    const v = new THREE.Vector3(sx(x), R, sz(y)).project(this.camera);
    return { x: (v.x + 1) / 2 * this.host.clientWidth, y: (1 - v.y) / 2 * this.host.clientHeight };
  }
  /** How many screen pixels one metre of cloth is, about (for touch tolerances). */
  pxPerMetre(): number { const a = this.toScreen(W / 2, L / 2), b = this.toScreen(W / 2 + 0.1, L / 2); return Math.hypot(b.x - a.x, b.y - a.y) * 10; }
  invalidate() { this.dirty = true; }

  private loop = () => {
    if (this.disposed) return;
    this.raf = requestAnimationFrame(this.loop);
    if (document.hidden) return;
    const now = performance.now();
    if (this.replay) this.stepReplay(now);
    if (this.pulse.length) { this.clock = now; const k = 0.6 + 0.4 * Math.sin(now / 240); for (const p of this.pulse) (p.material as THREE.MeshBasicMaterial).opacity = k; this.dirty = true; }
    if (!this.dirty) return;
    this.dirty = false;
    if (this.view === "aim") this.frame();
    this.renderer.render(this.scene, this.camera);
  };
  dispose() {
    this.disposed = true; cancelAnimationFrame(this.raf); this.observer.disconnect();
    this.clear(this.table); this.clear(this.guide); this.clear(this.marks); this.clear(this.ballGroup);
    this.renderer.dispose(); this.renderer.domElement.remove();
  }
}
export { CONTACT, CUE_LENGTH, duration };
