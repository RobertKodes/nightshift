import { createHash } from "node:crypto";
import type { Settlement } from "../checkout.js";
import type { Out } from "./routes.js";

export const REQUEST_CONFLICT = "This payment was made for a different request. Nothing was charged.";
const DAY = 86_400_000, MAX_BYTES = 32 * 1024 * 1024, MAX_ANSWER = 1024 * 1024;
export type PaidRequest = { digest: string; at: number; answer?: string; response?: string };
const json = (v: unknown) => JSON.stringify(v, (_k, x) => typeof x === "bigint" ? x.toString() : x);
const fail = (status: number, message: string): never => { throw Object.assign(new Error(message), { status }); };

/** Canonical validated inputs, independent of query order. */
export function requestDigest(method: string, path: string, inputs: object): string {
  const sorted = Object.fromEntries(Object.entries(inputs).sort(([a], [b]) => a.localeCompare(b)));
  return createHash("sha256").update(json([method.toUpperCase(), path, sorted])).digest("hex");
}

/** The checkout owns both the binding and its bounded response cache. */
export class PaymentRequests {
  #turns = new Map<string, Promise<unknown>>();
  constructor(private records: Map<string, Settlement>, private save: () => Promise<void>, private now = Date.now) {}

  async use(record: Settlement, digest: string, run: (r: PaidRequest, keep: (key: "answer" | "response", value: unknown) => Promise<void>) => Promise<Out>): Promise<Out> {
    const turn = (this.#turns.get(record.key) ?? Promise.resolve()).catch(() => {}).then(async () => {
      let r = this.records.get(record.key);
      if (r && (r.companyId !== record.companyId || r.productId !== record.productId || (r.request ? r.request.digest !== digest : r.hash || r.booked || r.handedOff))) fail(409, REQUEST_CONFLICT);
      if (!r) { r = record; this.records.set(r.key, r); }
      if (!r.request) {
        r.request = { digest, at: this.now() };
        try { await this.save(); } catch (e) { delete r.request; throw e; }
      }
      const request = r.request;
      if (this.now() - request.at >= DAY && (r.booked || request.response || (request.answer && !r.hash && !r.handedOff))) fail(410, "This payment's saved answer has expired. Contact support with the payment transaction.");
      if (request.response) return JSON.parse(request.response) as Out;
      const keep = async (key: "answer" | "response", value: unknown) => {
        const body = json(value);
        if (Buffer.byteLength(body) > MAX_ANSWER - (key === "answer" ? 16_384 : 0)) fail(503, key === "answer" ? "The answer exceeds the payment cache limit. Nothing was charged." : "The response exceeds the payment cache limit. Retry the same payment or check the saved job.");
        let bytes = 0;
        for (const s of this.records.values()) {
          const q = s.request;
          if (!q) continue;
          if (this.now() - q.at >= DAY && (s.booked || (!s.hash && !s.handedOff))) { delete q.answer; delete q.response; }
          if (q !== request || key !== "response") bytes += Buffer.byteLength(q.answer ?? "") + (q.answer ? 16_384 : 0) + Buffer.byteLength(q.response ?? "");
        }
        if (bytes + Buffer.byteLength(body) + (key === "answer" ? 16_384 : 0) > MAX_BYTES) fail(503, "The payment answer cache is full. Retry later with the same payment.");
        const before = { ...request };
        request[key] = body;
        if (key === "response") { request.at = this.now(); delete request.answer; }
        try { await this.save(); } catch (e) { Object.assign(request, before); if (!before[key]) delete request[key]; throw e; }
      };
      return run(request, keep);
    });
    this.#turns.set(record.key, turn);
    try { return await turn; } finally { if (this.#turns.get(record.key) === turn) this.#turns.delete(record.key); }
  }
}
