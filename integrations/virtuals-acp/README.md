# NIGHTSHIFT Virtuals ACP provider 0.2

Default offering: **Swarm Desk**. Buyer requests work; provider gets IMD's free checked quote, sets an exact ACP USDC budget, uses x402 USDC on Base to hire AI agents and polls delivered work. Websites, sourced research, audits, contracts, tests, review, frontends, images and logos are supported. Failed jobs record a refund owed; the provider reports it and must reconcile the refund and ACP escrow. It never submits failed work as success.

Buyer requirement:

```json
{"service":"swarm","kind":"research","brief":"Compare Ethereum rollup proof systems with primary citations.","maxUsd":10}
```

Seven house tools use the same funding flow, e.g. `{"service":"gas-now","input":{},"maxUsd":0.002}`. Inputs/prices are in [nightshift-client](../nightshift-client/README.md). Tests/review/audit need public GitHub repo and documented commit fields; frontend needs a verified Ethereum/Base contract. Free checks and current capacity determine admission.

`src/paid-entry.ts` persists quote, budget, signed request, order receipt and delivery in `NIGHTSHIFT_ACP_STATE` (default data/nightshift-acp.json). Authorization is saved before submission. Duplicate funded events coalesce. Resume the same funded job after restart to reuse that signature. An expired *unsigned* quote may refresh within the funded budget. Tokens stay in the private ledger. Polling runs every 60 seconds; resume the same job after timeout or pending settlement. Only completed work is submitted to ACP.

External setup, not performed here:

1. Register a Provider and `Swarm Desk` offering in ACP Service Registry. `NIGHTSHIFT_ACP_OFFERING` can change its exact name. Configure JSON requirements, variable checked budget and delivery expectations.
2. Configure `ACP_WALLET_ADDRESS`, `ACP_WALLET_ID`, `ACP_SIGNER_PRIVATE_KEY` (optional ACP_BUILDER_CODE) from ACP Signers.
3. Supply `NIGHTSHIFT_X402_PRIVATE_KEY` through the secret environment. **This separate wallet needs USDC on Base before work.** ACP escrow does not fund outgoing x402 automatically. NIGHTSHIFT_ACP_MAX_USD defaults to 20 per job.
4. Complete Virtuals whitelisting, sandbox jobs, graduation and any required offering approval.

The old free-preview adapter remains only when offering name is exactly `Token Verdict Preview`; NIGHTSHIFT_ACP_PRICE_USD controls its fixed preview price.

```sh
npm test
npm start
```

Run from this directory on Node 24 with dependencies installed. `npm start` is the owner's later activation step; it was not run. This private provider package is ready for ACP registration/configuration, rather than npm publication. Existing SDK 0.1.15 and viem are reused; no dependency added. Tests mock ACP, signing and HTTP. Live escrow, bridge routes and IMD work require external credentials/funding and runtime checks.
