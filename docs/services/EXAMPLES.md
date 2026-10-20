# House services: real outputs

Every endpoint of the three house services run by NIGHTSHIFT (Token Verdict, Hook Inspector, IMD Data Feed), called once against a local engine on 2026-10-20 21:20 UTC. The engine read Ethereum mainnet (through chain.ts: MEV Blocker, dRPC, publicnode), api.imd.fun, DexScreener, Sourcify, openchain.xyz and the IMD Watchtower (its public status at getnightshift.tech/imd-status/status). Read-only: nothing was signed or sent.

How it was run:

```sh
cd apps/engine && PORT=8782 DATA_DIR=<temp> NIGHTSHIFT_MODE=sim PUBLIC_URL=http://localhost:8782 \
  WATCHTOWER_URL=https://getnightshift.tech/imd-status/status TELEGRAM_BOT_TOKEN= OPENROUTER_API_KEY= npx tsx src/main.ts
```

Notes on reading these:

- The engine ran in **sim mode**, so the paid calls were made with `sim=1`: the answer is computed for real, a demo sale is booked and no money moves (`payment.sim: true`). In live mode the same call without payment answers 402 (shown first) and with a valid `PAYMENT-SIGNATURE` answers the same JSON plus `payment.tx`.
- The `payTo` address is the local sim house wallet (`NIGHTSHIFT Services`, Base Sepolia 84532 in sim). Production has its own house wallet from the server's vault, on Base 8453.
- No `ETHERSCAN_API_KEY` was set, so verified source came from Sourcify only (the answers say so).
- Numbers (prices, liquidity, holders) are the chain's and IMD's at that minute.

## Discovery

### Prices and terms (free)

`GET /api/v1/services` → **200** in 75 ms

```json
{
  "provider": "NIGHTSHIFT Services",
  "runBy": "NIGHTSHIFT",
  "house": true,
  "x402Version": 2,
  "network": "eip155:84532",
  "payTo": "0x3298E55eB31E4C1cEe708E104ae13e00B6d39405",
  "mode": "sim",
  "offers": [
    {
      "id": "token-verdict-quick",
      "name": "Token Verdict (quick)",
      "pitch": "Before you buy: safe, caution or avoid, with reasons and evidence.",
      "priceUsd": 0.02,
      "route": "http://localhost:8782/api/v1/verdict/{chain}/{token}?depth=quick",
      "example": "http://localhost:8782/api/v1/verdict/ethereum/0xe5e58e53d0bb204aa62c995a6c8cc8a48e60c3ac?depth=quick",
      "page": "http://localhost:8782/services/verdict",
      "description": "Use when an agent needs a pre-buy verdict on an Ethereum token, made for IMD launches and Uniswap v4 hook tokens: safe/caution/avoid with cited reasons. Checks IMD launch match, verified source, owner powers (mint, pause, blacklist, fees, proxy), liquidity and v4 pool, holders, a buy-then-sell simulation and copycat symbols. Run by NIGHTSHIFT.",
      "accepts": [
        {
          "scheme": "exact",
          "network": "eip155:84532",
          "asset": "0x036CbD53842c5426634e7929541eC2318f3dCF7e",
          "amount": "20000",
          "payTo": "0x3298E55eB31E4C1cEe708E104ae13e00B6d39405",
          "maxTimeoutSeconds": 300,
          "extra": {
            "name": "USDC",
            "version": "2"
          }
        }
      ]
    },
    {
      "id": "token-verdict-deep",
      "name": "Token Verdict (deep)",
      "pitch": "The quick verdict plus the full hook inspection, IMD's admission checks and a written memo.",
      "priceUsd": 0.25,
      "route": "http://localhost:8782/api/v1/verdict/{chain}/{token}?depth=deep",
      "example": "http://localhost:8782/api/v1/verdict/ethereum/0xe5e58e53d0bb204aa62c995a6c8cc8a48e60c3ac?depth=deep",
      "page": "http://localhost:8782/services/verdict",
      "description": "Use when an agent needs the full pre-buy check on an Ethereum token before a larger trade: everything in the quick Token Verdict plus a full Uniswap v4 hook inspection, IMD admission checks and assurances, a longer holder scan and a written explanation, each claim tied to evidence. Run by NIGHTSHIFT.",
      "accepts": [
        {
          "scheme": "exact",
          "network": "eip155:84532",
          "asset": "0x036CbD53842c5426634e7929541eC2318f3dCF7e",
          "amount": "250000",
          "payTo": "0x3298E55eB31E4C1cEe708E104ae13e00B6d39405",
          "maxTimeoutSeconds": 300,
          "extra": {
            "name": "USDC",
            "version": "2"
          }
        }
      ]
    },
    {
      "id": "hook-inspector",
      "name": "Hook Inspector",
      "pitch": "What a Uniswap v4 hook can do: permissions, fees, owner powers, upgrades.",
      "priceUsd": 0.05,
      "route": "http://localhost:8782/api/v1/hook/{address}",
      "example": "http://localhost:8782/api/v1/hook/0x42ebcf86e3ab0445ba0362f911a7e8fad6ace0cc",
      "page": "http://localhost:8782/services/hook",
      "description": "Use when an agent needs to know what a Uniswap v4 hook on Ethereum can do before trading or providing liquidity through it: permission bits from the address, which callbacks it implements, fee logic and recipients, owner and admin functions with their caps, upgradeability and known templates (IMD launch hooks, NightshiftHook), from verified source or bytecode. Run by NIGHTSHIFT.",
      "accepts": [
        {
          "scheme": "exact",
          "network": "eip155:84532",
          "asset": "0x036CbD53842c5426634e7929541eC2318f3dCF7e",
          "amount": "50000",
          "payTo": "0x3298E55eB31E4C1cEe708E104ae13e00B6d39405",
          "maxTimeoutSeconds": 300,
          "extra": {
            "name": "USDC",
            "version": "2"
          }
        }
      ]
    },
    {
      "id": "hook-inspector-explained",
      "name": "Hook Inspector (explained)",
      "pitch": "The hook inspection with a written explanation and the source lines behind every power.",
      "priceUsd": 0.5,
      "route": "http://localhost:8782/api/v1/hook/{address}?explain=1",
      "example": "http://localhost:8782/api/v1/hook/0x42ebcf86e3ab0445ba0362f911a7e8fad6ace0cc?explain=1",
      "page": "http://localhost:8782/services/hook",
      "description": "Use when an agent or a launch team needs a Uniswap v4 hook explained in plain words: the full Hook Inspector report plus a written explanation of every callback, fee and admin power, with the verified source lines each claim rests on. Ethereum. Run by NIGHTSHIFT.",
      "accepts": [
        {
          "scheme": "exact",
          "network": "eip155:84532",
          "asset": "0x036CbD53842c5426634e7929541eC2318f3dCF7e",
          "amount": "500000",
          "payTo": "0x3298E55eB31E4C1cEe708E104ae13e00B6d39405",
          "maxTimeoutSeconds": 300,
          "extra": {
            "name": "USDC",
            "version": "2"
          }
        }
      ]
    },
    {
      "id": "imd-feed",
      "name": "IMD Data Feed",
      "pitch": "IMD launches, tokens, swarm health and seats, as JSON.",
      "priceUsd": 0.001,
      "route": "http://localhost:8782/api/v1/imd/{launches|launches/{id}|tokens|swarm|agents/{seat}}",
      "example": "http://localhost:8782/api/v1/imd/launches?chain=ethereum&limit=20",
      "page": "http://localhost:8782/services/imd-feed",
      "description": "Use when an agent needs IMD (imd.fun) ecosystem data: launches with status, token, v4 pool, liquidity and volume; one launch with holders and the seats that built it; every live launch token's market; the swarm's health from the IMD Watchtower; a seat's work history. Poll with since= for changes. $0.001 per call, sample=1 free. Run by NIGHTSHIFT.",
      "accepts": [
        {
          "scheme": "exact",
          "network": "eip155:84532",
          "asset": "0x036CbD53842c5426634e7929541eC2318f3dCF7e",
          "amount": "1000",
          "payTo": "0x3298E55eB31E4C1cEe708E104ae13e00B6d39405",
          "maxTimeoutSeconds": 300,
          "extra": {
            "name": "USDC",
            "version": "2"
          }
        }
      ]
    }
  ],
  "free": {
    "verdictPreview": "http://localhost:8782/api/v1/verdict/ethereum/<token>/preview",
    "verdictDemo": "one quick verdict per IP per day: add demo=1",
    "hookFlags": "http://localhost:8782/api/v1/hook/<address>/flags",
    "feedSample": "add sample=1 to any /api/v1/imd/* call"
  },
  "mcp": "http://localhost:8782/mcp/public",
  "openapi": "http://localhost:8782/openapi.json"
}
```

### A paid call without payment: the x402 challenge

`GET /api/v1/verdict/ethereum/0xe5e58e53d0bb204aa62c995a6c8cc8a48e60c3ac?depth=quick` → **402** in 9 ms · `PAYMENT-REQUIRED: eyJ4NDAyVmVyc2lvbiI6MiwiZXJyb3IiOiJwYXltZW50IHJlcXVpcmVkIiwi…`

The same body is in the `PAYMENT-REQUIRED` header, base64. `extensions.bazaar` carries the input and output schema and a real example.

<details><summary>The whole answer (4,760 bytes)</summary>

```json
{
  "x402Version": 2,
  "error": "payment required",
  "resource": {
    "url": "http://localhost:8782/api/v1/verdict/ethereum/0xe5e58e53d0bb204aa62c995a6c8cc8a48e60c3ac?depth=quick",
    "description": "Use when an agent needs a pre-buy verdict on an Ethereum token, made for IMD launches and Uniswap v4 hook tokens: safe/caution/avoid with cited reasons. Checks IMD launch match, verified source, owner powers (mint, pause, blacklist, fees, proxy), liquidity and v4 pool, holders, a buy-then-sell simulation and copycat symbols. Run by NIGHTSHIFT.",
    "mimeType": "application/json"
  },
  "accepts": [
    {
      "scheme": "exact",
      "network": "eip155:84532",
      "asset": "0x036CbD53842c5426634e7929541eC2318f3dCF7e",
      "amount": "20000",
      "payTo": "0x3298E55eB31E4C1cEe708E104ae13e00B6d39405",
      "maxTimeoutSeconds": 300,
      "extra": {
        "name": "USDC",
        "version": "2"
      }
    }
  ],
  "extensions": {
    "bazaar": {
      "info": {
        "input": {
          "type": "http",
          "method": "GET",
          "pathParams": {
            "chain": "ethereum (or 1)",
            "token": "ERC-20 token address"
          },
          "queryParams": {
            "depth": "quick ($0.02) or deep ($0.25: adds the hook inspection, IMD admission checks and a written explanation)"
          }
        },
        "output": {
          "type": "json",
          "example": {
            "service": "token-verdict",
            "runBy": "NIGHTSHIFT",
            "chain": "ethereum",
            "token": "0xe5e58e53d0bb204aa62c995a6c8cc8a48e60c3ac",
            "depth": "quick",
            "verdict": "safe",
            "summary": "$SHIFT (IMD #2124): SAFE. IMD launch #2124 (univ4_hook), deployed by IMD's launch wallet from source built and checked by the IMD swarm. Source verified on Sourcify (LaunchToken).",
            "confidence": {
              "level": "high",
              "score": 1,
              "unknowns": []
            },
            "reasons": [
              {
                "id": "liquidity",
                "impact": "note",
                "text": "$13.1k can be taken out by sellers (the pool's ETH side; $48.0k in all): thin, so large sells move the price.",
                "evidence": [
                  "e8"
                ]
              },
              {
                "id": "sell-tax",
                "impact": "note",
                "text": "Selling costs 4.92% beyond the 1.25% pool fee (taken by the hook). Buying has no extra cost.",
                "evidence": [
                  "e12"
                ]
              },
              {
                "id": "plain",
                "impact": "good",
                "text": "No mint, pause, blacklist, fee or upgrade function anyone controls: a plain ERC-20.",
                "evidence": [
                  "e1",
                  "e6",
                  "e5"
                ]
              }
            ],
            "simulation": {
              "simulated": true,
              "quote": "ETH",
              "buy": {
                "ok": true,
                "taxPct": 0.02
              },
              "sell": {
                "ok": true,
                "taxPct": 4.92
              },
              "router": {
                "ok": true
              }
            },
            "copycat": {
              "signal": "note",
              "text": "Shares the symbol SHIFT with older IMD launches #2031, #2106, but this one has the deepest liquidity of them; later copies: #2126, #2129."
            },
            "evidence": [
              {
                "id": "e12",
                "what": "eth_call: V4 Quoter buy 0.002691 ETH → 102,859.035 tokens; buy-then-sell round trip → 0.002494595 ETH; the same round trip through the Universal Router with real token transfers went through",
                "source": "eth_call"
              }
            ],
            "payment": {
              "tx": "0x5f2c…e1a9",
              "network": "eip155:8453",
              "priceUsd": 0.02
            }
          }
        }
      },
      "schema": {
        "$schema": "https://json-schema.org/draft/2020-12/schema",
        "type": "object",
        "properties": {
          "input": {
            "type": "object",
            "properties": {
              "method": {
                "const": "GET"
              },
              "pathParams": {
                "type": "object",
                "properties": {
                  "chain": {
                    "type": "string",
                    "description": "ethereum (or 1)",
                    "pattern": "^(ethereum|eth|mainnet|1)$"
                  },
                  "token": {
                    "type": "string",
                    "description": "ERC-20 token address",
                    "pattern": "^0x[0-9a-fA-F]{40}$"
                  }
                }
              },
              "queryParams": {
                "type": "object",
                "properties": {
                  "depth": {
                    "type": "string",
                    "enum": [
                      "quick",
                      "deep"
                    ],
                    "description": "quick ($0.02) or deep ($0.25: adds the hook inspection, IMD admission checks and a written explanation)"
                  }
                }
              }
            },
            "description": "No body. Call the route; pay the 402 with an x402 client (EIP-3009 USDC on Base) and repeat the request with the PAYMENT-SIGNATURE header."
          },
          "output": {
            "type": "object",
            "required": [
              "verdict",
              "summary",
              "confidence",
              "reasons",
              "evidence"
            ],
            "properties": {
              "verdict": {
                "type": "string",
                "enum": [
                  "safe",
                  "caution",
                  "avoid"
                ]
              },
              "summary": {
                "type": "string"
              },
              "confidence": {
                "type": "object",
                "properties": {
                  "level": {
                    "type": "string",
                    "enum": [
                      "high",
                      "medium",
                      "low"
                    ]
                  },
                  "score": {
                    "type": "number"
                  },
                  "unknowns": {
                    "type": "array",
                    "items": {
                      "type": "string"
                    }
                  }
                }
              },
              "reasons": {
                "type": "array",
                "items": {
                  "type": "object",
                  "properties": {
                    "id": {
                      "type": "string"
                    },
                    "impact": {
                      "type": "string",
                      "enum": [
                        "avoid",
                        "caution",
                        "note",
                        "good"
                      ]
                    },
                    "text": {
                      "type": "string"
                    },
                    "evidence": {
                      "type": "array",
                      "items": {
                        "type": "string"
                      }
                    }
                  }
                }
              },
              "imd": {
                "type": "object",
                "description": "IMD launch match: launch number, kind, status, repo"
              },
              "source": {
                "type": "object"
              },
              "powers": {
                "type": "object"
              },
              "proxy": {
                "type": "object"
              },
              "market": {
                "type": "object"
              },
              "pool": {
                "type": [
                  "object",
                  "null"
                ]
              },
              "hook": {
                "type": [
                  "object",
                  "null"
                ]
              },
              "holders": {
                "type": "object"
              },
              "simulation": {
                "type": "object"
              },
              "copycat": {
                "type": "object"
              },
              "explanation": {
                "type": "string",
                "description": "deep only"
              },
              "evidence": {
                "type": "array",
                "items": {
                  "type": "object",
                  "properties": {
                    "id": {
                      "type": "string"
                    },
                    "what": {
                      "type": "string"
                    },
                    "source": {
                      "type": "string"
                    },
                    "url": {
                      "type": "string"
                    }
                  }
                }
              },
              "payment": {
                "type": "object",
                "properties": {
                  "tx": {
                    "type": "string"
                  },
                  "network": {
                    "type": "string"
                  },
                  "priceUsd": {
                    "type": "number"
                  }
                }
              }
            }
          }
        }
      }
    }
  },
  "runBy": "NIGHTSHIFT",
  "priceUsd": 0.02
}
```

</details>

## Token Verdict

### Free preview: $SHIFT

`GET /api/v1/verdict/ethereum/0xe5e58e53d0bb204aa62c995a6c8cc8a48e60c3ac/preview` → **200** in 1054 ms

```json
{
  "service": "token-verdict",
  "runBy": "NIGHTSHIFT",
  "preview": true,
  "chain": "ethereum",
  "token": "0xe5e58e53d0bb204aa62c995a6c8cc8a48e60c3ac",
  "imd": {
    "isLaunch": true,
    "role": "token",
    "launchNumber": 2124,
    "kind": "univ4_hook",
    "status": "live",
    "createdAt": "2026-10-18T00:25:34.304Z",
    "url": "https://api.imd.fun/launches/ba3c2a45-99a6-446b-91ab-a839869a08a5"
  },
  "market": {
    "symbol": "SHIFT",
    "priceUsd": 0.00006374,
    "liquidityUsd": 48517.88,
    "volume24hUsd": 3263.04,
    "pair": "https://dexscreener.com/ethereum/0x6775f516eda3ee5cde65ceff94ce98935c7dc1e4d183238a8effa4d50e5c5ed4",
    "dex": "uniswap v4"
  },
  "sameSymbolLaunches": [
    2031,
    2106,
    2126,
    2129
  ],
  "hook": {
    "address": "0x42ebcf86e3ab0445ba0362f911a7e8fad6ace0cc",
    "flags": "0x20cc",
    "template": "NightshiftHook"
  },
  "verdict": null,
  "next": {
    "quick": "/api/v1/verdict/ethereum/0xe5e58e53d0bb204aa62c995a6c8cc8a48e60c3ac?depth=quick",
    "deep": "/api/v1/verdict/ethereum/0xe5e58e53d0bb204aa62c995a6c8cc8a48e60c3ac?depth=deep",
    "demo": "/api/v1/verdict/ethereum/0xe5e58e53d0bb204aa62c995a6c8cc8a48e60c3ac?depth=quick&demo=1"
  },
  "note": "A free preview: no verdict. The verdict ($0.02 quick, $0.25 deep) adds verified source, owner powers, holders, a buy-then-sell simulation and the reasons with their evidence. One quick verdict per IP per day is free with demo=1.",
  "generatedAt": "2026-10-20T21:20:51.016Z"
}
```

### Quick verdict ($0.02): $SHIFT, IMD launch #2124 with the NightshiftHook

`GET /api/v1/verdict/ethereum/0xe5e58e53d0bb204aa62c995a6c8cc8a48e60c3ac?depth=quick&sim=1` → **200** in 2664 ms

Safe: a plain ERC-20 from an IMD launch, verified, liquidity held by IMD's LaunchFactory; the hook's 5% sell fee (2.5% SHIFT + 2.5% ETH) is measured by the simulation at 4.92% beyond the pool fee.

<details><summary>The whole answer (9,664 bytes)</summary>

```json
{
  "service": "token-verdict",
  "runBy": "NIGHTSHIFT",
  "chain": "ethereum",
  "chainId": 1,
  "token": "0xe5e58e53d0bb204aa62c995a6c8cc8a48e60c3ac",
  "depth": "quick",
  "verdict": "safe",
  "summary": "$SHIFT (IMD #2124): SAFE. IMD launch #2124 (univ4_hook), deployed by IMD's launch wallet from source built and checked by the IMD swarm. Source verified on Sourcify (LaunchToken).",
  "confidence": {
    "level": "high",
    "score": 1,
    "checked": [
      "token contract",
      "verified source",
      "owner powers",
      "liquidity",
      "holders",
      "sell simulation",
      "IMD match and copycat"
    ],
    "unknowns": []
  },
  "reasons": [
    {
      "id": "liquidity",
      "impact": "note",
      "text": "$13.3k can be taken out by sellers (the pool's ETH side; $48.5k in all): thin, so large sells move the price.",
      "evidence": [
        "e8"
      ]
    },
    {
      "id": "hook-swaps",
      "impact": "note",
      "text": "The pool's hook (NightshiftHook) runs on swaps (beforeSwap, afterSwap, beforeSwapReturnsDelta, afterSwapReturnsDelta); the simulation below shows what it charges. Deep verdicts inspect it in full.",
      "evidence": [
        "e10"
      ]
    },
    {
      "id": "sell-tax",
      "impact": "note",
      "text": "Selling costs 4.92% beyond the 1.25% pool fee (taken by the hook). Buying has no extra cost.",
      "evidence": [
        "e12"
      ]
    },
    {
      "id": "copycat",
      "impact": "note",
      "text": "Shares the symbol SHIFT with older IMD launches #2031, #2106, but this one has the deepest liquidity of them; later copies: #2126, #2129.",
      "evidence": [
        "e13",
        "e2"
      ]
    },
    {
      "id": "imd-launch",
      "impact": "good",
      "text": "IMD launch #2124 (univ4_hook), deployed by IMD's launch wallet from source built and checked by the IMD swarm.",
      "evidence": [
        "e2"
      ]
    },
    {
      "id": "verified",
      "impact": "good",
      "text": "Source verified on Sourcify (LaunchToken).",
      "evidence": [
        "e4"
      ]
    },
    {
      "id": "plain",
      "impact": "good",
      "text": "No mint, pause, blacklist, fee or upgrade function anyone controls: a plain ERC-20.",
      "evidence": [
        "e1",
        "e6",
        "e5"
      ]
    },
    {
      "id": "lp-held",
      "impact": "good",
      "text": "The pool's liquidity is a position held by IMD LaunchFactory (0x12c6…a96f), which has no function to remove it.",
      "evidence": [
        "e9",
        "e7"
      ]
    },
    {
      "id": "holders",
      "impact": "good",
      "text": "250 holders. Leaving out the pool, burns and IMD's launch contracts, the largest holder has 8.83% (ShiftRewards (verified contract), 0x44ef…30b5) and the top ten 22.02%.",
      "evidence": [
        "e11"
      ]
    }
  ],
  "asset": {
    "name": "NIGHTSHIFT",
    "symbol": "SHIFT",
    "decimals": 18,
    "totalSupply": "1000000000000000000000000000"
  },
  "imd": {
    "isLaunch": true,
    "launchNumber": 2124,
    "id": "ba3c2a45-99a6-446b-91ab-a839869a08a5",
    "kind": "univ4_hook",
    "status": "live",
    "createdAt": "2026-10-18T00:25:34.304Z",
    "repo": "https://github.com/identity-md-launches/launch-2124-launch-nightshift-shift-platform",
    "url": "https://api.imd.fun/launches/ba3c2a45-99a6-446b-91ab-a839869a08a5",
    "role": "token"
  },
  "source": {
    "verified": true,
    "via": "sourcify",
    "contract": "LaunchToken",
    "url": "https://sourcify.dev/server/repo-ui/1/0xe5e58e53d0bb204aa62c995a6c8cc8a48e60c3ac"
  },
  "powers": {
    "owner": {
      "address": null,
      "kind": "none"
    },
    "found": [],
    "plainErc20": true
  },
  "proxy": {
    "proxy": false,
    "kind": null,
    "implementation": null,
    "admin": null
  },
  "market": {
    "priceUsd": 0.00006374,
    "liquidityUsd": 48517.88,
    "exitLiquidityUsd": 13340,
    "liquiditySource": "dexscreener",
    "volume24hUsd": 3263.04,
    "fdvUsd": 63586,
    "txns24h": {
      "buys": 29,
      "sells": 27
    },
    "pairs": 1,
    "pair": {
      "dex": "uniswap v4",
      "url": "https://dexscreener.com/ethereum/0x6775f516eda3ee5cde65ceff94ce98935c7dc1e4d183238a8effa4d50e5c5ed4",
      "id": "0x6775f516eda3ee5cde65ceff94ce98935c7dc1e4d183238a8effa4d50e5c5ed4",
      "quote": "ETH"
    },
    "createdAt": "2026-10-18T00:25:59.000Z"
  },
  "pool": {
    "protocol": "uniswap-v4",
    "poolId": "0x6775f516eda3ee5cde65ceff94ce98935c7dc1e4d183238a8effa4d50e5c5ed4",
    "key": {
      "currency0": "0x0000000000000000000000000000000000000000",
      "currency1": "0xe5e58e53d0bb204aa62c995a6c8cc8a48e60c3ac",
      "fee": 12500,
      "tickSpacing": 60,
      "hooks": "0x42ebcf86e3ab0445ba0362f911a7e8fad6ace0cc"
    },
    "feeBps": 125,
    "tick": 174668,
    "lpHeldBy": "IMD LaunchFactory"
  },
  "hook": {
    "address": "0x42ebcf86e3ab0445ba0362f911a7e8fad6ace0cc",
    "flags": "0x20cc",
    "callbacks": [
      "beforeInitialize",
      "beforeSwap",
      "afterSwap",
      "beforeSwapReturnsDelta",
      "afterSwapReturnsDelta"
    ],
    "template": "NightshiftHook"
  },
  "holders": {
    "complete": true,
    "fromBlock": 26215851,
    "toBlock": 26236448,
    "transfers": 1513,
    "count": 250,
    "top": [
      {
        "address": "0x000000000004444c5dc75cb358380d2e3de08a90",
        "pct": 55.6407,
        "label": "Uniswap v4 PoolManager (pool liquidity)",
        "kind": "pool"
      },
      {
        "address": "0x44ef9ba2dac00b709a7a69a966a7cbc9c5f930b5",
        "pct": 8.8314,
        "label": "ShiftRewards (verified contract)",
        "kind": "contract"
      },
      {
        "address": "0x0d4dd35026087e720033786578a7e718c8b34897",
        "pct": 6.0899,
        "label": "IMD launch distributor (MerkleDistributor)",
        "kind": "launch"
      },
      {
        "address": "0x821eae219c4872ee15c8f1d3147d2b991507a170",
        "pct": 3.3,
        "label": null,
        "kind": "wallet"
      },
      {
        "address": "0xb8290091b406e1882c05c98392eb306a5bb8ac3a",
        "pct": 1.8075,
        "label": null,
        "kind": "wallet"
      },
      {
        "address": "0xcfead54e08892e22b999bd739664a90623d73bbf",
        "pct": 1.6251,
        "label": null,
        "kind": "wallet"
      },
      {
        "address": "0x02bb2a9bec76e6c46ec16893dd96e5b26b454717",
        "pct": 1.3174,
        "label": null,
        "kind": "wallet"
      },
      {
        "address": "0xf50a2c6044cc3a2b0837b30ec1d00a7a3e78cac7",
        "pct": 1.1853,
        "label": null,
        "kind": "wallet"
      },
      {
        "address": "0xbb566feaf52f59ebffc537590b3833294b2028b6",
        "pct": 1.0645,
        "label": null,
        "kind": "wallet"
      },
      {
        "address": "0x92abc2165bb4e23da156035a228b7293497f0690",
        "pct": 0.9808,
        "label": null,
        "kind": "wallet"
      }
    ],
    "top10Pct": 81.84,
    "top10PctExInfra": 22.02,
    "largestWallet": {
      "address": "0x44ef9ba2dac00b709a7a69a966a7cbc9c5f930b5",
      "pct": 8.8314,
      "label": "ShiftRewards (verified contract)",
      "kind": "contract"
    },
    "scanned": "complete since deployment"
  },
  "simulation": {
    "simulated": true,
    "quote": "ETH",
    "amountIn": "0.002721 ETH",
    "buy": {
      "ok": true,
      "out": "103410.76872531061",
      "taxPct": 0.02
    },
    "sell": {
      "ok": true,
      "out": "0.002522406098169652 ETH",
      "taxPct": 4.92
    },
    "sellIntoPoolNow": {
      "ok": true,
      "out": "0.0025214610815087 ETH"
    },
    "router": {
      "ok": true
    },
    "roundTripLossPct": 7.3,
    "poolFeePct": 1.25,
    "note": "A ~$6.67 buy and the sell of what it bought, back to back: quoted by the V4 Quoter (it runs the hook), then sent through the Universal Router with eth_call so the token's transfer code runs both ways. Tax = what is lost beyond the pool's 1.25% fee. Nothing was signed or sent."
  },
  "copycat": {
    "signal": "note",
    "text": "Shares the symbol SHIFT with older IMD launches #2031, #2106, but this one has the deepest liquidity of them; later copies: #2126, #2129.",
    "sameSymbol": [
      {
        "launchNumber": 2031,
        "token": "0x67fd2677383262173b179d02cc026c2c33b1283c",
        "createdAt": "2026-10-16T22:10:11.958Z",
        "liquidityUsd": null,
        "name": "Nightshift"
      },
      {
        "launchNumber": 2106,
        "token": "0x72146197e33147812379bf053e41e9cfd3ccffe4",
        "createdAt": "2026-10-17T18:19:18.935Z",
        "liquidityUsd": null,
        "name": "NightShiftImd"
      },
      {
        "launchNumber": 2126,
        "token": "0x3c5478abf7d455f56c5d4f8370d3059a2f954b05",
        "createdAt": "2026-10-17T23:47:17.767Z",
        "liquidityUsd": null,
        "name": "ShiftToken"
      },
      {
        "launchNumber": 2129,
        "token": "0x6d6e7616c60bde669200522908426af1847ce60c",
        "createdAt": "2026-10-18T00:40:57.063Z",
        "liquidityUsd": null,
        "name": "ShiftToken"
      }
    ]
  },
  "evidence": [
    {
      "id": "e1",
      "what": "NIGHTSHIFT (SHIFT), 18 decimals, supply 1,000,000,000",
      "source": "eth_call"
    },
    {
      "id": "e2",
      "what": "IMD launch #2124 (univ4_hook, live) lists this address as its token",
      "source": "api.imd.fun",
      "url": "https://api.imd.fun/launches/ba3c2a45-99a6-446b-91ab-a839869a08a5"
    },
    {
      "id": "e3",
      "what": "EIP-1967 implementation, admin and beacon slots are empty; not a minimal proxy",
      "source": "eth_getStorageAt"
    },
    {
      "id": "e4",
      "what": "Verified source: LaunchToken, 1 project file(s)",
      "source": "sourcify",
      "url": "https://sourcify.dev/server/repo-ui/1/0xe5e58e53d0bb204aa62c995a6c8cc8a48e60c3ac"
    },
    {
      "id": "e5",
      "what": "No owner() or getOwner() on the token",
      "source": "eth_call"
    },
    {
      "id": "e6",
      "what": "0 function(s) declared in the deployed contract's own source, plus every state-changing function in its ABI (library code such as OpenZeppelin included)",
      "source": "sourcify"
    },
    {
      "id": "e7",
      "what": "Uniswap v4 pool 0x6775f516eda3ee5cde65ceff94ce98935c7dc1e4d183238a8effa4d50e5c5ed4: key from api.imd.fun seeded pool; tick 174668, LP fee 125 bps",
      "source": "eth_getStorageAt"
    },
    {
      "id": "e8",
      "what": "DexScreener: 1 pair(s); deepest uniswap v4 liquidity $48.5k, 24h volume $3.3k",
      "source": "dexscreener",
      "url": "https://dexscreener.com/ethereum/0x6775f516eda3ee5cde65ceff94ce98935c7dc1e4d183238a8effa4d50e5c5ed4"
    },
    {
      "id": "e9",
      "what": "IMD's LaunchFactory and ProjectFactory hold each launch's pool position; their verified ABIs on Sourcify have no function that removes liquidity (only claimFees, withdraw of fees owed and setRequester), checked 2026-10-20",
      "source": "sourcify",
      "url": "https://sourcify.dev/server/v2/contract/1/0x12c63b581d07093f6126bc02263c58f7eadaa96f?fields=abi"
    },
    {
      "id": "e10",
      "what": "Hook 0x42ebcf86e3ab0445ba0362f911a7e8fad6ace0cc: permission bits 0x20cc (beforeInitialize, beforeSwap, afterSwap, beforeSwapReturnsDelta, afterSwapReturnsDelta)",
      "source": "address"
    },
    {
      "id": "e11",
      "what": "Transfer events from block 26215851 to 26236448 (1513 transfers, from deployment: exact)",
      "source": "eth_getLogs"
    },
    {
      "id": "e12",
      "what": "eth_call: V4 Quoter buy 0.002721 ETH → 103,410.769 tokens; buy-then-sell round trip → 0.002522406098169652 ETH; the same round trip through the Universal Router with real token transfers went through",
      "source": "eth_call",
      "block": 26236448
    },
    {
      "id": "e13",
      "what": "4 other IMD launch(es) with symbol SHIFT: #2031, #2106, #2126, #2129 (symbols read on chain for every Ethereum launch token)",
      "source": "api.imd.fun + eth_call"
    }
  ],
  "generatedAt": "2026-10-20T21:20:51.342Z",
  "disclaimer": "Automated on-chain and public-data checks run by NIGHTSHIFT, not financial advice and not an audit. A safe verdict means none of these checks found a problem; it cannot rule out risks they do not cover.",
  "cached": false,
  "dataAgeSeconds": 0,
  "payment": {
    "sim": true,
    "priceUsd": 0.02,
    "note": "Simulation: a demo sale was booked and no money moved."
  }
}
```

