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
    if (!(typeof opts.maxUsd === "number" && opts.maxUsd > 0)) throw new NightshiftError("maxUsd must be a positive number", 0);
    if (typeof opts.sign !== "function") throw new NightshiftError("sign function required", 0);
    const t = await this.getTerms(url);
    if (!t) return this.get(url); // not paywalled
    if (t.priceUsd > opts.maxUsd) throw new PriceExceedsMaxError(t.priceUsd, opts.maxUsd);
    const sig = await opts.sign(t.requirement, { resource: t.terms.resource, x402Version: t.terms.x402Version });
    const res = await this.request(url, { headers: { accept: "application/json", "PAYMENT-SIGNATURE": sig } });
    const body = await this.readBody(res);
    if (!res.ok) throw new NightshiftError(this.errMessage(body, res), res.status, body);
    return body;
  }
}
export default NightshiftClient;
