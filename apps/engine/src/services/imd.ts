import type { Address } from "viem";
import { TtlCache } from "./cache.js";
import { lc, symbolsOf } from "./evm.js";
import type { Deps } from "./net.js";

/** IMD's public records, as the house services read them: launches, their artifacts and pools, seats, the swarm. */
export const IMD_API = "https://api.imd.fun";
export const IMD_TOKEN: Address = "0xd34a99bc0f67ae1bbd63c660e6d0b0dd03e263b7";
/** IMD's launch wallet (deploys every launch) and its factories on Ethereum, which seed and hold each launch's pool position. */
export const IMD_DEPLOYER: Address = "0xcecc29b037f5064fcdf45a5c318f132ef76aa551";
export const IMD_FACTORIES: Record<string, string> = {
  "0x12c63b581d07093f6126bc02263c58f7eadaa96f": "IMD LaunchFactory",
  "0xff03410d0fe5fa8f7f59f743de35e333d9857120": "IMD ProjectFactory",
};
export const CHAINS: Record<number, string> = { 1: "ethereum", 4663: "robinhood", 11155111: "sepolia" };
export const chainIdOf = (s: string): number | null => {
  const k = s.toLowerCase();
  if (["1", "eth", "ethereum", "mainnet"].includes(k)) return 1;
  if (["4663", "robinhood"].includes(k)) return 4663;
  if (["11155111", "sepolia"].includes(k)) return 11155111;
  return null;
};

export type Artifact = { role: string; name: string; address: string; txHash?: string; blockNumber?: number };
export type PoolKeyRow = { fee: number; hooks: string; currency0: string; currency1: string; tickSpacing: number };
export type LaunchRow = {
  id: string; launchNumber: number; kind: string; status: string; chainId: number; sourceRepoUrl: string | null; sourceCommit?: string | null;
  parkedReason?: string | null; artifacts?: Artifact[]; seeded?: { pools?: PoolKeyRow[]; positions?: { factory: string; tickLower: number; tickUpper: number; launchNumber: number }[]; launched?: { factory?: string }[] } | null;
  createdAt: string; updatedAt?: string;
};
export type LaunchDetail = LaunchRow & {
  admissionChecks?: { name: string; detail: string; status: string }[]; assurances?: { kind: string; provider: string; url: string; revokedAt?: string | null }[];
  economics?: { poolBps?: number; remainderTo?: string }; poolFee?: number; requester?: string; jobs?: { id: string; objective?: string; state: string }[];
  allocations?: unknown[]; rewardSnapshot?: { workers?: { wallet: string; deviceKey: string; work?: { role: string; jobId: string }[] }[] } | null;
  attestation?: { verifierVersion?: string; toolchain?: Record<string, unknown> } | null; deployFailure?: string | null; logo?: { link?: string | null } | null;
};

export const tokenOf = (l: LaunchRow) => l.artifacts?.find((a) => a.role === "token") ?? null;
export const hookOf = (l: LaunchRow) => l.artifacts?.find((a) => a.role === "hook") ?? null;
export const launchUrl = (l: { id: string }) => `${IMD_API}/launches/${l.id}`;