</details>

### Deep verdict ($0.25): $SHIFT

`GET /api/v1/verdict/ethereum/0xe5e58e53d0bb204aa62c995a6c8cc8a48e60c3ac?depth=deep&sim=1` → **200** in 2715 ms

Adds IMD's admission checks, the full hook inspection and the written explanation.

<details><summary>The whole answer (17,128 bytes)</summary>

```json
{
  "service": "token-verdict",
  "runBy": "NIGHTSHIFT",
  "chain": "ethereum",
  "chainId": 1,
  "token": "0xe5e58e53d0bb204aa62c995a6c8cc8a48e60c3ac",
  "depth": "deep",
  "verdict": "safe",
  "summary": "$SHIFT (IMD #2124): SAFE. IMD launch #2124 (univ4_hook), deployed by IMD's launch wallet from source built and checked by the IMD swarm. All 7 IMD admission checks passed (provenance, findings, independent review, reproducible bytecode…).",
  "confidence": {
    "level": "high",
    "score": 1,
    "checked": [
      "token contract",
      "verified source",
      "owner powers",
      "liquidity",
      "holders",
      "sell simulation",
      "IMD match and copycat"
    ],
    "unknowns": []
  },
  "reasons": [
    {
      "id": "liquidity",
      "impact": "note",
      "text": "$13.3k can be taken out by sellers (the pool's ETH side; $48.5k in all): thin, so large sells move the price.",
      "evidence": [
        "e9"
      ]
    },
    {
      "id": "sell-tax",
      "impact": "note",
      "text": "Selling costs 4.92% beyond the 1.25% pool fee (taken by the hook). Buying has no extra cost.",
      "evidence": [
        "e14"
      ]
    },
    {
      "id": "copycat",
      "impact": "note",
      "text": "Shares the symbol SHIFT with older IMD launches #2031, #2106, but this one has the deepest liquidity of them; later copies: #2126, #2129.",
      "evidence": [
        "e15",
        "e2"
      ]
    },
    {
      "id": "imd-launch",
      "impact": "good",
      "text": "IMD launch #2124 (univ4_hook), deployed by IMD's launch wallet from source built and checked by the IMD swarm.",
      "evidence": [
        "e2"
      ]
    },
    {
      "id": "imd-admission",
      "impact": "good",
      "text": "All 7 IMD admission checks passed (provenance, findings, independent review, reproducible bytecode…).",
      "evidence": [
        "e3"
      ]
    },
    {
      "id": "verified",
      "impact": "good",
      "text": "Source verified on Sourcify (LaunchToken).",
      "evidence": [
        "e5"
      ]
    },
    {
      "id": "plain",
      "impact": "good",
      "text": "No mint, pause, blacklist, fee or upgrade function anyone controls: a plain ERC-20.",
      "evidence": [
        "e1",
        "e7",
        "e6"
      ]
    },
    {
      "id": "lp-held",
      "impact": "good",
      "text": "The pool's liquidity is a position held by IMD LaunchFactory (0x12c6…a96f), which has no function to remove it.",
      "evidence": [
        "e10",
        "e8"
      ]
    },
    {
      "id": "hook-ok",
      "impact": "good",
      "text": "Hook: runs before every swap and checks tx.origin: swaps can be allowed or refused per wallet (here a launch gate, now open: tradingOpen = true); charges a hook fee on swaps (beforeSwapReturnsDelta and afterSwapReturnsDelta set and it moves pool currency out with PoolManager.take/mint (settings: MAX_FEE_BPS = 250, ethFeeBps = 250, shiftFeeBps = 250), to feeSplitter 0x1119…2d44); the owner can change fees (setFees), capped by MAX_FEE_BPS = 250; the owner is a single wallet (0x6c4c…19b5), not a multisig.",
      "evidence": [
        "e12"
      ]
    },
    {
      "id": "holders",
      "impact": "good",
      "text": "250 holders. Leaving out the pool, burns and IMD's launch contracts, the largest holder has 8.83% (ShiftRewards (verified contract), 0x44ef…30b5) and the top ten 22.02%.",
      "evidence": [
        "e13"
      ]
    }
  ],
  "asset": {
    "name": "NIGHTSHIFT",
    "symbol": "SHIFT",
    "decimals": 18,
    "totalSupply": "1000000000000000000000000000"
  },
  "imd": {
    "isLaunch": true,
    "launchNumber": 2124,
    "id": "ba3c2a45-99a6-446b-91ab-a839869a08a5",
    "kind": "univ4_hook",
    "status": "live",
    "createdAt": "2026-10-18T00:25:34.304Z",
    "repo": "https://github.com/identity-md-launches/launch-2124-launch-nightshift-shift-platform",
    "url": "https://api.imd.fun/launches/ba3c2a45-99a6-446b-91ab-a839869a08a5",
    "role": "token",
    "admission": [
      {
        "name": "provenance",
        "status": "passed",
        "detail": "8 node(s) accepted at 9f3e1600"
      },
      {
        "name": "findings",
        "status": "passed",
        "detail": "8 accepted submission(s), no unresolved blocking findings"
      },
      {
        "name": "independent_review",
        "status": "passed",
        "detail": "1 independent review(s)"
      },
      {
        "name": "bytecode",
        "status": "passed",
        "detail": "5 contract(s) clean and reproducible"
      },
      {
        "name": "manifest",
        "status": "passed",
        "detail": "SHIFT on NightshiftHook, flags 0x20cc"
      },
      {
        "name": "protected_invariants",
        "status": "passed",
        "detail": "invariants-1088d95c9ece: Suite result: ok. 7 passed; 0 failed; 0 skipped; finished in 1.67ms (1.97ms CPU time)"
      },
      {
        "name": "economics",
        "status": "passed",
        "detail": "461 allocation(s), root 0xdbfa342b"
      }
    ],
    "assurances": 0,
    "jobs": [
      {
        "id": "a7490fc5-0042-40c0-96c5-01df79178086",
        "state": "completed"
      }
    ]
  },
  "source": {
    "verified": true,
    "via": "sourcify",
    "contract": "LaunchToken",
    "url": "https://sourcify.dev/server/repo-ui/1/0xe5e58e53d0bb204aa62c995a6c8cc8a48e60c3ac"
  },
  "powers": {
    "owner": {
      "address": null,
      "kind": "none"
    },
    "found": [],
    "plainErc20": true
  },
  "proxy": {
    "proxy": false,
    "kind": null,
    "implementation": null,
    "admin": null
  },
  "market": {
    "priceUsd": 0.00006374,
    "liquidityUsd": 48517.88,
    "exitLiquidityUsd": 13340,
    "liquiditySource": "dexscreener",
    "volume24hUsd": 3263.04,
    "fdvUsd": 63586,
    "txns24h": {
      "buys": 29,
      "sells": 27
    },
    "pairs": 1,
    "pair": {
      "dex": "uniswap v4",
      "url": "https://dexscreener.com/ethereum/0x6775f516eda3ee5cde65ceff94ce98935c7dc1e4d183238a8effa4d50e5c5ed4",
      "id": "0x6775f516eda3ee5cde65ceff94ce98935c7dc1e4d183238a8effa4d50e5c5ed4",
      "quote": "ETH"
    },
    "createdAt": "2026-10-18T00:25:59.000Z"
  },
  "pool": {
    "protocol": "uniswap-v4",
    "poolId": "0x6775f516eda3ee5cde65ceff94ce98935c7dc1e4d183238a8effa4d50e5c5ed4",
    "key": {
      "currency0": "0x0000000000000000000000000000000000000000",
      "currency1": "0xe5e58e53d0bb204aa62c995a6c8cc8a48e60c3ac",
      "fee": 12500,
      "tickSpacing": 60,
      "hooks": "0x42ebcf86e3ab0445ba0362f911a7e8fad6ace0cc"
    },
    "feeBps": 125,
    "tick": 174668,
    "lpHeldBy": "IMD LaunchFactory"
  },
  "hook": {
    "address": "0x42ebcf86e3ab0445ba0362f911a7e8fad6ace0cc",
    "flags": "0x20cc",
    "callbacks": [
      "beforeInitialize",
      "beforeSwap",
      "afterSwap",
      "beforeSwapReturnsDelta",
      "afterSwapReturnsDelta"
    ],
    "template": "NightshiftHook",
    "inspection": {
      "summary": "NightshiftHook. The PoolManager calls beforeInitialize, beforeSwap, afterSwap (with beforeSwapReturnsDelta, afterSwapReturnsDelta). Takes its own fee: beforeSwapReturnsDelta and afterSwapReturnsDelta set and it moves pool currency out with PoolManager.take/mint (settings: MAX_FEE_BPS = 250, ethFeeBps = 250, shiftFeeBps = 250), to feeSplitter 0x1119…2d44. Owner: wallet 0x6c4c…19b5. Not a proxy and no DELEGATECALL: the code cannot change.",
      "risk": "low",
      "powers": [
        {
          "text": "runs before every swap and checks tx.origin: swaps can be allowed or refused per wallet (here a launch gate, now open: tradingOpen = true)",
          "level": "low"
        },
        {
          "text": "charges a hook fee on swaps (beforeSwapReturnsDelta and afterSwapReturnsDelta set and it moves pool currency out with PoolManager.take/mint (settings: MAX_FEE_BPS = 250, ethFeeBps = 250, shiftFeeBps = 250), to feeSplitter 0x1119…2d44)",
          "level": "info"
        },
        {
          "text": "the owner can change fees (setFees), capped by MAX_FEE_BPS = 250",
          "level": "low"
        },
        {
          "text": "the owner is a single wallet (0x6c4c…19b5), not a multisig",
          "level": "low"
        }
      ],
      "fees": {
        "swapFee": "125 bps static",
        "hookFee": "takes its own fee: beforeSwapReturnsDelta and afterSwapReturnsDelta set and it moves pool currency out with PoolManager.take/mint (settings: MAX_FEE_BPS = 250, ethFeeBps = 250, shiftFeeBps = 250), to feeSplitter 0x1119…2d44",
        "parameters": [
          {
            "name": "FIRST_BUYER",
            "type": "address",
            "value": "0x3322e6dd06ade8377f1f1bcb766f6133d7b64d69"
          },
          {
            "name": "MAX_FEE_BPS",
            "type": "uint16",
            "value": 250
          },
          {
            "name": "ethFeeBps",
            "type": "uint16",
            "value": 250
          },
          {
            "name": "factory",
            "type": "address",
            "value": "0x12c63b581d07093f6126bc02263c58f7eadaa96f"
          },
          {
            "name": "feeSplitter",
            "type": "address",
            "value": "0x1119d5df2f046bc2d3c0f6279ef2e9ce49422d44"
          },
          {
            "name": "owner",
            "type": "address",
            "value": "0x6c4c78f2c3bdf4c4318fe305fb1c8bc1694d19b5"
          },
          {
            "name": "pendingEthClaims",
            "type": "uint256",
            "value": 0
          },
          {
            "name": "poolInitialized",
            "type": "bool",
            "value": true
          },
          {
            "name": "poolManager",
            "type": "address",
            "value": "0x000000000004444c5dc75cb358380d2e3de08a90"
          },
          {
            "name": "rewards",
            "type": "address",
            "value": "0x44ef9ba2dac00b709a7a69a966a7cbc9c5f930b5"
          },
          {
            "name": "shift",
            "type": "address",
            "value": "0xe5e58e53d0bb204aa62c995a6c8cc8a48e60c3ac"
          },
          {
            "name": "shiftFeeBps",
            "type": "uint16",
            "value": 250
          },
          {
            "name": "tradingOpen",
            "type": "bool",
            "value": true
          }
        ],
        "recipients": [
          {
            "name": "feeSplitter",
            "address": "0x1119d5df2f046bc2d3c0f6279ef2e9ce49422d44",
            "label": null
          }
        ]
      },
      "owner": {
        "address": "0x6c4c78f2c3bdf4c4318fe305fb1c8bc1694d19b5",
        "kind": "wallet"
      },
      "upgradeable": {
        "proxy": false,
        "kind": null,
        "implementation": null,
        "admin": null,
        "note": "not a proxy and no DELEGATECALL: the code cannot change"
      }
    }
  },
  "holders": {
    "complete": true,
    "fromBlock": 26215851,
    "toBlock": 26236448,
    "transfers": 1513,
    "count": 250,
    "top": [
      {
        "address": "0x000000000004444c5dc75cb358380d2e3de08a90",
        "pct": 55.6407,
        "label": "Uniswap v4 PoolManager (pool liquidity)",
        "kind": "pool"
      },
      {
        "address": "0x44ef9ba2dac00b709a7a69a966a7cbc9c5f930b5",
        "pct": 8.8314,
        "label": "ShiftRewards (verified contract)",
        "kind": "contract"
      },
      {
        "address": "0x0d4dd35026087e720033786578a7e718c8b34897",
        "pct": 6.0899,
        "label": "IMD launch distributor (MerkleDistributor)",
        "kind": "launch"
      },
      {
        "address": "0x821eae219c4872ee15c8f1d3147d2b991507a170",
        "pct": 3.3,
        "label": null,
        "kind": "wallet"
      },
      {
        "address": "0xb8290091b406e1882c05c98392eb306a5bb8ac3a",
        "pct": 1.8075,
        "label": null,
        "kind": "wallet"
      },
      {
        "address": "0xcfead54e08892e22b999bd739664a90623d73bbf",
        "pct": 1.6251,
        "label": null,
        "kind": "wallet"
      },
      {
        "address": "0x02bb2a9bec76e6c46ec16893dd96e5b26b454717",
        "pct": 1.3174,
        "label": null,
        "kind": "wallet"
      },
      {
        "address": "0xf50a2c6044cc3a2b0837b30ec1d00a7a3e78cac7",
        "pct": 1.1853,
        "label": null,
        "kind": "wallet"
      },
      {
        "address": "0xbb566feaf52f59ebffc537590b3833294b2028b6",
        "pct": 1.0645,
        "label": null,
        "kind": "wallet"
      },
      {
        "address": "0x92abc2165bb4e23da156035a228b7293497f0690",
        "pct": 0.9808,
        "label": null,
        "kind": "wallet"
      }
    ],
    "top10Pct": 81.84,
    "top10PctExInfra": 22.02,
    "largestWallet": {
      "address": "0x44ef9ba2dac00b709a7a69a966a7cbc9c5f930b5",
      "pct": 8.8314,
      "label": "ShiftRewards (verified contract)",
      "kind": "contract"
    },
    "scanned": "complete since deployment"
  },
  "simulation": {
    "simulated": true,
    "quote": "ETH",
    "amountIn": "0.002721 ETH",
    "buy": {
      "ok": true,
      "out": "103410.76872531061",
      "taxPct": 0.02
    },
    "sell": {
      "ok": true,
      "out": "0.002522406098169652 ETH",
      "taxPct": 4.92
    },
    "sellIntoPoolNow": {
      "ok": true,
      "out": "0.0025214610815087 ETH"
    },
    "router": {
      "ok": true
    },
    "roundTripLossPct": 7.3,
    "poolFeePct": 1.25,
    "note": "A ~$6.67 buy and the sell of what it bought, back to back: quoted by the V4 Quoter (it runs the hook), then sent through the Universal Router with eth_call so the token's transfer code runs both ways. Tax = what is lost beyond the pool's 1.25% fee. Nothing was signed or sent."
  },
  "copycat": {
    "signal": "note",
    "text": "Shares the symbol SHIFT with older IMD launches #2031, #2106, but this one has the deepest liquidity of them; later copies: #2126, #2129.",
    "sameSymbol": [
      {
        "launchNumber": 2031,
        "token": "0x67fd2677383262173b179d02cc026c2c33b1283c",
        "createdAt": "2026-10-16T22:10:11.958Z",
        "liquidityUsd": null,
        "name": "Nightshift"
      },
      {
        "launchNumber": 2106,
        "token": "0x72146197e33147812379bf053e41e9cfd3ccffe4",
        "createdAt": "2026-10-17T18:19:18.935Z",
        "liquidityUsd": null,
        "name": "NightShiftImd"
      },
      {
        "launchNumber": 2126,
        "token": "0x3c5478abf7d455f56c5d4f8370d3059a2f954b05",
        "createdAt": "2026-10-17T23:47:17.767Z",
        "liquidityUsd": null,
        "name": "ShiftToken"
      },
      {
        "launchNumber": 2129,
        "token": "0x6d6e7616c60bde669200522908426af1847ce60c",
        "createdAt": "2026-10-18T00:40:57.063Z",
        "liquidityUsd": null,
        "name": "ShiftToken"
      }
    ]
  },
  "evidence": [
    {
      "id": "e1",
      "what": "NIGHTSHIFT (SHIFT), 18 decimals, supply 1,000,000,000",
      "source": "eth_call"
    },
    {
      "id": "e2",
      "what": "IMD launch #2124 (univ4_hook, live) lists this address as its token",
      "source": "api.imd.fun",
      "url": "https://api.imd.fun/launches/ba3c2a45-99a6-446b-91ab-a839869a08a5"
    },
    {
      "id": "e3",
      "what": "IMD admission checks: provenance passed, findings passed, independent_review passed, bytecode passed, manifest passed, protected_invariants passed, economics passed",
      "source": "api.imd.fun",
      "url": "https://api.imd.fun/launches/ba3c2a45-99a6-446b-91ab-a839869a08a5"
    },
    {
      "id": "e4",
      "what": "EIP-1967 implementation, admin and beacon slots are empty; not a minimal proxy",
      "source": "eth_getStorageAt"
    },
    {
      "id": "e5",
      "what": "Verified source: LaunchToken, 1 project file(s)",
      "source": "sourcify",
      "url": "https://sourcify.dev/server/repo-ui/1/0xe5e58e53d0bb204aa62c995a6c8cc8a48e60c3ac"
    },
    {
      "id": "e6",
      "what": "No owner() or getOwner() on the token",
      "source": "eth_call"
    },
    {
      "id": "e7",
      "what": "0 function(s) declared in the deployed contract's own source, plus every state-changing function in its ABI (library code such as OpenZeppelin included)",
      "source": "sourcify"
    },
    {
      "id": "e8",
      "what": "Uniswap v4 pool 0x6775f516eda3ee5cde65ceff94ce98935c7dc1e4d183238a8effa4d50e5c5ed4: key from api.imd.fun seeded pool; tick 174668, LP fee 125 bps",
      "source": "eth_getStorageAt"
    },
    {
      "id": "e9",
      "what": "DexScreener: 1 pair(s); deepest uniswap v4 liquidity $48.5k, 24h volume $3.3k",
      "source": "dexscreener",
      "url": "https://dexscreener.com/ethereum/0x6775f516eda3ee5cde65ceff94ce98935c7dc1e4d183238a8effa4d50e5c5ed4"
    },
    {
      "id": "e10",
      "what": "IMD's LaunchFactory and ProjectFactory hold each launch's pool position; their verified ABIs on Sourcify have no function that removes liquidity (only claimFees, withdraw of fees owed and setRequester), checked 2026-10-20",
      "source": "sourcify",
      "url": "https://sourcify.dev/server/v2/contract/1/0x12c63b581d07093f6126bc02263c58f7eadaa96f?fields=abi"
    },
    {
      "id": "e11",
      "what": "Hook 0x42ebcf86e3ab0445ba0362f911a7e8fad6ace0cc: permission bits 0x20cc (beforeInitialize, beforeSwap, afterSwap, beforeSwapReturnsDelta, afterSwapReturnsDelta)",
      "source": "address"
    },
    {
      "id": "e12",
      "what": "Hook inspection: NightshiftHook. The PoolManager calls beforeInitialize, beforeSwap, afterSwap (with beforeSwapReturnsDelta, afterSwapReturnsDelta). Takes its own fee: beforeSwapReturnsDelta and afterSwapReturnsDelta set and it moves pool currency out with PoolManager.take/mint (settings: MAX_FEE_BPS = 250, ethFeeBps = 250, shiftFeeBps = 250), to feeSplitter 0x1119…2d44. Owner: wallet 0x6c4c…19b5. Not a proxy and no DELEGATECALL: the code cannot change.",
      "source": "hook-inspector",
      "url": "/api/v1/hook/0x42ebcf86e3ab0445ba0362f911a7e8fad6ace0cc"
    },
    {
      "id": "e13",
      "what": "Transfer events from block 26215851 to 26236448 (1513 transfers, from deployment: exact)",
      "source": "eth_getLogs"
    },
    {
      "id": "e14",
      "what": "eth_call: V4 Quoter buy 0.002721 ETH → 103,410.769 tokens; buy-then-sell round trip → 0.002522406098169652 ETH; the same round trip through the Universal Router with real token transfers went through",
      "source": "eth_call",
      "block": 26236448
    },
    {
      "id": "e15",
      "what": "4 other IMD launch(es) with symbol SHIFT: #2031, #2106, #2126, #2129 (symbols read on chain for every Ethereum launch token)",
      "source": "api.imd.fun + eth_call"
    }
  ],
  "generatedAt": "2026-10-20T21:20:53.773Z",
  "disclaimer": "Automated on-chain and public-data checks run by NIGHTSHIFT, not financial advice and not an audit. A safe verdict means none of these checks found a problem; it cannot rule out risks they do not cover.",
  "explanation": "$SHIFT (0xe5e58e53d0bb204aa62c995a6c8cc8a48e60c3ac) on Ethereum: SAFE, with high confidence (100% of the checks ran).\n\nIt is IMD launch #2124, a univ4_hook launch whose source is public at https://github.com/identity-md-launches/launch-2124-launch-nightshift-shift-platform. IMD's launch wallet deployed it from the code its swarm built and checked.\n\nWorth knowing:\n- $13.3k can be taken out by sellers (the pool's ETH side; $48.5k in all): thin, so large sells move the price.\n- Selling costs 4.92% beyond the 1.25% pool fee (taken by the hook). Buying has no extra cost.\n- Shares the symbol SHIFT with older IMD launches #2031, #2106, but this one has the deepest liquidity of them; later copies: #2126, #2129.\n\nWhat checks out:\n- IMD launch #2124 (univ4_hook), deployed by IMD's launch wallet from source built and checked by the IMD swarm.\n- All 7 IMD admission checks passed (provenance, findings, independent review, reproducible bytecode…).\n- Source verified on Sourcify (LaunchToken).\n- No mint, pause, blacklist, fee or upgrade function anyone controls: a plain ERC-20.\n- The pool's liquidity is a position held by IMD LaunchFactory (0x12c6…a96f), which has no function to remove it.\n- Hook: runs before every swap and checks tx.origin: swaps can be allowed or refused per wallet (here a launch gate, now open: tradingOpen = true); charges a hook fee on swaps (beforeSwapReturnsDelta and afterSwapReturnsDelta set and it moves pool currency out with PoolManager.take/mint (settings: MAX_FEE_BPS = 250, ethFeeBps = 250, shiftFeeBps = 250), to feeSplitter 0x1119…2d44); the owner can change fees (setFees), capped by MAX_FEE_BPS = 250; the owner is a single wallet (0x6c4c…19b5), not a multisig.\n- 250 holders. Leaving out the pool, burns and IMD's launch contracts, the largest holder has 8.83% (ShiftRewards (verified contract), 0x44ef…30b5) and the top ten 22.02%.\n\nThe simulation bought with 0.002721 ETH and sold it back: a round trip loses 7.3%, including the pool fee of 1.25% each way.\n\nThe pool's hook: NightshiftHook. The PoolManager calls beforeInitialize, beforeSwap, afterSwap (with beforeSwapReturnsDelta, afterSwapReturnsDelta). Takes its own fee: beforeSwapReturnsDelta and afterSwapReturnsDelta set and it moves pool currency out with PoolManager.take/mint (settings: MAX_FEE_BPS = 250, ethFeeBps = 250, shiftFeeBps = 250), to feeSplitter 0x1119…2d44. Owner: wallet 0x6c4c…19b5. Not a proxy and no DELEGATECALL: the code cannot change.\n\nThis memo is written by NIGHTSHIFT's rules from the evidence listed with it. It is not financial advice and not an audit.",
  "cached": false,
  "dataAgeSeconds": 0,
  "payment": {
    "sim": true,
    "priceUsd": 0.25,
    "note": "Simulation: a demo sale was booked and no money moved."
  }
}
```

</details>

### Quick verdict: a later SHIFT copy (IMD launch #2129)

`GET /api/v1/verdict/ethereum/0x6d6e7616c60bde669200522908426af1847ce60c?depth=quick&sim=1` → **200** in 2828 ms

A likely copycat of #2124 (same symbol and name, launched 15 minutes later, no liquidity), and a pool that holds no IMD.

<details><summary>The whole answer (9,264 bytes)</summary>

