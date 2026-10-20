import { config } from "./config.js";
import { type SettingKey, readSettings } from "./settings.js";

/**
 * Email and social sign-in in the wallet modal (Reown's embedded wallets), read on every request so
 * /setup switches it at once, no restart: on unless WALLET_SOCIAL_LOGIN is 0. Reown's free plan
 * counts those wallets against 500 active users a month and then cuts the whole project off,
 * WalletConnect included, so this is the switch to turn when that line comes near.
 */
export function socialLogin(saved: Partial<Record<SettingKey, string>> = readSettings(), env: Record<string, string | undefined> = process.env): boolean {
  return (saved.WALLET_SOCIAL_LOGIN ?? env.WALLET_SOCIAL_LOGIN ?? "1").trim() !== "0";
}

/**
 * What the site's wallet layer (Reown AppKit) needs, public: the Reown project id, the site's own
 * origin for AppKit's metadata.url (Reown's Verify API checks it against the page and the domains
 * allowlisted on dashboard.reown.com: anything else shows wallets an unverified or mismatched site),
 * the chain products are sold on, so its test network can be added when it is Base Sepolia, and
 * whether email and social sign-in are offered.
 */
export function walletConfig(c: Pick<typeof config, "walletConnect" | "publicUrl" | "salesChainId"> = config, social = socialLogin()) {
  return { walletConnect: c.walletConnect || null, site: new URL(c.publicUrl).origin, salesChainId: c.salesChainId, social };
}
