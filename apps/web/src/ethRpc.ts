import { fallback, http } from "viem";

/**
 * Ethereum reads from the browser through three free nodes: when one refuses, times out or is blocked on the
 * visitor's network, the next answers. All three are allowed by the site's content policy.
 */
export const ethTransport = () => fallback([
  http("https://ethereum-rpc.publicnode.com", { timeout: 12_000 }),
  http("https://rpc.mevblocker.io", { timeout: 12_000 }),
  http("https://eth.drpc.org", { timeout: 12_000 }),
], { retryCount: 1 });
