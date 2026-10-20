import type { Address, Hex } from "viem";
import type { PoolKey } from "../v4.js";
import { TtlCache } from "./cache.js";
import { type Ctx, RUN_BY } from "./context.js";
import { lc } from "./evm.js";
import { holdersOf } from "./holders.js";
import { CHAINS, IMD_API, IMD_FACTORIES, type LaunchRow, buildersOf, chainIdOf, hookOf, launchUrl, tokenOf } from "./imd.js";
import type { Pair } from "./market.js";
import { poolIdOf, slot0 } from "./v4pool.js";
import { ServiceError } from "./verdict.js";

/**
 * IMD DATA FEED, run by NIGHTSHIFT: IMD's launches, tokens, swarm health and seats as one clean
 * API for agents and bots. Everything comes from IMD's public API, the IMD Watchtower, DexScreener
 * and the chain, with where and when it was read. Polling is the watch: every list takes `since`
 * and answers with the `since` to send next.
 */
export type FeedPage<T> = {
  service: "imd-feed"; runBy: string; endpoint: string; count: number; total: number; items: T[];
  next: { before: number | null; since: string }; sources: string[]; generatedAt: string; sample?: { of: number; note: string };
};

const SAMPLE = 3;
const SAMPLE_NOTE = "A free sample of 3 items. The full answer costs $0.001 per call over x402 (USDC on Base): send the same request without sample=1.";
const toIso = (x: string | null | undefined): string | null => { if (!x) return null; const t = /^\d{10,13}$/.test(x) ? Number(x.length === 10 ? Number(x) * 1000 : x) : Date.parse(x); return Number.isFinite(t) ? new Date(t).toISOString() : null; };

export type LaunchItem = {
  launchNumber: number; id: string; kind: string; status: string; chainId: number; chain: string; createdAt: string; updatedAt: string | null;
  token: { address: string; contract: string; symbol: string | null } | null; hook: { address: string; contract: string } | null; distributor: string | null;
  pool: { poolId: Hex; key: PoolKey; lpHeldBy: string | null } | null;
  market: { priceUsd: number | null; liquidityUsd: number | null; volume24hUsd: number | null; txns24h: { buys: number; sells: number } | null; pair: string | null; source: "dexscreener" } | null;
  repo: string | null; parkedReason: string | null; url: string;
};

