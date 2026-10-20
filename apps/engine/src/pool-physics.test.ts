import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { type Ball, BREAK_SPOT, CONTACT, EV, FOOT_X, FOOT_Y, HEAD_Y, JAWS, L, LINES, POCKETED, POCKETS, R, ROLL, Replay, SLIDE, STILL, type Shot, W, aimAt, play, dexp, duration, motion, rack, simulate, sincos, spot, still, strike, validShot } from "./pool/physics.js";
import { mdeg } from "./pool/bot.js";

const shot = (aim: number, power: number, spinX = 0, spinY = 0, elevation = 0): Shot => ({ aim, power, spinX, spinY, elevation });
const speed = (b: Ball) => Math.hypot(b.vx, b.vy);
/** Translational and rotational kinetic energy of every ball on the cloth. */
const energy = (balls: Ball[]) => balls.filter((b) => b.s !== POCKETED).reduce((e, b) => e + 0.5 * 0.170097 * (b.vx * b.vx + b.vy * b.vy) + 0.5 * 0.4 * 0.170097 * R * R * (b.wx * b.wx + b.wy * b.wy + b.wz * b.wz), 0);
const breakShot = (b: Ball[]) => shot(mdeg(FOOT_X - b[0]!.x, FOOT_Y - b[0]!.y), 1000);
/** Inside no cushion and no jaw (a ball may rest in a pocket's mouth, past the line of the rails). */
const onCloth = (b: Ball) => b.x > -0.06 && b.x < W + 0.06 && b.y > -0.06 && b.y < L + 0.06
  && LINES.every(([x1, y1, x2, y2, nx, ny]) => { const sx = x2 - x1, sy = y2 - y1, u = ((b.x - x1) * sx + (b.y - y1) * sy) / (sx * sx + sy * sy); return u < 0 || u > 1 || nx * (b.x - x1) + ny * (b.y - y1) >= CONTACT - 1e-6; })
  && JAWS.every(([x, y, r]) => Math.hypot(b.x - x, b.y - y) >= r + R - 1e-6);
const hash = (v: unknown) => createHash("sha256").update(JSON.stringify(v)).digest("hex");

