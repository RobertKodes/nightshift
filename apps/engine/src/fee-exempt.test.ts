import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import type * as EngineModule from "./engine.js";

let E: typeof EngineModule;
beforeAll(async () => {
  process.env.DATA_DIR = mkdtempSync(join(tmpdir(), "fee-exempt-test-"));
  E = await import("./engine.js");
  // the whole engine loads here: slow while the other test files run beside it
}, 60_000);

describe("the holders' fee waiver", () => {
  it("waives the fee only for a wallet seen eligible for 7 days without a gap", () => {
    const since = new Map<string, number>(), day = 86_400_000, w = "0xAbC0000000000000000000000000000000000001";
    // tokens borrowed for the one withdrawal: no waiver
    expect(E.feeExemptAfter(since, w, true, 0)).toEqual({ exempt: false, changed: true });
    expect(E.feeExemptAfter(since, w, true, 7 * day - 1).exempt).toBe(false);
    expect(E.feeExemptAfter(since, w.toLowerCase(), true, 7 * day)).toEqual({ exempt: true, changed: false });
    // seen without them once: the week starts over
    expect(E.feeExemptAfter(since, w, false, 8 * day)).toEqual({ exempt: false, changed: true });
    expect(E.feeExemptAfter(since, w, true, 9 * day).exempt).toBe(false);
    expect(E.feeExemptAfter(since, w, true, 16 * day).exempt).toBe(true);
    expect(E.feeExemptAfter(since, "0x0000000000000000000000000000000000000002", false, 0)).toEqual({ exempt: false, changed: false });
    expect(E.FEE_EXEMPT_AFTER_MS).toBe(7 * day);
  });
});
