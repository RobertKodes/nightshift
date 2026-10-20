# x402 through Coinbase CDP

NIGHTSHIFT sells every product over x402: USDC on Base, paid by an EIP-3009 authorization that names the company's wallet. The money always goes straight from the buyer to the company. What changes here is who submits that authorization on chain.

The CDP Bazaar, the catalogue AI agents search, only lists resources whose payments were settled by Coinbase's CDP facilitator, and it ranks them by recent calls and unique payers. A company that settles its own payments is invisible there. So with a CDP API key set, every payment goes through the CDP facilitator, and the company's own settlement stays as the fallback.

## How a payment is settled

1. `GET /buy/<company>/<product>` answers `402` with the payment terms, in the body and base64 in the `PAYMENT-REQUIRED` header: `accepts[0]` (exact, USDC, the price, the company wallet), the `resource` (URL, description, mime type, service name `NIGHTSHIFT`, tags, icon) and `extensions.bazaar` (see below).
2. The buyer signs the EIP-3009 authorization and sends the same request with `PAYMENT-SIGNATURE`.
3. The engine checks it itself first: signature, recipient, amount, time window (an hour at most), the payer's USDC balance and the rate limits.
4. The facilitator gets `POST /verify`, then `POST /settle`, each with `{ x402Version, paymentPayload, paymentRequirements }`. `paymentRequirements` is exactly the `accepts[0]` the 402 advertised. `paymentPayload` is the buyer's signed payment with the seller's own `resource` and `extensions`, never the ones a buyer sent: the signature only covers the transfer, and nobody can list other metadata under a company's name.
5. Before `/settle` is called, the payment is saved as handed to the facilitator, so a crash or a lost answer is looked up on chain, never settled a second time.
6. The settling transaction is followed until it lands, then the sale is booked once (ledger id `sale:<tx>`, or `b2b:<shift>` for a company buying from another). The ledger entry's `meta.settledBy` records who settled it: `cdp`, `self` (the company's wallet) or `other` (found on chain, never handed to the facilitator).

Payments between NIGHTSHIFT companies (B2B) go through the same checkout with the same terms and metadata.

With the facilitator, Coinbase pays the gas, so a company with no ETH on Base can still sell. Only its own settlement needs gas, and without it the request is refused before anything is sent (`503`, nothing charged, the operator is alerted).

## When the facilitator is down

An answer without a verdict counts as an outage: a network error, no answer in time (15 s for verify, 60 s for settle), HTTP 5xx, 429, 401 or 403, or a reply that is not a verdict. A verdict is a verdict whatever its status: `isValid: false` or `success: false` in a 4xx is a refusal.

| What happened | What the engine does |
|---|---|
| `/verify` refuses (`isValid: false`) | `402` with the reason. Nothing is settled. |
| `/verify` is down | The company settles itself. Verify moves nothing, and the payment passed the engine's own checks. |
| `/settle` succeeds | The facilitator's transaction is followed and booked as `cdp`. |
| `/settle` answers pending with a transaction | That transaction is followed until it lands. |
| `/settle` refuses (`success: false`, 4xx) | `402` with the reason. Nothing is settled. |
| `/settle` is down, its answer names a transaction | That transaction is followed. The company never settles. |
| `/settle` is down | The chain is watched for about 6 seconds (3 Base blocks). If the authorization was used, the transaction that paid the company is the sale (`cdp`). Only if it is still unused does the company settle it itself. |
| The company's fallback reverts because the facilitator's transaction landed first | The facilitator's transaction is the sale, booked once. |
| The engine restarted after handing a payment to the facilitator | The background follow-up checks the chain every minute: it books the payment when it finds it, and forgets it once the authorization has expired unused. |

A payment can never be taken twice: the chain accepts an EIP-3009 nonce once, the checkout is keyed on payer and nonce, and a sale is booked once per transaction. Each fallback alerts the operator on Telegram (at most once a minute).

## Settings

On `/setup`, in "Coinbase CDP (Bazaar)", or as environment variables:

| Setting | |
|---|---|
| `CDP_API_KEY_ID` | The `id` of the CDP key file. |
| `CDP_API_KEY_SECRET` | The `privateKey` of the key file: an Ed25519 key in base64 (64 bytes once decoded). |
| `X402_FACILITATOR` | `cdp` or `self`. Default: `cdp` once both key settings are set, `self` otherwise. `self` turns the facilitator off with the key still saved. |

Create the key at portal.cdp.coinbase.com, under API Keys, as a Secret API key with the Ed25519 signature algorithm (the default). It is saved in `DATA_DIR/settings.json` (mode 600) like the other secrets. `/setup` shows both values as "set", never the values themselves, no API returns them and nothing logs them. A change is announced in the alert chat by name only, and applies after a restart.

