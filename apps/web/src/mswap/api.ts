import type { ChainKey, FeeDecision, Quote, QuoteRequest, Token, Track } from "@nightshift/swap";

/** The engine's swap routes (apps/engine/src/swap.ts): fee for this wallet, routes, tokens, transfer status. */
export type FeeInfo = FeeDecision & { collect: { lifi: boolean; relay: boolean }; xrplSource: string };
export type Quotes = { quotes: Quote[]; fee: FeeDecision; errors: { provider: string; error: string }[] };

async function get<T>(path: string, init?: RequestInit): Promise<T> {
  const r = await fetch(path, { credentials: "same-origin", ...init });
  const j = (await r.json().catch(() => ({}))) as T & { error?: string };
  if (!r.ok) throw new Error(j.error ?? `The swap service answered ${r.status}.`);
  return j;
}

export const swapApi = {
  fee: (wallet: string | null) => get<FeeInfo>(`/api/swap/fee${wallet ? `?wallet=${wallet}` : ""}`),
  quote: (r: QuoteRequest, signal?: AbortSignal) => get<Quotes>("/api/swap/quote", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(r), signal }),
  tokens: (chain: ChainKey, q = "") => get<{ tokens: Token[] }>(`/api/swap/tokens?chain=${chain}&q=${encodeURIComponent(q)}`).then((x) => x.tokens),
  status: (p: Record<string, string>) => get<Track>(`/api/swap/status?${new URLSearchParams(p)}`),
};
