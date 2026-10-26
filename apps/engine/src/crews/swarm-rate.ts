/** A shared rolling-window queue for the desk's IMD HTTP requests. */
export class ImdQueue {
  #all: number[] = [];
  #quotes: number[] = [];
  #turn: Promise<void> = Promise.resolve();
  constructor(private readonly now = Date.now, private readonly wait = (ms: number) => new Promise<void>((r) => setTimeout(r, ms)), private readonly limit = 280, private readonly quoteLimit = 28) {}
  async run<T>(quote: boolean, work: () => Promise<T>): Promise<T> {
    const admitted = this.#turn.then(async () => {
      for (;;) {
        const now = this.now(); this.#all = this.#all.filter((at) => now - at < 60_000); this.#quotes = this.#quotes.filter((at) => now - at < 60_000);
        const until = Math.max(this.#all.length >= this.limit ? this.#all[0]! + 60_001 : now, quote && this.#quotes.length >= this.quoteLimit ? this.#quotes[0]! + 60_001 : now);
        if (until <= now) { this.#all.push(now); if (quote) this.#quotes.push(now); return; }
        await this.wait(Math.min(60_000, until - now));
      }
    });
    this.#turn = admitted.catch(() => {});
    await admitted; return work();
  }
  fetch: typeof fetch = (input, init) => this.run(/\/requests\/quote(?:\?|$)/.test(String(input)), () => fetch(input, { ...init, signal: AbortSignal.timeout(20_000) }));
}