export function feed(ctx: Ctx) {
  const lists = new TtlCache<LaunchItem[]>(2 * 60_000, 20, ctx.d.now);
  const details = new TtlCache<unknown>(10 * 60_000, 200, ctx.d.now);
  const tokensC = new TtlCache<LaunchItem[]>(5 * 60_000, 2, ctx.d.now);
  const swarmC = new TtlCache<unknown>(30_000, 2, ctx.d.now);
  const seats = new TtlCache<unknown>(2 * 60_000, 500, ctx.d.now);

  function item(l: LaunchRow, symbols: Map<string, string | null>, pairs: Map<string, Pair[]>): LaunchItem {
    const t = tokenOf(l), h = hookOf(l);
    const p = l.seeded?.pools?.[0];
    const key: PoolKey | null = p ? { currency0: lc(p.currency0), currency1: lc(p.currency1), fee: p.fee, tickSpacing: p.tickSpacing, hooks: lc(p.hooks) } : null;
    const best = t ? [...(pairs.get(t.address.toLowerCase()) ?? [])].sort((a, b) => (b.liquidity?.usd ?? 0) - (a.liquidity?.usd ?? 0))[0] : undefined;
    const factory = l.seeded?.positions?.[0]?.factory?.toLowerCase();
    return {
      launchNumber: l.launchNumber, id: l.id, kind: l.kind, status: l.status, chainId: l.chainId, chain: CHAINS[l.chainId] ?? String(l.chainId), createdAt: l.createdAt, updatedAt: l.updatedAt ?? null,
      token: t ? { address: t.address.toLowerCase(), contract: t.name, symbol: symbols.get(t.address.toLowerCase()) ?? null } : null,
      hook: h ? { address: h.address.toLowerCase(), contract: h.name } : null,
      distributor: l.artifacts?.find((a) => a.role === "distributor")?.address?.toLowerCase() ?? null,
      pool: key ? { poolId: poolIdOf(key), key, lpHeldBy: factory ? IMD_FACTORIES[factory] ?? factory : null } : null,
      market: best ? { priceUsd: best.priceUsd ? Number(best.priceUsd) : null, liquidityUsd: best.liquidity?.usd ?? null, volume24hUsd: best.volume?.h24 ?? null, txns24h: best.txns?.h24 ?? null, pair: best.url, source: "dexscreener" } : null,
      repo: l.sourceRepoUrl ?? null, parkedReason: l.parkedReason ?? null, url: launchUrl(l),
    };
  }

  /** Launches, newest first, filtered; market data for the Ethereum tokens on the page. */
  async function launches(q: URLSearchParams, sample: boolean): Promise<FeedPage<LaunchItem>> {
    const chainQ = q.get("chain"), kind = q.get("kind"), status = q.get("status");
    const chainId = chainQ ? chainIdOf(chainQ) : null;
    if (chainQ && chainId === null) throw new ServiceError(400, "chain is ethereum, robinhood or sepolia (or 1, 4663, 11155111).");
    const since = toIso(q.get("since"));
    if (q.get("since") && !since) throw new ServiceError(400, "since is an ISO time or a Unix time in seconds or milliseconds.");
    const before = q.get("before") ? Number(q.get("before")) : null;
    const limit = Math.min(200, Math.max(1, Number(q.get("limit") ?? 50) || 50));
    const { list, at } = await ctx.imd.launches();
    const rows = list.filter((l) => (chainId === null || l.chainId === chainId) && (!kind || l.kind === kind) && (!status || l.status === status)
      && (!since || Date.parse(l.updatedAt ?? l.createdAt) > Date.parse(since)) && (before === null || l.launchNumber < before));
    const page = rows.slice(0, sample ? SAMPLE : limit);
    const k = `${page.map((l) => `${l.launchNumber}:${l.updatedAt ?? ""}`).join(",")}`;
    const items = (await lists.get(k, async () => {
      const eth = page.filter((l) => l.chainId === 1).map((l) => tokenOf(l)?.address).filter((a): a is string => Boolean(a));
      const [symbols, pairs] = await Promise.all([ctx.imd.symbolIndex().catch(() => new Map<string, string | null>()), ctx.market.pairsOf(1, eth).catch(() => new Map<string, Pair[]>())]);
      return page.map((l) => item(l, symbols, pairs));
    })).v;
    const newest = list.reduce((m, l) => Math.max(m, Date.parse(l.updatedAt ?? l.createdAt)), 0);
    return {
      service: "imd-feed", runBy: RUN_BY, endpoint: "launches", count: items.length, total: rows.length, items,
      next: { before: rows.length > page.length ? page.at(-1)!.launchNumber : null, since: new Date(Math.max(newest, Date.parse(since ?? "1970-01-01"))).toISOString() },
      sources: [`${IMD_API}/launches (read ${Math.round((ctx.d.now() - at) / 1000)} s ago)`, "api.dexscreener.com (Ethereum tokens)", "eth_call symbol() for Ethereum tokens"],
      generatedAt: new Date(ctx.d.now()).toISOString(), ...(sample ? { sample: { of: rows.length, note: SAMPLE_NOTE } } : {}),
    };
  }

  /** One launch in full: IMD's record, the pool's live state, holders and the seats that built it. */
  async function launch(id: string, sample: boolean): Promise<unknown> {
    const { list } = await ctx.imd.launches();
    const row = /^\d{1,7}$/.test(id) ? list.find((l) => l.launchNumber === Number(id)) : list.find((l) => l.id === id.toLowerCase());
    if (!row) throw new ServiceError(404, "No IMD launch with that number or id.");
    return (await details.get(`${row.id}:${sample ? 1 : 0}`, async () => {
      const [d, symbols, pairs] = await Promise.all([ctx.imd.detail(row.id), ctx.imd.symbolIndex().catch(() => new Map<string, string | null>()), row.chainId === 1 && tokenOf(row) ? ctx.market.pairsOf(1, [tokenOf(row)!.address]) : Promise.resolve(new Map<string, Pair[]>())]);
      const base = item(row, symbols, pairs);
      const checks = (d?.admissionChecks ?? []).map((c) => ({ name: c.name, status: c.status, detail: c.detail }));
      const out: Record<string, unknown> = {
        service: "imd-feed", runBy: RUN_BY, endpoint: "launch", ...base,
        admission: checks, economics: d?.economics ?? null, poolFee: d?.poolFee ?? null, requester: d?.requester ?? null,
        assurances: (d?.assurances ?? []).map((a) => ({ kind: a.kind, provider: a.provider, url: a.url, revoked: Boolean(a.revokedAt) })),
        jobs: (d?.jobs ?? []).map((j) => ({ id: j.id, state: j.state, explorer: `https://explorer.imd.fun/jobs/${j.id}` })),
        swarmShare: { allocations: Array.isArray(d?.allocations) ? d!.allocations!.length : null, workers: d?.rewardSnapshot?.workers?.length ?? null },
        attestation: d?.attestation ? { verifierVersion: d.attestation.verifierVersion ?? null, toolchain: d.attestation.toolchain ?? null } : null,
        deployFailure: d?.deployFailure ?? null,
      };
      if (sample) return { ...out, sample: { of: 1, note: "A free sample: IMD's record and the market. Holders, the pool's live state and the seats that built it come with the paid call ($0.001)." } };
      if (row.chainId === 1 && base.pool) {
        const s = await slot0(ctx.d.rpc, base.pool.poolId).catch(() => null);
        out.poolState = s ? { tick: s.tick, lpFeeBps: s.lpFee / 100, activeLiquidity: s.liquidity.toString(), source: "eth_getStorageAt on the v4 PoolManager" } : null;
      }
      const t = tokenOf(row);
      if (row.chainId === 1 && t) {
        const supply = await ctx.d.rpc.call({ to: t.address as Address, data: "0x18160ddd" }).catch(() => null);
        const total = supply?.ok && supply.data !== "0x" ? BigInt(supply.data) : 0n;
        const labels: Record<string, string> = {};
        for (const a of row.artifacts ?? []) labels[a.address.toLowerCase()] = `IMD launch ${a.role} (${a.name})`;
        const scan = async () => holdersOf(ctx.d.rpc, { token: t.address as Address, supply: total, deployBlock: t.blockNumber ?? null, head: await ctx.head(), maxChunks: 20, labels });
        // the free nodes sometimes refuse a burst of log reads: once more before giving up
        let failed = "";
        const h = await scan().catch(() => scan()).catch((e: Error) => { failed = String(e?.message ?? e).split(/\r?\n/)[0]!.slice(0, 120); return null; });
        out.holders = h ? { count: h.count, complete: h.complete, fromBlock: h.fromBlock, toBlock: h.toBlock, top: h.top.slice(0, 10), top10Pct: h.top10Pct, top10PctExInfra: h.top10PctExInfra, source: "eth_getLogs Transfer events" } : { error: `holder scan failed: ${failed}` };
      }
      out.builders = d?.jobs?.length ? await buildersOf(ctx.d, d.jobs) : [];
      out.sources = [launchUrl(row), "api.imd.fun/jobs/:id/submissions", "api.dexscreener.com", "Ethereum RPC (eth_getLogs, eth_getStorageAt)"];
      out.generatedAt = new Date(ctx.d.now()).toISOString();
      return out;
    })).v;
  }

  /** Every live IMD launch token on Ethereum with its market, deepest first. */
  async function tokens(q: URLSearchParams, sample: boolean): Promise<FeedPage<LaunchItem>> {
    const all = (await tokensC.get("all", async () => {
      const { list } = await ctx.imd.launches();
      const live = list.filter((l) => l.chainId === 1 && l.status === "live" && tokenOf(l));
      const [symbols, pairs] = await Promise.all([ctx.imd.symbolIndex().catch(() => new Map<string, string | null>()), ctx.market.pairsOf(1, live.map((l) => tokenOf(l)!.address))]);
      return live.map((l) => item(l, symbols, pairs)).sort((a, b) => (b.market?.liquidityUsd ?? -1) - (a.market?.liquidityUsd ?? -1));
    })).v;
    const indexed = q.get("indexed") !== "0";
    const rows = all.filter((x) => !indexed || x.market);
    const limit = Math.min(500, Math.max(1, Number(q.get("limit") ?? 100) || 100));
    const items = rows.slice(0, sample ? SAMPLE : limit);
    return {
      service: "imd-feed", runBy: RUN_BY, endpoint: "tokens", count: items.length, total: rows.length, items, next: { before: null, since: new Date(ctx.d.now()).toISOString() },
      sources: [`${IMD_API}/launches`, "api.dexscreener.com (pairs of every live Ethereum launch token)"], generatedAt: new Date(ctx.d.now()).toISOString(),
      ...(sample ? { sample: { of: rows.length, note: SAMPLE_NOTE } } : {}),
    };
  }

  /** The swarm's health: the IMD Watchtower's status when it answers, IMD's own /swarm and /health always. */
  async function swarm(q: URLSearchParams, sample: boolean): Promise<unknown> {
    const since = toIso(q.get("since"));
    const r = (await swarmC.get("now", async () => {
      const [wt, sw, he] = await Promise.all([
        ctx.d.watchtowerUrl ? ctx.d.net.json<Record<string, unknown>>(ctx.d.watchtowerUrl, 4_000).catch(() => null) : Promise.resolve(null),
        ctx.d.net.json<{ health?: Record<string, unknown>; counts?: Record<string, unknown> }>(`${IMD_API}/swarm`, 12_000).catch(() => null),
        ctx.d.net.json<Record<string, unknown>>(`${IMD_API}/health`, 12_000).catch(() => null),
      ]);
      if (!wt && !sw && !he) throw new ServiceError(503, "Neither the IMD Watchtower nor api.imd.fun answered. Nothing was charged; try again in a minute.");
      return { wt, sw, he, at: ctx.d.now() };
    })).v as { wt: Record<string, unknown> | null; sw: { health?: Record<string, unknown>; counts?: Record<string, unknown> } | null; he: Record<string, unknown> | null; at: number };
    const incidents = ((r.wt?.openIncidents as { openedAt?: string; key?: string; severity?: string; title?: string; detail?: string }[] | undefined) ?? []).filter((i) => !since || (i.openedAt && i.openedAt > since));
    const he = r.he ?? {};
    const out: Record<string, unknown> = {
      service: "imd-feed", runBy: RUN_BY, endpoint: "swarm",
      status: (r.wt?.status as string | undefined) ?? (r.sw?.health?.verifierUp === false || r.sw?.health?.deployerUp === false ? "degraded" : r.sw ? "ok" : "unknown"),
      watchtower: r.wt ? { reachable: true, status: r.wt.status, checkedAt: r.wt.checkedAt ?? null, openIncidents: incidents.length, intake: r.wt.intake ?? null, launches: (r.wt.launches as { counts?: unknown } | undefined)?.counts ?? null } : { reachable: false, note: "The IMD Watchtower did not answer; the health below is IMD's own." },
      swarm: r.sw ? { ...r.sw.health, counts: r.sw.counts ?? null } : null,
      plane: r.he ? { status: he.status ?? null, version: he.version ?? null, connectedDaemons: he.connectedDaemons ?? null, workingNow: he.workingNow ?? null, payments: (he.payments as { enabled?: boolean; orders?: unknown } | undefined) ? { enabled: (he.payments as { enabled?: boolean }).enabled ?? null, orders: (he.payments as { orders?: unknown }).orders ?? null } : null } : null,
      incidents: sample ? incidents.slice(0, SAMPLE) : incidents,
      next: { since: new Date(r.at).toISOString() },
      sources: [...(r.wt ? ["IMD Watchtower /status (github.com/RobertKodes/imd-watchtower)"] : []), `${IMD_API}/swarm`, `${IMD_API}/health`],
      generatedAt: new Date(ctx.d.now()).toISOString(),
    };
    if (sample) out.sample = { of: incidents.length, note: "A free sample: the status and up to 3 open incidents. The paid call ($0.001) adds every incident and the watchtower's samples." };
    else if (r.wt?.samples) out.samples = (r.wt.samples as { at: number }[]).filter((s) => !since || s.at > Date.parse(since)).slice(-60);
    return out;
  }

  /** One seat (IMD agent NFT): its record, standing and work history, paged with `before` and filtered with `since`. */
  async function agent(seat: string, q: URLSearchParams, sample: boolean): Promise<unknown> {
    if (!/^\d{1,6}$/.test(seat)) throw new ServiceError(400, "A seat is its token id: a number.");
    const since = toIso(q.get("since"));
    const before = toIso(q.get("before"));
    const limit = Math.min(200, Math.max(1, Number(q.get("limit") ?? 50) || 50));
    const k = `${seat}:${before ?? ""}:${limit}`;
    const r = (await seats.get(k, async () => {
      const [rec, st] = await Promise.all([
        ctx.d.net.json<Record<string, unknown> & { work?: Record<string, unknown>[] }>(`${IMD_API}/seats/${seat}?work=${limit}&reviews=0&collaborators=0${before ? `&workBefore=${encodeURIComponent(before)}` : ""}`, 15_000).catch((e) => { if ((e as { status?: number }).status === 404) throw new ServiceError(404, "IMD has no record of this seat."); throw e; }),
        ctx.d.net.json<Record<string, unknown>>(`${IMD_API}/seats/${seat}/standing`, 15_000).catch(() => null),
      ]);
      return { rec, st };
    })).v as { rec: Record<string, unknown> & { work?: Record<string, unknown>[] }; st: Record<string, unknown> | null };
    const work = (r.rec.work ?? []).filter((w) => !since || String(w.submittedAt ?? "") > since).map((w) => ({
      jobId: w.jobId, objective: typeof w.objective === "string" ? w.objective.slice(0, 240) : null, jobState: w.jobState ?? null, launch: w.launch ?? null, role: w.role ?? null, step: w.nodeKey ?? null,
      status: w.status ?? null, submittedAt: w.submittedAt ?? null, acceptedAt: w.acceptedAt ?? null, explorer: w.jobId ? `https://explorer.imd.fun/jobs/${w.jobId}` : null,
    }));
    const shown = sample ? work.slice(0, SAMPLE) : work;
    const presence = (r.st?.presence ?? null) as Record<string, unknown> | null;
    return {
      service: "imd-feed", runBy: RUN_BY, endpoint: "agent", seat: Number(seat), agentId: r.rec.agentId ?? null, owner: r.rec.owner ?? null, status: r.rec.status ?? null, online: r.rec.online ?? null,
      runtimes: r.rec.runtimes ?? null, totals: { attempts: r.rec.attempts ?? null, accepted: r.rec.accepted ?? null, rejected: r.rec.rejected ?? null, failed: r.rec.failed ?? null, pending: r.rec.pending ?? null },
      acceptRate: typeof r.rec.attempts === "number" && r.rec.attempts > 0 && typeof r.rec.accepted === "number" ? Math.round((r.rec.accepted / r.rec.attempts) * 1000) / 10 : null,
      standing: presence ? { connected: presence.connected ?? null, acceptingWork: presence.acceptingWork ?? null, lastHeartbeatAt: presence.lastHeartbeatAt ?? null, kinds: presence.kinds ?? null } : null,
      work: shown, count: shown.length,
      next: { before: work.length >= limit ? (work.at(-1)?.submittedAt ?? null) : null, since: work[0]?.submittedAt ?? since ?? new Date(ctx.d.now()).toISOString() },
      sources: [`${IMD_API}/seats/${seat}`, `${IMD_API}/seats/${seat}/standing`], generatedAt: new Date(ctx.d.now()).toISOString(),
      ...(sample ? { sample: { of: work.length, note: SAMPLE_NOTE } } : {}),
    };
  }

  return { launches, launch, tokens, swarm, agent };
}
export type Feed = ReturnType<typeof feed>;
