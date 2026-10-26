# Swarm Desk delivery report

Implemented in the workspace; not deployed or published. No git, browsers or application/listening servers were run. No dependency was added. Existing files retain their newline convention; shared-file changes were narrow and reread immediately before editing.

## Owner handoff for today

The public entry is `/services#swarm-desk`: free quote, exact-price wallet payment, order ID/token and private status link. APIs and the public MCP lead with the Swarm Desk. The old quote-specific payment path still works, but every challenge and settlement advertises the same stable resource: `https://getnightshift.tech/api/v1/swarm/order`.

The existing live/Base and SWARM_DESK switch remain authoritative. Use `/swarm on` in the owner's private bot chat after live configuration and house funding are ready. Seed the house wallet with IMD and Ethereum ETH: unbacked orders are refused before USDC settlement, so future revenue cannot bootstrap an empty wallet. Preserve at least 0.0005 ETH on Base. A fresh runtime IMD price is also required unless the operator explicitly pinned one.

Defaults: SWARM_DESK_IN_FLIGHT=25, SWARM_DESK_DAILY_IMD=100, SWARM_IMD_FLOAT=5. `/swarm cap <imd>` and `/swarm inflight <n>` persist changes; `/swarm on|off` persists the switch; `/swarm` reports status, balances when known, reservations, today's jobs, revenue and refills. Existing saved caps win over new defaults. At 0.5 IMD/job the default daily ceiling permits 200 jobs/day. Thousands require an operator-selected higher ceiling, sufficient IMD/gas and suitable concurrency. IMD admissions are queued below the published limits (280 total requests and 28 quotes per rolling minute, leaving headroom below 300/30).

**Economics still needs the owner's decision.** The requested formula is unchanged: max($3, ceil((0.5 * IMD_USD * 1.25 + $0.60) * 100)/100). For the mocked $6.87 IMD price, the quote is $4.90, replacement IMD costs $3.435, and the 50% customer Agent Reserve allocation leaves $2.45 before bridge/gas costs: a $0.985 shortfall per job before fees. Those terms cannot guarantee indefinitely self-funding service. The implementation never fills the difference from unrelated revenue; it performs a partial IMD refill when possible and reports insufficient funds. New orders persist actual customer eligibility using the existing proof classification; owner/internal payments have no reserve allocation. Older orders without that field conservatively hold half.

## Routes and machine discovery

| Route | Purpose / cost |
| --- | --- |
| GET /api/v1/swarm/stats | Free; runtime IMD counters cached 60 s, completion ratio, desk orders/delivered/running/refunds, nine kinds and prices, enabled state |
| GET /api/v1/swarm/quote | Free IMD check; kind, brief and kind-specific query inputs; quote expires in ten minutes |
| GET /api/v1/swarm/order?quoteId=<uuid> | Exact checked USDC price on Base, from $3, no holder discount; settle then order |
| GET /api/v1/swarm/order/<quoteId> | Compatible legacy payment route; identical stable resource in 402 |
| GET /api/v1/swarm/jobs/<orderId>?token=<orderToken> | Free private polling and delivered files/links |
| POST /api/v1/a2a | A2A 0.3 JSON-RPC message/send and private tasks/get; uses the same service handlers/payment checks |

The bare `/api/v1/swarm/order` answers a discoverable minimum-price 402 with free-quote instructions. It cannot execute a purchase without a valid quote. PAYMENT-REQUIRED decodes to the exact response body. Pending settlement and lost responses reuse the same authorization. The same verified signed request can recover the private order token. A failed job records **a refund owed**; no automatic refund or guaranteed deadline is promised. Capacity refusals are 503 before charging, with Retry-After.

URLs, served using configured PUBLIC_URL (production examples):

- https://getnightshift.tech/.well-known/agent.json
- https://getnightshift.tech/.well-known/agent-card.json
- https://getnightshift.tech/.well-known/x402
- https://getnightshift.tech/openapi.json
- https://getnightshift.tech/llms.txt
- https://getnightshift.tech/mcp/public

