import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { lookup } from "node:dns/promises";
import { mkdirSync, readFileSync } from "node:fs";
import type { IncomingMessage } from "node:http";
import { dirname, join } from "node:path";
import { getAddress, verifyMessage } from "viem";
import { writeAtomic } from "./atomic.js";
import { config } from "./config.js";

/**
 * Sign-in with a wallet, and API keys for the MCP endpoint.
 * - The site asks for a nonce, the wallet signs a short message, the engine returns a session token
 *   (HMAC, 7 days). Only sign-outs are stored: revoked MACs and "sign out everywhere" times.
 * - An owner can mint API keys from the dashboard; only their SHA-256 is kept.
 * - The cookie only ever carries a session. A key travels as Bearer, and reaches /mcp and a few reads.
 */

const SESSION_DAYS = 7;
const DAY = 86400;
/** How long a sign-in message can be signed: also its EIP-4361 Expiration Time. */
const NONCE_MS = 5 * 60_000;
/** Keys one wallet may hold at once: plenty for every agent it runs, not a way to grow the state file. */
export const MAX_KEYS_PER_OWNER = 20;

export interface ApiKey { hash: string; owner: string; label: string; createdAt: number; lastUsedAt: number | null }
/** Who is calling, and how: a wallet session can do everything, an API key only what keys may. */
export interface Caller { addr: string; via: "session" | "key" }

export class Auth {
  readonly #secret: Buffer;
  readonly #nonces = new Map<string, { exp: number; issuedAt: string }>();
  /** Sessions ended by sign-out (by MAC), until they would have expired anyway. Kept on disk. */
  readonly #revoked = new Map<string, number>();
  /** "Sign out everywhere": per wallet, sessions issued at or before this second are void. Kept on disk. */
  readonly #validAfter = new Map<string, number>();
  readonly #file: string;
  /** The same keys by hash: an nsk_ lookup is one map read, not a scan. Rebuilt when the list was loaded from disk. */
  readonly #byHash = new Map<string, ApiKey>();

