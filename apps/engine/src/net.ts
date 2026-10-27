import { lookup } from "node:dns/promises";
import { request as httpRequest } from "node:http";
import { request as httpsRequest } from "node:https";
import { BlockList, isIP } from "node:net";

/**
 * Fetching URLs that came from content (LLM output, swarm deliveries) without letting them reach
 * this server's own network: only http(s) on the standard ports, only public addresses, every
 * redirect hop checked again, and the connection made to the very address that was checked (a
 * second DNS answer cannot point it elsewhere).
 */
const PRIVATE = new BlockList();
for (const [net, bits] of [["0.0.0.0", 8], ["10.0.0.0", 8], ["100.64.0.0", 10], ["127.0.0.0", 8], ["169.254.0.0", 16], ["172.16.0.0", 12], ["192.0.0.0", 24], ["192.0.2.0", 24], ["192.168.0.0", 16], ["198.18.0.0", 15], ["198.51.100.0", 24], ["203.0.113.0", 24], ["224.0.0.0", 3]] as const) PRIVATE.addSubnet(net, bits, "ipv4");
for (const [net, bits] of [["::", 127], ["64:ff9b::", 96], ["64:ff9b:1::", 48], ["2001:db8::", 32], ["2002::", 16], ["fc00::", 7], ["fe80::", 10], ["fec0::", 10], ["ff00::", 8]] as const) PRIVATE.addSubnet(net, bits, "ipv6");

/** IPv4-mapped IPv6 (::ffff:a.b.c.d, also written ::ffff:7f00:1) is checked by the IPv4 rules. */
export function privateIp(ip: string): boolean {
  const v = ip.replace(/^\[|\]$/g, "");
  const kind = isIP(v);
  if (kind === 4) return PRIVATE.check(v, "ipv4");
  if (kind === 6) return PRIVATE.check(v, "ipv6");
  return true;
}

/** The URL and the one public address it will be fetched from, or null. */
export async function publicUrl(u: string): Promise<{ url: URL; address: string; family: 4 | 6 } | null> {
  let url: URL;
  try { url = new URL(u); } catch { return null; }
  if (url.protocol !== "https:" && url.protocol !== "http:") return null;
  if (url.port && url.port !== "80" && url.port !== "443") return null;
  if (url.username || url.password) return null;
  const host = url.hostname.replace(/^\[|\]$/g, "");
  if (host === "localhost" || host.endsWith(".localhost") || host.endsWith(".internal")) return null;
  try {
    const addrs = isIP(host) ? [{ address: host, family: isIP(host) }] : await lookup(host, { all: true });
    if (!addrs.length || addrs.some((a) => privateIp(a.address))) return null;
    return { url, address: addrs[0]!.address, family: addrs[0]!.family === 6 ? 6 : 4 };
  } catch { return null; }
}

export type SafeFetchOptions = { maxBytes?: number; contentTypes?: string[]; deadlineMs?: number };
const MAX_BODY = 20 * 1024 * 1024;

/** One request to `address`, with the URL's own Host header and TLS name. */
export function pinned(url: URL, address: string, family: 4 | 6, init: RequestInit, limits: SafeFetchOptions = {}): Promise<Response> {
  return new Promise((resolve, reject) => {
    const req = (url.protocol === "https:" ? httpsRequest : httpRequest)(url, {
      method: init.method ?? "GET",
      headers: Object.fromEntries(new Headers(init.headers).entries()),
      lookup: (_h: string, o: { all?: boolean }, cb: (...a: unknown[]) => void) => (o?.all ? cb(null, [{ address, family }]) : cb(null, address, family)),
      signal: init.signal ?? undefined,
    } as never, (res) => {
      res.on("error", reject);
      const type = String(res.headers["content-type"] ?? "").split(";")[0]!.trim().toLowerCase();
      if ((res.statusCode ?? 502) >= 200 && (res.statusCode ?? 502) < 300 && limits.contentTypes && !limits.contentTypes.includes(type)) { res.destroy(new Error("unexpected content type")); reject(new Error("unexpected content type")); return; }
      const chunks: Buffer[] = [];
      let size = 0;
      res.on("data", (c: Buffer) => { size += c.length; if (size > (limits.maxBytes ?? MAX_BODY)) { res.destroy(new Error("response too large")); return; } chunks.push(c); });
      res.on("end", () => {
        const headers = new Headers();
        for (const [k, v] of Object.entries(res.headers)) if (v !== undefined) headers.set(k, Array.isArray(v) ? v.join(", ") : v);
        const status = res.statusCode ?? 502;
        resolve(new Response([101, 204, 205, 304].includes(status) ? null : Buffer.concat(chunks), { status, headers }));
      });
    });
    req.on("error", reject);
    // a body (a post to an owner's Mastodon instance, a file part) goes as given: strings and bytes only
    const b = init.body;
    req.end(typeof b === "string" || b instanceof Uint8Array ? b : undefined);
  });
}

/**
 * fetch() for untrusted URLs: public hosts only, at most 3 redirects, each one checked and pinned.
 * A request that sends something (not GET or HEAD) follows no redirect: it is answered where it went.
 */
export async function safeFetch(u: string, init: RequestInit = {}, limits: SafeFetchOptions = {}): Promise<Response | null> {
  const deadline = AbortSignal.timeout(limits.deadlineMs ?? 20_000);
  const signal = init.signal ? AbortSignal.any([init.signal, deadline]) : deadline;
  init = { ...init, signal };
  let onAbort: () => void;
  const aborted = new Promise<never>((_resolve, reject) => {
    onAbort = () => reject(signal.reason);
    signal.addEventListener("abort", onAbort, { once: true });
  });
  const read = async () => {
    let next = u;
    const reads = !init.method || init.method === "GET" || init.method === "HEAD";
    for (let hop = 0; hop < 4; hop++) {
      signal.throwIfAborted();
      const vetted = await publicUrl(next);
      signal.throwIfAborted();
      if (!vetted) return null;
      const r = await pinned(vetted.url, vetted.address, vetted.family, init, limits);
      if (reads && r.status >= 300 && r.status < 400 && r.headers.get("location")) { next = new URL(r.headers.get("location")!, vetted.url).toString(); continue; }
      return r;
    }
    return null;
  };
  try { return await Promise.race([read(), aborted]); } finally { signal.removeEventListener("abort", onAbort!); }
}