Both card aliases serve published A2A 0.3 AgentCard fields with the working JSON-RPC URL, nine work skills and one skill per house offer. Input/output schemas, prices, MCP, auth:none and Base USDC payment details are inside a named NIGHTSHIFT capabilities extension rather than invented standard fields. No streaming, push or cancellation support is claimed. Structured calls use a data part `{tool,arguments}`; tasks/get requires the order ID and metadata.orderToken. The card does not bake in enrollment counts.

The x402 origin manifest follows [x402scan's documented compatibility format](https://github.com/Merit-Systems/x402scan/blob/main/docs/DISCOVERY.md): version 1, resources from the catalog, Swarm Desk first and stable. OpenAPI also lists every paid route with x-payment-info.protocols and fixed/dynamic USD pricing. The A2A card follows the [published 0.3 specification](https://a2a-protocol.org/v0.3.0/specification/). Registry server metadata is 1.3.0; its description stays inside the [registry schema's 100-character maximum](https://static.modelcontextprotocol.io/schemas/2025-09-29/server.schema.json).

MCP: `swarm_quote`, `swarm_order`, `swarm_job`, plus free `swarm_stats`. Keyword descriptions cover hire AI agents, website, research report, audit, tests, review, frontend and image. Schemas include examples. Every public tool receives annotations; lookups are read-only, hiring and watches are not. start_here puts the desk first and includes all seven fast tools: x402_seller_check, payment_verify, token_price, wallet_check, tx_explain, gas_now, name_resolve. No owner additions remain for station-routes.ts or server.ts; server.ts was untouched.

The existing cheap tools remain GET /api/v1/x402-seller-check ($0.005), payment-verify ($0.002), token-price ($0.002), wallet-check ($0.003), tx-explain ($0.003), gas-now ($0.002), name-resolve ($0.002), with their same underscore MCP names. Holder half price still floors at $0.001. Their answer examples and fixture latency measurements are in [FAST-TOOLS.md](FAST-TOOLS.md).

CDP facilitator rate limits are now 120 payments/payer/minute and 240/IP/minute. Self settlement retains the previous 10/20 limits (feed 60/120). Other existing route computation limits remain in effect. Tests exercise both branches and CDP's no-house-gas settlement path.

## Work kinds and fixture quotes

These are mocked examples, not live IMD quotes. Fixture time is 2026-10-26 12:00 UTC, IMD=$6.87, quote expiry 12:10 UTC. Every quote is $4.90 for 0.5 IMD under the unchanged formula. The repo and commit below are test data; use a real public repository and real pinned commit in production. Runtime /skills confirmation gates new skills, frontend source must be verified on the selected chain, and every quote goes through IMD's free check. Audit/review without a commit use IMD's repo import to pin the source before checking.

| Kind | IMD mapping | Fixture query input |
| --- | --- | --- |
| website | build-website | `{"kind":"website","brief":"Build a responsive page for an agent monitoring service."}` |
| research | research-report | `{"kind":"research","brief":"Compare Ethereum rollup proof systems with primary citations."}` |
| audit | audit template (4 specialists + judge) | `{"kind":"audit","brief":"Audit vault share accounting, permissions and reentrancy.","repo":"https://github.com/example/contracts"}` |
| contract | build-contract-project -> adversarial-review | `{"kind":"contract","brief":"Build a capped ERC-20 with mint limits and Foundry tests."}` |
| tests | write-foundry-tests | `{"kind":"tests","brief":"Write Foundry invariant tests for vault share accounting.","repo":"https://github.com/example/contracts","commit":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"}` |
| review | adversarial-review | `{"kind":"review","brief":"Review authentication boundaries and find concrete exploits.","repo":"https://github.com/example/contracts"}` |
| frontend | frontend-for-contract | `{"kind":"frontend","brief":"Build a responsive contract dashboard showing balances.","chain":"base","address":"0x833589fcd6edb6e08f4c7c32d4f71b54bda02913"}` |
| image | create-image | `{"kind":"image","brief":"Draw a moonlit orbital station above a blue planet."}` |
| logo | token-logo | `{"kind":"logo","name":"Night Owl","style":"minimal white owl on dark navy"}` |

Fixture answers (selected fields from each quote; the API also supplies whatYouGet and ETA):

```json
[
  {
    "quoteId": "00000000-0000-4000-8000-000000000001",
    "kind": "website",
    "priceUsd": 4.9,
    "imd": 0.5,
    "expiresAt": "2026-10-26T12:10:00.000Z",
    "pay": "https://getnightshift.tech/api/v1/swarm/order?quoteId=00000000-0000-4000-8000-000000000001"
  },
  {
    "quoteId": "00000000-0000-4000-8000-000000000002",
    "kind": "research",
    "priceUsd": 4.9,
    "imd": 0.5,
    "expiresAt": "2026-10-26T12:10:00.000Z",
    "pay": "https://getnightshift.tech/api/v1/swarm/order?quoteId=00000000-0000-4000-8000-000000000002"
  },
  {
    "quoteId": "00000000-0000-4000-8000-000000000003",
    "kind": "audit",
    "priceUsd": 4.9,
    "imd": 0.5,
    "expiresAt": "2026-10-26T12:10:00.000Z",
    "pay": "https://getnightshift.tech/api/v1/swarm/order?quoteId=00000000-0000-4000-8000-000000000003"
  },
  {
    "quoteId": "00000000-0000-4000-8000-000000000004",
    "kind": "contract",
    "priceUsd": 4.9,
    "imd": 0.5,
    "expiresAt": "2026-10-26T12:10:00.000Z",
    "pay": "https://getnightshift.tech/api/v1/swarm/order?quoteId=00000000-0000-4000-8000-000000000004"
  },
  {
    "quoteId": "00000000-0000-4000-8000-000000000005",
    "kind": "tests",
    "priceUsd": 4.9,
    "imd": 0.5,
    "expiresAt": "2026-10-26T12:10:00.000Z",
    "pay": "https://getnightshift.tech/api/v1/swarm/order?quoteId=00000000-0000-4000-8000-000000000005"
  },
  {
    "quoteId": "00000000-0000-4000-8000-000000000006",
    "kind": "review",
    "priceUsd": 4.9,
    "imd": 0.5,
    "expiresAt": "2026-10-26T12:10:00.000Z",
    "pay": "https://getnightshift.tech/api/v1/swarm/order?quoteId=00000000-0000-4000-8000-000000000006"
  },
  {
    "quoteId": "00000000-0000-4000-8000-000000000007",
    "kind": "frontend",
    "priceUsd": 4.9,
    "imd": 0.5,
    "expiresAt": "2026-10-26T12:10:00.000Z",
    "pay": "https://getnightshift.tech/api/v1/swarm/order?quoteId=00000000-0000-4000-8000-000000000007"
  },
  {
    "quoteId": "00000000-0000-4000-8000-000000000008",
    "kind": "image",
    "priceUsd": 4.9,
    "imd": 0.5,
    "expiresAt": "2026-10-26T12:10:00.000Z",
    "pay": "https://getnightshift.tech/api/v1/swarm/order?quoteId=00000000-0000-4000-8000-000000000008"
  },
  {
    "quoteId": "00000000-0000-4000-8000-000000000009",
    "kind": "logo",
    "priceUsd": 4.9,
    "imd": 0.5,
    "expiresAt": "2026-10-26T12:10:00.000Z",
    "pay": "https://getnightshift.tech/api/v1/swarm/order?quoteId=00000000-0000-4000-8000-000000000009"
  }
]
```

Paid answer example: `{"orderId":"sd_example","orderToken":"private-capability","status":"running","payment":{"tx":"0x…","network":"eip155:8453","priceUsd":4.9}}`. Free job polling returns the saved IMD order, job status and delivered result files/site/repo links when available. No result link is fabricated. Stats return null counters plus coverage when IMD is unavailable.

## Refill behavior

`swarm-refill.json` tracks one refill in flight with per-order revenue allocations and durable signed transactions. It buys only Base USDC -> Ethereum IMD (0xd34a99bc0f67ae1bbd63c660e6d0b0dd03e263b7) or native ETH, recipient the house wallet, no internal swap fee, at most 3% slippage, with the existing swap checks and pinned routes. IMD target uses balance minus unpaid in-flight job reservations. Below 0.001 Ethereum ETH it prioritizes buying 0.002 ETH. Base settlement gas remains at least 0.0005 ETH after estimated fees.

Gross failed-order revenue is held for refunds. Spend cannot exceed post-reserve unspent desk revenue or available USDC after other holds. Withdrawal holds protect desk funds alongside the Agent Reserve. Source spends and proven bridge refunds are booked with idempotent ledger IDs. Signed bytes and submitted state are saved before broadcast; uncertain answers are checked on chain before replaying only those same bytes. Confirmed source payments stay reserved even if local accounting fails. A new route is never bought while delivery is uncertain. Failures retry hourly and alert the owner; start/completion alerts use existing owner DM preferences. A newly settled credit can wake a no-revenue hold sooner.

For IMD, destination ERC-20 logs must prove receipt. For ETH, direct transfer or a successful call trace must prove the amount to the house. If an internal ETH bridge payout needs debug_traceTransaction(callTracer) and the configured RPC does not support it, the refill stays pending and alerts; it does not guess delivery or purchase again. This can require an operator/RPC reconciliation step. Live bridge routes were not exercised.

## Integration readiness and commands

All four adapters are version 0.2.0. No registry upload was performed.

- **nightshift-client:** built and npm pack dry-run passed. Nine kinds, quote/exact pay/poll, seven typed lookup helpers, persisted-request preparation/resubmission, explicit budgets. From integrations/nightshift-client: `npm run build`, `node --test --test-isolation=none test/*.test.mjs`, `npm publish --access public`.
- **elizaOS:** built and npm pack dry-run passed. Eight actions, host-injected signer/budget/save hook. Default plugin exposes free actions; paid actions require that host policy. Resume saved requests through exported NightshiftClient. From integrations/elizaos: `npm run build`, `node --test --test-isolation=none test/*.test.mjs`, `npm publish --access public`. Optional elizaOS registry listing still needs its external review/assets/credentials; the npm package is ready.
- **OpenClaw:** skill updated with all kinds/tools, budgeted autonomous payment and private retries. From repo root: `clawhub skill publish ./integrations/openclaw/nightshift --slug nightshift --name NIGHTSHIFT --version 0.2.0 --tags latest`. This is the [documented ClawHub command](https://docs.openclaw.ai/clawhub). Registry auth/scanning and a supported OpenClaw runtime remain external; no live skill run was attempted.
- **Virtuals ACP:** private provider adapter, runtime/type-checked against installed SDK 0.1.15. Correct evmProvider API; durable budget/quote/signature/order, duplicate funded-event coalescing, saved funded jobs resumed from hydrated sessions, delivered work polling and explicit refund-owed reporting. From integrations/virtuals-acp: `npm test`; later owner activation: `npm start`. ACP Provider/offer registration, whitelisting, graduation and credentials remain external. Its separate NIGHTSHIFT_X402_PRIVATE_KEY wallet must already hold Base USDC; ACP escrow does not automatically fund outgoing x402. This adapter is configured/run, not npm-published.

`examples/typescript/swarm.ts` runs free quote -> exact payment -> polling and also supports all seven --tool IDs. It requires a finite --max-usd, private --state file for paid calls and an environment wallet key only when first signing. The saved request is reused after restart. --dry-run never signs. examples/README.md and curl.md document both paths. Generic earlier examples remain available.

## Verification

Engine and web tsc --noEmit -p . passed. Engine service/Swarm Vitest was run with the existing in-process runner because this sandbox cannot spawn normal Vite/Vitest workers reliably. No application or listening server was started. Final run: **136 engine tests across eight files passed; 36 web payment tests across three files passed.**

Integration client and elizaOS build/type checks passed; their fake-fetch tests passed (10 and 6). ACP offline tests passed (8), including persisted restart recovery and refund reporting. ACP provider type check used the existing root Node types because its transitive @types/node is version 12; no dependency was added. The standalone example type check passed with --types node.

Engine checks from root:

```sh
cd apps/engine
npx tsc --noEmit -p .
cd ../..
node tools/test-house-services.mjs engine src/services src/crews/swarm.test.ts src/crews/swarm-scale.test.ts src/crews/swarm-control.test.ts src/crews/swarm-proof.test.ts
cd apps/web
npx tsc --noEmit -p .
cd ../..
node tools/test-house-services.mjs web src/paidServices.test.ts src/paidLookups.test.ts src/swarmPay.test.ts
```

On Windows this session used npx.cmd. Additional type checks, from their respective directories:

```sh
# integrations/virtuals-acp
npx tsc --noEmit --module NodeNext --moduleResolution NodeNext --target ES2023 --esModuleInterop --skipLibCheck --types node --typeRoots ../../node_modules/@types --allowImportingTsExtensions src/provider.ts
# examples/typescript
npx tsc --noEmit --module NodeNext --moduleResolution NodeNext --target ES2022 --skipLibCheck --types node --allowImportingTsExtensions swarm.ts
```

The latest fixture warm-cache computation p95 for the seven existing fast tools was 0.00–0.01 ms at 0.01 ms reporting precision, excluding signature verification, settlement and transport. This is not a production p95. Live Swarm quote/payment/refill latency was not measurable here.

## Files changed

Engine:

- apps/engine/src/crews/swarm.ts, swarm-kinds.ts, swarm-rate.ts, swarm-refill.ts, swarm-live.ts, swarm-control.ts
- apps/engine/src/crews/swarm.test.ts, swarm-scale.test.ts, swarm-proof.test.ts, swarm-control.test.ts, fixtures/swarm-quotes.json
- apps/engine/src/services/catalog.ts, routes.ts, mcp.ts, discovery.ts, a2a.ts
- apps/engine/src/services/services.test.ts, house.test.ts, swarm-discovery.test.ts
- apps/engine/src/config.ts, station-routes.ts
- Small shared-file edits: apps/engine/src/settings.ts (editable settings), social.ts (owner command menu), engine.ts (owner dispatch, shared IMD admission queue and withdrawal hold), services/house.ts (CDP limits, desk/refill wiring and reserve classification)

Web:

- apps/web/src/SwarmPay.tsx, swarmPay.test.ts, paidServices.ts
- apps/web/src/station/Services.tsx, services.css, apps/web/src/nx/map.ts

Integrations/docs/examples:

- integrations/nightshift-client/src/index.ts, test/client.test.mjs, test/swarm.test.mjs, README.md, package.json, package-lock.json; rebuilt dist/index.js and dist/index.d.ts
- integrations/elizaos/src/client.ts, index.ts, paid-actions.ts, test/plugin.test.mjs, README.md, package.json, package-lock.json; rebuilt dist JS/declarations
- integrations/openclaw/nightshift/SKILL.md, integrations/openclaw/README.md
- integrations/virtuals-acp/src/client.ts, paid-entry.ts, x402.ts, config.ts, provider.ts, test/paid-entry.test.ts, README.md, package.json, package-lock.json
- examples/typescript/swarm.ts, paid.ts, examples/README.md, examples/curl.md
- docs/station/mcp-registry-server.json, docs/services/SWARM-DESK.md

Existing tools/test-house-services.mjs was reused, not changed by this task. No edits were made to protected live directories, owner-stats.ts, proof.ts, crews/live.ts, usage.ts, swap.ts or server.ts.

## Still external or unverified

IMD /skills and /swarm could not be fetched from this sandbox, including a final retry. The new skill names are those requested by the owner; body conventions follow the installed IMD client/draft source. Runtime skill presence, verified source and IMD's free check fail closed. Real successful quotes for all new kinds still need confirmation from a network-enabled live environment. No actual settlement, paid IMD submission, production bridge, wallet UI browser run, registry publish or deployment occurred. Live counts are obtained only at runtime.

The owner must decide how to close the pricing/Reserve funding gap, fund the house seed balances, enable the desk in live Base mode, raise any saved low caps for desired volume, and perform the first real payment. Registry publication/ACP onboarding are also external. No automatic refund was implemented; existing refund-owed behavior is preserved.
