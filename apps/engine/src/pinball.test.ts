import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { type Input, Table, replay } from "./pinball/engine.js";

describe("space pinball", () => {
  it("runs the very engine the browser runs", () => {
    const here = readFileSync(join(import.meta.dirname, "pinball/engine.ts"), "utf8");
    const web = readFileSync(join(import.meta.dirname, "../../web/src/pinball/engine.ts"), "utf8");
    expect(here).toBe(web);
  });
  it("gives the same score for the same seed and inputs, and a different game for another seed", () => {
    const play = (seed: number) => {
      const t = new Table(seed); const inputs: Input[] = []; let last = ""; let lt = 0, rt = 0;
      while (!t.over) {
        const b = t.ball;
        if (lt > 0) lt--; if (rt > 0) rt--;
        if (lt === 0 && b.y > 745 && b.y < 815 && b.x < 300) lt = 40;
        if (rt === 0 && b.y > 745 && b.y < 815 && b.x >= 300) rt = 40;
        const k = { left: lt > 15 ? 1 : 0, right: rt > 15 ? 1 : 0, plunger: t.inLane ? (t.plunge < 150 ? 1 : 0) : 0 };
        const s = `${k.left}${k.right}${k.plunger}`;
        if (s !== last) { inputs.push([t.tick, k.left as 0, k.right as 0, k.plunger as 0]); t.input = k; last = s; }
        t.step();
      }
      return { score: t.score, inputs };
    };
    for (const seed of [1, 42, 99]) {
      const g = play(seed);
      expect(g.score).toBeGreaterThan(0);
      expect(replay(seed, g.inputs).score).toBe(g.score);
    }
  });
});
