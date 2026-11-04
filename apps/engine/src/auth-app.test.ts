import { mkdtempSync } from "node:fs";
import type { IncomingMessage } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { describe, expect, it } from "vitest";
import { Auth } from "./auth.js";

const req = (token: string) => ({ headers: { authorization: `Bearer ${token}` } }) as unknown as IncomingMessage;
const tmp = () => join(mkdtempSync(join(tmpdir(), "auth-app-")), "sessions.json");
/** No node is needed: these wallets are plain keys, checked offline. */
const offline = { verifyMessage: async () => false, getBlockNumber: async () => 1n } as never;
const auth = () => new Auth("s3cret", [], () => {}, { file: tmp(), chain: offline, sessionSecret: "a-session-secret" });

describe("the app's sign-in", () => {
  it("vouches for the phone key in the one signature that signs the owner in, and returns an app session", async () => {
    const a = auth(), w = privateKeyToAccount(generatePrivateKey());
    const n = a.nonce("0123456789abcdef");
    const message = n.message(w.address);
    expect(message).toContain("Resources:\n- urn:nightshift:device:0123456789abcdef");
    expect(message).toContain("approve your companies' spending with your fingerprint");
    const r = await a.verifyFull(w.address, n.nonce, await w.signMessage({ message }));
    expect(r.device).toBe("0123456789abcdef");
    expect(r.token.startsWith("a.")).toBe(true);
    expect(a.caller(req(r.token))).toEqual({ addr: w.address.toLowerCase(), via: "session", app: true });
  });

  it("keeps the web sign-in as it was: no device, a web session", async () => {
    const a = auth(), w = privateKeyToAccount(generatePrivateKey());
    const n = a.nonce();
    expect(n.message(w.address)).not.toContain("Resources:");
    const token = await a.verify(w.address, n.nonce, await w.signMessage({ message: n.message(w.address) }));
    expect(token.startsWith("s.")).toBe(true);
    expect(a.caller(req(token))?.app).toBeUndefined();
    // a junk device fingerprint is left out, not written into the message
    expect(a.nonce("<script>").message(w.address)).not.toContain("Resources:");
  });

  it("never lets an app session pass as a web one, or the other way round", () => {
    const a = auth(), me = "0xabc0000000000000000000000000000000000009";
    const app = a.session(me, Date.now(), "app"), web = a.session(me);
    expect(a.caller(req(`s.${app.slice(2)}`))).toBeNull();
    expect(a.caller(req(`a.${web.slice(2)}`))).toBeNull();
  });

  it("refreshes a session of the same kind, and the old one stops working", () => {
    const a = auth(), me = "0xabc0000000000000000000000000000000000009";
    const old = a.session(me, Date.now() - 3 * 86400_000, "app");
    const fresh = a.refresh(req(old))!;
    expect(fresh.startsWith("a.")).toBe(true);
    expect(a.caller(req(fresh))?.app).toBe(true);
    expect(a.caller(req(old))).toBeNull();
    expect(a.refresh(req(old))).toBeNull();
    expect(a.refresh(req("junk"))).toBeNull();
  });
});

describe("step-up: the wallet again for money out", () => {
  it("passes once, for that wallet and that action only, with the action named in the message", async () => {
    const a = auth(), w = privateKeyToAccount(generatePrivateKey()), me = w.address.toLowerCase();
    const s = a.stepNonce(me, { action: "withdraw:co1", words: "withdraw the revenue of Tidewell to my wallet" });
    expect(s.message).toContain("Confirm on NIGHTSHIFT: withdraw the revenue of Tidewell to my wallet.");
    const sig = await w.signMessage({ message: s.message });
    expect(await a.checkStep(me, "close:co1", s.nonce, sig)).toBe(false);
    // the nonce was spent by the wrong try: a new one is needed
    const s2 = a.stepNonce(me, { action: "withdraw:co1", words: "withdraw the revenue of Tidewell to my wallet" });
    const sig2 = await w.signMessage({ message: s2.message });
    expect(await a.checkStep(me, "withdraw:co1", s2.nonce, sig2)).toBe(true);
    expect(await a.checkStep(me, "withdraw:co1", s2.nonce, sig2)).toBe(false);
  });

  it("refuses another wallet's signature and a step-up nonce used to sign in", async () => {
    const a = auth(), w = privateKeyToAccount(generatePrivateKey()), x = privateKeyToAccount(generatePrivateKey()), me = w.address.toLowerCase();
    const s = a.stepNonce(me, { action: "erase", words: "delete my NIGHTSHIFT account" });
    expect(await a.checkStep(me, "erase", s.nonce, await x.signMessage({ message: s.message }))).toBe(false);
    const s2 = a.stepNonce(me, { action: "erase", words: "delete my NIGHTSHIFT account" });
    await expect(a.verifyFull(w.address, s2.nonce, await w.signMessage({ message: s2.message }))).rejects.toThrow(/expired/);
  });
});

describe("API keys and spending", () => {
  it("cannot spend unless made to, and says so", () => {
    const a = auth(), me = "0xabc0000000000000000000000000000000000009";
    const plain = a.createKey(me, "reader"), spender = a.createKey(me, "trader", { spend: true });
    expect(a.caller(req(plain.key))).toEqual({ addr: me, via: "key" });
    expect(a.caller(req(spender.key))).toEqual({ addr: me, via: "key", spend: true });
    expect(a.listKeys(me).map((k) => k.spend)).toEqual([false, true]);
    expect(a.revokeAllKeys(me)).toBe(2);
    expect(a.caller(req(spender.key))).toBeNull();
  });
});
