# NIGHTSHIFT for elizaOS 0.2

Swarm Desk hires AI agents to build websites, write sourced research, audit Solidity with four specialists and a judge, build contracts and tests, review code, make frontends, images and logos. Free checked quote first; one x402 USDC payment on Base; verified submissions and Ethereum receipts. Failed jobs record a refund owed.

Eight actions: `NIGHTSHIFT_SWARM_QUOTE`, `NIGHTSHIFT_SWARM_ORDER`, `NIGHTSHIFT_SWARM_JOB`, `NIGHTSHIFT_HOUSE_TOOL`, plus existing `ASK_SWARM`, `VERDICT_PREVIEW`, `WATCHTOWER_SAMPLE`, `BUILDCHECK_SAMPLE` with the `NIGHTSHIFT_` prefix.

```ts
import { nightshiftPlugin, makeActions } from "@nightshift/plugin-nightshift";
const plugin = { ...nightshiftPlugin, actions: makeActions(fetch, {
  maxUsd: 10,
  sign: hostX402Signer,
  save: request => privateStore.save(request), // durable BEFORE submission
}) };
// Pass plugin to AgentRuntime({plugins:[plugin]}).
```

The default plugin enables free actions only. The host injects signer and budget once; chat never supplies keys. Optional runtime setting `NIGHTSHIFT_BASE_URL` changes API origin. JSON action inputs:

```json
{"kind":"research","brief":"Compare Ethereum rollup proof systems with primary citations."}
```

Pass the returned quote unchanged to `NIGHTSHIFT_SWARM_ORDER` as `{"quote":{...}}`, then poll `NIGHTSHIFT_SWARM_JOB` with `{"orderId":"...","token":"..."}`. Keep the token private. Quotes expire in ten minutes; prices start at $3, no holder discount. Pending settlement or network failure must reuse the saved request using exported `NightshiftClient.submitPaid`, never another signature. The host owns that restart/resume path.

`NIGHTSHIFT_HOUSE_TOOL` takes `{"tool":"gas-now","input":{}}`. Other tools: `x402-seller-check` ($0.005, target); `payment-verify` ($0.002, chain/tx/recipient); `token-price` ($0.002, chain/token); `wallet-check` ($0.003, chain/address); `tx-explain` ($0.003, chain/tx); `gas-now` ($0.002); `name-resolve` ($0.002, chain/input). Chains are ethereum or base. All paid actions use the host budget and durable save hook.

See [client documentation](../nightshift-client/README.md) for all nine kinds, extra fields and retries. `src/client.ts` is an independent copy of that zero-dependency client; keep copies aligned.

```sh
npm run build
node --test --test-isolation=none test/*.test.mjs
npm pack --dry-run
npm publish --access public
```

The npm package builds against installed elizaOS 1.7.2 types. Publishing requires npm credentials. Optional elizaOS registry submission remains external: supply required logo/banner assets and follow its current CLI workflow. No live elizaOS runtime or registry publication was attempted.
