/**
 * The house services' memory: answers kept for a while (the chain and IMD change slowly next to
 * an agent's loop), one computation per key at a time (ten agents asking about the same token
 * share one read), and a cap on how much is kept.
 */
export class TtlCache<V> {
  readonly #rows = new Map<string, { at: number; v: V }>();
  readonly #inflight = new Map<string, Promise<V>>();
  constructor(private readonly ttlMs: number, private readonly max = 2_000, private readonly now: () => number = Date.now) {}

  peek(k: string): { at: number; v: V } | undefined {
    const r = this.#rows.get(k);
    if (r && this.now() - r.at < this.ttlMs) return r;
    if (r) this.#rows.delete(k);
    return undefined;
  }

  set(k: string, v: V): void {
    if (this.#rows.size >= this.max) this.#rows.delete(this.#rows.keys().next().value!);
    this.#rows.set(k, { at: this.now(), v });
  }

  /** The kept answer, or a new one from `make` (shared by everyone asking at the same time). `hit` says which. */
  async get(k: string, make: () => Promise<V>): Promise<{ v: V; at: number; hit: boolean }> {
    const r = this.peek(k);
    if (r) return { ...r, hit: true };
    let p = this.#inflight.get(k);
    if (!p) {
      p = make().then((v) => { this.set(k, v); return v; }).finally(() => this.#inflight.delete(k));
      this.#inflight.set(k, p);
    }
    const v = await p;
    return { v, at: this.#rows.get(k)?.at ?? this.now(), hit: false };
  }
}

/** At most `n` heavy computations at once (each one is dozens of RPC reads); the rest are told to retry. */
export class Gate {
  #running = 0;
  constructor(private readonly n: number) {}
  get busy(): boolean { return this.#running >= this.n; }
  async run<T>(fn: () => Promise<T>): Promise<T> {
    if (this.busy) throw Object.assign(new Error("The service is busy with other checks. Retry in a few seconds; nothing was charged."), { status: 503 });
    this.#running++;
    try { return await fn(); } finally { this.#running--; }
  }
}

/** The free demo: `n` uses per key per UTC day. */
export class DailyQuota {
  readonly #used = new Map<string, number>();
  #day = "";
  constructor(private readonly n: number, private readonly now: () => number = Date.now) {}
  #roll(): void {
    const d = new Date(this.now()).toISOString().slice(0, 10);
    if (d !== this.#day) { this.#day = d; this.#used.clear(); }
  }
  left(k: string): number { this.#roll(); return Math.max(0, this.n - (this.#used.get(k) ?? 0)); }
  take(k: string): boolean { this.#roll(); const u = this.#used.get(k) ?? 0; if (u >= this.n) return false; this.#used.set(k, u + 1); return true; }
  /** The next UTC midnight, when everyone's demo comes back. */
  resetsAt(): number { const d = new Date(this.now()); return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + 1); }
}
