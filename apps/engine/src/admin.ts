import { timingSafeEqual } from "node:crypto";
import type { IncomingMessage } from "node:http";
import { isAddress } from "viem";
import { isCdpSecret } from "@nightshift/x402";
import { config } from "./config.js";
import type { Engine } from "./engine.js";
import { EDITABLE, SECRET_KEYS, adminToken, readSettings } from "./settings.js";
import { swapSettings } from "./swap.js";
import { socialLogin } from "./wallet-config.js";

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
    ETH_RPC: config.ethRpc, SALES_CHAIN_ID: String(config.salesChainId), SALES_RPC: config.salesRpc,
    X402_FACILITATOR: config.x402Facilitator, CDP_API_KEY_ID: config.cdpApiKeyId ? "set" : "", CDP_API_KEY_SECRET: config.cdpApiKeySecret ? "set" : "",
    PLATFORM_FEE_BPS: String(config.platformFeeBps), PLATFORM_TREASURY: config.platformTreasury, PLATFORM_DEV: config.platformDev, MAX_COMPANIES_PER_OWNER: String(config.maxCompaniesPerOwner),
    SIM_SHIFT_MINUTES: String(config.simShiftMinutes), SIM_JOB_SECONDS: String(config.simJobSeconds),
    TELEGRAM_BOT_TOKEN: config.telegramToken ? "set" : "", TELEGRAM_CHAT_ID: config.telegramChat, TELEGRAM_ADMIN_IDS: config.telegramAdmins.join(","),
    TOKEN_ADDRESS: config.token.address, TOKEN_SYMBOL: config.token.symbol, TOKEN_HOLDER_MIN: String(config.token.holderMin), TOKEN_BUY_URL: config.token.buyUrl,
    GUMROAD_CLIENT_ID: config.gumroad.clientId,
    HOUSE_GAMES: config.houseGames ? "1" : "0", HOUSE_GAMES_MAX_REAL: String(config.houseGamesMaxReal),
    WEEKLY_PRIZES: config.weeklyPrizes ? "1" : "0", PRIZE_HOURS: config.prizeHours.join(","),
    DIGEST: config.digest ? "1" : "0", DIGEST_HOUR: String(config.digestHour), CHANGELOG_POST: config.changelogPost ? "1" : "0",
    // read live by /api/wallet-config: a saved change applies at once, never "pending a restart"
    WALLET_SOCIAL_LOGIN: socialLogin() ? "1" : "0",
    // read live by the swap routes: a saved change applies at once
    ...swapRunning(),
  };
  const shown: Record<string, string> = {};
  for (const k of EDITABLE) shown[k] = SECRET_KEYS.has(k) ? (saved[k] ? "set" : "") : (saved[k] ?? "");
  const pending = EDITABLE.some((k) => (saved[k] ?? "") !== "" && !SECRET_KEYS.has(k) && saved[k] !== running[k])
    || Boolean(saved.OPENROUTER_API_KEY) !== Boolean(config.openrouterKey) || Boolean(saved.TELEGRAM_BOT_TOKEN) !== Boolean(config.telegramToken)
    || Boolean(saved.GUMROAD_CLIENT_SECRET) !== Boolean(config.gumroad.clientSecret)
    || Boolean(saved.CDP_API_KEY_ID) !== Boolean(config.cdpApiKeyId) || Boolean(saved.CDP_API_KEY_SECRET) !== Boolean(config.cdpApiKeySecret);

  const network = `eip155:${config.salesChainId}`;
  const [eth, base, swarm, or, cdp] = await Promise.all([
    rpcChain(config.ethRpc),
    rpcChain(config.salesRpc),
    engine.reads.health().catch(() => null),
    config.openrouterKey
      ? fetch("https://openrouter.ai/api/v1/key", { headers: { Authorization: `Bearer ${config.openrouterKey}` }, signal: AbortSignal.timeout(5000) }).then((r) => r.ok).catch(() => false)
      : Promise.resolve(null),
    // one read-only call with the key: does the facilitator take it, and does it settle where we sell?
    engine.facilitator
      ? engine.facilitator.supported().then((r) => r.kinds.some((k) => k.x402Version === 2 && k.scheme === "exact" && k.network === network)).catch(() => false)
      : Promise.resolve(null),
  ]);
  const live = config.mode === "live";
  const checks: Check[] = [
    { id: "swarm", label: "IMD swarm reachable", state: swarm ? "ok" : "block", detail: swarm ? `${swarm.connectedDaemons ?? "?"} agents online at api.imd.fun` : "api.imd.fun/health did not answer" },
    { id: "eth", label: "Ethereum RPC (IMD payments)", state: eth === 1 ? "ok" : "block", detail: eth === 1 ? config.ethRpc : `${config.ethRpc} answered chain ${eth ?? "nothing"}, expected 1` },
    { id: "sales", label: "Sales chain", state: base === null ? "block" : config.salesChainId === 8453 ? (base === 8453 ? "ok" : "block") : "warn",
      detail: config.salesChainId === 8453 ? (base === 8453 ? "Base mainnet: buyers pay real USDC" : `RPC answered chain ${base}, expected 8453`) : `Base Sepolia (${config.salesChainId}): test USDC only. Set SALES_CHAIN_ID=8453 to sell for real` },
    // A key kept next to the vault it opens protects nothing: whoever copies the volume has every wallet.
    { id: "secret", label: "Wallet vault key", state: !engine.vault.generatedSecret ? "ok" : live ? "block" : "warn",
      detail: !engine.vault.generatedSecret ? "NIGHTSHIFT_SECRET is set" : `Generated and kept in the data volume (secret.key), next to the keys it encrypts.${live ? " Set NIGHTSHIFT_SECRET to the contents of secret.key (so existing wallets still open), then delete secret.key from the volume" : " Set NIGHTSHIFT_SECRET before going live"}` },
    { id: "auth", label: "Owners sign in with a wallet", state: config.requireAuth ? "ok" : live ? "block" : "warn", detail: config.requireAuth ? "Required" : "Off: anyone can create and steer companies" },
    { id: "https", label: "HTTPS", state: config.publicUrl.startsWith("https://") ? "ok" : "warn",
      detail: config.publicUrl.startsWith("https://") ? config.publicUrl : "Plain HTTP on an IP address. Works, but get a domain (Caddy adds HTTPS by itself) before real money moves" },
    { id: "url", label: "Public address", state: /localhost|127\.0\.0\.1/.test(config.publicUrl) ? "block" : "ok", detail: `${config.publicUrl} (used in buy links and company sites)` },
    { id: "llm", label: "CEO model", state: or === false ? "warn" : "ok", detail: or === null ? "No OpenRouter key: the free playbook decides. Fine to start" : or ? `${config.model} via OpenRouter` : "OpenRouter rejected the key" },
    { id: "x402", label: "x402 settlement (CDP Bazaar)", state: cdp === true ? "ok" : "warn",
      detail: cdp === true ? `CDP facilitator: Coinbase pays the gas and every paid product is listed in the CDP Bazaar (exact on ${network}). If it is down, companies settle themselves`
        : cdp === false ? `The CDP facilitator refused the key or did not answer for ${network}: companies settle payments themselves until it works`
        : config.cdpApiKeyId && config.cdpApiKeySecret ? "Companies settle payments themselves (X402_FACILITATOR=self): products are not listed in the CDP Bazaar"
        : "Companies settle payments themselves, so products are not listed in the CDP Bazaar. Add a CDP API key (portal.cdp.coinbase.com) to settle through Coinbase" },
    { id: "fee", label: "Platform fee", state: config.platformFeeBps > 0 && !isAddress(config.platformTreasury || "0x") ? "block" : "ok",
      detail: config.platformFeeBps > 0 ? `${config.platformFeeBps / 100}% of withdrawals: 20% to dev ${config.platformDev}, 80% to treasury ${config.platformTreasury || "missing"}` : "None" },
    { id: "price", label: "IMD price for budgets", state: config.imdUsdPinned || Date.now() - config.imdUsdAt < 30 * 60_000 ? "ok" : "warn",
      detail: config.imdUsdPinned ? `Pinned at $${config.imdUsd} by IMD_USD` : config.imdUsdAt ? `$${config.imdUsd.toFixed(2)} live from the market, ${Math.round((Date.now() - config.imdUsdAt) / 60_000)} min ago. Nothing to set` : "Market price not read yet; it reads itself every 10 minutes. Nothing to set" },
    { id: "alerts", label: "Alerts", state: config.telegramToken && config.telegramChat ? "ok" : "warn", detail: config.telegramToken && config.telegramChat ? "Telegram: warnings in live mode reach you" : "No Telegram bot: nobody hears when something breaks" },
    { id: "gumroad", label: "Gumroad (owners sell on their own accounts)", state: "ok",
      detail: config.gumroad.clientId && config.gumroad.clientSecret ? `App ${config.gumroad.clientId.slice(0, 8)}…, redirect URI ${config.publicUrl}/api/connect/gumroad/callback` : `Optional, not set. Register an app in Gumroad → Settings → Advanced → Applications with the redirect URI ${config.publicUrl}/api/connect/gumroad/callback` },
    { id: "token", label: "Platform token", state: "ok", detail: config.token.address ? `${config.token.symbol} at ${config.token.address}; holders of ${config.token.holderMin}+ pay no fee` : "Not set. Optional; see /token" },
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

/** The multichain swap's settings as the swap routes read them now (swap.ts reads /setup on every request). */
function swapRunning(): Record<string, string> {
  const saved = readSettings(), s = swapSettings(saved);
  return { SWAP_FEE_BPS: saved.SWAP_FEE_BPS === undefined ? "" : String(s.feeBps), SWAP_FEE_WALLET: saved.SWAP_FEE_WALLET === undefined ? "" : s.feeWallet, LIFI_INTEGRATOR: s.lifiIntegrator };
}

/** Settings that move money or trust: every change is announced, so a leaked admin token cannot act quietly. */
export const ANNOUNCED = ["NIGHTSHIFT_MODE", "PLATFORM_TREASURY", "PLATFORM_DEV", "PLATFORM_FEE_BPS", "ETH_RPC", "SALES_RPC", "SALES_CHAIN_ID", "TOKEN_ADDRESS", "NFT_ADDRESS", "REQUIRE_AUTH",
  "X402_FACILITATOR", "CDP_API_KEY_ID", "CDP_API_KEY_SECRET", "BETPOOL_ADDRESS", "TELEGRAM_BOT_TOKEN", "TELEGRAM_CHAT_ID", "TELEGRAM_ADMIN_IDS", "LAUNCH_NOTIFY", "PUBLIC_URL", "GUMROAD_CLIENT_ID", "GUMROAD_CLIENT_SECRET",
  "SWAP_FEE_BPS", "SWAP_FEE_WALLET", "LIFI_INTEGRATOR"];

/** Saved settings that differ from what runs now, by name: what a restart would apply. */
export function pendingChanges(): string[] {
  const saved = readSettings();
  const running: Record<string, string> = {
    NIGHTSHIFT_MODE: config.mode, PLATFORM_TREASURY: config.platformTreasury, PLATFORM_DEV: config.platformDev, PLATFORM_FEE_BPS: String(config.platformFeeBps),
    ETH_RPC: config.ethRpc, SALES_RPC: config.salesRpc, SALES_CHAIN_ID: String(config.salesChainId), TOKEN_ADDRESS: config.token.address, NFT_ADDRESS: config.nft.address, X402_FACILITATOR: config.x402Facilitator,
    BETPOOL_ADDRESS: config.betPool.address, BETPOOL_BLOCK: String(config.betPool.block),
    TELEGRAM_CHAT_ID: config.telegramChat, TELEGRAM_ADMIN_IDS: config.telegramAdmins.join(","), PUBLIC_URL: config.publicUrl, REQUIRE_AUTH: config.requireAuth ? "1" : "0",
    GUMROAD_CLIENT_ID: config.gumroad.clientId,
    WALLET_SOCIAL_LOGIN: socialLogin() ? "1" : "0",
    // read live by the swap routes: a saved change applies at once
    ...swapRunning(),
  };
  return EDITABLE.filter((k) => saved[k] !== undefined && (SECRET_KEYS.has(k) || running[k] === undefined || saved[k] !== running[k]));
}

/** Checks a /setup change without saving it: an error for the operator, or null. */
export function checkSetup(patch: Record<string, unknown>): string | null {
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
  const fee = v("PLATFORM_FEE_BPS");
  if (fee && Number(fee) > 1000) return "PLATFORM_FEE_BPS is at most 1000 (10%)";
  for (const k of ["ETH_RPC", "SALES_RPC"]) { const r = v(k); if (r && !/^https:\/\/[^\s/]+/.test(r)) return `${k} must be an https:// URL`; }
  const t = v("PLATFORM_TREASURY");
  if (t && !isAddress(t)) return "PLATFORM_TREASURY must be an address";
  const dv = v("PLATFORM_DEV");
  if (dv && !isAddress(dv)) return "PLATFORM_DEV must be an address";
  const ta = v("TOKEN_ADDRESS");
  if (ta && !isAddress(ta)) return "TOKEN_ADDRESS must be an address";
  const bp = v("BETPOOL_ADDRESS");
  if (bp && !isAddress(bp)) return "BETPOOL_ADDRESS must be an address";
  const wt = v("WATCHTOWER_URL");
  if (wt && !/^https?:\/\/[^\s/]+/.test(wt)) return "WATCHTOWER_URL must start with http:// or https://";
  const bb = v("BETPOOL_BLOCK");
  if (bb && !/^\d{1,12}$/.test(bb)) return "BETPOOL_BLOCK is the contract's deploy block number";
  const sl = v("WALLET_SOCIAL_LOGIN");
  if (sl && sl !== "0" && sl !== "1") return "WALLET_SOCIAL_LOGIN is 1 (on) or 0 (off)";
  const sf = v("SWAP_FEE_BPS");
  if (sf && !(/^\d{1,3}$/.test(sf) && Number(sf) <= 100)) return "SWAP_FEE_BPS is a whole number of basis points from 0 to 100 (1%)";
  const sw = v("SWAP_FEE_WALLET");
  if (sw && !isAddress(sw)) return "SWAP_FEE_WALLET must be an address";
  const li = v("LIFI_INTEGRATOR");
  if (li && !/^[\w.-]{2,64}$/.test(li)) return "LIFI_INTEGRATOR is the integration name from portal.li.fi (letters, digits, . _ -)";
  const fac = v("X402_FACILITATOR");
  if (fac && fac !== "cdp" && fac !== "self") return "X402_FACILITATOR is cdp or self";
  // checked without ever being repeated back: a message names the field, never its value
  const kid = v("CDP_API_KEY_ID");
  if (kid && kid !== "set" && !/^[\w./-]{8,200}$/.test(kid)) return "CDP_API_KEY_ID is the id of the CDP key file (a UUID)";
  const ks = v("CDP_API_KEY_SECRET");
  if (ks && ks !== "set" && !isCdpSecret(ks)) return "CDP_API_KEY_SECRET is the privateKey of the CDP key file: an Ed25519 key in base64 (64 bytes)";
  // A masked secret coming back unchanged means "keep it".
  for (const k of SECRET_KEYS) if (patch[k] === "set") delete patch[k];
  return null;
}