describe("NIGHT POOL physics", () => {
  it("is the very file the browser runs, and the rules, the catalogue and the bot too", () => {
    for (const f of ["physics.ts", "rules.ts", "catalog.ts", "bot.ts", "LICENSE-pooltool.txt"]) {
      expect(readFileSync(join(import.meta.dirname, "../../web/src/pool", f), "utf8"), f).toBe(readFileSync(join(import.meta.dirname, "pool", f), "utf8"));
    }
  });
  it("uses only exactly rounded arithmetic at run time: no trigonometry, exp, pow or randomness", () => {
    const src = readFileSync(join(import.meta.dirname, "pool/physics.ts"), "utf8").replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, "");
    expect(src).not.toMatch(/Math\.(sin|cos|tan|asin|acos|atan|atan2|exp|expm1|log|log1p|log2|log10|pow|hypot|cbrt|sinh|cosh|tanh|random|fround)\b/);
    expect(src).not.toMatch(/\*\*/);
    expect(src).not.toMatch(/Date\.now|performance\.now/);
  });
  it("its own sine, cosine and exponential agree with the platform's to the last bits", () => {
    for (let k = 0; k < 360000; k += 977) {
      const [s, c] = sincos(k), a = k * Math.PI / 180000;
      expect(Math.abs(s - Math.sin(a))).toBeLessThan(2e-15);
      expect(Math.abs(c - Math.cos(a))).toBeLessThan(2e-15);
    }
    expect(sincos(0)).toEqual([0, 1]);
    expect(sincos(90000)).toEqual([1, -0]);
    for (const x of [-20, -5.5, -1.088, -0.01, 0, 0.3, 4.2]) expect(Math.abs(dexp(x) / Math.exp(x) - 1)).toBeLessThan(1e-14);
  });
  it("plays the same shot the same way every time (same frames, same resting balls)", () => {
    const run = () => simulate(rack(42), { aim: 90321, power: 965, spinX: 40, spinY: -120, elevation: 3000 });
    const a = run(), b = run();
    expect(b).toEqual(a);
    expect(hash(b)).toBe(hash(a));
    // the golden break: a change to the physics shows here (and must be deliberate, for the server and every browser alike)
    expect(hash(simulate(rack(7), breakShot(rack(7))).balls.map((x) => [x.id, x.x, x.y, x.s]))).toBe(GOLDEN);
  });
  it("racks the WPA way: the apex on the foot spot, the 8 in the middle of the third row, a solid and a stripe in the back corners", () => {
    for (const seed of [1, 2, 3, 99, 12345]) {
      const b = rack(seed), byId = new Map(b.map((x) => [x.id, x]));
      expect(b.map((x) => x.id)).toEqual([...Array(16).keys()]);
      const objects = b.filter((x) => x.id > 0).sort((p, q) => p.y - q.y || p.x - q.x);
      expect(Math.hypot(objects[0]!.x - FOOT_X, objects[0]!.y - FOOT_Y)).toBeLessThan(0.0002);
      const eight = byId.get(8)!;
      expect(Math.abs(eight.x - FOOT_X)).toBeLessThan(0.0002);
      expect(eight.y - FOOT_Y).toBeGreaterThan(3.4 * R);
      const back = objects.slice(10).sort((p, q) => p.x - q.x);
      expect([back[0]!.id < 8, back[4]!.id < 8].sort()).toEqual([false, true]);
      // tight, never overlapping
      for (const p of objects) for (const q of objects) if (p.id < q.id) expect(Math.hypot(p.x - q.x, p.y - q.y)).toBeGreaterThan(2 * R);
      expect(Math.min(...objects.filter((q) => q !== objects[0]).map((q) => Math.hypot(q.x - objects[0]!.x, q.y - objects[0]!.y)))).toBeLessThan(2 * R + 0.0004);
      expect(byId.get(0)!.y).toBeLessThan(HEAD_Y);
    }
    // a different seed, a different rack
    expect(rack(1).map((x) => [x.x, x.y])).not.toEqual(rack(2).map((x) => [x.x, x.y]));
  });
  it("a centre-ball hit slides, then rolls at 5/7 of its speed; a rolling ball stops after v²/(2·μr·g)", () => {
    const hit = strike(still(0, W / 2, 0.3), shot(90000, 300));
    expect(hit.s).toBe(SLIDE);
    const v0 = speed(hit);
    const rolled = motion(hit, duration(hit));
    expect(speed(rolled) / v0).toBeCloseTo(5 / 7, 3);
    const roll = { ...rolled, s: ROLL };
    const d = speed(roll) ** 2 / (2 * 0.01 * 9.81);
    const end = motion(roll, duration(roll));
    expect(Math.hypot(end.x - roll.x, end.y - roll.y)).toBeCloseTo(d, 6);
    expect(speed(end)).toBeLessThan(1e-9);
  });
  it("a stun shot stops the cue ball dead and sends the object ball on (restitution 0.95)", () => {
    const r = simulate([still(0, W / 2, 0.4), still(1, W / 2, 0.9)], shot(90000, 250, 0, -260));
    const hitFrame = r.frames.find((f) => f.k === EV.BALL)!;
    const [cue, obj] = [hitFrame.balls.find((b) => b.id === 0)!, hitFrame.balls.find((b) => b.id === 1)!];
    const before = new Replay([still(0, W / 2, 0.4), still(1, W / 2, 0.9)], r.frames.filter((f) => f.t < hitFrame.t)).at(hitFrame.t - 1e-9)[0]!;
    expect(speed(cue)).toBeLessThan(0.1 * speed(before));
    expect(obj.vy / before.vy).toBeGreaterThan(0.9);
    expect(obj.vy / before.vy).toBeLessThan(0.99);
  });
  it("draw comes back, follow goes through", () => {
    const start = () => [still(0, W / 2, 0.4), still(1, W / 2, 0.9)];
    const draw = simulate(start(), shot(90000, 380, 0, -450)), follow = simulate(start(), shot(90000, 380, 0, 450));
    // the cue ball's path right after the contact
    const after = (r: ReturnType<typeof simulate>) => new Replay(start(), r.frames).at(r.frames.find((f) => f.k === EV.BALL)!.t + 0.6)[0]!;
    expect(after(draw).y).toBeLessThan(0.9 - 2 * R - 0.05);
    expect(after(follow).y).toBeGreaterThan(0.9 - 2 * R + 0.05);
  });
  it("side spin changes the bounce off a cushion, and squirt pushes the cue ball away from the side struck", () => {
    // a ball rolling at 60° into the right-hand rail, with spin about the vertical: running english (clockwise
    // here) throws it longer off the rail; reverse english meets friction that is already saturated (Han 2005)
    const out = (wz: number) => {
      const v = 1.2, vx = v * 0.5, vy = v * Math.sqrt(3) / 2;
      const r = play([{ id: 0, x: W / 2, y: 0.5, vx, vy, wx: -vy / R, wy: vx / R, wz, s: ROLL }]);
      const b = r.frames.find((f) => f.k === EV.RAIL)!.balls[0]!;
      return 180 - Math.atan2(b.vy, b.vx) * 180 / Math.PI;
    };
    const plain = out(0), running = out(-60), reverse = out(60);
    expect(running - plain).toBeGreaterThan(2);
    expect(reverse).toBeLessThan(running - 2);
    expect(plain).toBeLessThan(64); // a plain rolling ball comes off a little longer than the mirror angle (60°)
    // right english: the ball leaves a little to the left of the aim (counter-clockwise)
    const sq = strike(still(0, W / 2, 0.5), shot(90000, 500, 400, 0));
    expect(Math.atan2(sq.vy, sq.vx)).toBeGreaterThan(Math.PI / 2);
    expect(Math.atan2(sq.vy, sq.vx) - Math.PI / 2).toBeLessThan(0.05);
  });
  it("a cushion gives back less than it got, and reflects a plain ball at the angle it came in", () => {
    const r = simulate([still(0, W / 2, 0.5)], shot(0, 300));
    const hit = r.frames.find((f) => f.k === EV.RAIL)!;
    const before = new Replay([still(0, W / 2, 0.5)], r.frames.filter((f) => f.t < hit.t)).at(hit.t)[0]!;
    const after = hit.balls[0]!;
    expect(-after.vx / before.vx).toBeGreaterThan(0.5);
    expect(-after.vx / before.vx).toBeLessThan(0.95);
    expect(Math.abs(after.vy)).toBeLessThan(1e-9);
  });
  it("never adds energy after the stroke, never overlaps two balls, keeps every ball on the cloth", () => {
    for (let s = 0; s < 40; s++) {
      const b = rack(s * 31 + 5);
      b[0]!.x = 0.15 + (s % 7) * 0.11;
      const r = simulate(b, { ...breakShot(b), spinX: (s % 5) * 60 - 120, spinY: (s % 3) * 150 - 150, elevation: (s % 4) * 1500 });
      expect(r.truncated).toBe(false);
      const rp = new Replay(b, r.frames);
      let last = Infinity;
      for (const f of r.frames.slice(1)) {
        const e = energy(rp.at(f.t));
        // V_SEP (the parting speed against endless re-collisions) may add a few microjoules
        expect(e).toBeLessThan(last + 1e-4);
        last = e;
      }
      for (const p of r.balls) {
        if (p.s === POCKETED) continue;
        expect(p.s).toBe(STILL);
        expect(onCloth(p)).toBe(true);
        for (const q of r.balls) if (q.id > p.id && q.s !== POCKETED) expect(Math.hypot(p.x - q.x, p.y - q.y)).toBeGreaterThan(2 * R - 1e-9);
      }
    }
  });
  it("breaks like a real rack: most of the balls reach a rail, and a full break is legal", () => {
    let legal = 0, rails = 0;
    for (let s = 0; s < 50; s++) {
      const b = rack(s + 100), r = simulate(b, breakShot(b));
      const hit = new Set(r.frames.filter((f) => (f.k === EV.RAIL || f.k === EV.JAW) && f.a > 0).map((f) => f.a));
      const down = r.frames.filter((f) => f.k === EV.POCKET && f.a > 0).length;
      rails += hit.size;
      if (down > 0 || hit.size >= 4) legal++;
    }
    expect(legal).toBeGreaterThanOrEqual(48);
    expect(rails / 50).toBeGreaterThan(8);
  });
  it("pockets a straight shot in each of the six pockets", () => {
    for (let k = 0; k < 6; k++) {
      const [px, py] = POCKETS[k]!, cx = W / 2, cy = L / 2, d = Math.hypot(cx - px, cy - py), ux = (cx - px) / d, uy = (cy - py) / d;
      const ox = px + ux * 0.35, oy = py + uy * 0.35, qx = ox + ux * 0.3, qy = oy + uy * 0.3;
      const r = simulate([still(0, qx, qy), still(1, ox, oy)], shot(mdeg(ox - qx, oy - qy), 260));
      expect(r.frames.some((f) => f.k === EV.POCKET && f.a === 1 && f.b === k), `pocket ${k}`).toBe(true);
    }
  });
  it("replays keyframes exactly: the replay's end is the simulation's end", () => {
    const b = rack(9), r = simulate(b, breakShot(b));
    const end = new Replay(b, r.frames).at(r.duration);
    for (const x of r.balls) {
      const y = end.find((q) => q.id === x.id)!;
      if (x.s === POCKETED) { expect(y.s).toBe(POCKETED); continue; }
      expect(y.x).toBe(x.x); expect(y.y).toBe(x.y);
    }
  });
  it("checks the limits of a shot", () => {
    expect(validShot(shot(0, 0))).toBe(true);
    expect(validShot(shot(359999, 1000, 300, -400, 60000))).toBe(true);
    expect(validShot(shot(360000, 10))).toBe(false);
    expect(validShot(shot(10, 1001))).toBe(false);
    expect(validShot(shot(10.5, 10))).toBe(false);
    expect(validShot(shot(10, 10, 400, 400))).toBe(false); // the tip off the ball: a miscue
    expect(validShot(shot(10, 10, 0, 0, 60001))).toBe(false);
  });
  it("spots a ball on the foot spot, or against the ball in the way behind it (WPA 1.5)", () => {
    expect(spot([], 8)).toEqual({ x: FOOT_X, y: FOOT_Y });
    const blocked = spot([still(3, FOOT_X, FOOT_Y)], 8);
    expect(blocked.x).toBe(FOOT_X);
    expect(blocked.y).toBeCloseTo(FOOT_Y + 2 * R, 6);
    // next to the cue ball: a small gap, never touching it
    const byCue = spot([still(0, FOOT_X, FOOT_Y)], 8);
    expect(byCue.y - FOOT_Y).toBeGreaterThan(2 * R + 0.001);
  });
  it("draws the aim guide from geometry: the ghost ball touches the first ball on the line", () => {
    const balls = [still(0, W / 2, 0.4), still(1, W / 2 + 0.01, 1.0), still(2, W / 2, 1.5)];
    const a = aimAt(balls, 90000);
    expect(a.hit).toEqual({ kind: "ball", id: 1 });
    expect(Math.hypot(a.ghost.x - balls[1]!.x, a.ghost.y - balls[1]!.y)).toBeCloseTo(2 * R, 9);
    expect(Math.hypot(a.object!.x, a.object!.y)).toBeCloseTo(1, 9);
    // the cue ball leaves at a right angle to the object ball
    expect(a.cue!.x * a.object!.x + a.cue!.y * a.object!.y).toBeCloseTo(0, 9);
    const rail = aimAt([still(0, W / 2, 0.4)], 0);
    expect(rail.hit).toEqual({ kind: "rail" });
    expect(rail.ghost.x).toBeCloseTo(W - CONTACT, 9);
  });
  it("starts the break from the kitchen", () => { expect(BREAK_SPOT.y).toBeLessThan(HEAD_Y); });
});

const GOLDEN = "b4e14f41ac97b04e772386d56915193212e69c082ad83c77e2f3f817aed54dbb";
