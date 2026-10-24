import { fork } from "node:child_process";
import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { Resvg } from "@resvg/resvg-js";
import gifenc from "gifenc";
import { writeAtomic } from "./atomic.js";
import { config } from "./config.js";
import { type Forged, forgedSvg } from "./forge.js";

/**
 * A Night Watcher, moving: its art carries SVG animations (rising embers, glowing eyes, pulses) that a
 * browser plays but Telegram cannot. Each frame here is the art at one moment: every <animate> and
 * <animateTransform> is read at that time and written onto its element as a plain value, then the
 * frame is drawn. The frames loop as a GIF, which Telegram shows as an animation.
 */
const { GIFEncoder, quantize, applyPalette } = gifenc as unknown as {
  GIFEncoder: () => { writeFrame: (index: Uint8Array, w: number, h: number, o: { palette: number[][]; delay: number; repeat?: number }) => void; finish: () => void; bytes: () => Uint8Array };
  quantize: (rgba: Uint8Array, max: number) => number[][];
  applyPalette: (rgba: Uint8Array, palette: number[][]) => Uint8Array;
};

/** Seconds in an SMIL clock value: "4s", "1.5s", "800ms", "2". */
export function seconds(v: string | null): number {
  if (!v) return 0;
  const m = /^\s*(-?[\d.]+)\s*(ms|s|min)?\s*$/.exec(v);
  if (!m) return 0;
  const n = Number(m[1]);
  return m[2] === "ms" ? n / 1000 : m[2] === "min" ? n * 60 : n;
}

const nums = (s: string) => s.trim().split(/[\s,]+/).map(Number);
const lerp = (a: string, b: string, k: number): string => {
  const x = nums(a), y = nums(b);
  // numbers (one or several) are blended; anything else (a colour, a keyword) steps
  if (x.length !== y.length || x.some(Number.isNaN) || y.some(Number.isNaN)) return k < 0.5 ? a.trim() : b.trim();
  return x.map((v, i) => +(v + (y[i]! - v) * k).toFixed(3)).join(" ");
};

/** The value an animation has at time t (seconds): its values list (or from/to), keyTimes if given, looping. */
export function valueAt(el: { getAttribute(n: string): string | null }, t: number): string | null {
  const values = el.getAttribute("values")?.split(";").map((s) => s.trim()).filter((s) => s !== "")
    ?? (el.getAttribute("from") !== null && el.getAttribute("to") !== null ? [el.getAttribute("from")!, el.getAttribute("to")!] : el.getAttribute("to") !== null ? [el.getAttribute("to")!] : null);
  if (!values?.length) return null;
  const dur = seconds(el.getAttribute("dur"));
  if (values.length === 1 || !(dur > 0)) return values[0]!;
  const p = ((((t - seconds(el.getAttribute("begin"))) % dur) + dur) % dur) / dur;
  const keys = el.getAttribute("keyTimes")?.split(";").map(Number);
  const times = keys && keys.length === values.length && keys.every((k) => k >= 0 && k <= 1) ? keys : values.map((_, i) => i / (values.length - 1));
  if (el.getAttribute("calcMode") === "discrete") { let i = 0; while (i + 1 < times.length && p >= times[i + 1]!) i++; return values[i]!; }
  let i = 0;
  while (i + 2 < times.length && p > times[i + 1]!) i++;
  const span = times[i + 1]! - times[i]!;
  return lerp(values[i]!, values[i + 1]!, span > 0 ? Math.min(1, Math.max(0, (p - times[i]!) / span)) : 1);
}

