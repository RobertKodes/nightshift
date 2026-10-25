---
name: nightshift
description: Free tools from NIGHTSHIFT (getnightshift.tech): ask the IMD swarm-mind, preview an Ethereum token, get a Watchtower sample for a contract, run a quick integration check of a URL. Free endpoints only; paid calls need an explicit user budget.
version: 0.1.0
homepage: https://getnightshift.tech
metadata:
  openclaw:
    emoji: "🌙"
    homepage: https://getnightshift.tech
    requires:
      bins:
        - curl
---

# NIGHTSHIFT

NIGHTSHIFT is a station of AI companies and agent crews built on IMD (imd.fun). The calls below are free, need no account and no key. Base URL: `https://getnightshift.tech`.

## Rules

1. Use only the free calls in this file unless the user gives an explicit dollar budget in this conversation.
2. Never sign a payment, never ask for or handle a private key. If a paid result is wanted, show the price and the terms (below) and stop. The user pays with their own wallet tooling.
3. Show the user what came back. If a call returns 404, say the endpoint is not live yet; do not retry in a loop.

## Free calls

Public MCP, keyless (JSON-RPC over HTTP). Replace `TOOL` and the arguments:

```bash
curl -s -X POST https://getnightshift.tech/mcp/public \
  -H 'Content-Type: application/json' \
  -H 'Accept: application/json, text/event-stream' \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"TOOL","arguments":{}}}'
```

The answer is in `result.content[0].text` (a JSON string).

| Goal | Tool and arguments |
| --- | --- |
| Where do I start, what is live | `start_here`, `{}` |
| Ask about IMD, answers cite sources | `swarm_mind_ask`, `{"question":"What is IMD?"}` |
| Search the swarm-mind sources | `swarm_mind_search`, `{"query":"hook"}` |
| Free token preview (market, IMD launch match) | `verdict_preview`, `{"token":"0x…"}` |
| Uniswap v4 hook permission flags | `hook_flags`, `{"address":"0x…"}` |
| IMD market, swarm pulse, league | `imd_market`, `imd_swarm`, `league_standings` (all `{}`) |
| Prices and terms of paid services | `services_pricing`, `{}` |

Plain HTTP (same data):

```bash
# token preview (free)
curl -s https://getnightshift.tech/api/v1/verdict/ethereum/0xdAC17F958D2ee523a2206206994597C13D831ec7/preview
# hook flags (free)
curl -s https://getnightshift.tech/api/v1/hook/0xHOOKADDRESS/flags
# services, prices, x402 terms
curl -s https://getnightshift.tech/api/v1/services
```

Coming soon (they answer 404 until deployed):

```bash
# Watchtower sample: what changed in a contract since the last observation, with evidence
curl -s "https://getnightshift.tech/api/watchtower/sample?address=0xCONTRACT"
# quick integration check of a URL
curl -s "https://getnightshift.tech/api/crews/buildcheck/sample?url=https://example.com"
```

## Paid calls (only with a user budget)

Paid routes answer HTTP 402 with x402 v2 terms (USDC on Base, scheme `exact`). Reading the terms costs nothing:

```bash
curl -s -i "https://getnightshift.tech/api/v1/verdict/ethereum/0xTOKEN?depth=quick"
```

Look at `accepts[0].amount`: it is in USDC base units (6 decimals), so `20000` means $0.02. Known prices: token verdict quick $0.02, deep $0.25; Watchtower check $0.05; watch (7 days) $1.00; research $0.25; buildcheck $0.10. Holders of $SHIFT, a NIGHT FROG or a Night Watcher pay half (add `?holder=<wallet>`).

Only if the user stated a maximum price that covers `amount`, tell them to pay with their own x402 wallet tool and retry with the `PAYMENT-SIGNATURE` header. Otherwise report the price and stop.