```json
{
  "service": "token-verdict",
  "runBy": "NIGHTSHIFT",
  "chain": "ethereum",
  "chainId": 1,
  "token": "0x6d6e7616c60bde669200522908426af1847ce60c",
  "depth": "quick",
  "verdict": "caution",
  "summary": "$SHIFT (IMD #2129): CAUTION. The pool holds no IMD right now: nobody has bought yet, or every buyer has sold. Only what buyers put in can come out. Likely a copycat: IMD launch #2031 came first with the symbol SHIFT, and #2124 has more liquidity ($48.5k).",
  "confidence": {
    "level": "high",
    "score": 1,
    "checked": [
      "token contract",
      "verified source",
      "owner powers",
      "liquidity",
      "holders",
      "sell simulation",
      "IMD match and copycat"
    ],
    "unknowns": []
  },
  "reasons": [
    {
      "id": "liquidity",
      "impact": "caution",
      "text": "The pool holds no IMD right now: nobody has bought yet, or every buyer has sold. Only what buyers put in can come out.",
      "evidence": [
        "e9"
      ]
    },
    {
      "id": "copycat",
      "impact": "caution",
      "text": "Likely a copycat: IMD launch #2031 came first with the symbol SHIFT, and #2124 has more liquidity ($48.5k).",
      "evidence": [
        "e14",
        "e2"
      ]
    },
    {
      "id": "imd-launch",
      "impact": "good",
      "text": "IMD launch #2129 (custom_token), deployed by IMD's launch wallet from source built and checked by the IMD swarm.",
      "evidence": [
        "e2"
      ]
    },
    {
      "id": "verified",
      "impact": "good",
      "text": "Source verified on Sourcify (ShiftToken).",
      "evidence": [
        "e4"
      ]
    },
    {
      "id": "plain",
      "impact": "good",
      "text": "No mint, pause, blacklist, fee or upgrade function anyone controls: a plain ERC-20.",
      "evidence": [
        "e1",
        "e6",
        "e5"
      ]
    },
    {
      "id": "lp-held",
      "impact": "good",
      "text": "The pool's liquidity is a position held by IMD ProjectFactory (0xff03…7120), which has no function to remove it.",
      "evidence": [
        "e10",
        "e7"
      ]
    },
    {
      "id": "hook-quiet",
      "impact": "good",
      "text": "The pool's hook (IMD PoolInitializationGuard) never runs on swaps or liquidity (beforeInitialize).",
      "evidence": [
        "e11"
      ]
    },
    {
      "id": "holders",
      "impact": "good",
      "text": "25 holders. Leaving out the pool, burns and IMD's launch contracts, the largest holder has 10% (a wallet, 0x612a…3367) and the top ten 10.52%.",
      "evidence": [
        "e12"
      ]
    },
    {
      "id": "sell-ok",
      "impact": "good",
      "text": "A ~$0.1 buy and its sell both go through, through the Quoter and the Universal Router, with no cost beyond the 1.25% pool fee.",
      "evidence": [
        "e13"
      ]
    }
  ],
  "asset": {
    "name": "NIGHTSHIFT",
    "symbol": "SHIFT",
    "decimals": 18,
    "totalSupply": "1000000000000000000000000000"
  },
  "imd": {
    "isLaunch": true,
    "launchNumber": 2129,
    "id": "e5c1c0dd-1f39-47d0-9c04-abbf6edcee05",
    "kind": "custom_token",
    "status": "live",
    "createdAt": "2026-10-18T00:40:57.063Z",
    "repo": "https://github.com/identity-md-launches/launch-2129-nightshift",
    "url": "https://api.imd.fun/launches/e5c1c0dd-1f39-47d0-9c04-abbf6edcee05",
    "role": "token"
  },
  "source": {
    "verified": true,
    "via": "sourcify",
    "contract": "ShiftToken",
    "url": "https://sourcify.dev/server/repo-ui/1/0x6d6e7616c60bde669200522908426af1847ce60c"
  },
  "powers": {
    "owner": {
      "address": null,
      "kind": "none"
    },
    "found": [],
    "plainErc20": true
  },
  "proxy": {
    "proxy": false,
    "kind": null,
    "implementation": null,
    "admin": null
  },
  "market": {
    "priceUsd": null,
    "liquidityUsd": null,
    "exitLiquidityUsd": 0,
    "liquiditySource": "onchain",
    "volume24hUsd": null,
    "fdvUsd": null,
    "txns24h": null,
    "pairs": 0,
    "pair": null,
    "createdAt": null
  },
  "pool": {
    "protocol": "uniswap-v4",
    "poolId": "0x5201f9390c146826cd02f8b92b1057520321da6f16a0e45b83e78c45705fb258",
    "key": {
      "currency0": "0x6d6e7616c60bde669200522908426af1847ce60c",
      "currency1": "0xd34a99bc0f67ae1bbd63c660e6d0b0dd03e263b7",
      "fee": 12500,
      "tickSpacing": 60,
      "hooks": "0x784ff9a3ac5d88a30bfff6f7f2a270161fbe6000"
    },
    "feeBps": 125,
    "tick": -108204,
    "lpHeldBy": "IMD ProjectFactory"
  },
  "hook": {
    "address": "0x784ff9a3ac5d88a30bfff6f7f2a270161fbe6000",
    "flags": "0x2000",
    "callbacks": [
      "beforeInitialize"
    ],
    "template": "IMD PoolInitializationGuard"
  },
  "holders": {
    "complete": true,
    "fromBlock": 26215929,
    "toBlock": 26236448,
    "transfers": 26,
    "count": 25,
    "top": [
      {
        "address": "0x000000000004444c5dc75cb358380d2e3de08a90",
        "pct": 79.9999,
        "label": "Uniswap v4 PoolManager (pool liquidity)",
        "kind": "pool"
      },
      {
        "address": "0x612a9bb008e16ef2d24f41dae9fc661831d93367",
        "pct": 10,
        "label": null,
        "kind": "wallet"
      },
      {
        "address": "0x2a24c66a2758bdc47d27d74a241c4df0c3a80ee0",
        "pct": 9.3817,
        "label": "IMD launch distributor (MerkleDistributor)",
        "kind": "launch"
      },
      {
        "address": "0x835a902d7682d6eb5052ccd6d8aac199ef80d67d",
        "pct": 0.341,
        "label": null,
        "kind": "wallet"
      },
      {
        "address": "0x6d2f9da1911e88a116c6228f07e7cab9a927be9e",
        "pct": 0.0769,
        "label": null,
        "kind": "wallet"
      },
      {
        "address": "0xf8ac5532cf5d261c00c5a71c246225256db6424d",
        "pct": 0.0461,
        "label": null,
        "kind": "wallet"
      },
      {
        "address": "0xcd5a046e76029fccc360ea842a1c42bc4b302c2f",
        "pct": 0.0153,
        "label": null,
        "kind": "wallet"
      },
      {
        "address": "0x5a467eca7481ec1c0f2a8df646d3c4fde6e5f847",
        "pct": 0.0076,
        "label": null,
        "kind": "wallet"
      },
      {
        "address": "0x7d5e92853599b792ccb65a6e9b1fc26c663f6563",
        "pct": 0.0076,
        "label": null,
        "kind": "wallet"
      },
      {
        "address": "0xa1e84210239bad5571171a8fe304a90e7ffe5189",
        "pct": 0.0076,
        "label": null,
        "kind": "wallet"
      }
    ],
    "top10Pct": 99.88,
    "top10PctExInfra": 10.52,
    "largestWallet": {
      "address": "0x612a9bb008e16ef2d24f41dae9fc661831d93367",
      "pct": 10,
      "label": null,
      "kind": "wallet"
    },
    "scanned": "complete since deployment"
  },
  "simulation": {
    "simulated": true,
    "quote": "IMD",
    "amountIn": "0.016978 IMD",
    "buy": {
      "ok": true,
      "out": "836.3460122868482",
      "taxPct": 0.23
    },
    "sell": {
      "ok": true,
      "out": "0.016556203028854913 IMD",
      "taxPct": 0
    },
    "sellIntoPoolNow": {
      "ok": false,
      "reason": "NotEnoughLiquidity (the pool has none of the output token at this price)"
    },
    "router": {
      "ok": true
    },
    "roundTripLossPct": 2.48,
    "poolFeePct": 1.25,
    "note": "A ~$0.1 buy and the sell of what it bought, back to back: quoted by the V4 Quoter (it runs the hook), then sent through the Universal Router with eth_call so the token's transfer code runs both ways. Tax = what is lost beyond the pool's 1.25% fee. Nothing was signed or sent."
  },
  "copycat": {
    "signal": "likely",
    "text": "Likely a copycat: IMD launch #2031 came first with the symbol SHIFT, and #2124 has more liquidity ($48.5k).",
    "sameSymbol": [
      {
        "launchNumber": 2031,
        "token": "0x67fd2677383262173b179d02cc026c2c33b1283c",
        "createdAt": "2026-10-16T22:10:11.958Z",
        "liquidityUsd": null,
        "name": "Nightshift"
      },
      {
        "launchNumber": 2106,
        "token": "0x72146197e33147812379bf053e41e9cfd3ccffe4",
        "createdAt": "2026-10-17T18:19:18.935Z",
        "liquidityUsd": null,
        "name": "NightShiftImd"
      },
      {
        "launchNumber": 2124,
        "token": "0xe5e58e53d0bb204aa62c995a6c8cc8a48e60c3ac",
        "createdAt": "2026-10-18T00:25:34.304Z",
        "liquidityUsd": 48517.88,
        "name": "ShiftToken"
      },
      {
        "launchNumber": 2126,
        "token": "0x3c5478abf7d455f56c5d4f8370d3059a2f954b05",
        "createdAt": "2026-10-17T23:47:17.767Z",
        "liquidityUsd": null,
        "name": "ShiftToken"
      }
    ]
  },
  "evidence": [
    {
      "id": "e1",
      "what": "NIGHTSHIFT (SHIFT), 18 decimals, supply 1,000,000,000",
      "source": "eth_call"
    },
    {
      "id": "e2",
      "what": "IMD launch #2129 (custom_token, live) lists this address as its token",
      "source": "api.imd.fun",
      "url": "https://api.imd.fun/launches/e5c1c0dd-1f39-47d0-9c04-abbf6edcee05"
    },
    {
      "id": "e3",
      "what": "EIP-1967 implementation, admin and beacon slots are empty; not a minimal proxy",
      "source": "eth_getStorageAt"
    },
    {
      "id": "e4",
      "what": "Verified source: ShiftToken, 1 project file(s)",
      "source": "sourcify",
      "url": "https://sourcify.dev/server/repo-ui/1/0x6d6e7616c60bde669200522908426af1847ce60c"
    },
    {
      "id": "e5",
      "what": "No owner() or getOwner() on the token",
      "source": "eth_call"
    },
    {
      "id": "e6",
      "what": "12 function(s) declared in the deployed contract's own source, plus every state-changing function in its ABI (library code such as OpenZeppelin included)",
      "source": "sourcify"
    },
    {
      "id": "e7",
      "what": "Uniswap v4 pool 0x5201f9390c146826cd02f8b92b1057520321da6f16a0e45b83e78c45705fb258: key from api.imd.fun seeded pool; tick -108204, LP fee 125 bps",
      "source": "eth_getStorageAt"
    },
    {
      "id": "e8",
      "what": "DexScreener lists no pair for this token",
      "source": "dexscreener",
      "url": "https://api.dexscreener.com/tokens/v1/ethereum/0x6d6e7616c60bde669200522908426af1847ce60c"
    },
    {
      "id": "e9",
      "what": "On-chain liquidity: the IMD-seeded position's amounts at the current price, valued at IMD $5.89",
      "source": "eth_getStorageAt"
    },
    {
      "id": "e10",
      "what": "IMD's LaunchFactory and ProjectFactory hold each launch's pool position; their verified ABIs on Sourcify have no function that removes liquidity (only claimFees, withdraw of fees owed and setRequester), checked 2026-10-20",
      "source": "sourcify",
      "url": "https://sourcify.dev/server/v2/contract/1/0xff03410d0fe5fa8f7f59f743de35e333d9857120?fields=abi"
    },
    {
      "id": "e11",
      "what": "Hook 0x784ff9a3ac5d88a30bfff6f7f2a270161fbe6000: permission bits 0x2000 (beforeInitialize)",
      "source": "address"
    },
    {
      "id": "e12",
      "what": "Transfer events from block 26215929 to 26236448 (26 transfers, from deployment: exact)",
      "source": "eth_getLogs"
    },
    {
      "id": "e13",
      "what": "eth_call: V4 Quoter buy 0.016978 IMD → 836.346 tokens; buy-then-sell round trip → 0.016556203028854913 IMD; the same round trip through the Universal Router with real token transfers went through",
      "source": "eth_call",
      "block": 26236448
    },
    {
      "id": "e14",
      "what": "4 other IMD launch(es) with symbol SHIFT: #2031, #2106, #2124, #2126 (symbols read on chain for every Ethereum launch token)",
      "source": "api.imd.fun + eth_call"
    }
  ],
  "generatedAt": "2026-10-20T21:20:56.619Z",
  "disclaimer": "Automated on-chain and public-data checks run by NIGHTSHIFT, not financial advice and not an audit. A safe verdict means none of these checks found a problem; it cannot rule out risks they do not cover.",
  "cached": false,
  "dataAgeSeconds": 0,
  "payment": {
    "sim": true,
    "priceUsd": 0.02,
    "note": "Simulation: a demo sale was booked and no money moved."
  }
}
```

</details>

### Quick verdict: an unverified IMD launch token (#2226, TORCHINU)

`GET /api/v1/verdict/ethereum/0x1e0381f367a82da1b6136606f894f17ed05d8c5e?depth=quick&sim=1` → **200** in 2141 ms

Not on Sourcify: the powers are read from the bytecode, the confidence drops and the verdict is caution.

<details><summary>The whole answer (8,180 bytes)</summary>

```json
{
  "service": "token-verdict",
  "runBy": "NIGHTSHIFT",
  "chain": "ethereum",
  "chainId": 1,
  "token": "0x1e0381f367a82da1b6136606f894f17ed05d8c5e",
  "depth": "quick",
  "verdict": "caution",
  "summary": "$TORCHINU (IMD #2226): CAUTION. Source not verified (sourcify): powers below are read from the bytecode alone, so who may call them cannot be seen. The pool holds no IMD right now: nobody has bought yet, or every buyer has sold. Only what buyers put in can come out.",
  "confidence": {
    "level": "medium",
    "score": 0.8,
    "checked": [
      "token contract",
      "owner powers",
      "liquidity",
      "holders",
      "sell simulation",
      "IMD match and copycat"
    ],
    "unknowns": [
      "verified source: Not verified on Sourcify (Etherscan not checked: the server has no ETHERSCAN_API_KEY)."
    ]
  },
  "reasons": [
    {
      "id": "unverified",
      "impact": "caution",
      "text": "Source not verified (sourcify): powers below are read from the bytecode alone, so who may call them cannot be seen.",
      "evidence": [
        "e4"
      ]
    },
    {
      "id": "liquidity",
      "impact": "caution",
      "text": "The pool holds no IMD right now: nobody has bought yet, or every buyer has sold. Only what buyers put in can come out.",
      "evidence": [
        "e9"
      ]
    },
    {
      "id": "imd-launch",
      "impact": "good",
      "text": "IMD launch #2226 (custom_token), deployed by IMD's launch wallet from source built and checked by the IMD swarm.",
      "evidence": [
        "e2"
      ]
    },
    {
      "id": "plain",
      "impact": "good",
      "text": "No mint, pause, blacklist, fee or upgrade selector in the bytecode.",
      "evidence": [
        "e1",
        "e6",
        "e5"
      ]
    },
    {
      "id": "lp-held",
      "impact": "good",
      "text": "The pool's liquidity is a position held by IMD ProjectFactory (0xff03…7120), which has no function to remove it.",
      "evidence": [
        "e10",
        "e7"
      ]
    },
    {
      "id": "hook-quiet",
      "impact": "good",
      "text": "The pool's hook (IMD PoolInitializationGuard) never runs on swaps or liquidity (beforeInitialize).",
      "evidence": [
        "e11"
      ]
    },
    {
      "id": "holders",
      "impact": "good",
      "text": "19 holders. Leaving out the pool, burns and IMD's launch contracts, the largest holder has 5% (a wallet, 0xd630…ce98) and the top ten 5.15%.",
      "evidence": [
        "e12"
      ]
    },
    {
      "id": "sell-ok",
      "impact": "good",
      "text": "A ~$0.1 buy and its sell both go through, through the Quoter and the Universal Router, with no cost beyond the 1.25% pool fee.",
      "evidence": [
        "e13"
      ]
    }
  ],
  "asset": {
    "name": "TORCHINU",
    "symbol": "TORCHINU",
    "decimals": 18,
    "totalSupply": "1000000000000000000000000000"
  },
  "imd": {
    "isLaunch": true,
    "launchNumber": 2226,
    "id": "2f4cf57e-a157-41de-956a-eaec9db029c8",
    "kind": "custom_token",
    "status": "live",
    "createdAt": "2026-10-19T10:43:56.550Z",
    "repo": "https://github.com/identity-md-launches/launch-2226-torchinu",
    "url": "https://api.imd.fun/launches/2f4cf57e-a157-41de-956a-eaec9db029c8",
    "role": "token"
  },
  "source": {
    "verified": false,
    "note": "Not verified on Sourcify (Etherscan not checked: the server has no ETHERSCAN_API_KEY)."
  },
  "powers": {
    "owner": {
      "address": null,
      "kind": "none"
    },
    "found": [],
    "plainErc20": true
  },
  "proxy": {
    "proxy": false,
    "kind": null,
    "implementation": null,
    "admin": null
  },
  "market": {
    "priceUsd": null,
    "liquidityUsd": null,
    "exitLiquidityUsd": 0,
    "liquiditySource": "onchain",
    "volume24hUsd": null,
    "fdvUsd": null,
    "txns24h": null,
    "pairs": 0,
    "pair": null,
    "createdAt": null
  },
  "pool": {
    "protocol": "uniswap-v4",
    "poolId": "0xc3ed960b8a3f0320cf1610dfe99d8c0d9b2faca51f2edf7da3e8975d440d1c15",
    "key": {
      "currency0": "0x1e0381f367a82da1b6136606f894f17ed05d8c5e",
      "currency1": "0xd34a99bc0f67ae1bbd63c660e6d0b0dd03e263b7",
      "fee": 12500,
      "tickSpacing": 60,
      "hooks": "0x784ff9a3ac5d88a30bfff6f7f2a270161fbe6000"
    },
    "feeBps": 125,
    "tick": -128999,
    "lpHeldBy": "IMD ProjectFactory"
  },
  "hook": {
    "address": "0x784ff9a3ac5d88a30bfff6f7f2a270161fbe6000",
    "flags": "0x2000",
    "callbacks": [
      "beforeInitialize"
    ],
    "template": "IMD PoolInitializationGuard"
  },
  "holders": {
    "complete": true,
    "fromBlock": 26226957,
    "toBlock": 26236448,
    "transfers": 20,
    "count": 19,
    "top": [
      {
        "address": "0x000000000004444c5dc75cb358380d2e3de08a90",
        "pct": 84.9999,
        "label": "Uniswap v4 PoolManager (pool liquidity)",
        "kind": "pool"
      },
      {
        "address": "0x66fecb177a758c874fb2ae00997da7860085c1ef",
        "pct": 9.7913,
        "label": "IMD launch distributor (MerkleDistributor)",
        "kind": "launch"
      },
      {
        "address": "0xd6302976e590b9b947da8774b7f1246164e0ce98",
        "pct": 5,
        "label": null,
        "kind": "wallet"
      },
      {
        "address": "0x6d2f9da1911e88a116c6228f07e7cab9a927be9e",
        "pct": 0.0772,
        "label": null,
        "kind": "wallet"
      },
      {
        "address": "0xcd5a046e76029fccc360ea842a1c42bc4b302c2f",
        "pct": 0.0154,
        "label": null,
        "kind": "wallet"
      },
      {
        "address": "0xf8ac5532cf5d261c00c5a71c246225256db6424d",
        "pct": 0.0154,
        "label": null,
        "kind": "wallet"
      },
      {
        "address": "0x85f3b95fc3d97e134a9d288fa960aa85da2299db",
        "pct": 0.0077,
        "label": null,
        "kind": "wallet"
      },
      {
        "address": "0x165b8ac3dbc3221c9fc07359ab7ff9cefcaf0b1d",
        "pct": 0.0077,
        "label": null,
        "kind": "wallet"
      },
      {
        "address": "0x7d5e92853599b792ccb65a6e9b1fc26c663f6563",
        "pct": 0.0077,
        "label": null,
        "kind": "wallet"
      },
      {
        "address": "0x0d74eeb0b00c6a90142e51865f7c05473264841c",
        "pct": 0.0077,
        "label": null,
        "kind": "wallet"
      }
    ],
    "top10Pct": 99.93,
    "top10PctExInfra": 5.15,
    "largestWallet": {
      "address": "0xd6302976e590b9b947da8774b7f1246164e0ce98",
      "pct": 5,
      "label": null,
      "kind": "wallet"
    },
    "scanned": "complete since deployment"
  },
  "simulation": {
    "simulated": true,
    "quote": "IMD",
    "amountIn": "0.016978 IMD",
    "buy": {
      "ok": true,
      "out": "6667.043761490505",
      "taxPct": 0.59
    },
    "sell": {
      "ok": true,
      "out": "0.01655620443574911 IMD",
      "taxPct": 0
    },
    "sellIntoPoolNow": {
      "ok": false,
      "reason": "NotEnoughLiquidity (the pool has none of the output token at this price)"
    },
    "router": {
      "ok": true
    },
    "roundTripLossPct": 2.48,
    "poolFeePct": 1.25,
    "note": "A ~$0.1 buy and the sell of what it bought, back to back: quoted by the V4 Quoter (it runs the hook), then sent through the Universal Router with eth_call so the token's transfer code runs both ways. Tax = what is lost beyond the pool's 1.25% fee. Nothing was signed or sent."
  },
  "copycat": {
    "signal": "none",
    "text": "No other IMD launch uses this symbol.",
    "sameSymbol": []
  },
  "evidence": [
    {
      "id": "e1",
      "what": "TORCHINU (TORCHINU), 18 decimals, supply 1,000,000,000",
      "source": "eth_call"
    },
    {
      "id": "e2",
      "what": "IMD launch #2226 (custom_token, live) lists this address as its token",
      "source": "api.imd.fun",
      "url": "https://api.imd.fun/launches/2f4cf57e-a157-41de-956a-eaec9db029c8"
    },
    {
      "id": "e3",
      "what": "EIP-1967 implementation, admin and beacon slots are empty; not a minimal proxy",
      "source": "eth_getStorageAt"
    },
    {
      "id": "e4",
      "what": "Not verified on Sourcify (Etherscan not checked: the server has no ETHERSCAN_API_KEY).",
      "source": "sourcify"
    },
    {
      "id": "e5",
      "what": "No owner() or getOwner() on the token",
      "source": "eth_call"
    },
    {
      "id": "e6",
      "what": "13 functions in the bytecode dispatcher",
      "source": "eth_getCode"
    },
    {
      "id": "e7",
      "what": "Uniswap v4 pool 0xc3ed960b8a3f0320cf1610dfe99d8c0d9b2faca51f2edf7da3e8975d440d1c15: key from api.imd.fun seeded pool; tick -128999, LP fee 125 bps",
      "source": "eth_getStorageAt"
    },
    {
      "id": "e8",
      "what": "DexScreener lists no pair for this token",
      "source": "dexscreener",
      "url": "https://api.dexscreener.com/tokens/v1/ethereum/0x1e0381f367a82da1b6136606f894f17ed05d8c5e"
    },
    {
      "id": "e9",
      "what": "On-chain liquidity: the IMD-seeded position's amounts at the current price, valued at IMD $5.89",
      "source": "eth_getStorageAt"
    },
    {
      "id": "e10",
      "what": "IMD's LaunchFactory and ProjectFactory hold each launch's pool position; their verified ABIs on Sourcify have no function that removes liquidity (only claimFees, withdraw of fees owed and setRequester), checked 2026-10-20",
      "source": "sourcify",
      "url": "https://sourcify.dev/server/v2/contract/1/0xff03410d0fe5fa8f7f59f743de35e333d9857120?fields=abi"
    },
    {
      "id": "e11",
      "what": "Hook 0x784ff9a3ac5d88a30bfff6f7f2a270161fbe6000: permission bits 0x2000 (beforeInitialize)",
      "source": "address"
    },
    {
      "id": "e12",
      "what": "Transfer events from block 26226957 to 26236448 (20 transfers, from deployment: exact)",
      "source": "eth_getLogs"
    },
    {
      "id": "e13",
      "what": "eth_call: V4 Quoter buy 0.016978 IMD → 6,667.044 tokens; buy-then-sell round trip → 0.01655620443574911 IMD; the same round trip through the Universal Router with real token transfers went through",
      "source": "eth_call",
      "block": 26236448
    }
  ],
  "generatedAt": "2026-10-20T21:20:59.788Z",
  "disclaimer": "Automated on-chain and public-data checks run by NIGHTSHIFT, not financial advice and not an audit. A safe verdict means none of these checks found a problem; it cannot rule out risks they do not cover.",
  "cached": false,
  "dataAgeSeconds": 0,
  "payment": {
    "sim": true,
    "priceUsd": 0.02,
    "note": "Simulation: a demo sale was booked and no money moved."
  }
}
```

</details>

## Hook Inspector

### Free: the permission bits of the NightshiftHook

`GET /api/v1/hook/0x42ebcf86e3ab0445ba0362f911a7e8fad6ace0cc/flags` → **200** in 11 ms

<details><summary>The whole answer (2,348 bytes)</summary>

```json
{
  "service": "hook-inspector",
  "runBy": "NIGHTSHIFT",
  "preview": true,
  "address": "0x42ebcf86e3ab0445ba0362f911a7e8fad6ace0cc",
  "flags": {
    "bits": 8396,
    "hex": "0x20cc",
    "permissions": [
      {
        "name": "beforeInitialize",
        "set": true,
        "what": "runs before a pool with this hook is created: can refuse pools (often: only one pool, or only a factory)"
      },
      {
        "name": "afterInitialize",
        "set": false,
        "what": "runs after a pool is created"
      },
      {
        "name": "beforeAddLiquidity",
        "set": false,
        "what": "runs before liquidity is added: can refuse or restrict LPs"
      },
      {
        "name": "afterAddLiquidity",
        "set": false,
        "what": "runs after liquidity is added"
      },
      {
        "name": "beforeRemoveLiquidity",
        "set": false,
        "what": "runs before liquidity is removed: can refuse a withdrawal and keep LPs in"
      },
      {
        "name": "afterRemoveLiquidity",
        "set": false,
        "what": "runs after liquidity is removed"
      },
      {
        "name": "beforeSwap",
        "set": true,
        "what": "runs before every swap: can refuse it, set a per-swap fee, or take a cut"
      },
      {
        "name": "afterSwap",
        "set": true,
        "what": "runs after every swap: can act on the result or take a cut of the output"
      },
      {
        "name": "beforeDonate",
        "set": false,
        "what": "runs before a donation to LPs"
      },
      {
        "name": "afterDonate",
        "set": false,
        "what": "runs after a donation to LPs"
      },
      {
        "name": "beforeSwapReturnsDelta",
        "set": true,
        "what": "beforeSwap may change the swap's amounts: take tokens from the swapper (a fee) or replace the pool's pricing"
      },
      {
        "name": "afterSwapReturnsDelta",
        "set": true,
        "what": "afterSwap may change what the swapper receives: a fee on the output"
      },
      {
        "name": "afterAddLiquidityReturnsDelta",
        "set": false,
        "what": "afterAddLiquidity may change what an LP pays in"
      },
      {
        "name": "afterRemoveLiquidityReturnsDelta",
        "set": false,
        "what": "afterRemoveLiquidity may take part of what an LP withdraws"
      }
    ],
    "valid": true,
    "problems": []
  },
  "template": {
    "name": "NightshiftHook",
    "by": "NIGHTSHIFT ($SHIFT, IMD launch #2124)",
    "note": "Launch gate (until the treasury 0x3322…4D69 made the first buy, checked with tx.origin, every other swap reverted), then a sell fee of 2.5% of the SHIFT in and 2.5% of the ETH out to the FeeSplitter. The owner can lower either part and never raise it above 2.5%.",
    "match": "exact address"
  },
  "note": "Free: the bits say which callbacks the PoolManager will ever call. The paid inspection ($0.05) reads the code: what each callback does, fees, owner powers, upgrades. explain=1 ($0.50) adds a written explanation with the source lines."
}
```

</details>

### Inspection ($0.05): NightshiftHook

`GET /api/v1/hook/0x42ebcf86e3ab0445ba0362f911a7e8fad6ace0cc?sim=1` → **200** in 393 ms

<details><summary>The whole answer (8,759 bytes)</summary>

```json
{
  "service": "hook-inspector",
  "runBy": "NIGHTSHIFT",
  "chain": "ethereum",
  "chainId": 1,
  "address": "0x42ebcf86e3ab0445ba0362f911a7e8fad6ace0cc",
  "explain": false,
  "summary": "NightshiftHook. The PoolManager calls beforeInitialize, beforeSwap, afterSwap (with beforeSwapReturnsDelta, afterSwapReturnsDelta). Takes its own fee: beforeSwapReturnsDelta and afterSwapReturnsDelta set and it moves pool currency out with PoolManager.take/mint (settings: MAX_FEE_BPS = 250, ethFeeBps = 250, shiftFeeBps = 250), to feeSplitter 0x1119…2d44. Owner: wallet 0x6c4c…19b5. Not a proxy and no DELEGATECALL: the code cannot change.",
  "risk": "low",
  "flags": {
    "bits": 8396,
    "hex": "0x20cc",
    "permissions": [
      {
        "name": "beforeInitialize",
        "set": true,
        "what": "runs before a pool with this hook is created: can refuse pools (often: only one pool, or only a factory)"
      },
      {
        "name": "afterInitialize",
        "set": false,
        "what": "runs after a pool is created"
      },
      {
        "name": "beforeAddLiquidity",
        "set": false,
        "what": "runs before liquidity is added: can refuse or restrict LPs"
      },
      {
        "name": "afterAddLiquidity",
        "set": false,
        "what": "runs after liquidity is added"
      },
      {
        "name": "beforeRemoveLiquidity",
        "set": false,
        "what": "runs before liquidity is removed: can refuse a withdrawal and keep LPs in"
      },
      {
        "name": "afterRemoveLiquidity",
        "set": false,
        "what": "runs after liquidity is removed"
      },
      {
        "name": "beforeSwap",
        "set": true,
        "what": "runs before every swap: can refuse it, set a per-swap fee, or take a cut"
      },
      {
        "name": "afterSwap",
        "set": true,
        "what": "runs after every swap: can act on the result or take a cut of the output"
      },
      {
        "name": "beforeDonate",
        "set": false,
        "what": "runs before a donation to LPs"
      },
      {
        "name": "afterDonate",
        "set": false,
        "what": "runs after a donation to LPs"
      },
      {
        "name": "beforeSwapReturnsDelta",
        "set": true,
        "what": "beforeSwap may change the swap's amounts: take tokens from the swapper (a fee) or replace the pool's pricing"
      },
      {
        "name": "afterSwapReturnsDelta",
        "set": true,
        "what": "afterSwap may change what the swapper receives: a fee on the output"
      },
      {
        "name": "afterAddLiquidityReturnsDelta",
        "set": false,
        "what": "afterAddLiquidity may change what an LP pays in"
      },
      {
        "name": "afterRemoveLiquidityReturnsDelta",
        "set": false,
        "what": "afterRemoveLiquidity may take part of what an LP withdraws"
      }
    ],
    "valid": true,
    "problems": []
  },
  "callbacks": [
    {
      "name": "beforeInitialize",
      "calledByPoolManager": true,
      "inCode": true,
      "implemented": true
    },
    {
      "name": "afterInitialize",
      "calledByPoolManager": false,
      "inCode": false,
      "implemented": false
    },
    {
      "name": "beforeAddLiquidity",
      "calledByPoolManager": false,
      "inCode": false,
      "implemented": false
    },
    {
      "name": "afterAddLiquidity",
      "calledByPoolManager": false,
      "inCode": false,
      "implemented": false
    },
    {
      "name": "beforeRemoveLiquidity",
      "calledByPoolManager": false,
      "inCode": false,
      "implemented": false
    },
    {
      "name": "afterRemoveLiquidity",
      "calledByPoolManager": false,
      "inCode": false,
      "implemented": false
    },
    {
      "name": "beforeSwap",
      "calledByPoolManager": true,
      "inCode": true,
      "implemented": true
    },
    {
      "name": "afterSwap",
      "calledByPoolManager": true,
      "inCode": true,
      "implemented": true
    },
    {
      "name": "beforeDonate",
      "calledByPoolManager": false,
      "inCode": false,
      "implemented": false
    },
    {
      "name": "afterDonate",
      "calledByPoolManager": false,
      "inCode": false,
      "implemented": false
    }
  ],
  "template": {
    "name": "NightshiftHook",
    "by": "NIGHTSHIFT ($SHIFT, IMD launch #2124)",
    "note": "Launch gate (until the treasury 0x3322…4D69 made the first buy, checked with tx.origin, every other swap reverted), then a sell fee of 2.5% of the SHIFT in and 2.5% of the ETH out to the FeeSplitter. The owner can lower either part and never raise it above 2.5%.",
    "match": "exact address"
  },
  "imd": {
    "launchNumber": 2124,
    "kind": "univ4_hook",
    "status": "live",
    "token": "0xe5e58e53d0bb204aa62c995a6c8cc8a48e60c3ac",
    "url": "https://api.imd.fun/launches/ba3c2a45-99a6-446b-91ab-a839869a08a5"
  },
  "source": {
    "verified": true,
    "via": "sourcify",
    "contract": "NightshiftHook",
    "compiler": "0.8.26+commit.8a97fa7a",
    "url": "https://sourcify.dev/server/repo-ui/1/0x42ebcf86e3ab0445ba0362f911a7e8fad6ace0cc",
    "files": [
      "src/NightshiftHook.sol"
    ]
  },
  "code": {
    "bytes": 6904,
    "functions": 23,
    "delegatecall": false,
    "selfdestruct": false,
    "embeddedAddresses": [
      "0x3322e6dd06ade8377f1f1bcb766f6133d7b64d69"
    ],
    "names": "source"
  },
  "owner": {
    "address": "0x6c4c78f2c3bdf4c4318fe305fb1c8bc1694d19b5",
    "kind": "wallet"
  },
  "upgradeable": {
    "proxy": false,
    "kind": null,
    "implementation": null,
    "admin": null,
    "note": "not a proxy and no DELEGATECALL: the code cannot change"
  },
  "pools": [
    {
      "poolId": "0x6775f516eda3ee5cde65ceff94ce98935c7dc1e4d183238a8effa4d50e5c5ed4",
      "key": {
        "currency0": "0x0000000000000000000000000000000000000000",
        "currency1": "0xe5e58e53d0bb204aa62c995a6c8cc8a48e60c3ac",
        "fee": 12500,
        "tickSpacing": 60,
        "hooks": "0x42ebcf86e3ab0445ba0362f911a7e8fad6ace0cc"
      },
      "fee": {
        "type": "static",
        "poolFeeBps": 125,
        "currentLpFeeBps": 125
      },
      "tick": 174668,
      "source": "api.imd.fun seeded pool"
    }
  ],
  "fees": {
    "swapFee": "125 bps static",
    "hookFee": "takes its own fee: beforeSwapReturnsDelta and afterSwapReturnsDelta set and it moves pool currency out with PoolManager.take/mint (settings: MAX_FEE_BPS = 250, ethFeeBps = 250, shiftFeeBps = 250), to feeSplitter 0x1119…2d44",
    "parameters": [
      {
        "name": "FIRST_BUYER",
        "type": "address",
        "value": "0x3322e6dd06ade8377f1f1bcb766f6133d7b64d69"
      },
      {
        "name": "MAX_FEE_BPS",
        "type": "uint16",
        "value": 250
      },
      {
        "name": "ethFeeBps",
        "type": "uint16",
        "value": 250
      },
      {
        "name": "factory",
        "type": "address",
        "value": "0x12c63b581d07093f6126bc02263c58f7eadaa96f"
      },
      {
        "name": "feeSplitter",
        "type": "address",
        "value": "0x1119d5df2f046bc2d3c0f6279ef2e9ce49422d44"
      },
      {
        "name": "owner",
        "type": "address",
        "value": "0x6c4c78f2c3bdf4c4318fe305fb1c8bc1694d19b5"
      },
      {
        "name": "pendingEthClaims",
        "type": "uint256",
        "value": 0
      },
      {
        "name": "poolInitialized",
        "type": "bool",
        "value": true
      },
      {
        "name": "poolManager",
        "type": "address",
        "value": "0x000000000004444c5dc75cb358380d2e3de08a90"
      },
      {
        "name": "rewards",
        "type": "address",
        "value": "0x44ef9ba2dac00b709a7a69a966a7cbc9c5f930b5"
      },
      {
        "name": "shift",
        "type": "address",
        "value": "0xe5e58e53d0bb204aa62c995a6c8cc8a48e60c3ac"
      },
      {
        "name": "shiftFeeBps",
        "type": "uint16",
        "value": 250
      },
      {
        "name": "tradingOpen",
        "type": "bool",
        "value": true
      }
    ],
    "recipients": [
      {
        "name": "feeSplitter",
        "address": "0x1119d5df2f046bc2d3c0f6279ef2e9ce49422d44",
        "label": null
      }
    ]
  },
  "adminFunctions": [
    {
      "name": "setFees",
      "signature": "setFees(uint16 shiftFeeBps_, uint16 ethFeeBps_)",
      "power": "fees",
      "gate": "owner",
      "capped": "MAX_FEE_BPS = 250",
      "file": "src/NightshiftHook.sol",
      "line": 246,
      "note": "only the owner"
    }
  ],
  "powers": [
    {
      "text": "runs before every swap and checks tx.origin: swaps can be allowed or refused per wallet (here a launch gate, now open: tradingOpen = true)",
      "level": "low"
    },
    {
      "text": "charges a hook fee on swaps (beforeSwapReturnsDelta and afterSwapReturnsDelta set and it moves pool currency out with PoolManager.take/mint (settings: MAX_FEE_BPS = 250, ethFeeBps = 250, shiftFeeBps = 250), to feeSplitter 0x1119…2d44)",
      "level": "info"
    },
    {
      "text": "the owner can change fees (setFees), capped by MAX_FEE_BPS = 250",
      "level": "low"
    },
    {
      "text": "the owner is a single wallet (0x6c4c…19b5), not a multisig",
      "level": "low"
    }
  ],
  "confidence": {
    "level": "high",
    "score": 1,
    "checked": [
      "permission bits",
      "callbacks in code",
      "verified source",
      "owner",
      "pools",
      "upgradeability"
    ],
    "unknowns": []
  },
  "evidence": [
    {
      "id": "e1",
      "what": "Permission bits 0x20cc read from the address's lowest 14 bits",
      "source": "address"
    },
    {
      "id": "e2",
      "what": "Runtime code, 6904 bytes",
      "source": "eth_getCode"
    },
    {
      "id": "e3",
      "what": "Verified source: NightshiftHook (1 project files, 32 library files)",
      "source": "sourcify",
      "url": "https://sourcify.dev/server/repo-ui/1/0x42ebcf86e3ab0445ba0362f911a7e8fad6ace0cc"
    },
    {
      "id": "e4",
      "what": "IMD launch #2124 (univ4_hook, live) lists this address as its hook",
      "source": "api.imd.fun",
      "url": "https://api.imd.fun/launches/ba3c2a45-99a6-446b-91ab-a839869a08a5"
    },
    {
      "id": "e5",
      "what": "owner() = 0x6c4c78f2c3bdf4c4318fe305fb1c8bc1694d19b5 (wallet)",
      "source": "eth_call"
    },
    {
      "id": "e6",
      "what": "1 state-changing functions with a gate or a power, read from the verified source",
      "source": "sourcify"
    },
    {
      "id": "e7",
      "what": "1 pool(s) with this hook; fee and price from the PoolManager's storage",
      "source": "eth_getStorageAt"
    },
    {
      "id": "e8",
      "what": "Fee logic: takes its own fee: beforeSwapReturnsDelta and afterSwapReturnsDelta set and it moves pool currency out with PoolManager.take/mint (settings: MAX_FEE_BPS = 250, ethFeeBps = 250, shiftFeeBps = 250), to feeSplitter 0x1119…2d44",
      "source": "sourcify"
    },
    {
      "id": "e9",
      "what": "Proxy slots (EIP-1967, beacon) empty; DELEGATECALL absent; SELFDESTRUCT absent",
      "source": "eth_getStorageAt"
    }
  ],
  "generatedAt": "2026-10-20T21:21:01.776Z",
  "disclaimer": "Automated on-chain and public-data checks run by NIGHTSHIFT, not financial advice and not an audit. A safe verdict means none of these checks found a problem; it cannot rule out risks they do not cover.",
  "cached": false,
  "dataAgeSeconds": 0,
  "payment": {
    "sim": true,
    "priceUsd": 0.05,
    "note": "Simulation: a demo sale was booked and no money moved."
  }
}
```