  constructor(secret: string, private readonly keys: ApiKey[], private readonly onChange: () => void, opts: { file?: string; sessionSecret?: string } = {}) {
    // SESSION_SECRET keeps sessions apart from the vault; without it, the old derivation (existing sessions stay valid)
    const own = opts.sessionSecret ?? config.sessionSecret;
    this.#secret = createHash("sha256").update(own ? `nightshift-session-key:${own}` : `nightshift-session:${secret}`).digest();
    this.#file = opts.file ?? join(config.dataDir, "sessions.json");
    try {
      const d = JSON.parse(readFileSync(this.#file, "utf8")) as { revoked?: Record<string, number>; validAfter?: Record<string, number> };
      for (const [k, v] of Object.entries(d.revoked ?? {})) this.#revoked.set(k, Number(v));
      for (const [k, v] of Object.entries(d.validAfter ?? {})) this.#validAfter.set(k, Number(v));
    } catch { /* first start, or nothing revoked yet */ }
  }

  nonce(): { nonce: string; message: (address: string) => string } {
    const n = randomBytes(12).toString("hex");
    const issuedAt = new Date().toISOString();
    for (const [k, v] of this.#nonces) if (v.exp < Date.now()) this.#nonces.delete(k);
    // bounded: a flood of sign-in requests cannot grow memory without end
    if (this.#nonces.size >= 20_000) throw new Error("Too many sign-ins right now; try again in a minute.");
    this.#nonces.set(n, { exp: Date.now() + NONCE_MS, issuedAt });
    return { nonce: n, message: (address) => Auth.message(address, n, issuedAt) };
  }

  /** EIP-4361 (Sign-In with Ethereum): wallets show the domain and warn when a site is not it. The site checks every line before signing. */
  static message(address: string, nonce: string, issuedAt: string): string {
    const url = new URL(config.publicUrl);
    const exp = new Date(Date.parse(issuedAt) + NONCE_MS).toISOString();
    return `${url.host} wants you to sign in with your Ethereum account:\n${getAddress(address)}\n\nSign in to NIGHTSHIFT. This proves you own this wallet. It costs nothing and moves no funds.\n\nURI: ${url.origin}\nVersion: 1\nChain ID: 1\nNonce: ${nonce}\nIssued At: ${issuedAt}\nExpiration Time: ${exp}`;
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
    const exp = Math.floor(now / 1000) + SESSION_DAYS * DAY;
    const body = `${address.toLowerCase()}.${exp}`;
    const mac = createHmac("sha256", this.#secret).update(body).digest("base64url");
    return `s.${body}.${mac}`;
  }

  /** The token a request carries: Bearer (a session or an nsk_ key), else the cookie, which only ever holds a session. */
  static token(req: IncomingMessage): string {
    const h = req.headers.authorization ?? "";
    if (h.startsWith("Bearer ")) return h.slice(7).trim();
    const c = /(?:^|;\s*)ns_session=([^;]+)/.exec(req.headers.cookie ?? "")?.[1];
    let t = "";
    try { t = c ? decodeURIComponent(c) : ""; } catch { /* a mangled cookie is no session */ }
    return t.startsWith("s.") ? t : "";
  }

  /** The wallet behind a valid, unrevoked session token, or null. */
  #checkSession(token: string): { addr: string; exp: number; mac: string } | null {
    const [, addr, expS, mac] = token.split(".");
    if (!addr || !expS || !mac || Number(expS) < Date.now() / 1000) return null;
    const want = createHmac("sha256", this.#secret).update(`${addr}.${expS}`).digest("base64url");
    const a = Buffer.from(mac);
    const b = Buffer.from(want);
    if (a.length !== b.length || !timingSafeEqual(a, b) || this.#revoked.has(mac)) return null;
    // issued at exp - 7 days: a sign-out everywhere voids everything issued up to that second
    if (Number(expS) - SESSION_DAYS * DAY <= (this.#validAfter.get(addr) ?? -1)) return null;
    return { addr, exp: Number(expS), mac };
  }

  /** Sign-outs to disk, without what has expired: a restart does not bring a session back. */
  #save(): void {
    const now = Date.now();
    for (const [k, until] of this.#revoked) if (until < now) this.#revoked.delete(k);
    for (const [k, at] of this.#validAfter) if ((at + SESSION_DAYS * DAY) * 1000 < now) this.#validAfter.delete(k);
    try {
      mkdirSync(dirname(this.#file), { recursive: true });
      writeAtomic(this.#file, JSON.stringify({ revoked: Object.fromEntries(this.#revoked), validAfter: Object.fromEntries(this.#validAfter) }), { mode: 0o600 });
    } catch (e) { console.error("sessions.json not saved:", (e as Error).message); }
  }

  /** Ends this request's session token now (sign-out). Only a real session is recorded, so junk cannot grow the list. */
  revoke(req: IncomingMessage): void {
    const token = Auth.token(req);
    const s = token.startsWith("s.") ? this.#checkSession(token) : null;
    if (!s) return;
    this.#revoked.set(s.mac, s.exp * 1000);
    this.#save();
  }

  /** Ends every session of this wallet issued until now (sign out everywhere). */
  revokeAll(owner: string, now = Date.now()): void {
    this.#validAfter.set(owner.toLowerCase(), Math.floor(now / 1000));
    this.#save();
  }

  /** Who is calling and how: a session (Bearer s.… or the cookie) or an API key (Bearer nsk_…), or null. */
  caller(req: IncomingMessage): Caller | null {
    const token = Auth.token(req);
    if (!token) return null;
    if (token.startsWith("s.")) { const s = this.#checkSession(token); return s ? { addr: s.addr, via: "session" } : null; }
    if (token.startsWith("nsk_")) {
      const hash = createHash("sha256").update(token).digest("hex");
      if (this.#byHash.size !== this.keys.length) { this.#byHash.clear(); for (const x of this.keys) this.#byHash.set(x.hash, x); }
      const k = this.#byHash.get(hash);
      if (!k) return null;
      k.lastUsedAt = Date.now();
      return { addr: k.owner, via: "key" };
    }
    return null;
  }

  /** The wallet behind a session token or an API key, or null. */
  owner(req: IncomingMessage): string | null {
    return this.caller(req)?.addr ?? null;
  }

  /** The wallet behind a real session only: what manages keys and agents. An API key is never enough. */
  ownerSession(req: IncomingMessage): string | null {
    const c = this.caller(req);
    return c?.via === "session" ? c.addr : null;
  }

  createKey(owner: string, label: string): { key: string; record: Omit<ApiKey, "hash"> & { id: string } } {
    if (this.keys.filter((k) => k.owner === owner.toLowerCase()).length >= MAX_KEYS_PER_OWNER) throw new Error(`One wallet can hold ${MAX_KEYS_PER_OWNER} API keys; revoke one first.`);
    const key = `nsk_${randomBytes(24).toString("base64url")}`;
    const rec: ApiKey = { hash: createHash("sha256").update(key).digest("hex"), owner: owner.toLowerCase(), label: label.slice(0, 60) || "MCP", createdAt: Date.now(), lastUsedAt: null };
    this.keys.push(rec);
    this.#byHash.set(rec.hash, rec);
    this.onChange();
    return { key, record: { id: rec.hash.slice(0, 12), owner: rec.owner, label: rec.label, createdAt: rec.createdAt, lastUsedAt: null } };
  }

  listKeys(owner: string) {
    return this.keys.filter((k) => k.owner === owner.toLowerCase()).map((k) => ({ id: k.hash.slice(0, 12), label: k.label, createdAt: k.createdAt, lastUsedAt: k.lastUsedAt }));
  }

  revokeKey(owner: string, id: string): boolean {
    const i = this.keys.findIndex((k) => k.owner === owner.toLowerCase() && k.hash.startsWith(id));
    if (i < 0) return false;
    this.#byHash.delete(this.keys[i]!.hash);
    this.keys.splice(i, 1);
    this.onChange();
    return true;
  }
}

/** What an API key may reach besides /mcp: reads only. Everything that changes state needs a wallet session. */
const KEY_READS: RegExp[] = [/^\/api\/auth\/me$/, /^\/api\/companies$/, /^\/api\/companies\/[^/]+$/, /^\/api\/companies\/[^/]+\/wallet$/, /^\/api\/events$/];
export const keyAllowed = (method: string | undefined, path: string): boolean =>
  path === "/mcp" || ((method === "GET" || method === "HEAD") && KEY_READS.some((r) => r.test(path)));

// ---- the caller's IP, behind trusted proxies only

/** An IP as a number (IPv4-mapped IPv6 as IPv4), or null when it is not one. */
export function ipNum(raw: string): { v6: boolean; n: bigint } | null {
  let ip = raw.trim().replace(/^\[|\]$/g, "").replace(/%.*$/, "");
  ip = ip.replace(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/i, "$1");
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(ip)) {
    const p = ip.split(".").map(Number);
    return p.every((x) => x <= 255) ? { v6: false, n: p.reduce((a, x) => (a << 8n) | BigInt(x), 0n) } : null;
  }
  if (!ip.includes(":")) return null;
  // a dotted IPv4 tail is the last two words
  ip = ip.replace(/:(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/, (_m, a, b, c, d) => `:${((+a << 8) | +b).toString(16)}:${((+c << 8) | +d).toString(16)}`);
  const halves = ip.split("::");
  if (halves.length > 2) return null;
  const head = halves[0] ? halves[0].split(":") : [], tail = halves[1] ? halves[1].split(":") : [];
  const fill = halves.length === 2 ? 8 - head.length - tail.length : 0;
  const words = [...head, ...Array<string>(Math.max(0, fill)).fill("0"), ...tail];
  if (fill < 0 || words.length !== 8 || !words.every((w) => /^[0-9a-f]{1,4}$/i.test(w))) return null;
  const n = words.reduce((a, w) => (a << 16n) | BigInt(parseInt(w, 16)), 0n);
  // ::ffff:a.b.c.d written in hex is still IPv4
  return n >> 32n === 0xffffn ? { v6: false, n: n & 0xffffffffn } : { v6: true, n };
}

type Net = { v6: boolean; base: bigint; shift: bigint };
/** "127.0.0.0/8, ::1, 172.31.87.0/24": IPs and CIDRs. Anything unreadable is left out. */
export function parseNets(list: string): Net[] {
  return list.split(",").map((s) => s.trim()).filter(Boolean).flatMap((s) => {
    const [ip, len] = s.split("/");
    const a = ipNum(ip ?? "");
    if (!a) return [];
    const width = a.v6 ? 128 : 32, bits = len === undefined ? width : Number(len);
    if (!Number.isInteger(bits) || bits < 0 || bits > width) return [];
    const shift = BigInt(width - bits);
    return [{ v6: a.v6, base: a.n >> shift, shift }];
  });
}
export const inNets = (ip: string, nets: Net[]): boolean => { const a = ipNum(ip); return !!a && nets.some((n) => n.v6 === a.v6 && a.n >> n.shift === n.base); };

/**
 * TRUSTED_PROXIES as nets. A name in the list (the default has "caddy", the proxy's container on the
 * compose network) is looked up and then again every minute, so a recreated proxy keeps its trust.
 */
let trusted: Net[] | null = null;
let looking = false;
function trustedNets(): Net[] {
  if (trusted) return trusted;
  const list = config.trustedProxies.split(",").map((s) => s.trim()).filter(Boolean);
  const names = list.filter((s) => !ipNum(s.split("/")[0] ?? "") && /^[a-z0-9.-]+$/i.test(s));
  trusted = parseNets(list.join(","));
  if (names.length && !looking) {
    looking = true;
    const look = () => void Promise.all(names.map((n) => lookup(n, { all: true }).then((a) => a.map((x) => x.address)).catch(() => [] as string[])))
      .then((ips) => { trusted = parseNets([...list, ...ips.flat()].join(",")); });
    look(); setInterval(look, 60_000).unref();
  }
  return trusted;
}
/**
 * The caller's IP. X-Forwarded-For counts only when the peer is a TRUSTED_PROXIES address (loopback and
 * the caddy container by default), and then the rightmost hop that is not itself a trusted proxy: what
 * the last proxy saw. Hops further left were written by the client and are never believed.
 */
export function clientIp(req: IncomingMessage, nets: Net[] = trustedNets()): string {
  const peer = (req.socket?.remoteAddress ?? "?").replace(/^::ffff:/, "");
  if (!inNets(peer, nets)) return peer;
  const hops = String(req.headers["x-forwarded-for"] ?? "").split(",").map((h) => h.trim().replace(/^::ffff:/, "")).filter(Boolean);
  for (let i = hops.length - 1; i >= 0; i--) if (!inNets(hops[i]!, nets)) return hops[i]!;
  return hops[0] ?? peer;
}
