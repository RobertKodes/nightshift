import { randomBytes, randomUUID } from "node:crypto";
import { x402Client } from "@x402/core/client";
import { encodePaymentSignatureHeader } from "@x402/core/http";
import { ExactEvmScheme } from "@x402/evm/exact/client";
import type { LocalAccount } from "viem";
import { paymentHash } from "./canon.js";
import {
  type Capabilities,
  type CheckResult,
  type ImdAction,
  ImdError,
  type ImdPlane,
  type JobResult,
  type JobState,
  type JobStatus,
  type Order,
  type OrderState,
} from "./types.js";

export interface HttpImdOptions {
  /** The company wallet. It pays from its own IMD balance through Permit2. */
  account: LocalAccount;
  /** Reads the orders back later. Keep it with the company; losing it means `/requests/paid-by`. */
  requestToken?: string;
  baseUrl?: string;
  fetch?: typeof fetch;
}

const JOB_STATES: Record<string, JobState> = {
  queued: "queued",
  planning: "queued",
  executing: "running",
  running: "running",
  completed: "completed",
  blocked: "failed",
  failed: "failed",
  cancelled: "cancelled",
};

/** The real plane at api.imd.fun: quote, x402 + Permit2 payment, quote approval, then follow the order. */
export class HttpImdPlane implements ImdPlane {
  readonly mode = "live" as const;
  readonly requestToken: string;
  readonly #base: string;
  readonly #fetch: typeof fetch;
  readonly #account: LocalAccount;

  constructor(opts: HttpImdOptions) {
    this.#account = opts.account;
    this.requestToken = opts.requestToken ?? randomBytes(32).toString("hex");
    this.#base = opts.baseUrl ?? "https://api.imd.fun";
    this.#fetch = opts.fetch ?? fetch;
  }

