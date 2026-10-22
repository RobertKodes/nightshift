import type { IncomingMessage, ServerResponse } from "node:http";
import { LAUNCH_ACTION, LAUNCH_CHAINS, LAUNCHPAD_MARK, type LaunchChainId, formProblems, isLaunchChain, launchBody, readForm } from "@nightshift/launch";
import { encodeAbiParameters, keccak256 } from "viem";
import { type DexPair, dexQuotes } from "./imdmarket.js";
import { TtlCache } from "./services/cache.js";
import { IMD_API, type LaunchDetail, type LaunchRow, imdReader, tokenOf } from "./services/imd.js";
import { type Net, type Rpc, liveNet } from "./services/net.js";

/**
 * The NIGHTSHIFT Launchpad's server side (docs/launchpad/DESIGN.md, "Built today"): the board of coins
 * launched on IMD (api.imd.fun/launches, priced by DexScreener), one launch followed from its payment to
 * its live pool, IMD's free check of a launch built from the form, and a price chart (GeckoTerminal).
 * It reads public data only and holds nothing: the creator pays IMD from their own wallet in the page.
 */

export type ChainKey = "eth" | "rh";
const CHAIN_KEY: Record<LaunchChainId, ChainKey> = { 1: "eth", 4663: "rh" };
/** IMD launch kinds that come with a token and a pool. */
const COIN_KINDS = new Set(["custom_token", "univ4_hook", "evm_project"]);
/** How many launch records one board build may read from IMD (its public reads allow 120 a minute). */
const DETAIL_BUDGET = 24;
const UNPRICED_SHOWN = 60;
const GECKO = "https://api.geckoterminal.com/api/v2";

export type Market = { priceUsd: number; mcapUsd: number | null; liquidityUsd: number; volume24: number; change1h: number; change24h: number; buys24: number; sells24: number; quote: string; pair: string; url: string; image: string | null };
export type BoardRow = {
  launchNumber: number; id: string; kind: string; chainId: LaunchChainId; chain: ChainKey; token: string;
  name: string; symbol: string | null; createdAt: string; logo: string | null; ours: boolean; market: Market | null;
};
export type Building = { launchNumber: number; id: string; chainId: number; kind: string; name: string | null; symbol: string | null; createdAt: string; ours: boolean };
export type Board = {
  at: number; sources: string[];
  totals: { live: number; priced: number; eth: number; rh: number; building: number; shown: number };
  /** ETH and IMD in USD, read off the same DexScreener pairs (price in USD over price in the quote currency). */
  usd: { eth: number | null; imd: number | null };
  rows: BoardRow[]; building: Building[];
};
export type Stage = "paid" | "refused" | "building" | "needs_input" | "failed" | "deploying" | "live" | "parked";
export type Coin = { name: string | null; symbol: string | null; supply: string | null; about: string | null; links: { website?: string; x?: string; telegram?: string } };
export type PoolKey = { currency0: string; currency1: string; fee: number; tickSpacing: number; hooks: string };
export type LaunchView = {
  ref: string; stage: Stage; stageText: string;
  payment: { chainId: number; tx: string; payer: string | null; state: string | null; reason: string | null } | null;
  job: { id: string; state: string; blockedReason: string | null; steps: { key: string; label: string; state: string }[] } | null;
  launch: {
    id: string; launchNumber: number; kind: string; status: string; chainId: number; chain: ChainKey | null; createdAt: string; parkedReason: string | null; repo: string | null;
    token: string | null; contracts: { role: string; name: string; address: string }[]; checks: { name: string; status: string; detail: string }[];
    economics: { poolPct: number | null; creatorPct: number | null; swarmPct: number; cap: string | null; pairedWith: string } | null;
    requester: string | null; poolFeeBps: number | null; pool: (PoolKey & { poolId: string }) | null; logo: string | null; ours: boolean;
  } | null;
  coin: Coin | null; market: Market | null;
  links: { imd: string | null; job: string | null; explorer: string | null; dexscreener: string | null; chain: string | null };
};

