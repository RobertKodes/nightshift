import { describe, expect, it } from "vitest";
import type { Forged } from "./forge.js";
import { forgeText, tierFrom, watcherText } from "./forge-bot.js";
import { seconds, svgAt, valueAt } from "./forge-gif.js";

const now = Date.parse("2026-10-24T12:00:00Z");
const f = (n: number, tier: number, hoursAgo: number, inputs = Array.from({ length: 10 }, (_, i) => 300 + n * 10 + i)): Forged => ({ n, tier, points: tier * 12, inputs, traits: [], forgedAt: now - hoursAgo * 3_600_000, name: "" });

describe("/forge in Telegram", () => {
  it("adds up the forge: forged, left, burned, tiers, the newest", () => {
    const all = [f(1, 3, 50), f(2, 2, 40), f(3, 3, 30), f(4, 3, 20), f(5, 1, 2)];
    const t = forgeText(all, now);
    expect(t).toContain("<b>5</b> of 50 forged · <b>45 left</b>");
    expect(t).toContain("<b>50</b> NIGHT FROGS burned forever");
    expect(t).toContain("III Supervisor ×3 · II Foreman ×1 · I Shift Lead ×1");
    expect(t).toContain("Newest: <b>Night Watcher #5</b>, Tier I · Shift Lead, 2 h ago");
  });

  it("tells one Night Watcher in full", () => {
    const all = [f(1, 3, 50), f(5, 1, 2)];
    const t = watcherText(all[0]!, all, now);
    expect(t).toContain("NIGHT WATCHER #1");
    expect(t).toContain("Tier III · Supervisor");
    expect(t).toMatch(/shift hours every hour · #1 of 2 by earning/);
    expect(t).toContain("+50% for every other NIGHT FROG");
  });

  it("reads a tier however it is typed", () => {
    expect(tierFrom("3")).toBe(3);
    expect(tierFrom("tier iv")).toBe(4);
    expect(tierFrom("boss")).toBe(5);
    expect(tierFrom("Supervisor")).toBe(3);
    expect(tierFrom("lead")).toBe(1);
    expect(tierFrom("purple")).toBeNull();
  });
});

describe("a Night Watcher's frames", () => {
  it("reads an animation's value at a moment", () => {
    const el = (a: Record<string, string>) => ({ getAttribute: (k: string) => a[k] ?? null });
    expect(seconds("1.5s")).toBe(1.5);
    expect(seconds("800ms")).toBe(0.8);
    expect(valueAt(el({ values: "0;1;0", dur: "4s" }), 1)).toBe("0.5");
    expect(valueAt(el({ values: "0 0;0 -280", dur: "4s" }), 2)).toBe("0 -140");
    // it loops, and a late begin shifts it
    expect(valueAt(el({ values: "0;10", dur: "2s" }), 3)).toBe("5");
    expect(valueAt(el({ values: "0;10", dur: "2s", begin: "1s" }), 1)).toBe("0");
  });

  it("writes each animation's value onto its element and leaves none behind", () => {
    const svg = `<svg viewBox="0 0 10 10"><g transform="translate(1 1)"><circle r="1" opacity="1"><animate attributeName="opacity" values="0;1" dur="2s" repeatCount="indefinite"/></circle><animateTransform attributeName="transform" type="translate" values="0 0;0 -10" dur="2s" repeatCount="indefinite"/></g></svg>`;
    const out = svgAt(svg, 1);
    expect(out).not.toMatch(/<animate/);
    expect(out).toContain(`<circle r="1" opacity="0.5">`);
    expect(out).toContain(`<g transform="translate(0 -5)">`);
  });
});