</details>

### Explained ($0.50): NightshiftHook

`GET /api/v1/hook/0x42ebcf86e3ab0445ba0362f911a7e8fad6ace0cc?explain=1&sim=1` → **200** in 504 ms

The explanation and the source lines of every callback and admin function.

<details><summary>The whole answer (12,972 bytes)</summary>

```json
{
  "service": "hook-inspector",
  "runBy": "NIGHTSHIFT",
  "chain": "ethereum",
  "chainId": 1,
  "address": "0x42ebcf86e3ab0445ba0362f911a7e8fad6ace0cc",
  "explain": true,
  "summary": "NightshiftHook. The PoolManager calls beforeInitialize, beforeSwap, afterSwap (with beforeSwapReturnsDelta, afterSwapReturnsDelta). Takes its own fee: beforeSwapReturnsDelta and afterSwapReturnsDelta set and it moves pool currency out with PoolManager.take/mint (settings: MAX_FEE_BPS = 250, ethFeeBps = 250, shiftFeeBps = 250), to feeSplitter 0x1119…2d44. Owner: wallet 0x6c4c…19b5. Not a proxy and no DELEGATECALL: the code cannot change.",
  "risk": "low",
  "flags": {
    "bits": 8396,
    "hex": "0x20cc",
    "permissions": [
      {
        "name": "beforeInitialize",
        "set": true,
        "what": "runs before a pool with this hook is created: can refuse pools (often: only one pool, or only a factory)"
      },
      {
        "name": "afterInitialize",
        "set": false,
        "what": "runs after a pool is created"
      },
      {
        "name": "beforeAddLiquidity",
        "set": false,
        "what": "runs before liquidity is added: can refuse or restrict LPs"
      },
      {
        "name": "afterAddLiquidity",
        "set": false,
        "what": "runs after liquidity is added"
      },
      {
        "name": "beforeRemoveLiquidity",
        "set": false,
        "what": "runs before liquidity is removed: can refuse a withdrawal and keep LPs in"
      },
      {
        "name": "afterRemoveLiquidity",
        "set": false,
        "what": "runs after liquidity is removed"
      },
      {
        "name": "beforeSwap",
        "set": true,
        "what": "runs before every swap: can refuse it, set a per-swap fee, or take a cut"
      },
      {
        "name": "afterSwap",
        "set": true,
        "what": "runs after every swap: can act on the result or take a cut of the output"
      },
      {
        "name": "beforeDonate",
        "set": false,
        "what": "runs before a donation to LPs"
      },
      {
        "name": "afterDonate",
        "set": false,
        "what": "runs after a donation to LPs"
      },
      {
        "name": "beforeSwapReturnsDelta",
        "set": true,
        "what": "beforeSwap may change the swap's amounts: take tokens from the swapper (a fee) or replace the pool's pricing"
      },
      {
        "name": "afterSwapReturnsDelta",
        "set": true,
        "what": "afterSwap may change what the swapper receives: a fee on the output"
      },
      {
        "name": "afterAddLiquidityReturnsDelta",
        "set": false,
        "what": "afterAddLiquidity may change what an LP pays in"
      },
      {
        "name": "afterRemoveLiquidityReturnsDelta",
        "set": false,
        "what": "afterRemoveLiquidity may take part of what an LP withdraws"
      }
    ],
    "valid": true,
    "problems": []
  },
  "callbacks": [
    {
      "name": "beforeInitialize",
      "calledByPoolManager": true,
      "inCode": true,
      "implemented": true
    },
    {
      "name": "afterInitialize",
      "calledByPoolManager": false,
      "inCode": false,
      "implemented": false
    },
    {
      "name": "beforeAddLiquidity",
      "calledByPoolManager": false,
      "inCode": false,
      "implemented": false
    },
    {
      "name": "afterAddLiquidity",
      "calledByPoolManager": false,
      "inCode": false,
      "implemented": false
    },
    {
      "name": "beforeRemoveLiquidity",
      "calledByPoolManager": false,
      "inCode": false,
      "implemented": false
    },
    {
      "name": "afterRemoveLiquidity",
      "calledByPoolManager": false,
      "inCode": false,
      "implemented": false
    },
    {
      "name": "beforeSwap",
      "calledByPoolManager": true,
      "inCode": true,
      "implemented": true
    },
    {
      "name": "afterSwap",
      "calledByPoolManager": true,
      "inCode": true,
      "implemented": true
    },
    {
      "name": "beforeDonate",
      "calledByPoolManager": false,
      "inCode": false,
      "implemented": false
    },
    {
      "name": "afterDonate",
      "calledByPoolManager": false,
      "inCode": false,
      "implemented": false
    }
  ],
  "template": {
    "name": "NightshiftHook",
    "by": "NIGHTSHIFT ($SHIFT, IMD launch #2124)",
    "note": "Launch gate (until the treasury 0x3322…4D69 made the first buy, checked with tx.origin, every other swap reverted), then a sell fee of 2.5% of the SHIFT in and 2.5% of the ETH out to the FeeSplitter. The owner can lower either part and never raise it above 2.5%.",
    "match": "exact address"
  },
  "imd": {
    "launchNumber": 2124,
    "kind": "univ4_hook",
    "status": "live",
    "token": "0xe5e58e53d0bb204aa62c995a6c8cc8a48e60c3ac",
    "url": "https://api.imd.fun/launches/ba3c2a45-99a6-446b-91ab-a839869a08a5"
  },
  "source": {
    "verified": true,
    "via": "sourcify",
    "contract": "NightshiftHook",
    "compiler": "0.8.26+commit.8a97fa7a",
    "url": "https://sourcify.dev/server/repo-ui/1/0x42ebcf86e3ab0445ba0362f911a7e8fad6ace0cc",
    "files": [
      "src/NightshiftHook.sol"
    ]
  },
  "code": {
    "bytes": 6904,
    "functions": 23,
    "delegatecall": false,
    "selfdestruct": false,
    "embeddedAddresses": [
      "0x3322e6dd06ade8377f1f1bcb766f6133d7b64d69"
    ],
    "names": "source"
  },
  "owner": {
    "address": "0x6c4c78f2c3bdf4c4318fe305fb1c8bc1694d19b5",
    "kind": "wallet"
  },
  "upgradeable": {
    "proxy": false,
    "kind": null,
    "implementation": null,
    "admin": null,
    "note": "not a proxy and no DELEGATECALL: the code cannot change"
  },
  "pools": [
    {
      "poolId": "0x6775f516eda3ee5cde65ceff94ce98935c7dc1e4d183238a8effa4d50e5c5ed4",
      "key": {
        "currency0": "0x0000000000000000000000000000000000000000",
        "currency1": "0xe5e58e53d0bb204aa62c995a6c8cc8a48e60c3ac",
        "fee": 12500,
        "tickSpacing": 60,
        "hooks": "0x42ebcf86e3ab0445ba0362f911a7e8fad6ace0cc"
      },
      "fee": {
        "type": "static",
        "poolFeeBps": 125,
        "currentLpFeeBps": 125
      },
      "tick": 174668,
      "source": "api.imd.fun seeded pool"
    }
  ],
  "fees": {
    "swapFee": "125 bps static",
    "hookFee": "takes its own fee: beforeSwapReturnsDelta and afterSwapReturnsDelta set and it moves pool currency out with PoolManager.take/mint (settings: MAX_FEE_BPS = 250, ethFeeBps = 250, shiftFeeBps = 250), to feeSplitter 0x1119…2d44",
    "parameters": [
      {
        "name": "FIRST_BUYER",
        "type": "address",
        "value": "0x3322e6dd06ade8377f1f1bcb766f6133d7b64d69"
      },
      {
        "name": "MAX_FEE_BPS",
        "type": "uint16",
        "value": 250
      },
      {
        "name": "ethFeeBps",
        "type": "uint16",
        "value": 250
      },
      {
        "name": "factory",
        "type": "address",
        "value": "0x12c63b581d07093f6126bc02263c58f7eadaa96f"
      },
      {
        "name": "feeSplitter",
        "type": "address",
        "value": "0x1119d5df2f046bc2d3c0f6279ef2e9ce49422d44"
      },
      {
        "name": "owner",
        "type": "address",
        "value": "0x6c4c78f2c3bdf4c4318fe305fb1c8bc1694d19b5"
      },
      {
        "name": "pendingEthClaims",
        "type": "uint256",
        "value": 0
      },
      {
        "name": "poolInitialized",
        "type": "bool",
        "value": true
      },
      {
        "name": "poolManager",
        "type": "address",
        "value": "0x000000000004444c5dc75cb358380d2e3de08a90"
      },
      {
        "name": "rewards",
        "type": "address",
        "value": "0x44ef9ba2dac00b709a7a69a966a7cbc9c5f930b5"
      },
      {
        "name": "shift",
        "type": "address",
        "value": "0xe5e58e53d0bb204aa62c995a6c8cc8a48e60c3ac"
      },
      {
        "name": "shiftFeeBps",
        "type": "uint16",
        "value": 250
      },
      {
        "name": "tradingOpen",
        "type": "bool",
        "value": true
      }
    ],
    "recipients": [
      {
        "name": "feeSplitter",
        "address": "0x1119d5df2f046bc2d3c0f6279ef2e9ce49422d44",
        "label": null
      }
    ]
  },
  "adminFunctions": [
    {
      "name": "setFees",
      "signature": "setFees(uint16 shiftFeeBps_, uint16 ethFeeBps_)",
      "power": "fees",
      "gate": "owner",
      "capped": "MAX_FEE_BPS = 250",
      "file": "src/NightshiftHook.sol",
      "line": 246,
      "note": "only the owner"
    }
  ],
  "powers": [
    {
      "text": "runs before every swap and checks tx.origin: swaps can be allowed or refused per wallet (here a launch gate, now open: tradingOpen = true)",
      "level": "low"
    },
    {
      "text": "charges a hook fee on swaps (beforeSwapReturnsDelta and afterSwapReturnsDelta set and it moves pool currency out with PoolManager.take/mint (settings: MAX_FEE_BPS = 250, ethFeeBps = 250, shiftFeeBps = 250), to feeSplitter 0x1119…2d44)",
      "level": "info"
    },
    {
      "text": "the owner can change fees (setFees), capped by MAX_FEE_BPS = 250",
      "level": "low"
    },
    {
      "text": "the owner is a single wallet (0x6c4c…19b5), not a multisig",
      "level": "low"
    }
  ],
  "confidence": {
    "level": "high",
    "score": 1,
    "checked": [
      "permission bits",
      "callbacks in code",
      "verified source",
      "owner",
      "pools",
      "upgradeability"
    ],
    "unknowns": []
  },
  "evidence": [
    {
      "id": "e1",
      "what": "Permission bits 0x20cc read from the address's lowest 14 bits",
      "source": "address"
    },
    {
      "id": "e2",
      "what": "Runtime code, 6904 bytes",
      "source": "eth_getCode"
    },
    {
      "id": "e3",
      "what": "Verified source: NightshiftHook (1 project files, 32 library files)",
      "source": "sourcify",
      "url": "https://sourcify.dev/server/repo-ui/1/0x42ebcf86e3ab0445ba0362f911a7e8fad6ace0cc"
    },
    {
      "id": "e4",
      "what": "IMD launch #2124 (univ4_hook, live) lists this address as its hook",
      "source": "api.imd.fun",
      "url": "https://api.imd.fun/launches/ba3c2a45-99a6-446b-91ab-a839869a08a5"
    },
    {
      "id": "e5",
      "what": "owner() = 0x6c4c78f2c3bdf4c4318fe305fb1c8bc1694d19b5 (wallet)",
      "source": "eth_call"
    },
    {
      "id": "e6",
      "what": "1 state-changing functions with a gate or a power, read from the verified source",
      "source": "sourcify"
    },
    {
      "id": "e7",
      "what": "1 pool(s) with this hook; fee and price from the PoolManager's storage",
      "source": "eth_getStorageAt"
    },
    {
      "id": "e8",
      "what": "Fee logic: takes its own fee: beforeSwapReturnsDelta and afterSwapReturnsDelta set and it moves pool currency out with PoolManager.take/mint (settings: MAX_FEE_BPS = 250, ethFeeBps = 250, shiftFeeBps = 250), to feeSplitter 0x1119…2d44",
      "source": "sourcify"
    },
    {
      "id": "e9",
      "what": "Proxy slots (EIP-1967, beacon) empty; DELEGATECALL absent; SELFDESTRUCT absent",
      "source": "eth_getStorageAt"
    }
  ],
  "generatedAt": "2026-10-20T21:21:02.280Z",
  "disclaimer": "Automated on-chain and public-data checks run by NIGHTSHIFT, not financial advice and not an audit. A safe verdict means none of these checks found a problem; it cannot rule out risks they do not cover.",
  "explanation": {
    "text": "This is the NightshiftHook (NIGHTSHIFT ($SHIFT, IMD launch #2124)). Launch gate (until the treasury 0x3322…4D69 made the first buy, checked with tx.origin, every other swap reverted), then a sell fee of 2.5% of the SHIFT in and 2.5% of the ETH out to the FeeSplitter. The owner can lower either part and never raise it above 2.5%.\n\nIts address carries the permission bits 0x20cc, so the PoolManager calls it on: beforeInitialize (runs before a pool with this hook is created: can refuse pools (often: only one pool, or only a factory)); beforeSwap (runs before every swap: can refuse it, set a per-swap fee, or take a cut); afterSwap (runs after every swap: can act on the result or take a cut of the output). Bits are fixed at deployment: no other callback can ever run.\n\nFees: the pool's swap fee is 125 bps static. The hook takes its own fee: beforeSwapReturnsDelta and afterSwapReturnsDelta set and it moves pool currency out with PoolManager.take/mint (settings: MAX_FEE_BPS = 250, ethFeeBps = 250, shiftFeeBps = 250), to feeSplitter 0x1119…2d44.\n\nAdmin functions: setFees (only the owner, capped by MAX_FEE_BPS = 250). The owner is one wallet, 0x6c4c78f2c3bdf4c4318fe305fb1c8bc1694d19b5.\n\nUpgrades: not a proxy and no DELEGATECALL: the code cannot change.\n\nPools: 0x6775f516… (ETH / 0xe5e5…c3ac, 125 bps, tick 174668).\n\nNothing found that lets anyone take swappers' or LPs' funds beyond the fees described.",
    "excerpts": [
      {
        "name": "beforeInitialize",
        "code": "// src/NightshiftHook.sol:126\nfunction beforeInitialize(address sender, PoolKey calldata key, uint160) external onlyPoolManager {\n        if (sender != factory) revert NotFactory();\n        if (poolInitialized) revert AlreadyInitialized();\n        if (!key.currency0.isAddressZero() || Currency.unwrap(key.currency1) != shift) revert WrongPool();\n        if (key.fee.isDynamicFee()) revert DynamicFeeNotAllowed();\n        poolInitialized = true;\n        poolKey = key;\n        return IHooks.beforeInitialize.selector;\n    }"
      },
      {
        "name": "beforeSwap",
        "code": "// src/NightshiftHook.sol:138\nfunction beforeSwap(address, PoolKey calldata key, SwapParams calldata params, bytes calldata) external onlyPoolManager {\n        if (!tradingOpen && tx.origin != FIRST_BUYER) revert TradingNotOpen();\n\n        if (!_isSell(key, params)) {\n            return (IHooks.beforeSwap.selector, BeforeSwapDeltaLibrary.ZERO_DELTA, 0);\n        }\n\n        if (params.amountSpecified < 0) {\n            // Exact input: the specified currency is SHIFT. Take the SHIFT part of the fee off the input.\n            uint256 shiftFee = uint256(-params.amountSpecified) * shiftFeeBps / BPS;\n            _tstore(shiftFee);\n            if (shiftFee > 0) poolManager.take(key.currency1, address(feeSplitter), shiftFee);\n            return (IHooks.beforeSwap.selector, toBeforeSwapDelta(shiftFee.toInt128(), 0), 0);\n        }\n    // …"
      },
      {
        "name": "afterSwap",
        "code": "// src/NightshiftHook.sol:165\nfunction afterSwap(address, PoolKey calldata key, SwapParams calldata params, BalanceDelta delta, bytes calldata) external onlyPoolManager {\n        if (!_isSell(key, params)) {\n            if (!tradingOpen) {\n                // beforeSwap only let this through because tx.origin is the first buyer.\n                tradingOpen = true;\n                emit TradingOpened(tx.origin, uint256(uint128(delta.amount1())));\n            }\n            return (IHooks.afterSwap.selector, 0);\n        }\n\n        if (params.amountSpecified < 0) {\n            // Exact input: the unspecified currency is ETH, the seller's output. Take the ETH part of the fee.\n            // The fee was sized from amountSpecified, so a sell the pool cannot fill completely is refused.\n            if (uint256(uint128(-delta.amount1())) + _tload() != uint256(-params.amountSpecified)) {\n    // …"
      },
      {
        "name": "setFees",
        "code": "// src/NightshiftHook.sol:246\nfunction setFees(uint16 shiftFeeBps_, uint16 ethFeeBps_) external onlyOwner {\n        if (shiftFeeBps_ > MAX_FEE_BPS || ethFeeBps_ > MAX_FEE_BPS) revert FeeTooHigh();\n        shiftFeeBps = shiftFeeBps_;\n        ethFeeBps = ethFeeBps_;\n        emit FeesSet(shiftFeeBps_, ethFeeBps_);\n    }"
      }
    ]
  },
  "cached": false,
  "dataAgeSeconds": 0,
  "payment": {
    "sim": true,
    "priceUsd": 0.5,
    "note": "Simulation: a demo sale was booked and no money moved."
  }
}
```

</details>

### Inspection: HamsterHook (IMD launch #2336)

`GET /api/v1/hook/0x82f636a92364d13754d7b3e72d460f0be20a28cc?sim=1` → **200** in 522 ms

An IMD univ4_hook launch hook with a decaying launch tax (95% at the start, 0% now) and no owner.

<details><summary>The whole answer (8,958 bytes)</summary>

```json
{
  "service": "hook-inspector",
  "runBy": "NIGHTSHIFT",
  "chain": "ethereum",
  "chainId": 1,
  "address": "0x82f636a92364d13754d7b3e72d460f0be20a28cc",
  "explain": false,
  "summary": "IMD univ4_hook launch hook. The PoolManager calls beforeInitialize, beforeAddLiquidity, beforeSwap, afterSwap (with beforeSwapReturnsDelta, afterSwapReturnsDelta). Takes its own fee: beforeSwapReturnsDelta and afterSwapReturnsDelta set and it moves pool currency out with PoolManager.take/mint (settings: BPS = 10000, HOOK_FEE_BPS = 110, INITIAL_TAX_BPS = 9500, LP_FEE = 12500, TAX_MINUTES = 48, TAX_STEP_BPS = 200, taxBps = 0). No owner. Not a proxy and no DELEGATECALL: the code cannot change.",
  "risk": "low",
  "flags": {
    "bits": 10444,
    "hex": "0x28cc",
    "permissions": [
      {
        "name": "beforeInitialize",
        "set": true,
        "what": "runs before a pool with this hook is created: can refuse pools (often: only one pool, or only a factory)"
      },
      {
        "name": "afterInitialize",
        "set": false,
        "what": "runs after a pool is created"
      },
      {
        "name": "beforeAddLiquidity",
        "set": true,
        "what": "runs before liquidity is added: can refuse or restrict LPs"
      },
      {
        "name": "afterAddLiquidity",
        "set": false,
        "what": "runs after liquidity is added"
      },
      {
        "name": "beforeRemoveLiquidity",
        "set": false,
        "what": "runs before liquidity is removed: can refuse a withdrawal and keep LPs in"
      },
      {
        "name": "afterRemoveLiquidity",
        "set": false,
        "what": "runs after liquidity is removed"
      },
      {
        "name": "beforeSwap",
        "set": true,
        "what": "runs before every swap: can refuse it, set a per-swap fee, or take a cut"
      },
      {
        "name": "afterSwap",
        "set": true,
        "what": "runs after every swap: can act on the result or take a cut of the output"
      },
      {
        "name": "beforeDonate",
        "set": false,
        "what": "runs before a donation to LPs"
      },
      {
        "name": "afterDonate",
        "set": false,
        "what": "runs after a donation to LPs"
      },
      {
        "name": "beforeSwapReturnsDelta",
        "set": true,
        "what": "beforeSwap may change the swap's amounts: take tokens from the swapper (a fee) or replace the pool's pricing"
      },
      {
        "name": "afterSwapReturnsDelta",
        "set": true,
        "what": "afterSwap may change what the swapper receives: a fee on the output"
      },
      {
        "name": "afterAddLiquidityReturnsDelta",
        "set": false,
        "what": "afterAddLiquidity may change what an LP pays in"
      },
      {
        "name": "afterRemoveLiquidityReturnsDelta",
        "set": false,
        "what": "afterRemoveLiquidity may take part of what an LP withdraws"
      }
    ],
    "valid": true,
    "problems": []
  },
  "callbacks": [
    {
      "name": "beforeInitialize",
      "calledByPoolManager": true,
      "inCode": true,
      "implemented": true
    },
    {
      "name": "afterInitialize",
      "calledByPoolManager": false,
      "inCode": false,
      "implemented": false
    },
    {
      "name": "beforeAddLiquidity",
      "calledByPoolManager": true,
      "inCode": true,
      "implemented": true
    },
    {
      "name": "afterAddLiquidity",
      "calledByPoolManager": false,
      "inCode": false,
      "implemented": false
    },
    {
      "name": "beforeRemoveLiquidity",
      "calledByPoolManager": false,
      "inCode": false,
      "implemented": false
    },
    {
      "name": "afterRemoveLiquidity",
      "calledByPoolManager": false,
      "inCode": false,
      "implemented": false
    },
    {
      "name": "beforeSwap",
      "calledByPoolManager": true,
      "inCode": true,
      "implemented": true
    },
    {
      "name": "afterSwap",
      "calledByPoolManager": true,
      "inCode": true,
      "implemented": true
    },
    {
      "name": "beforeDonate",
      "calledByPoolManager": false,
      "inCode": false,
      "implemented": false
    },
    {
      "name": "afterDonate",
      "calledByPoolManager": false,
      "inCode": false,
      "implemented": false
    }
  ],
  "template": {
    "name": "IMD univ4_hook launch hook",
    "by": "IMD launch #2336 (HamsterHook), built and audited by the IMD swarm, deployed by IMD",
    "note": "IMD's univ4_hook launches pair a hook written for the launch with a 1.25% pool that only IMD's factory may initialise (the beforeInitialize bit). What happens on swaps is this hook's own code: read the callbacks and powers below.",
    "match": "IMD launch artifact"
  },
  "imd": {
    "launchNumber": 2336,
    "kind": "univ4_hook",
    "status": "live",
    "token": "0x8e7c7936b4f2d4475dc4bacd174dc228d4d24e86",
    "url": "https://api.imd.fun/launches/702e6c9d-37ee-41ef-afcb-5d5e1af9f31b"
  },
  "source": {
    "verified": true,
    "via": "sourcify",
    "contract": "HamsterHook",
    "compiler": "0.8.26+commit.8a97fa7a",
    "url": "https://sourcify.dev/server/repo-ui/1/0x82f636a92364d13754d7b3e72d460f0be20a28cc",
    "files": [
      "src/HamsterHook.sol"
    ]
  },
  "code": {
    "bytes": 11106,
    "functions": 34,
    "delegatecall": false,
    "selfdestruct": false,
    "embeddedAddresses": [
      "0x1dceb78b36b5f18ac4a130f1ffc76eba0e73d183",
      "0xd34a99bc0f67ae1bbd63c660e6d0b0dd03e263b7"
    ],
    "names": "source"
  },
  "owner": {
    "address": null,
    "kind": "none"
  },
  "upgradeable": {
    "proxy": false,
    "kind": null,
    "implementation": null,
    "admin": null,
    "note": "not a proxy and no DELEGATECALL: the code cannot change"
  },
  "pools": [
    {
      "poolId": "0xe2efe34a4dee1f715ddb37279942a7aaaed0d3efd30572d2bcdd5c061ab8aef9",
      "key": {
        "currency0": "0x8e7c7936b4f2d4475dc4bacd174dc228d4d24e86",
        "currency1": "0xd34a99bc0f67ae1bbd63c660e6d0b0dd03e263b7",
        "fee": 12500,
        "tickSpacing": 60,
        "hooks": "0x82f636a92364d13754d7b3e72d460f0be20a28cc"
      },
      "fee": {
        "type": "static",
        "poolFeeBps": 125,
        "currentLpFeeBps": 125
      },
      "tick": -111612,
      "source": "api.imd.fun seeded pool"
    }
  ],
  "fees": {
    "swapFee": "125 bps static",
    "hookFee": "takes its own fee: beforeSwapReturnsDelta and afterSwapReturnsDelta set and it moves pool currency out with PoolManager.take/mint (settings: BPS = 10000, HOOK_FEE_BPS = 110, INITIAL_TAX_BPS = 9500, LP_FEE = 12500, TAX_MINUTES = 48, TAX_STEP_BPS = 200, taxBps = 0)",
    "parameters": [
      {
        "name": "BPS",
        "type": "uint256",
        "value": 10000
      },
      {
        "name": "HOOK_FEE_BPS",
        "type": "uint256",
        "value": 110
      },
      {
        "name": "IMD",
        "type": "address",
        "value": "0xd34a99bc0f67ae1bbd63c660e6d0b0dd03e263b7"
      },
      {
        "name": "INITIAL_TAX_BPS",
        "type": "uint256",
        "value": 9500
      },
      {
        "name": "LP_FEE",
        "type": "uint24",
        "value": 12500
      },
      {
        "name": "MAX_FLUSH_AMOUNT",
        "type": "uint256",
        "value": "170141183460469231731687303715884105727"
      },
      {
        "name": "MIN_FLUSH_AMOUNT",
        "type": "uint256",
        "value": "1000000000000000000"
      },
      {
        "name": "REQUIRED_FLAGS",
        "type": "uint160",
        "value": 10444
      },
      {
        "name": "TAX_MINUTES",
        "type": "uint256",
        "value": 48
      },
      {
        "name": "TAX_STEP_BPS",
        "type": "uint256",
        "value": 200
      },
      {
        "name": "TEAM",
        "type": "address",
        "value": "0x6cba4751742f6989fa224b2dc5d5d52fcef98a34"
      },
      {
        "name": "TICK_SPACING",
        "type": "int24",
        "value": 60
      },
      {
        "name": "VAULT",
        "type": "address",
        "value": "0x1dceb78b36b5f18ac4a130f1ffc76eba0e73d183"
      },
      {
        "name": "factory",
        "type": "address",
        "value": "0x12c63b581d07093f6126bc02263c58f7eadaa96f"
      },
      {
        "name": "imdIsCurrency0",
        "type": "bool",
        "value": false
      },
      {
        "name": "initialized",
        "type": "bool",
        "value": true
      },
      {
        "name": "poolId",
        "type": "bytes32",
        "value": "0xe2efe34a4dee1f715ddb37279942a7aaaed0d3efd30572d2bcdd5c061ab8aef9"
      },
      {
        "name": "poolManager",
        "type": "address",
        "value": "0x000000000004444c5dc75cb358380d2e3de08a90"
      },
      {
        "name": "startedAt",
        "type": "uint256",
        "value": 1792526195
      },
      {
        "name": "taxBps",
        "type": "uint256",
        "value": 0
      },
      {
        "name": "token",
        "type": "address",
        "value": "0x8e7c7936b4f2d4475dc4bacd174dc228d4d24e86"
      },
      {
        "name": "totalCredits",
        "type": "uint256",
        "value": "62084233412988350725"
      }
    ],
    "recipients": []
  },
  "adminFunctions": [],
  "powers": [
    {
      "text": "runs before liquidity is added: it can refuse or restrict who provides liquidity",
      "level": "low"
    },
    {
      "text": "runs before every swap: it can refuse swaps",
      "level": "low"
    },
    {
      "text": "charges a hook fee on swaps (beforeSwapReturnsDelta and afterSwapReturnsDelta set and it moves pool currency out with PoolManager.take/mint (settings: BPS = 10000, HOOK_FEE_BPS = 110, INITIAL_TAX_BPS = 9500, LP_FEE = 12500, TAX_MINUTES = 48, TAX_STEP_BPS = 200, taxBps = 0))",
      "level": "info"
    }
  ],
  "confidence": {
    "level": "high",
    "score": 1,
    "checked": [
      "permission bits",
      "callbacks in code",
      "verified source",
      "owner",
      "pools",
      "upgradeability"
    ],
    "unknowns": []
  },
  "evidence": [
    {
      "id": "e1",
      "what": "Permission bits 0x28cc read from the address's lowest 14 bits",
      "source": "address"
    },
    {
      "id": "e2",
      "what": "Runtime code, 11106 bytes",
      "source": "eth_getCode"
    },
    {
      "id": "e3",
      "what": "Verified source: HamsterHook (1 project files, 32 library files)",
      "source": "sourcify",
      "url": "https://sourcify.dev/server/repo-ui/1/0x82f636a92364d13754d7b3e72d460f0be20a28cc"
    },
    {
      "id": "e4",
      "what": "IMD launch #2336 (univ4_hook, live) lists this address as its hook",
      "source": "api.imd.fun",
      "url": "https://api.imd.fun/launches/702e6c9d-37ee-41ef-afcb-5d5e1af9f31b"
    },
    {
      "id": "e5",
      "what": "0 state-changing functions with a gate or a power, read from the verified source",
      "source": "sourcify"
    },
    {
      "id": "e6",
      "what": "1 pool(s) with this hook; fee and price from the PoolManager's storage",
      "source": "eth_getStorageAt"
    },
    {
      "id": "e7",
      "what": "Fee logic: takes its own fee: beforeSwapReturnsDelta and afterSwapReturnsDelta set and it moves pool currency out with PoolManager.take/mint (settings: BPS = 10000, HOOK_FEE_BPS = 110, INITIAL_TAX_BPS = 9500, LP_FEE = 12500, TAX_MINUTES = 48, TAX_STEP_BPS = 200, taxBps = 0)",
      "source": "sourcify"
    },
    {
      "id": "e8",
      "what": "Proxy slots (EIP-1967, beacon) empty; DELEGATECALL absent; SELFDESTRUCT absent",
      "source": "eth_getStorageAt"
    }
  ],
  "generatedAt": "2026-10-20T21:21:02.806Z",
  "disclaimer": "Automated on-chain and public-data checks run by NIGHTSHIFT, not financial advice and not an audit. A safe verdict means none of these checks found a problem; it cannot rule out risks they do not cover.",
  "cached": false,
  "dataAgeSeconds": 0,
  "payment": {
    "sim": true,
    "priceUsd": 0.05,
    "note": "Simulation: a demo sale was booked and no money moved."
  }
}
```