type Intake = { entries?: { action?: string; state?: string; reason?: string | null; detail?: string | null; payer?: string; admission?: { result?: { jobId?: string } } | null }[] };
type JobNode = { key: string; state: string };
type Job = { id?: string; state?: string; blockedReason?: string | null; objective?: string; nodes?: JobNode[]; launch?: { id?: string | null; status?: string | null; kind?: string; chainId?: number } | null };
type Caps = { launches?: { chains?: { chainId: number; name: string; kinds: string[]; pairings: { pairWith: string; symbol: string; customCap?: { min: string; max: string } }[] }[] } };

/** A Uniswap v4 pool id: keccak256 of the abi-encoded pool key. DexScreener and GeckoTerminal name v4 pools by it. */
export const poolIdOf = (k: PoolKey) => keccak256(encodeAbiParameters(
  [{ type: "address" }, { type: "address" }, { type: "uint24" }, { type: "int24" }, { type: "address" }],
  [k.currency0 as `0x${string}`, k.currency1 as `0x${string}`, k.fee, k.tickSpacing, k.hooks as `0x${string}`]));

const https = (s: string | undefined) => { if (!s) return undefined; try { const u = new URL(s.trim()); return u.protocol === "https:" ? u.toString() : undefined; } catch { return undefined; } };
const clip = (s: string | null | undefined, n: number) => (s ? s.trim().slice(0, n) : null);

