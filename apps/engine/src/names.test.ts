import { describe, expect, it } from "vitest";
import { publicName, reserved } from "./names.js";

describe("public names", () => {
  it("refuses the project, IMD and staff however they are spelled", () => {
    for (const n of [
      "i.m.d", "I-M-D", "I M D", "imdteam", "teamimd", "IMDdev", "lMD", "1MD", "Nlghtshift", "N1ght Sh1ft", "NIGHTSHIFT", "nightshiftt", "Night-Shift", "nighshift", "Niteshift",
      "IMD Official", "imd team", "Admin Support", "NIGHTSHIFT Team", "admin", "ADM1N", "suppport", "Moderator", "the mods", "dev", "Team", "staff", "getnightshift",
      "ｉｍｄ", "i​md", "ad‍min", "I|MD", "imd.fun", "the imd guy", "x i m d",
    ]) expect(publicName(n, { max: 18 }), n).toBeNull();
  });
  it("refuses what the community guard deletes", () => {
    for (const n of ["free airdrop", "dm me", "kys", "seed phrase"]) expect(publicName(n, { max: 18 }), n).toBeNull();
  });
  it("keeps ordinary names, cleaned", () => {
    for (const n of ["Night Rook", "Kodes Agent", "Lime", "Admiral", "Pearl Bot", "Obsidian Bot", "Night crew", "Alice", "Bob", "Moonwalker", "Devon", "Teamster", "Grimdark", "Jim Davis", "Timdale"]) expect(publicName(n, { max: 18 }), n).toBe(n);
    expect(publicName("  <Pearl!>  ", { max: 18 })).toBe("Pearl");
    expect(publicName("Ｌｉｍｅ", { max: 18 })).toBe("Lime");
    expect(publicName("a".repeat(30), { max: 18 })).toBe("a".repeat(18));
    expect(publicName("", { max: 18 })).toBeNull();
    expect(publicName("...", { max: 18 })).toBeNull();
    expect(publicName(undefined, { max: 18 })).toBeNull();
  });
  it("reads a name the way it looks", () => {
    expect(reserved("Adm1n")).toBe(true);
    expect(reserved("Admiral")).toBe(false); // "admi", not "admin"
  });
});
