import * as THREE from "three";
import { type BallsDesign, type ClothDesign, type CueDesign, ITEMS, type TableDesign } from "./catalog";
import { FOOT_X, FOOT_Y, HEAD_Y, L, W } from "./physics";

/**
 * NIGHT POOL's procedural art: every texture and model is drawn here, from the catalogue's design
 * parameters, so every item has real art without a single image file: felt with its nap and
 * pattern, rail wood with its grain, each ball of each set, and each cue (a lathe-turned shaft and
 * butt with its inlays), plus the frog crest, lily pads and stars they are decorated with. The
 * thumbnails in the locker are rendered from the same models.
 */
export const canvas = (w: number, h: number): [HTMLCanvasElement, CanvasRenderingContext2D] => {
  const c = document.createElement("canvas"); c.width = w; c.height = h;
  return [c, c.getContext("2d")!];
};
/** A small seeded random generator, so every texture is the same on every load. */
export function seeded(seed: number) { let s = seed >>> 0 || 1; return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; }; }

/** The NIGHT FROG crest: a wide frog face with two eyes on top, drawn centred at (x, y), `s` wide. */
export function frog(g: CanvasRenderingContext2D, x: number, y: number, s: number, color: string, eye = "#03020a"): void {
  g.save(); g.translate(x, y); g.scale(s / 100, s / 100);
  g.fillStyle = color;
  g.beginPath(); g.ellipse(0, 8, 50, 32, 0, 0, Math.PI * 2); g.fill();
  for (const ex of [-27, 27]) { g.beginPath(); g.arc(ex, -16, 18, 0, Math.PI * 2); g.fill(); }
  g.fillStyle = eye;
  for (const ex of [-27, 27]) { g.beginPath(); g.ellipse(ex, -16, 7, 10, 0, 0, Math.PI * 2); g.fill(); }
  g.strokeStyle = eye; g.lineWidth = 5; g.lineCap = "round";
  g.beginPath(); g.arc(0, 4, 30, 0.18 * Math.PI, 0.82 * Math.PI); g.stroke();
  g.restore();
}
/** A lily pad with its notch. */
export function lily(g: CanvasRenderingContext2D, x: number, y: number, r: number, color: string, turn = 0): void {
  g.save(); g.translate(x, y); g.rotate(turn); g.fillStyle = color;
  g.beginPath(); g.moveTo(0, 0); g.arc(0, 0, r, 0.16, Math.PI * 2 - 0.16); g.closePath(); g.fill();
  g.globalAlpha *= 0.35; g.strokeStyle = "#ffffff"; g.lineWidth = Math.max(1, r / 18);
  for (let i = 1; i < 6; i++) { g.beginPath(); g.moveTo(0, 0); const a = 0.3 + i * 0.95; g.lineTo(Math.cos(a) * r * 0.9, Math.sin(a) * r * 0.9); g.stroke(); }
  g.restore();
}
/** A four-point sparkle. */
export function sparkle(g: CanvasRenderingContext2D, x: number, y: number, r: number, color: string): void {
  g.save(); g.translate(x, y); g.fillStyle = color;
  g.beginPath(); g.moveTo(0, -r); g.quadraticCurveTo(r * 0.12, -r * 0.12, r, 0); g.quadraticCurveTo(r * 0.12, r * 0.12, 0, r); g.quadraticCurveTo(-r * 0.12, r * 0.12, -r, 0); g.quadraticCurveTo(-r * 0.12, -r * 0.12, 0, -r); g.fill();
  g.restore();
}
const texture = (c: HTMLCanvasElement, srgb = true) => { const t = new THREE.CanvasTexture(c); if (srgb) t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4; return t; };
const shade = (hex: string, k: number) => { const c = new THREE.Color(hex); c.multiplyScalar(k); return `#${c.getHexString()}`; };

// ---- the cloth

