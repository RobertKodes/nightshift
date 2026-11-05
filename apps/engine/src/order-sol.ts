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
  what: "An audit panel (4 specialists + judge) reviews the NIGHTSHIFT Solana launchpad on GitHub: the transactions the page builds with Meteora's SDK, the engine's check of the creator's signed launch before it adds its one signature, the launches held on durable nonces until the IMD swarm finishes, the IMD payment proof, the RPC proxy and the admin. You get a ranked report with fixes.",
  action: "job.open" as const,
  intake: "job.open@job-1",
  body: {
    template: "audit",
    repoUrl: "https://github.com/RobertKodes/nightshift",
    paths: ["apps/engine/src/sol-launch.ts", "apps/engine/src/sol-tx.ts", "apps/engine/src/sol-imd.ts", "apps/engine/src/sol-mints.ts", "apps/engine/src/sol-chain.ts", "apps/engine/src/sol-routes.ts", "apps/web/src/launchpad/sol"],
    objective: `Security audit of NIGHTSHIFT Launch on Solana, a token launchpad built as a Meteora Dynamic Bonding Curve (DBC) launch partner, where the IMD swarm's work (a review that decides whether a token launches, its logo, banner and website) is done before the launch. Real users will sign real transactions with it, so review it as production money code.

The flow: the engine prepares a launch and gives it a token address ending in "imd" whose key it holds (sol-mints.ts, stored 0600 in the data folder, dropped once the token exists). The page (apps/web/src/launchpad/sol) builds the launch with @meteora-ag/dynamic-bonding-curve-sdk 2.0.0 and the creator's wallet signs it; with swarm work it is signed on a durable nonce the creator owns, so it can wait. The engine checks the signed transaction (sol-tx.ts launchTxProblem: only the creator and the address may sign, only compute budget, System nonce advance and transfers from the creator, Meteora DBC, the associated token account program and the token program, the address used only by Meteora and in the buyer's token account), simulates it, and adds the address's signature and sends it: at once, or when the creator's IMD job completes and its review says launch. The creator pays IMD's job from their own EVM wallet through IMD's Intake; sol-imd.ts proves the payment by finding the exact job body in the Intake's event. The creator can release or cancel a waiting launch with a wallet-signed message (ed25519, sol-tx.ts walletSigned).

Look for: any way the address's signature or a held launch could be used for something other than that one launch (extra or reordered instructions, another config, account flag confusion after deserialization, durable-nonce replay, a launch sent twice), payment proof bypasses (a payment reused for another launch, a body that only resembles ours, the wrong chain), verdict spoofing (a job or file that is not the one bound to the launch), signed-message replay across launches or actions, mint key storage and lifecycle, config parameters that weaken the stated guarantees (immutable token, 100% locked graduated liquidity, anti-sniper fee, fee split), RPC proxy abuse (methods outside the whitelist, batch smuggling, denial of service, SSRF through settings), metadata and image upload issues (type confusion, path traversal, stored XSS through names, links or images), listing spoofing, the admin overrides, rate limits, and error handling that leaks secrets such as an RPC key. Rank findings by severity with exact file and line references and concrete fixes.`,
  },
};
