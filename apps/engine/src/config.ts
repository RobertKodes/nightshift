import { resolve } from "node:path";
import { readSettings } from "./settings.js";
import { DEV_WALLET, TREASURY_WALLET } from "./shift-launch.js";

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
  /** Free by default: OpenRouter's free models cost nothing. A paid model needs LLM_ALLOW_PAID=1. */
  model: env.NIGHTSHIFT_MODEL || "nvidia/nemotron-3-super-120b-a12b:free",
  fallbackModels: (env.NIGHTSHIFT_FALLBACK_MODELS || "nvidia/nemotron-3-ultra-550b-a55b:free,google/gemma-4-31b-it:free,google/gemma-4-26b-a4b-it:free,openrouter/free").split(",").map((m) => m.trim()).filter(Boolean),
  llmAllowPaid: env.LLM_ALLOW_PAID === "1",
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
  // Live mode always requires sign-in: with it off anyone could steer or withdraw any company.
  requireAuth: env.NIGHTSHIFT_MODE === "live" ? true : env.REQUIRE_AUTH ? env.REQUIRE_AUTH === "1" : false,
  /** Platform fee on revenue, taken when the owner withdraws. 0 = none. */
  platformFeeBps: Math.min(1000, Math.max(0, num(env.PLATFORM_FEE_BPS, 0))),
  platformTreasury: (env.PLATFORM_TREASURY || TREASURY_WALLET) as `0x${string}` | "",
  /** The dev wallet's part of every platform fee: 20%, the one rule. The rest goes to the treasury. */
  platformDev: (env.PLATFORM_DEV || DEV_WALLET) as `0x${string}`,
  /** Telegram chats that get the contract address privately at deploy and at the first buy. Kept only in the server settings, never in the code. */
  launchNotify: env.LAUNCH_NOTIFY ?? "",
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
    symbol: env.TOKEN_SYMBOL ?? "SHIFT",
    holderMin: num(env.TOKEN_HOLDER_MIN, 0),
    buyUrl: env.TOKEN_BUY_URL ?? "",
  },
  /**
   * The community chat (public group or channel, "@name" or "-100…"): buy bot, X raids, new
   * Bluesky posts, milestones and welcomes. The bot must be a member (an admin in a channel).
   */
  telegramCommunity: env.TELEGRAM_COMMUNITY ?? "@getnightshift",
  /** Buys below this many dollars are not posted; one 🌙 per BUYBOT_EMOJI_USD dollars. */
  buyMinUsd: num(env.BUYBOT_MIN_USD, 0),
  /** The community guard: removes scams, spam and FUD in the public group and mutes repeat offenders. */
  moderation: env.MODERATION !== "0",
  buyEmojiUsd: Math.max(1, num(env.BUYBOT_EMOJI_USD, 10)),
  /** A picture, GIF or MP4 URL shown on every buy. */
  buyMedia: env.BUYBOT_MEDIA ?? "",
  /** Branded loops (the site's /bot/*.mp4) on top of community cards and operator alerts. */
  botAnimations: (env.BOT_ANIMATIONS ?? "1") === "1",
  /** Pin each X raid in the community chat (the bot needs the pin right). */
  raidPin: (env.RAID_PIN ?? "1") === "1",
  xUrl: env.X_URL ?? "https://x.com/nightshiftimd",
  telegramUrl: env.TELEGRAM_URL ?? "https://t.me/getnightshift",
  blueskyHandle: (env.BLUESKY_HANDLE ?? "nightshifttech.bsky.social").replace(/^@/, ""),
  /** The project account's app password (Bluesky → Settings → Privacy and security → App passwords). */
  blueskyAppPassword: env.BLUESKY_APP_PASSWORD ?? "",
  /** One promo a day (after 15:00 UTC), and at most BLUESKY_DAILY_MAX posts, BLUESKY_GAP_MINUTES apart. */
  blueskyPromo: (env.BLUESKY_PROMO ?? "1") === "1",
  blueskyDailyMax: num(env.BLUESKY_DAILY_MAX, 10),
  blueskyGapMinutes: num(env.BLUESKY_GAP_MINUTES, 45),
  /** In live mode, companies without their own account post their drafts on the project account. */
  blueskyCompanyPosts: (env.BLUESKY_COMPANY_POSTS ?? "1") === "1",
  /** NIGHT FROGS (ERC-721 on Ethereum). Holders get the token holders' perks plus extra company slots. */
  nft: {
    address: (env.NFT_ADDRESS ?? "") as `0x${string}` | "",
    extraSlots: num(env.NFT_EXTRA_SLOTS, 2),
    /** The owner's Chainlink VRF v2.5 subscription, prefilled in /setup for configureVRF. */
    vrfSub: env.NFT_VRF_SUB ?? "",
  },
  /** Companies one wallet may run at once. */
  maxCompaniesPerOwner: num(env.MAX_COMPANIES_PER_OWNER, 5),
};

export type Config = typeof config;
