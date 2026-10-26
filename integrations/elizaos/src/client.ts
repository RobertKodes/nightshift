// nightshift-client: a small, dependency-free client for https://getnightshift.tech
// It never holds keys. Paid calls need a `sign` function that YOU supply.

export const DEFAULT_BASE = "https://getnightshift.tech";

/** Any failure: carries the HTTP status (0 = network/parse) and the server's own message. */
export class NightshiftError extends Error {
  constructor(message: string, public status: number, public body?: unknown) {
    super(message);
    this.name = "NightshiftError";
  }
}
/** The server asked for more than the caller's maxUsd. Nothing was signed. */
export class PriceExceedsMaxError extends NightshiftError {
  constructor(public priceUsd: number, public maxUsd: number) {
    super(`price $${priceUsd} is above maxUsd $${maxUsd}; refusing to sign`, 402);
    this.name = "PriceExceedsMaxError";
  }
}

/** One entry of `accepts` in an x402 v2 402 response. */
export interface PaymentRequirement {
  scheme: string; network: string; asset: string; amount: string; payTo: string;
  maxTimeoutSeconds?: number; extra?: Record<string, unknown>;
}
export interface PaymentRequired {
  x402Version: number; error?: string;
  resource?: { url: string; description?: string; mimeType?: string };
  accepts: PaymentRequirement[];
}
/** Returns the value for the PAYMENT-SIGNATURE header (your wallet code lives here). */
export type Signer = (
  req: PaymentRequirement,
  ctx: { resource?: PaymentRequired["resource"]; x402Version: number },
) => Promise<string> | string;

export type SwarmKind = "website" | "research" | "audit" | "contract" | "tests" | "review" | "frontend" | "image" | "logo";
export type SwarmInput = { kind: SwarmKind; brief?: string; repo?: string; commit?: string; chain?: "ethereum" | "base"; address?: string; name?: string; style?: string };
export type SwarmQuote = { quoteId: string; priceUsd: number; expiresAt: string; kind: SwarmKind; pay: string };
export type PaidOptions = { maxUsd: number; sign: Signer };
export type SignedRequest = { url: string; payment: string };
export const HOUSE_TOOLS = ["x402-seller-check", "payment-verify", "token-price", "wallet-check", "tx-explain", "gas-now", "name-resolve"] as const;
export type HouseTool = typeof HOUSE_TOOLS[number];

export interface ClientOptions { baseUrl?: string; fetch?: typeof fetch; timeoutMs?: number }

type Json = any;

export class NightshiftClient {
  readonly base: string;
  private f: typeof fetch;
  private timeoutMs: number;
  private rpcId = 0;

  constructor(opts: ClientOptions = {}) {
    this.base = (opts.baseUrl ?? DEFAULT_BASE).replace(/\/+$/, "");
    this.f = opts.fetch ?? globalThis.fetch.bind(globalThis);
    this.timeoutMs = opts.timeoutMs ?? 30_000;
  }

  // ---------- low level ----------
  private async request(url: string, init: RequestInit = {}): Promise<Response> {
    const ctl = new AbortController();
    const t = setTimeout(() => ctl.abort(), this.timeoutMs);
    try {
      return await this.f(url, { ...init, signal: ctl.signal });
    } catch (e) {
      throw new NightshiftError(`network error: ${(e as Error).message}`, 0);
    } finally {
      clearTimeout(t);
    }
  }
  private async readBody(res: Response): Promise<Json> {
    const text = await res.text();
    try { return JSON.parse(text); } catch { return text; }
  }
  private errMessage(body: Json, res: Response): string {
    if (body && typeof body === "object") return body.error?.message ?? body.error ?? body.message ?? `HTTP ${res.status}`;
    return typeof body === "string" && body ? body.slice(0, 300) : `HTTP ${res.status}`;
  }

