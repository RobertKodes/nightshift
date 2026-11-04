/**
 * The live feed's memory: every engine event gets an id, and each company keeps its last 500, so a
 * phone that loses its connection (a tunnel, a lift, the app in the background) asks for what it
 * missed with Last-Event-ID and gets only that. Ids carry the engine's start time: after a restart an
 * old id cannot match, and the reader is told to load the company again instead of guessing.
 */

export interface Logged<E> { id: string; e: E }

export class EventLog<E extends { companyId: string }> {
  readonly #boot: string;
  #seq = 0;
  readonly #byCompany = new Map<string, Logged<E>[]>();

  constructor(readonly perCompany = 500, boot = Date.now()) { this.#boot = boot.toString(36); }

  /** Records an event and returns its id. */
  push(e: E): string {
    const id = `${this.#boot}-${++this.#seq}`;
    let list = this.#byCompany.get(e.companyId);
    if (!list) this.#byCompany.set(e.companyId, (list = []));
    list.push({ id, e });
    if (list.length > this.perCompany) list.splice(0, list.length - this.perCompany);
    return id;
  }

  /**
   * What a reader missed since `lastId` for one company. `reset`: the id is from before a restart, or
   * older than what is kept, so some events are gone and the reader should load the company afresh.
   */
  since(companyId: string, lastId: string): { events: Logged<E>[]; reset: boolean } {
    const list = this.#byCompany.get(companyId) ?? [];
    const [boot, n] = lastId.split("-");
    const seq = Number(n);
    if (boot !== this.#boot || !Number.isInteger(seq) || seq < 0 || seq > this.#seq) return { events: [], reset: true };
    const first = list[0] ? Number(list[0].id.split("-")[1]) : this.#seq + 1;
    // the next event after lastId is no longer kept (a fresh company, or one it never saw, has nothing lost)
    const gone = list.length > 0 && seq + 1 < first && list.length >= this.perCompany;
    return { events: list.filter((x) => Number(x.id.split("-")[1]) > seq), reset: gone };
  }

  /** A deleted company's events go with it. */
  drop(companyId: string): void { this.#byCompany.delete(companyId); }
}

/** Open live streams: per signed-in owner (a whole office or a carrier's NAT shares one IP), else per IP. */
export class StreamCount {
  readonly #open = new Map<string, number>();
  total = 0;
  constructor(readonly perOwner = 12, readonly perIp = 6, readonly max = 2000) {}

  /** A key for this reader and whether one more stream is allowed. */
  take(owner: string | null, ip: string, cap?: number): string | null {
    const k = owner ? `o:${owner}` : `i:${ip}`;
    const n = this.#open.get(k) ?? 0;
    if (n >= (cap ?? (owner ? this.perOwner : this.perIp)) || this.total >= this.max) return null;
    this.#open.set(k, n + 1);
    this.total++;
    return k;
  }

  release(k: string): void {
    const n = (this.#open.get(k) ?? 1) - 1;
    if (n > 0) this.#open.set(k, n); else this.#open.delete(k);
    this.total = Math.max(0, this.total - 1);
  }
}
