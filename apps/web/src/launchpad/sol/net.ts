/**
 * The light half of IMD Launch on Solana: the engine's API, the types, formatting. The heavy half
 * (Meteora's SDK, building and signing transactions) is chain.ts, loaded on demand after Buffer is set.
 */

export type SolCheck = { key: string; ok: boolean | null; says: string };
export type SwarmWork = { ref: string; state: "queued" | "running" | "done" | "failed" | "off"; job: string | null; url: string | null; note?: string };
export type SolLaunch = {
  mint: string; name: string; symbol: string; description: string; website: string; twitter: string; telegram: string; image: string;
  config: string; pool: string | null; creator: string | null; signature: string | null; createdAt: number; source: "nightshift" | "elsewhere";
  status: "pending" | "live" | "graduated"; quoteReserve: string; priceSol: number | null; mcapSol: number | null; progress: number;
  graduateSol: number | null; options: { feeBps: number; startMcapUsd: number; graduateMcapUsd: number; sniper: string } | null;
  dev: { pct: number; cliffDays: number; vestDays: number } | null;
  checks: SolCheck[]; change1h: number | null; change24h: number | null; movedAt: number | null;
  review: SwarmWork | null; kit: (SwarmWork & { paidSol: number }) | null; spark?: number[];
};
export type SolInfo = {
  network: "mainnet" | "devnet"; open: boolean; partner: string | null; config: string | null; solUsd: number | null;
  shared: { graduateSol: number; createFeeSol: number } | null;
  imd: { review: boolean; kit: boolean; kitUsd: number; kitLamports: string | null };
  counts: { live: number; graduated: number; reviewed: number };
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
  list: (sort: "new" | "mcap" | "progress" | "movers") => call<{ launches: SolLaunch[] }>(`/api/sol/launches?sort=${sort}`).then((r) => r.launches),
  one: (mint: string) => call<SolLaunch>(`/api/sol/launches/${mint}`),
  chart: (mint: string) => call<{ points: [number, number][] }>(`/api/sol/launches/${mint}/chart`).then((r) => r.points),
  discover: () => call<{ at: number; items: Discovered[] }>("/api/sol/discover"),
  pulse: () => call<Pulse>("/api/swarm/pulse").catch(() => ({}) as Pulse),
  saveMeta: (b: Record<string, unknown>) => call<{ uri: string; image: string }>("/api/sol/meta", { method: "POST", body: JSON.stringify(b) }),
  launched: (mint: string, signature: string, config: string) => call<SolLaunch>("/api/sol/launched", { method: "POST", body: JSON.stringify({ mint, signature, config }) }),
  adminState: (admin: string) => call<{ network: string; config: string | null; partner: string | null; review: boolean; kit: boolean; desk: boolean; info: SolInfo }>("/api/sol/admin/state", { admin }),
  adminPartner: (admin: string, partner: string) => call<{ ok: true }>("/api/sol/admin/partner", { method: "POST", admin, body: JSON.stringify({ partner }) }),
  adminConfig: (admin: string, config: string, partner: string) => call<{ ok: true }>("/api/sol/admin/config", { method: "POST", admin, body: JSON.stringify({ config, partner }) }),
  adminSwarm: (admin: string, b: { review?: boolean; kit?: boolean }) => call<{ ok: true }>("/api/sol/admin/swarm", { method: "POST", admin, body: JSON.stringify(b) }),
  adminNetwork: (admin: string, network: "mainnet" | "devnet") => call<{ ok: true }>("/api/sol/admin/network", { method: "POST", admin, body: JSON.stringify({ network }) }),
};

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
