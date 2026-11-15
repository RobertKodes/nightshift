/**
 * The light half of IMD Launch on Solana: the engine's API, the types, formatting. The heavy half
 * (Meteora's SDK, building and signing transactions) is chain.ts, loaded on demand after Buffer is set.
 */

import type { SwarmPick } from "./options";

export type SolCheck = { key: string; ok: boolean | null; says: string };
export type SwarmStep = { pick: SwarmPick; state: "waiting" | "working" | "done" | "failed" };
export type SwarmRun = {
  picks: SwarmPick[]; chainId: 1 | 4663; body: string; state: "unpaid" | "paid" | "working" | "done" | "refused" | "failed";
  payTx: string | null; payer: string | null; job: string | null; steps: SwarmStep[];
  verdict: { launch: boolean; reason: string } | null; report: string | null; logo: string | null; banner: string | null; site: string | null; note: string | null; paidAt: number | null;
  /** paid in SOL through NIGHTSHIFT Swap (Relay) */
  relay?: RelayPay | null;
  /** NIGHTSHIFT's copies of the swarm's logo and banner, served with the token */
  logoHosted?: string | null; bannerHosted?: string | null;
  doneAt?: Partial<Record<SwarmPick, number>>;
};
export type RelayPay = {
  requestId: string; lamports: string; usd: number | null; seconds: number; quotedAt: number; sentAt: number | null;
  state: "quoted" | "sent" | "done" | "refunded" | "failed"; solTx: string | null; destTx: string | null; note: string | null;
};
/** The SOL deposit NIGHTSHIFT built for the creator to sign: checked and simulated from their wallet. */
export type RelayQuote = { tx: string; requestId: string; lamports: string; quotedLamports: string; usd: number | null; seconds: number; imd: number; chain: string };
/** How long the swarm takes, in minutes [typical, slow], from IMD's own recent jobs. */
export type SwarmEta = { steps: Record<SwarmPick, [number, number]>; start: [number, number]; basis: string };
export type SolStatus = "prepared" | "waiting" | "ready" | "launching" | "live" | "graduated" | "refused" | "failed" | "cancelled";
export type SolLaunch = {
  mint: string; name: string; symbol: string; description: string; website: string; twitter: string; telegram: string; image: string;
  config: string; pool: string | null; creator: string; signature: string | null; createdAt: number; launchedAt: number | null;
  status: SolStatus; note: string | null; quoteReserve: string; priceSol: number | null; mcapSol: number | null; progress: number;
  graduateSol: number | null; options: { feeBps: number; startMcapUsd: number; graduateMcapUsd: number; sniper: string };
  dev: { pct: number; cliffDays: number; vestDays: number } | null; devBuySol: number; logoIdea: string;
  checks: SolCheck[]; change1h: number | null; change24h: number | null; movedAt: number | null;
  swarm: SwarmRun | null; nonce: string | null; uri?: string; spark?: number[];
};
export type SolInfo = {
  network: "mainnet" | "devnet"; open: boolean; partner: string | null; config: string | null; solUsd: number | null;
  shared: { graduateSol: number; createFeeSol: number } | null;
  imd: { on: boolean; price: number; imdUsd: number; chains: Record<"1" | "4663", string>; picks: SwarmPick[]; solPay?: boolean; eta?: SwarmEta };
  counts: { live: number; graduated: number; reviewed: number; swarm: number; waiting: number };
};
export type Prepared = { mint: string; uri: string; image: string; swarm: { body: string; chainId: 1 | 4663; blockers: string[]; plan: string[] } | null };
/** The token's image: the swarm's logo when the creator asked for one (NIGHTSHIFT's copy first), else the creator's. */
export const imageOf = (l: SolLaunch) => {
  const w = l.swarm, swarmLogo = w?.logoHosted || w?.logo || "";
  return (w?.picks.includes("logo") && swarmLogo) || l.image || swarmLogo || "";
};
/** Remember which launches this browser started (to show the creator's buttons and resume a payment). */
export const mine = {
  all: (): string[] => { try { return JSON.parse(localStorage.getItem("ns_sol_mine") ?? "[]") as string[]; } catch { return []; } },
  add: (mint: string) => { try { localStorage.setItem("ns_sol_mine", JSON.stringify([mint, ...mine.all().filter((m) => m !== mint)].slice(0, 30))); } catch { /* private mode */ } },
};
export type Discovered = {
  mint: string; name: string; symbol: string; image: string | null; dex: string; launchpad: string | null;
  priceUsd: number | null; mcapUsd: number | null; liquidityUsd: number | null; vol24: number | null; change1h: number | null; change24h: number | null;
  buys24: number; sells24: number; createdAt: number | null; url: string; boosted: boolean;
};
export type Pulse = { agentsOnline?: number; jobsDoneLastDay?: number; launchesLive?: number; sites?: number; seatsEnrolled?: number };

