import { generateKeyPairSync } from "node:crypto";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CdpFacilitator, requirement, signPayment } from "@nightshift/x402";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type * as Admin from "./admin.js";
import type * as Cfg from "./config.js";
import { Checkout, type Settlement } from "./checkout.js";

/** A CDP key made for the test, saved on /setup the way the operator saves one. */
const { privateKey } = generateKeyPairSync("ed25519");
const jwk = privateKey.export({ format: "jwk" }) as { d: string; x: string };
const KEY = { id: "0c6f9b8e-2d4a-4e1b-9a7c-5d3e2f1a0b9c", secret: Buffer.concat([Buffer.from(jwk.d, "base64url"), Buffer.from(jwk.x, "base64url")]).toString("base64") };

let A: typeof Admin, C: typeof Cfg;
const said: string[] = [];
beforeAll(async () => {
  const dir = mkdtempSync(join(tmpdir(), "cdp-secrets-"));
  process.env.DATA_DIR = dir;
  writeFileSync(join(dir, "settings.json"), JSON.stringify({ CDP_API_KEY_ID: KEY.id, CDP_API_KEY_SECRET: KEY.secret }));
  for (const m of ["log", "error", "warn", "info"] as const) vi.spyOn(console, m).mockImplementation((...a: unknown[]) => { said.push(a.map(String).join(" ")); });
  // nothing leaves the test: every outside call fails
  vi.stubGlobal("fetch", async () => new Response("{}", { status: 500 }));
  C = await import("./config.js");
  A = await import("./admin.js");
});
afterAll(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

const leaks = (s: string) => s.includes(KEY.secret) || s.includes(KEY.id) || s.includes(jwk.d);

describe("CDP key handling", () => {
  it("a saved key turns the facilitator on by default", () => {
    expect(C.config.x402Facilitator).toBe("cdp");
    expect(C.config.cdpApiKeySecret).toBe(KEY.secret);
  });

  it("/setup shows the key as set, never its value", async () => {
    // the facilitator refuses: the check says so without repeating anything secret
    const refused = new CdpFacilitator(KEY, { fetch: async () => new Response(JSON.stringify({ errorType: "unauthorized", errorMessage: `bad token for ${KEY.id}` }), { status: 401 }) });
    const engine = { vault: { generatedSecret: false }, reads: { health: async () => null }, store: { companies: new Map() }, facilitator: refused };
    const state = await A.setupState(engine as never);
    expect(state.saved.CDP_API_KEY_ID).toBe("set");
    expect(state.saved.CDP_API_KEY_SECRET).toBe("set");
    expect(state.running.CDP_API_KEY_ID).toBe("set");
    expect(state.running.CDP_API_KEY_SECRET).toBe("set");
    expect(state.running.X402_FACILITATOR).toBe("cdp");
    expect(state.checks.find((c) => c.id === "x402")).toMatchObject({ state: "warn" });
    expect(leaks(JSON.stringify(state))).toBe(false);
    // and with a working key
    const ok = new CdpFacilitator(KEY, { fetch: async () => new Response(JSON.stringify({ kinds: [{ x402Version: 2, scheme: "exact", network: `eip155:${C.config.salesChainId}` }] }), { status: 200 }) });
    const s2 = await A.setupState({ ...engine, facilitator: ok } as never);
    expect(s2.checks.find((c) => c.id === "x402")).toMatchObject({ state: "ok" });
    expect(leaks(JSON.stringify(s2))).toBe(false);
  });

  it("checks a new key without repeating it, and keeps a masked one", () => {
    const bad = "c2VjcmV0LXRoYXQtaXMtbm90LTY0LWJ5dGVz";
    const err = A.checkSetup({ CDP_API_KEY_SECRET: bad });
    expect(err).toMatch(/CDP_API_KEY_SECRET/);
    expect(err).not.toContain(bad);
    expect(A.checkSetup({ X402_FACILITATOR: "coinbase" })).toMatch(/cdp or self/);
    const masked: Record<string, unknown> = { CDP_API_KEY_ID: "set", CDP_API_KEY_SECRET: "set", X402_FACILITATOR: "cdp" };
    expect(A.checkSetup(masked)).toBeNull();
    expect(masked).toEqual({ X402_FACILITATOR: "cdp" });
    expect(A.checkSetup({ CDP_API_KEY_ID: KEY.id, CDP_API_KEY_SECRET: KEY.secret })).toBeNull();
    // changing them is announced by name only
    expect(A.ANNOUNCED).toEqual(expect.arrayContaining(["X402_FACILITATOR", "CDP_API_KEY_ID", "CDP_API_KEY_SECRET"]));
  });

  it("a facilitator outage is logged and alerted without the key or its token", async () => {
    const seller = privateKeyToAccount(generatePrivateKey());
    const req = requirement(8453, seller.address, 1_000_000n);
    const sent: string[] = [];
    // the facilitator answers 503 and echoes what it got
    const fac = new CdpFacilitator(KEY, { fetch: async (_u, init) => { sent.push(JSON.stringify(init?.headers)); return new Response(JSON.stringify({ errorMessage: `upstream down ${String(init?.body).slice(0, 40)}` }), { status: 503 }); } });
    const alerts: string[] = [];
    const co = new Checkout(new Map<string, Settlement>(), async () => {}, {
      used: async () => false, find: async () => null,
      sign: async () => ({ hash: `0x${"1".padStart(64, "0")}`, raw: "0x01", nonce: 1 }), broadcast: async () => {},
      state: async () => "success", refused: () => false,
    }, async () => {}, 0, Date.now, {
      facilitator: fac, graceMs: 0,
      // what the engine does on a fallback
      onFallback: (op, e) => { console.error(`x402: ${e.message}; the company settles itself`); alerts.push(`The CDP facilitator did not answer a ${op} (${e.status ? `HTTP ${e.status}` : "no answer"})`); },
    });
    const p = await signPayment(privateKeyToAccount(generatePrivateKey()), req);
    await co.settle("C", seller.address, "P", p, undefined, { requirement: req, resource: { url: "https://x.example/buy/a/b", description: "d", mimeType: "application/json" } });
    expect(alerts.length).toBe(1);
    expect(said.some((l) => l.includes("unavailable (HTTP 503)"))).toBe(true);
    for (const l of [...said, ...alerts]) { expect(leaks(l)).toBe(false); expect(l).not.toMatch(/Bearer|eyJ/); }
    // the key itself is never sent: only a short-lived token
    expect(sent.length).toBe(1);
    expect(leaks(sent[0]!)).toBe(false);
  });
});
