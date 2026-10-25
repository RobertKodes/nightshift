# NIGHTSHIFT provider for Virtuals ACP

One offering: **Token Verdict Preview**. A buyer agent sends `{"token":"0x…"}`, we quote a USDC budget, the buyer funds the job, and we deliver the free NIGHTSHIFT preview JSON (`/api/v1/verdict/ethereum/{token}/preview`).

## What was checked

- SDK: `@virtuals-protocol/acp-node-v2` 0.1.15 on npm. The v1 package `@virtuals-protocol/acp-node` is marked deprecated in its own README, so v2 is used. Sources: https://github.com/Virtual-Protocol/acp-node-v2 , https://github.com/Virtual-Protocol/acp-node (README).
- Flow (from the v2 README and the installed type definitions): provider calls `AcpAgent.create({provider: PrivyAlchemyEvmProviderAdapter.create(...)})`, `agent.on("entry", handler)`, `agent.start()`. Buyer creates the job from the offering and sends the requirement; provider `session.setBudget(AssetToken.usdc(...))`; buyer `session.fund`; on `job.funded` provider `session.submit(deliverable)`; evaluator completes or rejects.
- Onboarding (https://whitepaper.virtuals.io/acp/acp-dev-onboarding-guide.md): choose the Provider role and accept terms; whitelist the developer wallet under My Agents and set its default currency; complete 10 successful sandbox jobs and request graduation (manual review); each offering needs a description, input schema, USDC price (docs suggest testing at 0.01), delivery expectations and samples; up to 40 offerings; job prices and fees are in USDC on Base.

## Layout

- `src/handler.ts`: the job logic (no wallet). `src/config.ts`: every external value, read from env. `src/provider.ts`: the only file that needs credentials.
- `test/handler.test.ts`: offline, with a fake session and fake `fetch`.

## Test (offline)

```bash
npm install
npm test        # node --test test/*.test.ts  (Node 22.18+ / 24)
```

Result: 5 of 5 pass (requirement parsing, budget quote, bad requirement, delivery of the preview, upstream error). NOT tested: any live ACP job, the Privy wallet adapter, or the SSE connection; those need the external steps below.

## The one remaining external step (a human does this)

Register the agent on the ACP Service Registry (https://app.virtuals.io/acp/new), which also produces the credentials this code reads. Concretely, before `npm start`:

1. Register a Provider agent and add an offering named exactly `Token Verdict Preview` (or set `NIGHTSHIFT_ACP_OFFERING`), with requirement schema `{"token": "0x… Ethereum token address"}` and a price (our `NIGHTSHIFT_ACP_PRICE_USD`, default 0.01, should match).
2. In the agent's Signers tab: add a signer and copy the wallet address, wallet id and signer key into `ACP_WALLET_ADDRESS`, `ACP_WALLET_ID`, `ACP_SIGNER_PRIVATE_KEY` (optional `ACP_BUILDER_CODE`).
3. Whitelist the developer wallet, run the 10 sandbox jobs, and request graduation; new offerings on graduated agents may need Virtuals approval.

Open questions the docs did not answer: whether a zero or very small budget is accepted, and the exact platform fee. Selling a service that is free on our own site is a business decision for the owner; the paid verdict could be offered the same way later.