async function call<T>(path: string, init?: RequestInit & { admin?: string }): Promise<T> {
  const r = await fetch(path, { ...init, headers: { ...(init?.body ? { "Content-Type": "application/json" } : {}), ...(init?.admin ? { "x-admin-token": init.admin } : {}) } });
  const j = await r.json().catch(() => ({})) as T & { error?: string };
  if (!r.ok) throw new Error(j.error ?? `NIGHTSHIFT answered ${r.status}.`);
  return j;
}

export const solApi = {
  info: () => call<SolInfo>("/api/sol/launchpad"),
  list: (sort: "new" | "mcap" | "progress" | "movers") => call<{ launches: SolLaunch[]; waiting: SolLaunch[] }>(`/api/sol/launches?sort=${sort}`),
  one: (mint: string) => call<SolLaunch>(`/api/sol/launches/${mint}`),
  chart: (mint: string) => call<{ points: [number, number][] }>(`/api/sol/launches/${mint}/chart`).then((r) => r.points),
  discover: () => call<{ at: number; items: Discovered[] }>("/api/sol/discover"),
  pulse: () => call<Pulse>("/api/swarm/pulse").catch(() => ({}) as Pulse),
  prepare: (b: Record<string, unknown>) => call<Prepared>("/api/sol/prepare", { method: "POST", body: JSON.stringify(b) }),
  signed: (mint: string, b: { tx: string; config: string; nonce: string | null }) => call<SolLaunch>(`/api/sol/launches/${mint}/signed`, { method: "POST", body: JSON.stringify(b) }),
  paid: (mint: string, chainId: number, tx: string) => call<SolLaunch>(`/api/sol/launches/${mint}/paid`, { method: "POST", body: JSON.stringify({ chainId, tx }) }),
  relayQuote: (mint: string) => call<RelayQuote>(`/api/sol/launches/${mint}/relay`, { method: "POST", body: JSON.stringify({ action: "quote" }) }),
  relaySent: (mint: string, signature: string) => call<SolLaunch>(`/api/sol/launches/${mint}/relay`, { method: "POST", body: JSON.stringify({ action: "sent", signature }) }),
  relayCheck: (mint: string) => call<SolLaunch>(`/api/sol/launches/${mint}/relay`, { method: "POST", body: JSON.stringify({ action: "check" }) }),
  nonces: (owner: string) => call<{ nonces: { account: string; lamports: number }[] }>(`/api/sol/nonces/${owner}`).then((r) => r.nonces),
  swarmPrice: () => call<{ price: { lamports: string; usd: number | null; seconds: number } | null }>("/api/sol/swarm/price").then((r) => r.price).catch(() => null),
  act: (mint: string, action: "release" | "cancel", signature: string) => call<SolLaunch>(`/api/sol/launches/${mint}/act`, { method: "POST", body: JSON.stringify({ action, signature }) }),
  adminState: (admin: string) => call<{ network: string; config: string | null; partner: string | null; mintsReady: number; pending: SolLaunch[]; info: SolInfo }>("/api/sol/admin/state", { admin }),
  adminPartner: (admin: string, partner: string) => call<{ ok: true }>("/api/sol/admin/partner", { method: "POST", admin, body: JSON.stringify({ partner }) }),
  adminConfig: (admin: string, config: string, partner: string) => call<{ ok: true }>("/api/sol/admin/config", { method: "POST", admin, body: JSON.stringify({ config, partner }) }),
  adminLaunch: (admin: string, mint: string, action: "release" | "cancel") => call<SolLaunch>("/api/sol/admin/launch", { method: "POST", admin, body: JSON.stringify({ mint, action }) }),
  fees: () => call<SolFeesInfo>("/api/sol/fees"),
  adminFees: (admin: string) => call<SolFeesAdmin>("/api/sol/admin/fees", { admin }),
  adminFeesSet: (admin: string, b: { adam?: string; dev?: string; on?: boolean; partner?: true }) => call<SolFeesAdmin>("/api/sol/admin/fees", { method: "POST", admin, body: JSON.stringify(b) }),
  adminFeesRun: (admin: string) => call<{ ran: boolean; why?: string; info: SolFeesAdmin }>("/api/sol/admin/fees/run", { method: "POST", admin }),
  adminNetwork: (admin: string, network: "mainnet" | "devnet") => call<{ ok: true }>("/api/sol/admin/network", { method: "POST", admin, body: JSON.stringify({ network }) }),
};

