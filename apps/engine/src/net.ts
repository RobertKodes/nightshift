import { lookup } from "node:dns/promises";
import { isIP } from "node:net";

/**
 * Fetching URLs that came from content (LLM output, swarm deliveries) without letting them reach
 * this server's own network: only http(s) on the standard ports, only public addresses, and every
 * redirect hop checked again.
 */
function privateIp(ip: string): boolean {
  const v = ip.replace(/^::ffff:/, "");
  if (isIP(v) === 4) {
    const [a, b] = v.split(".").map(Number) as [number, number];
    return a === 10 || a === 127 || a === 0 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127) || a >= 224;
  }
  const l = v.toLowerCase();
  return l === "::1" || l === "::" || l.startsWith("fc") || l.startsWith("fd") || l.startsWith("fe80");
}

export async function publicUrl(u: string): Promise<URL | null> {
  let url: URL;
  try { url = new URL(u); } catch { return null; }
  if (url.protocol !== "https:" && url.protocol !== "http:") return null;
  if (url.port && url.port !== "80" && url.port !== "443") return null;
  if (url.username || url.password) return null;
  const host = url.hostname.replace(/^\[|\]$/g, "");
  if (host === "localhost" || host.endsWith(".localhost") || host.endsWith(".internal")) return null;
  try {
    const addrs = isIP(host) ? [{ address: host }] : await lookup(host, { all: true });
    if (!addrs.length || addrs.some((a) => privateIp(a.address))) return null;
  } catch { return null; }
  return url;
}

/** fetch() for untrusted URLs: public hosts only, at most 3 redirects, each one checked. */
export async function safeFetch(u: string, init: RequestInit = {}): Promise<Response | null> {
  let next = u;
  for (let hop = 0; hop < 4; hop++) {
    const url = await publicUrl(next);
    if (!url) return null;
    const r = await fetch(url, { ...init, redirect: "manual" });
    if (r.status >= 300 && r.status < 400 && r.headers.get("location")) { next = new URL(r.headers.get("location")!, url).toString(); continue; }
    return r;
  }
  return null;
}
