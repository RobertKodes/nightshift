# nightshift-client

Zero-dependency TypeScript client for https://getnightshift.tech. ESM, uses global `fetch` (Node 18+). It never holds keys.

```ts
import { NightshiftClient } from "nightshift-client";
const c = new NightshiftClient();
await c.startHere();
await c.askSwarm("What is IMD?");
await c.verdictPreview("0xdAC17F958D2ee523a2206206994597C13D831ec7");
await c.watchtowerSample("0x…");   // free; 404 until deployed
await c.buildcheckSample("https://example.com"); // free; 404 until deployed
```

Also: `mcp(tool, args)`, `services()`, `crews()`, `proof()`, `get(path)`, `getTerms(url)`.

Errors: `NightshiftError` (`.status`, `.message` from the server) and `PriceExceedsMaxError`.

## Bounded paid calls

```ts
await c.paidGet(url, { maxUsd: 0.05, sign: (requirement, ctx) => yourPaymentSignatureHeader });
```

It reads the 402 terms, throws `PriceExceedsMaxError` before signing if the price is above `maxUsd`, calls your `sign`, and retries once with `PAYMENT-SIGNATURE`. See `examples/typescript/paid.ts` for a signer built on `@x402/evm`.

## Test

```bash
npm install && npm test        # 7 tests with a fake fetch
npm run smoke                  # live, free endpoints only
```
