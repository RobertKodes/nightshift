import { timingSafeEqual } from "node:crypto";
import type { IncomingMessage } from "node:http";
import { isAddress } from "viem";
import { config } from "./config.js";
import type { Engine } from "./engine.js";
import { EDITABLE, SECRET_KEYS, adminToken, readSettings, writeSettings } from "./settings.js";

export const ADMIN = adminToken();

export function isAdmin(req: IncomingMessage): boolean {
  const got = Buffer.from(String(req.headers["x-admin-token"] ?? ""));
  const want = Buffer.from(ADMIN.token);
  return got.length === want.length && timingSafeEqual(got, want);
}

type Check = { id: string; label: string; state: "ok" | "warn" | "block"; detail: string };

async function rpcChain(url: string): Promise<number | null> {
  try {
    const r = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "eth_chainId", params: [] }), signal: AbortSignal.timeout(5000) });
    const j = (await r.json()) as { result?: string };
    return j.result ? Number(j.result) : null;
  } catch { return null; }
}

/** What the running engine uses, what is saved for the next start, and what still stands between it and live. */
export async function setupState(engine: Engine) {
  const saved = readSettings();
  const running: Record<string, string> = {
    NIGHTSHIFT_MODE: config.mode, PUBLIC_URL: config.publicUrl, REQUIRE_AUTH: config.requireAuth ? "1" : "0",
    OPENROUTER_API_KEY: config.openrouterKey ? "set" : "", NIGHTSHIFT_MODEL: config.model,
    ETH_RPC: config.ethRpc, SALES_CHAIN_ID: String(config.salesChainId), SALES_RPC: config.salesRpc, IMD_USD: String(config.imdUsd),
    PLATFORM_FEE_BPS: String(config.platformFeeBps), PLATFORM_TREASURY: config.platformTreasury, MAX_COMPANIES_PER_OWNER: String(config.maxCompaniesPerOwner),
    SIM_SHIFT_MINUTES: String(config.simShiftMinutes), SIM_JOB_SECONDS: String(config.simJobSeconds),
  };
  const shown: Record<string, string> = {};
  for (const k of EDITABLE) shown[k] = SECRET_KEYS.has(k) ? (saved[k] ? "set" : "") : (saved[k] ?? "");
  const pending = EDITABLE.some((k) => (saved[k] ?? "") !== "" && !SECRET_KEYS.has(k) && saved[k] !== running[k]) || Boolean(saved.OPENROUTER_API_KEY) !== Boolean(config.openrouterKey);

  const [eth, base, swarm, or] = await Promise.all([
    rpcChain(config.ethRpc),
    rpcChain(config.salesRpc),
    engine.reads.health().catch(() => null),
    config.openrouterKey
      ? fetch("https://openrouter.ai/api/v1/key", { headers: { Authorization: `Bearer ${config.openrouterKey}` }, signal: AbortSignal.timeout(5000) }).then((r) => r.ok).catch(() => false)
      : Promise.resolve(null),
  ]);
  const live = config.mode === "live";
  const checks: Check[] = [
    { id: "swarm", label: "IMD swarm reachable", state: swarm ? "ok" : "block", detail: swarm ? `${swarm.connectedDaemons ?? "?"} agents online at api.imd.fun` : "api.imd.fun/health did not answer" },
    { id: "eth", label: "Ethereum RPC (IMD payments)", state: eth === 1 ? "ok" : "block", detail: eth === 1 ? config.ethRpc : `${config.ethRpc} answered chain ${eth ?? "nothing"}, expected 1` },
    { id: "sales", label: "Sales chain", state: base === null ? "block" : config.salesChainId === 8453 ? (base === 8453 ? "ok" : "block") : "warn",
      detail: config.salesChainId === 8453 ? (base === 8453 ? "Base mainnet: buyers pay real USDC" : `RPC answered chain ${base}, expected 8453`) : `Base Sepolia (${config.salesChainId}): test USDC only. Set SALES_CHAIN_ID=8453 to sell for real` },
    { id: "secret", label: "Wallet vault key", state: process.env.NIGHTSHIFT_SECRET ? "ok" : "warn",
      detail: process.env.NIGHTSHIFT_SECRET ? "NIGHTSHIFT_SECRET is set" : "Generated and kept in the data volume (secret.key). Back up the volume: losing it loses every company wallet" },
    { id: "auth", label: "Owners sign in with a wallet", state: config.requireAuth ? "ok" : live ? "block" : "warn", detail: config.requireAuth ? "Required" : "Off: anyone can create and steer companies" },
    { id: "https", label: "HTTPS", state: config.publicUrl.startsWith("https://") ? "ok" : "warn",
      detail: config.publicUrl.startsWith("https://") ? config.publicUrl : "Plain HTTP on an IP address. Works, but get a domain (Caddy adds HTTPS by itself) before real money moves" },
    { id: "url", label: "Public address", state: /localhost|127\.0\.0\.1/.test(config.publicUrl) ? "block" : "ok", detail: `${config.publicUrl} (used in buy links and company sites)` },
    { id: "llm", label: "CEO model", state: or === false ? "warn" : "ok", detail: or === null ? "No OpenRouter key: the free playbook decides. Fine to start" : or ? `${config.model} via OpenRouter` : "OpenRouter rejected the key" },
    { id: "fee", label: "Platform fee", state: config.platformFeeBps > 0 && !isAddress(config.platformTreasury || "0x") ? "block" : "ok",
      detail: config.platformFeeBps > 0 ? `${config.platformFeeBps / 100}% to ${config.platformTreasury || "missing treasury"}` : "None" },
    { id: "price", label: "IMD price for budgets", state: config.imdUsdPinned || Date.now() - config.imdUsdAt < 30 * 60_000 ? "ok" : "warn",
      detail: config.imdUsdPinned ? `Pinned at $${config.imdUsd} by IMD_USD` : config.imdUsdAt ? `$${config.imdUsd.toFixed(2)} from DexScreener, ${Math.round((Date.now() - config.imdUsdAt) / 60_000)} min ago` : `No market price yet; using $${config.imdUsd}` },
    { id: "mode", label: "Mode", state: live ? "ok" : "warn", detail: live ? "LIVE: real IMD orders and real sales" : "Simulation: nothing leaves the server" },
  ];
  return {
    running, saved: shown, pending,
    checks,
    readyForLive: checks.every((c) => c.id === "mode" || c.state !== "block"),
    stats: { companies: engine.store.companies.size, products: [...engine.store.companies.values()].reduce((a, c) => a + c.products.filter((p) => p.status === "live").length, 0) },
    supervised: process.env.NIGHTSHIFT_SUPERVISED === "1",
  };
}

