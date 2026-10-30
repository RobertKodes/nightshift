import * as THREE from "three";
import { GeometryBatch } from "../station3d/geometry";
import { createMissionPatch } from "../station3d/patch";
import { BAYS, type Entry } from "./data";
import { BAY_W, HALF_D, LAYOUTS, ROOM_H, bayX, type Seat } from "./layout";
import { cables, crate, plant, poolTexture } from "./props";
import { painted, rug as rugMaterial } from "./surfaces";
import { ROOM_GLOW, toon } from "./toon";

/** This module builds the back row: the four original rooms behind the window wall. */
const BACK = LAYOUTS.slice(0, 4);

const WIN = { x: 4.7, y0: .95, y1: 2.95 }, DOOR = { z: .9, h: 2.4 }, MONO = "ui-monospace, Consolas, monospace", SANS = "system-ui, 'Segoe UI', sans-serif";
const CODES = ["MSN", "OPS", "REC", "WCH"], ACCENT = ["#e0a54a", "#6f9cff", "#a68bff", "#5fd0c4"];
const LED = ["#39ff88", "#39ff88", "#ffb347", "#4fa8ff", "#4fa8ff", "#ff5a4f"];
const DARK = "#a39bc8", DARKER = "#7d76a3", STEEL = "#c4bce6", GLASS_BLACK = "#3a3550", DESK_TOP = "#d4cdf2";
/** Screen glass tints per room, so each room reads in its own colour from above. */
const SCREEN_TINT = [new THREE.Color(1.5, 1.15, 2.2), new THREE.Color(.8, 1.9, 2.4), new THREE.Color(2.3, 1.0, 1.7), new THREE.Color(.8, 2.1, 1.9)];

type Canvas = { canvas: HTMLCanvasElement; map: THREE.CanvasTexture; c: CanvasRenderingContext2D | null };
function canvasTexture(width: number, height: number): Canvas {
  const canvas = document.createElement("canvas"); canvas.width = width; canvas.height = height;
  const map = new THREE.CanvasTexture(canvas); map.colorSpace = THREE.SRGBColorSpace; map.anisotropy = 4;
  return { canvas, map, c: canvas.getContext("2d") };
}
/** Seeded, so the station looks the same on every visit. */
function seeded(seed: number) { return () => { seed = seed * 16807 % 2147483647; return seed / 2147483647; }; }
const hash = (text: string) => { let h = 2166136261; for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 16777619); return (h >>> 0) % 2147483646 + 1; };
function fit(c: CanvasRenderingContext2D, text: string, width: number) {
  if (c.measureText(text).width <= width) return text;
  let cut = text; while (cut.length > 1 && c.measureText(`${cut}...`).width > width) cut = cut.slice(0, -1);
  return `${cut.trimEnd()}...`;
}
function wrap(c: CanvasRenderingContext2D, text: string, x: number, y: number, width: number, line: number, lines: number) {
  const words = text.split(/\s+/); let row = "", n = 0;
  for (let i = 0; i < words.length; i++) {
    const next = row ? `${row} ${words[i]}` : words[i]!;
    if (c.measureText(next).width > width && row) {
      if (n === lines - 1) { c.fillText(fit(c, `${row} ${words.slice(i).join(" ")}`, width), x, y + n * line); return; }
      c.fillText(row, x, y + n * line); n++; row = words[i]!;
    } else row = next;
  }
  if (row) c.fillText(fit(c, row, width), x, y + n * line);
}

/** A box placed in a seat's own frame (local +z = the way its frog faces). */
function local(batch: GeometryBatch, seat: Seat, ox: number, w: number, h: number, d: number, x: number, y: number, z: number, tint?: THREE.ColorRepresentation, tilt = 0, turn = 0) {
  const g = new THREE.BoxGeometry(w, h, d); if (tilt) g.rotateX(tilt); if (turn) g.rotateY(turn); g.translate(x, y, z);
  batch.add(g, ox + seat.at[0], seat.y, seat.at[1], seat.face, tint);
}
/** Inset wall panels with dark seams, on a wall facing +x/-x (axis "x") or +z/-z (axis "z"). */
function panels(batch: GeometryBatch, axis: "x" | "z", plane: number, facing: number, a0: number, a1: number, y0: number, y1: number, cols: number, rows: number, random: () => number) {
  const w = (a1 - a0) / cols, h = (y1 - y0) / rows;
  for (let i = 0; i < cols; i++) for (let j = 0; j < rows; j++) {
    const a = a0 + w * (i + .5), y = y0 + h * (j + .5), shade = .92 + random() * .08, tint = new THREE.Color(shade, shade * .995, shade * .975);
    if (axis === "x") batch.add(new THREE.BoxGeometry(.05, h - .035, w - .035), plane + facing * .025, y, a, 0, tint);
    else batch.add(new THREE.BoxGeometry(w - .035, h - .035, .05), a, y, plane + facing * .025, 0, tint);
  }
}


/** One office chair, seat centred on the origin, facing +z. */
function chairGeometry() {
  const batch = new GeometryBatch(), fabric = "#d8d0f4", frame = "#8a84b0";
  for (let k = 0; k < 5; k++) { const g = new THREE.BoxGeometry(.05, .035, .3); g.translate(0, 0, .15); batch.add(g, 0, .045, 0, k / 5 * Math.PI * 2, frame); }
  batch.add(new THREE.CylinderGeometry(.032, .032, .3, 10), 0, .2, 0, 0, frame);
  batch.add(new THREE.BoxGeometry(.5, .07, .48), 0, .365, 0, 0, fabric);
  const back = new THREE.BoxGeometry(.48, .5, .07); back.rotateX(-.1); batch.add(back, 0, .74, -.26, 0, fabric);
  batch.add(new THREE.BoxGeometry(.05, .32, .04), 0, .48, -.27, 0, frame);
  for (const s of [-1, 1]) { batch.add(new THREE.BoxGeometry(.05, .04, .3), s * .27, .57, -.03, 0, frame); batch.add(new THREE.BoxGeometry(.035, .18, .035), s * .27, .47, -.1, 0, frame); }
  const material = new THREE.MeshBasicMaterial(), mesh = batch.mesh(material); material.dispose();
  return mesh.geometry;
}

