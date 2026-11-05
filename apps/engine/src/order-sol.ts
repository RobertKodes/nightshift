/**
 * The IMD orders behind NIGHTSHIFT Launch on Solana: research on the questions our own research left
 * open (Desktop/NIGHTSHIFT-research/14-solana-launchpad.md), and an audit panel on the launchpad code
 * once it is on GitHub (the order pins the latest commit on main when it is checked and paid).
 */
export const SOL_RESEARCH_ORDER = {
  key: "sol-launchpad-research",
  title: "Solana launchpad: the open questions",
  what: "The swarm researches what our launchpad research could not verify: what NIGHTSHIFT keeps after a Meteora DBC token graduates, the anti-sniper and bundle-detection practice that works on Solana today, the rug signals worth checking before and after graduation, the legal exposure of a memecoin launchpad, and whether IMD plans Solana. You get a cited report.",
  action: "job.open" as const,
  intake: "job.open@job-1",
  body: {
    skill: "research-report",
    outputs: [{ name: "report", path: "artifacts/report.md", mediaType: "text/markdown" }],
    minCitations: 10,
    // the report names our open risks: it stays off GitHub (research-report publishes there by default)
    github: false,
    objective: `Research report for NIGHTSHIFT (getnightshift.tech), which is adding a token launchpad on Solana as a Meteora Dynamic Bonding Curve (DBC, program dbcij3LWUppWqq96dh6gJWwBifmcGfLSB5D4DuSMaqN) launch partner. Its config key: SOL quote, SPL token with immutable authority, 1B supply, curve from a 30 SOL to a 420 SOL market cap, 1% trading fee split 50/50 creator/partner after Meteora's 20%, an exponential anti-sniper fee from 50% to 1% over 120 seconds, graduation to DAMM v2 with 100% of the LP permanently locked (50% partner, 50% creator). Answer each with primary sources (Meteora docs and SDK source, program source, court filings, regulator statements), dated, and say plainly when something cannot be confirmed.

1. After a DBC pool graduates to DAMM v2 with partner and creator permanently locked liquidity: what exactly do the partner and the creator receive (position NFTs, claimable trading fees, in which tokens), how are those fees claimed, and what do partnerLiquidityPercentage vs partnerPermanentLockedLiquidityPercentage change. Cite the SDK functions and program instructions involved.
2. Anti-sniper practice on Solana in 2026: which fee-scheduler settings (starting fee, duration, periods, linear vs exponential) launchpads like Jupiter Studio, Bags and Believe use, evidence of what works, and how bundled launches (Jito bundles, same-slot buys from freshly funded wallets, funding-wallet clusters) are detected from public RPC data alone.
3. Rug and manipulation signals a launchpad can check for free before and right after graduation using standard Solana RPC calls (holder concentration, creator transfers, wash trading, liquidity changes), with thresholds others use.
4. Legal exposure of operating a memecoin launchpad in 2026: the US SEC staff statement on meme coins (February 2025) and anything since, the class actions against pump.fun (including the RICO claims naming Solana and Jito parties) and their status, the UK FCA position on pump.fun, and the geoblocking and KYC practice of major launchpads. Not legal advice; summarize what is documented.
5. Has IMD (imd.fun, identity.md) announced Solana support or cross-chain launches? Quote the source if so.

Deliver a structured report with a short answer per question, the evidence, and a list of open risks for NIGHTSHIFT.`,
  },
};

export const SOL_AUDIT_ORDER = {
  key: "sol-launchpad-audit",
  title: "Solana launchpad security audit",
  what: "An audit panel (4 specialists + judge) reviews the NIGHTSHIFT Solana launchpad on GitHub: the transactions the page builds with Meteora's SDK, the config key, the engine's token metadata and logo hosting, the Solana RPC proxy and the admin's config check. You get a ranked report with fixes.",
  action: "job.open" as const,
  intake: "job.open@job-1",
  body: {
    template: "audit",
    repoUrl: "https://github.com/RobertKodes/nightshift",
    paths: ["apps/engine/src/sol-launch.ts", "apps/engine/src/sol-chain.ts", "apps/engine/src/sol-routes.ts", "apps/web/src/launchpad/sol"],
    objective: `Security audit of NIGHTSHIFT Launch on Solana, a token launchpad built as a Meteora Dynamic Bonding Curve (DBC) launch partner. Real users will sign real transactions with it, so review it as production money code.

The web page (apps/web/src/launchpad/sol) builds every transaction in the browser with @meteora-ag/dynamic-bonding-curve-sdk 2.0.0 and @solana/web3.js, and the user's own wallet signs: the partner config key (params.ts: createConfig2), a launch with an optional creator first buy (a fresh mint keypair generated in the page), and buys and sells on the curve with slippage limits. The engine (apps/engine/src/sol-*.ts) never holds keys or funds: it hosts the token metadata JSON and a small uploaded logo before the launch, verifies a reported launch at the pool's derived address on the NIGHTSHIFT config, reads pools and free safety checks, and proxies a whitelist of Solana JSON-RPC methods (including sendTransaction) to a configured RPC.

Look for: anything that could make a user sign a transaction other than the one shown (wrong pool, config, mint, amount, slippage, recipient, extra instructions), unsafe handling of the mint keypair, config parameters that weaken the stated guarantees (immutable token, 100% locked graduated liquidity, anti-sniper fee, fee split), RPC proxy abuse (methods outside the whitelist, request smuggling in batches, denial of service, SSRF through settings), metadata and image upload issues (type confusion, path traversal, stored XSS through names, links or images, size limits), listing spoofing (fake launches, names imitating others), the admin config check, rate limits, and error handling that leaks secrets such as an RPC key. Rank findings by severity with exact file and line references and concrete fixes.`,
  },
};
