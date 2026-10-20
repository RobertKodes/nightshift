import { generateJwt } from "@coinbase/cdp-sdk/auth";
import type { Offer, PaymentPayload, Requirement } from "./seller.js";

/**
 * Coinbase's hosted x402 facilitator (CDP). It verifies a buyer's signed authorization and submits it
 * on chain itself, paying the gas; the USDC still moves straight from the buyer to the company's
 * wallet. A payment it settles with the "bazaar" extension and the resource lists that resource in
 * the CDP Bazaar, the catalogue AI agents search. Only resources settled here are listed there.
 */
export const CDP_FACILITATOR_URL = "https://api.cdp.coinbase.com/platform/v2/x402";

/** A CDP secret API key: its id and its secret (Ed25519, base64 of the 64-byte seed and public key). */
export interface CdpKey { id: string; secret: string }

/** The secret is the base64 Ed25519 key of the CDP key file (its privateKey): 64 bytes once decoded. */
export const isCdpSecret = (s: string) => /^[A-Za-z0-9+/]+={0,2}$/.test(s) && Buffer.from(s, "base64").length === 64;

/**
 * The bearer token for one call, signed with Coinbase's own helper: claims sub (the key id), iss "cdp",
 * nbf and exp two minutes apart, and uris bound to this method, host and path; header alg EdDSA, kid
 * and a random nonce. A token for one endpoint opens no other.
 */
export function cdpJwt(key: CdpKey, method: "GET" | "POST", url: string, expiresIn = 120): Promise<string> {
  const u = new URL(url);
  return generateJwt({ apiKeyId: key.id, apiKeySecret: key.secret, requestMethod: method, requestHost: u.host, requestPath: u.pathname, expiresIn });
}

/** What the facilitator says about each extension of a payment, e.g. bazaar: { status: "success" | "processing" | "rejected" }. */
export type ExtensionResponses = Record<string, { status?: string; rejectedReason?: string } & Record<string, unknown>>;
export interface VerifyAnswer { isValid: boolean; invalidReason?: string; invalidMessage?: string; payer?: string; extensionResponses?: ExtensionResponses }
export interface SettleAnswer { success: boolean; transaction: string; network: string; payer?: string; errorReason?: string; errorMessage?: string; extensionResponses?: ExtensionResponses }
export interface SupportedKind { x402Version: number; scheme: string; network: string; extra?: Record<string, unknown> }
export interface SupportedAnswer { kinds: SupportedKind[]; extensions?: string[]; signers?: Record<string, string[]> }

export const isTxHash = (h: unknown): h is `0x${string}` => typeof h === "string" && /^0x[0-9a-fA-F]{64}$/.test(h);

/**
 * No verdict came back (network error, timeout, 5xx, 429, a refused key, or an answer that is not
 * one): what the facilitator did is unknown. `transaction` is set when the failed answer still named
 * one, so it is followed instead of being settled again.
 */
export class FacilitatorUnavailable extends Error {
  override name = "FacilitatorUnavailable";
  constructor(readonly op: "verify" | "settle" | "supported", readonly status: number | null, detail: string, readonly transaction?: `0x${string}`) {
    super(`x402 facilitator ${op} unavailable${status ? ` (HTTP ${status})` : ""}: ${detail}`);
  }
}

/**
 * The payload a facilitator gets: the buyer's signed payment with the resource and extensions this
 * seller advertised, never ones the buyer sent (the signature covers only the transfer, so this
 * changes nothing the buyer agreed to, and nobody can list fake metadata under the company's name).
 */
export function facilitatorPayload(p: PaymentPayload, offer: Offer): PaymentPayload {
  const { resource: _r, extensions: _e, ...rest } = p;
  return { ...rest, resource: offer.resource, ...(offer.extensions ? { extensions: offer.extensions } : {}) };
}