  /** GET a path (or full URL) and return parsed JSON. Throws NightshiftError on non-2xx. */
  async get(pathOrUrl: string, query?: Record<string, string | number | undefined>): Promise<Json> {
    const url = new URL(pathOrUrl.startsWith("http") ? pathOrUrl : this.base + pathOrUrl);
    for (const [k, v] of Object.entries(query ?? {})) if (v !== undefined) url.searchParams.set(k, String(v));
    const res = await this.request(url.toString(), { headers: { accept: "application/json" } });
    const body = await this.readBody(res);
    if (!res.ok) throw new NightshiftError(this.errMessage(body, res), res.status, body);
    return body;
  }

  // ---------- MCP ----------
  /** Call one tool on the keyless public MCP endpoint. Parses a JSON or an SSE reply. */
  async mcp(tool: string, args: Record<string, unknown> = {}): Promise<Json> {
    const res = await this.request(this.base + "/mcp/public", {
      method: "POST",
      headers: { "content-type": "application/json", accept: "application/json, text/event-stream" },
      body: JSON.stringify({ jsonrpc: "2.0", id: ++this.rpcId, method: "tools/call", params: { name: tool, arguments: args } }),
    });
    const raw = await res.text();
    let msg: Json;
    if ((res.headers.get("content-type") ?? "").includes("text/event-stream")) {
      // SSE: take the last "data:" line that parses as JSON-RPC
      const datas = raw.split(/\r?\n/).filter((l) => l.startsWith("data:")).map((l) => l.slice(5).trim());
      for (const d of datas.reverse()) { try { msg = JSON.parse(d); break; } catch { /* keep looking */ } }
    } else {
      try { msg = JSON.parse(raw); } catch { /* handled below */ }
    }
    if (!msg) throw new NightshiftError(res.ok ? "unreadable MCP reply" : `HTTP ${res.status}`, res.status, raw.slice(0, 300));
    if (msg.error) throw new NightshiftError(msg.error.message ?? "MCP error", res.status, msg.error);
    const result = msg.result;
    const text = result?.content?.find((c: Json) => c.type === "text")?.text;
    if (result?.isError) throw new NightshiftError(text ?? "tool error", res.status, result);
    if (typeof text === "string") { try { return JSON.parse(text); } catch { return text; } }
    return result;
  }

  // ---------- free helpers ----------
  startHere() { return this.mcp("start_here"); }
  askSwarm(question: string) { return this.mcp("swarm_mind_ask", { question }); }
  verdictPreview(token: string) { return this.mcp("verdict_preview", { token }); }
  /** Free Watchtower report: what changed since the last observation, with evidence. */
  watchtowerSample(address: string) { return this.get("/api/watchtower/sample", { address }); }
  /** Free quick integration check of a URL. */
  buildcheckSample(url: string) { return this.get("/api/crews/buildcheck/sample", { url }); }
  swarmStats() { return this.get("/api/v1/swarm/stats"); }
  swarmQuote(input: SwarmInput): Promise<SwarmQuote> { return this.get("/api/v1/swarm/quote", input); }
  swarmJob(orderId: string, token: string) { return this.get(`/api/v1/swarm/jobs/${encodeURIComponent(orderId)}`, { token }); }

