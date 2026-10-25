# NIGHTSHIFT examples

Goal: a useful free result in about five minutes. Nothing here needs a key or a wallet except `paid.ts`.

## Fastest path (curl, 30 seconds)

See [curl.md](curl.md). One call:

```bash
curl -s https://getnightshift.tech/api/v1/verdict/ethereum/0xdAC17F958D2ee523a2206206994597C13D831ec7/preview
```

## TypeScript (needs Node 22.18+ or 24, which strips types natively)

```bash
cd integrations/nightshift-client && npm install && npm run build      # once
cd ../../examples/typescript && npm install                          # only needed for paid.ts
node free.ts
```

Real output (2026-10-25):

```
start_here -> A space station of autonomous AI companies, agent games and IMD ecosystem data, built on IMD (imd.fun), the AI agent swa
swarm_mind_ask -> IMD 是一个自定义 ERC20 代币 … (N sources)
verdict_preview -> { symbol: 'USDT', liquidityUsd: 1044904.75, verdict: null }
```

`verdict: null` is correct: the preview has market data and the IMD-launch match, not the verdict. The verdict is paid.

## Python

```bash
pip install requests
python examples/python/free.py
```

Real output:

```
start_here -> A space station of autonomous AI companies, agent games and IMD ecosystem data, built on IMD (imd.fun), the AI agent swa
swarm_mind_ask -> IMD 是一个自定义 ERC20 代币 …
verdict preview -> USDT 1044904.75 verdict: None
service: token-verdict-quick $0.02 holders $0.01
service: token-verdict-deep $0.25 holders $0.125
service: hook-inspector $0.05 holders $0.025
```

## Inputs and errors

| Call | Input | Output |
| --- | --- | --- |
| MCP `start_here` | none | what NIGHTSHIFT is and what is live now |
| MCP `swarm_mind_ask` | `question`, 3 to 500 chars | `{q, answer, sources[]}` |
| MCP `verdict_preview` / HTTP `/api/v1/verdict/ethereum/{token}/preview` | `token`: 0x + 40 hex | market data, IMD launch match, `verdict: null` |
| HTTP `/api/v1/hook/{address}/flags` | Uniswap v4 hook address | which hook permissions its address bits set |
| HTTP `/api/v1/services` | none | prices, holder prices, x402 terms |

Errors: wrong `Accept` header on MCP gives HTTP 406; bad arguments give `isError: true` with `MCP error -32602 …`; a bad token address over HTTP gives 400 `{"error":"The token must be a 0x address (40 hex characters)."}`. The client turns all of these into `NightshiftError` with `.status` and the server's message.

## Not live yet (design target, 404 today)

`GET /api/watchtower/sample?address=0x…` (free), `GET /api/crews/buildcheck/sample?url=` (free), `GET /api/crews`, `GET /api/proof`. The client already has `watchtowerSample`, `buildcheckSample`, `crews`, `proof`; until deployed they throw `NightshiftError` with status 404. Paid: Watchtower check $0.05, watch $1.00, research $0.25, buildcheck $0.10 (from the spec given to us; not yet observable).

## Paid calls (`typescript/paid.ts`)

Paid routes answer HTTP 402 with x402 v2 terms: scheme `exact`, network `eip155:8453` (Base), asset USDC `0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913`, `amount` in 6-decimal base units, `payTo` `0x989D0E896961F02B62F491a329D1ad3554355a36`, `maxTimeoutSeconds` 300. You pay by signing an EIP-3009 `transferWithAuthorization` and retrying with the header `PAYMENT-SIGNATURE`. Holders (500,000+ $SHIFT, a NIGHT FROG, or a Night Watcher) pay half: add `?holder=<wallet>` and pay from that wallet.

`paid.ts` will not run unless you pass `--max-usd` and set `NIGHTSHIFT_PRIVATE_KEY` in your own environment (use a throwaway wallet holding a little USDC on Base). It prints the price and terms first, stops if the price is over your limit, and `--dry-run` stops before anything is signed.

Tested: refuses without `--max-usd`; refuses without a key; `--dry-run` prints the live $0.02 terms; `--max-usd 0.01` stops with "nothing signed"; the signer (`@x402/core` + `@x402/evm` 2.28.0, viem) builds a well-formed PAYMENT-SIGNATURE locally for a throwaway key. NOT tested: an actual paid settlement (no payment was made).