/** The bed's felt: the colour, a fine nap and its pattern, with the foot and head spots. The canvas spans the cloth from rail to rail. */
export function clothTexture(d: ClothDesign, px = 1024): { map: THREE.CanvasTexture; bump: THREE.CanvasTexture } {
  const wpx = Math.round(px * (W + 0.1) / (L + 0.1)), [c, g] = canvas(wpx, px), [b, bg] = canvas(wpx, px), r = seeded(7);
  const sx = wpx / (W + 0.1), sy = px / (L + 0.1), X = (x: number) => (x + 0.05) * sx, Y = (y: number) => px - (y + 0.05) * sy;
  g.fillStyle = d.color; g.fillRect(0, 0, wpx, px);
  // a soft lamp pool in the middle of the bed
  const glow = g.createRadialGradient(wpx / 2, px / 2, 0, wpx / 2, px / 2, px * 0.62);
  glow.addColorStop(0, "rgba(255,255,255,.07)"); glow.addColorStop(1, "rgba(0,0,0,.18)");
  g.fillStyle = glow; g.fillRect(0, 0, wpx, px);
  // the nap: thousands of short fibres, lighter and darker
  bg.fillStyle = "#808080"; bg.fillRect(0, 0, wpx, px);
  for (let i = 0; i < wpx * px / 14; i++) {
    const x = r() * wpx, y = r() * px, l = 1 + r() * 2.2, v = r();
    g.fillStyle = v > 0.5 ? "rgba(255,255,255,.035)" : "rgba(0,0,0,.05)"; g.fillRect(x, y, l, 1);
    bg.fillStyle = v > 0.5 ? "#9a9a9a" : "#666"; bg.fillRect(x, y, l, 1);
  }
  g.save(); g.globalAlpha = 0.18;
  if (d.pattern === "weave") { g.strokeStyle = d.patternColor; g.lineWidth = 1; for (let i = -px; i < wpx + px; i += 6) { g.beginPath(); g.moveTo(i, 0); g.lineTo(i + px, px); g.stroke(); } }
  if (d.pattern === "grid") { g.globalAlpha = 0.12; g.strokeStyle = d.patternColor; g.lineWidth = 1.5; for (let x = 0; x <= W; x += W / 8) { g.beginPath(); g.moveTo(X(x), 0); g.lineTo(X(x), px); g.stroke(); } for (let y = 0; y <= L; y += L / 16) { g.beginPath(); g.moveTo(0, Y(y)); g.lineTo(wpx, Y(y)); g.stroke(); } }
  if (d.pattern === "stars") { g.globalAlpha = 0.5; for (let i = 0; i < 260; i++) { const s = r() * 1.6 + 0.4; g.fillStyle = d.patternColor; g.beginPath(); g.arc(r() * wpx, r() * px, s, 0, Math.PI * 2); g.fill(); } for (let i = 0; i < 14; i++) sparkle(g, r() * wpx, r() * px, 4 + r() * 5, d.patternColor); }
  if (d.pattern === "lily") { g.globalAlpha = 0.16; for (let i = 0; i < 26; i++) lily(g, r() * wpx, r() * px, 14 + r() * 26, d.patternColor, r() * 6.28); }
  if (d.pattern === "frog") { g.globalAlpha = 0.13; frog(g, X(W / 2), Y(L / 2), wpx * 0.42, d.patternColor, d.color); g.globalAlpha = 0.07; g.strokeStyle = d.patternColor; g.lineWidth = 3; g.beginPath(); g.arc(X(W / 2), Y(L / 2), wpx * 0.3, 0, Math.PI * 2); g.stroke(); }
  g.restore();
  // $SHIFT × IMD printed in the middle of the bed, faint as a table maker's mark, pressed into the nap too
  const mark = Math.min(wpx, px) * 0.62;
  brandMark(g, X(W / 2), Y(L / 2), mark, "rgba(255,255,255,.15)");
  brandMark(bg, X(W / 2), Y(L / 2), mark, "rgba(255,255,255,.35)");
  // the spots and a faint head string, as on a real cloth
  g.fillStyle = "rgba(255,255,255,.55)";
  for (const [x, y] of [[FOOT_X, FOOT_Y], [W / 2, HEAD_Y]] as const) { g.beginPath(); g.arc(X(x), Y(y), 3, 0, Math.PI * 2); g.fill(); }
  g.strokeStyle = "rgba(255,255,255,.08)"; g.setLineDash([6, 8]); g.lineWidth = 1.5;
  g.beginPath(); g.moveTo(X(0), Y(HEAD_Y)); g.lineTo(X(W), Y(HEAD_Y)); g.stroke();
  const map = texture(c), bump = texture(b, false);
  return { map, bump };
}