  /** Prepare once; persist this request privately before submitting it. */
  async prepareSwarmOrder(quote: SwarmQuote, opts: PaidOptions): Promise<SignedRequest> {
    if (!Number.isFinite(opts.maxUsd) || opts.maxUsd <= 0 || quote.priceUsd > opts.maxUsd) throw new PriceExceedsMaxError(quote.priceUsd, opts.maxUsd);
    if (!/^[0-9a-f]{8}-[0-9a-f-]{27}$/i.test(quote.quoteId) || !Number.isFinite(quote.priceUsd) || quote.priceUsd < 3 || Date.parse(quote.expiresAt) <= Date.now() || !Number.isFinite(Date.parse(quote.expiresAt))) throw new NightshiftError("Invalid or expired checked quote", 400);
    const url = `${this.base}/api/v1/swarm/order?${new URLSearchParams({ quoteId: quote.quoteId })}`, t = await this.getTerms(url);
    if (!t || t.terms.x402Version !== 2 || t.requirement.scheme !== "exact" || t.requirement.network !== "eip155:8453" || t.requirement.asset.toLowerCase() !== "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913" || !/^0x[0-9a-f]{40}$/i.test(t.requirement.payTo) || !/^\d+$/.test(t.requirement.amount) || BigInt(t.requirement.amount) !== BigInt(Math.round(quote.priceUsd * 1e6)) || t.terms.resource?.url !== `${this.base}/api/v1/swarm/order`) throw new NightshiftError("Payment terms do not match the checked Swarm Desk quote", 402);
    return { url, payment: await opts.sign(t.requirement, { resource: t.terms.resource, x402Version: 2 }) };
  }
  async submitPaid(request: SignedRequest): Promise<Json> {
    if (new URL(request.url).origin !== new URL(this.base).origin || !request.payment) throw new NightshiftError("Invalid saved payment request", 400);
    try {
      const res = await this.request(request.url, { redirect: "error", headers: { accept: "application/json", "PAYMENT-SIGNATURE": request.payment } });
      const body = await this.readBody(res);
      if (!res.ok && !(res.status === 502 && body?.refundOwed && body?.payment?.tx)) throw new NightshiftError(this.errMessage(body, res), res.status, body);
      return body;
    } catch (e) { Object.assign(e as Error, { signedRequest: request }); throw e; }
  }
  /** Returns a receipt or pending status. Resume with submitPaid, never a new signature. */
  async swarmOrder(quote: SwarmQuote, opts: PaidOptions & { onSigned?(request: SignedRequest): void | Promise<void> }) {
    const request = await this.prepareSwarmOrder(quote, opts); await opts.onSigned?.(request); return this.submitPaid(request);
  }
  async pollSwarm(orderId: string, token: string, opts: { intervalMs?: number; timeoutMs?: number; onStatus?(job: Json): void | Promise<void> } = {}) {
    const until = Date.now() + (opts.timeoutMs ?? 3_600_000);
    for (;;) { const job = await this.swarmJob(orderId, token); await opts.onStatus?.(job); if (["done", "failed", "unpaid"].includes(job.status)) return job; if (Date.now() >= until) throw new NightshiftError("Polling timed out; keep the order token and resume later", 0, { orderId }); await new Promise((r) => setTimeout(r, opts.intervalMs ?? 30_000)); }
  }
  async prepareHouseTool(tool: HouseTool, input: Record<string, string | number | undefined>, opts: PaidOptions): Promise<SignedRequest> {
    if (!(HOUSE_TOOLS as readonly string[]).includes(tool)) throw new NightshiftError("Unknown house tool", 400);
    const url = new URL(`${this.base}/api/v1/${tool}`); for (const [k, v] of Object.entries(input)) if (v !== undefined) url.searchParams.set(k, String(v));
    if (!Number.isFinite(opts.maxUsd) || opts.maxUsd <= 0) throw new NightshiftError("A finite positive budget is required", 400);
    const t = await this.getTerms(url.href);
    if (!t || t.priceUsd > opts.maxUsd) throw new PriceExceedsMaxError(t?.priceUsd ?? Infinity, opts.maxUsd);
    if (t.terms.x402Version !== 2 || t.requirement.scheme !== "exact" || t.requirement.network !== "eip155:8453" || t.requirement.asset.toLowerCase() !== "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913" || !/^0x[0-9a-f]{40}$/i.test(t.requirement.payTo) || !/^[1-9]\d*$/.test(t.requirement.amount)) throw new NightshiftError("Expected exact x402 USDC terms on Base", 402);
    return { url: url.href, payment: await opts.sign(t.requirement, { resource: t.terms.resource, x402Version: 2 }) };
  }
  async houseTool(tool: HouseTool, input: Record<string, string | number | undefined>, opts: PaidOptions) { return this.submitPaid(await this.prepareHouseTool(tool, input, opts)); }
  x402SellerCheck(target: string, opts: PaidOptions) { return this.houseTool("x402-seller-check", { target }, opts); }
  paymentVerify(input: { chain: "ethereum" | "base"; tx: string; recipient: string; token?: string; minAmount?: string }, opts: PaidOptions) { return this.houseTool("payment-verify", input, opts); }
  tokenPrice(chain: "ethereum" | "base", token: string, opts: PaidOptions) { return this.houseTool("token-price", { chain, token }, opts); }
  walletCheck(chain: "ethereum" | "base", address: string, opts: PaidOptions) { return this.houseTool("wallet-check", { chain, address }, opts); }
  txExplain(chain: "ethereum" | "base", tx: string, opts: PaidOptions) { return this.houseTool("tx-explain", { chain, tx }, opts); }
  gasNow(opts: PaidOptions) { return this.houseTool("gas-now", {}, opts); }
  nameResolve(chain: "ethereum" | "base", input: string, opts: PaidOptions) { return this.houseTool("name-resolve", { chain, input }, opts); }
  services() { return this.get("/api/v1/services"); }
  crews() { return this.get("/api/crews"); }
  proof() { return this.get("/api/proof"); }

