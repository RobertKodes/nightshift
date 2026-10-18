import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { erc20Abi, parseAbi, parseAbiItem } from "viem";
import { eth } from "./chain.js";
import { config } from "./config.js";
import { FIRST_BUYER, SHIFT_LAUNCH } from "./shift-launch.js";

/**
 * The platform token's utility inside NIGHTSHIFT, all of it checkable onchain:
 * - holders pay no platform fee when they withdraw revenue,
 * - holders' products are featured first in the market,
 * - platform fees are used to buy the token back on its IMD pair, and every buyback is published.
 */
const holderCache = new Map<string, { at: number; holds: boolean; balance: number }>();
let decimals: number | null = null;
let decimalsFor = "";

export const tokenOn = () => Boolean(config.token.address);

/** `fresh` reads the chain now and never falls back to a cached answer (money decisions). */
export async function holderStatus(owner: string | null, fresh = false): Promise<{ holds: boolean; balance: number }> {
  if (!tokenOn() || !owner) return { holds: false, balance: 0 };
  const k = owner.toLowerCase();
  const hit = holderCache.get(k);
  if (!fresh && hit && Date.now() - hit.at < 10 * 60_000) return hit;
  try {
    if (decimalsFor !== config.token.address) { decimals = null; decimalsFor = config.token.address; }
    decimals ??= Number(await eth.readContract({ address: config.token.address as `0x${string}`, abi: erc20Abi, functionName: "decimals" }));
    const raw = await eth.readContract({ address: config.token.address as `0x${string}`, abi: erc20Abi, functionName: "balanceOf", args: [owner as `0x${string}`] });
    const balance = Number(raw / 10n ** BigInt(Math.max(0, decimals - 6))) / 10 ** Math.min(6, decimals);
    const v = { at: Date.now(), holds: balance >= config.token.holderMin && config.token.holderMin > 0, balance };
    holderCache.set(k, v);
    return v;
  } catch {
    return fresh ? { holds: false, balance: 0 } : hit && Date.now() - hit.at < 60 * 60_000 ? hit : { holds: false, balance: 0 };
  }
}
/** The cached answer, for hot paths like the market listing. */
export const holdsCached = (owner: string | null) => (owner ? holderCache.get(owner.toLowerCase())?.holds ?? false : false);

/**
 * Launching the token through IMD. The owner pays from their own wallet in the browser (IMD's
 * Intake: approve, then request); the server only records the transaction and follows the launch
 * until IMD reports the token address, then switches the token features on.
 */
export const IMD_TOKEN = "0xd34a99bc0f67ae1bbd63c660e6d0b0dd03e263b7";
export const INTAKE = "0xa43e6f75ee006411f79ac1c84120606c2330de82";

/** The one launch body (see shift-launch.ts): a v4 hook with the first-buyer gate and the 5% sell fee. */
export const launchBody = (): Record<string, unknown> => SHIFT_LAUNCH;

export async function checkLaunch(): Promise<unknown> {
  const r = await fetch("https://api.imd.fun/requests/check", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "launch.open", input: launchBody() }), signal: AbortSignal.timeout(60_000) });
  return r.json();
}

/**
 * `contracts` are the deployed addresses by role (token, hook, splitter, rewards). `open` turns
 * true once the first buyer has bought: only then is the token switched on and announced.
 */
