import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { BAZAAR_MAX_ROWS, BazaarIndex } from "./bazaar-index.js";

const terms = { scheme: "exact", network: "base", asset: "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913", payTo: "0x1111111111111111111111111111111111111111", amount: "1000" };
const page = (offset: number) => ({ items: Array.from({ length: 1000 }, (_, i) => ({ resource: `https://seller${offset + i}.test/api`, accepts: [terms], description: "x".repeat(900) })), pagination: { total: 120_000, offset, limit: 1000 } });

describe("Bazaar index size", () => {
  it("stops at the cap and keeps each listing small", async () => {
    const file = join(mkdtempSync(join(tmpdir(), "bazaar-cap-")), "bazaar-index.json");
    const net = { json: vi.fn(async (url: string) => page(Number(new URL(url).searchParams.get("offset")))) };
    const index = new BazaarIndex(net as never, file, () => 1_000, async () => {});
    await index.refresh();
    const snapshot = await index.snapshot();
    expect(Object.keys(snapshot.byResource)).toHaveLength(BAZAAR_MAX_ROWS);
    expect(net.json).toHaveBeenCalledTimes(BAZAAR_MAX_ROWS / 1000);
    expect(Object.values(snapshot.byResource)[0]!.description.length).toBeLessThanOrEqual(240);
  });

  it("skips a saved index too large to load safely, and starts a fresh pass", async () => {
    const file = join(mkdtempSync(join(tmpdir(), "bazaar-big-")), "bazaar-index.json");
    writeFileSync(file, `{"version":1,"updatedAt":1,"byResource":{},"pad":"${"x".repeat(50 * 1024 * 1024)}"}`);
    const index = new BazaarIndex({ json: vi.fn() } as never, file, () => 1_000, async () => {});
    expect((await index.snapshot()).updatedAt).toBe(0);
  });
});
