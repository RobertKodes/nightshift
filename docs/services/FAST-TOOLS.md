Seven fast paid tools are implemented as separate GET resources, Bazaar entries and paid MCP tools. `imd-launches` was skipped because `imd-feed` already exists. No deployment, browser, application server or git command was run; no dependencies were added.

All routes below start with `/api/v1/`. Data chains are `ethereum` and `base`; payment still uses the existing house x402 flow. Optional `holder=<paying wallet>` and MCP `holderWallet` use the existing eligibility checks.

| Route | Paid MCP tool | Required query | Full USDC | Holder USDC | Crew |
| --- | --- | --- | ---: | ---: | --- |
| `x402-seller-check` | `x402_seller_check` | `target` (HTTPS endpoint, host or EVM payTo) | $0.005 | $0.0025 | watchtower |
| `payment-verify` | `payment_verify` | `chain`, `tx`, `recipient` | $0.002 | $0.001 | watchtower |
| `token-price` | `token_price` | `chain`, `token` | $0.002 | $0.001 | research |
| `wallet-check` | `wallet_check` | `chain`, `address` | $0.003 | $0.0015 | watchtower |
| `tx-explain` | `tx_explain` | `chain`, `tx` | $0.003 | $0.0015 | watchtower |
| `gas-now` | `gas_now` | none (both chains) | $0.002 | $0.001 | research |
| `name-resolve` | `name_resolve` | `chain`, `input` (name or reverse address) | $0.002 | $0.001 | research |

Payment Verify also accepts `token` (USDC by default, otherwise an ERC-20 address) and `minAmount` (decimal string, default zero). At least one matching successful Transfer is required even when the minimum is zero. Split transfers to the recipient are summed. Missing receipt data returns `matchesExpected: null`, while a known pending, reverted or mismatched transaction returns false.

The following are trimmed **offline fixture answers**, not live quotes, identity claims or real payments. The fixture transaction hash is `0x4444444444444444444444444444444444444444444444444444444444444444`; its sender is `0x1111111111111111111111111111111111111111` and recipient is `0x2222222222222222222222222222222222222222`.

- GET `/api/v1/x402-seller-check?target=seller.test`; MCP `{ "target": "seller.test" }`:
  `{ "verdict": "no_issues_found", "summary": "No issues found in the checks that ran.", "bazaar": { "listedResources": 1 }, "probe": { "status": 402, "validX402": true }, "inflows": [{ "count": 1, "sumUsdc": "25", "complete": true }], "unavailable": [] }`
- GET `/api/v1/payment-verify?chain=base&tx=0x4444444444444444444444444444444444444444444444444444444444444444&recipient=0x2222222222222222222222222222222222222222&minAmount=25`; MCP uses the same named arguments:
  `{ "status": "success", "confirmations": 6, "from": "0x1111111111111111111111111111111111111111", "to": "0x2222222222222222222222222222222222222222", "token": "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913", "amount": "25", "matchesExpected": true }`
- GET `/api/v1/token-price?chain=base&token=0x833589fcd6edb6e08f4c7c32d4f71b54bda02913`:
  `{ "priceUsd": 1, "liquidityUsd": 50000, "volume24hUsd": 1000, "change24hPct": -2, "fdv": 100000, "marketCap": 90000, "topPool": { "dex": "uniswap" }, "pairAgeSeconds": 86400, "symbol": "USDC", "decimals": 6 }`
- GET `/api/v1/wallet-check?chain=base&address=0x1111111111111111111111111111111111111111` (the delegated-EOA fixture):
  `{ "kind": "EOA", "delegation": "0x3333333333333333333333333333333333333333", "ethBalance": "1", "usdcBalance": "50", "nonce": 7, "labels": ["EIP-7702 delegated EOA"] }`
- GET `/api/v1/tx-explain?chain=base&tx=0x4444444444444444444444444444444444444444444444444444444444444444`:
  `{ "status": "success", "block": 100, "method": "transfer", "transfers": [{ "kind": "ERC-20", "symbol": "USDC", "amount": "25" }], "gasPaidEth": "0.000021", "gasPaidUsd": 0.0525, "summary": "0x1111…1111 sent 25 USDC to 0x2222…2222." }`