/** NIGHTSHIFT's partner fees on the Solana launchpad: the fixed split and the burns, with their transactions. */
export type SolFeesInfo = {
  wallet: string; running: boolean; lastRun: number | null;
  split: { key: string; label: string; pct: number }[];
  totals: { claimedSol: number; adamSol: number; devSol: number; imdBurnSol: number; shiftBurnSol: number; imdBurned: number; shiftBurned: number };
  waitingSol: { imd: number; shift: number };
  burns: { at: number; token: "IMD" | "SHIFT"; sol: number; amount: number | null; state: "sent" | "done" | "refunded"; solTx: string; ethTx: string | null; to: string }[];
};
export type SolFeesAdmin = SolFeesInfo & {
  balanceSol: number | null; blocked: string | null; settings: { on: boolean; adam: string | null; dev: string | null }; lastError: string | null; owedSol: Record<string, number>;
  pays: { at: number; to: "adam" | "dev"; lamports: string; tx: string }[];
  limits: { reserveSol: number; minBurnSol: number; maxBurnSol: number };
};

/** The words a creator's wallet signs to act on a waiting launch (the engine checks the same text). */
export const actText = (action: "release" | "cancel", mint: string) => `NIGHTSHIFT: ${action === "release" ? "launch without the swarm's work" : "cancel the launch"} ${mint}`;

/** Meteora's SDK and Anchor expect Node's Buffer: set it, then load the heavy half. */
export async function loadChain() {
  const g = globalThis as unknown as { Buffer?: unknown; process?: { env: Record<string, string> } };
  if (!g.Buffer) g.Buffer = (await import("buffer")).Buffer;
  if (!g.process) g.process = { env: {} };
  return import("./chain");
}

/** Dollars, the way a launchpad shows them: $52.9K, $1.20M, $0.0000529. */
export const usd = (v: number | null | undefined) => {
  if (v == null || !Number.isFinite(v)) return "—";
  const a = Math.abs(v);
  return a >= 1e9 ? `$${(v / 1e9).toFixed(2)}B` : a >= 1e6 ? `$${(v / 1e6).toFixed(2)}M` : a >= 1e3 ? `$${(v / 1e3).toFixed(1)}K` : a >= 1 ? `$${v.toFixed(2)}` : a > 0 ? `$${v.toPrecision(3)}` : "$0";
};
export const usdOf = (sol: number | null | undefined, solUsd: number | null) => (sol == null || !solUsd ? "—" : usd(sol * solUsd));
export const sol = (n: number | null | undefined, d = 3) => (n == null || !Number.isFinite(n) ? "—" : n.toLocaleString("en-US", { maximumFractionDigits: n >= 1000 ? 0 : d }));
export const pct = (n: number | null | undefined) => (n == null || !Number.isFinite(n) ? "—" : `${n >= 0 ? "+" : ""}${n.toFixed(Math.abs(n) >= 100 ? 0 : 1)}%`);
export const shortKey = (k: string) => `${k.slice(0, 4)}…${k.slice(-4)}`;
export const solscan = (kind: "token" | "tx" | "account", k: string, net: string) => `https://solscan.io/${kind}/${k}${net === "devnet" ? "?cluster=devnet" : ""}`;
export const ago = (t: number | null | undefined) => {
  if (!t) return "—";
  const s = Math.max(0, (Date.now() - t) / 1000);
  return s < 60 ? `${Math.round(s)}s ago` : s < 3600 ? `${Math.round(s / 60)}m ago` : s < 86400 ? `${Math.round(s / 3600)}h ago` : `${Math.round(s / 86400)}d ago`;
};

/** The admin token /setup keeps for this tab. */
export const adminToken = () => { try { return sessionStorage.getItem("ns_admin") ?? ""; } catch { return ""; } };

/** A logo as a 256 px webp data URL (the engine stores up to 160 KB), from any image the browser opens. */
export async function logoData(file: File): Promise<string> {
  if (!/^image\/(png|jpe?g|webp|gif)$/.test(file.type)) throw new Error("Use a png, jpg, webp or gif image.");
  if (file.size > 8_000_000) throw new Error("That image is over 8 MB.");
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise<HTMLImageElement>((ok, bad) => { const i = new Image(); i.onload = () => ok(i); i.onerror = () => bad(new Error("That image could not be opened.")); i.src = url; });
    const c = document.createElement("canvas");
    c.width = 256; c.height = 256;
    const x = c.getContext("2d")!;
    const s = Math.min(img.width, img.height);
    x.drawImage(img, (img.width - s) / 2, (img.height - s) / 2, s, s, 0, 0, 256, 256);
    let q = 0.9, out = c.toDataURL("image/webp", q);
    while (out.length > 200_000 && q > 0.4) { q -= 0.15; out = c.toDataURL("image/webp", q); }
    if (!out.startsWith("data:image/webp")) out = c.toDataURL("image/png");
    return out;
  } finally { URL.revokeObjectURL(url); }
}
