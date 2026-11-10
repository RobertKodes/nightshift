import { randomBytes } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import { type Company, type Product, type Recipe, cleanInput, inputSchema, recipeOf } from "@nightshift/core";
import { writeAtomic } from "./atomic.js";
import type { DailyCap } from "./freeshift.js";
import { type Writer, orderPreview, writeOrder } from "./studio/custom.js";

/**
 * Made-for-you orders: a buyer fills a product's short form, the free model writes their file, it is
 * checked, and only then can it be paid for. The buyer sees the file's sections and first lines before
 * paying; a file that could not be written or did not pass is never sold, so there is nothing to
 * refund. The buyer's answers are used to write the file and are not stored: only the finished file
 * is, for a limited time. The order id is long and random: whoever holds it may see the preview, and
 * the file itself only through a download link signed after payment.
 */
export interface MadeOrder {
  id: string;
  companyId: string;
  productId: string;
  recipe: string;
  status: "writing" | "ready" | "failed" | "paid";
  createdAt: number;
  readyAt?: number;
  /** Why it could not be made, in words for the buyer. */
  problems?: string[];
  text?: string;
  /** The model that wrote it (kept for the owner's log, not shown to buyers). */
  model?: string;
  paid?: { at: number; tx: string | null; payer: string; sim: boolean };
  /** The payment a one-call order came with (payer:nonce), so the same header again finds the same file. */
  payKey?: string;
}

export interface MadeOrdersDeps {
  dir: string;
  /** The free model, or null when none is set or it is switched off. */
  writer: () => Writer | null;
  sim: boolean;
  /** Files the whole engine writes in a day. */
  cap: DailyCap;
  /** Days a paid file is kept. Unpaid ones go after a day. */
  keepDays: number;
  now?: () => number;
  /** At most this many files are being written at once. */
  parallel?: number;
  write?: typeof writeOrder;
}

export class OrderError extends Error {
  constructor(message: string, readonly status: number, readonly errors?: string[]) { super(message); }
}

const DAY = 24 * 3600_000;
const ID = /^[A-Za-z0-9_-]{22}$/;

export class MadeOrders {
  readonly #mem = new Map<string, MadeOrder>();
  readonly #waiting = new Map<string, Promise<MadeOrder>>();
  #running = 0;
  readonly #queue: (() => void)[] = [];
  constructor(private readonly d: MadeOrdersDeps) { mkdirSync(d.dir, { recursive: true }); }

  #now() { return (this.d.now ?? Date.now)(); }
  #file(id: string) { return join(this.d.dir, `${id}.json`); }
  #save(o: MadeOrder): void { this.#mem.set(o.id, o); writeAtomic(this.#file(o.id), JSON.stringify(o), { mode: 0o600 }); }

