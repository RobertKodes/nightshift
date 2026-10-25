/**
 * The recruiter's guard rails: outside text is cleaned before it is stored, every link it writes
 * comes from one allowlist of NIGHTSHIFT pages, and every log line has its secrets blanked out.
 */

/** The only site the recruiter ever links to. */
export const SITE = "https://getnightshift.tech";

/** The pages a link may point at. A sample takes an `address`; every link carries `ref=rc-…`. */
export const ALLOWED_PATHS = ["/", "/crews", "/crews/watchtower", "/crews/research", "/crews/buildcheck", "/agents/start", "/api/watchtower/sample", "/proof"] as const;
export type SitePath = (typeof ALLOWED_PATHS)[number];
const PATHS = new Set<string>(ALLOWED_PATHS);
const SAMPLE: SitePath = "/api/watchtower/sample";
const REF = /^rc-[a-z0-9-]{1,60}$/;
const ADDRESS = /^0x[0-9a-f]{40}$/;

export const isSitePath = (p: unknown): p is SitePath => typeof p === "string" && PATHS.has(p);
export const isAddress = (a: unknown): a is string => typeof a === "string" && ADDRESS.test(a.toLowerCase());

/** A link to one of our pages with its ref tag. Throws on anything off the allowlist. */
export function siteLink(path: SitePath, ref: string, address?: string | null): string {
  if (!PATHS.has(path)) throw new Error("link not on the allowlist");
  if (!REF.test(ref)) throw new Error("bad ref tag");
  if ((path === SAMPLE) !== Boolean(address)) throw new Error("a sample link needs an address, and only a sample takes one");
  const u = new URL(path, SITE);
  if (address) {
    const a = address.toLowerCase();
    if (!ADDRESS.test(a)) throw new Error("bad address");
    u.searchParams.set("address", a);
  }
  u.searchParams.set("ref", ref);
  return u.toString();
}

/** True only for a link siteLink() could have written, in its exact form. */
export function allowedLink(link: string): boolean {
  let u: URL;
  try { u = new URL(link); } catch { return false; }
  if (u.origin !== SITE || u.username || u.password || u.hash || !PATHS.has(u.pathname)) return false;
  const keys = [...u.searchParams.keys()];
  if (keys.some((k) => k !== "ref" && k !== "address") || new Set(keys).size !== keys.length) return false;
  if (!REF.test(u.searchParams.get("ref") ?? "")) return false;
  const a = u.searchParams.get("address");
  if ((u.pathname === SAMPLE) !== (a !== null)) return false;
  if (a !== null && !ADDRESS.test(a)) return false;
  return u.toString() === link;
}

