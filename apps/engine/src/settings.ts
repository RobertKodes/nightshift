import { randomBytes } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

/**
 * Settings the operator changes from the /setup dashboard. They are stored next to the data and
 * win over the environment, so going live never needs a shell on the server.
 */
export const EDITABLE = [
  "NIGHTSHIFT_MODE", "PUBLIC_URL", "REQUIRE_AUTH", "OPENROUTER_API_KEY", "NIGHTSHIFT_MODEL",
  "ETH_RPC", "SALES_CHAIN_ID", "SALES_RPC", "IMD_USD",
  "PLATFORM_FEE_BPS", "PLATFORM_TREASURY", "PLATFORM_DEV", "MAX_COMPANIES_PER_OWNER",
  "SIM_SHIFT_MINUTES", "SIM_JOB_SECONDS",
  "TELEGRAM_BOT_TOKEN", "TELEGRAM_CHAT_ID", "TELEGRAM_ADMIN_IDS",
  "TELEGRAM_COMMUNITY", "BUYBOT_MIN_USD", "BUYBOT_EMOJI_USD", "BUYBOT_MEDIA", "RAID_PIN", "BOT_ANIMATIONS", "NFT_ADDRESS", "NFT_EXTRA_SLOTS", "NFT_VRF_SUB", "X_URL", "TELEGRAM_URL", "BLUESKY_HANDLE",
  "BLUESKY_APP_PASSWORD", "BLUESKY_PROMO", "BLUESKY_DAILY_MAX", "BLUESKY_GAP_MINUTES", "BLUESKY_COMPANY_POSTS",
  "TOKEN_ADDRESS", "TOKEN_SYMBOL", "TOKEN_HOLDER_MIN", "TOKEN_BUY_URL", "LAUNCH_NOTIFY", "MODERATION", "ASSISTANT",
  "WALLETCONNECT_PROJECT_ID",
] as const;
export type SettingKey = (typeof EDITABLE)[number];
/** Shown as set / not set, never sent back to the browser. */
export const SECRET_KEYS = new Set<SettingKey>(["OPENROUTER_API_KEY", "TELEGRAM_BOT_TOKEN", "BLUESKY_APP_PASSWORD", "LAUNCH_NOTIFY"]);

const dataDir = resolve(process.env.DATA_DIR ?? "data");
const file = join(dataDir, "settings.json");

export function readSettings(): Partial<Record<SettingKey, string>> {
  try { return existsSync(file) ? JSON.parse(readFileSync(file, "utf8")) : {}; } catch { return {}; }
}

export function writeSettings(patch: Record<string, unknown>): Partial<Record<SettingKey, string>> {
  const cur = readSettings();
  for (const k of EDITABLE) {
    if (!(k in patch)) continue;
    const v = patch[k];
    if (v === null || v === "") delete cur[k];
    else cur[k] = String(v).trim();
  }
  mkdirSync(dataDir, { recursive: true });
  writeFileSync(file, JSON.stringify(cur, null, 2), { mode: 0o600 });
  return cur;
}

/** The token that opens /setup: ADMIN_TOKEN, or one generated on first start and kept in the data folder. */
export function adminToken(): { token: string; generated: boolean } {
  if (process.env.ADMIN_TOKEN) return { token: process.env.ADMIN_TOKEN, generated: false };
  const f = join(dataDir, "admin-token");
  mkdirSync(dataDir, { recursive: true });
  if (!existsSync(f)) writeFileSync(f, randomBytes(18).toString("base64url"), { mode: 0o600 });
  return { token: readFileSync(f, "utf8").trim(), generated: true };
}