  get(id: string): MadeOrder | undefined {
    if (!ID.test(id)) return undefined;
    const hit = this.#mem.get(id);
    if (hit) return hit;
    try {
      if (!existsSync(this.#file(id))) return undefined;
      const o = JSON.parse(readFileSync(this.#file(id), "utf8")) as MadeOrder;
      // cut off by a restart while it was being written: the answers are gone with it, so it cannot be finished
      if (o.status === "writing") { o.status = "failed"; o.problems = ["the engine restarted while it was being written; order it again"]; }
      this.#mem.set(id, o);
      return o;
    } catch { return undefined; }
  }

  byPayment(key: string): MadeOrder | undefined { return [...this.#mem.values()].find((o) => o.payKey === key); }

  /** The recipe of a made-for-you product on sale, or an error a buyer can read. */
  recipe(p: Product): Recipe {
    const r = p.format === "custom" ? recipeOf(p.custom?.recipe) : null;
    if (!r) throw new OrderError("This product is not made to order.", 400);
    return r;
  }

  /** The buyer's answers, held to the product's form. Throws what is wrong, field by field. */
  check(p: Product, raw: unknown): { recipe: Recipe; input: Record<string, string> } {
    const recipe = this.recipe(p);
    const c = cleanInput(recipe, raw);
    if (!c.ok) throw new OrderError(`The form is not complete: ${c.errors.join(" ")}`, 400, c.errors);
    return { recipe, input: c.input };
  }

  /** Takes an order and starts writing it. Returns at once; `ready` resolves when it is written or has failed. */
  create(c: Company, p: Product, raw: unknown, payKey?: string): MadeOrder {
    const { recipe, input } = this.check(p, raw);
    if (!this.d.writer() && !this.d.sim) throw new OrderError("Orders are closed for a moment: the model that writes them is not available. Nothing was charged; try again later.", 503);
    if (!this.d.cap.take()) throw new OrderError("Today's made-for-you orders are all taken across NIGHTSHIFT. Nothing was charged; come back after 00:00 UTC.", 503);
    const o: MadeOrder = { id: randomBytes(16).toString("base64url"), companyId: c.id, productId: p.id, recipe: recipe.id, status: "writing", createdAt: this.#now(), ...(payKey ? { payKey } : {}) };
    this.#save(o);
    const run = this.#slot().then(async () => {
      try {
        const w = await (this.d.write ?? writeOrder)(this.d.writer(), recipe, input, c, { sim: this.d.sim, now: this.d.now });
        if (w.ok) Object.assign(o, { status: "ready", text: w.text, model: w.model, readyAt: this.#now() });
        else Object.assign(o, { status: "failed", readyAt: this.#now(), problems: w.busy ? ["the model that writes it is busy right now; nothing was charged, try again in a few minutes"] : [`it did not pass its checks (${w.problems.slice(0, 3).join("; ")}); nothing was charged. Try again, or add more detail to your answers`] });
      } catch (e) {
        Object.assign(o, { status: "failed", readyAt: this.#now(), problems: [`it could not be written (${String((e as Error).message).slice(0, 120)}); nothing was charged`] });
      } finally {
        this.#release();
        this.#waiting.delete(o.id);
        this.#save(o);
      }
      return o;
    });
    this.#waiting.set(o.id, run);
    return o;
  }

  /** The order once it is written or has failed, or as it stands after `ms`. */
  async ready(id: string, ms: number): Promise<MadeOrder | undefined> {
    const run = this.#waiting.get(id);
    if (!run) return this.get(id);
    let timer: ReturnType<typeof setTimeout> | undefined;
    const late = new Promise<undefined>((r) => { timer = setTimeout(() => r(undefined), ms); });
    const o = await Promise.race([run, late]);
    clearTimeout(timer);
    return o ?? this.get(id);
  }

  #slot(): Promise<void> {
    if (this.#running < (this.d.parallel ?? 2)) { this.#running += 1; return Promise.resolve(); }
    return new Promise((r) => this.#queue.push(() => { this.#running += 1; r(); }));
  }
  #release(): void { this.#running -= 1; this.#queue.shift()?.(); }
  /** Orders being written or waiting their turn, for the buyer's "position in line". */
  get writing(): number { return this.#waiting.size; }

  /** Booked as paid: once. */
  markPaid(o: MadeOrder, paid: NonNullable<MadeOrder["paid"]>): void {
    if (o.status === "paid") return;
    o.status = "paid";
    o.paid = paid;
    this.#save(o);
  }

  /** What the order's holder may see: the state, and (once written) its sections and first lines. Never the whole file. */
  view(o: MadeOrder) {
    return {
      id: o.id, status: o.status, createdAt: o.createdAt, readyAt: o.readyAt ?? null,
      ...(o.text && (o.status === "ready" || o.status === "paid") ? { preview: orderPreview(o.text) } : {}),
      ...(o.status === "failed" ? { problems: o.problems ?? ["it could not be written; nothing was charged"] } : {}),
      ...(o.status === "writing" ? { inLine: this.#queue.length } : {}),
      paid: Boolean(o.paid),
    };
  }

  /** Unpaid files go after a day, paid ones after the days promised on the product's page. */
  sweep(): number {
    let gone = 0;
    const now = this.#now();
    for (const f of readdirSync(this.d.dir)) {
      if (!f.endsWith(".json")) continue;
      const id = f.slice(0, -5), path = join(this.d.dir, f);
      try {
        const o = this.get(id);
        const age = now - (o?.paid?.at ?? o?.createdAt ?? statSync(path).mtimeMs);
        if (o?.status === "writing" && this.#waiting.has(id)) continue;
        if (age > (o?.paid ? this.d.keepDays * DAY : DAY)) { unlinkSync(path); this.#mem.delete(id); gone += 1; }
      } catch { /* looked at again on the next sweep */ }
    }
    // the map holds what was looked at lately, not every order ever made
    if (this.#mem.size > 2000) for (const [k, o] of this.#mem) { if (this.#mem.size <= 1500) break; if (o.status !== "writing") this.#mem.delete(k); }
    return gone;
  }
}

/** A made-for-you product as buyers and agents see it: what they get, what they fill in (also as JSON Schema), and its limits. */
export function customView(p: Product) {
  const r = p.format === "custom" ? recipeOf(p.custom?.recipe) : null;
  if (!r) return null;
  return { recipe: r.id, label: r.label, delivers: r.delivers, limits: r.limits, fields: r.fields, inputSchema: inputSchema(r), delivered: p.custom?.delivered ?? 0 };
}