  async #call<T>(method: string, path: string, body?: unknown, headers: Record<string, string> = {}, okStatuses = [200, 201, 202]): Promise<{ status: number; json: T; headers: Headers }> {
    const res = await this.#fetch(`${this.#base}${path}`, {
      method,
      headers: { ...(body !== undefined ? { "Content-Type": "application/json" } : {}), ...headers },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    const text = await res.text();
    let json: unknown = null;
    try { json = text ? JSON.parse(text) : null; } catch { json = { raw: text }; }
    if (!okStatuses.includes(res.status)) {
      const j = (json ?? {}) as { error?: string; detail?: string; problems?: unknown };
      throw new ImdError(`${method} ${path}: ${res.status} ${j.error ?? ""} ${j.detail ?? ""}`.trim(), res.status, j.error ?? null, j.problems ?? json);
    }
    return { status: res.status, json: json as T, headers: res.headers };
  }

  #auth() {
    return { Authorization: `Bearer ${this.requestToken}` };
  }

  async capabilities(): Promise<Capabilities> {
    const { json } = await this.#call<{ actions: { action: string; payment: { network: string; asset: string; amount: string; payTo: string }; quoteTtlSeconds: number }[] }>("GET", "/requests/capabilities");
    const a = json.actions.find((x) => x.action === "job.open") ?? json.actions[0];
    if (!a) throw new ImdError("no enabled actions", null, null);
    return {
      price: BigInt(a.payment.amount),
      asset: a.payment.asset as `0x${string}`,
      payTo: a.payment.payTo as `0x${string}`,
      network: a.payment.network,
      quoteTtlSeconds: a.quoteTtlSeconds,
    };
  }

  async check(action: ImdAction, input: unknown): Promise<CheckResult> {
    const { json } = await this.#call<{ blockers?: unknown[]; suggestions?: unknown[]; plan?: unknown[] }>("POST", "/requests/check", { action, input });
    const text = (x: unknown) => (typeof x === "string" ? x : ((x as { message?: string; detail?: string })?.message ?? (x as { detail?: string })?.detail ?? JSON.stringify(x)));
    return {
      action,
      blockers: (json.blockers ?? []).map((b) => ({ code: (b as { code?: string })?.code, message: text(b) })),
      suggestions: (json.suggestions ?? []).map((s) => ({ message: text(s) })),
      plan: (json.plan ?? []).map((p) => (typeof p === "string" ? p : ((p as { title?: string })?.title ?? text(p)))),
    };
  }

  async open(action: ImdAction, input: unknown): Promise<Order> {
    // 1. Quote
    const quote = await this.#call<{ order: { id: string } }>("POST", "/requests/quote", { requestKey: randomUUID(), action, input }, this.#auth());
    const orderId = quote.json.order.id;
    const url = `/requests/${orderId}/submit`;

    // 2. The challenge: x402 v2 requirements plus the quote, scope hash and resource URL
    const ch = (await this.#call<Challenge>("POST", url, undefined, this.#auth(), [402])).json;
    const req = ch.accepts[0];
    if (!req) throw new ImdError("challenge without accepts", 402, null, ch);

    // 3. The Permit2 payment. The plane parses it strictly: no extensions, `accepted` equal to the challenge.
    const client = x402Client.fromConfig({ schemes: [{ network: req.network, client: new ExactEvmScheme(this.#account as never) }] } as never);
    const created = (await client.createPaymentPayload({ x402Version: 2, resource: ch.resource, accepts: [req] } as never)) as Record<string, unknown>;
    const { extensions: _drop, ...generated } = created;
    const payment = JSON.parse(JSON.stringify({ ...generated, accepted: req }));

    // 4. The quote approval of that exact payment
    const q = ch.quote;
    const quoteSignature = await this.#account.signTypedData({
      domain: { name: "IdentityMD Paid Action", version: "1", chainId: Number(q.payment.network.slice(7)) },
      primaryType: "QuoteApproval",
      types: {
        QuoteApproval: [
          { name: "resource", type: "string" },
          { name: "requesterScopeHash", type: "bytes32" },
          { name: "quoteId", type: "string" },
          { name: "quoteHash", type: "bytes32" },
          { name: "paymentHash", type: "bytes32" },
          { name: "action", type: "string" },
          { name: "asset", type: "address" },
          { name: "amount", type: "uint256" },
          { name: "payTo", type: "address" },
          { name: "expiresAt", type: "uint256" },
        ],
      },
      message: {
        resource: ch.resourceUrl,
        requesterScopeHash: `0x${ch.requesterScopeHash}`,
        quoteId: q.id,
        quoteHash: `0x${q.quoteHash}`,
        paymentHash: paymentHash(payment),
        action: q.action,
        asset: q.payment.asset as `0x${string}`,
        amount: BigInt(q.payment.amount),
        payTo: q.payment.payTo as `0x${string}`,
        expiresAt: BigInt(q.expiresAt),
      },
    });

    // 5. Submit. A lost response is retried with the same bytes; the plane never charges twice.
    const headers = { ...this.#auth(), "PAYMENT-SIGNATURE": encodePaymentSignatureHeader(payment) };
    let lastErr: unknown;
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        await this.#call("POST", url, { quoteSignature }, headers);
        return this.order(orderId);
      } catch (err) {
        lastErr = err;
        if (err instanceof ImdError && err.status !== null && err.status < 500) throw err;
        await new Promise((r) => setTimeout(r, 1500 * (attempt + 1)));
      }
    }
    throw lastErr;
  }

  async order(orderId: string): Promise<Order> {
    const { json } = await this.#call<OrderJson>("GET", `/requests/${orderId}`, undefined, this.#auth());
    const result = json.admission?.result;
    const refused = result?.kind === "refused";
    return {
      orderId,
      action: (json.order?.quote?.action ?? "job.open") as ImdAction,
      state: refused ? "refused" : (json.status as OrderState),
      jobId: result?.jobId,
      workflowId: result?.workflowId,
      txHash: json.payment?.transactionHash ?? undefined,
      problems: refused ? (result?.problems ?? []).map((p) => (typeof p === "string" ? p : JSON.stringify(p))) : undefined,
    };
  }

  async job(jobId: string): Promise<JobStatus> {
    const { json } = await this.#call<{ state: string; nodes?: { key: string; state: string; dispatchNote?: string | null }[] }>("GET", `/jobs/${jobId}`);
    const nodes = json.nodes ?? [];
    const busy = nodes.find((n) => n.state !== "accepted");
    return {
      jobId,
      state: JOB_STATES[json.state] ?? "running",
      stepsDone: nodes.filter((n) => n.state === "accepted").length,
      stepsTotal: nodes.length,
      activity: busy ? `${busy.key.replace(/_/g, " ")}: ${busy.dispatchNote ?? busy.state}` : null,
    };
  }

  async result(jobId: string): Promise<JobResult> {
    const [{ json: full }, { json: res }] = await Promise.all([
      this.#call<{ site?: { url?: string } | string | null; delivery?: { repoUrl?: string } | null; objective?: string }>("GET", `/jobs/${jobId}`),
      this.#call<{ files?: { name: string; url: string }[] }>("GET", `/jobs/${jobId}/result`),
    ]);
    const site = typeof full.site === "string" ? full.site : (full.site?.url ?? null);
    return {
      jobId,
      siteUrl: site,
      repoUrl: full.delivery?.repoUrl ?? null,
      files: Object.fromEntries((res.files ?? []).map((f) => [f.name, f.url])),
      summary: null,
    };
  }
}

interface Challenge {
  accepts: { network: string; [k: string]: unknown }[];
  resource: unknown;
  resourceUrl: string;
  requesterScopeHash: string;
  quote: { id: string; action: string; quoteHash: string; expiresAt: number; payment: { network: string; asset: string; amount: string; payTo: string } };
}

interface OrderJson {
  status: string;
  order?: { quote?: { action?: string } };
  payment?: { transactionHash?: string | null };
  admission?: { result?: { kind?: string; jobId?: string; workflowId?: string; problems?: unknown[] } };
}
