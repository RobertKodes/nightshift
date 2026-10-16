import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { erc20Abi } from "viem";
import { eth } from "./chain.js";
import { config } from "./config.js";

/**
 * The platform token's utility inside NIGHTSHIFT, all of it checkable onchain:
 * - holders pay no platform fee when they withdraw revenue,
 * - holders' products are featured first in the market,
 * - platform fees are used to buy the token back on its IMD pair, and every buyback is published.
 */
const holderCache = new Map<string, { at: number; holds: boolean; balance: number }>();
let decimals: number | null = null;

export const tokenOn = () => Boolean(config.token.address);

export async function holderStatus(owner: string | null): Promise<{ holds: boolean; balance: number }> {
  if (!tokenOn() || !owner) return { holds: false, balance: 0 };
  const k = owner.toLowerCase();
  const hit = holderCache.get(k);
  if (hit && Date.now() - hit.at < 10 * 60_000) return hit;
  try {
    decimals ??= Number(await eth.readContract({ address: config.token.address as `0x${string}`, abi: erc20Abi, functionName: "decimals" }));
    const raw = await eth.readContract({ address: config.token.address as `0x${string}`, abi: erc20Abi, functionName: "balanceOf", args: [owner as `0x${string}`] });
    const balance = Number(raw / 10n ** BigInt(Math.max(0, decimals - 6))) / 10 ** Math.min(6, decimals);
    const v = { at: Date.now(), holds: balance >= config.token.holderMin && config.token.holderMin > 0, balance };
    holderCache.set(k, v);
    return v;
  } catch {
    return hit ?? { holds: false, balance: 0 };
  }
}
/** The cached answer, for hot paths like the market listing. */
export const holdsCached = (owner: string | null) => (owner ? holderCache.get(owner.toLowerCase())?.holds ?? false : false);

/**
 * Launching the token through IMD. The owner pays from their own wallet in the browser (IMD's
 * Intake: approve, then request); the server only records the transaction and follows the launch
 * until IMD reports the token address, then switches the token features on.
 */
export type TokenSpec = { name: string; symbol: string; supply: number; poolBps: number; capImd: number; remainderTo?: string };
export const IMD_TOKEN = "0xd34a99bc0f67ae1bbd63c660e6d0b0dd03e263b7";
export const INTAKE = "0xa43e6f75ee006411f79ac1c84120606c2330de82";

export function launchBody(t: TokenSpec): Record<string, unknown> {
  const economics: Record<string, unknown> = { poolBps: t.poolBps, initialMarketCapWei: (BigInt(Math.round(t.capImd)) * 10n ** 18n).toString() };
  if (t.poolBps < 9000 && t.remainderTo) economics.remainderTo = t.remainderTo.toLowerCase();
  return {
    objective: `Launch a plain ERC-20 named ${t.name} with the symbol ${t.symbol}, ${t.supply.toLocaleString("en-US")} supply and 18 decimals. Fixed supply: no owner, no mint, no transfer fee, no blocklist. It is the platform token of NIGHTSHIFT (autonomous AI companies that buy their work from the IMD swarm).`,
    onchain: "custom_token",
    chainId: 1,
    pairWith: "imd",
    economics,
  };
}

export async function checkLaunch(t: TokenSpec): Promise<unknown> {
  const r = await fetch("https://api.imd.fun/requests/check", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "launch.open", input: launchBody(t) }), signal: AbortSignal.timeout(60_000) });
  return r.json();
}

export type LaunchState = { tx: string; at: number; symbol: string; stage: string; jobId?: string; launchId?: string; token?: string; done?: boolean; error?: string };
export function launchState(): LaunchState | null {
  try { return existsSync(file()) ? (JSON.parse(readFileSync(file(), "utf8")).launch ?? null) : null; } catch { return null; }
}
function saveToken(patch: Record<string, unknown>) {
  const cur = existsSync(file()) ? JSON.parse(readFileSync(file(), "utf8")) : {};
  writeFileSync(file(), JSON.stringify({ ...cur, ...patch }, null, 2));
}
export function recordLaunch(tx: string, symbol: string) { saveToken({ launch: { tx, at: Date.now(), symbol, stage: "Waiting for IMD to see the transaction" } }); }

/** One step of following the launch. Returns the token address once IMD reports it live. */
export async function followLaunch(): Promise<LaunchState | null> {
  const l = launchState();
  if (!l || l.done) return l;
  const get = async (u: string) => { const r = await fetch(`https://api.imd.fun${u}`, { signal: AbortSignal.timeout(15000) }); return r.ok ? r.json() : null; };
  try {
    if (!l.jobId) {
      const i = await get(`/intake/1/${l.tx}`) as { entries?: { state?: string; reason?: string; admission?: { result?: { jobId?: string } } }[] } | null;
      const e = i?.entries?.[0];
      if (e?.admission?.result?.jobId) Object.assign(l, { jobId: e.admission.result.jobId, stage: "The swarm is building and auditing the token" });
      else if (e?.state && /refus|fail/i.test(e.state)) Object.assign(l, { stage: `IMD refused it: ${e.reason ?? e.state}`, error: e.reason ?? e.state, done: true });
      else if (e) l.stage = `IMD saw the payment (${e.state ?? "pending"})`;
    }
    if (l.jobId && !l.launchId) {
      const j = await get(`/jobs/${l.jobId}`) as { state?: string; nodes?: { state: string }[] } | null;
      const res = await get(`/jobs/${l.jobId}/result`) as { launch?: { id?: string } } | null;
      if (res?.launch?.id) l.launchId = res.launch.id;
      const n = j?.nodes ?? [];
      if (!l.launchId) l.stage = `The swarm is building and auditing the token (${n.filter((x) => x.state === "accepted").length}/${n.length} steps)`;
      if (j?.state === "failed" || j?.state === "cancelled") Object.assign(l, { stage: `The swarm job ${j.state}`, error: j.state, done: true });
    }
    if (l.launchId) {
      const L = await get(`/launches/${l.launchId}`) as { status?: string; artifacts?: { role: string; address: string }[] } | null;
      const token = L?.artifacts?.find((a) => a.role === "token")?.address;
      l.stage = L?.status === "live" ? "Live" : `Deploying (${L?.status ?? "…"})`;
      if (L?.status === "live" && token) Object.assign(l, { token, done: true });
    }
  } catch (e) { l.stage = `${l.stage} (retrying: ${(e as Error).message.slice(0, 60)})`; }
  saveToken({ launch: l });
  return l;
}

export type Buyback = { at: number; tx: string; usd: number; amount: number; note?: string };
const file = () => join(config.dataDir, "token.json");
export function buybacks(): Buyback[] {
  try { return existsSync(file()) ? (JSON.parse(readFileSync(file(), "utf8")).buybacks ?? []) : []; } catch { return []; }
}
export function recordBuyback(b: Buyback): void {
  saveToken({ buybacks: [...buybacks(), b].sort((x, y) => y.at - x.at) });
}