- GET `/api/v1/gas-now`; MCP `{}`:
  `{ "chains": [{ "chain": "ethereum", "baseFeeGwei": "1", "priorityFeeGwei": { "slow": "0.01", "normal": "0.02", "fast": "0.03" }, "costsUsd": { "ethTransfer": 0.05355, "erc20Transfer": 0.16575, "uniswapSwap": 0.459 } }, { "chain": "base", "baseFeeGwei": "1" }], "unavailable": ["Base L1 data fee (transaction dependent; estimates cover execution only)"] }`
- GET `/api/v1/name-resolve?chain=ethereum&input=alice.eth`; reverse uses `input=<address>`, and Base uses `.base.eth` names:
  `{ "direction": "forward", "chain": "ethereum", "name": "alice.eth", "address": "0x2222222222222222222222222222222222222222", "forwardConfirmed": true }`

Each response also identifies the service, generation time, cache status, data age and unavailable reads. A signed paid response keeps the existing payment receipt and PAYMENT-RESPONSE header. MCP arguments mirror query names, with optional `payment` and `holderWallet`.

The Bazaar crawler runs in the background when services initialize. It writes `$DATA_DIR/bazaar-index.json` (default `data/bazaar-index.json`) with resource, host and payTo indexes. A separate `.crawl.json` checkpoint resumes failures; readers retain the previous complete snapshot until the next pass completes. Refresh is every 12 hours, with 1,000 resources per page, 600 ms pacing, three-second HTTP timeouts, atomic file replacement and a page bound. Startup does not await a crawl.

Seller probes make one HTTPS GET after resolving and vetting every DNS address, pin the connection to a vetted address, refuse all redirects, cap the body at 64 KiB and have a four-second total timeout. Live header/body equality is structural JSON equality after base64 decoding. EVM address and amount checks, the network/USDC cross-check and resource-specific Bazaar comparisons run on supported exact EVM requirements. Unsupported schemes or networks are unavailable, rather than labeled fraudulent. Red flags include changed terms, changed recipient/asset/network, changed price, duplicate descriptions and a genuinely supplied recent creation date. First observed, last updated, last called and last paid stay distinct; missing creation/payment dates remain unknown. CDP's documented fields are described in its [discovery API reference](https://docs.cdp.coinbase.com/api-reference/v2/rest-api/x402-facilitator/browse-the-catalog).

Base USDC inflow scans find the seven-day cutoff by block timestamp, then scan at most 40 ranges of 9,000 blocks with four concurrent requests. The window search and scan have a 45-second background scheduling budget, and each RPC read times out after three seconds. At most two distinct payTo addresses are scanned per answer; omissions are explicit. Aggregate results are cached for one hour; raw log arrays are not retained in the shared RPC cache. Failed ranges produce partial observations with `count` and `sumUsdc` null, never an extrapolated or complete zero. Inflow is not evidence that the transfers were x402 sales.

Ordinary answers cache for 30 seconds, names for 60 seconds and gas for 12 seconds. Token metadata/source metadata cache for 60 seconds, DexScreener for 30 seconds and raw RPC reads for 12 seconds. Incomplete answers retry after three seconds. Reads share a 1,150 ms waiting deadline; bounded upstream reads may finish warming caches after the answer. Expensive computations coalesce per input, with 64 active inputs at most. Large verified source files are discarded after extracting the metadata and ABI needed here.

`GET /api/v1/services` now exposes per-offer `latency` with the last 256 computation samples, p50 and p95 in milliseconds. Measurement excludes payment authorization, settlement and transport. Offline runs measured 101 calls per new offer (one initial call and 100 warm hits); warm computation p50 rounded to 0.00 ms and p95 to 0.00–0.02 ms across the fixture runs, at 0.01 ms precision. These are in-memory fixture timings, not production API p95. Stalled-source fixtures verify response completion below 1.5 seconds, including retention of known transfer data when USD pricing stalls. Live payment and upstream latency were not measured.

Modified or added product files:

- `apps/engine/src/services/fast-input.ts`
- `apps/engine/src/services/fast-offers.ts`
- `apps/engine/src/services/bazaar-index.ts`
- `apps/engine/src/services/seller-check.ts`
- `apps/engine/src/services/fast-tools.ts`
- `apps/engine/src/services/fast-tools.test.ts`
- `apps/engine/src/services/catalog.ts`
- `apps/engine/src/services/routes.ts`
- `apps/engine/src/services/mcp.ts`
- `apps/web/src/paidServices.ts`
- `apps/web/src/TryPaid.tsx`
- `apps/web/src/paidLookups.test.ts`
- `apps/web/src/station/Services.tsx`
- `tools/test-house-services.mjs`
- `docs/services/FAST-TOOLS.md`

