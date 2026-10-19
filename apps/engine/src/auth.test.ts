import type { IncomingMessage } from "node:http";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { describe, expect, it } from "vitest";
import { Auth, type ApiKey, MAX_KEYS_PER_OWNER } from "./auth.js";

const req = (token: string) => ({ headers: { authorization: `Bearer ${token}` } }) as unknown as IncomingMessage;

describe("wallet sign-in and API keys", () => {
  it("signs a wallet in and recognises its session, and nobody else's", async () => {
    const auth = new Auth("s3cret", [], () => {});
    const me = privateKeyToAccount(generatePrivateKey());
    const n = auth.nonce();
    const sig = await me.signMessage({ message: n.message(me.address) });
    const token = await auth.verify(me.address, n.nonce, sig);
    expect(auth.owner(req(token))).toBe(me.address.toLowerCase());
    // A nonce works once.
    await expect(auth.verify(me.address, n.nonce, sig)).rejects.toThrow();
    // A tampered or foreign session is nobody.
    expect(auth.owner(req(token.replace(/.$/, (c) => (c === "A" ? "B" : "A"))))).toBeNull();
    expect(new Auth("other", [], () => {}).owner(req(token))).toBeNull();
  });

  it("refuses a signature from another wallet", async () => {
    const auth = new Auth("s3cret", [], () => {});
    const me = privateKeyToAccount(generatePrivateKey());
    const thief = privateKeyToAccount(generatePrivateKey());
    const n = auth.nonce();
    const sig = await thief.signMessage({ message: n.message(me.address) });
    await expect(auth.verify(me.address, n.nonce, sig)).rejects.toThrow(/does not match/);
  });

  it("mints, recognises and revokes API keys, storing only their hash", () => {
    const keys: ApiKey[] = [];
    const auth = new Auth("s3cret", keys, () => {});
    const { key, record } = auth.createKey("0xABC0000000000000000000000000000000000001", "Claude");
    expect(key.startsWith("nsk_")).toBe(true);
    expect(JSON.stringify(keys)).not.toContain(key);
    expect(auth.owner(req(key))).toBe("0xabc0000000000000000000000000000000000001");
    expect(auth.revokeKey("0xabc0000000000000000000000000000000000001", record.id)).toBe(true);
    expect(auth.owner(req(key))).toBeNull();
  });

  it("caps the keys one wallet holds, and finds keys loaded from the state file", () => {
    const keys: ApiKey[] = [];
    const auth = new Auth("s3cret", keys, () => {});
    const me = "0xabc0000000000000000000000000000000000002";
    const made = Array.from({ length: MAX_KEYS_PER_OWNER }, () => auth.createKey(me, "agent"));
    expect(() => auth.createKey(me, "one more")).toThrow(/revoke one first/);
    expect(auth.createKey("0xabc0000000000000000000000000000000000003", "other").key).toMatch(/^nsk_/); // per wallet, not in all
    expect(auth.revokeKey(me, made[0]!.record.id)).toBe(true);
    expect(auth.createKey(me, "again").key).toMatch(/^nsk_/);
    // after a restart the same records are indexed again, also when they are loaded after the start
    const loaded: ApiKey[] = [];
    const reloaded = new Auth("s3cret", loaded, () => {});
    loaded.push(...keys);
    expect(reloaded.owner(req(made[1]!.key))).toBe(me);
    expect(reloaded.owner(req(made[0]!.key))).toBeNull();
  });
});
