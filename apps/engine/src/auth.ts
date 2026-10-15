import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import type { IncomingMessage } from "node:http";
import { getAddress, verifyMessage } from "viem";

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
  readonly #nonces = new Map<string, number>();

  constructor(secret: string, private readonly keys: ApiKey[], private readonly onChange: () => void) {
    this.#secret = createHash("sha256").update(`nightshift-session:${secret}`).digest();
  }

  nonce(): { nonce: string; message: (address: string) => string } {
    const n = randomBytes(12).toString("hex");
    this.#nonces.set(n, Date.now() + 5 * 60_000);
    for (const [k, exp] of this.#nonces) if (exp < Date.now()) this.#nonces.delete(k);
    return { nonce: n, message: (address) => Auth.message(address, n) };
  }

  static message(address: string, nonce: string): string {
    return `Sign in to NIGHTSHIFT as ${address}.\n\nThis proves you own this wallet. It costs nothing and moves no funds.\n\nNonce: ${nonce}`;
  }

  async verify(address: string, nonce: string, signature: `0x${string}`): Promise<string> {
    const exp = this.#nonces.get(nonce);
    if (!exp || exp < Date.now()) throw new Error("sign-in expired; try again");
    const addr = getAddress(address);
    const ok = await verifyMessage({ address: addr, message: Auth.message(addr, nonce), signature });
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