const TAG = /<(\/?)([A-Za-z][\w:.-]*)((?:\s+[^\s=>\/]+(?:\s*=\s*(?:"[^"]*"|'[^']*'))?)*)\s*(\/?)>/g;
const ATTR = /([^\s=]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g;
const ANIMS = new Set(["animate", "animateTransform", "animateMotion", "set"]);
const attrsOf = (s: string) => { const m = new Map<string, string>(); for (const a of s.matchAll(ATTR)) m.set(a[1]!, a[2] ?? a[3] ?? ""); return m; };

/**
 * The SVG at time t: every animation replaced by its value then, on the element it animates. The art is
 * our own markup (every animation a self-closing tag inside the element it moves), read tag by tag.
 * A motion along a path is left still.
 */
export function svgAt(svg: string, t: number): string {
  const stack: number[] = [];
  const opens = new Map<number, { end: number; name: string; attrs: Map<string, string>; self: boolean }>();
  const drop: [number, number][] = [];
  for (const m of svg.matchAll(TAG)) {
    const [all, close, name, raw, self] = m as unknown as [string, string, string, string, string];
    const at = m.index!;
    if (close) { stack.pop(); continue; }
    if (ANIMS.has(name)) {
      drop.push([at, at + all.length]);
      const parent = opens.get(stack.at(-1) ?? -1), a = attrsOf(raw), attr = a.get("attributeName"), v = valueAt({ getAttribute: (k) => a.get(k) ?? null }, t);
      if (!parent || v === null || name === "animateMotion") continue;
      if (name === "animateTransform") {
        const own = `${a.get("type") ?? "translate"}(${v})`;
        parent.attrs.set("transform", a.get("additive") === "sum" ? `${parent.attrs.get("transform") ?? ""} ${own}`.trim() : own);
      } else if (attr) parent.attrs.set(attr, v);
      continue;
    }
    opens.set(at, { end: at + all.length, name, attrs: attrsOf(raw), self: Boolean(self) });
    if (!self) stack.push(at);
  }
  // rebuild: open tags written from their (changed) attributes, animations left out
  const cuts = [...[...opens].map(([at, o]) => ({ at, end: o.end, text: `<${o.name}${[...o.attrs].map(([k, v]) => ` ${k}="${v.replace(/"/g, "&quot;")}"`).join("")}${o.self ? "/" : ""}>` })), ...drop.map(([at, end]) => ({ at, end, text: "" }))].sort((x, y) => x.at - y.at);
  let out = "", i = 0;
  for (const c of cuts) { out += svg.slice(i, c.at) + c.text; i = c.end; }
  return out + svg.slice(i);
}

/** The frames of one loop, drawn and encoded: `size` px square, `fps` frames a second, `loop` seconds. */
export function animatedGif(svg: string, o: { size?: number; fps?: number; loop?: number } = {}): Buffer {
  const size = o.size ?? 320, fps = o.fps ?? 10, loop = o.loop ?? 4;
  const gif = GIFEncoder();
  const n = Math.round(fps * loop);
  for (let i = 0; i < n; i++) {
    const rgba = new Uint8Array(new Resvg(svgAt(svg, i / fps), { fitTo: { mode: "width", value: size } }).render().pixels);
    const palette = quantize(rgba, 256);
    gif.writeFrame(applyPalette(rgba, palette), size, size, { palette, delay: Math.round(1000 / fps), repeat: 0 });
  }
  gif.finish();
  return Buffer.from(gif.bytes());
}

const dir = () => join(config.dataDir, "forge-gif");
/** One file per Night Watcher (a Night Boss's name, set once, gives it a new file). */
const fileOf = (f: Forged) => join(dir(), `${f.n}-${f.tier}${f.name ? `-${f.name.replace(/[^\w-]/g, "").slice(0, 24)}` : ""}.gif`);

/** A Night Watcher's GIF, made once and kept. Slow (about 20 s): the engine only calls it from makeGifs' worker. */
export function watcherGif(f: Forged): Buffer {
  const file = fileOf(f);
  if (existsSync(file)) return readFileSync(file);
  mkdirSync(dir(), { recursive: true });
  const gif = animatedGif(forgedSvg(f.n, f.tier, f.traits, f.name, f.inputs, f.points));
  writeAtomic(file, gif, { mode: 0o644 });
  return gif;
}

/** The GIF when it is made, else null (and the engine shows the picture instead). */
export const gifIfReady = (f: Forged): Buffer | null => (existsSync(fileOf(f)) ? readFileSync(fileOf(f)) : null);

const here = dirname(fileURLToPath(import.meta.url));
let making = false;
/** Makes the GIFs still missing, one by one in a child process: the engine never waits for them. */
export function makeGifs(all: Forged[]): void {
  const missing = all.filter((f) => !existsSync(fileOf(f)));
  if (!missing.length || making) return;
  making = true;
  const child = fork(join(here, "forge-gif-worker.ts"), [], { execArgv: process.execArgv, serialization: "advanced", stdio: ["ignore", "inherit", "inherit", "ipc"] });
  const timer = setTimeout(() => child.kill("SIGKILL"), 15 * 60_000);
  const done = () => { clearTimeout(timer); making = false; };
  child.once("exit", done);
  child.once("error", done);
  child.send({ forged: missing });
}
