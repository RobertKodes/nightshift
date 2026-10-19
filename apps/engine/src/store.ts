import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { Company } from "@nightshift/core";
import { type LedgerStore, type LedgerTx, MemoryLedgerStore } from "@nightshift/ledger";
import type { ApiKey } from "./auth.js";
import { writeAtomic } from "./atomic.js";
import type { Settlement } from "./checkout.js";
import type { Leg } from "./payout.js";

export interface Metrics {
  visits: number[];
  sales: { at: number; productId: string; usdc: string; payer: string; tx: string | null; sim: boolean }[];
}

interface Snapshot {
  companies: Company[];
  metrics: Record<string, Metrics>;
  ledger: LedgerTx[];
  requestTokens: Record<string, string>;
  apiKeys?: ApiKey[];
  payouts?: Leg[];
  settlements?: Settlement[];
}

// bigint and Date survive the round trip as tagged strings.
const replacer = (_k: string, v: unknown) => (typeof v === "bigint" ? `${v}n` : v);
const reviver = (k: string, v: unknown) => {
  if (typeof v === "string" && /^-?\d+n$/.test(v)) return BigInt(v.slice(0, -1));
  if (k === "at" && typeof v === "string" && /^\d{4}-\d\d-\d\dT/.test(v)) return new Date(v);
  return v;
};

/** One JSON file, written atomically. Small, inspectable, enough for a single engine. */
export class Store {
  readonly #file: string;
  companies = new Map<string, Company>();
  metrics = new Map<string, Metrics>();
  requestTokens = new Map<string, string>();
  apiKeys: ApiKey[] = [];
  /** Withdrawal legs and x402 settlements that were signed and not booked yet, so a restart finishes them. */
  payouts = new Map<string, Leg>();
  settlements = new Map<string, Settlement>();
  readonly ledgerStore: LedgerStore = new MemoryLedgerStore();
  #dirty = false;
  #writing: Promise<void> = Promise.resolve();

  constructor(dataDir: string) {
    mkdirSync(dataDir, { recursive: true });
    this.#file = join(dataDir, "state.json");
  }

  async load(): Promise<void> {
    if (!existsSync(this.#file)) return;
    const s = JSON.parse(readFileSync(this.#file, "utf8"), reviver) as Snapshot;
    for (const c of s.companies) this.companies.set(c.id, c);
    for (const [k, m] of Object.entries(s.metrics ?? {})) this.metrics.set(k, m);
    for (const [k, t] of Object.entries(s.requestTokens ?? {})) this.requestTokens.set(k, t);
    this.apiKeys.push(...(s.apiKeys ?? []));
    for (const l of s.payouts ?? []) this.payouts.set(l.hash, l);
    for (const x of s.settlements ?? []) this.settlements.set(x.key, x);
    for (const tx of s.ledger ?? []) await this.ledgerStore.insert({ ...tx, at: new Date(tx.at) });
  }

  metricsOf(id: string): Metrics {
    let m = this.metrics.get(id);
    if (!m) { m = { visits: [], sales: [] }; this.metrics.set(id, m); }
    return m;
  }

  markDirty(): void { this.#dirty = true; }

  /** Writes now if anything changed. Writes run one after another, so an awaited flush is on disk when it returns. */
  flush(): Promise<void> {
    const run = this.#writing.then(() => this.#write());
    this.#writing = run.catch((e) => console.error("state", e));
    return run;
  }

  /** Marks the state changed and writes it now: after every booking that mirrors money on chain. */
  save(): Promise<void> { this.#dirty = true; return this.flush(); }

  async #write(): Promise<void> {
    if (!this.#dirty) return;
    this.#dirty = false;
    try {
      const snap: Snapshot = {
        companies: [...this.companies.values()],
        metrics: Object.fromEntries(this.metrics),
        ledger: await this.ledgerStore.list(""),
        requestTokens: Object.fromEntries(this.requestTokens),
        apiKeys: this.apiKeys,
        payouts: [...this.payouts.values()],
        settlements: [...this.settlements.values()],
      };
      writeAtomic(this.#file, JSON.stringify(snap, replacer));
    } catch (e) {
      this.#dirty = true;
      throw e;
    }
  }
}
