import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import { config } from "./config.js";
import { cleanName } from "./poker.js";
import { resetPlayers, saveName, savedName } from "./players.js";

const A = "0xAAaa00000000000000000000000000000000aaaa", B = "0xbbbb00000000000000000000000000000000bbbb";

describe("player names", () => {
  beforeEach(() => { (config as { dataDir: string }).dataDir = mkdtempSync(join(tmpdir(), "players-")); resetPlayers(); });

  it("saves one name per wallet, and every game seats the player under it", () => {
    expect(saveName(A, "  Anna  ")).toBe("Anna");
    expect(savedName(A.toLowerCase())).toBe("Anna");
    // whatever name a link or another game sent, the saved one is used
    expect(cleanName("Frog-7F3A", A)).toBe("Anna");
    expect(cleanName("Guest", null)).toBe("Guest");
    resetPlayers();
    expect(savedName(A)).toBe("Anna");
  });

  it("keeps a name to one wallet, and refuses names that read as ours", () => {
    saveName(A, "Anna");
    expect(() => saveName(B, "anna")).toThrow(/taken/);
    expect(saveName(A, "anna")).toBe("anna");
    expect(() => saveName(B, "NIGHTSHIFT Admin")).toThrow(/Pick a name/);
    expect(() => saveName(B, "   ")).toThrow(/Pick a name/);
  });
});