/** What the creator wrote, read back from the job's objective: the explorer's lines first, then the looser forms other launches use. */
export function coinOf(objective: string | undefined): Coin {
  const o = objective ?? "";
  // a line that runs on into the next label ("Token name: INK. Token symbol: INK.") stops at it
  const line = (label: string) => o.split("\n").find((l) => l.startsWith(`${label}: `))?.slice(label.length + 2).split(/\.\s+(?=[A-Z][\w ]{0,20}:)/)[0]?.trim();
  const inline = (label: string) => o.match(new RegExp(`${label}:\\s*([^\\n]+?)\\.(?:\\s|$)`))?.[1]?.trim();
  const head = o.match(/^A custom token: (.+) \(([A-Z0-9]{2,11})\)\./);
  const name = line("Token name") ?? head?.[1] ?? inline("Token name") ?? o.match(/^Launch ([^(\n]{1,40}) \(\$?([A-Z0-9]{2,11})\)/)?.[1] ?? null;
  const symbol = line("Token symbol") ?? head?.[2] ?? inline("Token symbol") ?? o.match(/^Launch [^(\n]{1,40} \(\$?([A-Z0-9]{2,11})\)/)?.[1] ?? null;
  const supply = line("Token supply")?.match(/^([\d,]+)/)?.[1] ?? null;
  return {
    name: clip(name, 40), symbol: symbol && /^[A-Z0-9]{2,11}$/.test(symbol) ? symbol : null, supply, about: clip(line("What it does"), 280),
    links: Object.fromEntries(([["website", line("Website")], ["x", line("X")], ["telegram", line("Telegram")]] as const).map(([k, v]) => [k, https(v)]).filter(([, v]) => v)) as Coin["links"],
  };
}

const STEP_LABEL: Record<string, string> = {
  build_contract_project: "Build and test the contracts", write_foundry_tests: "Tests by a second agent", manifest: "Write what to deploy",
  audit_math: "Audit: the math", audit_permissions: "Audit: the permissions", audit_economics: "Audit: the economics", audit_flow: "Audit: the control flow", audit_judge: "Audit judge: reproduce and rank",
};
const STEP_ORDER = Object.keys(STEP_LABEL);
export const stepsOf = (nodes: JobNode[] = []) => [...nodes]
  .sort((a, b) => (STEP_ORDER.indexOf(a.key) + 1 || 99) - (STEP_ORDER.indexOf(b.key) + 1 || 99))
  .map((n) => ({ key: n.key, label: STEP_LABEL[n.key] ?? n.key.replace(/_/g, " "), state: n.state }));

const market = (p: DexPair | undefined): Market | null => {
  const price = Number(p?.priceUsd ?? 0);
  if (!p || !(price > 0)) return null;
  return {
    priceUsd: price, mcapUsd: p.marketCap ?? p.fdv ?? null, liquidityUsd: p.liquidity?.usd ?? 0, volume24: p.volume?.h24 ?? 0,
    change1h: p.priceChange?.h1 ?? 0, change24h: p.priceChange?.h24 ?? 0, buys24: p.txns?.h24?.buys ?? 0, sells24: p.txns?.h24?.sells ?? 0,
    quote: p.quoteToken.symbol, pair: p.pairAddress, url: p.url, image: https(p.info?.imageUrl) ?? null,
  };
};
/** The quote currency's USD price, as the median over the pairs quoted in it (null without a liquid one). */
export function quoteUsd(pairs: DexPair[], symbols: string[]): number | null {
  const xs = pairs.filter((p) => symbols.includes(p.quoteToken.symbol) && (p.liquidity?.usd ?? 0) >= 2_000 && Number(p.priceNative) > 0 && Number(p.priceUsd) > 0)
    .map((p) => Number(p.priceUsd) / Number(p.priceNative)).sort((a, b) => a - b);
  return xs.length ? xs[Math.floor(xs.length / 2)]! : null;
}
const logoOf = (d: LaunchDetail | undefined) => {
  const l = d?.logo as { state?: string; hash?: string; cleared?: unknown } | null | undefined;
  return l?.state === "completed" && l.hash && /^[0-9a-f]{64}$/.test(l.hash) && !l.cleared ? `${IMD_API}/artifacts/${l.hash}` : null;
};
const oursOf = (d: LaunchDetail | undefined) => Boolean(d?.jobs?.some((j) => j.objective?.includes(LAUNCHPAD_MARK)));

export type LaunchpadDeps = { net: Net; post: (url: string, body: unknown) => Promise<unknown>; now: () => number };
const NO_RPC = {} as Rpc; // the launch list and records are HTTP only

export function launchpadService(d: LaunchpadDeps) {
  const imd = imdReader({ net: d.net, rpc: NO_RPC, now: d.now, etherscanKey: "", watchtowerUrl: "" });
  const pairs = new TtlCache<Map<string, DexPair>>(3 * 60_000, 50, d.now);
  const details = new TtlCache<LaunchDetail>(6 * 3_600_000, 3_000, d.now);
  const boards = new TtlCache<Board>(2 * 60_000, 1, d.now);
  const charts = new TtlCache<{ t: number; o: number; h: number; l: number; c: number; v: number }[]>(10 * 60_000, 300, d.now);
  const caps = new TtlCache<Caps>(30 * 60_000, 1, d.now);
  const fetchJson = <T,>(u: string) => d.net.json<T>(u, 15_000);

  /** A launch's record: kept 6 hours once it is live (its coin, logo and pool no longer change), 2 minutes before. */
  async function detail(id: string): Promise<LaunchDetail | null> {
    const kept = details.peek(id);
    if (kept && (kept.v.status === "live" || d.now() - kept.at < 2 * 60_000)) return kept.v;
    const v = await d.net.json<LaunchDetail>(`${IMD_API}/launches/${id}`, 15_000).catch(() => null);
    if (v) details.set(id, v);
    return v ?? kept?.v ?? null;
  }
  async function dex(chainId: LaunchChainId, addresses: string[]): Promise<Map<string, DexPair>> {
    const key = `${chainId}:${addresses.slice().sort().join(",")}`;
    return (await pairs.get(key, () => dexQuotes(addresses, fetchJson, LAUNCH_CHAINS[chainId].dex))).v;
  }

  async function buildBoard(): Promise<Board> {
    const list = (await imd.launches()).list;
    const coins = list.filter((l): l is LaunchRow & { chainId: LaunchChainId } => isLaunchChain(l.chainId) && l.status === "live" && COIN_KINDS.has(l.kind) && Boolean(tokenOf(l)));
    const priced = new Map<string, DexPair>();
    for (const c of [1, 4663] as const) {
      const got = await dex(c, coins.filter((l) => l.chainId === c).map((l) => tokenOf(l)!.address.toLowerCase())).catch(() => new Map<string, DexPair>());
      for (const [a, p] of got) priced.set(`${c}:${a}`, p);
    }
    const key = (l: LaunchRow) => `${l.chainId}:${tokenOf(l)!.address.toLowerCase()}`;
    const withPrice = coins.filter((l) => priced.has(key(l)));
    const newest = coins.filter((l) => !priced.has(key(l))).sort((a, b) => b.launchNumber - a.launchNumber).slice(0, UNPRICED_SHOWN);
    const building = list.filter((l) => l.status === "admitted" && COIN_KINDS.has(l.kind) && isLaunchChain(l.chainId)).sort((a, b) => b.launchNumber - a.launchNumber).slice(0, 8);
    // the records the board needs (logo, the creator's words), a few per build, newest first; the rest fill in on the next builds
    const want = [...withPrice, ...building, ...newest].filter((l) => { const k = details.peek(l.id); return !k || (k.v.status !== "live" && d.now() - k.at > 2 * 60_000); });
    const batch = want.slice(0, DETAIL_BUDGET);
    for (let i = 0; i < batch.length; i += 6) await Promise.all(batch.slice(i, i + 6).map((l) => detail(l.id)));
    const rows: BoardRow[] = [...withPrice, ...newest].map((l) => {
      const p = priced.get(key(l)), rec = details.peek(l.id)?.v, coin = coinOf(rec?.jobs?.[0]?.objective);
      return {
        launchNumber: l.launchNumber, id: l.id, kind: l.kind, chainId: l.chainId, chain: CHAIN_KEY[l.chainId], token: tokenOf(l)!.address.toLowerCase(),
        name: clip(p?.baseToken.name, 40) ?? coin.name ?? tokenOf(l)!.name, symbol: clip(p?.baseToken.symbol, 16) ?? coin.symbol,
        createdAt: l.createdAt, logo: logoOf(rec) ?? market(p)?.image ?? null, ours: oursOf(rec), market: market(p),
      };
    });
    return {
      at: d.now(), sources: ["api.imd.fun/launches", "api.dexscreener.com"],
      totals: { live: coins.length, priced: withPrice.length, eth: coins.filter((l) => l.chainId === 1).length, rh: coins.filter((l) => l.chainId === 4663).length, building: building.length, shown: rows.length },
      usd: { eth: quoteUsd([...priced.values()], ["ETH", "WETH"]), imd: quoteUsd([...priced.values()], ["IMD"]) },
      rows,
      building: building.map((l) => { const rec = details.peek(l.id)?.v, c = coinOf(rec?.jobs?.[0]?.objective); return { launchNumber: l.launchNumber, id: l.id, chainId: l.chainId, kind: l.kind, name: c.name, symbol: c.symbol, createdAt: l.createdAt, ours: oursOf(rec) }; }),
    };
  }

  /** The board, rebuilt at most every 2 minutes. */
  async function board(): Promise<Board> { return (await boards.get("board", buildBoard)).v; }

  /** One launch, from a payment (`tx-<chain>-<hash>`), a launch number, a launch id or a token (`eth-0x…`), to its live pool. */
  async function launch(ref: string): Promise<{ status: number; body: LaunchView | { error: string } }> {
    const r = ref.trim().toLowerCase();
    let payment: LaunchView["payment"] = null, job: Job | null = null, rec: LaunchDetail | null = null;
    const tx = r.match(/^tx-(1|4663)-(0x[0-9a-f]{64})$/), tok = r.match(/^(eth|rh)-(0x[0-9a-f]{40})$/);
    if (tx) {
      const chainId = Number(tx[1]);
      const intake = await d.net.json<Intake>(`${IMD_API}/intake/${chainId}/${tx[2]}`, 12_000).catch(() => null);
      const e = intake?.entries?.[0];
      payment = { chainId, tx: tx[2]!, payer: e?.payer ?? null, state: e?.state ?? null, reason: e?.reason ?? e?.detail ?? null };
      if (e && e.action && e.action !== LAUNCH_ACTION) return { status: 400, body: { error: `That payment is for ${e.action}, not a launch.` } };
      const jobId = e?.admission?.result?.jobId;
      if (jobId && /^[0-9a-f-]{36}$/.test(jobId)) job = await d.net.json<Job>(`${IMD_API}/jobs/${jobId}`, 12_000).catch(() => ({ id: jobId }));
    } else if (/^\d{1,7}$/.test(r) || /^[0-9a-f-]{36}$/.test(r)) {
      const id = /^\d+$/.test(r) ? (await imd.launches()).list.find((l) => l.launchNumber === Number(r))?.id : r;
      if (!id) return { status: 404, body: { error: "IMD has no launch with that number yet." } };
      rec = await detail(id);
      if (!rec) return { status: 404, body: { error: "IMD does not know that launch." } };
    } else if (tok) {
      const hit = await imd.launchOf(tok[1] === "eth" ? 1 : 4663, tok[2]!);
      if (!hit) return { status: 404, body: { error: "No IMD launch has that token." } };
      rec = await detail(hit.launch.id);
    } else return { status: 400, body: { error: "Unknown launch reference." } };

    const launchId = rec?.id ?? job?.launch?.id ?? null;
    if (!rec && launchId && /^[0-9a-f-]{36}$/.test(launchId)) rec = await detail(launchId);
    if (!job && rec?.jobs?.[0]?.id) job = await d.net.json<Job>(`${IMD_API}/jobs/${rec.jobs[0].id}`, 12_000).catch(() => null);
    const objective = job?.objective ?? rec?.jobs?.[0]?.objective;
    const coin = objective ? coinOf(objective) : null;

    const chainId = (rec?.chainId ?? job?.launch?.chainId ?? 0) as number;
    const token = rec ? tokenOf(rec)?.address?.toLowerCase() ?? null : null;
    const seeded = rec?.seeded?.pools?.[0];
    const pool = seeded ? { ...seeded, currency0: seeded.currency0.toLowerCase(), currency1: seeded.currency1.toLowerCase(), hooks: seeded.hooks.toLowerCase(), poolId: poolIdOf(seeded) } : null;
    const live = rec?.status === "live";
    const m = live && token && isLaunchChain(chainId) ? market((await dex(chainId, [token]).catch(() => new Map<string, DexPair>())).get(token)) : null;

    const jobState = String(job?.state ?? "").toLowerCase();
    let stage: Stage, stageText: string;
    if (live) { stage = "live"; stageText = "Live: its pool is open on Uniswap v4."; }
    else if (rec?.status === "parked") { stage = "parked"; stageText = `IMD parked this launch: ${rec.parkedReason ?? "no reason given"}.`; }
    else if (payment && !job && payment.state && /refus|reject|fail/.test(payment.state)) { stage = "refused"; stageText = `IMD refused the request: ${payment.reason ?? payment.state}. A refused body is a spent payment.`; }
    else if (!job) { stage = "paid"; stageText = payment?.state ? "Paid. IMD is admitting the request." : "Paid. Waiting for IMD to read the payment (usually under a minute)."; }
    else if (jobState === "blocked") { stage = "needs_input"; stageText = "The swarm stopped and asks for input."; }
    else if (["failed", "cancelled", "canceled", "rejected"].includes(jobState)) { stage = "failed"; stageText = `The job ended as ${jobState}.`; }
    else if (["completed", "done", "complete"].includes(jobState)) { stage = "deploying"; stageText = "Built and audited. IMD is deploying it with its pool."; }
    else { stage = "building"; stageText = "The swarm is building, testing and auditing it."; }

    const ck = isLaunchChain(chainId) ? CHAIN_KEY[chainId] : null;
    const econ = rec?.economics as { poolBps?: number; initialMarketCapWei?: string; remainderTo?: string } | undefined;
    const pairCur = pool ? [pool.currency0, pool.currency1].find((c) => c !== token) : undefined;
    const pairedWith = !pairCur ? "?" : pairCur === "0x0000000000000000000000000000000000000000" ? "ETH" : isLaunchChain(chainId) && pairCur === LAUNCH_CHAINS[chainId].imd ? "IMD" : pairCur;
    const view: LaunchView = {
      ref: r, stage, stageText, payment,
      job: job?.id ? { id: job.id, state: jobState || "admitted", blockedReason: clip(job.blockedReason, 600), steps: stepsOf(job.nodes) } : null,
      launch: rec ? {
        id: rec.id, launchNumber: rec.launchNumber, kind: rec.kind, status: rec.status, chainId: rec.chainId, chain: ck, createdAt: rec.createdAt, parkedReason: rec.parkedReason ?? null, repo: https(rec.sourceRepoUrl ?? undefined) ?? null,
        token, contracts: (rec.artifacts ?? []).map((a) => ({ role: a.role, name: a.name, address: a.address.toLowerCase() })),
        checks: (rec.admissionChecks ?? []).map((c) => ({ name: c.name, status: c.status, detail: c.detail.slice(0, 300) })),
        economics: econ?.poolBps ? { poolPct: econ.poolBps / 100, creatorPct: Math.max(0, 90 - econ.poolBps / 100), swarmPct: 10, cap: econ.initialMarketCapWei ?? null, pairedWith } : null,
        requester: rec.requester ?? null, poolFeeBps: rec.poolFee ? rec.poolFee / 100 : null, pool, logo: logoOf(rec), ours: oursOf(rec),
      } : null,
      coin, market: m,
      links: {
        imd: rec ? `${IMD_API}/launches/${rec.id}` : null, job: job?.id ? `https://explorer.imd.fun/jobs/${job.id}` : null,
        explorer: token ? `https://explorer.imd.fun/token/${token}` : null, dexscreener: m?.url ?? null,
        chain: token && isLaunchChain(chainId) ? `${LAUNCH_CHAINS[chainId].explorer}/token/${token}` : null,
      },
    };
    return { status: 200, body: view };
  }

  /** IMD's free check of the launch the form builds: the body is built here from the same code the page signs with. */
  async function check(x: unknown): Promise<{ status: number; body: unknown }> {
    const f = readForm(x);
    if (!f) return { status: 400, body: { error: "Send the launch form: chainId 1 or 4663, pairWith eth or imd, and its fields." } };
    const problems = formProblems(f);
    if (problems.length) return { status: 400, body: { error: problems[0]!.text, problems } };
    const body = launchBody(f);
    const res = await d.post(`${IMD_API}/requests/check`, { action: LAUNCH_ACTION, input: body }) as { blockers?: unknown[]; plan?: unknown[]; suggestions?: unknown[]; facts?: unknown[]; error?: unknown };
    return { status: 200, body: { body, check: { blockers: res?.blockers ?? null, suggestions: res?.suggestions ?? [], plan: res?.plan ?? [], facts: res?.facts ?? [], error: res?.error ?? null } } };
  }

  /** Hourly candles of a pool for the last 7 days (GeckoTerminal names v4 pools by pool id). */
  async function chart(chainId: number, pool: string): Promise<{ status: number; body: unknown }> {
    if (!isLaunchChain(chainId) || !/^0x([0-9a-f]{40}|[0-9a-f]{64})$/.test(pool)) return { status: 400, body: { error: "chain 1 or 4663 and a pool id" } };
    const net = LAUNCH_CHAINS[chainId].gecko;
    try {
      const r = await charts.get(`${chainId}:${pool}`, async () => {
        const g = await d.net.json<{ data?: { attributes?: { ohlcv_list?: number[][] } } }>(`${GECKO}/networks/${net}/pools/${pool}/ohlcv/hour?limit=168&currency=usd`, 12_000);
        return (g.data?.attributes?.ohlcv_list ?? []).map(([t, o, h, l, c, v]) => ({ t: t! * 1000, o: o!, h: h!, l: l!, c: c!, v: v! })).sort((a, b) => a.t - b.t);
      });
      return { status: 200, body: { at: r.at, source: "api.geckoterminal.com", candles: r.v } };
    } catch (e) {
      return { status: 200, body: { at: d.now(), source: "api.geckoterminal.com", candles: [], error: `No chart right now (${String((e as Error).message).slice(0, 80)}).` } };
    }
  }

  /** Which chains IMD opens to a launch right now (Base included the day it opens), read live every 30 minutes. */
  async function chains(): Promise<{ status: number; body: unknown }> {
    const c = await caps.get("caps", () => d.net.json<Caps>(`${IMD_API}/requests/capabilities`, 12_000)).catch(() => null);
    const open = (c?.v.launches?.chains ?? []).map((x) => ({ chainId: x.chainId, name: x.name, kinds: x.kinds, pairings: x.pairings.map((p) => ({ pairWith: p.pairWith, symbol: p.symbol, min: p.customCap?.min ?? null, max: p.customCap?.max ?? null })) }));
    return { status: 200, body: { at: c?.at ?? d.now(), source: "api.imd.fun/requests/capabilities", open, baseOpen: open.some((x) => x.chainId === 8453), here: Object.keys(LAUNCH_CHAINS).map(Number) } };
  }

  return { board, launch, check, chart, chains };
}

let live: ReturnType<typeof launchpadService> | null = null;
const service = () => (live ??= launchpadService({
  net: liveNet,
  post: async (url, body) => { const r = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body), signal: AbortSignal.timeout(90_000) }); return r.json(); },
  now: Date.now,
}));

