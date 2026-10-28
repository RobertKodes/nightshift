import { mkdir, readFile, rename, stat, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import type { Net } from "./net.js";

export const BAZAAR_URL = "https://api.cdp.coinbase.com/platform/v2/x402/discovery/resources";
export const BAZAAR_TTL = 12 * 60 * 60_000;
/**
 * The Bazaar passed 100,000 listings: a full copy (100 MB on disk, several times that in memory) plus a crawl in
 * progress ran the engine out of heap at every start. The index keeps at most this many listings, the first ones
 * the Bazaar returns, and a file too large to load safely is skipped (a fresh pass replaces it).
 */
export const BAZAAR_MAX_ROWS = 30_000;
const MAX_FILE_BYTES = 48 * 1024 * 1024;
const sizeOk = (file: string) => stat(file).then((s) => s.size <= MAX_FILE_BYTES, () => false);
export type Terms = { scheme: string; network: string; asset: string; payTo: string; amount: string; maxTimeoutSeconds: number };
export type Listing = {
  resource: string; host: string; description: string; accepts: Terms[];
  lastUpdated: string | null; lastPaid: string | null; lastCalledAt: string | null; createdAt: string | null;
  firstObserved: string; previousAccepts?: Terms[];
};
export type BazaarSnapshot = { version: 1; updatedAt: number; byResource: Record<string, Listing>; byHost: Record<string, string[]>; byPayTo: Record<string, string[]> };
type Crawl = { startedAt: number; offset: number; rows: Record<string, Listing> };
type Page = { items: Record<string, unknown>[]; pagination?: { total?: number; offset?: number; limit?: number } };
const empty = (): BazaarSnapshot => ({ version: 1, updatedAt: 0, byResource: Object.create(null), byHost: Object.create(null), byPayTo: Object.create(null) });
const date = (v: unknown) => typeof v === "string" && Number.isFinite(Date.parse(v)) ? new Date(v).toISOString() : null;
const signature = (rows: Terms[]) => JSON.stringify(rows.map((r) => [r.scheme, r.network, r.asset?.toLowerCase(), r.payTo?.toLowerCase(), r.amount]).sort());

/** Keep payment facts and lookup keys, not the discovery schemas. */
export function compactListing(raw: Record<string, unknown>, old: Listing | undefined, now: number): Listing | null {
  if (typeof raw.resource !== "string" || raw.resource.length > 2_000 || !Array.isArray(raw.accepts)) return null;
  let url: URL;
  try { url = new URL(raw.resource); } catch { return null; }
  if (url.protocol !== "https:") return null;
  const accepts: Terms[] = raw.accepts.slice(0, 6).filter((v): v is Terms => !!v && typeof v === "object" && ["scheme", "network", "asset", "payTo", "amount"].every((k) => typeof v[k] === "string")).map((v) => ({ scheme: v.scheme, network: v.network, asset: v.asset, payTo: v.payTo, amount: v.amount, maxTimeoutSeconds: v.maxTimeoutSeconds }));
  const quality = raw.quality as { lastCalledAt?: string } | undefined;
  return {
    resource: url.href, host: url.host, description: String(raw.description ?? "").slice(0, 240), accepts,
    lastUpdated: date(raw.lastUpdated), lastPaid: date(raw.lastPaid ?? raw.lastPaidAt), lastCalledAt: date(quality?.lastCalledAt), createdAt: date(raw.createdAt),
    firstObserved: old?.firstObserved ?? new Date(now).toISOString(),
    ...(old && signature(old.accepts) !== signature(accepts) ? { previousAccepts: old.accepts } : old?.previousAccepts ? { previousAccepts: old.previousAccepts } : {}),
  };
}

export function buildIndex(rows: Record<string, Listing>, now: number): BazaarSnapshot {
  const index = empty(); index.updatedAt = now; index.byResource = rows;
  for (const row of Object.values(rows)) {
    (index.byHost[row.host] ??= []).push(row.resource);
    for (const payTo of new Set(row.accepts.map((t) => t.payTo.toLowerCase()))) (index.byPayTo[payTo] ??= []).push(row.resource);
  }
  return index;
}

/** A paced, restartable crawl. Requests use the previous complete snapshot. */
export class BazaarIndex {
  #index = empty();
  #running: Promise<void> | null = null;
  #timer?: ReturnType<typeof setTimeout>;
  #stopped = false;
  readonly #ready: Promise<void>;
  constructor(private readonly net: Net, private readonly file = join(process.env.DATA_DIR ?? "data", "bazaar-index.json"), private readonly now = Date.now, private readonly pause = (ms: number) => new Promise<void>((resolve) => { const t = setTimeout(resolve, ms); t.unref(); })) {
    this.#ready = sizeOk(file).then((ok) => ok ? readFile(file, "utf8") : Promise.reject(new Error("too large"))).then((s) => {
      const v = JSON.parse(s) as BazaarSnapshot;
      if (v.version === 1 && v.byResource && typeof v.updatedAt === "number") this.#index = buildIndex(v.byResource, v.updatedAt);
    }).catch(() => {});
  }
  start(): void { this.#stopped = false; void this.#ready.then(() => this.#schedule(0)); }
  stop(): void { this.#stopped = true; if (this.#timer) clearTimeout(this.#timer); }
  #schedule(ms: number): void {
    if (this.#stopped) return;
    if (this.#timer) clearTimeout(this.#timer);
    this.#timer = setTimeout(() => { void this.refresh().catch(() => {}).finally(() => this.#schedule(this.now() - this.#index.updatedAt < BAZAAR_TTL ? BAZAAR_TTL - (this.now() - this.#index.updatedAt) : 60_000)); }, ms);
    this.#timer.unref();
  }
  async snapshot(): Promise<BazaarSnapshot> { await this.#ready; return this.#index; }
  async #save(file: string, value: unknown): Promise<void> {
    await mkdir(dirname(file), { recursive: true });
    await writeFile(`${file}.tmp`, JSON.stringify(value));
    await rename(`${file}.tmp`, file);
  }
  async refresh(): Promise<void> {
    if (this.#running) return this.#running;
    this.#running = this.#crawl().finally(() => { this.#running = null; });
    return this.#running;
  }
  async #crawl(): Promise<void> {
    await this.#ready;
    if (this.#index.updatedAt && this.now() - this.#index.updatedAt < BAZAAR_TTL) return;
    let crawl: Crawl = { startedAt: this.now(), offset: 0, rows: {} };
    try { if (!await sizeOk(`${this.file}.crawl.json`)) throw new Error("too large"); const saved = JSON.parse(await readFile(`${this.file}.crawl.json`, "utf8")) as Crawl; if (saved.startedAt > this.#index.updatedAt && this.now() - saved.startedAt < BAZAAR_TTL && saved.offset >= 0 && saved.rows) crawl = saved; } catch { /* Start a new pass. */ }
    let count = Object.keys(crawl.rows).length;
    for (let pages = 0; pages < 200; pages++) {
      const page = await this.net.json<Page>(`${BAZAAR_URL}?limit=1000&offset=${crawl.offset}`, 3_000);
      if (!Array.isArray(page.items) || page.items.length > 1000) throw new Error("Invalid Bazaar page.");
      for (const raw of page.items) {
        const old = typeof raw.resource === "string" ? this.#index.byResource[raw.resource] ?? crawl.rows[raw.resource] : undefined;
        const row = compactListing(raw, old, this.now());
        if (row && count < BAZAAR_MAX_ROWS) { if (!crawl.rows[row.resource]) count++; crawl.rows[row.resource] = row; }
      }
      const step = page.pagination?.limit ?? 1000;
      if (!Number.isInteger(step) || step < 20 || step > 1000 || (page.pagination?.offset != null && page.pagination.offset !== crawl.offset)) throw new Error("Invalid Bazaar pagination.");
      crawl.offset += step;
      if (count >= BAZAAR_MAX_ROWS || !page.items.length || (page.pagination?.total != null ? crawl.offset >= page.pagination.total : page.items.length < step)) {
        const next = buildIndex(crawl.rows, this.now());
        await this.#save(this.file, next); this.#index = next;
        return;
      }
      // a checkpoint every ten pages: each one writes the whole pass so far
      if (pages % 10 === 0) await this.#save(`${this.file}.crawl.json`, crawl);
      await this.pause(600);
    }
    throw new Error("Bazaar crawl page bound reached; checkpoint retained.");
  }
}