export type Interior = ReturnType<typeof createInterior>;
/** The whole deck: shell, furniture, practical lights and the live screens, batched by material. */
export function createInterior(onTexture: () => void = () => {}) {
  const random = seeded(19), group = new THREE.Group();
  // cel-shaded, as the NIGHTSHIFT art: dark armoured panels, violet light, glowing trim
  // painted surfaces from the concept art's palette, mapped by world position
  const shell = painted("wall", 2.4, { color: "#e2dcf6", vertexColors: true }, onTexture);
  const graphite = painted("wall", 2.4, { color: "#ffffff", vertexColors: true }, onTexture);
  const desks = painted("console", 1.5, { color: "#ffffff", vertexColors: true }, onTexture);
  const racks = painted("rack", 1.2, { color: "#ffffff", vertexColors: true }, onTexture);
  const metal = toon({ color: "#6e6699" });
  const gold = toon({ color: "#e0a84e", emissive: "#2a1800" });
  const fabric = painted("fabric", 1, { color: "#ffffff", vertexColors: true }, onTexture);
  // the plate floor is painted dark; lift it toward the concept's lit lavender deck
  const floor = painted("floor", 4, {}, onTexture); floor.color.setRGB(2.2, 2.0, 2.8);
  const props = toon({ vertexColors: true });
  const warm = new THREE.MeshBasicMaterial({ color: new THREE.Color("#8d6dff").multiplyScalar(2.8) });
  /** Glowing edges on desks and consoles in the room colour. */
  const accent = new THREE.MeshBasicMaterial({ vertexColors: true, color: new THREE.Color(2.6, 2.6, 2.6) });
  const amber = new THREE.MeshBasicMaterial({ color: new THREE.Color("#ffb14a").multiplyScalar(2.2) });
  const leds = new THREE.MeshBasicMaterial({ vertexColors: true, color: new THREE.Color(2.2, 2.2, 2.2) }), blink = leds.clone();
  // the panoramic windows show the night side of the Earth (the texture arrives with the outside view)
  const glass = new THREE.MeshBasicMaterial({ color: new THREE.Color("#0a1430") });
  // walls and ceiling never cast shadows (the key light comes from above them); furniture does
  const B = { shell: new GeometryBatch(), graphite: new GeometryBatch(), furniture: new GeometryBatch(), desks: new GeometryBatch(), metal: new GeometryBatch(), gold: new GeometryBatch(), fabric: new GeometryBatch(), floor: new GeometryBatch(), warm: new GeometryBatch(), accent: new GeometryBatch(), amber: new GeometryBatch(), leds: new GeometryBatch(), blink: new GeometryBatch(), glass: new GeometryBatch(), props: new GeometryBatch() };
  const screens: { atlas: Canvas; wall: Canvas }[] = [], holograms: THREE.Group[] = [], patches: ReturnType<typeof createMissionPatch>[] = [];
  const tables: (Canvas | undefined)[] = [], pinballs: (Canvas | undefined)[] = [], radar = { time: { value: 0 } };
  const chairSeats: Seat[] = [], chairBays: number[] = [];

  const ledRack = (x: number, z: number, facing: number, z0: number, z1: number, y0: number, y1: number) => {
    B.furniture.add(new THREE.BoxGeometry(.34, y1 - y0, z1 - z0), x + facing * .17, (y0 + y1) / 2, z, 0, DARKER);
    for (let y = y0 + .2; y < y1 - .1; y += .26) {
      B.furniture.add(new THREE.BoxGeometry(.02, .2, z1 - z0 - .12), x + facing * .35, y, z, 0, random() > .5 ? STEEL : DARK);
      for (let k = 0; k < 7; k++) if (random() > .35) (random() > .7 ? B.blink : B.leds).add(new THREE.BoxGeometry(.012, .022, .022), x + facing * .365, y + .05, z0 + .15 + random() * (z1 - z0 - .3), 0, LED[random() * LED.length | 0]);
    }
  };
  const rail = (x: number, facing: number, z0: number, z1: number, y = 1.12) => {
    const g = new THREE.CylinderGeometry(.024, .024, z1 - z0, 8); g.rotateX(Math.PI / 2); B.metal.add(g, x, y, (z0 + z1) / 2);
    for (let z = z0 + .2; z <= z1 - .1; z += .9) B.metal.add(new THREE.BoxGeometry(.16, .025, .025), x - facing * .08, y, z);
  };
  const sign = (text: string, sub: string, w: number, h: number, accent: string) => {
    const t = canvasTexture(1024, Math.round(1024 * h / w));
    if (t.c) {
      const c = t.c, H = t.canvas.height; c.fillStyle = "#11171e"; c.fillRect(0, 0, 1024, H); c.fillStyle = accent; c.fillRect(0, 0, 10, H);
      c.fillStyle = "#e9eef3"; c.font = `600 ${Math.round(H * .42)}px ${SANS}`; c.textBaseline = "middle"; c.fillText(text, 44, H * .5);
      c.fillStyle = "#8696a6"; c.font = `500 ${Math.round(H * .24)}px ${MONO}`; c.textAlign = "right"; c.fillText(sub, 990, H * .52);
    }
    return new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshBasicMaterial({ map: t.map, color: new THREE.Color(.95, .95, .95) }));
  };

  // Walls between the rooms (with doorways) and the sealed hatches at both ends of the deck.
  for (let k = 0; k <= 4; k++) {
    const x = -BAY_W / 2 + k * BAY_W, end = k === 0 || k === 4, faces = end ? [k === 0 ? 1 : -1] : [1, -1];
    if (end) B.graphite.add(new THREE.BoxGeometry(.3, ROOM_H, 2 * HALF_D), x, ROOM_H / 2, 0, 0, DARKER);
    else {
      for (const s of [-1, 1]) B.graphite.add(new THREE.BoxGeometry(.3, ROOM_H, HALF_D - DOOR.z), x, ROOM_H / 2, s * (HALF_D + DOOR.z) / 2, 0, DARKER);
      B.graphite.add(new THREE.BoxGeometry(.3, ROOM_H - DOOR.h, 2 * DOOR.z), x, (ROOM_H + DOOR.h) / 2, 0, 0, DARKER);
      B.metal.add(new THREE.BoxGeometry(.46, .12, 2 * DOOR.z + .24), x, DOOR.h + .06, 0);
      for (const s of [-1, 1]) B.metal.add(new THREE.BoxGeometry(.46, DOOR.h, .12), x, DOOR.h / 2, s * (DOOR.z + .06));
      B.graphite.add(new THREE.BoxGeometry(.5, .025, 2 * DOOR.z), x, .012, 0, 0, STEEL);
      for (const s of [-1, 1]) B.amber.add(new THREE.BoxGeometry(.03, .025, 2 * DOOR.z - .1), x + s * .2, DOOR.h - .01, 0);
    }
    for (const facing of faces) {
      const face = x + facing * .15;
      if (end) {
        panels(B.shell, "x", face, facing, -HALF_D, HALF_D, 0, ROOM_H, 6, 3, random);
        const ring = new THREE.TorusGeometry(.95, .09, 10, 40); ring.rotateY(Math.PI / 2); B.metal.add(ring, x + facing * .26, 1.25, 0);
        const hatch = new THREE.CylinderGeometry(.9, .9, .1, 40); hatch.rotateZ(Math.PI / 2); B.graphite.add(hatch, x + facing * .23, 1.25, 0, 0, STEEL);
        B.amber.add(new THREE.BoxGeometry(.02, .06, .5), x + facing * .29, 1.25, 0);
        continue;
      }
      for (const [z0, z1] of [[-HALF_D, -DOOR.z - .12], [DOOR.z + .12, HALF_D]] as const) panels(B.shell, "x", face, facing, z0, z1, 0, ROOM_H, 3, 3, random);
      panels(B.shell, "x", face, facing, -DOOR.z - .12, DOOR.z + .12, DOOR.h + .12, ROOM_H, 1, 1, random);
    }
  }

  BACK.forEach((layout, bay) => {
    const X = bayX(bay);
    // floor, ceiling panels, the three light troughs and the ribs
    B.floor.add(new THREE.BoxGeometry(BAY_W, .1, 2 * HALF_D), X, -.05, 0);
    B.graphite.add(new THREE.BoxGeometry(BAY_W, .1, 2 * HALF_D), X, ROOM_H + .05, 0, 0, DARKER);
    for (const [z0, z1] of [[-HALF_D, -2.85], [-2.35, -.05], [.45, 2.75], [3.25, HALF_D]] as const) B.shell.add(new THREE.BoxGeometry(BAY_W - .3, .05, z1 - z0 - .04), X, ROOM_H - .025, (z0 + z1) / 2, 0, "#c9c5bc");
    for (const z of [-2.6, .2, 3.0]) { B.graphite.add(new THREE.BoxGeometry(BAY_W - .3, .06, .46), X, ROOM_H - .03, z, 0, STEEL); B.warm.add(new THREE.BoxGeometry(BAY_W - .6, .02, .2), X, ROOM_H - .07, z); }
    for (let i = -2; i <= 2; i++) B.graphite.add(new THREE.BoxGeometry(.16, .2, 2 * HALF_D), X + i * 2.4, ROOM_H - .1, 0, 0, DARK);
    // the window wall: panoramic window, reveal, mullions, gold-trimmed sill, glass
    const L = X - BAY_W / 2 + .15, R = X + BAY_W / 2 - .15, W = -HALF_D + .15;
    panels(B.shell, "z", W, 1, L, R, 0, WIN.y0, 6, 1, random); panels(B.shell, "z", W, 1, L, R, WIN.y1, ROOM_H, 6, 1, random);
    panels(B.shell, "z", W, 1, L, X - WIN.x - .1, WIN.y0, WIN.y1, 1, 2, random); panels(B.shell, "z", W, 1, X + WIN.x + .1, R, WIN.y0, WIN.y1, 1, 2, random);
    B.graphite.add(new THREE.BoxGeometry(BAY_W, WIN.y0, .3), X, WIN.y0 / 2, -HALF_D, 0, DARKER);
    B.graphite.add(new THREE.BoxGeometry(BAY_W, ROOM_H - WIN.y1, .3), X, (ROOM_H + WIN.y1) / 2, -HALF_D, 0, DARKER);
    for (const s of [-1, 1]) B.graphite.add(new THREE.BoxGeometry(BAY_W / 2 - WIN.x, WIN.y1 - WIN.y0, .3), X + s * (BAY_W / 2 + WIN.x) / 2, (WIN.y0 + WIN.y1) / 2, -HALF_D, 0, DARKER);
    B.graphite.add(new THREE.BoxGeometry(2 * WIN.x + .2, .1, .5), X, WIN.y1 + .02, -HALF_D - .05, 0, STEEL);
    for (const s of [-1, 1]) B.graphite.add(new THREE.BoxGeometry(.1, WIN.y1 - WIN.y0, .5), X + s * (WIN.x + .05), (WIN.y0 + WIN.y1) / 2, -HALF_D - .05, 0, STEEL);
    B.shell.add(new THREE.BoxGeometry(2 * WIN.x + .3, .06, .55), X, WIN.y0, -HALF_D + .05, 0, "#efece5");
    B.gold.add(new THREE.BoxGeometry(2 * WIN.x + .3, .03, .03), X, WIN.y0 + .02, -HALF_D + .33);
    for (const s of [-1, 1]) B.metal.add(new THREE.BoxGeometry(.09, WIN.y1 - WIN.y0, .1), X + s * WIN.x / 3, (WIN.y0 + WIN.y1) / 2, -HALF_D - .12);
    B.glass.add(new THREE.PlaneGeometry(2 * WIN.x, WIN.y1 - WIN.y0), X, (WIN.y0 + WIN.y1) / 2, -HALF_D - .16);
    B.warm.add(new THREE.BoxGeometry(2 * WIN.x, .02, .03), X, WIN.y1 - .07, -HALF_D + .14);
    const plate = sign(BAYS[bay]!.name.toUpperCase(), `DECK 2 / BAY 0${bay + 1}`, 3.4, .36, ACCENT[bay]!); plate.position.set(X, 3.17, -HALF_D + .19); group.add(plate);
    // the entrance wall with its corridor hatch
    B.graphite.add(new THREE.BoxGeometry(BAY_W, ROOM_H, .3), X, ROOM_H / 2, HALF_D, 0, DARKER);
    panels(B.shell, "z", HALF_D - .15, -1, L, X - 1.15, 0, ROOM_H, 3, 3, random); panels(B.shell, "z", HALF_D - .15, -1, X + 1.15, R, 0, ROOM_H, 3, 3, random);
    panels(B.shell, "z", HALF_D - .15, -1, X - 1.15, X + 1.15, DOOR.h + .1, ROOM_H, 1, 1, random);
    B.graphite.add(new THREE.BoxGeometry(2.1, DOOR.h + .1, .12), X, (DOOR.h + .1) / 2, HALF_D - .2, 0, STEEL); B.amber.add(new THREE.BoxGeometry(.03, DOOR.h - .3, .02), X, DOOR.h / 2, HALF_D - .27);
    // base light strips along the walls, handrails on the rear halves
    for (const s of [-1, 1]) {
      for (const z of [-1, 1]) B.warm.add(new THREE.BoxGeometry(.07, .03, HALF_D - DOOR.z - .3), X + s * (BAY_W / 2 - .21), .06, z * (HALF_D + DOOR.z) / 2);
      rail(X + s * (BAY_W / 2 - .32), s, 1.3, 4.7);
    }
    B.warm.add(new THREE.BoxGeometry(BAY_W - .5, .03, .07), X, .06, -HALF_D + .21);
    for (const s of [-1, 1]) B.warm.add(new THREE.BoxGeometry(BAY_W / 2 - 1.5, .03, .07), X + s * (BAY_W / 4 + .55), .06, HALF_D - .21);
    // the left wall's live roster and the equipment racks (each room has its own wall pieces)
    const wall = canvasTexture(1024, 576), display = new THREE.Mesh(new THREE.PlaneGeometry(2.8, 1.575), new THREE.MeshBasicMaterial({ map: wall.map, color: new THREE.Color(1.45, 1.45, 1.45) }));
    display.position.set(X - BAY_W / 2 + .27, .95, -3.0); display.rotation.y = Math.PI / 2; display.scale.setScalar(.62); group.add(display);
    B.graphite.add(new THREE.BoxGeometry(.1, 1.12, 1.9), X - BAY_W / 2 + .2, .95, -3.0, 0, GLASS_BLACK);
    if (bay < 2) ledRack(X + BAY_W / 2 - .15, -3.0, -1, -4.4, -1.6, .1, 2.6);
    ledRack(X - BAY_W / 2 + .15, 2.6, 1, 1.6, 3.6, .1, 1.0);
    if (bay !== 1) ledRack(X + BAY_W / 2 - .15, 3.0, -1, 1.8, 4.2, .1, 1.0);
    // signs over the doorways pointing to the neighbouring rooms
    for (const s of [-1, 1]) {
      const next = bay + s; if (next < 0 || next > 3) continue;
      const door = sign(s < 0 ? `< ${BAYS[next]!.name.toUpperCase()}` : `${BAYS[next]!.name.toUpperCase()} >`, `BAY 0${next + 1}`, 1.7, .24, ACCENT[next]!);
      door.position.set(X + s * (BAY_W / 2 - .27), DOOR.h + .42, 0); door.rotation.y = -s * Math.PI / 2; group.add(door);
    }

    // seats: consoles and desks with their screens, then the room's own furniture
    const atlas = canvasTexture(1024, 1024), parts = new GeometryBatch(); let monitors = 0;
    const screen = (region: number, w: number, h: number, x: number, y: number, z: number, s: Seat, tilt = 0, turn = 0) => {
      const g = new THREE.PlaneGeometry(w, h), uv = g.getAttribute("uv"), col = region % 2, row = region >> 1;
      for (let n = 0; n < uv.count; n++) uv.setXY(n, (col + uv.getX(n)) / 2, 1 - (row + 1 - uv.getY(n)) / 4);
      g.rotateY(Math.PI); if (tilt) g.rotateX(tilt); if (turn) g.rotateY(turn); g.translate(x, y, z);
      parts.add(g, X + s.at[0], s.y, s.at[1], s.face); monitors++;
    };
    for (const s of layout.seats) {
      if (s.kind !== "sofa") { chairSeats.push(s); chairBays.push(bay); }
      if (s.kind === "console") {
        // a low console with a raked screen, so the operator's face shows over it
        const w = 1.5;
        local(B.desks, s, X, w, .66, .58, 0, .33, .62, DARK); local(B.desks, s, X, w + .1, .05, .8, 0, .74, .64, STEEL);
        local(B.metal, s, X, w + .1, .035, .07, 0, .76, .27);
        for (let k = 0; k < 10; k++) local(random() > .6 ? B.blink : B.leds, s, X, .035, .012, .022, -w / 2 + .14 + k * (w - .28) / 9, .775, .36 + (k % 2) * .05, LED[random() * LED.length | 0]);
        local(B.desks, s, X, w - .08, .56, .06, 0, 1.0, .86, GLASS_BLACK, .55); local(B.desks, s, X, w - .3, .12, .3, 0, .8, .95, STEEL);
        screen(s.screen, w - .2, .48, 0, 1.015, .83, s, .55);
        local(B.accent, s, X, w + .08, .025, .05, 0, .77, .26, ROOM_GLOW[bay]); local(B.accent, s, X, w - .1, .03, .04, 0, 1.3, .98, ROOM_GLOW[bay], .55);
      } else if (s.kind === "desk") {
        local(B.desks, s, X, 1.6, .045, .8, 0, .74, .64, DESK_TOP); for (const k of [-1, 1]) local(B.desks, s, X, .05, .72, .76, k * .77, .36, .64, DARK);
        local(B.desks, s, X, 1.5, .42, .03, 0, .46, 1.0, DARK); local(B.desks, s, X, .46, .016, .15, 0, .772, .42, DARKER);
        for (const k of [-1, 1]) { local(B.desks, s, X, .72, .44, .035, k * .39, 1.1, .94, GLASS_BLACK, 0, -k * .2); local(B.desks, s, X, .05, .3, .05, k * .39, .9, .98, STEEL); }
        screen(s.screen, .68, .4, -.39, 1.1, .92, s, 0, .2); screen(6 + (s.screen % 2), .68, .4, .39, 1.1, .92, s, 0, -.2);
        local(B.accent, s, X, 1.58, .025, .05, 0, .77, .25, ROOM_GLOW[bay]); for (const k of [-1, 1]) local(B.accent, s, X, .7, .025, .04, k * .39, 1.33, .95, ROOM_GLOW[bay], 0, -k * .2);
      } else if (s.kind === "captain") {
        local(B.desks, s, X, .16, .5, .5, .56, .25, -.35, DARK); local(B.desks, s, X, .3, .04, .42, .56, .52, -.3, STEEL, -.3);
        for (let k = 0; k < 4; k++) local(B.leds, s, X, .03, .012, .03, .5 + (k % 2) * .1, .55, -.4 + (k >> 1) * .12, LED[k]!, -.3);
      }
    }
    furnish(bay, X);
    if (monitors) group.add(parts.mesh(new THREE.MeshBasicMaterial({ map: atlas.map, color: SCREEN_TINT[bay]! })));
    screens.push({ atlas, wall });
  });

  function furnish(bay: number, X: number) {
    // set dressing: potted plants in the corners, a few crates, cable runs to the wall consoles
    const PLANTS: [number, number][][] = [[[-5.3, -4.45], [-5.3, 4.45], [5.3, 4.45]], [[-5.3, -4.45], [-5.3, 4.45]], [[-5.25, -1.55], [-5.3, 4.45], [5.3, 4.45]], [[-5.3, -4.45], [-5.3, 4.45], [5.3, 4.45]]];
    PLANTS[bay]!.forEach(([x, z], k) => plant(B.props, X + x, z, 1, bay * 3 + k));
    if (bay === 0) { crate(B.props, X + 5.25, 0, 1.15, .6, .5, .2, "#4a3d6e"); crate(B.props, X + 5.2, .5, 1.1, .45, .35, -.15, "#5a4a2a"); cables(B.props, [[X - 5.7, -.2], [X - 4.5, -.2]]); cables(B.props, [[X + 5.7, -.2], [X + 4.5, -.2]]); }
    if (bay === 1) { cables(B.props, [[X - 5.7, -1.45], [X - 4.4, -1.45]]); cables(B.props, [[X + 5.7, 1.0], [X + 4.7, 1.0], [X + 4.7, 2.6]], 2); }
    if (bay === 2) crate(B.props, X + 5.2, 0, -.6, .55, .45, .3, "#3a5a4a");
    if (bay === 3) { cables(B.props, [[X + 5.7, -1.6], [X + 4.9, -1.6], [X + 4.9, -2.0]]); cables(B.props, [[X - 5.7, -1.8], [X - 4.9, -1.8], [X - 4.9, -2.4]], 2); }
    if (bay === 0) {
      // the mission table: a lit pedestal under a slowly turning globe and the missions' orbits
      B.desks.add(new THREE.CylinderGeometry(.82, .6, .86, 40), X, .43, -.2, 0, DARK);
      const ring = new THREE.TorusGeometry(.86, .035, 8, 48); ring.rotateX(Math.PI / 2); B.metal.add(ring, X, .87, -.2);
      B.leds.add(new THREE.CylinderGeometry(.8, .8, .02, 40), X, .875, -.2, 0, "#3a2a8a");
      const holo = new THREE.Group(); holo.position.set(X, 1.55, -.2); holo.userData.noClip = true;
      holo.add(new THREE.LineSegments(new THREE.WireframeGeometry(new THREE.SphereGeometry(.62, 22, 14)), new THREE.LineBasicMaterial({ color: new THREE.Color("#9d80ff").multiplyScalar(1.1), transparent: true, opacity: .45, blending: THREE.AdditiveBlending, depthWrite: false })));
      holo.add(new THREE.Mesh(new THREE.SphereGeometry(.56, 24, 16), new THREE.MeshBasicMaterial({ color: new THREE.Color("#5a38e8"), transparent: true, opacity: .16, blending: THREE.AdditiveBlending, depthWrite: false })));
      for (let i = 0; i < 3; i++) {
        const curve = new THREE.EllipseCurve(0, 0, .58 + i * .07, .5 + i * .05), orbit = new THREE.LineLoop(new THREE.BufferGeometry().setFromPoints(curve.getPoints(64).map((p) => new THREE.Vector3(p.x, 0, p.y))), new THREE.LineBasicMaterial({ color: new THREE.Color("#ffc46b").multiplyScalar(1.4), transparent: true, opacity: .6, blending: THREE.AdditiveBlending, depthWrite: false }));
        orbit.rotation.set(.3 + i * .35, i * 1.1, .2 - i * .2);
        const dot = new THREE.Mesh(new THREE.SphereGeometry(.028, 8, 6), new THREE.MeshBasicMaterial({ color: new THREE.Color("#ffd28a").multiplyScalar(3) }));
        dot.userData.curve = curve; dot.userData.speed = .35 + i * .12; orbit.add(dot); holo.add(orbit);
      }
      const beam = new THREE.Mesh(new THREE.CylinderGeometry(.5, .72, .5, 32, 1, true), new THREE.ShaderMaterial({
        transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
        vertexShader: "varying float h; void main(){ h = uv.y; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }",
        fragmentShader: "varying float h; void main(){ gl_FragColor = vec4(vec3(.45,.28,1.0) * (1.0 - h) * .28, 1.0); }",
      })); beam.position.y = -.42; holo.add(beam);
      group.add(holo); holograms.push(holo);
      const patch = createMissionPatch(); patch.mesh.position.set(X - 5.35, 1.95, -HALF_D + .21); patch.mesh.scale.setScalar(.6); patch.mesh.castShadow = false; group.add(patch.mesh); patches.push(patch);
    } else if (bay === 1) {
      // the galley counter by the entrance
      B.furniture.add(new THREE.BoxGeometry(.62, .9, 1.9), X + 5.5, .45, 3.3, 0, DARK); B.shell.add(new THREE.BoxGeometry(.68, .04, 1.95), X + 5.48, .92, 3.3, 0, "#f1eee8");
      B.furniture.add(new THREE.BoxGeometry(.42, .6, 1.9), X + 5.6, 2.15, 3.3, 0, DARK); B.warm.add(new THREE.BoxGeometry(.03, .02, 1.7), X + 5.4, 1.83, 3.3);
      B.furniture.add(new THREE.BoxGeometry(.36, .44, .32), X + 5.56, 1.16, 2.85, 0, DARKER); B.leds.add(new THREE.BoxGeometry(.01, .03, .03), X + 5.37, 1.3, 2.85, 0, "#39ff88");
      for (const z of [3.4, 3.58]) B.shell.add(new THREE.CylinderGeometry(.045, .038, .11, 12), X + 5.35, .995, z, 0, "#fbfaf6");
    } else if (bay === 2) {
      // the game table, the sofa under the live screen, the pinball machine
      const [tx, tz] = [X - .5, -1.4];
      B.desks.add(new THREE.CylinderGeometry(1.0, 1.0, .05, 48), tx, .74, tz, 0, STEEL); B.desks.add(new THREE.CylinderGeometry(.16, .2, .7, 16), tx, .37, tz, 0, DARK);
      B.desks.add(new THREE.CylinderGeometry(.55, .55, .04, 32), tx, .02, tz, 0, DARK);
      const edge = new THREE.TorusGeometry(1.0, .025, 8, 64); edge.rotateX(Math.PI / 2); B.metal.add(edge, tx, .765, tz);
      const glow = new THREE.TorusGeometry(.72, .008, 6, 64); glow.rotateX(Math.PI / 2); B.leds.add(glow, tx, .768, tz, 0, "#8f7bff");
      const board = canvasTexture(512, 512), top = new THREE.Mesh(new THREE.PlaneGeometry(.92, .92), new THREE.MeshBasicMaterial({ map: board.map, color: new THREE.Color(1.3, 1.3, 1.3) }));
      top.rotation.x = -Math.PI / 2; top.position.set(tx, .768, tz); group.add(top); tables[bay] = board;
      B.fabric.add(new THREE.BoxGeometry(.8, .3, 2.3), X - 5.25, .17, -3.15, 0, "#c8bfe8"); B.fabric.add(new THREE.BoxGeometry(.72, .1, 2.1), X - 5.2, .36, -3.15, 0, "#e2dcf6");
      B.fabric.add(new THREE.BoxGeometry(.2, .62, 2.3), X - 5.62, .62, -3.15, 0, "#c8bfe8"); for (const s of [-1, 1]) B.fabric.add(new THREE.BoxGeometry(.8, .52, .16), X - 5.25, .32, -3.15 + s * 1.2, 0, "#b0a6d8");
      B.desks.add(new THREE.BoxGeometry(1.1, .2, .7), X + 5.25, .86, -2.6, 0, DARK); B.desks.add(new THREE.BoxGeometry(.14, .92, .66), X + 5.75, 1.3, -2.6, 0, DARK);
      for (const [x, z] of [[-.45, -.28], [-.45, .28], [.45, -.28], [.45, .28]] as const) B.desks.add(new THREE.BoxGeometry(.06, .76, .06), X + 5.25 + x, .38, -2.6 + z, 0, STEEL);
      const pin = canvasTexture(512, 1024); pinballs[bay] = pin;
      const field = new THREE.PlaneGeometry(.62, 1.0), fuv = field.getAttribute("uv"); for (let n = 0; n < fuv.count; n++) fuv.setY(n, fuv.getY(n) * .75);
      field.rotateX(-Math.PI / 2); field.rotateY(-Math.PI / 2); field.rotateZ(.12); field.translate(X + 5.2, .97, -2.6);
      group.add(new THREE.Mesh(field, new THREE.MeshBasicMaterial({ map: pin.map, color: new THREE.Color(1.25, 1.25, 1.25) })));
      const back = new THREE.PlaneGeometry(.6, .3), buv = back.getAttribute("uv"); for (let n = 0; n < buv.count; n++) buv.setY(n, .75 + buv.getY(n) * .25);
      const backbox = new THREE.Mesh(back, new THREE.MeshBasicMaterial({ map: pin.map, color: new THREE.Color(1.6, 1.6, 1.6) })); backbox.rotation.y = -Math.PI / 2; backbox.position.set(X + 5.67, 1.42, -2.6); group.add(backbox);
    } else {
      // the Captain's dais and the radar
      B.desks.add(new THREE.CylinderGeometry(1.05, 1.1, .14, 48), X - 2.2, .07, -1.2, 0, DARK);
      const edge = new THREE.TorusGeometry(1.06, .02, 6, 64); edge.rotateX(Math.PI / 2); B.gold.add(edge, X - 2.2, .14, -1.2);
      const strip = new THREE.TorusGeometry(1.12, .012, 6, 64); strip.rotateX(Math.PI / 2); B.warm.add(strip, X - 2.2, .02, -1.2);
      const scope = new THREE.Mesh(new THREE.CircleGeometry(.82, 64), new THREE.ShaderMaterial({
        uniforms: radar,
        vertexShader: "varying vec2 p; void main(){ p = position.xy / .82; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }",
        fragmentShader: `uniform float time; varying vec2 p;
          void main(){ float r = length(p), a = atan(p.y, p.x), s = mod(a - time * 1.3, 6.2831853);
            vec3 c = vec3(.01,.05,.05) + vec3(.1,.85,.7) * exp(-s * 2.2) * .9;
            c += vec3(.1,.6,.5) * (smoothstep(.012, .0, abs(fract(r * 4.0 + .5) - .5) / 4.0) * .5 + smoothstep(.008, .0, abs(p.x)) * .35 + smoothstep(.008, .0, abs(p.y)) * .35);
            for (int i = 0; i < 5; i++) { float fi = float(i); vec2 b = vec2(cos(fi * 2.4 + 1.0), sin(fi * 2.4 + 1.0)) * (.25 + fract(fi * .37) * .6); float bs = mod(atan(b.y, b.x) - time * 1.3, 6.2831853); c += vec3(.5,1.6,1.2) * smoothstep(.05, .0, length(p - b)) * exp(-bs * 1.4); }
            gl_FragColor = vec4(c * 1.6, 1.0); }`,
      }));
      scope.position.set(X + BAY_W / 2 - .28, .92, -2.6); scope.rotation.y = -Math.PI / 2; scope.scale.setScalar(.72); group.add(scope);
      const bezel = new THREE.TorusGeometry(.62, .045, 8, 64); bezel.rotateY(Math.PI / 2); B.metal.add(bezel, X + BAY_W / 2 - .26, .92, -2.6);
      B.graphite.add(new THREE.BoxGeometry(.12, 1.42, 1.5), X + BAY_W / 2 - .2, .92, -2.6, 0, GLASS_BLACK);
    }
  }

  const materials = { shell, graphite, furniture: racks, desks, metal, gold, fabric, floor, warm, accent, amber, leds, blink, glass, props } as const;
  for (const [name, batch] of Object.entries(B) as [keyof typeof B, GeometryBatch][]) {
    const mesh = batch.mesh(materials[name]); mesh.receiveShadow = name !== "glass" && name !== "warm";
    mesh.castShadow = name === "furniture" || name === "desks" || name === "fabric"; group.add(mesh);
  }
  // soft light pools on the floor under each room's lit furniture, in the room's colour
  const pool = poolTexture(), POOLS: [number, number, number, number][][] = [
    [[0, -.2, 2.1, .8], [-1.7, -3.0, 1.0, .5], [1.7, -3.0, 1.0, .5], [-3.6, -.2, .9, .45], [3.6, -.2, .9, .45]],
    [[-3.4, -2.0, 1.0, .6], [0, -2.0, 1.0, .6], [3.4, -2.0, 1.0, .6], [-3.4, -.9, 1.0, .6], [0, -.9, 1.0, .6], [3.4, -.9, 1.0, .6], [5.4, -3.0, 1.1, .4],
      [-3.8, 2.75, 1.0, .6], [-1.4, 2.75, 1.0, .6], [1.4, 2.75, 1.0, .6], [3.8, 2.75, 1.0, .6]],
    [[-.5, -1.4, 1.9, .8], [5.2, -2.6, 1.2, .8], [-5.0, -3.15, 1.2, .35]],
    [[-2.2, -1.2, 1.6, .7], [5.3, -2.6, 1.3, .7], [1.3, -3.3, 1.0, .5], [-4.0, -3.0, .9, .45], [4.0, -2.6, .9, .45]],
  ];
  BACK.forEach((_, bay) => {
    const batch = new GeometryBatch();
    for (const [x, z, r, k] of POOLS[bay]!) batch.add(new THREE.PlaneGeometry(2 * r, 2 * r).rotateX(-Math.PI / 2), bayX(bay) + x, .012 + k * .001, z, 0, new THREE.Color(k, k, k));
    const mesh = batch.mesh(new THREE.MeshBasicMaterial({ map: pool, color: new THREE.Color(ROOM_GLOW[bay]).multiplyScalar(.5), vertexColors: true, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false }));
    mesh.renderOrder = -1; group.add(mesh);
  });
  const rug = new THREE.Mesh(new THREE.CircleGeometry(1.95, 48).rotateX(-Math.PI / 2), rugMaterial(onTexture));
  rug.position.set(bayX(2) - .5, .008, -1.4); rug.receiveShadow = true; group.add(rug);
  const chairs = new THREE.InstancedMesh(chairGeometry(), fabric, chairSeats.length); chairs.castShadow = chairs.receiveShadow = true; group.add(chairs);
  const matrix = new THREE.Matrix4(), q = new THREE.Quaternion(), up = new THREE.Vector3(0, 1, 0), at = new THREE.Vector3(), scale = new THREE.Vector3();
  /** Rolls a chair: 0 = tucked under its frog, 1 = pushed back. */
  function chair(seat: Seat, out: number) {
    const i = chairSeats.indexOf(seat); if (i < 0) return;
    const back = .42 + .55 * out;
    at.set(bayX(chairBays[i]!) + seat.at[0] - Math.sin(seat.face) * back, seat.y, seat.at[1] - Math.cos(seat.face) * back);
    matrix.compose(at, q.setFromAxisAngle(up, seat.face), seat.kind === "captain" ? scale.set(1.2, 1, 1.2) : scale.set(1, 1, 1)); chairs.setMatrixAt(i, matrix); chairs.instanceMatrix.needsUpdate = true;
  }
  chairSeats.forEach((s) => chair(s, 0));

  /** Live screens: the consoles' records, the wall roster, the game table and the pinball. */
  function draw(bay: number, all: Entry[], total: number, visible: (Entry | null)[], time: number) {
    const { atlas, wall } = screens[bay]!, c = atlas.c, now = new Date(), clock = now.toISOString().slice(11, 16);
    if (c) {
      for (let region = 0; region < 8; region++) {
        const x = (region % 2) * 512, y = (region >> 1) * 256, entry = region < 6 ? visible[region] ?? undefined : undefined, seed = hash(entry?.key ?? `${bay}:${region}`);
        const g = c.createLinearGradient(0, y, 0, y + 256); g.addColorStop(0, "#1d4a6e"); g.addColorStop(1, "#11304d"); c.fillStyle = g; c.fillRect(x, y, 512, 256);
        c.fillStyle = "#24577f"; c.fillRect(x, y, 512, 36); c.fillStyle = ACCENT[bay]!; c.fillRect(x, y, 6, 36);
        c.font = `500 17px ${MONO}`; c.textBaseline = "middle"; c.fillStyle = "#8fb0cc"; c.textAlign = "left";
        c.fillText(region < 6 ? `${CODES[bay]}-${String(region + 1).padStart(2, "0")}` : region === 6 ? `${CODES[bay]} / SYSTEMS` : `${CODES[bay]} / LOG`, x + 18, y + 18);
        const live = region >= 6 || !!entry; c.textAlign = "right"; c.fillStyle = live ? "#5fe3a1" : "#6c7c8c"; c.fillText(live ? "LIVE" : "STANDBY", x + 494, y + 18);
        if (live && Math.floor(time * 1.5) % 2) { c.beginPath(); c.arc(x + 482 - c.measureText("LIVE").width, y + 18, 4, 0, Math.PI * 2); c.fill(); }
        c.textAlign = "left"; c.textBaseline = "alphabetic";
        if (region < 6) {
          c.fillStyle = entry?.mine ? "#c7b4ee" : "#eaf1f7"; c.font = `600 31px ${SANS}`; c.fillText(fit(c, entry?.title ?? "Console free", 470), x + 20, y + 80);
          c.fillStyle = "#9db4c7"; c.font = `400 21px ${SANS}`; wrap(c, entry?.activity ?? "Waiting for crew", x + 20, y + 114, 470, 26, 2);
          const p = (time * .03 + (seed % 1000) / 1000) % 1; c.fillStyle = "#132a40"; c.fillRect(x + 20, y + 200, 300, 8); c.fillStyle = ACCENT[bay]!; c.fillRect(x + 20, y + 200, 300 * p, 8);
          c.fillStyle = "#6f8aa3"; c.font = `500 15px ${MONO}`; c.fillText(`${Math.round(p * 100)}%`, x + 330, y + 209);
          c.strokeStyle = "#47c1ff"; c.lineWidth = 2; c.beginPath();
          for (let k = 0; k <= 26; k++) { const v = Math.sin((k + time * 3) * .45 + seed) * .5 + Math.sin((k + time * 3) * 1.3 + seed * .7) * .3, px = x + 388 + k * 4, py = y + 205 - v * 18; if (k) c.lineTo(px, py); else c.moveTo(px, py); }
          c.stroke();
        } else if (region === 6) {
          for (let k = 0; k < 4; k++) {
            const v = .35 + .55 * (Math.sin(time * .5 + k * 1.7 + bay) * .5 + .5); c.fillStyle = "#6f8aa3"; c.font = `500 15px ${MONO}`; c.fillText(["POWER", "LIFE SUPPORT", "COMMS", "THERMAL"][k]!, x + 20, y + 74 + k * 42);
            c.fillStyle = "#132a40"; c.fillRect(x + 170, y + 62 + k * 42, 300, 14); c.fillStyle = k === 3 ? "#e0a54a" : "#47c1ff"; c.fillRect(x + 170, y + 62 + k * 42, 300 * v, 14);
          }
        } else {
          c.font = `400 16px ${MONO}`;
          for (let k = 0; k < 7; k++) { const e = all.length ? all[(Math.floor(time / 2) + k) % all.length]! : null; c.fillStyle = k === 6 ? "#e6eef6" : "#7f99b1"; c.fillText(fit(c, `${clock}  ${e ? `${e.title}: ${e.activity}` : "All systems nominal"}`, 470), x + 20, y + 66 + k * 27); }
        }
      }
      atlas.map.needsUpdate = true;
    }
    const w = wall.c;
    if (w) {
      w.fillStyle = "#060c14"; w.fillRect(0, 0, 1024, 576); w.fillStyle = "#0e1d2e"; w.fillRect(0, 0, 1024, 70); w.fillStyle = ACCENT[bay]!; w.fillRect(0, 0, 8, 70);
      w.textBaseline = "middle"; w.fillStyle = "#e9eff5"; w.font = `600 32px ${SANS}`; w.fillText(BAYS[bay]!.name, 30, 36);
      w.textAlign = "right"; w.fillStyle = "#8fb0cc"; w.font = `500 21px ${MONO}`; w.fillText(`${clock} UTC  /  ${total.toLocaleString("en-US")} ON RECORD`, 994, 37); w.textAlign = "left";
      const rows = all.slice(0, 8);
      rows.forEach((e, k) => {
        const y = 104 + k * 54; w.fillStyle = k % 2 ? "#08111c" : "#0a1522"; w.fillRect(16, y - 24, 992, 50);
        w.fillStyle = e.mine ? "#b9a6d6" : e.kind === "frog" && e.frog?.mission && !e.frog.mission.done ? "#e0a54a" : "#5fe3a1"; w.beginPath(); w.arc(40, y, 6, 0, Math.PI * 2); w.fill();
        w.fillStyle = "#e6eef6"; w.font = `600 23px ${SANS}`; w.fillText(fit(w, e.title, 300), 62, y);
        w.fillStyle = "#94abc0"; w.font = `400 21px ${SANS}`; w.fillText(fit(w, e.activity, 620), 372, y);
      });
      if (!rows.length) { w.fillStyle = "#7f99b1"; w.font = `400 24px ${SANS}`; w.fillText("Reading live station data", 30, 140); }
      w.fillStyle = "#5d7488"; w.font = `500 18px ${MONO}`; w.fillText(BAYS[bay]!.line.toUpperCase(), 30, 552);
      wall.map.needsUpdate = true;
    }
    const board = tables[bay];
    if (board?.c) {
      const b = board.c, game = all.find((e) => e.kind === "game"), r = seeded(hash(game?.key ?? "table"));
      b.fillStyle = "#0b1018"; b.fillRect(0, 0, 512, 512);
      for (let i = 0; i < 8; i++) for (let j = 0; j < 8; j++) { b.fillStyle = (i + j) % 2 ? "#1d2633" : "#3a4658"; b.fillRect(64 + i * 48, 64 + j * 48, 48, 48); }
      for (let k = 0; k < 18; k++) { b.fillStyle = k % 2 ? "#e9e2cf" : "#a58bff"; b.beginPath(); b.arc(88 + (r() * 8 | 0) * 48, 88 + (r() * 8 | 0) * 48, 15, 0, Math.PI * 2); b.fill(); }
      b.fillStyle = "#c9d6e3"; b.font = `600 26px ${SANS}`; b.textAlign = "center"; b.textBaseline = "middle"; b.fillText(fit(b, game ? game.title.toUpperCase() : "TABLE OPEN", 420), 256, 34);
      b.font = `500 20px ${MONO}`; b.fillStyle = game ? "#5fe3a1" : "#7f99b1"; b.fillText(fit(b, game ? `${game.activity}  /  LIVE` : "NO LIVE GAME", 440), 256, 482); b.textAlign = "left";
      board.map.needsUpdate = true;
    }
    const pin = pinballs[bay];
    if (pin?.c) {
      const p = pin.c; p.fillStyle = "#06070d"; p.fillRect(0, 0, 512, 1024);
      p.fillStyle = "#120c22"; p.fillRect(0, 0, 512, 256); p.fillStyle = "#ffcf6b"; p.font = `700 64px ${MONO}`; p.textAlign = "center"; p.textBaseline = "middle";
      p.fillText(String(Math.floor(1_240_000 + time * 3170)).replace(/\B(?=(\d{3})+(?!\d))/g, ","), 256, 100); p.fillStyle = "#a58bff"; p.font = `600 36px ${SANS}`; p.fillText("NIGHT PINBALL", 256, 190);
      p.strokeStyle = "#a58bff"; p.lineWidth = 8; p.beginPath(); p.arc(256, 560, 150, Math.PI * .1, Math.PI * .9, true); p.stroke();
      for (const [x, y, col] of [[170, 520, "#5fd0ff"], [350, 500, "#ff6f91"], [256, 420, "#ffcf6b"]] as const) { p.fillStyle = col; p.beginPath(); p.arc(x, y, 34, 0, Math.PI * 2); p.fill(); }
      p.fillStyle = "#f2f4f8"; p.beginPath(); p.arc(256 + Math.sin(time * 2.3) * 150, 640 + Math.cos(time * 1.7) * 190, 13, 0, Math.PI * 2); p.fill();
      p.strokeStyle = "#5fe3a1"; p.lineWidth = 12; p.beginPath(); p.moveTo(150, 930); p.lineTo(236, 975); p.moveTo(362, 930); p.lineTo(276, 975); p.stroke(); p.textAlign = "left";
      pin.map.needsUpdate = true;
    }
  }

  let clock = 0;
  return {
    group, chair, draw, ready: Promise.all(patches.map((p) => p.ready)),
    /** The night-side Earth in the panoramic windows: a crop of the Black Marble map, city lights up. */
    windows(map: THREE.Texture) {
      const view = map.clone(); view.repeat.set(.16, .09); view.offset.set(.47, .66); view.needsUpdate = true;
      glass.map = view; glass.color.setRGB(1.5, 1.5, 1.7); glass.needsUpdate = true;
    },
    update(dt: number, time: number) {
      radar.time.value = time; clock += dt;
      for (const holo of holograms) {
        holo.children[0]!.rotation.y = time * .25;
        for (const orbit of holo.children) for (const dot of orbit.children) { const curve = dot.userData.curve as THREE.EllipseCurve | undefined; if (curve) { const p = curve.getPoint((time * (dot.userData.speed as number) * .1) % 1); dot.position.set(p.x, 0, p.y); } }
      }
      blink.color.setScalar(Math.sin(clock * 5.3) > -.2 && Math.sin(clock * 1.7) > -.6 ? 2.2 : .5);
    },
    dispose() {
      patches.forEach((p) => p.cancel());
      const geometries = new Set<THREE.BufferGeometry>(), all = new Set<THREE.Material>(), textures = new Set<THREE.Texture>();
      group.traverse((o) => {
        const m = o as THREE.Mesh; if (m.geometry) geometries.add(m.geometry);
        if (m.material) for (const x of Array.isArray(m.material) ? m.material : [m.material]) { all.add(x); Object.values(x).forEach((v) => { if (v instanceof THREE.Texture) textures.add(v); }); }
      });
      geometries.forEach((g) => g.dispose()); all.forEach((m) => m.dispose()); textures.forEach((t) => t.dispose()); chairs.dispose();
    },
  };
}
