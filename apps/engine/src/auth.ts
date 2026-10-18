import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import type { IncomingMessage } from "node:http";
import { getAddress, verifyMessage } from "viem";
import { config } from "./config.js";

/**
 * Sign-in with a wallet, and API keys for the MCP endpoint.
 * - The site asks for a nonce, the wallet signs a short message, the engine returns a session token
 *   (HMAC, 7 days). Nothing is stored server-side for sessions.
 * - An owner can mint API keys from the dashboard; only their SHA-256 is kept.
 */

const SESSION_DAYS = 7;

export interface ApiKey { hash: string; owner: string; label: string; createdAt: number; lastUsedAt: number | null }

export class Auth {
  readonly #secret: Buffer;
  readonly #nonces = new Map<string, { exp: number; issuedAt: string }>();
  /** Sessions ended by sign-out (by MAC), until they would have expired anyway. */
  readonly #revoked = new Map<string, number>();

  constructor(secret: string, private readonly keys: ApiKey[], private readonly onChange: () => void) {
    this.#secret = createHash("sha256").update(`nightshift-session:${secret}`).digest();
  }

  nonce(): { nonce: string; message: (address: string) => string } {
    const n = randomBytes(12).toString("hex");
    const issuedAt = new Date().toISOString();
    for (const [k, v] of this.#nonces) if (v.exp < Date.now()) this.#nonces.delete(k);
    // bounded: a flood of sign-in requests cannot grow memory without end
    if (this.#nonces.size >= 20_000) throw new Error("Too many sign-ins right now; try again in a minute.");
    this.#nonces.set(n, { exp: Date.now() + 5 * 60_000, issuedAt });
    return { nonce: n, message: (address) => Auth.message(address, n, issuedAt) };
  }

  /** EIP-4361 (Sign-In with Ethereum): wallets show the domain and warn when a site is not it. */
  static message(address: string, nonce: string, issuedAt: string): string {
    const url = new URL(config.publicUrl);
    return `${url.host} wants you to sign in with your Ethereum account:\n${getAddress(address)}\n\nSign in to NIGHTSHIFT. This proves you own this wallet. It costs nothing and moves no funds.\n\nURI: ${url.origin}\nVersion: 1\nChain ID: 1\nNonce: ${nonce}\nIssued At: ${issuedAt}`;
  }

  async verify(address: string, nonce: string, signature: `0x${string}`): Promise<string> {
    const rec = this.#nonces.get(nonce);
    if (!rec || rec.exp < Date.now()) throw new Error("sign-in expired; try again");
    const addr = getAddress(address);
    const ok = await verifyMessage({ address: addr, message: Auth.message(addr, nonce, rec.issuedAt), signature });
    if (!ok) throw new Error("signature does not match this wallet");
    this.#nonces.delete(nonce);
    return this.session(addr);
  }

  session(address: string, now = Date.now()): string {
    const exp = Math.floor(now / 1000) + SESSION_DAYS * 86400;
    const body = `${address.toLowerCase()}.${exp}`;
    const mac = createHmac("sha256", this.#secret).update(body).digest("base64url");
    return `s.${body}.${mac}`;
  }

  /** Ends a session token now (sign-out). */
  revoke(req: IncomingMessage): void {
    const cookie = /(?:^|;\s*)ns_session=([^;]+)/.exec(req.headers.cookie ?? "")?.[1];
    const h = req.headers.authorization ?? "";
    const token = h.startsWith("Bearer s.") ? h.slice(7).trim() : cookie ? decodeURIComponent(cookie) : "";
    const [, , expS, mac] = token.split(".");
    if (mac && expS) this.#revoked.set(mac, Number(expS) * 1000);
    for (const [k, until] of this.#revoked) if (until < Date.now()) this.#revoked.delete(k);
  }

  /** The wallet behind a session token or an API key, or null. */
  owner(req: IncomingMessage): string | null {
    const h = req.headers.authorization ?? "";
    const cookie = /(?:^|;\s*)ns_session=([^;]+)/.exec(req.headers.cookie ?? "")?.[1];
    const token = h.startsWith("Bearer ") ? h.slice(7).trim() : cookie ? decodeURIComponent(cookie) : "";
    if (!token) return null;
    if (token.startsWith("s.")) {
      const [, addr, expS, mac] = token.split(".");
      if (!addr || !expS || !mac || Number(expS) < Date.now() / 1000) return null;
      const want = createHmac("sha256", this.#secret).update(`${addr}.${expS}`).digest("base64url");
      const a = Buffer.from(mac);
      const b = Buffer.from(want);
      if (this.#revoked.has(mac)) return null;
      return a.length === b.length && timingSafeEqual(a, b) ? addr : null;
    }
    if (token.startsWith("nsk_")) {
      const hash = createHash("sha256").update(token).digest("hex");
      const k = this.keys.find((x) => x.hash === hash);
      if (!k) return null;
      k.lastUsedAt = Date.now();
      return k.owner;
    }
    return null;
  }

  createKey(owner: string, label: string): { key: string; record: Omit<ApiKey, "hash"> & { id: string } } {
    const key = `nsk_${randomBytes(24).toString("base64url")}`;
    const rec: ApiKey = { hash: createHash("sha256").update(key).digest("hex"), owner: owner.toLowerCase(), label: label.slice(0, 60) || "MCP", createdAt: Date.now(), lastUsedAt: null };
    this.keys.push(rec);
    this.onChange();
    return { key, record: { id: rec.hash.slice(0, 12), owner: rec.owner, label: rec.label, createdAt: rec.createdAt, lastUsedAt: null } };
  }

  listKeys(owner: string) {
    return this.keys.filter((k) => k.owner === owner.toLowerCase()).map((k) => ({ id: k.hash.slice(0, 12), label: k.label, createdAt: k.createdAt, lastUsedAt: k.lastUsedAt }));
  }

  revokeKey(owner: string, id: string): boolean {
    const i = this.keys.findIndex((k) => k.owner === owner.toLowerCase() && k.hash.startsWith(id));
    if (i < 0) return false;
    this.keys.splice(i, 1);
    this.onChange();
    return true;
  }
}
