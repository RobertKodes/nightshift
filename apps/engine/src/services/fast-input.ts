import { normalize } from "viem/ens";

export const FAST_IDS = ["x402-seller-check", "payment-verify", "token-price", "wallet-check", "tx-explain", "gas-now", "name-resolve"] as const;
export type FastId = typeof FAST_IDS[number];
export type Chain = "ethereum" | "base";
export type FastInput = { chain?: Chain; target?: string; tx?: string; token?: string; recipient?: string; minAmount?: string; address?: string; input?: string };
export const addressPattern = /^0x[0-9a-fA-F]{40}$/;
export const hashPattern = /^0x[0-9a-fA-F]{64}$/;
export const isFastId = (id: string): id is FastId => (FAST_IDS as readonly string[]).includes(id);
const bad = (message: string): never => { throw Object.assign(new Error(message), { status: 400 }); };
const addr = (v: string, key: string) => addressPattern.test(v) ? v.toLowerCase() : bad(`${key}: 0x and 40 hex characters.`);

/** Validate before asking for a payment or reading an upstream. */
export function fastInput(id: FastId, q: URLSearchParams): FastInput {
  const get = (k: string) => (q.get(k) ?? "").trim();
  for (const [k, v] of q) if (v.length > 2_000 || q.getAll(k).length > 1) bad(`Invalid or repeated ${k}.`);
  const keys: Record<FastId, string[]> = { "x402-seller-check": ["target"], "payment-verify": ["chain", "tx", "token", "recipient", "minAmount"], "token-price": ["chain", "token"], "wallet-check": ["chain", "address"], "tx-explain": ["chain", "tx"], "gas-now": [], "name-resolve": ["chain", "input"] };
  for (const [key] of q) if (![...keys[id], "holder", "sim"].includes(key)) bad(`Unknown input: ${key}.`);
  if (id === "gas-now") return {};
  if (id === "x402-seller-check") {
    const target = get("target");
    if (addressPattern.test(target)) return { target: target.toLowerCase() };
    let u: URL;
    try { u = new URL(target.includes("://") ? target : `https://${target}`); } catch { return bad("target: an HTTPS endpoint, host or payTo address."); }
    if (!target || u.protocol !== "https:" || u.username || u.password || u.hash || (u.port && u.port !== "443")) bad("target: HTTPS only, standard port, no credentials or fragment.");
    if (!target.includes("://") && (u.pathname !== "/" || u.search)) bad("target: use a full HTTPS URL for an endpoint.");
    return { target: target.includes("://") ? u.href : u.host };
  }
  const chain = get("chain");
  if (chain !== "ethereum" && chain !== "base") bad("chain: ethereum or base.");
  const out: FastInput = { chain: chain as Chain };
  if (id === "payment-verify" || id === "tx-explain") {
    if (!hashPattern.test(get("tx"))) bad("tx: 0x and 64 hex characters.");
    out.tx = get("tx").toLowerCase();
  }
  if (id === "payment-verify") {
    out.recipient = addr(get("recipient"), "recipient");
    out.token = !get("token") || get("token").toUpperCase() === "USDC" ? "USDC" : addr(get("token"), "token");
    out.minAmount = get("minAmount") || "0";
    if (!/^\d{1,60}(\.\d{1,36})?$/.test(out.minAmount)) bad("minAmount: a non-negative decimal amount, without an exponent.");
  }
  if (id === "token-price") out.token = addr(get("token"), "token");
  if (id === "wallet-check") out.address = addr(get("address"), "address");
  if (id === "name-resolve") {
    const input = get("input");
    if (addressPattern.test(input)) out.input = input.toLowerCase();
    else {
      try { out.input = normalize(input); } catch { bad("input: a valid ENS name, Basename or address."); }
      if (!out.input || out.input.length > 255 || !out.input.endsWith(chain === "base" ? ".base.eth" : ".eth")) bad("input: an .eth name on Ethereum or .base.eth name on Base.");
    }
  }
  return out;
}
