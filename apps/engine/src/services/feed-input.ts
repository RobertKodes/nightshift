import { chainIdOf } from "./imd.js";
import { ServiceError } from "./verdict.js";

/** Validate and normalize feed filters before binding a payment. */
export function feedInput(endpoint: string, detail: boolean, query: URLSearchParams): URLSearchParams {
  const keys = detail && endpoint === "launches" ? [] : endpoint === "launches" ? ["chain", "kind", "status", "since", "before", "limit"] : endpoint === "tokens" ? ["indexed", "limit"] : endpoint === "agents" ? ["since", "before", "limit"] : ["since"];
  const out = new URLSearchParams();
  const bad = (): never => { throw new ServiceError(400, "Invalid or duplicate IMD feed input. Nothing was charged."); };
  for (const [key, value] of query) {
    if (query.getAll(key).length !== 1 || value.length > 2000 || ![...keys, "holder", "sim", "sample"].includes(key)) bad();
    if (["holder", "sim", "sample"].includes(key)) continue;
    if (["since", "before"].includes(key) && !(endpoint === "launches" && key === "before")) {
      const t = /^\d{10,13}$/.test(value) ? Number(value) * (value.length === 10 ? 1000 : 1) : Date.parse(value);
      if (!Number.isFinite(t) || Number.isNaN(new Date(t).getTime())) bad();
      out.set(key, new Date(t).toISOString());
    } else if (key === "limit" || key === "before") {
      if (!/^\d+$/.test(value) || !Number.isSafeInteger(Number(value)) || Number(value) < 1) bad();
      out.set(key, String(key === "limit" ? Math.min(endpoint === "tokens" ? 500 : 200, Number(value)) : Number(value)));
    } else if (key === "chain") {
      const chain = chainIdOf(value); if (chain === null) bad(); out.set(key, String(chain));
    } else { if (key === "indexed" && !["0", "1"].includes(value)) bad(); out.set(key, value); }
  }
  if (keys.includes("limit") && !out.has("limit")) out.set("limit", endpoint === "tokens" ? "100" : "50");
  if (endpoint === "tokens" && !out.has("indexed")) out.set("indexed", "1");
  return out;
}
