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
  /** Signs sign-in sessions. Unset: derived from the vault secret (as before). Setting it signs everyone out once. */
  sessionSecret: process.env.SESSION_SECRET ?? "",
  /**
   * Proxies whose X-Forwarded-For is believed (IPs or CIDRs, comma separated). Loopback by default;
   * the compose files set the network Caddy reaches the engine on.
   */
  trustedProxies: env.TRUSTED_PROXIES || "127.0.0.0/8,::1,caddy",
  openrouterKey: env.OPENROUTER_API_KEY ?? "",
  /** Free by default: OpenRouter's free models cost nothing. A paid model needs LLM_ALLOW_PAID=1. */
  model: env.NIGHTSHIFT_MODEL || "nvidia/nemotron-3-super-120b-a12b:free",
  fallbackModels: (env.NIGHTSHIFT_FALLBACK_MODELS || "nvidia/nemotron-3-ultra-550b-a55b:free,google/gemma-4-31b-it:free,google/gemma-4-26b-a4b-it:free,openrouter/free").split(",").map((m) => m.trim()).filter(Boolean),
  llmAllowPaid: env.LLM_ALLOW_PAID === "1",
  /** The owner chat with the CEO: a free model, so it costs nothing to run. */
  chatModel: env.NIGHTSHIFT_CHAT_MODEL || env.NIGHTSHIFT_MODEL || "nvidia/nemotron-3-super-120b-a12b:free",
  /** The CEO's strong model, paid by each company from its own USDC over x402 ("" turns it off). */
  ceoModel: env.NIGHTSHIFT_CEO_MODEL ?? "anthropic/claude-sonnet-5.5",
  /** The OpenAI-compatible gateway that sells that model over x402 on Base. */
  aiGateway: env.AI_GATEWAY_URL || "https://blockrun.ai/api/v1/chat/completions",
  /** USD per IMD, for budgets. Follows the market every 10 minutes unless IMD_USD pins it. */
  imdUsd: num(env.IMD_USD, 6.87),
  imdUsdPinned: Boolean(env.IMD_USD),
  imdUsdAt: 0,
  /** Swarm Desk's kill switch and cap apply as soon as settings are saved. */
  get swarmDesk() { return (readSettings().SWARM_DESK ?? process.env.SWARM_DESK) === "1"; },
  get swarmDeskDailyImd() { const v = num(readSettings().SWARM_DESK_DAILY_IMD ?? process.env.SWARM_DESK_DAILY_IMD, 100); return Number.isFinite(v) ? Math.min(100_000, Math.max(0, v)) : 0; },
  get swarmDeskInFlight() { const v = num(readSettings().SWARM_DESK_IN_FLIGHT ?? process.env.SWARM_DESK_IN_FLIGHT, 25); return Number.isFinite(v) ? Math.min(1000, Math.max(0, Math.floor(v))) : 0; },
  get swarmImdFloat() { const v = num(readSettings().SWARM_IMD_FLOAT ?? process.env.SWARM_IMD_FLOAT, 5); return Number.isFinite(v) ? Math.min(100_000, Math.max(0, v)) : 0; },
  ethRpc: env.ETH_RPC ?? "https://ethereum-rpc.publicnode.com",
  /** Where products are sold: Base (8453) or Base Sepolia (84532). */
  salesChainId: num(env.SALES_CHAIN_ID, 84532),
  salesRpc: env.SALES_RPC ?? (num(env.SALES_CHAIN_ID, 84532) === 8453 ? "https://mainnet.base.org" : "https://sepolia.base.org"),
  /** A CDP secret API key (portal.cdp.coinbase.com): its id, and its Ed25519 secret in base64. Never logged or shown. */
  cdpApiKeyId: env.CDP_API_KEY_ID ?? "",
  cdpApiKeySecret: env.CDP_API_KEY_SECRET ?? "",
  /**
   * Who settles x402 payments. cdp: Coinbase's CDP facilitator (it pays the gas, and each settled payment
   * lists the product in the CDP Bazaar), with the company settling itself when the facilitator is down.
   * self: the company always does. Default: cdp once a CDP key is set.
   */
  x402Facilitator: (env.X402_FACILITATOR === "self" || !(env.CDP_API_KEY_ID && env.CDP_API_KEY_SECRET) ? "self" : "cdp") as "cdp" | "self",
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
  /** The bot's @username, for t.me links (an owner's alert link, the channel check). */
  telegramBotName: (env.TELEGRAM_BOT_USERNAME || "nightshiftimdbot").replace(/^@/, ""),
  // TELEGRAM_OFFLINE=1 (read in social.ts): no call ever reaches Telegram, the bot does not start (local runs with a made-up token)
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
  /** The daily company digest in the community chat (digest.ts): on unless DIGEST=0, at DIGEST_HOUR UTC. */
  digest: (env.DIGEST ?? "1") !== "0",
  digestHour: Math.min(23, Math.max(0, Math.floor(num(env.DIGEST_HOUR, 18)))),
  /** Mondays 09:00 UTC: the past week's changelog entries, posted and pinned in the community chat (changelog.ts); CHANGELOG_POST=0 turns it off. */
  changelogPost: (env.CHANGELOG_POST ?? "1") !== "0",
  /** NIGHT SNIPER (sniper.ts): every new IMD launch checked and called. On in live mode unless SNIPER=0; SNIPER=1 runs it in sim too. */
  sniper: (env.SNIPER ?? (env.NIGHTSHIFT_MODE === "live" ? "1" : "0")) !== "0",
  /** How long holders' app has a call before the community chat and everyone else get it. */
  sniperDelayMs: num(env.SNIPER_DELAY_MS, 180_000),
  /** The Android app's signing certificates (SHA-256, AA:BB:… form, comma separated): the upload key and Play's app signing key. */
  androidCertSha256: (env.ANDROID_CERT_SHA256 ?? "").split(",").map((x) => x.trim().toUpperCase()).filter((x) => /^([0-9A-F]{2}:){31}[0-9A-F]{2}$/.test(x)),
  /** Buys below this many dollars are not posted; one 🌙 per BUYBOT_EMOJI_USD dollars. */
  buyMinUsd: num(env.BUYBOT_MIN_USD, 0),
  /** The community guard: removes scams, spam and FUD in the public group and mutes repeat offenders. */
  moderation: env.MODERATION === "1",
  /** The community assistant: answers questions about the project from live facts (free models only). */
  assistant: env.ASSISTANT !== "0",
  buyEmojiUsd: Math.max(1, num(env.BUYBOT_EMOJI_USD, 10)),
  /** A picture, GIF or MP4 URL shown on every buy. */
  buyMedia: env.BUYBOT_MEDIA ?? "",
  /** Branded loops (the site's /bot/*.mp4) on top of community cards and operator alerts. */
  botAnimations: (env.BOT_ANIMATIONS ?? "1") === "1",
  /** Pin each X raid in the community chat (the bot needs the pin right). */
  raidPin: (env.RAID_PIN ?? "1") === "1",
  xUrl: env.X_URL || "https://x.com/nightshiftimd",
  /** The NIGHTSHIFT community on X. */
  xCommunityUrl: env.X_COMMUNITY_URL || "https://x.com/i/communities/1946355874932334723",
  telegramUrl: env.TELEGRAM_URL || "https://t.me/getnightshift",
  /** WalletConnect (Reown) project id: phones and the installed game connect a wallet app with it. */
  // the Reown (WalletConnect) project of getnightshift.tech: a public id, a setting overrides it
  walletConnect: env.WALLETCONNECT_PROJECT_ID || "adbab93f28eb7aa847cbe829b7a530d3",
  /** OpenSea API key (free): posts new NIGHT FROGS listings. Sales are read on chain without it. */
  openseaKey: env.OPENSEA_API_KEY ?? "",
  /** Etherscan API key (v2, free tier): verified source for the house services. Without it they read Sourcify only. */
  etherscanKey: env.ETHERSCAN_API_KEY ?? "",
  /** The IMD Watchtower's JSON status (its container on the same Docker network); api.imd.fun/swarm when it does not answer. */
  watchtowerUrl: env.WATCHTOWER_URL || "http://imd-watchtower:8787/status",
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
  /** NIGHT WATCHERS, the NIGHT FROGS Gen 2 forge (10 frogs in, 1 Night Watcher out): off while FORGE_ADDRESS is empty. */
  forge: {
    address: (env.FORGE_ADDRESS ?? "") as `0x${string}` | "",
    /** The Watch Room: the private Telegram group (chat id) only Night Watcher holders may join; the bot must be its admin. */
    room: env.WATCH_ROOM_CHAT ?? "",
  },
  /**
   * Live betting for spectators (BetPool on Ethereum, built by the IMD swarm): off while
   * BETPOOL_ADDRESS is empty. BETPOOL_BLOCK is its deploy block, where the event follower starts.
   */
  betPool: {
    // the live BetPool (IMD launch 8594ca07, verified on Etherscan and Sourcify); a setting overrides it, "off" turns betting off
    address: ((v) => (/^0x[0-9a-fA-F]{40}$/.test(v) ? v : ""))(env.BETPOOL_ADDRESS ?? "0x76decb1958a1e04549e2e7f451cc22cd832d0fc3") as `0x${string}` | "",
    block: Math.max(0, Math.floor(num(env.BETPOOL_BLOCK, 26226964))),
  },
  /**
   * The house exhibition (housegame.ts): one NIGHT CHESS game between two house bots, always on,
   * never rated or staked. It steps aside while more than HOUSE_GAMES_MAX_REAL real games are on.
   */
  houseGames: (env.HOUSE_GAMES ?? "1") !== "0",
  houseGamesMaxReal: Math.max(0, num(env.HOUSE_GAMES_MAX_REAL, 12)),
  /** Weekly prizes in shift hours (prizes.ts): on unless WEEKLY_PRIZES=0; PRIZE_HOURS is 1st,2nd,3rd. */
  weeklyPrizes: (env.WEEKLY_PRIZES ?? "1") !== "0",
  prizeHours: ((v) => { const l = v.split(",").map((x) => Number(x.trim())).filter((x) => Number.isFinite(x) && x >= 0 && x <= 1_000).slice(0, 10); return l.length ? l : [24, 12, 6]; })(env.PRIZE_HOURS ?? "24,12,6"),
  /** Companies one wallet may run at once. */
  maxCompaniesPerOwner: num(env.MAX_COMPANIES_PER_OWNER, 5),
  /**
   * NIGHTSHIFT's Gumroad OAuth app (gumroad.com → Settings → Advanced → Applications), so owners can
   * connect their own Gumroad accounts. Its redirect URI is PUBLIC_URL/api/connect/gumroad/callback.
   * Off while either is empty.
   */
  gumroad: { clientId: env.GUMROAD_CLIENT_ID ?? "", clientSecret: env.GUMROAD_CLIENT_SECRET ?? "" },
};

export type Config = typeof config;
