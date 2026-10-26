import { request } from "node:https";
import { isDeepStrictEqual } from "node:util";
import { publicUrl } from "../net.js";
import { addressPattern } from "./fast-input.js";
import type { BazaarSnapshot, Listing, Terms } from "./bazaar-index.js";

export type Probe = { status: number; header: string | null; body: unknown; refused?: string };
export const USDC: Record<string, string> = { base: "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913", ethereum: "0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48" };
type Reason = { id: string; impact: "avoid" | "caution"; text: string };

/** One GET, pinned to vetted DNS, no redirects, 64 KiB and four seconds total. */
export async function probeSeller(target: string, resolve = publicUrl): Promise<Probe> {
  const signal = AbortSignal.timeout(4_000);
  const u = new URL(target);
  if (u.protocol !== "https:" || u.username || u.password || (u.port && u.port !== "443")) throw new Error("Refused: HTTPS on the standard port only.");
  const vetted = await Promise.race([resolve(u.href), new Promise<null>((r) => signal.addEventListener("abort", () => r(null), { once: true }))]);
  if (!vetted) throw new Error("Refused: private, loopback, link-local, unresolved host or DNS timeout.");
  return new Promise((resolveReply, reject) => {
    const req = request(vetted.url, {
      method: "GET", signal, headers: { accept: "application/json", "user-agent": "NIGHTSHIFT-seller-check/1" },
      lookup: (_host: string, options: { all?: boolean }, cb: (...args: unknown[]) => void) => options?.all ? cb(null, [{ address: vetted.address, family: vetted.family }]) : cb(null, vetted.address, vetted.family),
    } as never, (res) => {
      const status = res.statusCode ?? 0;
      if (status >= 300 && status < 400) { res.destroy(); resolveReply({ status, header: null, body: null, refused: "Redirect not followed." }); return; }
      const chunks: Buffer[] = []; let size = 0;
      res.on("data", (c: Buffer) => { size += c.length; if (size > 64 * 1024) res.destroy(new Error("Seller body exceeds 64 KiB.")); else chunks.push(c); });
      res.on("error", reject);
      res.on("end", () => { let body: unknown = null; try { body = JSON.parse(Buffer.concat(chunks).toString("utf8")); } catch { /* Invalid JSON is checked below. */ } const h = res.headers["payment-required"]; resolveReply({ status, header: typeof h === "string" ? h : null, body }); });
    });
    req.on("error", reject); req.end();
  });
}

export function listingsFor(index: BazaarSnapshot, target: string): Listing[] {
  if (addressPattern.test(target)) return (index.byPayTo[target.toLowerCase()] ?? []).map((url) => index.byResource[url]!);
  if (!target.includes("://")) return (index.byHost[target] ?? []).map((url) => index.byResource[url]!);
  const exact = index.byResource[new URL(target).href];
  return exact ? [exact] : [];
}

const sameAddress = (network: string, a: string, b: string) => network.startsWith("eip155:") ? a.toLowerCase() === b.toLowerCase() : a === b;
const equalTerms = (a: Terms, b: Terms) => a.scheme === b.scheme && a.network === b.network && sameAddress(a.network, a.asset, b.asset) && sameAddress(a.network, a.payTo, b.payTo) && a.amount === b.amount;

