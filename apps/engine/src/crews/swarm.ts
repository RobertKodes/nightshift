import { createHash, randomBytes, randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { dirname } from "node:path";
import type { ImdPlane, JobResult, JobStatus, Order } from "@nightshift/imd";
import { writeAtomic } from "../atomic.js";
import { TtlCache } from "../services/cache.js";
import { SWARM_KINDS, SWARM_SKILLS, SWARM_OUTPUTS, type SwarmKind, type SwarmInput, swarmBody } from "./swarm-kinds.js";
export type { SwarmKind } from "./swarm-kinds.js";
import { offer, type Offer } from "../services/catalog.js";
import type { CrewDeps, Out } from "../services/routes.js";

export const SWARM_IMD = 500_000_000_000_000_000n;
const QUOTE_MS = 10 * 60_000;
const PRICE_MS = 30 * 60_000;
const REFUND = "NIGHTSHIFT owes you a refund; it is recorded";
type Quote = { quoteId: string; kind: SwarmKind; priceUsd: number; imdUsd: number; expiresAt: string; body: Record<string, unknown> };
type Payment = { payer: string; nonce: string; usd: number; network: string; validBefore: number };
type DeskOrder = {
  orderId: string; quote: Quote; key: string; payment: Payment; at: number; day: string;
  status: "settling" | "ordering" | "running" | "done" | "failed" | "unpaid";
  tx?: `0x${string}`; imdOrderId?: string; imdActive?: boolean; imdPaid?: boolean; imd?: Order; job?: JobStatus; result?: JobResult;
  reserveUnits?: string;
  tokenHash: string; token?: string; refundOwed?: boolean; error?: string; alerted?: boolean; recorded?: boolean;
};
/** IMD's GET /swarm puts the live numbers under `health`. */
type SwarmHealth = { agentsOnline?: number; seatsEnrolled?: number; jobsDoneLastDay?: number };
export type SwarmDeps = {
  file: string | null; plane: ImdPlane;
  enabled(): boolean;
  dailyImd(): number;
  inFlight?(): number;
  reservePayer?(payer: string): boolean;
  health?(): Promise<{ health?: SwarmHealth; agentsOnline?: number; seatsEnrolled?: number; jobsDoneLastDay?: number; counts?: { jobs?: number; jobStates?: { completed?: number } } }>;
  skills?(): Promise<unknown>;
  importRepo?(url: string): Promise<{ repoUrl: string; baseCommit: string }>;
  verifiedContract?(chain: "ethereum" | "base", address: string): Promise<boolean>;
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
  constructor(readonly status: number, message: string, readonly blockers?: { code?: string; message: string }[], readonly retryAfter?: number) { super(message); }
}

/** The house pays for one checked IMD job after the customer's USDC settles. */
export class SwarmDesk {
  readonly #quotes = new Map<string, Quote>();
  readonly #orders = new Map<string, DeskOrder>();
  readonly #now: () => number;
  #turn: Promise<unknown> = Promise.resolve();
  #timer?: ReturnType<typeof setInterval>;
  #polled = new Map<string, number>();
  #following?: Promise<void>;
  #health: TtlCache<Awaited<ReturnType<NonNullable<SwarmDeps["health"]>>>>;
  #refill?: { tick(): Promise<void>; heldUsdc(): bigint; status(): unknown };

  constructor(private readonly d: SwarmDeps) {
    this.#now = d.now ?? Date.now;
    this.#health = new TtlCache(60_000, 1, this.#now);
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

  async quote(kind: string | null, brief: string | null, repo: string | null, base: string, extra: SwarmInput = {}) {
    this.#on();
    const quoteId = randomUUID(), parsed = swarmBody(kind, brief, repo, quoteId, extra), body = parsed.body;
    if (["audit", "review"].includes(parsed.kind) && !extra.commit && this.d.importRepo) Object.assign(body, await this.d.importRepo(String(body.repoUrl)));
    if (parsed.kind === "frontend") {
      if (!this.d.verifiedContract) throw new SwarmError(503, "Verified contract lookup is unavailable; nothing was charged.");
      if (!await this.d.verifiedContract(extra.chain as "ethereum" | "base", extra.address!)) throw new SwarmError(400, "Frontend work requires verified contract source on the selected chain.");
    }
    if (this.d.skills && !["website", "research", "audit", "contract"].includes(parsed.kind)) {
      const catalog = JSON.stringify(await this.d.skills());
      if (!catalog.includes(JSON.stringify(SWARM_SKILLS[parsed.kind]))) throw new SwarmError(503, "IMD's skill catalog does not confirm this skill; nothing was charged.");
    }
    this.#price();
    for (const [id, q] of this.#quotes) if (Date.parse(q.expiresAt) <= this.#now()) this.#quotes.delete(id);
    if (this.#quotes.size >= 3000) throw new SwarmError(503, "The quote desk is full. Retry in a minute.", undefined, 60);
    const checked = await this.d.plane.check("job.open", body);
    if (checked.blockers.length) throw new SwarmError(422, "IMD would refuse this job.", checked.blockers);
    const imdUsd = this.#price();
    const q: Quote = { quoteId, kind: parsed.kind, priceUsd: swarmPrice(imdUsd), imdUsd, expiresAt: new Date(this.#now() + QUOTE_MS).toISOString(), body };
    this.#quotes.set(quoteId, q);
    return { quoteId, kind: q.kind, priceUsd: q.priceUsd, imd: 0.5, whatYouGet: SWARM_OUTPUTS[q.kind], eta: "Usually 10–60 minutes; swarm availability varies, no guaranteed deadline.", expiresAt: q.expiresAt, pay: `${base}/api/v1/swarm/order?quoteId=${quoteId}` };
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
    const max = this.d.inFlight?.() ?? 25;
    if (!Number.isInteger(max) || max < 1 || all.filter(inFlight).length >= max) throw new SwarmError(503, `Swarm Desk has ${max} jobs in flight; nothing was charged; capacity refills in a few minutes.`, undefined, 60);
    const cap = this.d.dailyImd();
    const committed = all.filter((o) => o.day === this.#day() || (inFlight(o) && !o.imdPaid)).length * 0.5;
    if (!Number.isFinite(cap) || committed + 0.5 > cap) throw new SwarmError(503, "Swarm Desk daily IMD cap is reached; nothing was charged. The owner can raise it with /swarm cap.", undefined, 3600);
    const [f, c] = await Promise.all([this.d.funds(), this.d.plane.capabilities()]);
    if (c.price !== SWARM_IMD || c.network !== "eip155:1") throw new SwarmError(503, "IMD no longer offers a single job.open for 0.5 IMD on Ethereum. Nothing was charged.");
    const reserved = BigInt(all.filter((o) => inFlight(o) && !o.imdPaid).length);
    if (f.imd < SWARM_IMD * (reserved + 1n)) throw new SwarmError(503, "Not enough available IMD; nothing was charged; capacity refills in a few minutes.", undefined, 60);
    if (f.gasRequired <= 0n || f.eth < f.gasRequired * (reserved + 1n)) throw new SwarmError(503, "Not enough Ethereum gas; nothing was charged; capacity refills in a few minutes.", undefined, 60);
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
        o = { orderId: `sd_${randomUUID()}`, quote: q, key, payment, at: this.#now(), day: this.#day(), status: "settling", reserveUnits: String(this.d.reservePayer?.(payment.payer) === false ? 0 : Math.ceil(q.priceUsd * 1e6 / 2)), tokenHash: hash(token), token };
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
    this.#save();
    return { status: o.refundOwed ? 502 : 200, body: { ...this.#view(o), ...(token ? { orderToken: token } : {}), ...(o.refundOwed ? { message: REFUND } : {}) } };
  }

  async job(id: string, token: string | null) {
    const o = this.#orders.get(id);
    if (!o || !token || hash(token) !== o.tokenHash) throw new SwarmError(404, "Job not found or invalid order token.");
    if (!this.#following && !["done", "unpaid"].includes(o.status)) await this.#serial(() => this.#followOne(o));
    return this.#view(o);
  }

  /** Refresh only the requested order; repeated polls share a short cache. */
  async #followOne(o: DeskOrder): Promise<void> {
    const last = this.#polled.get(o.orderId);
    if (last !== undefined && this.#now() - last < 15_000) return;
    this.#polled.set(o.orderId, this.#now());
    try {
      if (o.status === "unpaid") return;
      if (!o.tx) {
        const tx = this.d.settled(o.payment.payer, o.payment.nonce);
        if (!tx) {
          if (!this.d.pending(o.payment.payer, o.payment.nonce) && this.#now() > (o.payment.validBefore + 7200) * 1000) { o.status = "unpaid"; this.#save(); }
          return;
        }
        o.tx = tx;
        this.#save();
      }
      if (o.status === "settling") await this.#open(o);
      if (o.status === "ordering") {
        if (o.imdOrderId) o.status = "running"; else await this.#refund(o);
      }
      if (o.refundOwed) await this.#refund(o);
      if (o.status === "done") { this.#record(o); return; }
      if (!o.imdOrderId || !o.imdActive) return;
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

  /** Resume paid jobs without buying a second IMD job. */
  follow(): Promise<void> {
    if (this.#following) return this.#following;
    this.#following = this.#serial(async () => {
      for (const o of this.#orders.values()) {
        if (o.status === "done") { this.#record(o); continue; }
        if (o.status === "unpaid" || (o.refundOwed && o.alerted && !o.imdActive)) continue;
        await this.#followOne(o);
      }
    }).finally(() => { this.#following = undefined; });
    return this.#following;
  }

  start(): void {
    if (this.#timer) return;
    void this.#refill?.tick().catch(() => {});
    void this.follow().catch((e) => console.error("Swarm Desk follow", e));
    this.#timer = setInterval(() => { void this.follow().catch((e) => console.error("Swarm Desk follow", e)); void this.#refill?.tick().catch(() => {}); }, 30_000);
    this.#timer.unref();
  }

  attachRefill(refill: { tick(): Promise<void>; heldUsdc(): bigint; status(): unknown }): void { this.#refill = refill; }

  reservations(): bigint { return BigInt([...this.#orders.values()].filter((o) => inFlight(o) && !o.imdPaid).length) * SWARM_IMD; }
  revenue() { return [...this.#orders.values()].filter((o) => o.tx).map((o) => ({ orderId: o.orderId, at: o.at, units: Math.round(o.payment.usd * 1e6).toString(), reserveUnits: o.reserveUnits ?? Math.ceil(o.payment.usd * 1e6 / 2).toString(), refundOwed: Boolean(o.refundOwed) })); }
  heldUsdc(): bigint { return this.#refill?.heldUsdc() ?? 0n; }

  async stats() {
    let health: Awaited<ReturnType<NonNullable<SwarmDeps["health"]>>> | null = null;
    if (this.d.health) {
      let timer: ReturnType<typeof setTimeout> | undefined;
      try { health = (await Promise.race([this.#health.get("swarm", this.d.health), new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error("IMD counters unavailable")), 3_000); timer.unref(); })])).v; }
      catch { /* Keep unknown counters null; a queued read may populate the next answer. */ }
      finally { clearTimeout(timer); }
    }
    const total = health?.counts?.jobs, completed = health?.counts?.jobStates?.completed;
    let priceUsd: number | null = null; try { priceUsd = swarmPrice(this.#price()); } catch { /* Quotes require a fresh price. */ }
    const rows = [...this.#orders.values()];
    return { swarm: { available: health !== null, source: "https://api.imd.fun/swarm", agentsOnline: (health?.health ?? health)?.agentsOnline ?? null, seatsEnrolled: (health?.health ?? health)?.seatsEnrolled ?? null, jobsDoneLastDay: (health?.health ?? health)?.jobsDoneLastDay ?? null, totalJobs: total ?? null, completedJobs: completed ?? null, completionRate: typeof total === "number" && total > 0 && typeof completed === "number" ? completed / total : null },
      desk: { enabled: this.d.enabled(), orders: rows.filter((o) => o.tx).length, delivered: rows.filter((o) => o.status === "done").length, running: rows.filter(inFlight).length, refundsOwed: rows.filter((o) => o.refundOwed).length, todayJobs: rows.filter((o) => o.day === this.#day() && o.tx).length, dailyImd: this.d.dailyImd(), maxInFlight: this.d.inFlight?.() ?? 25, reservedImd: (Number(this.reservations()) / 1e18), kinds: SWARM_KINDS.map((kind) => ({ kind, skill: SWARM_SKILLS[kind], priceUsd, whatYouGet: SWARM_OUTPUTS[kind] })), refill: this.#refill?.status() ?? null },
      coverage: health ? [] : ["IMD live counters unavailable"], at: new Date(this.#now()).toISOString() };
  }

  stop(): void { if (this.#timer) clearInterval(this.#timer); this.#timer = undefined; }
}

export const swarmPrice = (imdUsd: number) => Math.max(3, Math.ceil((0.5 * imdUsd * 1.25 + 0.60) * 100) / 100);
const hash = (s: string) => createHash("sha256").update(s).digest("hex");
const inFlight = (o: DeskOrder) => ["settling", "ordering", "running"].includes(o.status) || Boolean(o.imdActive);
let current: SwarmDesk | null = null;
export const liveSwarmDesk = () => current;
export const setSwarmDesk = (desk: SwarmDesk | null) => { current?.stop(); current = desk; };