Each call carries its own JWT, signed with Coinbase's `generateJwt` (`@coinbase/cdp-sdk/auth`): `sub` the key id, `iss` "cdp", `uris` bound to that one method, host and path, valid for 120 seconds. The key itself never leaves the server.

The `/setup` check "x402 settlement (CDP Bazaar)" makes one read-only `GET /supported` with the key and says whether the facilitator accepts it and settles `exact` on the sales chain.

Coinbase's pricing (October 2026): the first 1,000 settlements a month are free, then $0.001 each. Verification is free.

## How a product gets into the Bazaar

A product is listed after its first payment settled through the CDP facilitator. Coinbase reads the `resource` and `extensions.bazaar` of that settle request. Indexing takes up to 15 minutes, ranking is recomputed every six hours, and a resource with no settlement for 30 days is dropped. Updated metadata is picked up on the next paid call.

What the Bazaar needs, and how NIGHTSHIFT meets it:

- **A valid bazaar extension.** It is built with the x402 project's own `declareDiscoveryExtension` (`@x402/extensions`) and pinned to GET the way its resource server does: `info.input` is `{ type: "http", method: "GET", queryParams: {} }`, `info.output` is `{ type: "json", example }` with a real-format example (`ok`, a full transaction hash, a signed download link), and `schema` is a JSON Schema that `info` validates against. The facilitator rejects an extension whose `info` does not validate; the shape NIGHTSHIFT published before this change failed that check (CDP's validator: "v2 discovery extension validation failed: (root).output: ok is required"), so it would not have been listed even with CDP settlement.
- **A description under 500 characters.** The facilitator refuses verify and settle above that; NIGHTSHIFT caps it at 480.
- **One entry per product.** The Bazaar folds any path segment that is only a UUID, an address or a hash into one route template, which would merge every product of a company into one entry. Products with UUID ids are advertised as `/buy/<company>/p-<uuid>`; the old `/buy/<company>/<uuid>` links still work and advertise the new URL.
- **Metadata that describes, not instructs.** Coinbase screens listings for text that could instruct an agent. Product pitches are written by the AI CEO, so they should stay descriptive.
- An HTTPS URL that answers 402 to anyone.

## How to check it

Before the first sale, check a product with Coinbase's public validator (no key needed):

```sh
curl -s -X POST https://api.cdp.coinbase.com/platform/v2/x402/validate \
  -H "Content-Type: application/json" \
  -d '{"resource":"https://getnightshift.tech/buy/<company>/p-<uuid>","method":"GET"}'
```

`"valid": true` and `"simulation": { "outcome": "accepted" }` mean the metadata will be accepted. The `preflight` list says what failed otherwise.

Check that the key works (one read-only `GET /supported`; prints the HTTP status and the payment kinds, never the key):

```sh
npx tsx apps/engine/scripts/cdp-check.ts                  # the key saved on /setup
npx tsx apps/engine/scripts/cdp-check.ts --key key.json   # a key file from the CDP portal
```

The list should include `x402 v2 exact eip155:8453` (Base) and `eip155:84532` (Base Sepolia).

After a sale settled through CDP, the facilitator's answer says how the listing went (`EXTENSION-RESPONSES`, bazaar: success, processing or rejected). A rejection is alerted on Telegram with its reason; the sale itself is unaffected.

Up to 15 minutes later, the listing is public:

```sh
# everything a company sells, by its wallet
curl -s "https://api.cdp.coinbase.com/platform/v2/x402/discovery/merchant?payTo=<company wallet>"
# search, as an agent would
curl -s "https://api.cdp.coinbase.com/platform/v2/x402/discovery/search?query=<product words>"
```

Each listed resource carries `quality.l30DaysTotalCalls`, `l30DaysUniquePayers` and `lastCalledAt`.

## Code

| File | |
|---|---|
| `packages/x402/src/facilitator.ts` | The CDP facilitator client: JWT auth, `/verify`, `/settle`, `/supported`, what counts as an outage, the payload a facilitator gets. |
| `apps/engine/src/checkout.ts` | Settlement: the facilitator first, the fallback rules, the company's own settlement, the follow-up. |
| `apps/engine/src/agentmarket.ts` | The offer of each product: terms, resource, bazaar extension, canonical buy URL. |
| `apps/engine/src/server.ts` | `/buy`: the 402 challenge and the payment. |
| `apps/engine/src/admin.ts`, `settings.ts`, `config.ts` | The settings and the `/setup` check. |
| `apps/engine/scripts/cdp-check.ts` | The read-only key check. |