  // ---------- paid (x402 v2, USDC on Base) ----------
  /** Ask for the 402 terms without paying. Returns null if the URL is not paywalled. */
  async getTerms(url: string): Promise<{ terms: PaymentRequired; priceUsd: number; requirement: PaymentRequirement } | null> {
    const res = await this.request(url, { headers: { accept: "application/json" } });
    if (res.status !== 402) {
      if (res.ok) return null;
      throw new NightshiftError(this.errMessage(await this.readBody(res), res), res.status);
    }
    let terms: PaymentRequired | undefined;
    const header = res.headers.get("payment-required");
    if (header) { try { terms = JSON.parse(atob(header)); } catch { /* fall back to body */ } }
    if (!terms) { const b = await this.readBody(res); if (b && typeof b === "object" && Array.isArray(b.accepts)) terms = b; }
    const requirement = terms?.accepts?.find((a) => a.scheme === "exact") ?? terms?.accepts?.[0];
    if (!terms || !requirement) throw new NightshiftError("402 without readable x402 terms", 402);
    // USDC has 6 decimals; `amount` is in base units.
    return { terms, requirement, priceUsd: Number(requirement.amount) / 1e6 };
  }

  /**
   * Bounded paid GET. Reads the terms, refuses if price > maxUsd, asks YOUR signer for
   * the PAYMENT-SIGNATURE value, retries once. A missing/invalid maxUsd throws before any request.
   */
  async paidGet(url: string, opts: { maxUsd: number; sign: Signer }): Promise<Json> {
    if (!(typeof opts.maxUsd === "number" && Number.isFinite(opts.maxUsd) && opts.maxUsd > 0)) throw new NightshiftError("maxUsd must be a positive number", 0);
    if (typeof opts.sign !== "function") throw new NightshiftError("sign function required", 0);
    const t = await this.getTerms(url);
    if (!t) return this.get(url); // not paywalled
    if (t.priceUsd > opts.maxUsd) throw new PriceExceedsMaxError(t.priceUsd, opts.maxUsd);
    if (t.requirement.scheme !== "exact" || t.terms.x402Version !== 2 || t.requirement.network !== "eip155:8453" || t.requirement.asset.toLowerCase() !== "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913" || !/^0x[0-9a-f]{40}$/i.test(t.requirement.payTo) || !/^[1-9]\d*$/.test(t.requirement.amount)) throw new NightshiftError("Expected exact x402 v2 USDC on Base", 402);
    const sig = await opts.sign(t.requirement, { resource: t.terms.resource, x402Version: t.terms.x402Version });
    const res = await this.request(url, { headers: { accept: "application/json", "PAYMENT-SIGNATURE": sig } });
    const body = await this.readBody(res);
    if (!res.ok) throw new NightshiftError(this.errMessage(body, res), res.status, body);
    return body;
  }
}
export default NightshiftClient;
