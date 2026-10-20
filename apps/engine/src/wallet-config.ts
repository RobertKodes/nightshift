import { config } from "./config.js";

/**
 * What the site's wallet layer (Reown AppKit) needs, public: the Reown project id, the site's own
 * origin for AppKit's metadata.url (Reown's Verify API checks it against the page and the domains
 * allowlisted on dashboard.reown.com: anything else shows wallets an unverified or mismatched site),
 * and the chain products are sold on, so its test network can be added when it is Base Sepolia.
 */
export function walletConfig(c: Pick<typeof config, "walletConnect" | "publicUrl" | "salesChainId"> = config) {
  return { walletConnect: c.walletConnect || null, site: new URL(c.publicUrl).origin, salesChainId: c.salesChainId };
}
