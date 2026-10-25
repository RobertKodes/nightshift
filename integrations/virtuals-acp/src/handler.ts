// The job logic, kept separate from the wallet so it can be tested offline.
// Flow (ACP v2): buyer sends a "requirement" message -> we set a budget ->
// buyer funds -> we submit the deliverable -> buyer/evaluator completes.
import { AssetToken } from "@virtuals-protocol/acp-node-v2";
import type { JobRoomEntry } from "@virtuals-protocol/acp-node-v2";
import type { AcpConfig } from "./config.ts";

// The small slice of JobSession we use (lets tests pass a fake).
export interface SessionLike {
  jobId: string;
  chainId: number;
  status: string;
  entries: JobRoomEntry[];
  job?: { description?: string } | null;
  setBudget(amount: unknown): Promise<void>;
  submit(deliverable: string): Promise<void>;
  sendMessage(content: string): Promise<void>;
}

const ADDRESS = /^0x[0-9a-fA-F]{40}$/;

/** Pull the token address out of the buyer's requirement: {"token":"0x.."} or a bare address. */
export function parseToken(content: string): string | null {
  let value: unknown = content.trim();
  try {
    const j = JSON.parse(content);
    value = typeof j === "string" ? j : (j as { token?: unknown })?.token;
  } catch {
    /* not JSON: treat as bare text */
  }
  return typeof value === "string" && ADDRESS.test(value) ? value : null;
}

export function makeEntryHandler(cfg: AcpConfig, fetchImpl: typeof fetch = fetch) {
  return async (session: SessionLike, entry: JobRoomEntry): Promise<void> => {
    // 1) requirement arrives: validate it, then quote the price
    if (entry.kind === "message" && entry.contentType === "requirement" && session.status === "open") {
      const offering = session.job?.description;
      if (offering && offering !== cfg.offeringName) return; // some other offering of ours
      if (!parseToken(entry.content)) {
        await session.sendMessage("Requirement must be a JSON object with a token field: a 40-hex-character Ethereum token address.");
        return;
      }
      await session.setBudget(AssetToken.usdc(cfg.priceUsd, session.chainId));
      return;
    }
    // 2) buyer funded the job: fetch the free preview and deliver it
    if (entry.kind === "system" && entry.event.type === "job.funded") {
      const req = session.entries.find((e) => e.kind === "message" && e.contentType === "requirement");
      const token = req && req.kind === "message" ? parseToken(req.content) : null;
      if (!token) {
        await session.sendMessage("No valid token address found in the requirement.");
        return;
      }
      const res = await fetchImpl(`${cfg.nightshiftBase}/api/v1/verdict/ethereum/${token}/preview`, {
        headers: { accept: "application/json" },
      });
      const text = await res.text();
      if (!res.ok) {
        await session.sendMessage(`NIGHTSHIFT answered ${res.status}: ${text.slice(0, 200)}`);
        return;
      }
      await session.submit(text);
    }
  };
}