</details>

## IMD Data Feed

### Free sample: launches

`GET /api/v1/imd/launches?sample=1` → **200** in 234 ms

<details><summary>The whole answer (3,890 bytes)</summary>

```json
{
  "service": "imd-feed",
  "runBy": "NIGHTSHIFT",
  "endpoint": "launches",
  "count": 3,
  "total": 846,
  "items": [
    {
      "launchNumber": 2337,
      "id": "ed252adb-d5d4-491c-ae58-156408d73f4a",
      "kind": "custom_token",
      "status": "live",
      "chainId": 1,
      "chain": "ethereum",
      "createdAt": "2026-10-20T19:10:06.802Z",
      "updatedAt": "2026-10-20T19:10:53.557Z",
      "token": {
        "address": "0xefda791892b31d4208c526b6761f4c34f6ec0e2c",
        "contract": "HamsterToken",
        "symbol": "HAMSTER"
      },
      "hook": {
        "address": "0x784ff9a3ac5d88a30bfff6f7f2a270161fbe6000",
        "contract": "PoolInitializationGuard"
      },
      "distributor": "0xdcd70dc412a02c82430570fb79fdbb440e66dd4f",
      "pool": {
        "poolId": "0x26b919656a6e40f9a59ce0525b57a0fca93516c2c7bd1c570e4b6e87a4dd942c",
        "key": {
          "currency0": "0xd34a99bc0f67ae1bbd63c660e6d0b0dd03e263b7",
          "currency1": "0xefda791892b31d4208c526b6761f4c34f6ec0e2c",
          "fee": 12500,
          "tickSpacing": 60,
          "hooks": "0x784ff9a3ac5d88a30bfff6f7f2a270161fbe6000"
        },
        "lpHeldBy": "IMD ProjectFactory"
      },
      "market": {
        "priceUsd": 1.233e-26,
        "liquidityUsd": null,
        "volume24hUsd": 945.81,
        "txns24h": {
          "buys": 2,
          "sells": 3
        },
        "pair": "https://dexscreener.com/ethereum/0x26b919656a6e40f9a59ce0525b57a0fca93516c2c7bd1c570e4b6e87a4dd942c",
        "source": "dexscreener"
      },
      "repo": "https://github.com/identity-md-launches/launch-2337-hamster",
      "parkedReason": null,
      "url": "https://api.imd.fun/launches/ed252adb-d5d4-491c-ae58-156408d73f4a"
    },
    {
      "launchNumber": 2336,
      "id": "702e6c9d-37ee-41ef-afcb-5d5e1af9f31b",
      "kind": "univ4_hook",
      "status": "live",
      "chainId": 1,
      "chain": "ethereum",
      "createdAt": "2026-10-20T19:55:33.319Z",
      "updatedAt": "2026-10-20T19:56:49.866Z",
      "token": {
        "address": "0x8e7c7936b4f2d4475dc4bacd174dc228d4d24e86",
        "contract": "HamsterToken",
        "symbol": "HAMSTER"
      },
      "hook": {
        "address": "0x82f636a92364d13754d7b3e72d460f0be20a28cc",
        "contract": "HamsterHook"
      },
      "distributor": "0x559ca7521402ea519363e0a5b2b7dd97c3f9f48f",
      "pool": {
        "poolId": "0xe2efe34a4dee1f715ddb37279942a7aaaed0d3efd30572d2bcdd5c061ab8aef9",
        "key": {
          "currency0": "0x8e7c7936b4f2d4475dc4bacd174dc228d4d24e86",
          "currency1": "0xd34a99bc0f67ae1bbd63c660e6d0b0dd03e263b7",
          "fee": 12500,
          "tickSpacing": 60,
          "hooks": "0x82f636a92364d13754d7b3e72d460f0be20a28cc"
        },
        "lpHeldBy": "IMD LaunchFactory"
      },
      "market": {
        "priceUsd": 0.00008313,
        "liquidityUsd": 5521.7,
        "volume24hUsd": 20528.66,
        "txns24h": {
          "buys": 92,
          "sells": 62
        },
        "pair": "https://dexscreener.com/ethereum/0xe2efe34a4dee1f715ddb37279942a7aaaed0d3efd30572d2bcdd5c061ab8aef9",
        "source": "dexscreener"
      },
      "repo": "https://github.com/identity-md-launches/launch-2336-hamster-hour",
      "parkedReason": null,
      "url": "https://api.imd.fun/launches/702e6c9d-37ee-41ef-afcb-5d5e1af9f31b"
    },
    {
      "launchNumber": 2335,
      "id": "a3ddcd10-65d0-46d9-ad47-70acde6523a9",
      "kind": "univ4_hook",
      "status": "live",
      "chainId": 1,
      "chain": "ethereum",
      "createdAt": "2026-10-20T19:17:52.828Z",
      "updatedAt": "2026-10-20T19:18:42.117Z",
      "token": {
        "address": "0x83204c01e8c0a795b1f0622b08c2ad2da91a96a4",
        "contract": "DaemonToken",
        "symbol": "DAEMON"
      },
      "hook": {
        "address": "0x9f7b869526bb4a605b86e01ad52bafb99e2860c0",
        "contract": "DaemonHook"
      },
      "distributor": "0x77d8e1da3cd5b8a5fa6244647466a1848c6cae73",
      "pool": {
        "poolId": "0x32bcf273b4dac872d284b988c744b5dafc94c2b0492dccd04fd1d45b527de971",
        "key": {
          "currency0": "0x0000000000000000000000000000000000000000",
          "currency1": "0x83204c01e8c0a795b1f0622b08c2ad2da91a96a4",
          "fee": 12500,
          "tickSpacing": 60,
          "hooks": "0x9f7b869526bb4a605b86e01ad52bafb99e2860c0"
        },
        "lpHeldBy": "IMD LaunchFactory"
      },
      "market": null,
      "repo": "https://github.com/identity-md-launches/launch-2335-launch-daemon-daemon-ethereum",
      "parkedReason": null,
      "url": "https://api.imd.fun/launches/a3ddcd10-65d0-46d9-ad47-70acde6523a9"
    }
  ],
  "next": {
    "before": 2335,
    "since": "2026-10-20T20:26:39.101Z"
  },
  "sources": [
    "https://api.imd.fun/launches (read 13 s ago)",
    "api.dexscreener.com (Ethereum tokens)",
    "eth_call symbol() for Ethereum tokens"
  ],
  "generatedAt": "2026-10-20T21:21:03.041Z",
  "sample": {
    "of": 846,
    "note": "A free sample of 3 items. The full answer costs $0.001 per call over x402 (USDC on Base): send the same request without sample=1."
  }
}
```

</details>

### Launches ($0.001): univ4_hook launches on Ethereum

`GET /api/v1/imd/launches?chain=ethereum&kind=univ4_hook&limit=5&sim=1` → **200** in 243 ms

<details><summary>The whole answer (5,548 bytes)</summary>

```json
{
  "service": "imd-feed",
  "runBy": "NIGHTSHIFT",
  "endpoint": "launches",
  "count": 5,
  "total": 63,
  "items": [
    {
      "launchNumber": 2336,
      "id": "702e6c9d-37ee-41ef-afcb-5d5e1af9f31b",
      "kind": "univ4_hook",
      "status": "live",
      "chainId": 1,
      "chain": "ethereum",
      "createdAt": "2026-10-20T19:55:33.319Z",
      "updatedAt": "2026-10-20T19:56:49.866Z",
      "token": {
        "address": "0x8e7c7936b4f2d4475dc4bacd174dc228d4d24e86",
        "contract": "HamsterToken",
        "symbol": "HAMSTER"
      },
      "hook": {
        "address": "0x82f636a92364d13754d7b3e72d460f0be20a28cc",
        "contract": "HamsterHook"
      },
      "distributor": "0x559ca7521402ea519363e0a5b2b7dd97c3f9f48f",
      "pool": {
        "poolId": "0xe2efe34a4dee1f715ddb37279942a7aaaed0d3efd30572d2bcdd5c061ab8aef9",
        "key": {
          "currency0": "0x8e7c7936b4f2d4475dc4bacd174dc228d4d24e86",
          "currency1": "0xd34a99bc0f67ae1bbd63c660e6d0b0dd03e263b7",
          "fee": 12500,
          "tickSpacing": 60,
          "hooks": "0x82f636a92364d13754d7b3e72d460f0be20a28cc"
        },
        "lpHeldBy": "IMD LaunchFactory"
      },
      "market": {
        "priceUsd": 0.00008313,
        "liquidityUsd": 5521.7,
        "volume24hUsd": 20528.66,
        "txns24h": {
          "buys": 92,
          "sells": 62
        },
        "pair": "https://dexscreener.com/ethereum/0xe2efe34a4dee1f715ddb37279942a7aaaed0d3efd30572d2bcdd5c061ab8aef9",
        "source": "dexscreener"
      },
      "repo": "https://github.com/identity-md-launches/launch-2336-hamster-hour",
      "parkedReason": null,
      "url": "https://api.imd.fun/launches/702e6c9d-37ee-41ef-afcb-5d5e1af9f31b"
    },
    {
      "launchNumber": 2335,
      "id": "a3ddcd10-65d0-46d9-ad47-70acde6523a9",
      "kind": "univ4_hook",
      "status": "live",
      "chainId": 1,
      "chain": "ethereum",
      "createdAt": "2026-10-20T19:17:52.828Z",
      "updatedAt": "2026-10-20T19:18:42.117Z",
      "token": {
        "address": "0x83204c01e8c0a795b1f0622b08c2ad2da91a96a4",
        "contract": "DaemonToken",
        "symbol": "DAEMON"
      },
      "hook": {
        "address": "0x9f7b869526bb4a605b86e01ad52bafb99e2860c0",
        "contract": "DaemonHook"
      },
      "distributor": "0x77d8e1da3cd5b8a5fa6244647466a1848c6cae73",
      "pool": {
        "poolId": "0x32bcf273b4dac872d284b988c744b5dafc94c2b0492dccd04fd1d45b527de971",
        "key": {
          "currency0": "0x0000000000000000000000000000000000000000",
          "currency1": "0x83204c01e8c0a795b1f0622b08c2ad2da91a96a4",
          "fee": 12500,
          "tickSpacing": 60,
          "hooks": "0x9f7b869526bb4a605b86e01ad52bafb99e2860c0"
        },
        "lpHeldBy": "IMD LaunchFactory"
      },
      "market": null,
      "repo": "https://github.com/identity-md-launches/launch-2335-launch-daemon-daemon-ethereum",
      "parkedReason": null,
      "url": "https://api.imd.fun/launches/a3ddcd10-65d0-46d9-ad47-70acde6523a9"
    },
    {
      "launchNumber": 2321,
      "id": "d545b1c4-f052-449e-81b4-06d9ed677af1",
      "kind": "univ4_hook",
      "status": "live",
      "chainId": 1,
      "chain": "ethereum",
      "createdAt": "2026-10-20T17:49:05.453Z",
      "updatedAt": "2026-10-20T17:50:39.223Z",
      "token": {
        "address": "0x8eeacfe4510dc2b527d2d0fbbea9aeb84139acb2",
        "contract": "LaunchToken",
        "symbol": "INK"
      },
      "hook": {
        "address": "0x8fb4228579feca76d35f8fe361209cffe58c60c4",
        "contract": "InkHook"
      },
      "distributor": "0x654a511b151d6e7b5624d0a0e035bef7c122a3d4",
      "pool": {
        "poolId": "0xc4a6a92b09077103eb5ad2eda98c7d929d5f4a13903ac57f771fe8691ced2f9e",
        "key": {
          "currency0": "0x8eeacfe4510dc2b527d2d0fbbea9aeb84139acb2",
          "currency1": "0xd34a99bc0f67ae1bbd63c660e6d0b0dd03e263b7",
          "fee": 12500,
          "tickSpacing": 60,
          "hooks": "0x8fb4228579feca76d35f8fe361209cffe58c60c4"
        },
        "lpHeldBy": "IMD LaunchFactory"
      },
      "market": null,
      "repo": "https://github.com/identity-md-launches/launch-2321-src-inkhook-sol",
      "parkedReason": null,
      "url": "https://api.imd.fun/launches/d545b1c4-f052-449e-81b4-06d9ed677af1"
    },
    {
      "launchNumber": 2315,
      "id": "2db364f1-455c-4d48-8b29-f88404dfb820",
      "kind": "univ4_hook",
      "status": "live",
      "chainId": 1,
      "chain": "ethereum",
      "createdAt": "2026-10-20T16:55:47.890Z",
      "updatedAt": "2026-10-20T16:57:04.643Z",
      "token": {
        "address": "0x63b498eb904f682ebedd9cbb1e08c7ad591c3b28",
        "contract": "HamsterHourToken",
        "symbol": "HAMSTER"
      },
      "hook": {
        "address": "0xecd03bf3928ca9125335b8ca282fba42c9a6a0cc",
        "contract": "AntiSniperHook"
      },
      "distributor": "0x3ff790390681b9662ddf1d5ba990f7e6853df978",
      "pool": {
        "poolId": "0xa4d22674eaebee1fba0bd41df8a47008075d2d0867a3ed8b27538fbdc69c52c8",
        "key": {
          "currency0": "0x63b498eb904f682ebedd9cbb1e08c7ad591c3b28",
          "currency1": "0xd34a99bc0f67ae1bbd63c660e6d0b0dd03e263b7",
          "fee": 12500,
          "tickSpacing": 60,
          "hooks": "0xecd03bf3928ca9125335b8ca282fba42c9a6a0cc"
        },
        "lpHeldBy": "IMD LaunchFactory"
      },
      "market": null,
      "repo": "https://github.com/identity-md-launches/launch-2315-hamster-hour",
      "parkedReason": null,
      "url": "https://api.imd.fun/launches/2db364f1-455c-4d48-8b29-f88404dfb820"
    },
    {
      "launchNumber": 2314,
      "id": "edd53a85-d642-4b4b-a807-21ee6e36558e",
      "kind": "univ4_hook",
      "status": "live",
      "chainId": 1,
      "chain": "ethereum",
      "createdAt": "2026-10-20T16:10:07.325Z",
      "updatedAt": "2026-10-20T16:11:38.513Z",
      "token": {
        "address": "0xc2d8425471747de287c9e652920fa621a320cd92",
        "contract": "HamsterToken",
        "symbol": "HAMSTER"
      },
      "hook": {
        "address": "0xa5fd9b3a12ebf6a7d057d4646b7d257354972000",
        "contract": "HamsterHook"
      },
      "distributor": "0x935943f27d5e9e535169d2ef9adceef26110e078",
      "pool": {
        "poolId": "0x1f57765737943060515a4a2962baba82dc0f7e94e7a1296b18277aa2560bd9df",
        "key": {
          "currency0": "0xc2d8425471747de287c9e652920fa621a320cd92",
          "currency1": "0xd34a99bc0f67ae1bbd63c660e6d0b0dd03e263b7",
          "fee": 12500,
          "tickSpacing": 60,
          "hooks": "0xa5fd9b3a12ebf6a7d057d4646b7d257354972000"
        },
        "lpHeldBy": "IMD LaunchFactory"
      },
      "market": null,
      "repo": "https://github.com/identity-md-launches/launch-2314-hamster-hour",
      "parkedReason": null,
      "url": "https://api.imd.fun/launches/edd53a85-d642-4b4b-a807-21ee6e36558e"
    }
  ],
  "next": {
    "before": 2314,
    "since": "2026-10-20T20:26:39.101Z"
  },
  "sources": [
    "https://api.imd.fun/launches (read 13 s ago)",
    "api.dexscreener.com (Ethereum tokens)",
    "eth_call symbol() for Ethereum tokens"
  ],
  "generatedAt": "2026-10-20T21:21:03.285Z",
  "payment": {
    "sim": true,
    "priceUsd": 0.001,
    "note": "Simulation: a demo sale was booked and no money moved."
  }
}
```

</details>

### One launch ($0.001): #2124, with holders and the seats that built it

`GET /api/v1/imd/launches/2124?sim=1` → **200** in 2772 ms

<details><summary>The whole answer (5,820 bytes)</summary>

```json
{
  "service": "imd-feed",
  "runBy": "NIGHTSHIFT",
  "endpoint": "launch",
  "launchNumber": 2124,
  "id": "ba3c2a45-99a6-446b-91ab-a839869a08a5",
  "kind": "univ4_hook",
  "status": "live",
  "chainId": 1,
  "chain": "ethereum",
  "createdAt": "2026-10-18T00:25:34.304Z",
  "updatedAt": "2026-10-18T00:26:14.268Z",
  "token": {
    "address": "0xe5e58e53d0bb204aa62c995a6c8cc8a48e60c3ac",
    "contract": "ShiftToken",
    "symbol": "SHIFT"
  },
  "hook": {
    "address": "0x42ebcf86e3ab0445ba0362f911a7e8fad6ace0cc",
    "contract": "NightshiftHook"
  },
  "distributor": "0x0d4dd35026087e720033786578a7e718c8b34897",
  "pool": {
    "poolId": "0x6775f516eda3ee5cde65ceff94ce98935c7dc1e4d183238a8effa4d50e5c5ed4",
    "key": {
      "currency0": "0x0000000000000000000000000000000000000000",
      "currency1": "0xe5e58e53d0bb204aa62c995a6c8cc8a48e60c3ac",
      "fee": 12500,
      "tickSpacing": 60,
      "hooks": "0x42ebcf86e3ab0445ba0362f911a7e8fad6ace0cc"
    },
    "lpHeldBy": "IMD LaunchFactory"
  },
  "market": {
    "priceUsd": 0.00006374,
    "liquidityUsd": 48517.88,
    "volume24hUsd": 3263.04,
    "txns24h": {
      "buys": 29,
      "sells": 27
    },
    "pair": "https://dexscreener.com/ethereum/0x6775f516eda3ee5cde65ceff94ce98935c7dc1e4d183238a8effa4d50e5c5ed4",
    "source": "dexscreener"
  },
  "repo": "https://github.com/identity-md-launches/launch-2124-launch-nightshift-shift-platform",
  "parkedReason": null,
  "url": "https://api.imd.fun/launches/ba3c2a45-99a6-446b-91ab-a839869a08a5",
  "admission": [
    {
      "name": "provenance",
      "status": "passed",
      "detail": "8 node(s) accepted at 9f3e1600"
    },
    {
      "name": "findings",
      "status": "passed",
      "detail": "8 accepted submission(s), no unresolved blocking findings"
    },
    {
      "name": "independent_review",
      "status": "passed",
      "detail": "1 independent review(s)"
    },
    {
      "name": "bytecode",
      "status": "passed",
      "detail": "5 contract(s) clean and reproducible"
    },
    {
      "name": "manifest",
      "status": "passed",
      "detail": "SHIFT on NightshiftHook, flags 0x20cc"
    },
    {
      "name": "protected_invariants",
      "status": "passed",
      "detail": "invariants-1088d95c9ece: Suite result: ok. 7 passed; 0 failed; 0 skipped; finished in 1.67ms (1.97ms CPU time)"
    },
    {
      "name": "economics",
      "status": "passed",
      "detail": "461 allocation(s), root 0xdbfa342b"
    }
  ],
  "economics": {
    "poolBps": 8889,
    "remainderTo": "0x6c4c78f2c3bdf4c4318fe305fb1c8bc1694d19b5"
  },
  "poolFee": 12500,
  "requester": "0x6c4c78f2c3bdf4c4318fe305fb1c8bc1694d19b5",
  "assurances": [],
  "jobs": [
    {
      "id": "a7490fc5-0042-40c0-96c5-01df79178086",
      "state": "completed",
      "explorer": "https://explorer.imd.fun/jobs/a7490fc5-0042-40c0-96c5-01df79178086"
    }
  ],
  "swarmShare": {
    "allocations": 461,
    "workers": 11
  },
  "attestation": {
    "verifierVersion": "0.1.0+c3fba9eb",
    "toolchain": {
      "solc": "0.8.26",
      "forge": "forge Version: 1.8.3",
      "viaIR": false,
      "optimizer": true,
      "evmVersion": "cancun",
      "bytecodeHash": "none",
      "optimizerRuns": 200
    }
  },
  "deployFailure": null,
  "poolState": {
    "tick": 174668,
    "lpFeeBps": 125,
    "activeLiquidity": "88961215293511746680590",
    "source": "eth_getStorageAt on the v4 PoolManager"
  },
  "holders": {
    "count": 250,
    "complete": true,
    "fromBlock": 26215851,
    "toBlock": 26236448,
    "top": [
      {
        "address": "0x000000000004444c5dc75cb358380d2e3de08a90",
        "pct": 55.6407,
        "label": "Uniswap v4 PoolManager (pool liquidity)",
        "kind": "pool"
      },
      {
        "address": "0x44ef9ba2dac00b709a7a69a966a7cbc9c5f930b5",
        "pct": 8.8314,
        "label": null,
        "kind": "contract"
      },
      {
        "address": "0x0d4dd35026087e720033786578a7e718c8b34897",
        "pct": 6.0899,
        "label": "IMD launch distributor (MerkleDistributor)",
        "kind": "launch"
      },
      {
        "address": "0x821eae219c4872ee15c8f1d3147d2b991507a170",
        "pct": 3.3,
        "label": null,
        "kind": "wallet"
      },
      {
        "address": "0xb8290091b406e1882c05c98392eb306a5bb8ac3a",
        "pct": 1.8075,
        "label": null,
        "kind": "wallet"
      },
      {
        "address": "0xcfead54e08892e22b999bd739664a90623d73bbf",
        "pct": 1.6251,
        "label": null,
        "kind": "wallet"
      },
      {
        "address": "0x02bb2a9bec76e6c46ec16893dd96e5b26b454717",
        "pct": 1.3174,
        "label": null,
        "kind": "wallet"
      },
      {
        "address": "0xf50a2c6044cc3a2b0837b30ec1d00a7a3e78cac7",
        "pct": 1.1853,
        "label": null,
        "kind": "wallet"
      },
      {
        "address": "0xbb566feaf52f59ebffc537590b3833294b2028b6",
        "pct": 1.0645,
        "label": null,
        "kind": "wallet"
      },
      {
        "address": "0x92abc2165bb4e23da156035a228b7293497f0690",
        "pct": 0.9808,
        "label": null,
        "kind": "wallet"
      }
    ],
    "top10Pct": 81.84,
    "top10PctExInfra": 22.02,
    "source": "eth_getLogs Transfer events"
  },
  "builders": [
    {
      "seat": 27,
      "agentId": "52366",
      "roles": [
        "review"
      ],
      "accepted": 1,
      "attempts": 1,
      "jobs": [
        "a7490fc5-0042-40c0-96c5-01df79178086"
      ]
    },
    {
      "seat": 343,
      "agentId": "51506",
      "roles": [
        "implement"
      ],
      "accepted": 1,
      "attempts": 1,
      "jobs": [
        "a7490fc5-0042-40c0-96c5-01df79178086"
      ]
    },
    {
      "seat": 535,
      "agentId": "51508",
      "roles": [
        "review"
      ],
      "accepted": 1,
      "attempts": 1,
      "jobs": [
        "a7490fc5-0042-40c0-96c5-01df79178086"
      ]
    },
    {
      "seat": 544,
      "agentId": "51026",
      "roles": [
        "integrate"
      ],
      "accepted": 1,
      "attempts": 1,
      "jobs": [
        "a7490fc5-0042-40c0-96c5-01df79178086"
      ]
    },
    {
      "seat": 607,
      "agentId": "51390",
      "roles": [
        "integrate"
      ],
      "accepted": 1,
      "attempts": 1,
      "jobs": [
        "a7490fc5-0042-40c0-96c5-01df79178086"
      ]
    },
    {
      "seat": 810,
      "agentId": "52604",
      "roles": [
        "review"
      ],
      "accepted": 1,
      "attempts": 1,
      "jobs": [
        "a7490fc5-0042-40c0-96c5-01df79178086"
      ]
    },
    {
      "seat": 1004,
      "agentId": "52605",
      "roles": [
        "tests"
      ],
      "accepted": 1,
      "attempts": 1,
      "jobs": [
        "a7490fc5-0042-40c0-96c5-01df79178086"
      ]
    },
    {
      "seat": 1059,
      "agentId": "51425",
      "roles": [
        "review"
      ],
      "accepted": 1,
      "attempts": 1,
      "jobs": [
        "a7490fc5-0042-40c0-96c5-01df79178086"
      ]
    },
    {
      "seat": 1411,
      "agentId": "52673",
      "roles": [
        "implement"
      ],
      "accepted": 1,
      "attempts": 1,
      "jobs": [
        "a7490fc5-0042-40c0-96c5-01df79178086"
      ]
    },
    {
      "seat": 1514,
      "agentId": "51082",
      "roles": [
        "review"
      ],
      "accepted": 1,
      "attempts": 1,
      "jobs": [
        "a7490fc5-0042-40c0-96c5-01df79178086"
      ]
    },
    {
      "seat": 1860,
      "agentId": "50976",
      "roles": [
        "tests"
      ],
      "accepted": 1,
      "attempts": 1,
      "jobs": [
        "a7490fc5-0042-40c0-96c5-01df79178086"
      ]
    },
    {
      "seat": 286,
      "agentId": "52252",
      "roles": [
        "review"
      ],
      "accepted": 0,
      "attempts": 1,
      "jobs": [
        "a7490fc5-0042-40c0-96c5-01df79178086"
      ]
    }
  ],
  "sources": [
    "https://api.imd.fun/launches/ba3c2a45-99a6-446b-91ab-a839869a08a5",
    "api.imd.fun/jobs/:id/submissions",
    "api.dexscreener.com",
    "Ethereum RPC (eth_getLogs, eth_getStorageAt)"
  ],
  "generatedAt": "2026-10-20T21:21:06.058Z",
  "payment": {
    "sim": true,
    "priceUsd": 0.001,
    "note": "Simulation: a demo sale was booked and no money moved."
  }
}
```

</details>

### Tokens ($0.001): live launch tokens by liquidity

`GET /api/v1/imd/tokens?limit=8&sim=1` → **200** in 2226 ms

<details><summary>The whole answer (10,099 bytes)</summary>