type Context = {
  json(res: ServerResponse, status: number, body: unknown): void;
  body(req: IncomingMessage, max?: number): Promise<Record<string, unknown>>;
  limited(req: IncomingMessage, key: string, n: number, ms: number): boolean;
  url: URL;
};

/** /api/launchpad/*: board, launch, check, chart, chains. */
export async function launchpadRoutes(req: IncomingMessage, res: ServerResponse, p: string, ctx: Context, svc = service()): Promise<boolean> {
  const { json, limited, url } = ctx;
  const slow = () => json(res, 429, { error: "Slow down a little: too many launchpad requests from here." });
  const send = (r: { status: number; body: unknown }) => json(res, r.status, r.body);
  try {
    if (p === "/api/launchpad/board" && req.method === "GET") {
      if (limited(req, "lp-board", 60, 60_000)) return slow(), true;
      json(res, 200, await svc.board());
      return true;
    }
    if (p === "/api/launchpad/launch" && req.method === "GET") {
      if (limited(req, "lp-launch", 90, 60_000)) return slow(), true;
      send(await svc.launch(url.searchParams.get("ref") ?? ""));
      return true;
    }
    if (p === "/api/launchpad/check" && req.method === "POST") {
      if (limited(req, "lp-check", 10, 60_000)) return slow(), true;
      const b = await ctx.body(req, 6_000).catch(() => null);
      if (!b) return json(res, 400, { error: "Send the form as a small JSON body." }), true;
      send(await svc.check(b));
      return true;
    }
    if (p === "/api/launchpad/chart" && req.method === "GET") {
      if (limited(req, "lp-chart", 60, 60_000)) return slow(), true;
      send(await svc.chart(Number(url.searchParams.get("chain")), (url.searchParams.get("pool") ?? "").toLowerCase()));
      return true;
    }
    if (p === "/api/launchpad/chains" && req.method === "GET") {
      if (limited(req, "lp-chains", 60, 60_000)) return slow(), true;
      send(await svc.chains());
      return true;
    }
  } catch (e) {
    json(res, 502, { error: `IMD or the price source did not answer: ${String((e as Error).message ?? e).slice(0, 160)}` });
    return true;
  }
  return false;
}