export function saveSetup(patch: Record<string, unknown>): string | null {
  const v = (k: string) => (k in patch ? String(patch[k] ?? "").trim() : undefined);
  const mode = v("NIGHTSHIFT_MODE");
  if (mode && mode !== "sim" && mode !== "live") return "NIGHTSHIFT_MODE is sim or live";
  const chain = v("SALES_CHAIN_ID");
  if (chain && chain !== "8453" && chain !== "84532") return "SALES_CHAIN_ID is 8453 (Base) or 84532 (Base Sepolia)";
  const url = v("PUBLIC_URL");
  if (url && !/^https?:\/\/[^\s/]+/.test(url)) return "PUBLIC_URL must start with http:// or https://";
  for (const k of ["IMD_USD", "PLATFORM_FEE_BPS", "MAX_COMPANIES_PER_OWNER", "SIM_SHIFT_MINUTES", "SIM_JOB_SECONDS"]) {
    const x = v(k);
    if (x && (Number.isNaN(Number(x)) || Number(x) < 0)) return `${k} must be a positive number`;
  }
  const t = v("PLATFORM_TREASURY");
  if (t && !isAddress(t)) return "PLATFORM_TREASURY must be an address";
  // A masked secret coming back unchanged means "keep it".
  if (patch.OPENROUTER_API_KEY === "set") delete patch.OPENROUTER_API_KEY;
  writeSettings(patch);
  return null;
}
