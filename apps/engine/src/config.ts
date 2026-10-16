import { resolve } from "node:path";
import { readSettings } from "./settings.js";

/** The environment, overridden by what the operator saved on /setup. */
const env: Record<string, string | undefined> = { ...process.env, ...readSettings() };
const num = (v: string | undefined, d: number) => (v !== undefined && v !== "" && !Number.isNaN(Number(v)) ? Number(v) : d);

export const config = {
  port: num(env.PORT, 8787),
  /** sim: nothing leaves the machine. live: real IMD orders and real USDC sales. */
  mode: (env.NIGHTSHIFT_MODE === "live" ? "live" : "sim") as "live" | "sim",
  publicUrl: (env.PUBLIC_URL ?? `http://localhost:${num(env.PORT, 8787)}`).replace(/\/$/, ""),
  dataDir: resolve(env.DATA_DIR ?? "data"),
  /** Encrypts every company's wallet key at rest. Set it in production. */
  secret: env.NIGHTSHIFT_SECRET ?? "",
  openrouterKey: env.OPENROUTER_API_KEY ?? "",
  model: env.NIGHTSHIFT_MODEL ?? "anthropic/claude-sonnet-5.5",
  /** USD per IMD, for budgets. Follows the market every 10 minutes unless IMD_USD pins it. */
  imdUsd: num(env.IMD_USD, 6.87),
  imdUsdPinned: Boolean(env.IMD_USD),
  imdUsdAt: 0,
  ethRpc: env.ETH_RPC ?? "https://ethereum-rpc.publicnode.com",
  /** Where products are sold: Base (8453) or Base Sepolia (84532). */
  salesChainId: num(env.SALES_CHAIN_ID, 84532),
  salesRpc: env.SALES_RPC ?? (num(env.SALES_CHAIN_ID, 84532) === 8453 ? "https://mainnet.base.org" : "https://sepolia.base.org"),
  /** Demo pacing: minutes between autopilot shifts and seconds per swarm job in sim mode. */
  simShiftMinutes: num(env.SIM_SHIFT_MINUTES, 2),
  simJobSeconds: num(env.SIM_JOB_SECONDS, 40),
  webDist: resolve(env.WEB_DIST ?? "../web/dist"),
  /** Owners sign in with their wallet. On by default in live mode; the sim demo stays open. */
  requireAuth: env.REQUIRE_AUTH ? env.REQUIRE_AUTH === "1" : env.NIGHTSHIFT_MODE === "live",
  /** Platform fee on revenue, taken when the owner withdraws. 0 = none. */
  platformFeeBps: num(env.PLATFORM_FEE_BPS, 0),
  platformTreasury: (env.PLATFORM_TREASURY ?? "") as `0x${string}` | "",
  /** Operator alerts: a Telegram bot token and the chat it writes to. */
  telegramToken: env.TELEGRAM_BOT_TOKEN ?? "",
  /** One chat id, or several separated by commas (a group and a person). */
  telegramChat: env.TELEGRAM_CHAT_ID ?? "",
  /** Telegram user ids allowed to run admin commands (/status, /stop…). */
  telegramAdmins: (env.TELEGRAM_ADMIN_IDS ?? "").split(",").map((x) => x.trim()).filter(Boolean),
  /**
   * The platform token (an ERC-20 on Ethereum, e.g. one launched through IMD). Holding at least
   * TOKEN_HOLDER_MIN waives the platform fee and features the owner's products in the market.
   * Off while TOKEN_ADDRESS is empty.
   */
  token: {
    address: (env.TOKEN_ADDRESS ?? "") as `0x${string}` | "",
    symbol: env.TOKEN_SYMBOL ?? "TOKEN",
    holderMin: num(env.TOKEN_HOLDER_MIN, 0),
    buyUrl: env.TOKEN_BUY_URL ?? "",
  },
  /** Companies one wallet may run at once. */
  maxCompaniesPerOwner: num(env.MAX_COMPANIES_PER_OWNER, 5),
};

export type Config = typeof config;
