import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { b58decode, b58encode, curveOf, decodeCurve, isSolAddress, poolOf, pumpService, type SolRpc } from "./omni.js";

/** Mainnet answers recorded on 2026-10-22 (src/fixtures/omni): a graduated pump.fun coin and a coin still on its curve. */
const fx = (n: string) => JSON.parse(readFileSync(join(import.meta.dirname, "fixtures", "omni", `${n}.json`), "utf8")).result;
const GRAD = "8QtbrC9d3BezyCwzBFUQbNsWJGte7ckrZ7HWcn81pump";
const LIVE = "HoWecXvLmS2UgY5iiktHuwM6b3rwptbDE6D7D6dMpump";
const GRAD_CURVE = "26fbbjPUhTPVTyaiEUENhQBWPf2XhaRUAVh9z4evBHW9", GRAD_POOL = "B2ajNVWAMef1xfjSW3QDrF7qWeLB7dTBwCR6va4pMB21";
const LIVE_CURVE = "CJ3S7xYWT4bUQgCAE4aBrzA3rXoesqfkrBqXWMJB3qic";

const rpc: SolRpc = async (method, params) => {
  expect(method).toBe("getMultipleAccounts");
  const [keys, { encoding }] = params as [string[], { encoding: string }];
  if (encoding === "base64") {
    if (keys[0] === GRAD) return fx("accts-graduated");
    if (keys[0] === LIVE) return fx("accts-curve");
    return { value: keys.map(() => null) };
  }
  if (keys[0] === GRAD) return fx("mint-graduated");
  if (keys[0] === LIVE) return fx("mint-curve");
  if (keys.length === 3) return fx("vaults-graduated");
  return { value: keys.map(() => null) };
};
const svc = pumpService(rpc, () => 1_792_600_000_000);

describe("addresses", () => {
  it("base58 round-trips", () => {
    expect(b58encode(b58decode(GRAD))).toBe(GRAD);
    expect(isSolAddress(GRAD)).toBe(true);
    expect(isSolAddress("0xabc")).toBe(false);
  });
  it("derives the real bonding curve and canonical PumpSwap pool addresses", () => {
    expect(curveOf(GRAD)).toBe(GRAD_CURVE);
    expect(curveOf(LIVE)).toBe(LIVE_CURVE);
    expect(poolOf(GRAD)).toBe(GRAD_POOL);
  });
});

describe("pump.fun status", () => {
  it("a graduated coin: curve complete, authorities revoked, PumpSwap price from the vaults, LP burned", async () => {
    const r = await svc.status(GRAD);
    expect(r.status).toBe(200);
    const s = r.body as Awaited<ReturnType<typeof svc.status>>["body"] & { venue: string };
    expect(s).toMatchObject({ venue: "pumpswap", token: { exists: true, revoked: true, decimals: 6 }, curve: { found: true, graduated: true, percentSold: 100 }, pool: { found: true, lpBurned: true } });
    const pool = (s as { pool: { priceSol: number; baseReserve: number; quoteReserveSol: number } }).pool;
    expect(pool.baseReserve).toBeCloseTo(200317816.860158, 3);
    expect(pool.quoteReserveSol).toBeCloseTo(82.776813984, 6);
    expect(pool.priceSol).toBeCloseTo(82.776813984 / 200317816.860158, 12);
  });
  it("a coin on its curve: not graduated, priced from the virtual reserves, no pool", async () => {
    const r = await svc.status(LIVE);
    const s = r.body as { venue: string; curve: { graduated: boolean; percentSold: number; priceSol: number }; pool: unknown; token: { revoked: boolean } };
    expect(s.venue).toBe("curve");
    expect(s.curve.graduated).toBe(false);
    expect(s.pool).toBeNull();
    expect(s.token.revoked).toBe(true);
    expect(s.curve.percentSold).toBeGreaterThan(0);
    expect(s.curve.percentSold).toBeLessThan(10);
    expect(s.curve.priceSol).toBeGreaterThan(0);
  });
  it("a mint that is not on pump.fun says so; a bad address is refused", async () => {
    const r = await svc.status("11111111111111111111111111111112");
    expect((r.body as { notes: string[] }).notes.join(" ")).toMatch(/No such mint/);
    expect((await svc.status("hello")).status).toBe(400);
  });
  it("decodes only the real curve layout", () => {
    expect(decodeCurve(new Uint8Array(166))).toBeNull();
  });
});
