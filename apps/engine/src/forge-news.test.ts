import { describe, expect, it } from "vitest";
import { evolveText } from "./forge-news.js";

const ids = [184, 185, 186, 189, 190, 78, 80, 81, 82, 86];
describe("the evolve announcement", () => {
  it("says what came out of the forge, from which frogs, and how many of the 50 are left", () => {
    const t = evolveText({ n: 7, tier: 3, points: 50, inputs: ids, traits: [0, 0, 0, 0, 0, 0, 0], forgedAt: 0, name: "" }, 7);
    expect(t).toContain("NIGHT FROGS JUST EVOLVED");
    expect(t).toContain("<b>Night Watcher #7</b> came out: <b>Tier III · Supervisor</b>, 20x shift hours.");
    expect(t).toContain("Forged from #184 #185 #186 #189 #190 #78 #80 #81 #82 #86 · 1 $IMD burned");
    expect(t).toContain("7 of 50 forged · <b>43 left</b>");
    expect(evolveText({ n: 50, tier: 1, points: 10, inputs: ids, traits: [0, 0, 0, 0, 0, 0, 0], forgedAt: 0, name: "" }, 50)).toContain("All 50 Night Watchers are forged.");
  });
  it("crowns The Captain without a count", () => {
    const t = evolveText({ n: 0, tier: 6, points: 128, inputs: [1, ...ids.slice(1)], traits: [0, 0, 0, 0, 0, 0, 0], forgedAt: 0, name: "" }, 3);
    expect(t).toContain("THE CAPTAIN HAS BEEN FORGED");
    expect(t).not.toContain("left");
  });
});
