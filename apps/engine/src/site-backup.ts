import type { Company } from "@nightshift/core";
import { namehash, parseAbi } from "viem";
import { eth } from "./chain.js";
import { safeFetch } from "./net.js";

const ALPHABET = "abcdefghijklmnopqrstuvwxyz234567";
const TIMEOUT = 1500;
const CONTENTHASH = parseAbi(["function contenthash(bytes32 node) view returns (bytes)"]);

function base32(bytes: Uint8Array): string {
  let out = "", bits = 0, value = 0;
  for (const byte of bytes) {
    value = (value << 8) | byte; bits += 8;
    while (bits >= 5) { bits -= 5; out += ALPHABET[(value >>> bits) & 31]; }
  }
  return out + (bits ? ALPHABET[(value << (5 - bits)) & 31] : "");
}

/** Checks the CID version, codec and multihash length. */
function cidBytes(bytes: Uint8Array): boolean {
  let at = 0;
  const number = () => {
    let n = 0;
    for (let shift = 0; shift < 35 && at < bytes.length; shift += 7) {
      const b = bytes[at++]!;
      n += (b & 127) * 2 ** shift;
      if (!(b & 128)) return n;
    }
    return -1;
  };
  if (number() !== 1 || number() <= 0 || number() < 0) return false;
  const length = number();
  return length >= 0 && length === bytes.length - at;
}

function validCid(cid: unknown): cid is string {
  if (typeof cid !== "string" || cid.length > 256 || !/^b[a-z2-7]+$/.test(cid)) return false;
  let bits = 0, value = 0;
  const bytes: number[] = [];
  for (const c of cid.slice(1)) {
    value = (value << 5) | ALPHABET.indexOf(c); bits += 5;
    if (bits >= 8) { bits -= 8; bytes.push((value >>> bits) & 255); }
  }
  return cidBytes(Uint8Array.from(bytes)) && `b${base32(Uint8Array.from(bytes))}` === cid;
}

/** An ENS ipfs-ns contenthash contains the CID after the e301 namespace. */
export function contenthashCid(hash: unknown): string | null {
  if (typeof hash !== "string" || !/^0xe301(?:[\da-f]{2})+$/i.test(hash) || hash.length > 520) return null;
  const bytes = Buffer.from(hash.slice(6), "hex");
  return cidBytes(bytes) ? `b${base32(bytes)}` : null;
}

export const backupUrl = (cid: unknown): string | null => validCid(cid) ? `https://imd-ipfs.xyz/ipfs/${cid}/` : null;

function siteName(url: string): { name: string; label: string } | null {
  try {
    const u = new URL(url);
    if (u.protocol !== "https:" || u.username || u.password || u.port) return null;
    const m = /^([a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)(?:\.site)?\.identitymd\.eth\.limo$/.exec(u.hostname);
    return m ? { name: u.hostname.slice(0, -5), label: m[1]! } : null;
  } catch { return null; }
}

async function contenthash(name: string): Promise<string | null> {
  const resolver = await eth.getEnsResolver({ name });
  return resolver ? eth.readContract({ address: resolver, abi: CONTENTHASH, functionName: "contenthash", args: [namehash(name)] }) : null;
}

async function fast<T>(work: Promise<T>, fallback: T): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try { return await Promise.race([work, new Promise<T>((resolve) => { timer = setTimeout(() => resolve(fallback), TIMEOUT); })]); }
  catch { return fallback; }
  finally { clearTimeout(timer); }
}

/** Resolves each IMD address once, with a short retry delay for missing CIDs. */
export class SiteBackups {
  readonly #cache = new Map<string, { until: number; cid: Promise<string | null> }>();
  constructor(private readonly hash = contenthash, private readonly fetch = safeFetch, private readonly bound = 512) {}

  async #resolve(name: string, label: string): Promise<string | null> {
    const cid = contenthashCid(await fast(Promise.resolve().then(() => this.hash(name)), null));
    if (cid) return cid;
    try {
      const r = await fast(this.fetch("https://api.imd.fun/sites", { signal: AbortSignal.timeout(TIMEOUT) }, { deadlineMs: TIMEOUT, maxBytes: 1_000_000, contentTypes: ["application/json"] }), null);
      if (!r?.ok) return null;
      const body: unknown = await r.json();
      const rows = Array.isArray(body) ? body : (body as { sites?: unknown } | null)?.sites;
      if (!Array.isArray(rows)) return null;
      for (const row of rows) {
        if (!row || typeof row !== "object") continue;
        if ((row.label === label || row.label === `${label}.site`) && validCid(row.cid)) return row.cid;
      }
    } catch { /* Try again after the cache expires. */ }
    return null;
  }

  /** A stored CID wins; callers can mark their record dirty when a CID is found. */
  async get(url: string | null | undefined, record?: { cid?: string }, changed: () => void = () => {}): Promise<string | null> {
    try {
      const site = url ? siteName(url) : null;
      if (!site) return null;
      if (backupUrl(record?.cid)) return backupUrl(record!.cid);
      let cached = this.#cache.get(site.name);
      if (!cached || cached.until <= Date.now()) {
        this.#cache.delete(site.name);
        while (this.#cache.size >= Math.max(1, this.bound)) this.#cache.delete(this.#cache.keys().next().value!);
        cached = { until: Infinity, cid: this.#resolve(site.name, site.label).catch(() => null) };
        this.#cache.set(site.name, cached);
        const entry = cached;
        void entry.cid.then((cid) => { entry.until = Date.now() + (cid ? 3_600_000 : 60_000); });
      }
      const cid = await cached.cid;
      if (cid && record && record.cid !== cid) { record.cid = cid; changed(); }
      return backupUrl(cid);
    } catch { return null; }
  }

  /** Keeps company and tool CIDs in the same snapshot as their addresses. */
  async company(c: Company, changed: () => void): Promise<void> {
    await Promise.all([
      this.get(c.site?.url, c.site ?? undefined, changed),
      ...c.products.filter((p) => p.kind === "tool" && p.deliverableUrl).map(async (p) => {
        const url = p.deliverableUrl!;
        const record = p.site?.url === url ? p.site : { url };
        await this.get(url, record, () => { if (p.deliverableUrl === url) { p.site = record; changed(); } });
      }),
    ]);
  }
}

export const siteBackups = new SiteBackups();

/** Tool addresses stay paired with the CID resolved for that address. */
export const productSite = (p: Company["products"][number]) => ({
  site: p.kind === "tool" ? p.deliverableUrl : null,
  siteBackup: p.kind === "tool" && p.site?.url === p.deliverableUrl ? backupUrl(p.site?.cid) : null,
});