/** A mismatch is evidence; a missing check is an unknown. */
export function sellerVerdict(rows: Listing[], probe: Probe | null, now: number, unavailable: string[] = []) {
  const reasons: Reason[] = [];
  const add = (id: string, impact: Reason["impact"], text: string) => { if (!reasons.some((r) => r.id === id)) reasons.push({ id, impact, text }); };
  const unknowns = [...unavailable];
  if (!rows.length) { add("unlisted", "caution", "No matching resource in the available Bazaar snapshot."); }
  if (rows.some((r) => r.createdAt && now - Date.parse(r.createdAt) < 7 * 86400_000)) add("brand-new", "caution", "A listing was created less than seven days ago.");
  if (rows.some((r) => !r.createdAt)) unknowns.push("listing creation time (first observed is not creation time)");
  const groups = new Map<string, number>();
  for (const r of rows) { const key = r.description.toLowerCase().replace(/0x[\da-f]+|\d+/g, "#").replace(/\s+/g, " ").trim(); if (key) groups.set(key, (groups.get(key) ?? 0) + 1); }
  if ([...groups.values()].some((n) => n >= 10)) add("similar-listings", "caution", "At least ten listings have near-identical descriptions; this is a duplication signal, not proof of fraud.");
  if (rows.some((r) => r.previousAccepts && r.accepts.some((a) => !r.previousAccepts!.some((b) => equalTerms(a, b))))) add("terms-changed", "caution", "Payment terms changed since the previous crawl.");
  let valid: boolean | null = null;
  if (!probe) unknowns.push("live x402 challenge");
  else if (probe.refused) unknowns.push(probe.refused);
  else {
    let header: unknown;
    try { if (probe.header && probe.header.length <= 90_000) header = JSON.parse(Buffer.from(probe.header, "base64").toString("utf8")); } catch { /* Invalid header. */ }
    const body = probe.body as { x402Version?: number; accepts?: Terms[]; resource?: { url?: string } } | null;
    valid = probe.status === 402 && body?.x402Version === 2 && typeof body.resource?.url === "string" && /^https:\/\//.test(body.resource.url) && !!header && isDeepStrictEqual(header, body) && Array.isArray(body.accepts) && body.accepts.length > 0 && body.accepts.length <= 20;
    if (!valid) add("invalid-challenge", "avoid", "The endpoint did not return a v2 402 with identical PAYMENT-REQUIRED header and JSON body.");
    if (valid) {
      for (const t of body!.accepts!) {
        if (!t || typeof t !== "object" || ["scheme", "network", "asset", "payTo", "amount"].some((k) => typeof (t as unknown as Record<string, unknown>)[k] !== "string") || !/^\d{1,78}$/.test(t.amount ?? "") || BigInt(t.amount) <= 0n || !Number.isSafeInteger(t.maxTimeoutSeconds) || t.maxTimeoutSeconds <= 0 || t.maxTimeoutSeconds > 3600) { valid = false; add("invalid-terms", "avoid", "An accepts entry has invalid scheme, network, addresses, amount or timeout."); continue; }
        if (t.scheme !== "exact" || !/^eip155:[1-9]\d*$/.test(t.network)) { valid = null; unknowns.push(`payment scheme or network not supported by live address checks: ${t.scheme} on ${t.network}`); }
        else if (!addressPattern.test(t.payTo) || !addressPattern.test(t.asset)) { valid = false; add("invalid-terms", "avoid", "Invalid EVM payTo or asset address."); continue; }
        const otherUsdc = t.network === "eip155:8453" ? USDC.ethereum : t.network === "eip155:1" ? USDC.base : null;
        if (otherUsdc && t.asset.toLowerCase() === otherUsdc) { valid = false; add("asset-network", "avoid", "The USDC asset belongs to the other supported chain."); }
        const listed = rows.flatMap((r) => r.accepts);
        if (listed.length && !listed.some((b) => b.network === t.network && sameAddress(t.network, b.asset, t.asset) && sameAddress(t.network, b.payTo, t.payTo))) add("payto-mismatch", "avoid", "Live payTo, asset or network differs from this resource's Bazaar terms.");
        else if (listed.length && !listed.some((b) => equalTerms(t, b))) add("price-changed", "caution", "The live price differs from this resource's Bazaar price.");
      }
    }
  }
  const unique = [...new Set(unknowns)];
  const verdict = reasons.some((r) => r.impact === "avoid") ? "avoid" : reasons.length || unique.length ? "caution" : "no_issues_found";
  const summary = `${verdict === "no_issues_found" ? "No issues found in the checks that ran" : reasons.map((r) => r.text).join(" ") || "No issues found in the checks that ran"}${unique.length ? `; could not check: ${unique.join(", ")}` : "."}`;
  return { verdict, reasons, summary, unavailable: unique, validX402: valid };
}