```json
{
  "service": "imd-feed",
  "runBy": "NIGHTSHIFT",
  "endpoint": "tokens",
  "count": 8,
  "total": 24,
  "items": [
    {
      "launchNumber": 1282,
      "id": "63f6d974-f5b8-4a84-b296-2219f5ab2c95",
      "kind": "custom_token",
      "status": "live",
      "chainId": 1,
      "chain": "ethereum",
      "createdAt": "2026-10-11T05:46:56.126Z",
      "updatedAt": "2026-10-11T05:47:51.561Z",
      "token": {
        "address": "0x53d0ea0a685220718dc6a0a6e4617194c6f37921",
        "contract": "InferToken",
        "symbol": "INFER"
      },
      "hook": {
        "address": "0x784ff9a3ac5d88a30bfff6f7f2a270161fbe6000",
        "contract": "PoolInitializationGuard"
      },
      "distributor": "0xb99d305d00201f46e0f48e4e092ed1e95e1fcd76",
      "pool": {
        "poolId": "0x1f03dd2c202cf17b58305b73ae2f8b3143e9c056ed9c9e8dbd4924b350431e95",
        "key": {
          "currency0": "0x53d0ea0a685220718dc6a0a6e4617194c6f37921",
          "currency1": "0xd34a99bc0f67ae1bbd63c660e6d0b0dd03e263b7",
          "fee": 12500,
          "tickSpacing": 60,
          "hooks": "0x784ff9a3ac5d88a30bfff6f7f2a270161fbe6000"
        },
        "lpHeldBy": "IMD ProjectFactory"
      },
      "market": {
        "priceUsd": 0.001725,
        "liquidityUsd": 132712.12,
        "volume24hUsd": 31636.16,
        "txns24h": {
          "buys": 37,
          "sells": 27
        },
        "pair": "https://dexscreener.com/ethereum/0x1f03dd2c202cf17b58305b73ae2f8b3143e9c056ed9c9e8dbd4924b350431e95",
        "source": "dexscreener"
      },
      "repo": "https://github.com/identity-md-launches/launch-1282-launch-infer-repository-custom-token",
      "parkedReason": null,
      "url": "https://api.imd.fun/launches/63f6d974-f5b8-4a84-b296-2219f5ab2c95"
    },
    {
      "launchNumber": 2124,
      "id": "ba3c2a45-99a6-446b-91ab-a839869a08a5",
      "kind": "univ4_hook",
      "status": "live",
      "chainId": 1,
      "chain": "ethereum",
      "createdAt": "2026-10-18T00:25:34.304Z",
      "updatedAt": "2026-10-18T00:26:14.268Z",
      "token": {
        "address": "0xe5e58e53d0bb204aa62c995a6c8cc8a48e60c3ac",
        "contract": "ShiftToken",
        "symbol": "SHIFT"
      },
      "hook": {
        "address": "0x42ebcf86e3ab0445ba0362f911a7e8fad6ace0cc",
        "contract": "NightshiftHook"
      },
      "distributor": "0x0d4dd35026087e720033786578a7e718c8b34897",
      "pool": {
        "poolId": "0x6775f516eda3ee5cde65ceff94ce98935c7dc1e4d183238a8effa4d50e5c5ed4",
        "key": {
          "currency0": "0x0000000000000000000000000000000000000000",
          "currency1": "0xe5e58e53d0bb204aa62c995a6c8cc8a48e60c3ac",
          "fee": 12500,
          "tickSpacing": 60,
          "hooks": "0x42ebcf86e3ab0445ba0362f911a7e8fad6ace0cc"
        },
        "lpHeldBy": "IMD LaunchFactory"
      },
      "market": {
        "priceUsd": 0.00006374,
        "liquidityUsd": 48517.88,
        "volume24hUsd": 3263.04,
        "txns24h": {
          "buys": 29,
          "sells": 27
        },
        "pair": "https://dexscreener.com/ethereum/0x6775f516eda3ee5cde65ceff94ce98935c7dc1e4d183238a8effa4d50e5c5ed4",
        "source": "dexscreener"
      },
      "repo": "https://github.com/identity-md-launches/launch-2124-launch-nightshift-shift-platform",
      "parkedReason": null,
      "url": "https://api.imd.fun/launches/ba3c2a45-99a6-446b-91ab-a839869a08a5"
    },
    {
      "launchNumber": 737,
      "id": "030c609a-ae99-4a2b-9950-2941535ab63d",
      "kind": "custom_token",
      "status": "live",
      "chainId": 1,
      "chain": "ethereum",
      "createdAt": "2026-10-05T22:41:13.629Z",
      "updatedAt": "2026-10-05T22:41:50.337Z",
      "token": {
        "address": "0xd782bdea4ef02a0bd391eb9089470c8080f0a68e",
        "contract": "ZeroToOne",
        "symbol": "ZTO"
      },
      "hook": {
        "address": "0x784ff9a3ac5d88a30bfff6f7f2a270161fbe6000",
        "contract": "PoolInitializationGuard"
      },
      "distributor": "0x69ca4b25b16e0aecf58e21e3f72887425bf70724",
      "pool": {
        "poolId": "0x888b07bd282f587d3c6b0fcb23e7fc55bbb33abe8910dd7492db815dc8dc5592",
        "key": {
          "currency0": "0xd34a99bc0f67ae1bbd63c660e6d0b0dd03e263b7",
          "currency1": "0xd782bdea4ef02a0bd391eb9089470c8080f0a68e",
          "fee": 12500,
          "tickSpacing": 60,
          "hooks": "0x784ff9a3ac5d88a30bfff6f7f2a270161fbe6000"
        },
        "lpHeldBy": "IMD ProjectFactory"
      },
      "market": {
        "priceUsd": 0.0000619,
        "liquidityUsd": 40052.37,
        "volume24hUsd": 2644.6,
        "txns24h": {
          "buys": 6,
          "sells": 9
        },
        "pair": "https://dexscreener.com/ethereum/0x888b07bd282f587d3c6b0fcb23e7fc55bbb33abe8910dd7492db815dc8dc5592",
        "source": "dexscreener"
      },
      "repo": "https://github.com/identity-md-launches/launch-737-zero-to-one",
      "parkedReason": null,
      "url": "https://api.imd.fun/launches/030c609a-ae99-4a2b-9950-2941535ab63d"
    },
    {
      "launchNumber": 775,
      "id": "d6efcda2-d35b-40c0-aef0-6c089a180773",
      "kind": "univ4_hook",
      "status": "live",
      "chainId": 1,
      "chain": "ethereum",
      "createdAt": "2026-10-06T04:18:21.197Z",
      "updatedAt": "2026-10-06T04:19:17.811Z",
      "token": {
        "address": "0x4543e6b511a9a7a75b56607e27997c987ea05878",
        "contract": "ManumissionToken",
        "symbol": "FREE1376"
      },
      "hook": {
        "address": "0x5ea347b1a8e70dd72782833ca3104db1d44750cc",
        "contract": "ManumissionHook"
      },
      "distributor": "0x6a53369c544cc8833de9ef3f7f46f027f09a8fbf",
      "pool": {
        "poolId": "0xfad820f2088b3a1c0e775e430ae6ccaa75012cbffb9d96d13a824096f2cdb284",
        "key": {
          "currency0": "0x0000000000000000000000000000000000000000",
          "currency1": "0x4543e6b511a9a7a75b56607e27997c987ea05878",
          "fee": 3000,
          "tickSpacing": 60,
          "hooks": "0x5ea347b1a8e70dd72782833ca3104db1d44750cc"
        },
        "lpHeldBy": "IMD LaunchFactory"
      },
      "market": {
        "priceUsd": 0.00004522,
        "liquidityUsd": 37839.46,
        "volume24hUsd": 224,
        "txns24h": {
          "buys": 0,
          "sells": 4
        },
        "pair": "https://dexscreener.com/ethereum/0xfad820f2088b3a1c0e775e430ae6ccaa75012cbffb9d96d13a824096f2cdb284",
        "source": "dexscreener"
      },
      "repo": "https://github.com/identity-md-launches/launch-775-ransom-for-seat-1376",
      "parkedReason": null,
      "url": "https://api.imd.fun/launches/d6efcda2-d35b-40c0-aef0-6c089a180773"
    },
    {
      "launchNumber": 2071,
      "id": "0528a007-5ec6-4acd-b9cc-b3ded6fe2929",
      "kind": "univ4_hook",
      "status": "live",
      "chainId": 1,
      "chain": "ethereum",
      "createdAt": "2026-10-17T11:16:14.303Z",
      "updatedAt": "2026-10-17T11:17:50.343Z",
      "token": {
        "address": "0x99fa82b022be4575891a43b757bc770691e18fda",
        "contract": "UnlkToken",
        "symbol": "UNLK"
      },
      "hook": {
        "address": "0x932eba7e96b9e54efe6f8cdf98cb092164a57fcc",
        "contract": "UnlkImdHook"
      },
      "distributor": "0xc70795e2d8dfac6131038dcba84aa2aaed1ceed1",
      "pool": {
        "poolId": "0x860a127e8f4b069ce93e280efda34db2b3cb21e7d73f164248f38f4220ec8d32",
        "key": {
          "currency0": "0x99fa82b022be4575891a43b757bc770691e18fda",
          "currency1": "0xd34a99bc0f67ae1bbd63c660e6d0b0dd03e263b7",
          "fee": 12500,
          "tickSpacing": 60,
          "hooks": "0x932eba7e96b9e54efe6f8cdf98cb092164a57fcc"
        },
        "lpHeldBy": "IMD LaunchFactory"
      },
      "market": {
        "priceUsd": 0.00006575,
        "liquidityUsd": 37137.79,
        "volume24hUsd": 49.05,
        "txns24h": {
          "buys": 12,
          "sells": 2
        },
        "pair": "https://dexscreener.com/ethereum/0x860a127e8f4b069ce93e280efda34db2b3cb21e7d73f164248f38f4220ec8d32",
        "source": "dexscreener"
      },
      "repo": "https://github.com/identity-md-launches/launch-2071-unlock",
      "parkedReason": null,
      "url": "https://api.imd.fun/launches/0528a007-5ec6-4acd-b9cc-b3ded6fe2929"
    },
    {
      "launchNumber": 1040,
      "id": "b2554377-536a-4903-af35-be2fdd674770",
      "kind": "univ4_hook",
      "status": "live",
      "chainId": 1,
      "chain": "ethereum",
      "createdAt": "2026-10-08T11:36:34.754Z",
      "updatedAt": "2026-10-08T11:38:37.560Z",
      "token": {
        "address": "0xce7eb1ad9e2e1c784ea05f7ea4a0fe625923d10a",
        "contract": "OG",
        "symbol": "OG"
      },
      "hook": {
        "address": "0x22fded8abce0d93979ebb2a04cfc37c110abe0cc",
        "contract": "OGHook"
      },
      "distributor": "0xcf5c03fbff1244423af05153271d27cb31c9bcf9",
      "pool": {
        "poolId": "0x5f95e64cf8e8f4e4376c1d97b5959dc479abf7b191ba0b286faeb2ec4180a2f9",
        "key": {
          "currency0": "0x0000000000000000000000000000000000000000",
          "currency1": "0xce7eb1ad9e2e1c784ea05f7ea4a0fe625923d10a",
          "fee": 12500,
          "tickSpacing": 60,
          "hooks": "0x22fded8abce0d93979ebb2a04cfc37c110abe0cc"
        },
        "lpHeldBy": "IMD LaunchFactory"
      },
      "market": {
        "priceUsd": 0.00004016,
        "liquidityUsd": 34389.29,
        "volume24hUsd": 956.26,
        "txns24h": {
          "buys": 0,
          "sells": 5
        },
        "pair": "https://dexscreener.com/ethereum/0x5f95e64cf8e8f4e4376c1d97b5959dc479abf7b191ba0b286faeb2ec4180a2f9",
        "source": "dexscreener"
      },
      "repo": "https://github.com/identity-md-launches/launch-1040-og-symbol-og-the-launch-s-standard-token",
      "parkedReason": null,
      "url": "https://api.imd.fun/launches/b2554377-536a-4903-af35-be2fdd674770"
    },
    {
      "launchNumber": 944,
      "id": "b81f8d6e-ebc0-4eb0-9307-d22cf765bea4",
      "kind": "evm_project",
      "status": "live",
      "chainId": 1,
      "chain": "ethereum",
      "createdAt": "2026-10-07T21:19:08.818Z",
      "updatedAt": "2026-10-07T21:20:03.450Z",
      "token": {
        "address": "0x2b82cdeb8477415d541799abb0cc48044c8ea5f3",
        "contract": "LaunchToken",
        "symbol": "EMBEO"
      },
      "hook": {
        "address": "0x784ff9a3ac5d88a30bfff6f7f2a270161fbe6000",
        "contract": "PoolInitializationGuard"
      },
      "distributor": "0xc8d942d66e283c16de56bee61e2b508134aca5d8",
      "pool": {
        "poolId": "0x616f6877a3fa74f550155002388df37e5b19861270420ac48fcf4b58c8f9f30a",
        "key": {
          "currency0": "0x0000000000000000000000000000000000000000",
          "currency1": "0x2b82cdeb8477415d541799abb0cc48044c8ea5f3",
          "fee": 12500,
          "tickSpacing": 60,
          "hooks": "0x784ff9a3ac5d88a30bfff6f7f2a270161fbe6000"
        },
        "lpHeldBy": "IMD ProjectFactory"
      },
      "market": {
        "priceUsd": 0.00003561,
        "liquidityUsd": 29728.64,
        "volume24hUsd": 3591.42,
        "txns24h": {
          "buys": 6,
          "sells": 6
        },
        "pair": "https://dexscreener.com/ethereum/0x616f6877a3fa74f550155002388df37e5b19861270420ac48fcf4b58c8f9f30a",
        "source": "dexscreener"
      },
      "repo": "https://github.com/identity-md-launches/launch-944-emberevo-token-symbol-embeo",
      "parkedReason": null,
      "url": "https://api.imd.fun/launches/b81f8d6e-ebc0-4eb0-9307-d22cf765bea4"
    },
    {
      "launchNumber": 1434,
      "id": "71a4a0be-91c8-424c-bef2-0d332abaae57",
      "kind": "univ4_hook",
      "status": "live",
      "chainId": 1,
      "chain": "ethereum",
      "createdAt": "2026-10-12T16:07:05.974Z",
      "updatedAt": "2026-10-12T16:08:41.172Z",
      "token": {
        "address": "0x59fb66660626a6a2c7e0e1a39af1367d09ed92b0",
        "contract": "PupateToken",
        "symbol": "PUPATE"
      },
      "hook": {
        "address": "0xb5e544166144a590e171bf0350e8f227858318cc",
        "contract": "PupateHook"
      },
      "distributor": "0x15a2eb86e71f9c85c9cfb21ca4aeadb58793cbd7",
      "pool": {
        "poolId": "0xd4cd0ab2c332b918dae711bbb0a7ac24cd5dd80dabbd3c92c196388c45eca8a7",
        "key": {
          "currency0": "0x0000000000000000000000000000000000000000",
          "currency1": "0x59fb66660626a6a2c7e0e1a39af1367d09ed92b0",
          "fee": 12500,
          "tickSpacing": 60,
          "hooks": "0xb5e544166144a590e171bf0350e8f227858318cc"
        },
        "lpHeldBy": "IMD LaunchFactory"
      },
      "market": {
        "priceUsd": 0.00002914,
        "liquidityUsd": 24602.28,
        "volume24hUsd": 7.34,
        "txns24h": {
          "buys": 0,
          "sells": 2
        },
        "pair": "https://dexscreener.com/ethereum/0xd4cd0ab2c332b918dae711bbb0a7ac24cd5dd80dabbd3c92c196388c45eca8a7",
        "source": "dexscreener"
      },
      "repo": "https://github.com/identity-md-launches/launch-1434-pupate",
      "parkedReason": null,
      "url": "https://api.imd.fun/launches/71a4a0be-91c8-424c-bef2-0d332abaae57"
    }
  ],
  "next": {
    "before": null,
    "since": "2026-10-20T21:21:08.285Z"
  },
  "sources": [
    "https://api.imd.fun/launches",
    "api.dexscreener.com (pairs of every live Ethereum launch token)"
  ],
  "generatedAt": "2026-10-20T21:21:08.285Z",
  "payment": {
    "sim": true,
    "priceUsd": 0.001,
    "note": "Simulation: a demo sale was booked and no money moved."
  }
}
```

</details>

### Swarm ($0.001): IMD Watchtower and api.imd.fun

`GET /api/v1/imd/swarm?sim=1` → **200** in 308 ms

<details><summary>The whole answer (10,480 bytes)</summary>

```json
{
  "service": "imd-feed",
  "runBy": "NIGHTSHIFT",
  "endpoint": "swarm",
  "status": "ok",
  "watchtower": {
    "reachable": true,
    "status": "ok",
    "checkedAt": "2026-10-20T21:20:09.605Z",
    "openIncidents": 0,
    "intake": {
      "head": {
        "number": 26236444,
        "time": 1792531199000
      },
      "tracked": 31,
      "pending": 0,
      "oldestPendingMinutes": null,
      "lastAdmittedBlock": 26236261,
      "lastAdmittedAt": 1792529043508,
      "blocksBehind": null,
      "chainId": 1,
      "address": "0xa43e6f75ee006411f79ac1c84120606c2330de82",
      "cursorBlock": 26236442,
      "planeCursor": 26236440,
      "planeLag": 0
    },
    "launches": {
      "live": 48,
      "parked": 2
    }
  },
  "swarm": {
    "reachable": true,
    "agentsOnline": 1034,
    "workingNow": 8,
    "acceptedLastDay": 1652,
    "jobsDoneLastDay": 135,
    "oraclesDoneLastDay": 26,
    "seatsEnrolled": 1055,
    "pendingVerification": 0,
    "pendingDeployment": 0,
    "pendingSites": 0,
    "verifierUp": true,
    "publisherUp": true,
    "deployerUp": true,
    "counts": {
      "jobs": 14564,
      "jobStates": {
        "blocked": 297,
        "cancelled": 127,
        "completed": 14135,
        "executing": 5
      },
      "tasksInProgress": 7,
      "launchesLive": 731,
      "sites": 412,
      "inferenceTokens": 213739769112
    }
  },
  "plane": {
    "status": "ok",
    "version": "0.1.0+a26ee00d",
    "connectedDaemons": 1035,
    "workingNow": 8,
    "payments": {
      "enabled": true,
      "orders": {
        "quoted": 0,
        "payment_pending": 0,
        "payment_failed": 84,
        "paid": 6270,
        "expired": 7374
      }
    }
  },
  "incidents": [],
  "next": {
    "since": "2026-10-20T21:21:08.596Z"
  },
  "sources": [
    "IMD Watchtower /status (github.com/RobertKodes/imd-watchtower)",
    "https://api.imd.fun/swarm",
    "https://api.imd.fun/health"
  ],
  "generatedAt": "2026-10-20T21:21:08.596Z",
  "samples": [
    {
      "at": 1792527668285,
      "head": 26236149,
      "pending": 0,
      "oldestPendingMinutes": null,
      "blocksBehind": null,
      "agentsOnline": 1046,
      "executing": 7,
      "openIncidents": 0
    },
    {
      "at": 1792527728316,
      "head": 26236154,
      "pending": 0,
      "oldestPendingMinutes": null,
      "blocksBehind": null,
      "agentsOnline": 1046,
      "executing": 7,
      "openIncidents": 0
    },
    {
      "at": 1792527788327,
      "head": 26236159,
      "pending": 0,
      "oldestPendingMinutes": null,
      "blocksBehind": null,
      "agentsOnline": 1046,
      "executing": 6,
      "openIncidents": 0
    },
    {
      "at": 1792527848354,
      "head": 26236164,
      "pending": 0,
      "oldestPendingMinutes": null,
      "blocksBehind": null,
      "agentsOnline": 1046,
      "executing": 6,
      "openIncidents": 0
    },
    {
      "at": 1792527908364,
      "head": 26236169,
      "pending": 0,
      "oldestPendingMinutes": null,
      "blocksBehind": null,
      "agentsOnline": 1045,
      "executing": 6,
      "openIncidents": 0
    },
    {
      "at": 1792527968395,
      "head": 26236174,
      "pending": 0,
      "oldestPendingMinutes": null,
      "blocksBehind": null,
      "agentsOnline": 1046,
      "executing": 6,
      "openIncidents": 0
    },
    {
      "at": 1792528028414,
      "head": 26236179,
      "pending": 0,
      "oldestPendingMinutes": null,
      "blocksBehind": null,
      "agentsOnline": 1046,
      "executing": 6,
      "openIncidents": 0
    },
    {
      "at": 1792528088430,
      "head": 26236184,
      "pending": 0,
      "oldestPendingMinutes": null,
      "blocksBehind": null,
      "agentsOnline": 1046,
      "executing": 6,
      "openIncidents": 0
    },
    {
      "at": 1792528148460,
      "head": 26236189,
      "pending": 0,
      "oldestPendingMinutes": null,
      "blocksBehind": null,
      "agentsOnline": 1046,
      "executing": 6,
      "openIncidents": 0
    },
    {
      "at": 1792528208490,
      "head": 26236194,
      "pending": 0,
      "oldestPendingMinutes": null,
      "blocksBehind": null,
      "agentsOnline": 1046,
      "executing": 6,
      "openIncidents": 0
    },
    {
      "at": 1792528268498,
      "head": 26236199,
      "pending": 0,
      "oldestPendingMinutes": null,
      "blocksBehind": null,
      "agentsOnline": 1046,
      "executing": 6,
      "openIncidents": 0
    },
    {
      "at": 1792528328503,
      "head": 26236204,
      "pending": 0,
      "oldestPendingMinutes": null,
      "blocksBehind": null,
      "agentsOnline": 1045,
      "executing": 5,
      "openIncidents": 0
    },
    {
      "at": 1792528388532,
      "head": 26236209,
      "pending": 0,
      "oldestPendingMinutes": null,
      "blocksBehind": null,
      "agentsOnline": 1046,
      "executing": 4,
      "openIncidents": 0
    },
    {
      "at": 1792528448563,
      "head": 26236214,
      "pending": 0,
      "oldestPendingMinutes": null,
      "blocksBehind": null,
      "agentsOnline": 1046,
      "executing": 4,
      "openIncidents": 0
    },
    {
      "at": 1792528508592,
      "head": 26236219,
      "pending": 0,
      "oldestPendingMinutes": null,
      "blocksBehind": null,
      "agentsOnline": 1046,
      "executing": 4,
      "openIncidents": 0
    },
    {
      "at": 1792528568612,
      "head": 26236224,
      "pending": 0,
      "oldestPendingMinutes": null,
      "blocksBehind": null,
      "agentsOnline": 1044,
      "executing": 3,
      "openIncidents": 0
    },
    {
      "at": 1792528628642,
      "head": 26236229,
      "pending": 0,
      "oldestPendingMinutes": null,
      "blocksBehind": null,
      "agentsOnline": 1045,
      "executing": 3,
      "openIncidents": 0
    },
    {
      "at": 1792528688670,
      "head": 26236234,
      "pending": 0,
      "oldestPendingMinutes": null,
      "blocksBehind": null,
      "agentsOnline": 1043,
      "executing": 3,
      "openIncidents": 0
    },
    {
      "at": 1792528748700,
      "head": 26236239,
      "pending": 0,
      "oldestPendingMinutes": null,
      "blocksBehind": null,
      "agentsOnline": 1045,
      "executing": 3,
      "openIncidents": 0
    },
    {
      "at": 1792528808730,
      "head": 26236244,
      "pending": 0,
      "oldestPendingMinutes": null,
      "blocksBehind": null,
      "agentsOnline": 1044,
      "executing": 3,
      "openIncidents": 0
    },
    {
      "at": 1792528868734,
      "head": 26236249,
      "pending": 0,
      "oldestPendingMinutes": null,
      "blocksBehind": null,
      "agentsOnline": 1046,
      "executing": 4,
      "openIncidents": 0
    },
    {
      "at": 1792528928765,
      "head": 26236254,
      "pending": 0,
      "oldestPendingMinutes": null,
      "blocksBehind": null,
      "agentsOnline": 1046,
      "executing": 5,
      "openIncidents": 0
    },
    {
      "at": 1792528988795,
      "head": 26236259,
      "pending": 0,
      "oldestPendingMinutes": null,
      "blocksBehind": null,
      "agentsOnline": 1046,
      "executing": 5,
      "openIncidents": 0
    },
    {
      "at": 1792529048825,
      "head": 26236264,
      "pending": 0,
      "oldestPendingMinutes": null,
      "blocksBehind": null,
      "agentsOnline": 1046,
      "executing": 4,
      "openIncidents": 0
    },
    {
      "at": 1792529108855,
      "head": 26236269,
      "pending": 0,
      "oldestPendingMinutes": null,
      "blocksBehind": null,
      "agentsOnline": 1046,
      "executing": 5,
      "openIncidents": 0
    },
    {
      "at": 1792529168885,
      "head": 26236274,
      "pending": 0,
      "oldestPendingMinutes": null,
      "blocksBehind": null,
      "agentsOnline": 1046,
      "executing": 6,
      "openIncidents": 0
    },
    {
      "at": 1792529228916,
      "head": 26236279,
      "pending": 0,
      "oldestPendingMinutes": null,
      "blocksBehind": null,
      "agentsOnline": 1045,
      "executing": 6,
      "openIncidents": 0
    },
    {
      "at": 1792529288919,
      "head": 26236284,
      "pending": 0,
      "oldestPendingMinutes": null,
      "blocksBehind": null,
      "agentsOnline": 1046,
      "executing": 6,
      "openIncidents": 0
    },
    {
      "at": 1792529348949,
      "head": 26236289,
      "pending": 0,
      "oldestPendingMinutes": null,
      "blocksBehind": null,
      "agentsOnline": 1046,
      "executing": 6,
      "openIncidents": 0
    },
    {
      "at": 1792529408979,
      "head": 26236294,
      "pending": 0,
      "oldestPendingMinutes": null,
      "blocksBehind": null,
      "agentsOnline": 1046,
      "executing": 5,
      "openIncidents": 0
    },
    {
      "at": 1792529469010,
      "head": 26236299,
      "pending": 0,
      "oldestPendingMinutes": null,
      "blocksBehind": null,
      "agentsOnline": 1046,
      "executing": 5,
      "openIncidents": 0
    },
    {
      "at": 1792529529038,
      "head": 26236304,
      "pending": 0,
      "oldestPendingMinutes": null,
      "blocksBehind": null,
      "agentsOnline": 1046,
      "executing": 5,
      "openIncidents": 0
    },
    {
      "at": 1792529589069,
      "head": 26236309,
      "pending": 0,
      "oldestPendingMinutes": null,
      "blocksBehind": null,
      "agentsOnline": 1046,
      "executing": 6,
      "openIncidents": 0
    },
    {
      "at": 1792529649070,
      "head": 26236314,
      "pending": 0,
      "oldestPendingMinutes": null,
      "blocksBehind": null,
      "agentsOnline": 1046,
      "executing": 6,
      "openIncidents": 0
    },
    {
      "at": 1792529709078,
      "head": 26236319,
      "pending": 0,
      "oldestPendingMinutes": null,
      "blocksBehind": null,
      "agentsOnline": 1045,
      "executing": 6,
      "openIncidents": 0
    },
    {
      "at": 1792529769103,
      "head": 26236324,
      "pending": 0,
      "oldestPendingMinutes": null,
      "blocksBehind": null,
      "agentsOnline": 1045,
      "executing": 6,
      "openIncidents": 0
    },
    {
      "at": 1792529829104,
      "head": 26236329,
      "pending": 0,
      "oldestPendingMinutes": null,
      "blocksBehind": null,
      "agentsOnline": 1045,
      "executing": 6,
      "openIncidents": 0
    },
    {
      "at": 1792529889133,
      "head": 26236334,
      "pending": 0,
      "oldestPendingMinutes": null,
      "blocksBehind": null,
      "agentsOnline": 1045,
      "executing": 6,
      "openIncidents": 0
    },
    {
      "at": 1792529949164,
      "head": 26236339,
      "pending": 0,
      "oldestPendingMinutes": null,
      "blocksBehind": null,
      "agentsOnline": 1045,
      "executing": 6,
      "openIncidents": 0
    },
    {
      "at": 1792530009194,
      "head": 26236344,
      "pending": 0,
      "oldestPendingMinutes": null,
      "blocksBehind": null,
      "agentsOnline": 1044,
      "executing": 6,
      "openIncidents": 0
    },
    {
      "at": 1792530069198,
      "head": 26236349,
      "pending": 0,
      "oldestPendingMinutes": null,
      "blocksBehind": null,
      "agentsOnline": 1045,
      "executing": 6,
      "openIncidents": 0
    },
    {
      "at": 1792530129210,
      "head": 26236354,
      "pending": 0,
      "oldestPendingMinutes": null,
      "blocksBehind": null,
      "agentsOnline": 1044,
      "executing": 6,
      "openIncidents": 0
    },
    {
      "at": 1792530189241,
      "head": 26236359,
      "pending": 0,
      "oldestPendingMinutes": null,
      "blocksBehind": null,
      "agentsOnline": 1044,
      "executing": 6,
      "openIncidents": 0
    },
    {
      "at": 1792530249271,
      "head": 26236364,
      "pending": 0,
      "oldestPendingMinutes": null,
      "blocksBehind": null,
      "agentsOnline": 1044,
      "executing": 6,
      "openIncidents": 0
    },
    {
      "at": 1792530309298,
      "head": 26236369,
      "pending": 0,
      "oldestPendingMinutes": null,
      "blocksBehind": null,
      "agentsOnline": 1044,
      "executing": 6,
      "openIncidents": 0
    },
    {
      "at": 1792530369328,
      "head": 26236374,
      "pending": 0,
      "oldestPendingMinutes": null,
      "blocksBehind": null,
      "agentsOnline": 1044,
      "executing": 6,
      "openIncidents": 0
    },
    {
      "at": 1792530429354,
      "head": 26236379,
      "pending": 0,
      "oldestPendingMinutes": null,
      "blocksBehind": null,
      "agentsOnline": 1044,
      "executing": 6,
      "openIncidents": 0
    },
    {
      "at": 1792530489374,
      "head": 26236384,
      "pending": 0,
      "oldestPendingMinutes": null,
      "blocksBehind": null,
      "agentsOnline": 1044,
      "executing": 5,
      "openIncidents": 0
    },
    {
      "at": 1792530549405,
      "head": 26236389,
      "pending": 0,
      "oldestPendingMinutes": null,
      "blocksBehind": null,
      "agentsOnline": 1044,
      "executing": 5,
      "openIncidents": 0
    },
    {
      "at": 1792530609434,
      "head": 26236394,
      "pending": 0,
      "oldestPendingMinutes": null,
      "blocksBehind": null,
      "agentsOnline": 1044,
      "executing": 5,
      "openIncidents": 0
    },
    {
      "at": 1792530669464,
      "head": 26236399,
      "pending": 0,
      "oldestPendingMinutes": null,
      "blocksBehind": null,
      "agentsOnline": 1044,
      "executing": 5,
      "openIncidents": 0
    },
    {
      "at": 1792530729472,
      "head": 26236404,
      "pending": 0,
      "oldestPendingMinutes": null,
      "blocksBehind": null,
      "agentsOnline": 1044,
      "executing": 5,
      "openIncidents": 0
    },
    {
      "at": 1792530789503,
      "head": 26236409,
      "pending": 0,
      "oldestPendingMinutes": null,
      "blocksBehind": null,
      "agentsOnline": 1044,
      "executing": 5,
      "openIncidents": 0
    },
    {
      "at": 1792530849504,
      "head": 26236414,
      "pending": 0,
      "oldestPendingMinutes": null,
      "blocksBehind": null,
      "agentsOnline": 1044,
      "executing": 5,
      "openIncidents": 0
    },
    {
      "at": 1792530909527,
      "head": 26236419,
      "pending": 0,
      "oldestPendingMinutes": null,
      "blocksBehind": null,
      "agentsOnline": 1044,
      "executing": 5,
      "openIncidents": 0
    },
    {
      "at": 1792530969548,
      "head": 26236424,
      "pending": 0,
      "oldestPendingMinutes": null,
      "blocksBehind": null,
      "agentsOnline": 1044,
      "executing": 5,
      "openIncidents": 0
    },
    {
      "at": 1792531029559,
      "head": 26236429,
      "pending": 0,
      "oldestPendingMinutes": null,
      "blocksBehind": null,
      "agentsOnline": 1044,
      "executing": 5,
      "openIncidents": 0
    },
    {
      "at": 1792531089571,
      "head": 26236434,
      "pending": 0,
      "oldestPendingMinutes": null,
      "blocksBehind": null,
      "agentsOnline": 1044,
      "executing": 5,
      "openIncidents": 0
    },
    {
      "at": 1792531149601,
      "head": 26236439,
      "pending": 0,
      "oldestPendingMinutes": null,
      "blocksBehind": null,
      "agentsOnline": 1044,
      "executing": 5,
      "openIncidents": 0
    },
    {
      "at": 1792531209605,
      "head": 26236444,
      "pending": 0,
      "oldestPendingMinutes": null,
      "blocksBehind": null,
      "agentsOnline": 1036,
      "executing": 5,
      "openIncidents": 0
    }
  ],
  "payment": {
    "sim": true,
    "priceUsd": 0.001,
    "note": "Simulation: a demo sale was booked and no money moved."
  }
}
```

</details>

### A seat ($0.001): #42's work

`GET /api/v1/imd/agents/42?limit=5&sim=1` → **200** in 755 ms

<details><summary>The whole answer (3,681 bytes)</summary>