/**
 * The table's mark: "$SHIFT × IMD" in a thin ring, set along the long side so it reads across the table
 * on a screen in landscape. `size` is the ring's width in pixels; `color` carries its own faintness.
 */
export function brandMark(g: CanvasRenderingContext2D, cx: number, cy: number, size: number, color: string): void {
  const font = '"Space Grotesk", Inter, system-ui, sans-serif';
  g.save();
  g.translate(cx, cy); g.rotate(-Math.PI / 2);
  g.strokeStyle = color; g.fillStyle = color; g.textAlign = "center"; g.textBaseline = "middle";
  g.lineWidth = Math.max(1.5, size * 0.006);
  g.beginPath(); g.ellipse(0, 0, size * 0.62, size * 0.34, 0, 0, Math.PI * 2); g.stroke();
  g.beginPath(); g.ellipse(0, 0, size * 0.58, size * 0.30, 0, 0, Math.PI * 2); g.stroke();
  g.font = `700 ${Math.round(size * 0.15)}px ${font}`;
  g.fillText("$SHIFT × IMD", 0, -size * 0.03);
  g.font = `600 ${Math.round(size * 0.045)}px ${font}`;
  g.fillText("N I G H T   P O O L   ·   B U I L T   O N   I M D", 0, size * 0.13);
  g.restore();
}

// ---- rail wood

/** Wood with its grain, for the rails and the apron; lacquer comes from the material's clearcoat. */
export function woodTexture(d: TableDesign, px = 512): THREE.CanvasTexture {
  const [c, g] = canvas(px, px), r = seeded(11);
  g.fillStyle = d.wood; g.fillRect(0, 0, px, px);
  for (let i = 0; i < 160; i++) {
    const y = r() * px, amp = 2 + r() * 6, f = 0.004 + r() * 0.01, ph = r() * 6;
    g.strokeStyle = r() > 0.5 ? shade(d.wood, 1.35) : shade(d.wood, 0.7); g.globalAlpha = 0.18 + r() * 0.25; g.lineWidth = 0.6 + r() * 1.8;
    g.beginPath(); for (let x = 0; x <= px; x += 8) g.lineTo(x, y + Math.sin(x * f + ph) * amp); g.stroke();
  }
  g.globalAlpha = 1;
  const t = texture(c); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(3, 1);
  return t;
}

// ---- balls

const NUMBER_FONT = "700 60px 'Space Grotesk', 'Inter', system-ui, sans-serif";
/**
 * One ball's surface as an equirectangular map: solids in colour, stripes white with a band, the 8
 * black, each with its number in a white disc on both sides; the cue ball with a small crest.
 */
