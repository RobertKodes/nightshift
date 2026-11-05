import { createPublicClient, http, stringToHex } from "viem";
import { config } from "./config.js";

/**
 * The IMD swarm for Solana launches: the creator buys one IMD job (0.5 IMD, job.open) from their own
 * Ethereum or Robinhood Chain wallet through IMD's onchain Intake, with the exact body NIGHTSHIFT wrote
 * for their launch. This module checks the body for free first, proves the payment carried that body
 * (the Intake emits the body whole in its event), and follows the job to its files and site.
 */

export const IMD_API = "https://api.imd.fun";
export const INTAKE = "0xa43e6f75ee006411f79ac1c84120606c2330de82";
export const JOB_ACTION = "job.open@job-1";
export const IMD_PRICE = 0.5;
export const PAY_CHAINS = { 1: "Ethereum", 4663: "Robinhood Chain" } as const;
export type PayChain = keyof typeof PAY_CHAINS;
const RPC: Record<PayChain, () => string> = { 1: () => config.ethRpc, 4663: () => "https://rpc.mainnet.chain.robinhood.com" };

export type ImdFile = { name: string; url: string; mediaType: string };
export type ImdJob = { state: string; nodes: { key: string; state: string }[]; site: string | null };
export type ImdPort = {
  check(body: unknown): Promise<{ blockers: string[]; plan: string[] }>;
  /** the payment transaction succeeded and the Intake's event carried exactly this body */
  paid(chainId: PayChain, tx: string, body: string): Promise<{ ok: true; payer: string } | { ok: false; why: string }>;
  intake(chainId: PayChain, tx: string): Promise<{ state: string | null; reason: string | null; job: string | null } | null>;
  job(id: string): Promise<ImdJob | null>;
  files(id: string): Promise<ImdFile[]>;
  text(url: string): Promise<string | null>;
};

const get = async <T>(url: string, ms = 12_000): Promise<T | null> => {
  const r = await fetch(url, { signal: AbortSignal.timeout(ms) }).catch(() => null);
  return r?.ok ? ((await r.json().catch(() => null)) as T | null) : null;
};

export function liveImd(): ImdPort {
  return {
    async check(body) {
      const r = await fetch(`${IMD_API}/requests/check`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "job.open", input: body }), signal: AbortSignal.timeout(20_000) });
      const j = (await r.json().catch(() => null)) as { blockers?: { code?: string; detail?: string }[]; plan?: { title?: string }[]; error?: string } | null;
      if (!j || j.error) throw new Error(`IMD's check did not answer${j?.error ? `: ${j.error}` : ""}.`);
      return { blockers: (j.blockers ?? []).map((b) => b.detail ?? b.code ?? "refused"), plan: (j.plan ?? []).map((p) => p.title ?? "").filter(Boolean) };
    },
    async paid(chainId, tx, body) {
      const c = createPublicClient({ transport: http(RPC[chainId]()) });
      const r = await c.getTransactionReceipt({ hash: tx as `0x${string}` }).catch(() => null);
      if (!r) return { ok: false, why: "That payment is not confirmed yet. Wait a moment." };
      if (r.status !== "success") return { ok: false, why: "That transaction failed: IMD was not paid." };
      const hex = stringToHex(body).slice(2).toLowerCase();
      const carried = r.logs.some((l) => l.address.toLowerCase() === INTAKE && l.data.toLowerCase().includes(hex));
      return carried ? { ok: true, payer: r.from.toLowerCase() } : { ok: false, why: "That payment is not IMD's job for this launch." };
    },
    async intake(chainId, tx) {
      const j = await get<{ entries?: { state?: string; reason?: string | null; detail?: string | null; admission?: { result?: { jobId?: string } } | null }[] }>(`${IMD_API}/intake/${chainId}/${tx}`);
      const e = j?.entries?.[0];
      if (!e) return null;
      const job = e.admission?.result?.jobId;
      return { state: e.state ?? null, reason: e.reason ?? e.detail ?? null, job: job && /^[0-9a-f-]{36}$/.test(job) ? job : null };
    },
    async job(id) {
      const j = await get<{ state?: string; nodes?: { key: string; state: string }[]; site?: { url?: string | null; status?: string } | null }>(`${IMD_API}/jobs/${id}`);
      if (!j?.state) return null;
      return { state: j.state, nodes: (j.nodes ?? []).map((n) => ({ key: n.key, state: n.state })), site: j.site?.url && j.site.status !== "held" ? j.site.url : null };
    },
    async files(id) {
      const j = await get<{ files?: { name?: string; url?: string; mediaType?: string }[] }>(`${IMD_API}/jobs/${id}/result`);
      return (j?.files ?? []).filter((f) => f.name && f.url?.startsWith(`${IMD_API}/`)).map((f) => ({ name: f.name!, url: f.url!, mediaType: f.mediaType ?? "" }));
    },
    async text(url) {
      if (!url.startsWith(`${IMD_API}/`)) return null;
      const r = await fetch(url, { signal: AbortSignal.timeout(12_000) }).catch(() => null);
      return r?.ok ? (await r.text()).slice(0, 20_000) : null;
    },
  };
}
