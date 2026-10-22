import { CHAINS, type ChainKey } from "./chains.js";

export type Track = { state: "pending" | "done" | "failed" | "refunded"; text: string; outHash?: string; outUrl?: string };

/** LI.FI's /v1/status answer. NOT_FOUND (or its 1003 error) right after sending means it has not seen the transaction yet. */
export function fromLifiStatus(j: Record<string, unknown>, toChain: ChainKey): Track {
  const status = String(j.status ?? ""), sub = String(j.substatus ?? ""), msg = typeof j.substatusMessage === "string" ? j.substatusMessage : "";
  const rec = j.receiving as { txHash?: string; txLink?: string } | undefined;
  const out = rec?.txHash ? { outHash: rec.txHash, outUrl: rec.txLink ?? `${CHAINS[toChain].tx}${rec.txHash}` } : {};
  if (status === "DONE" && sub === "REFUNDED") return { state: "refunded", text: msg || "Refunded to your wallet.", ...out };
  if (status === "DONE" && sub === "PARTIAL") return { state: "done", text: msg || "Arrived, partly as another token.", ...out };
  if (status === "DONE") return { state: "done", text: "Arrived.", ...out };
  if (status === "FAILED") return { state: "failed", text: msg || "The transfer failed.", ...out };
  if (status === "PENDING") return { state: "pending", text: msg || "On its way.", ...out };
  return { state: "pending", text: "Waiting for LI.FI to see the transaction…" };
}

/** Relay's /intents/status/v3 answer. */
export function fromRelayStatus(j: Record<string, unknown>, toChain: ChainKey): Track {
  const s = String(j.status ?? "");
  const hash = Array.isArray(j.txHashes) && typeof j.txHashes[0] === "string" ? j.txHashes[0] : undefined;
  const out = hash ? { outHash: hash, outUrl: `${CHAINS[toChain].tx}${hash}` } : {};
  if (s === "success") return { state: "done", text: "Arrived.", ...out };
  if (s === "refund" || s === "refunded") return { state: "refunded", text: "Refunded to your wallet.", ...out };
  if (s === "failure") return { state: "failed", text: typeof j.failReason === "string" && j.failReason !== "N/A" ? `Failed: ${j.failReason}.` : "The transfer failed.", ...out };
  if (s === "waiting") return { state: "pending", text: "Waiting for Relay to see your deposit…" };
  return { state: "pending", text: "On its way.", ...out };
}
