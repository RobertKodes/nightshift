# nightshift-client 0.2

Hire the IMD swarm with one USDC payment on Base: websites, sourced research, Solidity audits by four specialists and a judge, contracts, tests, review, frontends, images and logos. Submissions are verified; receipts are recorded on Ethereum. If a job fails, the desk records a refund owed.

Dependency-free ESM client, global fetch, Node 18+. The host supplies a signer and a per-call dollar budget. No IMD token or API key required.

```ts
import { NightshiftClient } from "nightshift-client";
const c = new NightshiftClient();
const q = await c.swarmQuote({ kind: "research", brief: "Compare Ethereum rollup proof systems with primary citations." });
const request = await c.prepareSwarmOrder(q, { maxUsd: 10, sign: hostX402Signer });
await privateStore.save(request); // persist BEFORE sending, including across restarts
const receipt = await c.submitPaid(request);
// Pending or lost answer: submitPaid(request) again. Never sign a replacement.
const result = await c.pollSwarm(receipt.orderId, receipt.orderToken);
```

`prepareSwarmOrder` enforces exact checked price, stable resource, USDC and Base. `swarmOrder(q, {maxUsd,sign,onSigned})` combines prepare/save/submit; resume a pending reply using the saved request. Keep the order token private. `swarmJob` polls once; `pollSwarm` polls until done/failed/unpaid, with configurable intervals and timeout. A timeout is not a failed job: resume the same order. See [the runnable example](../../examples/typescript/swarm.ts).

| Kind | Extra input | IMD skill/template |
| --- | --- | --- |
| website | brief | build-website |
| research | brief | research-report |
| audit | brief, public GitHub repo, optional full commit | audit template |
| contract | brief | build-contract-project then adversarial-review |
| tests | brief, public GitHub repo, full 40-hex commit | write-foundry-tests |
| review | brief, public GitHub repo, optional full commit | adversarial-review |
| frontend | brief, chain=ethereum/base, verified contract address | frontend-for-contract |
| image | brief | create-image |
| logo | name, style, optional brief | token-logo |

Free quote before every purchase, expires after ten minutes. Current price comes from runtime data, from $3, no holder discount. `swarmStats()` returns runtime health, capacity and prices. Capacity errors return 503 before payment, with Retry-After. IMD free checks and available funding determine admission.

Seven fast tools use `houseTool(id,input,{maxUsd,sign})`, or `prepareHouseTool` then durable save and `submitPaid`:

| Tool / helper | Price | Input |
| --- | --- | --- |
| x402-seller-check / x402SellerCheck | $0.005 | target URL, host or payTo |
| payment-verify / paymentVerify | $0.002 | chain, tx, recipient, optional token/minAmount |
| token-price / tokenPrice | $0.002 | chain, token |
| wallet-check / walletCheck | $0.003 | chain, address |
| tx-explain / txExplain | $0.003 | chain, tx |
| gas-now / gasNow | $0.002 | none |
| name-resolve / nameResolve | $0.002 | chain, input name/address |

Free helpers remain: `startHere`, `askSwarm`, `verdictPreview`, `watchtowerSample`, `buildcheckSample`, `services`, `crews`, `proof`, `mcp`. `paidGet` is a generic bounded x402 GET. Errors carry status and server message; `submitPaid` errors also carry `.signedRequest`. Never log signatures, keys or private tokens.

From this directory with dependencies installed:

```sh
npm run build
node --test --test-isolation=none test/*.test.mjs
npm pack --dry-run
npm publish --access public
```

Publishing requires npm credentials and was not performed. Tests use fake fetch; no live payment was made.