function extensionResponses(h: string | null): ExtensionResponses | undefined {
  if (!h) return undefined;
  try {
    const v = JSON.parse(Buffer.from(h, "base64").toString("utf8"));
    return v && typeof v === "object" && !Array.isArray(v) ? v : undefined;
  } catch { return undefined; }
}

const TIMEOUT_MS = { verify: 15_000, settle: 60_000, supported: 10_000 };

export class CdpFacilitator {
  readonly url: string;
  constructor(
    private readonly key: CdpKey,
    private readonly opts: { url?: string; fetch?: typeof fetch; timeoutMs?: Partial<typeof TIMEOUT_MS> } = {},
  ) {
    this.url = (opts.url ?? CDP_FACILITATOR_URL).replace(/\/+$/, "");
  }

  /** POST /verify: is this payment good for these requirements (signature, amount, balance, time window)? Moves nothing. */
  async verify(p: PaymentPayload, req: Requirement): Promise<VerifyAnswer> {
    const { data, ext } = await this.#call("verify", "POST", { x402Version: p.x402Version, paymentPayload: p, paymentRequirements: req }, (d) => typeof d.isValid === "boolean");
    return { ...(data as unknown as VerifyAnswer), ...(ext ? { extensionResponses: ext } : {}) };
  }

  /** POST /settle: submits the authorization on chain and answers with the transaction. */
  async settle(p: PaymentPayload, req: Requirement): Promise<SettleAnswer> {
    const { data, ext } = await this.#call("settle", "POST", { x402Version: p.x402Version, paymentPayload: p, paymentRequirements: req }, (d) => typeof d.success === "boolean");
    return { ...(data as unknown as SettleAnswer), ...(ext ? { extensionResponses: ext } : {}) };
  }

  /** GET /supported: the payment kinds (version, scheme, network) the facilitator settles. Read-only. */
  async supported(): Promise<SupportedAnswer & { status: number }> {
    const { data, status } = await this.#call("supported", "GET", undefined, (d) => Array.isArray(d.kinds));
    return { ...(data as unknown as SupportedAnswer), status };
  }

  async #call(op: "verify" | "settle" | "supported", method: "GET" | "POST", body: unknown, verdict: (d: Record<string, unknown>) => boolean) {
    const url = `${this.url}/${op}`;
    let token: string;
    // the key never appears in an error: only that it could not sign
    try { token = await cdpJwt(this.key, method, url); } catch { throw new FacilitatorUnavailable(op, null, "the CDP API key could not sign the request (check CDP_API_KEY_ID and CDP_API_KEY_SECRET)"); }
    const ms = this.opts.timeoutMs?.[op] ?? TIMEOUT_MS[op];
    let res: Response, text: string;
    try {
      res = await (this.opts.fetch ?? fetch)(url, {
        method,
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        signal: AbortSignal.timeout(ms),
      });
      text = await res.text();
    } catch (e) {
      throw new FacilitatorUnavailable(op, null, (e as Error)?.name === "TimeoutError" ? `no answer within ${ms / 1000}s` : "network error");
    }
    let data: Record<string, unknown> | null = null;
    try { const j = JSON.parse(text); if (j && typeof j === "object" && !Array.isArray(j)) data = j; } catch { /* not JSON */ }
    const tx = isTxHash(data?.transaction) ? data.transaction : undefined;
    // a 5xx, a rate limit or a refused key is an outage, whatever its body says
    if (res.status >= 500 || res.status === 429 || res.status === 401 || res.status === 403) throw new FacilitatorUnavailable(op, res.status, String(data?.errorMessage ?? data?.errorReason ?? data?.invalidReason ?? data?.message ?? data?.errorType ?? "no verdict"), tx);
    if (!data || !verdict(data) || (op === "supported" && !res.ok)) throw new FacilitatorUnavailable(op, res.status, "the answer is not a verdict", tx);
    return { data, status: res.status, ext: extensionResponses(res.headers.get("EXTENSION-RESPONSES")) };
  }
}