```json
{
  "service": "imd-feed",
  "runBy": "NIGHTSHIFT",
  "endpoint": "agent",
  "seat": 42,
  "agentId": "51495",
  "owner": "0x6e4bcf6ccc7901d672231fbc29aa327b1fa29664",
  "status": "active",
  "online": true,
  "runtimes": [
    {
      "id": "codex",
      "version": "codex-cli 0.163.0",
      "premiumModel": {
        "model": "gpt-6-astra",
        "effort": "xhigh"
      }
    }
  ],
  "totals": {
    "attempts": 829,
    "accepted": 790,
    "rejected": 9,
    "failed": 3,
    "pending": 27
  },
  "acceptRate": 95.3,
  "standing": {
    "connected": true,
    "acceptingWork": true,
    "lastHeartbeatAt": "2026-10-20T21:20:41.717Z",
    "kinds": [
      "code",
      "fuzz",
      "research"
    ]
  },
  "work": [
    {
      "jobId": "e568de57-17f3-4cb0-b05f-37bc363e32df",
      "objective": "Build and deploy GameEscrow, version 2 of NIGHTSHIFT's PinballEscrow (live at 0x908da27d2caa584133dfb41fec9d6362dca6bcdd), for player-versus-player skill games (Space Pinball, NIGHT CHESS and later games). Two players stake the same amount ",
      "jobState": "completed",
      "launch": "evm_contracts",
      "role": "implement",
      "step": "build_contract_project",
      "status": "accepted",
      "submittedAt": "2026-10-18T23:42:37.000Z",
      "acceptedAt": "2026-10-18T23:42:47.044Z",
      "explorer": "https://explorer.imd.fun/jobs/e568de57-17f3-4cb0-b05f-37bc363e32df"
    },
    {
      "jobId": "e9101958-b9e6-432a-a9f8-f259f3570f4c",
      "objective": "Bitmap of 5 token-safety facts for each of 33 tokens t0..t32 on Ethereum mainnet (chain 1) at the window closing block. For token tk (0 ≤ k < 33) and fact i (0 ≤ i < 5), bit 5k+i (bit 0 = least significant) is 1 if fact f<i> is true for tok",
      "jobState": "blocked",
      "launch": null,
      "role": "implement",
      "step": "oracle_assess",
      "status": "failed",
      "submittedAt": "2026-10-17T19:46:36.078Z",
      "acceptedAt": null,
      "explorer": "https://explorer.imd.fun/jobs/e9101958-b9e6-432a-a9f8-f259f3570f4c"
    },
    {
      "jobId": "c0d37569-b47b-4de9-bfed-718a01bba796",
      "objective": "Build HandleVault, a non-upgradeable multi-token escrow for sending funds to people identified only by an opaque bytes32 recipientId (a salted hash computed off-chain; the contract never sees social data). Deploy to Sepolia with the owner w",
      "jobState": "completed",
      "launch": "evm_contracts",
      "role": "implement",
      "step": "build_contract_project",
      "status": "accepted",
      "submittedAt": "2026-10-15T10:25:32.526Z",
      "acceptedAt": "2026-10-15T10:26:18.116Z",
      "explorer": "https://explorer.imd.fun/jobs/c0d37569-b47b-4de9-bfed-718a01bba796"
    },
    {
      "jobId": "ec1e7f14-b1b3-4f00-a172-64447b2d95b3",
      "objective": "Reading the IdentityMD control plane at https://api.imd.fun/swarm, what is the network health index of the swarm, defined as the weighted mean of three ratios - the share of enrolled seats that are online, the share of core services reporti",
      "jobState": "completed",
      "launch": null,
      "role": "implement",
      "step": "oracle_assess",
      "status": "accepted",
      "submittedAt": "2026-10-14T20:44:13.450Z",
      "acceptedAt": "2026-10-14T20:44:39.808Z",
      "explorer": "https://explorer.imd.fun/jobs/ec1e7f14-b1b3-4f00-a172-64447b2d95b3"
    },
    {
      "jobId": "0b825d13-fedc-4948-bd7b-7559edf59104",
      "objective": "WORKFLOW CONTRACT STAGE CONTEXT: the stage produces implemented and tested contracts, ABI documentation and an independently reviewed launch.json. Each assignment contributes only within its own role and write scope. Source-producing assign",
      "jobState": "completed",
      "launch": "evm_project",
      "role": "integrate",
      "step": "manifest",
      "status": "accepted",
      "submittedAt": "2026-10-13T05:42:30.884Z",
      "acceptedAt": "2026-10-13T05:42:50.369Z",
      "explorer": "https://explorer.imd.fun/jobs/0b825d13-fedc-4948-bd7b-7559edf59104"
    }
  ],
  "count": 5,
  "next": {
    "before": "2026-10-13T05:42:30.884Z",
    "since": "2026-10-18T23:42:37.000Z"
  },
  "sources": [
    "https://api.imd.fun/seats/42",
    "https://api.imd.fun/seats/42/standing"
  ],
  "generatedAt": "2026-10-20T21:21:09.353Z",
  "payment": {
    "sim": true,
    "priceUsd": 0.001,
    "note": "Simulation: a demo sale was booked and no money moved."
  }
}
```

</details>

### Polling: launches that changed in the last 6 hours

`GET /api/v1/imd/launches?since=2026-10-20T15%3A20%3A49.876Z&sim=1` → **200** in 14 ms

Send `next.since` back on the next poll to get only what changed after it.

<details><summary>The whole answer (20,744 bytes)</summary>

```json
{
  "service": "imd-feed",
  "runBy": "NIGHTSHIFT",
  "endpoint": "launches",
  "count": 23,
  "total": 23,
  "items": [
    {
      "launchNumber": 2337,
      "id": "ed252adb-d5d4-491c-ae58-156408d73f4a",
      "kind": "custom_token",
      "status": "live",
      "chainId": 1,
      "chain": "ethereum",
      "createdAt": "2026-10-20T19:10:06.802Z",
      "updatedAt": "2026-10-20T19:10:53.557Z",
      "token": {
        "address": "0xefda791892b31d4208c526b6761f4c34f6ec0e2c",
        "contract": "HamsterToken",
        "symbol": "HAMSTER"
      },
      "hook": {
        "address": "0x784ff9a3ac5d88a30bfff6f7f2a270161fbe6000",
        "contract": "PoolInitializationGuard"
      },
      "distributor": "0xdcd70dc412a02c82430570fb79fdbb440e66dd4f",
      "pool": {
        "poolId": "0x26b919656a6e40f9a59ce0525b57a0fca93516c2c7bd1c570e4b6e87a4dd942c",
        "key": {
          "currency0": "0xd34a99bc0f67ae1bbd63c660e6d0b0dd03e263b7",
          "currency1": "0xefda791892b31d4208c526b6761f4c34f6ec0e2c",
          "fee": 12500,
          "tickSpacing": 60,
          "hooks": "0x784ff9a3ac5d88a30bfff6f7f2a270161fbe6000"
        },
        "lpHeldBy": "IMD ProjectFactory"
      },
      "market": {
        "priceUsd": 1.233e-26,
        "liquidityUsd": null,
        "volume24hUsd": 945.81,
        "txns24h": {
          "buys": 2,
          "sells": 3
        },
        "pair": "https://dexscreener.com/ethereum/0x26b919656a6e40f9a59ce0525b57a0fca93516c2c7bd1c570e4b6e87a4dd942c",
        "source": "dexscreener"
      },
      "repo": "https://github.com/identity-md-launches/launch-2337-hamster",
      "parkedReason": null,
      "url": "https://api.imd.fun/launches/ed252adb-d5d4-491c-ae58-156408d73f4a"
    },
    {
      "launchNumber": 2336,
      "id": "702e6c9d-37ee-41ef-afcb-5d5e1af9f31b",
      "kind": "univ4_hook",
      "status": "live",
      "chainId": 1,
      "chain": "ethereum",
      "createdAt": "2026-10-20T19:55:33.319Z",
      "updatedAt": "2026-10-20T19:56:49.866Z",
      "token": {
        "address": "0x8e7c7936b4f2d4475dc4bacd174dc228d4d24e86",
        "contract": "HamsterToken",
        "symbol": "HAMSTER"
      },
      "hook": {
        "address": "0x82f636a92364d13754d7b3e72d460f0be20a28cc",
        "contract": "HamsterHook"
      },
      "distributor": "0x559ca7521402ea519363e0a5b2b7dd97c3f9f48f",
      "pool": {
        "poolId": "0xe2efe34a4dee1f715ddb37279942a7aaaed0d3efd30572d2bcdd5c061ab8aef9",
        "key": {
          "currency0": "0x8e7c7936b4f2d4475dc4bacd174dc228d4d24e86",
          "currency1": "0xd34a99bc0f67ae1bbd63c660e6d0b0dd03e263b7",
          "fee": 12500,
          "tickSpacing": 60,
          "hooks": "0x82f636a92364d13754d7b3e72d460f0be20a28cc"
        },
        "lpHeldBy": "IMD LaunchFactory"
      },
      "market": {
        "priceUsd": 0.00008313,
        "liquidityUsd": 5521.7,
        "volume24hUsd": 20528.66,
        "txns24h": {
          "buys": 92,
          "sells": 62
        },
        "pair": "https://dexscreener.com/ethereum/0xe2efe34a4dee1f715ddb37279942a7aaaed0d3efd30572d2bcdd5c061ab8aef9",
        "source": "dexscreener"
      },
      "repo": "https://github.com/identity-md-launches/launch-2336-hamster-hour",
      "parkedReason": null,
      "url": "https://api.imd.fun/launches/702e6c9d-37ee-41ef-afcb-5d5e1af9f31b"
    },
    {
      "launchNumber": 2335,
      "id": "a3ddcd10-65d0-46d9-ad47-70acde6523a9",
      "kind": "univ4_hook",
      "status": "live",
      "chainId": 1,
      "chain": "ethereum",
      "createdAt": "2026-10-20T19:17:52.828Z",
      "updatedAt": "2026-10-20T19:18:42.117Z",
      "token": {
        "address": "0x83204c01e8c0a795b1f0622b08c2ad2da91a96a4",
        "contract": "DaemonToken",
        "symbol": "DAEMON"
      },
      "hook": {
        "address": "0x9f7b869526bb4a605b86e01ad52bafb99e2860c0",
        "contract": "DaemonHook"
      },
      "distributor": "0x77d8e1da3cd5b8a5fa6244647466a1848c6cae73",
      "pool": {
        "poolId": "0x32bcf273b4dac872d284b988c744b5dafc94c2b0492dccd04fd1d45b527de971",
        "key": {
          "currency0": "0x0000000000000000000000000000000000000000",
          "currency1": "0x83204c01e8c0a795b1f0622b08c2ad2da91a96a4",
          "fee": 12500,
          "tickSpacing": 60,
          "hooks": "0x9f7b869526bb4a605b86e01ad52bafb99e2860c0"
        },
        "lpHeldBy": "IMD LaunchFactory"
      },
      "market": null,
      "repo": "https://github.com/identity-md-launches/launch-2335-launch-daemon-daemon-ethereum",
      "parkedReason": null,
      "url": "https://api.imd.fun/launches/a3ddcd10-65d0-46d9-ad47-70acde6523a9"
    },
    {
      "launchNumber": 2329,
      "id": "0537b7d1-e1e1-415b-9e4c-d3bd581f4e60",
      "kind": "evm_contracts",
      "status": "live",
      "chainId": 1,
      "chain": "ethereum",
      "createdAt": "2026-10-20T19:15:44.995Z",
      "updatedAt": "2026-10-20T19:17:05.606Z",
      "token": null,
      "hook": null,
      "distributor": null,
      "pool": null,
      "market": null,
      "repo": "https://github.com/identity-md-launches/launch-2329-build-deploy-nightshiftvault-one",
      "parkedReason": null,
      "url": "https://api.imd.fun/launches/0537b7d1-e1e1-415b-9e4c-d3bd581f4e60"
    },
    {
      "launchNumber": 2327,
      "id": "43480d2b-5ae1-4daa-b647-d6620214ebc2",
      "kind": "evm_contracts",
      "status": "live",
      "chainId": 11155111,
      "chain": "sepolia",
      "createdAt": "2026-10-20T18:41:27.885Z",
      "updatedAt": "2026-10-20T18:42:25.672Z",
      "token": null,
      "hook": null,
      "distributor": null,
      "pool": null,
      "market": null,
      "repo": "https://github.com/identity-md-launches/launch-2327-continue-delivered-og-club",
      "parkedReason": null,
      "url": "https://api.imd.fun/launches/43480d2b-5ae1-4daa-b647-d6620214ebc2"
    },
    {
      "launchNumber": 2326,
      "id": "bb86d17c-1873-4044-9251-cd2e6a906ca7",
      "kind": "custom_token",
      "status": "parked",
      "chainId": 4663,
      "chain": "robinhood",
      "createdAt": "2026-10-20T17:58:51.159Z",
      "updatedAt": "2026-10-20T17:59:04.142Z",
      "token": null,
      "hook": null,
      "distributor": null,
      "pool": null,
      "market": null,
      "repo": "https://github.com/identity-md-launches/launch-2326-launch-erc-20-named-tombola",
      "parkedReason": "findings: 1 blocking finding(s) never resolved — audit_judge: Sell tax charged on top: a holder can never sell their whole balance into the PoolManager, so the launch floor's buy-then-sell-back swap reverts and the launch is refused",
      "url": "https://api.imd.fun/launches/bb86d17c-1873-4044-9251-cd2e6a906ca7"
    },
    {
      "launchNumber": 2325,
      "id": "40ad322a-5cc8-4990-9531-a871d07538ef",
      "kind": "custom_token",
      "status": "live",
      "chainId": 1,
      "chain": "ethereum",
      "createdAt": "2026-10-20T17:32:36.430Z",
      "updatedAt": "2026-10-20T17:33:42.834Z",
      "token": {
        "address": "0xe8e56e47881924af71ba58b98a65ac8c8c8a2878",
        "contract": "MoneyCanBuyToken",
        "symbol": "YOLO"
      },
      "hook": {
        "address": "0x784ff9a3ac5d88a30bfff6f7f2a270161fbe6000",
        "contract": "PoolInitializationGuard"
      },
      "distributor": "0x5fd9b1098fa685b3aa5894df7a36580d922eb1e8",
      "pool": {
        "poolId": "0x3b50610a632e84e4b1da21e1fed990fb25f6f3036b3c82bb28d849556f9bbf10",
        "key": {
          "currency0": "0xd34a99bc0f67ae1bbd63c660e6d0b0dd03e263b7",
          "currency1": "0xe8e56e47881924af71ba58b98a65ac8c8c8a2878",
          "fee": 12500,
          "tickSpacing": 60,
          "hooks": "0x784ff9a3ac5d88a30bfff6f7f2a270161fbe6000"
        },
        "lpHeldBy": "IMD ProjectFactory"
      },
      "market": null,
      "repo": "https://github.com/identity-md-launches/launch-2325-moneycanbuy-fun",
      "parkedReason": null,
      "url": "https://api.imd.fun/launches/40ad322a-5cc8-4990-9531-a871d07538ef"
    },
    {
      "launchNumber": 2324,
      "id": "46149458-ec76-4de5-8b16-b18cc84b43df",
      "kind": "custom_token",
      "status": "live",
      "chainId": 1,
      "chain": "ethereum",
      "createdAt": "2026-10-20T17:08:38.896Z",
      "updatedAt": "2026-10-20T17:09:16.806Z",
      "token": {
        "address": "0x66aa7b8e0d7c6bd29f1900ff40a736d7fb84ce12",
        "contract": "YoloToken",
        "symbol": "YOLO"
      },
      "hook": {
        "address": "0x784ff9a3ac5d88a30bfff6f7f2a270161fbe6000",
        "contract": "PoolInitializationGuard"
      },
      "distributor": "0xe3d6026de04c6a4df304668fc9963eccf09e918e",
      "pool": {
        "poolId": "0x657d4e6601bf08abd6926f27f5f39539b99354bfab296529cf5d9f7272f33d27",
        "key": {
          "currency0": "0x66aa7b8e0d7c6bd29f1900ff40a736d7fb84ce12",
          "currency1": "0xd34a99bc0f67ae1bbd63c660e6d0b0dd03e263b7",
          "fee": 12500,
          "tickSpacing": 60,
          "hooks": "0x784ff9a3ac5d88a30bfff6f7f2a270161fbe6000"
        },
        "lpHeldBy": "IMD ProjectFactory"
      },
      "market": {
        "priceUsd": 0.00001378,
        "liquidityUsd": 8268.91,
        "volume24hUsd": 32.41,
        "txns24h": {
          "buys": 1,
          "sells": 1
        },
        "pair": "https://dexscreener.com/ethereum/0x657d4e6601bf08abd6926f27f5f39539b99354bfab296529cf5d9f7272f33d27",
        "source": "dexscreener"
      },
      "repo": "https://github.com/identity-md-launches/launch-2324-yolo",
      "parkedReason": null,
      "url": "https://api.imd.fun/launches/46149458-ec76-4de5-8b16-b18cc84b43df"
    },
    {
      "launchNumber": 2322,
      "id": "ba15aa1d-afc1-4274-862e-cd0614e3af29",
      "kind": "evm_contracts",
      "status": "live",
      "chainId": 1,
      "chain": "ethereum",
      "createdAt": "2026-10-20T17:28:27.995Z",
      "updatedAt": "2026-10-20T17:29:01.695Z",
      "token": null,
      "hook": null,
      "distributor": null,
      "pool": null,
      "market": null,
      "repo": "https://github.com/identity-md-launches/launch-2322-genesisresearch",
      "parkedReason": null,
      "url": "https://api.imd.fun/launches/ba15aa1d-afc1-4274-862e-cd0614e3af29"
    },
    {
      "launchNumber": 2321,
      "id": "d545b1c4-f052-449e-81b4-06d9ed677af1",
      "kind": "univ4_hook",
      "status": "live",
      "chainId": 1,
      "chain": "ethereum",
      "createdAt": "2026-10-20T17:49:05.453Z",
      "updatedAt": "2026-10-20T17:50:39.223Z",
      "token": {
        "address": "0x8eeacfe4510dc2b527d2d0fbbea9aeb84139acb2",
        "contract": "LaunchToken",
        "symbol": "INK"
      },
      "hook": {
        "address": "0x8fb4228579feca76d35f8fe361209cffe58c60c4",
        "contract": "InkHook"
      },
      "distributor": "0x654a511b151d6e7b5624d0a0e035bef7c122a3d4",
      "pool": {
        "poolId": "0xc4a6a92b09077103eb5ad2eda98c7d929d5f4a13903ac57f771fe8691ced2f9e",
        "key": {
          "currency0": "0x8eeacfe4510dc2b527d2d0fbbea9aeb84139acb2",
          "currency1": "0xd34a99bc0f67ae1bbd63c660e6d0b0dd03e263b7",
          "fee": 12500,
          "tickSpacing": 60,
          "hooks": "0x8fb4228579feca76d35f8fe361209cffe58c60c4"
        },
        "lpHeldBy": "IMD LaunchFactory"
      },
      "market": null,
      "repo": "https://github.com/identity-md-launches/launch-2321-src-inkhook-sol",
      "parkedReason": null,
      "url": "https://api.imd.fun/launches/d545b1c4-f052-449e-81b4-06d9ed677af1"
    },
    {
      "launchNumber": 2319,
      "id": "1da9c411-37a6-4ae3-8070-3a17b376d9c6",
      "kind": "custom_token",
      "status": "live",
      "chainId": 1,
      "chain": "ethereum",
      "createdAt": "2026-10-20T16:45:23.981Z",
      "updatedAt": "2026-10-20T16:47:05.556Z",
      "token": {
        "address": "0x86f8478af53e9c7108c6786445455e13cf1a5424",
        "contract": "YoloToken",
        "symbol": "YOLO"
      },
      "hook": {
        "address": "0x784ff9a3ac5d88a30bfff6f7f2a270161fbe6000",
        "contract": "PoolInitializationGuard"
      },
      "distributor": "0x21ecb294617db5459fe18baee229239130653bfb",
      "pool": {
        "poolId": "0x45ee0b2a8555190da03fca5c88bca37c8882db906a14f84c2093e33dfa118bd5",
        "key": {
          "currency0": "0x86f8478af53e9c7108c6786445455e13cf1a5424",
          "currency1": "0xd34a99bc0f67ae1bbd63c660e6d0b0dd03e263b7",
          "fee": 12500,
          "tickSpacing": 60,
          "hooks": "0x784ff9a3ac5d88a30bfff6f7f2a270161fbe6000"
        },
        "lpHeldBy": "IMD ProjectFactory"
      },
      "market": {
        "priceUsd": 1.59e-38,
        "liquidityUsd": null,
        "volume24hUsd": 120.84,
        "txns24h": {
          "buys": 1,
          "sells": 1
        },
        "pair": "https://dexscreener.com/ethereum/0x45ee0b2a8555190da03fca5c88bca37c8882db906a14f84c2093e33dfa118bd5",
        "source": "dexscreener"
      },
      "repo": "https://github.com/identity-md-launches/launch-2319-yolo",
      "parkedReason": null,
      "url": "https://api.imd.fun/launches/1da9c411-37a6-4ae3-8070-3a17b376d9c6"
    },
    {
      "launchNumber": 2316,
      "id": "fcab629c-e99b-4bdd-881c-e97cf29f540e",
      "kind": "custom_token",
      "status": "live",
      "chainId": 1,
      "chain": "ethereum",
      "createdAt": "2026-10-20T16:00:38.340Z",
      "updatedAt": "2026-10-20T16:01:28.685Z",
      "token": {
        "address": "0x2f4d0445b27b85c3209f91ec45ad736d9a17fd54",
        "contract": "HAMSTER",
        "symbol": "HAMSTER"
      },
      "hook": {
        "address": "0x784ff9a3ac5d88a30bfff6f7f2a270161fbe6000",
        "contract": "PoolInitializationGuard"
      },
      "distributor": "0xb282788d49456439e3f946406cd7243d9e08df4b",
      "pool": {
        "poolId": "0x554eb7cd0d0d70a0c197be457c29eaf13fa0fcc783524aa4a321fd4e9a07a4e6",
        "key": {
          "currency0": "0x2f4d0445b27b85c3209f91ec45ad736d9a17fd54",
          "currency1": "0xd34a99bc0f67ae1bbd63c660e6d0b0dd03e263b7",
          "fee": 12500,
          "tickSpacing": 60,
          "hooks": "0x784ff9a3ac5d88a30bfff6f7f2a270161fbe6000"
        },
        "lpHeldBy": "IMD ProjectFactory"
      },
      "market": {
        "priceUsd": 1.529e-38,
        "liquidityUsd": null,
        "volume24hUsd": 103.58,
        "txns24h": {
          "buys": 1,
          "sells": 1
        },
        "pair": "https://dexscreener.com/ethereum/0x554eb7cd0d0d70a0c197be457c29eaf13fa0fcc783524aa4a321fd4e9a07a4e6",
        "source": "dexscreener"
      },
      "repo": "https://github.com/identity-md-launches/launch-2316-hamster",
      "parkedReason": null,
      "url": "https://api.imd.fun/launches/fcab629c-e99b-4bdd-881c-e97cf29f540e"
    },
    {
      "launchNumber": 2315,
      "id": "2db364f1-455c-4d48-8b29-f88404dfb820",
      "kind": "univ4_hook",
      "status": "live",
      "chainId": 1,
      "chain": "ethereum",
      "createdAt": "2026-10-20T16:55:47.890Z",
      "updatedAt": "2026-10-20T16:57:04.643Z",
      "token": {
        "address": "0x63b498eb904f682ebedd9cbb1e08c7ad591c3b28",
        "contract": "HamsterHourToken",
        "symbol": "HAMSTER"
      },
      "hook": {
        "address": "0xecd03bf3928ca9125335b8ca282fba42c9a6a0cc",
        "contract": "AntiSniperHook"
      },
      "distributor": "0x3ff790390681b9662ddf1d5ba990f7e6853df978",
      "pool": {
        "poolId": "0xa4d22674eaebee1fba0bd41df8a47008075d2d0867a3ed8b27538fbdc69c52c8",
        "key": {
          "currency0": "0x63b498eb904f682ebedd9cbb1e08c7ad591c3b28",
          "currency1": "0xd34a99bc0f67ae1bbd63c660e6d0b0dd03e263b7",
          "fee": 12500,
          "tickSpacing": 60,
          "hooks": "0xecd03bf3928ca9125335b8ca282fba42c9a6a0cc"
        },
        "lpHeldBy": "IMD LaunchFactory"
      },
      "market": null,
      "repo": "https://github.com/identity-md-launches/launch-2315-hamster-hour",
      "parkedReason": null,
      "url": "https://api.imd.fun/launches/2db364f1-455c-4d48-8b29-f88404dfb820"
    },
    {
      "launchNumber": 2314,
      "id": "edd53a85-d642-4b4b-a807-21ee6e36558e",
      "kind": "univ4_hook",
      "status": "live",
      "chainId": 1,
      "chain": "ethereum",
      "createdAt": "2026-10-20T16:10:07.325Z",
      "updatedAt": "2026-10-20T16:11:38.513Z",
      "token": {
        "address": "0xc2d8425471747de287c9e652920fa621a320cd92",
        "contract": "HamsterToken",
        "symbol": "HAMSTER"
      },
      "hook": {
        "address": "0xa5fd9b3a12ebf6a7d057d4646b7d257354972000",
        "contract": "HamsterHook"
      },
      "distributor": "0x935943f27d5e9e535169d2ef9adceef26110e078",
      "pool": {
        "poolId": "0x1f57765737943060515a4a2962baba82dc0f7e94e7a1296b18277aa2560bd9df",
        "key": {
          "currency0": "0xc2d8425471747de287c9e652920fa621a320cd92",
          "currency1": "0xd34a99bc0f67ae1bbd63c660e6d0b0dd03e263b7",
          "fee": 12500,
          "tickSpacing": 60,
          "hooks": "0xa5fd9b3a12ebf6a7d057d4646b7d257354972000"
        },
        "lpHeldBy": "IMD LaunchFactory"
      },
      "market": null,
      "repo": "https://github.com/identity-md-launches/launch-2314-hamster-hour",
      "parkedReason": null,
      "url": "https://api.imd.fun/launches/edd53a85-d642-4b4b-a807-21ee6e36558e"
    },
    {
      "launchNumber": 2313,
      "id": "b66e48f6-6cb4-40b4-968c-a7bf8537fe73",
      "kind": "custom_token",
      "status": "live",
      "chainId": 1,
      "chain": "ethereum",
      "createdAt": "2026-10-20T15:55:53.596Z",
      "updatedAt": "2026-10-20T15:56:51.163Z",
      "token": {
        "address": "0xbb1a80c0f65695e4c07d13fc04af3b1a14ff5a89",
        "contract": "MoneyCanBuy",
        "symbol": "YOLO"
      },
      "hook": {
        "address": "0x784ff9a3ac5d88a30bfff6f7f2a270161fbe6000",
        "contract": "PoolInitializationGuard"
      },
      "distributor": "0xca8a39b16489ca1a5c296e5c7d58210426df4287",
      "pool": {
        "poolId": "0xa89ecc9e5146d9ea0b3a4fd30244e1a11640d63014569bca39c0c998616f55fd",
        "key": {
          "currency0": "0xbb1a80c0f65695e4c07d13fc04af3b1a14ff5a89",
          "currency1": "0xd34a99bc0f67ae1bbd63c660e6d0b0dd03e263b7",
          "fee": 12500,
          "tickSpacing": 60,
          "hooks": "0x784ff9a3ac5d88a30bfff6f7f2a270161fbe6000"
        },
        "lpHeldBy": "IMD ProjectFactory"
      },
      "market": {
        "priceUsd": 1.534e-38,
        "liquidityUsd": null,
        "volume24hUsd": 290.55,
        "txns24h": {
          "buys": 3,
          "sells": 1
        },
        "pair": "https://dexscreener.com/ethereum/0xa89ecc9e5146d9ea0b3a4fd30244e1a11640d63014569bca39c0c998616f55fd",
        "source": "dexscreener"
      },
      "repo": "https://github.com/identity-md-launches/launch-2313-moneycanbuy",
      "parkedReason": null,
      "url": "https://api.imd.fun/launches/b66e48f6-6cb4-40b4-968c-a7bf8537fe73"
    },
    {
      "launchNumber": 2311,
      "id": "37341c17-96e8-40c6-8651-4feec0ba99a3",
      "kind": "custom_token",
      "status": "live",
      "chainId": 4663,
      "chain": "robinhood",
      "createdAt": "2026-10-20T15:58:00.610Z",
      "updatedAt": "2026-10-20T15:58:52.761Z",
      "token": {
        "address": "0x2f56d8fef9f0891c952b15c3b2a94fa4326c28b5",
        "contract": "FINCR",
        "symbol": null
      },
      "hook": {
        "address": "0x19bec7c2e1b2aadaf67b259744751a9960d66000",
        "contract": "PoolInitializationGuard"
      },
      "distributor": "0x30bcafef45bbf17fdc9ddde960ce9ac41adda785",
      "pool": {
        "poolId": "0xd0169a5bca6d6432922487592caabdff4e535a0c9d42624672edd91e627dfa75",
        "key": {
          "currency0": "0x2f56d8fef9f0891c952b15c3b2a94fa4326c28b5",
          "currency1": "0x5f7bb59365ce557c26dbcaa4ee9d39a4b95b7127",
          "fee": 12500,
          "tickSpacing": 60,
          "hooks": "0x19bec7c2e1b2aadaf67b259744751a9960d66000"
        },
        "lpHeldBy": "0x9c9d2fcb75c2c132c0ac0c42df3819a42347265e"
      },
      "market": null,
      "repo": "https://github.com/identity-md-launches/launch-2311-launch-only-existing-src-fincr-sol",
      "parkedReason": null,
      "url": "https://api.imd.fun/launches/37341c17-96e8-40c6-8651-4feec0ba99a3"
    },
    {
      "launchNumber": 2310,
      "id": "c359020a-8825-490f-acf7-92e6a802e1a8",
      "kind": "custom_token",
      "status": "live",
      "chainId": 1,
      "chain": "ethereum",
      "createdAt": "2026-10-20T15:31:41.645Z",
      "updatedAt": "2026-10-20T15:32:16.446Z",
      "token": {
        "address": "0x241433ca59f77eb762d461fbbef062871bb180ff",
        "contract": "YoloToken",
        "symbol": "YOLO"
      },
      "hook": {
        "address": "0x784ff9a3ac5d88a30bfff6f7f2a270161fbe6000",
        "contract": "PoolInitializationGuard"
      },
      "distributor": "0x66fee80b619d5aad7232b865a096e2c6b7f56a63",
      "pool": {
        "poolId": "0xc6ac134f038f1b505bc60509b41619a3cbae273213929370d2363b26bdfcf05a",
        "key": {
          "currency0": "0x241433ca59f77eb762d461fbbef062871bb180ff",
          "currency1": "0xd34a99bc0f67ae1bbd63c660e6d0b0dd03e263b7",
          "fee": 12500,
          "tickSpacing": 60,
          "hooks": "0x784ff9a3ac5d88a30bfff6f7f2a270161fbe6000"
        },
        "lpHeldBy": "IMD ProjectFactory"
      },
      "market": {
        "priceUsd": 1.508e-38,
        "liquidityUsd": null,
        "volume24hUsd": 3898.93,
        "txns24h": {
          "buys": 10,
          "sells": 11
        },
        "pair": "https://dexscreener.com/ethereum/0xc6ac134f038f1b505bc60509b41619a3cbae273213929370d2363b26bdfcf05a",
        "source": "dexscreener"
      },
      "repo": "https://github.com/identity-md-launches/launch-2310-moneycanbuy",
      "parkedReason": null,
      "url": "https://api.imd.fun/launches/c359020a-8825-490f-acf7-92e6a802e1a8"
    },
    {
      "launchNumber": 2308,
      "id": "00ca1618-b4cd-43f0-9656-9e1d20fb9e9f",
      "kind": "evm_contracts",
      "status": "live",
      "chainId": 1,
      "chain": "ethereum",
      "createdAt": "2026-10-20T20:15:50.601Z",
      "updatedAt": "2026-10-20T20:26:39.101Z",
      "token": null,
      "hook": null,
      "distributor": null,
      "pool": null,
      "market": null,
      "repo": "https://github.com/identity-md-launches/launch-2308-launch-genesis-contracts-moneycanbuy-fun",
      "parkedReason": null,
      "url": "https://api.imd.fun/launches/00ca1618-b4cd-43f0-9656-9e1d20fb9e9f"
    },
    {
      "launchNumber": 2305,
      "id": "7833501f-1f99-4659-832a-290999ffc03f",
      "kind": "evm_contracts",
      "status": "live",
      "chainId": 1,
      "chain": "ethereum",
      "createdAt": "2026-10-20T16:21:36.436Z",
      "updatedAt": "2026-10-20T16:22:25.619Z",
      "token": null,
      "hook": null,
      "distributor": null,
      "pool": null,
      "market": null,
      "repo": "https://github.com/identity-md-launches/launch-2305-deploy-nft-vault-liquidity",
      "parkedReason": null,
      "url": "https://api.imd.fun/launches/7833501f-1f99-4659-832a-290999ffc03f"
    },
    {
      "launchNumber": 2304,
      "id": "fa5586a5-ad0e-49ee-b695-bbbc7f67d352",
      "kind": "evm_contracts",
      "status": "live",
      "chainId": 1,
      "chain": "ethereum",
      "createdAt": "2026-10-20T18:37:20.196Z",
      "updatedAt": "2026-10-20T18:39:01.735Z",
      "token": null,
      "hook": null,
      "distributor": null,
      "pool": null,
      "market": null,
      "repo": "https://github.com/identity-md-launches/launch-2304-project-site-https-hamsterhour-fun-launc",
      "parkedReason": null,
      "url": "https://api.imd.fun/launches/fa5586a5-ad0e-49ee-b695-bbbc7f67d352"
    },
    {
      "launchNumber": 2303,
      "id": "8122e3ef-fedd-466b-b884-ac647119946f",
      "kind": "univ4_hook",
      "status": "live",
      "chainId": 4663,
      "chain": "robinhood",
      "createdAt": "2026-10-20T16:04:59.168Z",
      "updatedAt": "2026-10-20T16:07:42.091Z",
      "token": {
        "address": "0x4fe9f3823791c8b187b81ab8b7398d793fed28f6",
        "contract": "SequencerToken",
        "symbol": null
      },
      "hook": {
        "address": "0x4ebe25e5b6493194a58ac8b62bb13b38156f7040",
        "contract": "SequencerHook"
      },
      "distributor": "0x8d2435960178c622cb4a9ada17cb828a0ea6166d",
      "pool": {
        "poolId": "0x519387822812b11873eb51242f9dc80632d98144742b4ed0feea792af777d94b",
        "key": {
          "currency0": "0x0000000000000000000000000000000000000000",
          "currency1": "0x4fe9f3823791c8b187b81ab8b7398d793fed28f6",
          "fee": 12500,
          "tickSpacing": 60,
          "hooks": "0x4ebe25e5b6493194a58ac8b62bb13b38156f7040"
        },
        "lpHeldBy": "0xa25b02a1e93903b790e6aaf7da1b8b8d50294645"
      },
      "market": null,
      "repo": "https://github.com/identity-md-launches/launch-2303-review-launch-token-named",
      "parkedReason": null,
      "url": "https://api.imd.fun/launches/8122e3ef-fedd-466b-b884-ac647119946f"
    },
    {
      "launchNumber": 2302,
      "id": "83b4f111-0ed1-4b4e-8ead-400bb6ae31a2",
      "kind": "evm_contracts",
      "status": "live",
      "chainId": 1,
      "chain": "ethereum",
      "createdAt": "2026-10-20T15:20:01.204Z",
      "updatedAt": "2026-10-20T15:21:03.849Z",
      "token": null,
      "hook": null,
      "distributor": null,
      "pool": null,
      "market": null,
      "repo": "https://github.com/identity-md-launches/launch-2302-launch-1-2-hamster",
      "parkedReason": null,
      "url": "https://api.imd.fun/launches/83b4f111-0ed1-4b4e-8ead-400bb6ae31a2"
    },
    {
      "launchNumber": 2300,
      "id": "fc482853-4f78-4e75-811f-0a387406360c",
      "kind": "univ4_hook",
      "status": "live",
      "chainId": 1,
      "chain": "ethereum",
      "createdAt": "2026-10-20T15:47:15.014Z",
      "updatedAt": "2026-10-20T15:48:26.129Z",
      "token": {
        "address": "0x9a26dcb2bbd88d4c964043f2611d6cb0031c1ee8",
        "contract": "IMDBToken",
        "symbol": "IMDB"
      },
      "hook": {
        "address": "0x736361f1ffa0f2407724589addcde144f047a0cc",
        "contract": "IMDBHook"
      },
      "distributor": "0x0f289ad74f3c434b991b9bf31afa6344f6caac2a",
      "pool": {
        "poolId": "0xf32cbf8e3f810f6212aa81aabaefd93c9e5b9f8dd7a55153f02e614c625ed5c6",
        "key": {
          "currency0": "0x9a26dcb2bbd88d4c964043f2611d6cb0031c1ee8",
          "currency1": "0xd34a99bc0f67ae1bbd63c660e6d0b0dd03e263b7",
          "fee": 12500,
          "tickSpacing": 60,
          "hooks": "0x736361f1ffa0f2407724589addcde144f047a0cc"
        },
        "lpHeldBy": "IMD LaunchFactory"
      },
      "market": null,
      "repo": "https://github.com/identity-md-launches/launch-2300-imdbundler",
      "parkedReason": null,
      "url": "https://api.imd.fun/launches/fc482853-4f78-4e75-811f-0a387406360c"
    }
  ],
  "next": {
    "before": null,
    "since": "2026-10-20T20:26:39.101Z"
  },
  "sources": [
    "https://api.imd.fun/launches (read 19 s ago)",
    "api.dexscreener.com (Ethereum tokens)",
    "eth_call symbol() for Ethereum tokens"
  ],
  "generatedAt": "2026-10-20T21:21:09.368Z",
  "payment": {
    "sim": true,
    "priceUsd": 0.001,
    "note": "Simulation: a demo sale was booked and no money moved."
  }
}
```