export function imdReader(d: Deps) {
  const lists = new TtlCache<LaunchRow[]>(10 * 60_000, 4, d.now);
  const details = new TtlCache<LaunchDetail>(10 * 60_000, 300, d.now);
  const symbols = new Map<string, string | null>();
  let symbolsAt = 0;

  /** Every IMD launch, newest first (all pages of GET /launches). */
  async function launches(): Promise<{ list: LaunchRow[]; at: number }> {
    const r = await lists.get("all", async () => {
      const out: LaunchRow[] = [];
      let before = "";
      for (let page = 0; page < 20; page++) {
        const x = await d.net.json<{ launches?: LaunchRow[] }>(`${IMD_API}/launches?limit=500${before ? `&before=${before}` : ""}`, 20_000);
        const rows = x.launches ?? [];
        out.push(...rows);
        if (rows.length < 500) break;
        before = String(rows.at(-1)!.launchNumber);
      }
      if (!out.length) throw new Error("IMD returned no launches");
      return out;
    });
    return { list: r.v, at: r.at };
  }

  /** The launch whose artifacts include this address, on this chain. */
  async function launchOf(chainId: number, address: string): Promise<{ launch: LaunchRow; artifact: Artifact } | null> {
    const a = address.toLowerCase();
    for (const l of (await launches()).list) {
      if (l.chainId !== chainId) continue;
      const art = l.artifacts?.find((x) => x.address?.toLowerCase() === a);
      if (art) return { launch: l, artifact: art };
    }
    return null;
  }

  /** One launch in full (admission checks, jobs, economics…), by launch number or id. */
  async function detail(idOrNumber: string): Promise<LaunchDetail | null> {
    let id = idOrNumber;
    if (/^\d{1,7}$/.test(idOrNumber)) {
      const row = (await launches()).list.find((l) => l.launchNumber === Number(idOrNumber));
      if (!row) return null;
      id = row.id;
    }
    if (!/^[0-9a-f-]{36}$/i.test(id)) return null;
    return (await details.get(id, () => d.net.json<LaunchDetail>(`${IMD_API}/launches/${id}`, 15_000))).v;
  }

  /** symbol() of every live Ethereum launch token, read on chain in a few batched calls and kept; new launches are added as they appear. */
  async function symbolIndex(): Promise<Map<string, string | null>> {
    if (d.now() - symbolsAt < 10 * 60_000 && symbols.size) return symbols;
    const want = (await launches()).list.filter((l) => l.chainId === 1).map((l) => tokenOf(l)?.address?.toLowerCase()).filter((a): a is string => Boolean(a) && !symbols.has(a!));
    if (want.length) {
      const got = await symbolsOf(d.rpc, want as Address[]);
      want.forEach((a, i) => symbols.set(a, got[i] ?? null));
    }
    symbolsAt = d.now();
    return symbols;
  }

  /** Every launch on this chain whose token has this symbol (case and a leading $ ignored), oldest first. */
  async function sameSymbol(chainId: number, symbol: string): Promise<LaunchRow[]> {
    if (chainId !== 1) return [];
    const norm = (s: string) => s.replace(/^\$/, "").trim().toLowerCase();
    const want = norm(symbol);
    if (!want) return [];
    const idx = await symbolIndex();
    return (await launches()).list.filter((l) => l.chainId === 1 && (() => { const t = tokenOf(l)?.address?.toLowerCase(); const s = t ? idx.get(t) : null; return s ? norm(s) === want : false; })())
      .sort((a, b) => a.launchNumber - b.launchNumber);
  }

  return { launches, launchOf, detail, sameSymbol, symbolIndex };
}
export type ImdReader = ReturnType<typeof imdReader>;

/** The seats that worked on a launch: from its jobs' submissions (seat, role, accepted). */
export async function buildersOf(d: Deps, jobs: { id: string }[]): Promise<{ seat: number; agentId: string | null; roles: string[]; accepted: number; attempts: number; jobs: string[] }[]> {
  const seats = new Map<string, { seat: number; agentId: string | null; roles: Set<string>; accepted: number; attempts: number; jobs: Set<string> }>();
  for (const j of jobs.slice(0, 6)) {
    const s = await d.net.json<{ submissions?: { role?: string; accepted?: boolean; seat?: { tokenId: string; agentId?: string } | null }[] }>(`${IMD_API}/jobs/${j.id}/submissions`, 15_000).catch(() => null);
    for (const x of s?.submissions ?? []) {
      if (!x.seat?.tokenId) continue;
      const m = seats.get(x.seat.tokenId) ?? { seat: Number(x.seat.tokenId), agentId: x.seat.agentId ?? null, roles: new Set<string>(), accepted: 0, attempts: 0, jobs: new Set<string>() };
      m.attempts++;
      if (x.accepted) m.accepted++;
      if (x.role) m.roles.add(x.role);
      m.jobs.add(j.id);
      seats.set(x.seat.tokenId, m);
    }
  }
  return [...seats.values()].map((m) => ({ ...m, roles: [...m.roles], jobs: [...m.jobs] })).sort((a, b) => b.accepted - a.accepted || a.seat - b.seat);
}

export const isImdInfra = (a: string) => a.toLowerCase() in IMD_FACTORIES || a.toLowerCase() === IMD_DEPLOYER;
export const lower = lc;