export function ballTexture(id: number, d: BallsDesign, px = 512): { map: THREE.CanvasTexture; glow: THREE.CanvasTexture | null } {
  const h = px / 2, [c, g] = canvas(px, h), r = seeded(id * 31 + 5);
  const base = id === 0 ? d.cue : id === 8 ? "#0d0b14" : d.colors[id > 8 ? id - 9 : id - 1]!;
  const stripe = id > 8;
  g.fillStyle = stripe ? d.cue : base; g.fillRect(0, 0, px, h);
  if (stripe) { g.fillStyle = base; g.fillRect(0, h * 0.27, px, h * 0.46); }
  if (d.style === "frog" && id !== 0 && id !== 8) {
    g.globalAlpha = 0.28;
    for (let i = 0; i < 140; i++) { const y = stripe ? h * (0.29 + r() * 0.42) : r() * h; g.fillStyle = r() > 0.5 ? shade(base, 0.55) : shade(base, 1.4); g.beginPath(); g.arc(r() * px, y, 2 + r() * 6, 0, Math.PI * 2); g.fill(); }
    g.globalAlpha = 1;
  }
  const [gc, gg] = canvas(px, h);
  gg.fillStyle = "#000"; gg.fillRect(0, 0, px, h);
  if (id === 0) {
    // the house mark: a small violet frog, twice
    for (const u of [0.25, 0.75]) frog(g, u * px, h * 0.5, px * 0.05, "#7c5cff", d.cue);
  } else {
    for (const u of [0.25, 0.75]) {
      const x = u * px, y = h * 0.5, rr = h * 0.13;
      g.fillStyle = id === 8 && d.style === "neon" ? "#b8ff4a" : "#fbfaf4"; g.beginPath(); g.ellipse(x, y, rr, rr, 0, 0, Math.PI * 2); g.fill();
      g.fillStyle = d.number; g.font = NUMBER_FONT.replace("60px", `${Math.round(rr * 1.25)}px`); g.textAlign = "center"; g.textBaseline = "middle";
      g.fillText(String(id), x, y + rr * 0.06);
      if (d.style === "neon") { gg.fillStyle = id === 8 ? "#b8ff4a" : "#ffffff"; gg.beginPath(); gg.ellipse(x, y, rr, rr, 0, 0, Math.PI * 2); gg.fill(); }
    }
  }
  return { map: texture(c), glow: d.style === "neon" && id !== 0 ? texture(gc) : null };
}
/** A ball's material for its set: lacquered phenolic, chrome for the chrome set, glowing numbers on the neon set. */
export function ballMaterial(id: number, d: BallsDesign, lite: boolean): THREE.MeshStandardMaterial {
  const { map, glow } = ballTexture(id, d, lite ? 256 : 512);
  if (lite) return new THREE.MeshStandardMaterial({ map, roughness: 0.25, metalness: d.style === "chrome" ? 0.6 : 0 });
  return new THREE.MeshPhysicalMaterial({ map, roughness: d.style === "chrome" ? 0.12 : 0.18, metalness: d.style === "chrome" ? 0.85 : 0, clearcoat: 1, clearcoatRoughness: 0.06,
    ...(glow ? { emissiveMap: glow, emissive: new THREE.Color("#ffffff"), emissiveIntensity: 0.55 } : {}) });
}

// ---- cues