export type LaunchState = {
  tx: string; at: number; symbol: string; stage: string; jobId?: string; launchId?: string; token?: string; done?: boolean; error?: string;
  contracts?: Record<string, string>; open?: boolean; openTx?: string; scanFrom?: number;
  /** After the first buy: when the main group is told (5 minutes later), and whether it was. */
  publicAt?: number; announced?: boolean;
  /** The SHIFT/ETH v4 pool key, found from the PoolManager once deployed: the site's swap uses it. */
  pool?: import("./v4.js").PoolKey;
  /** IMD's number for this launch: the factory's fee calls take it. */
  launchNumber?: number;
};
/** IMD lists only what it deployed itself; the hook's own helpers are read from the hook. */
export async function completeContracts(): Promise<LaunchState | null> {
  const l = launchState();
  const c = l?.contracts;
  if (!l || !c?.hook || (c.splitter && c.rewards)) return l;
  const abi = parseAbi(["function feeSplitter() view returns (address)", "function rewards() view returns (address)"]);
  const [s, r] = await Promise.all([
    eth.readContract({ address: c.hook as `0x${string}`, abi, functionName: "feeSplitter" }).catch(() => null),
    eth.readContract({ address: c.hook as `0x${string}`, abi, functionName: "rewards" }).catch(() => null),
  ]);
  const contracts = { ...c, ...(s ? { splitter: s.toLowerCase() } : {}), ...(r ? { rewards: r.toLowerCase() } : {}) };
  patchLaunch({ contracts });
  return { ...l, contracts };
}
export function patchLaunch(p: Partial<LaunchState>) { const l = launchState(); if (l) saveToken({ launch: { ...l, ...p } }); }
export function launchState(): LaunchState | null {
  try { return existsSync(file()) ? (JSON.parse(readFileSync(file(), "utf8")).launch ?? null) : null; } catch { return null; }
}
function saveToken(patch: Record<string, unknown>) {
  const cur = existsSync(file()) ? JSON.parse(readFileSync(file(), "utf8")) : {};
  writeFileSync(file(), JSON.stringify({ ...cur, ...patch }, null, 2));
}
/** The last check of the deployed contracts against our spec (shift-verify.ts). */
export type Verification = { at: number; checks: { label: string; ok: boolean; detail: string }[] };
export function saveVerification(checks: Verification["checks"]) { saveToken({ verification: { at: Date.now(), checks } }); }
export function verification(): Verification | null {
  try { return existsSync(file()) ? (JSON.parse(readFileSync(file(), "utf8")).verification ?? null) : null; } catch { return null; }
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
      const L = await get(`/launches/${l.launchId}`) as { status?: string; artifacts?: { role: string; address: string; name?: string; contract?: string }[] } | null;
      const arts = L?.artifacts ?? [];
      const token = arts.find((a) => a.role === "token")?.address;
      const named = (re: RegExp) => arts.find((a) => re.test(`${a.name ?? ""} ${a.contract ?? ""} ${a.role}`))?.address;
      l.stage = L?.status === "live" ? `Deployed. Waiting for the first buy by ${FIRST_BUYER.slice(0, 6)}…${FIRST_BUYER.slice(-4)}` : `Deploying (${L?.status ?? "…"})`;
      if (L?.status === "live" && token) {
        const contracts: Record<string, string> = { token };
        for (const [k, re] of [["hook", /hook/i], ["splitter", /split/i], ["rewards", /reward|stak/i]] as const) { const a = named(re); if (a) contracts[k] = a; }
        Object.assign(l, { token, contracts, done: true, scanFrom: Number(await eth.getBlockNumber()) - 50 });
      }
    }
  } catch (e) { l.stage = `${l.stage} (retrying: ${(e as Error).message.slice(0, 60)})`; }
  saveToken({ launch: l });
  return l;
}

const TRANSFER = parseAbiItem("event Transfer(address indexed from, address indexed to, uint256 value)");

/**
 * After deploy, trading stays closed until the first buyer buys. That buy is a transfer of the
 * token out of the v4 pool manager to the first buyer: read from the chain, not from the hook's
 * ABI, so it works whatever the swarm named things.
 */
export async function followOpen(): Promise<LaunchState | null> {
  const l = launchState();
  if (!l?.done || !l.token || l.open || l.error) return l;
  try {
    const head = Number(await eth.getBlockNumber());
    let from = l.scanFrom ?? head - 50;
    while (from <= head) {
      const to = Math.min(head, from + 900);
      // Out of the pool manager, or through a router, but always in a transaction the first buyer sent.
      const logs = await eth.getLogs({ address: l.token as `0x${string}`, event: TRANSFER, args: { to: FIRST_BUYER }, fromBlock: BigInt(from), toBlock: BigInt(to) });
      for (const log of logs) {
        const t = await eth.getTransactionReceipt({ hash: log.transactionHash! }).catch(() => null);
        if (t?.from.toLowerCase() === FIRST_BUYER) {
          Object.assign(l, { open: true, openTx: log.transactionHash, stage: "Live: trading is open to everyone" });
          break;
        }
      }
      if (l.open) break;
      from = to + 1;
    }
    if (!l.open) l.scanFrom = head - 5;
  } catch (e) { l.stage = `${l.stage.split(" (retrying")[0]} (retrying: ${(e as Error).message.slice(0, 60)})`; }
  saveToken({ launch: l });
  return l;
}

export type Buyback ={ at: number; tx: string; usd: number; amount: number; note?: string };
const file = () => join(config.dataDir, "token.json");
export function buybacks(): Buyback[] {
  try { return existsSync(file()) ? (JSON.parse(readFileSync(file(), "utf8")).buybacks ?? []) : []; } catch { return []; }
}
export function recordBuyback(b: Buyback): void {
  saveToken({ buybacks: [...buybacks(), b].sort((x, y) => y.at - x.at) });
}
