import type { ShipStatic } from "./types";

/**
 * Every character on the ship is its NFT's own onchain art: the NIGHT FROGS layers (body, skin, mouth, eyes,
 * headwear, accessory) as the renderer stores them, composed here into one SVG per frog without the card's
 * background and frame, and rasterised into an atlas (two sizes) as the frogs come into view. When the camera is
 * close, a frog on screen is drawn again from its SVG at full size. Night Watchers use the same layers with
 * the traits their forge gave them.
 */
const OFFSETS = [4, 16, 28, 44, 56, 72, 88];
/** The part of the 1000 × 1000 art the sprite keeps: the bust, the hard hat's beam and the laser eyes' rays. */
export const VB = { x: 40, y: 130, w: 920, h: 870 } as const;
export const CW = 104, CH = Math.round((CW * VB.h) / VB.w); // 104 × 98 device px, the mid level of detail
const COLS = 24;
const ACCENT: Record<number, string> = { 1: "#7C5CFF", 2: "#C4B4FF", 4: "#B8FF4A", 5: "#FFC46B" };

export type SpriteKey = number | `w${number}`;
type Slot = { i: number; ready: boolean; queued: boolean };
type Hi = { canvas: HTMLCanvasElement; size: number; used: number };

export class Sprites {
  readonly atlas: HTMLCanvasElement;
  readonly small: HTMLCanvasElement;
  private a: CanvasRenderingContext2D;
  private s: CanvasRenderingContext2D;
  private slots = new Map<SpriteKey, Slot>();
  private queue: SpriteKey[] = [];
  private inflight = 0;
  private decoded: { key: SpriteKey; img: HTMLImageElement }[] = [];
  private hi = new Map<SpriteKey, Hi>();
  private hiWant = new Map<SpriteKey, number>();
  private hiBusy = new Set<SpriteKey>();
  private watcherTraits = new Map<number, { traits: number[]; color: string }>();
  /** The skin colour of each skin trait, for the silhouette shown until a frog's art is drawn. */
  readonly skins: string[];
  readyCount = 0;
  onReady?: () => void;