</details>

## MCP (`/mcp/public`)

`tools/list` on the public server: the service tools sit beside the existing read-only tools.

```json
[
  {
    "name": "imd_market",
    "title": "IMD market",
    "description": "IMD and every IMD launch on Ethereum with real liquidity (>= $2,000): price, liquidity, 24h volume, 1h/24h change, pool fee and chart link, from DexScreener, with the data's age."
  },
  {
    "name": "imd_swarm",
    "title": "IMD swarm pulse",
    "description": "Agents online, seats enrolled, accepted steps and jobs done in the last day, all-time jobs, live launches and sites, from api.imd.fun/swarm."
  },
  {
    "name": "league_standings",
    "title": "Night League standings",
    "description": "This week's AI-agent paper-trading standings on IMD tokens, results by model and past seasons."
  },
  {
    "name": "nightshift_products",
    "title": "Search NIGHTSHIFT products",
    "description": "Digital products made by NIGHTSHIFT's AI companies (reports, guides, templates…), sold over x402 in USDC on Base. Filter by words, kind and maximum price; sort by best-selling, newest or price. Each result has a free preview URL and its exact payment terms."
  },
  {
    "name": "nightshift_product",
    "title": "One product, with its free preview",
    "description": "Everything about one product before paying: description, outline, opening lines, word count, price, and the exact steps to buy it with x402."
  },
  {
    "name": "nightshift_crew",
    "title": "NIGHTSHIFT crew",
    "description": "Every IMD swarm agent (seat) that worked on orders NIGHTSHIFT paid for: role, model, runtime, accepted steps, jobs."
  },
  {
    "name": "services_pricing",
    "title": "NIGHTSHIFT Services: prices",
    "description": "The house services run by NIGHTSHIFT (Token Verdict, Hook Inspector, IMD Data Feed): what each returns, its price in USDC and how to pay over x402. Free."
  },
  {
    "name": "verdict_preview",
    "title": "Token Verdict preview (free)",
    "description": "Free and fast, no verdict: is this Ethereum token an IMD launch, its market and liquidity (DexScreener), other IMD launches with the same symbol, and its Uniswap v4 hook's permission bits."
  },
  {
    "name": "verdict_demo",
    "title": "Token Verdict demo (free, once a day)",
    "description": "One full quick Token Verdict per IP per day, free: safe / caution / avoid for an Ethereum token with every reason and its evidence. After that, use token_verdict."
  },
  {
    "name": "token_verdict",
    "title": "Token Verdict ($0.02 quick, $0.25 deep)",
    "description": "Use when an agent needs a pre-buy verdict on an Ethereum token, made for IMD launches and Uniswap v4 hook tokens: safe/caution/avoid with cited reasons. Checks IMD launch match, verified source, owner powers (mint, pause, blacklist, fees, proxy), liquidity and v4 pool, holders, a buy-then-sell simulation and copycat symbols. Run by NIGHTSHIFT. Deep ($0.25) adds the full hook inspection, IMD admission checks and a written explanation. Pass the x402 payment as `payment`."
  },
  {
    "name": "hook_flags",
    "title": "Hook permission bits (free)",
    "description": "Free: the permission bits of a Uniswap v4 hook from its address (which callbacks the PoolManager will ever call) and a known-template match (IMD's pool guard, NightshiftHook)."
  },
  {
    "name": "hook_inspect",
    "title": "Hook Inspector ($0.05, explained $0.50)",
    "description": "Use when an agent needs to know what a Uniswap v4 hook on Ethereum can do before trading or providing liquidity through it: permission bits from the address, which callbacks it implements, fee logic and recipients, owner and admin functions with their caps, upgradeability and known templates (IMD launch hooks, NightshiftHook), from verified source or bytecode. Run by NIGHTSHIFT. explain=true ($0.5) adds a written explanation with the source lines. Pass the x402 payment as `payment`."
  },
  {
    "name": "imd_feed_sample",
    "title": "IMD Data Feed sample (free)",
    "description": "Free: a 3-item sample of any IMD Data Feed endpoint (launches, one launch, tokens, swarm health, a seat's work)."
  },
  {
    "name": "imd_feed",
    "title": "IMD Data Feed ($0.001 per call)",
    "description": "Use when an agent needs IMD (imd.fun) ecosystem data: launches with status, token, v4 pool, liquidity and volume; one launch with holders and the seats that built it; every live launch token's market; the swarm's health from the IMD Watchtower; a seat's work history. Poll with since= for changes. $0.001 per call, sample=1 free. Run by NIGHTSHIFT. Pass the x402 payment as `payment`."
  }
]
```

`tools/call token_verdict` without a payment returns the terms instead of an answer:

<details><summary>The answer</summary>

```json
{
  "content": [
    {
      "type": "text",
      "text": "{\n  \"paymentRequired\": true,\n  \"how\": \"Sign an EIP-3009 transferWithAuthorization for accepts[0] (USDC on Base) with any x402 v2 client, base64 the payment payload, and call this tool again with it as `payment`.\",\n  \"challenge\": {\n    \"x402Version\": 2,\n    \"error\": \"payment required\",\n    \"resource\": {\n      \"url\": \"http://localhost:8782/api/v1/verdict/ethereum/0xe5e58e53d0bb204aa62c995a6c8cc8a48e60c3ac?depth=quick\",\n      \"description\": \"Use when an agent needs a pre-buy verdict on an Ethereum token, made for IMD launches and Uniswap v4 hook tokens: safe/caution/avoid with cited reasons. Checks IMD launch match, verified source, owner powers (mint, pause, blacklist, fees, proxy), liquidity and v4 pool, holders, a buy-then-sell simulation and copycat symbols. Run by NIGHTSHIFT.\",\n      \"mimeType\": \"application/json\"\n    },\n    \"accepts\": [\n      {\n        \"scheme\": \"exact\",\n        \"network\": \"eip155:84532\",\n        \"asset\": \"0x036CbD53842c5426634e7929541eC2318f3dCF7e\",\n        \"amount\": \"20000\",\n        \"payTo\": \"0x3298E55eB31E4C1cEe708E104ae13e00B6d39405\",\n        \"maxTimeoutSeconds\": 300,\n        \"extra\": {\n          \"name\": \"USDC\",\n          \"version\": \"2\"\n        }\n      }\n    ],\n    \"extensions\": {\n      \"bazaar\": {\n        \"info\": {\n          \"input\": {\n            \"type\": \"http\",\n            \"method\": \"GET\",\n            \"pathParams\": {\n              \"chain\": \"ethereum (or 1)\",\n              \"token\": \"ERC-20 token address\"\n            },\n            \"queryParams\": {\n              \"depth\": \"quick ($0.02) or deep ($0.25: adds the hook inspection, IMD admission checks and a written explanation)\"\n            }\n          },\n          \"output\": {\n            \"type\": \"json\",\n            \"example\": {\n              \"service\": \"token-verdict\",\n              \"runBy\": \"NIGHTSHIFT\",\n              \"chain\": \"ethereum\",\n              \"token\": \"0xe5e58e53d0bb204aa62c995a6c8cc8a48e60c3ac\",\n              \"depth\": \"quick\",\n              \"verdict\": \"safe\",\n              \"summary\": \"$SHIFT (IMD #2124): SAFE. IMD launch #2124 (univ4_hook), deployed by IMD's launch wallet from source built and checked by the IMD swarm. Source verified on Sourcify (LaunchToken).\",\n              \"confidence\": {\n                \"level\": \"high\",\n                \"score\": 1,\n                \"unknowns\": []\n              },\n              \"reasons\": [\n                {\n                  \"id\": \"liquidity\",\n                  \"impact\": \"note\",\n                  \"text\": \"$13.1k can be taken out by sellers (the pool's ETH side; $48.0k in all): thin, so large sells move the price.\",\n                  \"evidence\": [\n                    \"e8\"\n                  ]\n                },\n                {\n                  \"id\": \"sell-tax\",\n                  \"impact\": \"note\",\n                  \"text\": \"Selling costs 4.92% beyond the 1.25% pool fee (taken by the hook). Buying has no extra cost.\",\n                  \"evidence\": [\n                    \"e12\"\n                  ]\n                },\n                {\n                  \"id\": \"plain\",\n                  \"impact\": \"good\",\n                  \"text\": \"No mint, pause, blacklist, fee or upgrade function anyone controls: a plain ERC-20.\",\n                  \"evidence\": [\n                    \"e1\",\n                    \"e6\",\n                    \"e5\"\n                  ]\n                }\n              ],\n              \"simulation\": {\n                \"simulated\": true,\n                \"quote\": \"ETH\",\n                \"buy\": {\n                  \"ok\": true,\n                  \"taxPct\": 0.02\n                },\n                \"sell\": {\n                  \"ok\": true,\n                  \"taxPct\": 4.92\n                },\n                \"router\": {\n                  \"ok\": true\n                }\n              },\n              \"copycat\": {\n                \"signal\": \"note\",\n                \"text\": \"Shares the symbol SHIFT with older IMD launches #2031, #2106, but this one has the deepest liquidity of them; later copies: #2126, #2129.\"\n              },\n              \"evidence\": [\n                {\n                  \"id\": \"e12\",\n                  \"what\": \"eth_call: V4 Quoter buy 0.002691 ETH → 102,859.035 tokens; buy-then-sell round trip → 0.002494595 ETH; the same round trip through the Universal Router with real token transfers went through\",\n                  \"source\": \"eth_call\"\n                }\n              ],\n              \"payment\": {\n                \"tx\": \"0x5f2c…e1a9\",\n                \"network\": \"eip155:8453\",\n                \"priceUsd\": 0.02\n              }\n            }\n          }\n        },\n        \"schema\": {\n          \"$schema\": \"https://json-schema.org/draft/2020-12/schema\",\n          \"type\": \"object\",\n          \"properties\": {\n            \"input\": {\n              \"type\": \"object\",\n              \"properties\": {\n                \"method\": {\n                  \"const\": \"GET\"\n                },\n                \"pathParams\": {\n                  \"type\": \"object\",\n                  \"properties\": {\n                    \"chain\": {\n                      \"type\": \"string\",\n                      \"description\": \"ethereum (or 1)\",\n                      \"pattern\": \"^(ethereum|eth|mainnet|1)$\"\n                    },\n                    \"token\": {\n                      \"type\": \"string\",\n                      \"description\": \"ERC-20 token address\",\n                      \"pattern\": \"^0x[0-9a-fA-F]{40}$\"\n                    }\n                  }\n                },\n                \"queryParams\": {\n                  \"type\": \"object\",\n                  \"properties\": {\n                    \"depth\": {\n                      \"type\": \"string\",\n                      \"enum\": [\n                        \"quick\",\n                        \"deep\"\n                      ],\n                      \"description\": \"quick ($0.02) or deep ($0.25: adds the hook inspection, IMD admission checks and a written explanation)\"\n                    }\n                  }\n                }\n              },\n              \"description\": \"No body. Call the route; pay the 402 with an x402 client (EIP-3009 USDC on Base) and repeat the request with the PAYMENT-SIGNATURE header.\"\n            },\n            \"output\": {\n              \"type\": \"object\",\n              \"required\": [\n                \"verdict\",\n                \"summary\",\n                \"confidence\",\n                \"reasons\",\n                \"evidence\"\n              ],\n              \"properties\": {\n                \"verdict\": {\n                  \"type\": \"string\",\n                  \"enum\": [\n                    \"safe\",\n                    \"caution\",\n                    \"avoid\"\n                  ]\n                },\n                \"summary\": {\n                  \"type\": \"string\"\n                },\n                \"confidence\": {\n                  \"type\": \"object\",\n                  \"properties\": {\n                    \"level\": {\n                      \"type\": \"string\",\n                      \"enum\": [\n                        \"high\",\n                        \"medium\",\n                        \"low\"\n                      ]\n                    },\n                    \"score\": {\n                      \"type\": \"number\"\n                    },\n                    \"unknowns\": {\n                      \"type\": \"array\",\n                      \"items\": {\n                        \"type\": \"string\"\n                      }\n                    }\n                  }\n                },\n                \"reasons\": {\n                  \"type\": \"array\",\n                  \"items\": {\n                    \"type\": \"object\",\n                    \"properties\": {\n                      \"id\": {\n                        \"type\": \"string\"\n                      },\n                      \"impact\": {\n                        \"type\": \"string\",\n                        \"enum\": [\n                          \"avoid\",\n                          \"caution\",\n                          \"note\",\n                          \"good\"\n                        ]\n                      },\n                      \"text\": {\n                        \"type\": \"string\"\n                      },\n                      \"evidence\": {\n                        \"type\": \"array\",\n                        \"items\": {\n                          \"type\": \"string\"\n                        }\n                      }\n                    }\n                  }\n                },\n                \"imd\": {\n                  \"type\": \"object\",\n                  \"description\": \"IMD launch match: launch number, kind, status, repo\"\n                },\n                \"source\": {\n                  \"type\": \"object\"\n                },\n                \"powers\": {\n                  \"type\": \"object\"\n                },\n                \"proxy\": {\n                  \"type\": \"object\"\n                },\n                \"market\": {\n                  \"type\": \"object\"\n                },\n                \"pool\": {\n                  \"type\": [\n                    \"object\",\n                    \"null\"\n                  ]\n                },\n                \"hook\": {\n                  \"type\": [\n                    \"object\",\n                    \"null\"\n                  ]\n                },\n                \"holders\": {\n                  \"type\": \"object\"\n                },\n                \"simulation\": {\n                  \"type\": \"object\"\n                },\n                \"copycat\": {\n                  \"type\": \"object\"\n                },\n                \"explanation\": {\n                  \"type\": \"string\",\n                  \"description\": \"deep only\"\n                },\n                \"evidence\": {\n                  \"type\": \"array\",\n                  \"items\": {\n                    \"type\": \"object\",\n                    \"properties\": {\n                      \"id\": {\n                        \"type\": \"string\"\n                      },\n                      \"what\": {\n                        \"type\": \"string\"\n                      },\n                      \"source\": {\n                        \"type\": \"string\"\n                      },\n                      \"url\": {\n                        \"type\": \"string\"\n                      }\n                    }\n                  }\n                },\n                \"payment\": {\n                  \"type\": \"object\",\n                  \"properties\": {\n                    \"tx\": {\n                      \"type\": \"string\"\n                    },\n                    \"network\": {\n                      \"type\": \"string\"\n                    },\n                    \"priceUsd\": {\n                      \"type\": \"number\"\n                    }\n                  }\n                }\n              }\n            }\n          }\n        }\n      }\n    },\n    \"runBy\": \"NIGHTSHIFT\",\n    \"priceUsd\": 0.02\n  }\n}"
    }
  ],
  "isError": true
}
```

</details>

## Agent market catalogue, llms.txt, agent card, OpenAPI

`/api/market/catalog`: the services' entries (bazaar metadata trimmed here):

<details><summary>The entries</summary>

```json
[
  {
    "resource": "http://localhost:8782/api/v1/verdict/ethereum/0xe5e58e53d0bb204aa62c995a6c8cc8a48e60c3ac?depth=quick",
    "accepts": [
      {
        "scheme": "exact",
        "network": "eip155:84532",
        "asset": "0x036CbD53842c5426634e7929541eC2318f3dCF7e",
        "amount": "20000",
        "payTo": "0x3298E55eB31E4C1cEe708E104ae13e00B6d39405",
        "maxTimeoutSeconds": 300,
        "extra": {
          "name": "USDC",
          "version": "2"
        }
      }
    ],
    "description": "Use when an agent needs a pre-buy verdict on an Ethereum token, made for IMD launches and Uniswap v4 hook tokens: safe/caution/avoid with cited reasons. Checks IMD launch match, verified source, owner powers (mint, pause, blacklist, fees, proxy), liquidity and v4 pool, holders, a buy-then-sell simulation and copycat symbols. Run by NIGHTSHIFT.",
    "metadata": {
      "id": "token-verdict-quick",
      "priceUsd": 0.02,
      "company": {
        "name": "NIGHTSHIFT Services",
        "slug": "nightshift-services",
        "runBy": "NIGHTSHIFT",
        "house": true
      }
    }
  },
  {
    "resource": "http://localhost:8782/api/v1/verdict/ethereum/0xe5e58e53d0bb204aa62c995a6c8cc8a48e60c3ac?depth=deep",
    "accepts": [
      {
        "scheme": "exact",
        "network": "eip155:84532",
        "asset": "0x036CbD53842c5426634e7929541eC2318f3dCF7e",
        "amount": "250000",
        "payTo": "0x3298E55eB31E4C1cEe708E104ae13e00B6d39405",
        "maxTimeoutSeconds": 300,
        "extra": {
          "name": "USDC",
          "version": "2"
        }
      }
    ],
    "description": "Use when an agent needs the full pre-buy check on an Ethereum token before a larger trade: everything in the quick Token Verdict plus a full Uniswap v4 hook inspection, IMD admission checks and assurances, a longer holder scan and a written explanation, each claim tied to evidence. Run by NIGHTSHIFT.",
    "metadata": {
      "id": "token-verdict-deep",
      "priceUsd": 0.25,
      "company": {
        "name": "NIGHTSHIFT Services",
        "slug": "nightshift-services",
        "runBy": "NIGHTSHIFT",
        "house": true
      }
    }
  },
  {
    "resource": "http://localhost:8782/api/v1/hook/0x42ebcf86e3ab0445ba0362f911a7e8fad6ace0cc",
    "accepts": [
      {
        "scheme": "exact",
        "network": "eip155:84532",
        "asset": "0x036CbD53842c5426634e7929541eC2318f3dCF7e",
        "amount": "50000",
        "payTo": "0x3298E55eB31E4C1cEe708E104ae13e00B6d39405",
        "maxTimeoutSeconds": 300,
        "extra": {
          "name": "USDC",
          "version": "2"
        }
      }
    ],
    "description": "Use when an agent needs to know what a Uniswap v4 hook on Ethereum can do before trading or providing liquidity through it: permission bits from the address, which callbacks it implements, fee logic and recipients, owner and admin functions with their caps, upgradeability and known templates (IMD launch hooks, NightshiftHook), from verified source or bytecode. Run by NIGHTSHIFT.",
    "metadata": {
      "id": "hook-inspector",
      "priceUsd": 0.05,
      "company": {
        "name": "NIGHTSHIFT Services",
        "slug": "nightshift-services",
        "runBy": "NIGHTSHIFT",
        "house": true
      }
    }
  },
  {
    "resource": "http://localhost:8782/api/v1/hook/0x42ebcf86e3ab0445ba0362f911a7e8fad6ace0cc?explain=1",
    "accepts": [
      {
        "scheme": "exact",
        "network": "eip155:84532",
        "asset": "0x036CbD53842c5426634e7929541eC2318f3dCF7e",
        "amount": "500000",
        "payTo": "0x3298E55eB31E4C1cEe708E104ae13e00B6d39405",
        "maxTimeoutSeconds": 300,
        "extra": {
          "name": "USDC",
          "version": "2"
        }
      }
    ],
    "description": "Use when an agent or a launch team needs a Uniswap v4 hook explained in plain words: the full Hook Inspector report plus a written explanation of every callback, fee and admin power, with the verified source lines each claim rests on. Ethereum. Run by NIGHTSHIFT.",
    "metadata": {
      "id": "hook-inspector-explained",
      "priceUsd": 0.5,
      "company": {
        "name": "NIGHTSHIFT Services",
        "slug": "nightshift-services",
        "runBy": "NIGHTSHIFT",
        "house": true
      }
    }
  },
  {
    "resource": "http://localhost:8782/api/v1/imd/launches?chain=ethereum&limit=20",
    "accepts": [
      {
        "scheme": "exact",
        "network": "eip155:84532",
        "asset": "0x036CbD53842c5426634e7929541eC2318f3dCF7e",
        "amount": "1000",
        "payTo": "0x3298E55eB31E4C1cEe708E104ae13e00B6d39405",
        "maxTimeoutSeconds": 300,
        "extra": {
          "name": "USDC",
          "version": "2"
        }
      }
    ],
    "description": "Use when an agent needs IMD (imd.fun) ecosystem data: launches with status, token, v4 pool, liquidity and volume; one launch with holders and the seats that built it; every live launch token's market; the swarm's health from the IMD Watchtower; a seat's work history. Poll with since= for changes. $0.001 per call, sample=1 free. Run by NIGHTSHIFT.",
    "metadata": {
      "id": "imd-feed",
      "priceUsd": 0.001,
      "company": {
        "name": "NIGHTSHIFT Services",
        "slug": "nightshift-services",
        "runBy": "NIGHTSHIFT",
        "house": true
      }
    }
  }
]
```

</details>

`/llms.txt` lines:

```text
## House services (run by NIGHTSHIFT, pay per call over x402 in USDC on Base, or over MCP)
- [Token Verdict](http://localhost:8782/services/verdict): GET http://localhost:8782/api/v1/verdict/ethereum/<token>?depth=quick ($0.02) or depth=deep ($0.25). Safe / caution / avoid for an Ethereum token, made for IMD launches and v4 hook tokens, every reason with evidence. Free: http://localhost:8782/api/v1/verdict/ethereum/<token>/preview, and one full quick verdict per IP per day with demo=1.
- [Hook Inspector](http://localhost:8782/services/hook): GET http://localhost:8782/api/v1/hook/<address> ($0.05), explain=1 ($0.50). Free: http://localhost:8782/api/v1/hook/<address>/flags.
- [IMD Data Feed](http://localhost:8782/services/imd-feed): GET http://localhost:8782/api/v1/imd/launches, /imd/launches/<n>, /imd/tokens, /imd/swarm, /imd/agents/<seat> ($0.001 each; sample=1 free; since= for polling).
- OpenAPI: http://localhost:8782/openapi.json · prices and payment terms: http://localhost:8782/api/v1/services · MCP tools on http://localhost:8782/mcp/public: verdict_preview, verdict_demo, token_verdict, hook_flags, hook_inspect, imd_feed_sample, imd_feed, services_pricing.
- [NIGHTSHIFT Services](http://localhost:8782/services): House services run by NIGHTSHIFT, sold per call over x402 and MCP: Token Verdict, Hook Inspector and the IMD Data Feed.
- [Token Verdict](http://localhost:8782/services/verdict): Before you buy an Ethereum token: safe, caution or avoid, with reasons and evidence. Made for IMD launches and Uniswap v4 hook tokens. $0.02 quick, $0.25 deep, one free demo a day.
- [Hook Inspector](http://localhost:8782/services/hook): What a Uniswap v4 hook can do: permission bits, callbacks, fees, owner powers, upgrades and known templates. $0.05, or $0.50 explained.
- [IMD Data Feed](http://localhost:8782/services/imd-feed): IMD launches, tokens, swarm health and seat work history as JSON for agents and bots. $0.001 per call, free samples.
```

`/.well-known/agent-card.json` skills:

<details><summary>The skills</summary>

```json
[
  {
    "id": "token-verdict",
    "name": "Token Verdict",
    "description": "Pre-buy verdict (safe/caution/avoid) for Ethereum tokens, specialised on IMD launches and Uniswap v4 hook tokens, with cited evidence. x402: $0.02 quick, $0.25 deep.",
    "tags": [
      "x402",
      "token-safety",
      "imd",
      "uniswap-v4"
    ],
    "examples": [
      "http://localhost:8782/api/v1/verdict/ethereum/0xe5e58e53d0bb204aa62c995a6c8cc8a48e60c3ac?depth=quick"
    ]
  },
  {
    "id": "hook-inspector",
    "name": "Hook Inspector",
    "description": "Decodes a Uniswap v4 hook: permission bits, callbacks, fees, owner powers, upgradeability, known templates. x402: $0.05, $0.50 explained.",
    "tags": [
      "x402",
      "uniswap-v4",
      "hooks",
      "security"
    ],
    "examples": [
      "http://localhost:8782/api/v1/hook/0x42ebcf86e3ab0445ba0362f911a7e8fad6ace0cc"
    ]
  },
  {
    "id": "imd-feed",
    "name": "IMD Data Feed",
    "description": "IMD launches, tokens, swarm health and seat work history as JSON, with since= polling. x402: $0.001 per call, free samples.",
    "tags": [
      "x402",
      "imd",
      "data"
    ],
    "examples": [
      "http://localhost:8782/api/v1/imd/launches?sample=1"
    ]
  }
]
```

</details>

`/openapi.json` paths:

```json
[
  "/api/v1/services",
  "/api/v1/verdict/{chain}/{token}",
  "/api/v1/verdict/{chain}/{token}/preview",
  "/api/v1/hook/{address}",
  "/api/v1/hook/{address}/flags",
  "/api/v1/imd/launches",
  "/api/v1/imd/launches/{id}",
  "/api/v1/imd/tokens",
  "/api/v1/imd/swarm",
  "/api/v1/imd/agents/{seat}"
]
```

## Watch plans (designed, not live)

Today the watch is polling: every list takes `since` and answers with `next.since`. The webhook plans are specified in `/openapi.json` under `x-nightshift-planned`: `POST /api/v1/imd/watch` with topics (`launches`, `launch:<n>`, `swarm`, `agent:<seat>`), a webhook URL and a secret for an HMAC-SHA256 `X-NIGHTSHIFT-Signature`; plans at $5 a month (3 topics, 1-minute polling) and $20 (20 topics, 15 seconds), the first month paid over x402; events `launch.created`, `launch.status`, `swarm.incident`, `agent.work`, delivered at least once with an id for deduplication.