The Services page reads the catalog and now supplies separate, labeled wallet inputs for each new offer. OpenAPI, llms.txt, agent skills, the services price list and actual MCP tools/list include the seven offers. Existing file line endings were preserved.

Owner edits in protected files remain:

1. In `apps/engine/src/station-routes.ts`, the `start_here` services array already comes from OFFERS. Its separate static `paid.tools` array (currently line 387) needs this replacement:

   ```ts
   tools: ["watchtower_check", "watchtower_watch", "token_verdict", "hook_inspect", "imd_feed", "research_report", "buildcheck_report", "swarm_order", "x402_seller_check", "payment_verify", "token_price", "wallet_check", "tx_explain", "gas_now", "name_resolve"],
   ```

   Its long static MCP instructions string (currently line 332) can also append this sentence before `To act`: `Fast paid tools: x402_seller_check, payment_verify, token_price, wallet_check, tx_explain, gas_now, name_resolve. ` Actual MCP registration already works through `registerServiceTools`.

2. No `server.ts` edits are required. Its existing catch-all `serviceRoutes` call handles the new paths, and the existing MCP registration hooks load the tools.

3. The protected `apps/engine/src/services/house.ts` still imposes the existing non-feed signed-payment limits of 20/IP/minute and 10/payer/minute. They take precedence over the new route ceiling of 300/IP/minute. To permit five paid lookups per second per payer, the owner can add:

   ```ts
   import { isFastId } from "./fast-input.js";
   ```

   and replace the limiter condition immediately after `const feed = o.id === "imd-feed";` (currently lines 108–109) with:

   ```ts
   if (limited(`ip:${ip}`, isFastId(o.id) ? 300 : feed ? 120 : 20, 60_000) || limited(`payer:${v.payer.toLowerCase()}`, isFastId(o.id) ? 300 : feed ? 60 : 10, 60_000)) {
   ```

   No protected file was edited for this task.

Verification uses Node 24.19.0. The normal `npx.cmd vitest run src/services --pool=threads --maxWorkers=1 --no-file-parallelism` hit sandbox `spawn EPERM` in Vite's optional Windows `net use` probe. The supplied fallback executes the same Vitest tests in process, transpiles with the already-installed TypeScript, disables child processes and uses middleware mode without a listening server:

```powershell
# From the repository root:
npx.cmd tsc --noEmit -p apps/engine
node tools/test-house-services.mjs engine src/services
npx.cmd tsc --noEmit -p apps/web
node tools/test-house-services.mjs web src/paidServices.test.ts src/paidLookups.test.ts
```

Verification passed: full engine TypeScript, all 69 engine service tests, full web TypeScript, and all 29 web payment/input tests. Both test suites ran in process. The engine service tests cover all input parsers, payment matching and exact decimals, seller verdict fixtures, private and mapped/private IPv6 addresses, DNS mixtures, redirects, body caps, restart checkpoints, cached expiry, incomplete log windows, token data, gas, wallet delegation, transaction/NFT transfers, names in both directions, Bazaar schema validity, 402 header/body equality, holder prices, MCP registration and rate-limit entry points. The web tests cover the existing wallet payment boundaries and all new input/route builders. No test contacts the network.

Remaining limits are explicit in answers: no live Bazaar snapshot was generated during this task; the first complete crawl happens when the engine next initializes services. Missing discovery creation/last-paid fields cannot be invented. ENS/Basenames support direct on-chain records; inherited/wildcard/off-chain resolution is unavailable. Reverse names must resolve forward to confirm them. Safe labels require a verified Safe proxy source name, recognizable proxy code and a known singleton; unknown variants stay unlabeled. Gas estimates use stated illustrative execution gas units (21,000 / 65,000 / 180,000), and Base L1 data fees require transaction data, so those estimates exclude them. Transaction explanations add a receipt's actual Base L1 fee when supplied. No live end-to-end 1.5-second payment p95 is claimed.