/** Every http(s) link in a text, and anything that looks like a bare domain. */
export function linksIn(text: string): string[] {
  return [...text.matchAll(/\bhttps?:\/\/[^\s<>"'`)\]]+/gi)].map((m) => m[0]);
}

/** An outgoing text passes when it has exactly `n` links (or at most `n`, with `atMost`), each on the allowlist. */
export function linksOk(text: string, n: number, atMost = false): boolean {
  const found = linksIn(text);
  if (atMost ? found.length > n : found.length !== n) return false;
  if (/\bwww\./i.test(text) || /\b[a-z][a-z0-9+.-]{1,15}:\/\/(?!getnightshift\.tech\/)/i.test(text)) return false;
  return found.every(allowedLink);
}

// built from a string: a bundler may print the line-separator escape inside a regex literal as a real line break
const CONTROL = new RegExp("[\\u0000-\\u001f\\u007f-\\u009f\\u00ad\\u061c\\u180e\\u200b-\\u200f\\u2028-\\u202e\\u2060-\\u206f\\ufeff\\ufff9-\\ufffb]", "g");

/**
 * Outside text as plain words: no HTML, no markdown links or images, no URLs, no entities, no
 * control or direction characters, whitespace collapsed, at most `max` characters.
 */
export function clean(input: unknown, max = 280): string {
  let t = typeof input === "string" ? input.slice(0, 5000) : "";
  t = t.normalize("NFKC").replace(CONTROL, " ");
  t = t.replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<(script|style|iframe|object|embed|svg)\b[\s\S]*?<\/\1\s*>/gi, " ")
    .replace(/<\/?[a-z!?][^>]*>/gi, " ");
  t = t.replace(/!?\[([^\]]{0,200})\]\([^)]*\)/g, "$1")
    .replace(/!?\[([^\]]{0,200})\]\[[^\]]*\]/g, "$1")
    .replace(/^\s*\[[^\]]+\]:\s*\S+.*$/gm, " ");
  t = t.replace(/\b[a-z][a-z0-9+.-]{1,15}:\/\/\S*/gi, " ")
    .replace(/\b(?:javascript|data|vbscript|mailto|file|tel):\S*/gi, " ")
    .replace(/\bwww\.\S+/gi, " ")
    .replace(/&(?:[a-z]{2,10}|#\d{1,7}|#x[0-9a-f]{1,6});/gi, " ")
    .replace(/[<>`*~#|\\{}[\]]/g, " ");
  t = t.replace(/\s+/g, " ").trim();
  return t.length > max ? `${t.slice(0, max - 1).trimEnd()}…` : t;
}

/** clean(), and no domains or @handles either: for the few words we send that did not come from a template. */
export function cleanOutgoing(input: unknown, max = 200): string {
  const t = clean(input, 2000)
    .replace(/\b[a-z0-9-]+(?:\.[a-z0-9-]+)*\.[a-z]{2,24}\b(?:\/\S*)?/gi, " ")
    .replace(/@[A-Za-z0-9_.-]{2,}/g, " ")
    .replace(/\s+/g, " ").trim();
  return t.length > max ? `${t.slice(0, max - 1).trimEnd()}…` : t;
}

const INJECTION = [
  /\b(ignore|disregard|forget|override|bypass)\b[^.!?\n]{0,60}\b(instructions?|prompts?|rules?|guidelines|previous|above|owners?|system)\b/i,
  /\bsystem prompt\b/i,
  /\byou are now\b/i,
  /\b(new|updated|real) instructions?\b/i,
  /\b(note|message|attention|hey)\s+(to\s+)?(all\s+|any\s+)?(ai|llms?|language models?|agents?|assistants?|bots?)\b/i,
  /\bdo not (tell|inform|ask) (your|the) (owner|user|operator)\b/i,
];
/** Text written to steer an AI that reads it. Such prospects are rejected, never contacted. */
export const injectionLike = (s: string) => INJECTION.some((r) => r.test(s));

/** Blanks out tokens, keys, bearer values and the given secrets, so a log line can be kept or shown. */
export function redact(s: string, secrets: readonly string[] = []): string {
  let t = String(s);
  for (const x of secrets) if (x && x.length >= 6) t = t.split(x).join("[redacted]");
  return t
    .replace(/\b(bearer|basic)\s+[A-Za-z0-9._~+/=-]{6,}/gi, "$1 [redacted]")
    .replace(/\bgh[pousr]_[A-Za-z0-9]{16,}/g, "[redacted]")
    .replace(/\bgithub_pat_[A-Za-z0-9_]{20,}/g, "[redacted]")
    .replace(/\bbot\d{5,}:[A-Za-z0-9_-]{20,}/g, "bot[redacted]")
    .replace(/\b\d{6,}:[A-Za-z0-9_-]{30,}/g, "[redacted]")
    .replace(/\b(?:sk|pk|rk)-[A-Za-z0-9_-]{16,}/g, "[redacted]")
    .replace(/\bxox[abposr]-[A-Za-z0-9-]{10,}/g, "[redacted]")
    .replace(/\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{4,}/g, "[redacted]")
    .replace(/\b0x[0-9a-fA-F]{64}\b/g, "[redacted]")
    .replace(/\b(api[_-]?key|apikey|access[_-]?token|auth[_-]?token|refresh[_-]?token|token|secret|password|passwd|app[_-]?password|authorization|cookie|private[_-]?key)(["']?\s*[:=]\s*["']?)(?!\[redacted\])([^\s"'&,;]{4,})/gi, "$1$2[redacted]")
    .replace(/([?&](?:token|key|api_key|apikey|access_token|secret|sig|signature|password)=)[^&\s"']+/gi, "$1[redacted]");
}