/** The cue's outline along its length (m from the tip), as radii: tip, ferrule, shaft taper, joint, forearm, wrap, sleeve, cap. */
const CUE_LEN = 1.47;
const radius = (y: number) => y < 0.012 ? 0.0061 : y < 0.032 ? 0.0064 : y < 0.74 ? 0.0064 + (y - 0.032) / 0.708 * 0.0041 : y < 0.76 ? 0.0109 : y < 1.05 ? 0.0108 + (y - 0.76) / 0.29 * 0.002 : y < 1.3 ? 0.0128 + (y - 1.05) / 0.25 * 0.0007 : y < CUE_LEN - 0.012 ? 0.0135 + (y - 1.3) / 0.158 * 0.0011 : 0.0146 - (y - (CUE_LEN - 0.012)) / 0.012 * 0.004;
/** The cue's skin, drawn along its length (v from tip to butt) and around it (u): woods, wrap, rings and the inlays. */
function cueTexture(d: CueDesign): THREE.CanvasTexture {
  const [c, g] = canvas(256, 2048), V = (y: number) => (y / CUE_LEN) * 2048, r = seeded(d.inlay.length * 97 + 3);
  const band = (a: number, b: number, color: string) => { g.fillStyle = color; g.fillRect(0, V(a), 256, V(b) - V(a)); };
  band(0, 0.012, d.tip); band(0.012, 0.032, "#f4f1e8");
  // the shaft: pale wood with a faint grain
  band(0.032, 0.74, d.shaft);
  g.globalAlpha = 0.12; for (let i = 0; i < 60; i++) { g.strokeStyle = r() > 0.5 ? "#8a6a3a" : "#ffffff"; g.beginPath(); const x = r() * 256; g.moveTo(x, V(0.032)); g.lineTo(x + (r() - 0.5) * 20, V(0.74)); g.stroke(); }
  g.globalAlpha = 1;
  band(0.74, 0.76, d.metal);
  // the forearm with its inlays, repeated around the cue
  band(0.76, 1.05, d.butt);
  const y0 = V(0.8), y1 = V(1.02);
  for (let k = 0; k < 4; k++) {
    const x = 32 + k * 64;
    g.fillStyle = d.inlayColor; g.strokeStyle = d.inlayColor;
    if (d.inlay === "frog") frog(g, x, (y0 + y1) / 2, 44, d.inlayColor, d.butt);
    else if (d.inlay === "lily") { lily(g, x, y0 + 90, 22, d.inlayColor, k); lily(g, x + 10, y1 - 120, 16, d.inlayColor, k + 2); }
    else if (d.inlay === "stars") for (let i = 0; i < 9; i++) sparkle(g, x + (r() - 0.5) * 50, y0 + r() * (y1 - y0), 5 + r() * 7, d.inlayColor);
    else if (d.inlay === "diamonds") for (let i = 0; i < 5; i++) { const yy = y0 + 40 + i * ((y1 - y0 - 80) / 4); g.beginPath(); g.moveTo(x, yy - 18); g.lineTo(x + 9, yy); g.lineTo(x, yy + 18); g.lineTo(x - 9, yy); g.closePath(); g.fill(); }
    else if (d.inlay === "crown") { const yy = (y0 + y1) / 2; g.beginPath(); g.moveTo(x - 22, yy + 14); g.lineTo(x - 22, yy - 10); g.lineTo(x - 11, yy + 2); g.lineTo(x, yy - 16); g.lineTo(x + 11, yy + 2); g.lineTo(x + 22, yy - 10); g.lineTo(x + 22, yy + 14); g.closePath(); g.fill(); }
    else if (d.inlay === "circuit") { g.lineWidth = 3; g.beginPath(); let yy = y0; g.moveTo(x, yy); while (yy < y1) { yy += 30 + r() * 40; g.lineTo(x + (r() > 0.5 ? 18 : -18), yy); g.lineTo(x, yy + 14); } g.stroke(); for (let i = 0; i < 6; i++) { g.beginPath(); g.arc(x + (r() - 0.5) * 36, y0 + r() * (y1 - y0), 4, 0, Math.PI * 2); g.fill(); } }
    else if (d.inlay === "rings") { for (let i = 0; i < 7; i++) g.fillRect(0, y0 + i * ((y1 - y0) / 7), 256, 6); }
    else if (d.inlay === "rivets") { for (let i = 0; i < 6; i++) { g.beginPath(); g.arc(x, y0 + 20 + i * ((y1 - y0 - 40) / 5), 5, 0, Math.PI * 2); g.fill(); } g.font = "700 26px 'Space Grotesk', sans-serif"; g.textAlign = "center"; g.save(); g.translate(x + 20, (y0 + y1) / 2); g.rotate(Math.PI / 2); g.fillText("NS", 0, 0); g.restore(); }
  }
  // points of the forearm into the wrap
  g.fillStyle = d.wrap; for (let k = 0; k < 4; k++) { const x = 32 + k * 64; g.beginPath(); g.moveTo(x - 26, V(1.05)); g.lineTo(x, V(0.93)); g.lineTo(x + 26, V(1.05)); g.closePath(); g.fill(); }
  band(1.05, 1.3, d.wrap);
  // the wrap's texture: fine diagonal threads
  g.globalAlpha = 0.25; g.strokeStyle = "#000"; for (let i = 0; i < 400; i += 4) { g.beginPath(); g.moveTo(0, V(1.05) + i * 1.3); g.lineTo(256, V(1.05) + i * 1.3 + 40); g.stroke(); } g.globalAlpha = 1;
  band(1.3, CUE_LEN, d.butt);
  band(1.3, 1.306, d.metal); band(1.43, 1.436, d.metal);
  // drawn tip-down from the top of the canvas: the lathe's v runs from the tip
  const t = texture(c); t.flipY = false;
  return t;
}
/** The cue as a lathe-turned model along +y, tip at the origin, with metal fittings and a glow ring if it has one. */
export function cueModel(d: CueDesign, lite = false): THREE.Group {
  const pts: THREE.Vector2[] = [new THREE.Vector2(0, 0)];
  const N = lite ? 90 : 180;
  for (let i = 0; i <= N; i++) { const y = (i / N) * CUE_LEN; pts.push(new THREE.Vector2(radius(y), y)); }
  pts.push(new THREE.Vector2(0, CUE_LEN));
  const body = new THREE.Mesh(new THREE.LatheGeometry(pts, lite ? 16 : 32), lite ? new THREE.MeshStandardMaterial({ map: cueTexture(d), roughness: 0.4 })
    : new THREE.MeshPhysicalMaterial({ map: cueTexture(d), roughness: 0.35, clearcoat: d.gloss, clearcoatRoughness: 0.1 }));
  const group = new THREE.Group(); group.add(body);
  const metal = new THREE.MeshStandardMaterial({ color: d.metal, metalness: 1, roughness: 0.22 });
  const ring = (y: number, h: number, rr: number) => { const m = new THREE.Mesh(new THREE.CylinderGeometry(rr, rr, h, 24), metal); m.position.y = y; group.add(m); };
  ring(0.75, 0.02, 0.0112); ring(CUE_LEN - 0.006, 0.012, 0.0149);
  if (d.glow) {
    const g = new THREE.Mesh(new THREE.CylinderGeometry(0.0138, 0.0138, 0.008, 24), new THREE.MeshBasicMaterial({ color: d.glow }));
    g.position.y = 1.38; group.add(g);
  }
  group.traverse((o) => { if ((o as THREE.Mesh).isMesh) { o.castShadow = !lite; } });
  return group;
}
export const CUE_LENGTH = CUE_LEN;