  constructor(private st: ShipStatic, capacity = 560) {
    const rows = Math.ceil(capacity / COLS);
    this.atlas = document.createElement("canvas"); this.atlas.width = COLS * CW; this.atlas.height = rows * CH;
    this.small = document.createElement("canvas"); this.small.width = (COLS * CW) / 2; this.small.height = (rows * CH) / 2;
    this.a = this.atlas.getContext("2d")!; this.s = this.small.getContext("2d")!;
    this.s.imageSmoothingQuality = "high";
    this.skins = st.art.slice(OFFSETS[2]!, OFFSETS[3]!).filter((_, i) => i % 2 === 1).map((svg) => /\.skin\{fill:(#[0-9A-Fa-f]{6})/.exec(svg)?.[1] ?? "#9AA9C2");
  }

  setWatcher(n: number, traits: number[], color: string) { this.watcherTraits.set(n, { traits, color }); }

  /** The SVG of a character, cropped to its bust. `w` × `h` is the size it is rasterised at. */
  svg(key: SpriteKey, w: number, h: number): string | null {
    const art = this.st.art;
    let traits: number[], color: string, badge = "", marks = "";
    if (typeof key === "number") {
      const row = this.st.frogs[key - 1];
      if (!row) return null;
      traits = row.slice(3, 10);
      color = ACCENT[traits[0]!] ?? "#3FE6FF";
      if (traits[6] === 1) badge = `<text x="500" y="858" font-size="23" fill="#08070D" text-anchor="middle">#${key}</text>`;
      if (key === 1) marks = art[3]!;
    } else {
      const n = Number(key.slice(1)), w0 = this.watcherTraits.get(n);
      if (!w0) return null;
      traits = w0.traits; color = w0.color;
      if (traits[6] === 1) badge = `<text x="500" y="858" font-size="23" fill="#08070D" text-anchor="middle">NW${n}</text>`;
      if (n === 0) marks = art[3]!;
    }
    let s = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${VB.x} ${VB.y} ${VB.w} ${VB.h}" width="${w}" height="${h}" color="${color}">${art[0]}`;
    for (let l = 1; l < 7; l++) s += art[OFFSETS[l]! + traits[l]! * 2 + 1] ?? "";
    return s + badge + marks + "</svg>";
  }

  private slot(key: SpriteKey): Slot {
    let s = this.slots.get(key);
    if (!s) { s = { i: this.slots.size, ready: false, queued: false }; this.slots.set(key, s); }
    return s;
  }
  isReady(key: SpriteKey) { return this.slots.get(key)?.ready ?? false; }
  /** Asks for a character's atlas cell; `urgent` ones (on screen) jump the queue. */
  want(key: SpriteKey, urgent = false) {
    const s = this.slot(key);
    if (s.ready) return;
    if (!s.queued) { s.queued = true; if (urgent) this.queue.unshift(key); else this.queue.push(key); }
    else if (urgent) { const i = this.queue.indexOf(key); if (i > 8) { this.queue.splice(i, 1); this.queue.unshift(key); } }
  }
  /** Forgets a character's art (a watcher whose name changed): drawn again on the next ask. */
  reset(key: SpriteKey) { const s = this.slots.get(key); if (s) { s.ready = false; s.queued = false; } this.hi.delete(key); }

  private load(svg: string): Promise<HTMLImageElement> {
    const img = new Image();
    img.decoding = "async";
    img.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
    return img.decode().then(() => img);
  }

  /** Work for one frame: starts decodes, draws decoded art into the atlas within `budget` ms. */
  pump(budget = 5) {
    const t0 = performance.now();
    while (this.inflight < 6 && this.queue.length) {
      const key = this.queue.shift()!;
      const svg = this.svg(key, CW, CH);
      if (!svg) continue;
      this.inflight++;
      void this.load(svg).then((img) => this.decoded.push({ key, img })).catch(() => { const s = this.slots.get(key); if (s) s.queued = false; }).finally(() => { this.inflight--; });
    }
    let drew = false;
    while (this.decoded.length && performance.now() - t0 < budget) {
      const { key, img } = this.decoded.shift()!;
      const s = this.slot(key), x = (s.i % COLS) * CW, y = Math.floor(s.i / COLS) * CH;
      this.a.clearRect(x, y, CW, CH);
      // a thin rim of light round the outline, so a dark hoodie still reads against a dark floor
      this.a.save(); this.a.beginPath(); this.a.rect(x, y, CW, CH); this.a.clip();
      this.a.shadowColor = "rgba(200,190,255,.55)"; this.a.shadowBlur = 3;
      this.a.drawImage(img, x, y, CW, CH);
      this.a.restore();
      this.s.clearRect(x / 2, y / 2, CW / 2, CH / 2);
      this.s.drawImage(this.atlas, x, y, CW, CH, x / 2, y / 2, CW / 2, CH / 2);
      if (!s.ready) this.readyCount++;
      s.ready = true; s.queued = false; drew = true;
    }
    // full-size art for characters seen up close, a few at a time
    for (const [key, size] of this.hiWant) {
      if (this.hiBusy.size >= 2) break;
      this.hiWant.delete(key);
      const h = Math.min(640, Math.ceil(size / 64) * 64), w = Math.round((h * VB.w) / VB.h);
      const svg = this.svg(key, w, h);
      if (!svg) continue;
      this.hiBusy.add(key);
      void this.load(svg).then((img) => {
        const c = document.createElement("canvas"); c.width = w; c.height = h;
        const g = c.getContext("2d")!;
        g.shadowColor = "rgba(200,190,255,.5)"; g.shadowBlur = Math.max(3, h / 40);
        g.drawImage(img, 0, 0, w, h);
        this.hi.set(key, { canvas: c, size: h, used: performance.now() });
        if (this.hi.size > 48) { const old = [...this.hi.entries()].sort((p, q) => p[1].used - q[1].used)[0]; if (old) this.hi.delete(old[0]); }
      }).catch(() => {}).finally(() => this.hiBusy.delete(key));
    }
    this.hiWant.clear();
    if (drew) this.onReady?.();
  }
  get pending() { return this.queue.length + this.inflight + this.decoded.length; }

  /**
   * Draws a character into the rect (world px) at `devH` device px tall: the full-size art when it is close
   * and loaded, else the atlas cell of the right size, else its silhouette in its skin colour.
   */
  draw(c: CanvasRenderingContext2D, key: SpriteKey, x: number, y: number, w: number, h: number, devH: number, skin: string) {
    const s = this.slots.get(key);
    if (devH > CH * 1.15) {
      const hi = this.hi.get(key);
      if (hi && hi.size >= devH * 0.8) { hi.used = performance.now(); c.drawImage(hi.canvas, x, y, w, h); return; }
      if (!this.hiBusy.has(key) && (!hi || hi.size < devH * 0.8)) this.hiWant.set(key, devH * 1.25);
    }
    if (s?.ready) {
      const col = s.i % COLS, row = Math.floor(s.i / COLS);
      if (devH <= CH / 2 + 4) c.drawImage(this.small, (col * CW) / 2, (row * CH) / 2, CW / 2, CH / 2, x, y, w, h);
      else c.drawImage(this.atlas, col * CW, row * CH, CW, CH, x, y, w, h);
      return;
    }
    this.want(key, true);
    silhouette(c, x, y, w, h, skin);
  }
}

const HEAD = typeof Path2D !== "undefined" ? new Path2D("M230 555Q207 481 278 423C264 330 309 269 382 269C438 269 482 302 497 352C513 299 553 269 609 269C691 269 731 340 712 431Q802 488 777 588Q806 699 687 742Q612 782 487 765Q344 783 260 711Q204 656 230 555Z") : null;
const BODY = typeof Path2D !== "undefined" ? new Path2D("M126 1010L145 855Q158 774 294 741L359 704H641L705 741Q842 772 859 855L882 1010Z") : null;
/** The frog's outline in its skin colour: what shows for the moment before its art is drawn. */
export function silhouette(c: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, skin: string) {
  if (!HEAD || !BODY) return;
  c.save();
  c.translate(x, y); c.scale(w / VB.w, h / VB.h); c.translate(-VB.x, -VB.y);
  c.fillStyle = "#1a1830"; c.fill(BODY);
  c.fillStyle = skin; c.globalAlpha *= 0.85; c.fill(HEAD);
  c.restore();
}
/** Maps a point of the 1000 × 1000 art into a sprite drawn at (x, y, w, h). */
export const at = (x: number, y: number, w: number, h: number, ax: number, ay: number): [number, number] => [x + ((ax - VB.x) / VB.w) * w, y + ((ay - VB.y) / VB.h) * h];
