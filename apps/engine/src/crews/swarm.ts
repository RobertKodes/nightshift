import { createHash, randomBytes, randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { dirname } from "node:path";
import type { ImdPlane, JobResult, JobStatus, Order } from "@nightshift/imd";
import { writeAtomic } from "../atomic.js";
import { offer, type Offer } from "../services/catalog.js";
import type { CrewDeps, Out } from "../services/routes.js";

export const SWARM_IMD = 500_000_000_000_000_000n;
const QUOTE_MS = 10 * 60_000;
const PRICE_MS = 30 * 60_000;
const REFUND = "NIGHTSHIFT owes you a refund; it is recorded";
export type SwarmKind = "website" | "research" | "audit" | "contract";
type Quote = { quoteId: string; kind: SwarmKind; priceUsd: number; imdUsd: number; expiresAt: string; body: Record<string, unknown> };
type Payment = { payer: string; nonce: string; usd: number; network: string; validBefore: number };
type DeskOrder = {
  orderId: string; quote: Quote; key: string; payment: Payment; at: number; day: string;
  status: "settling" | "ordering" | "running" | "done" | "failed" | "unpaid";
  tx?: `0x${string}`; imdOrderId?: string; imdActive?: boolean; imdPaid?: boolean; imd?: Order; job?: JobStatus; result?: JobResult;
  tokenHash: string; token?: string; refundOwed?: boolean; error?: string; alerted?: boolean; recorded?: boolean;
};
export type SwarmDeps = {
  file: string | null; plane: ImdPlane;
  enabled(): boolean;
  dailyImd(): number;
  price(): { usd: number; at: number; pinned?: boolean };
  funds(): Promise<{ imd: bigint; eth: bigint; gasRequired: bigint }>;
  /** Only a booked USDC settlement counts as paid after a restart. */
  settled(payer: string, nonce: string): `0x${string}` | null;
  pending(payer: string, nonce: string): boolean;
  record: NonNullable<CrewDeps["record"]>;
  alert(text: string, topic: string): Promise<unknown>;
  now?: () => number;
};

export class SwarmError extends Error {
  constructor(readonly status: number, message: string, readonly blockers?: { code?: string; message: string }[]) { super(message); }
}

/** The house pays for one checked IMD job after the customer's USDC settles. */
export class SwarmDesk {
  readonly #quotes = new Map<string, Quote>();
  readonly #orders = new Map<string, DeskOrder>();
  readonly #now: () => number;
  #turn: Promise<unknown> = Promise.resolve();
  #timer?: ReturnType<typeof setInterval>;

  constructor(private readonly d: SwarmDeps) {
    this.#now = d.now ?? Date.now;
    if (d.file && existsSync(d.file)) {
      const data = JSON.parse(readFileSync(d.file, "utf8")) as { v: number; orders: DeskOrder[] };
      if (data.v !== 1 || !Array.isArray(data.orders) || data.orders.some((o) => !o.orderId || !o.key || !o.quote?.body || !o.payment || !o.tokenHash)) throw new Error("Swarm Desk orders are unreadable; refusing to forget payments.");
      for (const o of data.orders) this.#orders.set(o.orderId, o);
    } else if (d.file && existsSync(`${d.file}.bak`)) throw new Error("Swarm Desk orders are missing; restore the backup before taking payments.");
  }

  #save(): void {
    if (!this.d.file) return;
    mkdirSync(dirname(this.d.file), { recursive: true });
    writeAtomic(this.d.file, JSON.stringify({ v: 1, orders: [...this.#orders.values()] }), { mode: 0o600, backup: true });
  }

  /** Payment reservations, job opens and followers take turns on the house wallet. */
  #serial<T>(run: () => Promise<T>): Promise<T> {
    const p = this.#turn.then(run);
    this.#turn = p.catch(() => {});
    return p;
  }

  #on(): void { if (!this.d.enabled()) throw new SwarmError(503, "Swarm Desk is off. The owner must enable SWARM_DESK=1 in live mode on Base."); }
  #day(): string { return new Date(this.#now()).toISOString().slice(0, 10); }
  #price(): number {
    const p = this.d.price(), age = this.#now() - p.at;
    if (!Number.isFinite(p.usd) || p.usd <= 0 || (!p.pinned && (!p.at || age < 0 || age >= PRICE_MS))) throw new SwarmError(503, "The IMD price is stale or unknown. No quote or payment is available.");
    return p.usd;
  }

  async quote(kind: string | null, brief: string | null, repo: string | null, base: string) {
    this.#on();
    if (!["website", "research", "audit", "contract"].includes(kind ?? "")) throw new SwarmError(400, "kind: website, research, audit or contract.");
    const text = (brief ?? "").trim();
    if (text.length < 20 || text.length > 1500) throw new SwarmError(400, "The brief must be 20 to 1500 characters.");
    let repoUrl: string | undefined;
    if (kind === "audit") {
      let url: URL;
      try { url = new URL(repo ?? ""); } catch { throw new SwarmError(400, "An audit needs a public https://github.com/owner/repo URL."); }
      if (url.protocol !== "https:" || url.hostname !== "github.com" || url.port || url.username || url.password || !/^\/[\w.-]+\/[\w.-]+\/?$/.test(url.pathname) || url.search || url.hash) throw new SwarmError(400, "An audit needs a public https://github.com/owner/repo URL.");
      repoUrl = url.toString();
    }
    this.#price();
    for (const [id, q] of this.#quotes) if (Date.parse(q.expiresAt) <= this.#now()) this.#quotes.delete(id);
    if (this.#quotes.size >= 1000) throw new SwarmError(503, "The quote desk is full. Try again in 10 minutes.");
    const quoteId = randomUUID();
    const body: Record<string, unknown> = kind === "website"
      ? { objective: `Build a static website. ${text} Static, runs in the browser, no wallet, no backend. Clean, fast, works on a phone.`, skill: "build-website", ipfs: `ns-swarm-${quoteId.slice(0, 18)}`, github: false }
      : kind === "research"
        ? { objective: text, skill: "research-report", outputs: [{ name: "report", path: "artifacts/report.md", mediaType: "text/markdown" }], minCitations: 5, github: false }
        : kind === "audit"
          ? { objective: `Audit the Solidity contracts in this public repository. ${text} Rank findings by severity with source references and concrete fixes.`, template: "audit", repoUrl }
          : { objective: `Build a small Solidity contract with Foundry tests and a README. ${text} Deliver source and passing tests; do not deploy or send transactions.`, shape: "chain", steps: [{ skill: "build-contract-project" }, { skill: "adversarial-review" }], github: true };
    const checked = await this.d.plane.check("job.open", body);
    if (checked.blockers.length) throw new SwarmError(422, "IMD would refuse this job.", checked.blockers);
    const imdUsd = this.#price();
    const q: Quote = { quoteId, kind: kind as SwarmKind, priceUsd: swarmPrice(imdUsd), imdUsd, expiresAt: new Date(this.#now() + QUOTE_MS).toISOString(), body };
    this.#quotes.set(quoteId, q);
    return { quoteId, kind: q.kind, priceUsd: q.priceUsd, imd: 0.5, whatYouGet: WHAT[q.kind], eta: "Usually 10–60 minutes; swarm availability varies, no guaranteed deadline.", expiresAt: q.expiresAt, pay: `${base}/api/v1/swarm/order/${quoteId}` };
  }

  #quote(id: string): Quote {
    const prior = [...this.#orders.values()].find((o) => o.quote.quoteId === id);
    const q = prior?.quote ?? this.#quotes.get(id);
    if (!q) throw new SwarmError(404, "Quote not found. Request a new free quote.");
    if (!prior) this.#on();
    if (!prior && Date.parse(q.expiresAt) <= this.#now()) throw new SwarmError(410, "The quote expired. Request a new free quote.");
    return q;
  }

  quotedOffer(id: string): Offer { return { ...offer("swarm-order"), priceUsdc: BigInt(Math.round(this.#quote(id).priceUsd * 1e6)) }; }

  async #ready(except?: DeskOrder): Promise<void> {
    this.#on();
    const all = [...this.#orders.values()].filter((o) => o !== except && o.status !== "unpaid");
    if (all.filter(inFlight).length >= 3) throw new SwarmError(503, "Swarm Desk already has 3 jobs in flight. Nothing was charged.");
    const cap = this.d.dailyImd();
    const committed = all.filter((o) => o.day === this.#day() || (inFlight(o) && !o.imdPaid)).length * 0.5;
    if (!Number.isFinite(cap) || committed + 0.5 > cap) throw new SwarmError(503, "Swarm Desk's daily IMD cap is reached. Nothing was charged.");
    const [f, c] = await Promise.all([this.d.funds(), this.d.plane.capabilities()]);
    if (c.price !== SWARM_IMD || c.network !== "eip155:1") throw new SwarmError(503, "IMD no longer offers a single job.open for 0.5 IMD on Ethereum. Nothing was charged.");
    const reserved = BigInt(all.filter((o) => inFlight(o) && !o.imdPaid).length);
    if (f.imd < SWARM_IMD * (reserved + 1n)) throw new SwarmError(503, "The house needs at least 0.5 available IMD on Ethereum. Nothing was charged.");
    if (f.gasRequired <= 0n || f.eth < f.gasRequired * (reserved + 1n)) throw new SwarmError(503, "The house needs ETH on Ethereum for IMD payment gas. Nothing was charged.");
    this.#on();
  }

  /** One authorization buys at most one job, including concurrent retries and restarts. */
  order(id: string, payment: Payment, settle: () => Promise<`0x${string}`>, isPending: (e: unknown) => boolean): Promise<Out> {
    return this.#serial(async () => {
      const q = this.#quote(id), key = `${payment.payer.toLowerCase()}:${payment.nonce.toLowerCase()}`;
      let o = [...this.#orders.values()].find((x) => x.key === key);
      if (o && o.quote.quoteId !== id) throw new SwarmError(409, "This payment belongs to another Swarm Desk quote.");
      if (o?.status === "unpaid") throw new SwarmError(410, "The unpaid authorization expired. Request a new quote.");
      if ([...this.#orders.values()].some((x) => x.quote.quoteId === id && x.key !== key)) throw new SwarmError(409, "This quote already has an order. Do not send a new payment.");
      if (payment.usd !== q.priceUsd) throw new SwarmError(402, "Pay the exact quoted price. Swarm Desk has no holder discount.");
      if (o?.tx) return this.#answer(o);
      await this.#ready(o);
      if (!o) {
        const token = randomBytes(32).toString("base64url");
        o = { orderId: `sd_${randomUUID()}`, quote: q, key, payment, at: this.#now(), day: this.#day(), status: "settling", tokenHash: hash(token), token };
        this.#orders.set(o.orderId, o);
        this.#save();
      }
      try { o.tx = await settle(); } catch (e) {
        // Keep the reservation: a settlement may have been sent even when its answer was lost.
        if (isPending(e)) return { status: 202, body: { orderId: o.orderId, status: "settling", pending: true, message: "Retry the same payment; do not sign a new authorization." } };
        throw new SwarmError(503, "Payment settlement was not confirmed. Retry the same authorization; do not sign a new one.");
      }
      this.#save();
      await this.#open(o);
      return this.#answer(o);
    });
  }

  async #open(o: DeskOrder): Promise<void> {
    if (o.status !== "settling" || !o.tx) return;
    // A crash after this write follows the saved IMD id, or records a refund. It never opens again.
    o.status = "ordering";
    o.day = this.#day();
    this.#save();
    this.#record(o);
    try {
      await this.#ready(o);
      const imd = await this.d.plane.open("job.open", o.quote.body, { onQuote: (id) => { o.imdOrderId = id; o.imdActive = true; this.#save(); } });
      o.imdOrderId = imd.orderId;
      this.#admission(o, imd);
      this.#save();
      if (o.error) await this.#refund(o);
    } catch {
      await this.#refund(o);
    }
  }

  #admission(o: DeskOrder, imd: Order): void {
    o.imd = imd;
    o.imdPaid = Boolean(imd.txHash || imd.jobId || imd.state === "admitted");
    o.imdActive = !["payment_failed", "expired", "refused"].includes(imd.state);
    if (!o.imdActive) o.error = "IMD refused or could not admit the job";
    if (!o.refundOwed) o.status = o.error ? "failed" : "running";
  }

  #record(o: DeskOrder): void {
    if (!o.tx || o.recorded) return;
    this.d.record(this.quotedOffer(o.quote.quoteId), { payer: o.payment.payer, nonce: o.payment.nonce, usd: o.payment.usd, tx: o.tx, network: o.payment.network, kind: `swarm.${o.quote.kind}`, pending: o.status !== "done" && !o.refundOwed, ok: !o.refundOwed, summary: `Swarm Desk: ${o.quote.kind} delivered`, ...(o.refundOwed ? { error: `refund owed: ${REFUND}` } : {}), costUsd: o.imdPaid ? 0.5 * o.quote.imdUsd : 0 });
    if (o.status === "done" || o.refundOwed) { o.recorded = true; this.#save(); }
  }

  async #refund(o: DeskOrder): Promise<void> {
    Object.assign(o, { status: "failed", refundOwed: true, error: `refund owed: ${REFUND}` });
    this.#save();
    this.#record(o);
    if (!o.alerted) {
      try {
        const sent = await this.d.alert(`Swarm Desk refund owed: order ${o.orderId}, payer ${o.payment.payer}, $${o.payment.usd.toFixed(2)} USDC, payment ${o.tx}. ${REFUND}.`, `swarm-refund-${o.orderId}`);
        o.alerted = sent !== false;
        this.#save();
      } catch { /* retry the owner alert on the next follow */ }
    }
  }

  #view(o: DeskOrder) {
    return { orderId: o.orderId, kind: o.quote.kind, status: o.status, imdOrderId: o.imdOrderId ?? null, imd: o.imd ?? null, job: o.job ?? null, result: o.result ?? null, refundOwed: Boolean(o.refundOwed), ...(o.error ? { error: o.error } : {}), payment: { tx: o.tx ?? null, network: o.payment.network, priceUsd: o.payment.usd, holderPrice: false, payer: o.payment.payer } };
  }

  #answer(o: DeskOrder): Out {
    const token = o.token;
    delete o.token;
    this.#save();
    return { status: o.refundOwed ? 502 : 200, body: { ...this.#view(o), ...(token ? { orderToken: token } : {}), ...(o.refundOwed ? { message: REFUND } : {}) } };
  }

  async job(id: string, token: string | null) {
    const o = this.#orders.get(id);
    if (!o || !token || hash(token) !== o.tokenHash) throw new SwarmError(404, "Job not found or invalid order token.");
    await this.follow();
    return this.#view(o);
  }

  /** Resume paid jobs and unfinished settlements without buying a second IMD job. */
  follow(): Promise<void> {
    return this.#serial(async () => {
      for (const o of this.#orders.values()) {
        try {
          if (o.status === "unpaid") continue;
          if (!o.tx) {
            const tx = this.d.settled(o.payment.payer, o.payment.nonce);
            if (!tx) {
              if (!this.d.pending(o.payment.payer, o.payment.nonce) && this.#now() > (o.payment.validBefore + 7200) * 1000) { o.status = "unpaid"; this.#save(); }
              continue;
            }
            o.tx = tx;
            this.#save();
          }
          if (o.status === "settling") await this.#open(o);
          if (o.status === "ordering") {
            if (o.imdOrderId) o.status = "running"; else await this.#refund(o);
          }
          if (o.refundOwed) await this.#refund(o);
          if (o.status === "done") { this.#record(o); continue; }
          if (!o.imdOrderId || !o.imdActive) continue;
          this.#admission(o, await this.d.plane.order(o.imdOrderId));
          if (o.imd?.jobId) {
            o.job = await this.d.plane.job(o.imd.jobId);
            if (o.job.state === "completed") {
              o.result = await this.d.plane.result(o.imd.jobId);
              o.imdActive = false;
              if (!o.refundOwed) o.status = "done";
            } else if (o.job.state === "failed" || o.job.state === "cancelled") { o.imdActive = false; o.error = "IMD job failed"; }
          }
          this.#save();
          if (o.error || o.refundOwed) await this.#refund(o); else this.#record(o);
        } catch { /* A read failed: keep the reservation and follow the same order next time. */ }
      }
    });
  }

  start(): void {
    if (this.#timer) return;
    void this.follow().catch((e) => console.error("Swarm Desk follow", e));
    this.#timer = setInterval(() => void this.follow().catch((e) => console.error("Swarm Desk follow", e)), 30_000);
    this.#timer.unref();
  }

  stop(): void { if (this.#timer) clearInterval(this.#timer); this.#timer = undefined; }
}

export const swarmPrice = (imdUsd: number) => Math.max(3, Math.ceil((0.5 * imdUsd * 1.25 + 0.60) * 100) / 100);
const hash = (s: string) => createHash("sha256").update(s).digest("hex");
const inFlight = (o: DeskOrder) => ["settling", "ordering", "running"].includes(o.status) || Boolean(o.imdActive);
const WHAT: Record<SwarmKind, string> = { website: "A static website with a hosted site link.", research: "A sourced Markdown report with at least 5 citations.", audit: "A Solidity audit of the public GitHub repo, with findings, severity and fixes.", contract: "A small Solidity contract, Foundry tests and README in a source repository." };