// ---- thumbnails: the locker's pictures, from the very models the table uses

let thumbRenderer: THREE.WebGLRenderer | null = null;
const thumbs = new Map<string, string>();
const studio = (() => {
  let scene: THREE.Scene | null = null;
  return () => {
    if (scene) return scene;
    scene = new THREE.Scene();
    scene.add(new THREE.HemisphereLight(0xe9e2ff, 0x1a0f33, 1.6));
    const key = new THREE.DirectionalLight(0xffffff, 2.6); key.position.set(1, 2, 3); scene.add(key);
    const rim = new THREE.DirectionalLight(0x7c5cff, 2.2); rim.position.set(-2, 1, -2); scene.add(rim);
    return scene;
  };
})();
/** A picture of an item (cue, cloth, table or ball set), rendered once and kept as a data URL. */
export function thumbnail(id: string, w = 320, h = 160): string | null {
  const hit = thumbs.get(`${id}:${w}x${h}`);
  if (hit) return hit;
  const item = ITEMS.get(id);
  if (!item || !["cue", "cloth", "table", "balls"].includes(item.kind)) return null;
  try {
    thumbRenderer ??= new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true });
    thumbRenderer.setPixelRatio(1); thumbRenderer.setSize(w, h, false);
    thumbRenderer.toneMapping = THREE.ACESFilmicToneMapping; thumbRenderer.outputColorSpace = THREE.SRGBColorSpace;
    thumbRenderer.setClearColor(0x000000, 0);
    const scene = studio(), stage = new THREE.Group(); scene.add(stage);
    const camera = new THREE.PerspectiveCamera(30, w / h, 0.01, 20);
    if (item.kind === "cue") {
      // the butt half, where the inlays are, across the card
      const cue = cueModel(item.design as CueDesign); cue.rotation.z = -Math.PI / 2 + 0.18; cue.position.set(-1.02, -0.17, 0); stage.add(cue);
      camera.position.set(0, 0, 0.62); camera.lookAt(0, 0, 0);
    } else if (item.kind === "cloth") {
      const { map, bump } = clothTexture(item.design as ClothDesign, 512);
      const plane = new THREE.Mesh(new THREE.PlaneGeometry(1.2, 1.2), new THREE.MeshStandardMaterial({ map, bumpMap: bump, bumpScale: 0.6, roughness: 0.95 }));
      plane.rotation.x = -Math.PI / 2; stage.add(plane);
      const ball = new THREE.Mesh(new THREE.SphereGeometry(0.06, 32, 20), ballMaterial(8, ITEMS.get("balls-classic")!.design as BallsDesign, false)); ball.position.set(0.12, 0.06, 0.05); stage.add(ball);
      camera.position.set(0, 0.55, 0.62); camera.lookAt(0, 0, 0);
    } else if (item.kind === "table") {
      const d = item.design as TableDesign, wood = new THREE.MeshPhysicalMaterial({ map: woodTexture(d), clearcoat: d.gloss, roughness: 0.5 });
      const rail = new THREE.Mesh(new THREE.BoxGeometry(1.6, 0.08, 0.18), wood); rail.position.set(0, 0.04, -0.2); stage.add(rail);
      const side = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.08, 1), wood); side.position.set(-0.7, 0.04, 0.2); stage.add(side);
      const corner = new THREE.Mesh(new THREE.TorusGeometry(0.1, 0.022, 12, 32, Math.PI * 1.5), new THREE.MeshStandardMaterial({ color: d.metal, metalness: 1, roughness: 0.25 }));
      corner.rotation.x = -Math.PI / 2; corner.position.set(-0.7, 0.08, -0.2); stage.add(corner);
      const cloth = new THREE.Mesh(new THREE.PlaneGeometry(1.6, 1.2), new THREE.MeshStandardMaterial({ color: "#2b1d63", roughness: 0.95 })); cloth.rotation.x = -Math.PI / 2; cloth.position.set(0.2, 0.0, 0.4); stage.add(cloth);
      for (let i = 0; i < 3; i++) { const dm = new THREE.Mesh(new THREE.CircleGeometry(0.014, 4), new THREE.MeshBasicMaterial({ color: d.diamonds })); dm.rotation.x = -Math.PI / 2; dm.position.set(-0.3 + i * 0.35, 0.081, -0.2); stage.add(dm); }
      if (d.glow) { const glow = new THREE.Mesh(new THREE.BoxGeometry(1.6, 0.006, 0.006), new THREE.MeshBasicMaterial({ color: d.glow })); glow.position.set(0, 0.004, -0.11); stage.add(glow); }
      camera.position.set(0.2, 0.9, 0.95); camera.lookAt(-0.1, 0, 0);
    } else {
      const d = item.design as BallsDesign;
      [0, 3, 8, 11].forEach((id, i) => { const b = new THREE.Mesh(new THREE.SphereGeometry(0.1, 40, 24), ballMaterial(id, d, false)); b.position.set(-0.33 + i * 0.22, 0.1, i % 2 ? -0.05 : 0.05); b.rotation.y = -0.6; stage.add(b); });
      camera.position.set(0, 0.38, 0.95); camera.lookAt(0, 0.06, 0);
    }
    const pmrem = new THREE.PMREMGenerator(thumbRenderer);
    scene.environment = pmrem.fromScene(new THREE.Scene(), 0.04).texture;
    thumbRenderer.render(scene, camera);
    const url = thumbRenderer.domElement.toDataURL("image/png");
    scene.remove(stage); pmrem.dispose();
    stage.traverse((o) => { const m = o as THREE.Mesh; if (m.isMesh) { m.geometry.dispose(); const mats = Array.isArray(m.material) ? m.material : [m.material]; for (const x of mats) { const st = x as THREE.MeshStandardMaterial; st.map?.dispose(); st.bumpMap?.dispose(); st.emissiveMap?.dispose(); x.dispose(); } } });
    thumbs.set(`${id}:${w}x${h}`, url);
    return url;
  } catch { return null; }
}
