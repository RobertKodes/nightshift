# Multichain swap: provider research

Checked on 2026-10-22 (UTC). Every "tested" line below is a real, read-only request to the provider's public
endpoint from this machine on that date; nothing was signed or sent, no account was opened anywhere.
Claims taken only from docs say "docs"; anything not confirmed either way is marked **unverified**.

The ask: one swap on getnightshift.tech across Ethereum, Base, Solana, the XRP Ledger and Robinhood Chain
(chain id 4663, where IMD launches), through the user's own wallets, with a small NIGHTSHIFT fee that NIGHT
FROGS holders (and Night Watchers) do not pay.

## Verdict per chain

| Chain | Covered by (tested) | Covered by (docs only) | Build |
| - | - | - | - |
| Ethereum | LI.FI, Relay, deBridge, THORChain | 0x, Rango, Squid, NEAR Intents | LI.FI first, Relay second. ETH and $SHIFT keep the existing Uniswap v4 pool swap as the default. |
| Base | LI.FI, Relay, THORChain | 0x, deBridge, Rango, Squid, NEAR Intents | LI.FI first, Relay second. |
| Robinhood Chain (4663) | LI.FI (Across in, SushiSwap on chain), Relay, deBridge, Across | 0x (swap API and Relay/OFT cross-chain), NEAR Intents (`hood`) | LI.FI first, Relay second. IMD on 4663 (`0x5f7bb593…7127`) quotes through both. |
| Solana | LI.FI (Mayan, OKX, Jupiter inside), Relay, Jupiter | deBridge, 0x, Rango, NEAR Intents | LI.FI first, Relay second, signed in an AppKit Solana wallet. |
| XRP Ledger | Relay (native XRP, both directions), THORChain (XRP.XRP pool, both directions) | Squid (XRP, RLUSD, USDC, SOIL via Squid Intents), NEAR Intents 1Click | **Into XRP: live** through Relay (the user signs on EVM or Solana; XRP lands at the XRPL address they type). **Out of XRP: coming soon**, see below. |

Not covered: LI.FI has no XRPL (its 69 chains, `GET /v1/chains`); deBridge has no XRPL (its 18 chains);
Chainflip has neither XRPL, Base nor Robinhood Chain; Rango's integrations page lists neither XRPL nor
Robinhood Chain (its API refused this machine with a Cloudflare 403, so **unverified** against the API).

### Why "out of XRP" is not live yet

- Reown AppKit has no XRP Ledger adapter (its network docs list EVM, Solana, Bitcoin, TON and TRON), so the
  site's wallet modal cannot sign an XRPL transaction.
- Paying from XRPL means sending a Payment with a memo to an XRPL account the provider controls: Relay
  answered with `rJBdWA9p5KwBoqSQTyMdg3UHLsJVzGVu5m` and a `memo`, THORChain with its vault
  `rPNjkN34VdR24ys4XRwENtmVc975pkShYY` and memo `=:e:0x…:0/1/0`. XRPL has no smart-contract depository,
  so for the minutes of the transfer the XRP sits in an MPC/TSS-held account (Relay documents this model
  for its Bitcoin depository; for XRPL it is **unverified**, Relay's docs do not mention XRPL at all yet,
  the chain only appears in `GET /chains` as id 537724, `tokenSupport: "Limited"`, native XRP only).
- A wrong or missing memo loses or strands the XRP, and that flow cannot be tested here without sending
  real XRP. It needs an XRPL wallet (GemWallet or Crossmark extension; Xaman needs an app registered on
  apps.xumm.dev with the site's origin) and one small real transfer, watched, before it is offered.

## What was tested (2026-10-22)

| Request | Result |
| - | - |
| LI.FI `GET /v1/chains` | 69 chains: Ethereum 1, Base 8453, Robinhood Chain 4663 (key `out`, Diamond `0xB477751B76CF82d00a686A1232f5fCD772414Af3`), Solana 1151111081099710. No XRPL. |
| LI.FI quote 0.1 ETH (Ethereum) → IMD (Robinhood Chain) | 42.29 IMD, Across + SushiSwap, about 2 s, LI.FI fixed fee 0.25% ($0.62 of $247), tx to the Diamond `0x1231DEB6…4EaE`. |
| LI.FI quote 0.1 ETH (Base) → SOL | 2.3069 SOL via Mayan, about 3 s. |
| LI.FI quote 2 SOL → USDC (Base) | Mayan FastMCTP, about 35 s; the transaction comes as a base64 Solana v0 transaction. |
| LI.FI quote 25 USDC (Base) → ETH (Robinhood Chain) | LayerSwap, about 10 s, approval to the Diamond. |
| LI.FI quote with `integrator=nightshift&fee=0.0025` | Refused: `1011 Integrator "nightshift" is not configured for collecting fees. Please sign up on https://portal.li.fi/`. The same request with `fee=0` passes. |
| LI.FI quote ETH (Base) → $SHIFT (Ethereum) | Routes through LI.FI Intents, still a call to the Diamond. |
| Relay `GET /chains` | 59 chains: Ethereum, Base, Robinhood Chain 4663, Solana 792703809, XRP 537724 (native XRP only). Depository `0x4cd00e387622c35bddb9b4c962c136462338bc31` on Ethereum, Base and Robinhood Chain; Solana program `99vQwtBwYtrqqD9YSXbdum3KBdxPAVxYTaQ3cfnJSrN2`. |
| Relay quote 0.02 ETH (Base) → XRP | 36.10 XRP, about 2 s, one deposit transaction to the depository. |
| Relay quote 50 XRP → ETH (Base) | 0.02744 ETH; the step is an XRPL payment to `rJBdWA9p…` with a memo. |
| Relay quote 0.05 ETH (Ethereum) → IMD (Robinhood Chain) with `appFees: 25 bps` | 21.10 IMD, app fee $0.31 shown separately; no key or sign-up needed. |
| Relay quote 25 USDC (Base) → XRP with app fee | Approval step for exactly 25,000,000 (the input) to the depository, then the deposit. |
| Relay quote 2 SOL → XRP | 15.55 XRP; Solana instructions for the Relay depository program. |
| Relay `POST /quote/v2` without a key | Still answered, although the docs say every `quote/v2` needs a key from 2026-10-02: expect that to stop. |
| THORChain `/thorchain/pools` (Liquify gateway; the Nine Realms hosts timed out) | `XRP.XRP` Available, about 569,776 XRP deep. |
| THORChain quote 50 XRP → ETH and ETH (Base) → XRP | Both quote; XRP in is a payment to vault `rPNjkN34…` with a text memo; affiliate fee per quote (`affiliate`, `affiliate_bps`). |
| deBridge `supported-chains-info`, quote ETH (Ethereum) → ETH (Robinhood Chain) with `affiliateFeePercent=0.25` | Robinhood Chain listed; affiliate fee 25 bps shown in `costsDetails`. No XRPL. |
| Across `available-routes?destinationChainId=4663` | 38 routes into Robinhood Chain (ETH, WETH, USDC → USDG). |
| Jupiter `lite-api.jup.ag/swap/v1/quote` with `platformFeeBps=20` | Quote with `platformFee` 20 bps. Docs now point to `api.jup.ag` with an `x-api-key`. |
| NEAR Intents 1Click `GET /v0/tokens` | 205 assets on 38 chains including `xrp` and `hood` (Robinhood Chain). |
| Chainflip (third-party broker `chainflip-broker.io/assets`) | BTC, DOT, ETH (Ethereum, Arbitrum), FLIP, SOL, TRX, USDC, USDT, WBTC. No XRP, Base or Robinhood Chain. |
| Squid `v2.api.squidrouter.com/v2/chains` | `x-integrator-id header is missing`: Squid needs an integrator id even to list chains. |
| 0x `api.0x.org` | `No API key found in request`. |
| Rango `api.rango.exchange` and `public-api.rango.exchange` | Cloudflare 403 page for this machine, with the public test key too. |

Recorded responses used by the tests are in `apps/engine/src/fixtures/swap/`.

## Providers

### LI.FI (API, SDK, widget)
- **Chains**: Ethereum, Base, Robinhood Chain, Solana (tested). No XRPL. 58+ chains in its docs, 69 in the API.
- **Integrator fee**: `fee` on every quote, a fraction of the input (`0.0025` = 0.25%), with `integrator`
  (docs, monetizing-integration). Per request, so a holder's quote is made with `fee=0` (tested: accepted).
  Collecting needs the integration and fee wallet set on portal.li.fi (tested: refused until then).
  EVM fees are forwarded to the fee wallet at execution where FeeForwarder is live, else held in
  FeeCollector and withdrawn in the portal; on Solana fees go straight to the fee wallet (docs, fee-forwarder).
  "LI.FI may receive a share of the collected fees depending on the use case and volume" (docs, no figure).
- **LI.FI's own fee**: 0.25% service fee on each transaction (docs FAQ; tested: "LIFI Fixed Fee" = 0.25%).
- **Custody**: non-custodial; the user signs a call to the LI.FI Diamond, the bridge or solver delivers.
- **Keys and limits**: no key needed. Without a key: 75 quotes per 2 h (rate-limits page; the llms.txt page
  says 200 per 2 h, the more specific page is used here); with a key from the Partner Portal 100 per minute.
  The key must stay on the server ("Never expose your x-lifi-api-key in client-side environments").
- **Embed**: `@lifi/widget` (React) or the API. We use the API, so the page keeps NIGHTSHIFT's design and CSP.
- **Status**: `GET /v1/status?txHash&fromChain&toChain&bridge` → NOT_FOUND, PENDING, DONE, FAILED.
- **Security**: audits public on GitHub, Cantina bounty up to $1M (docs). Incidents from public reports:
  2024-07-16, a new GasZipFacet allowed arbitrary calls and drained wallets with **infinite** approvals to
  the Diamond (about $11.6M per LI.FI's report and Revoke.cash; finite approvals were not affected);
  a similar bug in March 2022 (about $600k per SolidityScan). Lesson applied: exact approvals only.

### Relay
- **Chains**: Ethereum, Base, Robinhood Chain, Solana, XRP Ledger (all tested in `GET /chains` and quotes).
- **App fee**: `appFees: [{ recipient, fee }]` in bps of the input on every quote (docs, tested). Per
  request, so waivable per wallet. The recipient must be an EVM address even for non-EVM chains; fees accrue
  off-chain in USDC and are claimed at relay.link/claim-app-fees or `POST /app-fees/{address}/claim`
  (gas deducted). Not collected on plain sends; check `paidAppFees` on `/requests/v2`.
- **Custody**: deposits into the non-upgradable Depository (EVM contract, Solana program); a solver fills
  from its own capital; withdrawals need MPC Allocator signatures, governed by a Security Council multisig
  (docs). On Bitcoin the depository is an MPC address (docs); on XRPL an XRPL account (tested, **unverified**
  who holds its keys).
- **Keys and limits**: per key, `/quote` 50 per minute (dashboard.relay.link, self-serve). Quotes that set
  a `referrer` need a key; the docs say every `quote/v2` needs one from 2026-10-02 (not yet enforced today).
- **Status**: `GET /intents/status/v3?requestId=` (tested: `waiting`).
- **Security**: Spearbit (Feb 2025) and Certora (Jun 2025) on the EVM depository, Zellic on the settlement
  protocol (Nov 2025) and oracle (Apr 2026) (docs). No exploit found in public reports (**unverified**).

### Rango (API, widget)
- **Chains**: Ethereum, Base and Solana per docs; no XRPL or Robinhood Chain in its integrations page.
- **Fee**: affiliate fee per request (`affiliateRef`, `affiliatePercent`, `affiliateWallets`), settled
  instantly on EVM source chains only; from Solana it is the deprecated monthly settlement (docs).
- **Keys**: a key requested in a Discord ticket; a public test key is for testing only (docs).
- API not reachable from here (Cloudflare 403). Not chosen: no XRPL, no Robinhood Chain, key by ticket.

### Squid (Axelar)
- **Chains**: XRPL (XRP, RLUSD, USDC, SOIL via Squid Intents), Solana, EVM (docs). Robinhood Chain not mentioned.
- **Fee**: "To implement fees please contact the Squid team"; "Squid splits all fees collected by
  integrators 50/50"; fees show as one "Service fee" (docs). A per-request fee or waiver is not documented
  (**unverified**).
- **Keys**: integrator id required for every call, "issued on a limited basis upon review" (docs, tested).
- **XRPL**: `DEPOSIT_ADDRESS_CALLDATA` routes, transfer to a deposit address (docs). The best-documented
  XRPL option; worth applying for as the XRPL fallback.

### Jupiter (Solana only)
- **Fee**: `platformFeeBps` on `/quote` and a `feeAccount` token account on `/swap`, per request (docs,
  tested on lite-api). Jupiter charges no protocol fee on swaps (docs).
- **Keys**: `api.jup.ag` with `x-api-key` from the developer platform (docs); `lite-api.jup.ag` still answered.
- Not called directly: LI.FI already routes Solana swaps through Jupiter, OKX and others and pays the
  integrator fee on Solana straight to the fee wallet. A direct Jupiter path (`JUPITER_API_KEY`, a fee
  token account per mint) is a later option for Solana-only volume.

### THORChain (native XRP)
- **Chains**: XRP, Ethereum, Base and more, native assets (tested pools and quotes). No Solana, no Robinhood Chain.
- **Fee**: `affiliate` and `affiliate_bps` on each quote, so waivable per wallet (tested with an existing
  name). Collecting needs NIGHTSHIFT's own THORName or THOR address (**unverified**: registration cost and
  rules not re-checked today).
- **Custody**: TSS vaults run by node operators; funds sit in the vault during the swap.
- **Security** (public reports, **unverified** today): exploits in 2021; THORFi lending and savers paused in
  January 2025; heavily used to move the 2025 Bybit hack proceeds.
- The documented second route for XRP. Needs an XRPL wallet for XRP in, like Relay.

### Chainflip
- **Chains**: BTC, ETH (Ethereum, Arbitrum), SOL, DOT, TRX, USDC, USDT, WBTC (third-party broker list).
  No XRP, Base or Robinhood Chain. The broker fee is per deposit channel, so waivable, but needs a broker
  account (**unverified**). Not chosen.

### deBridge (DLN)
- **Chains**: Ethereum, Base, Robinhood Chain, Solana and 14 more (tested). No XRPL.
- **Fee**: `affiliateFeePercent` and `affiliateFeeRecipient` per request (docs, tested); paid to the wallet
  when a solver claims the order on EVM, withdrawn by hand on Solana (docs). No key needed: 50 requests per
  minute, 300 with a key (docs).
- **Custody**: funds in the DLN contract until filled or cancelled; the user can cancel and reclaim (docs).
- A good third route for EVM and Solana; not wired in this version (LI.FI already routes through deBridge).

### 0x
- **Chains**: Swap API on Ethereum, Base, Robinhood Chain and more; a Solana Swap API; a Cross-Chain API
  (Across, Relay, NEAR Intents, Mayan…) with Robinhood Chain on Relay and OFT (docs). No XRPL.
- **Fee**: `swapFeeBps` and `swapFeeRecipient` per request, up to 1000 bps (docs).
- **Keys**: a key on every request (tested). Not chosen: needs a key for everything, adds nothing LI.FI lacks.

### NEAR Intents (1Click API)
- **Chains**: XRP, Robinhood Chain (`hood`), Solana, Base, Ethereum and more (tested token list).
- **Fee**: `appFees` per quote (docs). Without a partner JWT 1Click adds 0.25% on top; with one it keeps at
  least 20 bps of a 50/50 split (docs).
- **Custody**: the user sends funds to a deposit address per quote (deposit-address model).
- An XRP-out alternative for later; the extra 0.25% without a JWT makes it the costliest.

### Across (bridge only)
- Into Robinhood Chain from Ethereum, Base and 15 more chains (tested). LI.FI uses it.

## Wallets

- **EVM** (Ethereum, Base, Robinhood Chain): the site's Reown AppKit with the wagmi adapter. Robinhood Chain
  (4663, RPC `https://rpc.mainnet.chain.robinhood.com`, explorer `robin.etherscan.io`, both from LI.FI's
  and Relay's chain lists; the RPC answers `0x1237` with CORS `*`) is added as an AppKit network.
- **Solana**: `@reown/appkit-adapter-solana` 1.8.24 (same version as the rest of AppKit; docs: AppKit
  supports Solana, Phantom, Solflare, Backpack and WalletConnect wallets). Public RPC
  `https://solana-rpc.publicnode.com` answers with CORS `*` (tested).
- **XRPL**: not in AppKit. Options: GemWallet extension (`@gemwallet/api` 3.8.0, no key), Crossmark
  extension (`@crossmarkio/sdk` 0.4.0, no key), Xaman (browser SDK needs an API key and the site's origin
  registered on apps.xumm.dev, docs). For XRP **out** of a swap no wallet is needed: the user types the
  XRPL address that receives it.

## The fee waiver

- Every provider we use takes the fee per request (LI.FI `fee`, Relay `appFees`; also deBridge, 0x,
  Jupiter, THORChain, NEAR), so the server decides it per quote: `SWAP_FEE_BPS` (default 25 = 0.25%), or
  0 when the signed-in wallet holds a NIGHT FROG (`0x55b8c762f1b86fe1d5406edaaae0f8ecf3688a0c`) or a
  Night Watcher (the forge contract, when `FORGE_ADDRESS` is set), read on chain and kept 5 minutes.
- Why signed in: a quote is just a request; anyone could ask for one as a holder's address and sign it
  from their own wallet (a LI.FI or Relay deposit works from any sender). The site's existing sign-in proves
  the wallet, so the waiver follows the session, and covers every chain the holder swaps from.
- The 7-day hold rule of the platform-fee waiver is not applied here: it protects a fee the platform must
  charge, while a swap fee is optional for anyone (they can use the providers' own sites). Live holding at
  quote time is enough.

## Recommendation

- **Primary**: LI.FI API for Ethereum, Base, Robinhood Chain and Solana, called from our server with the
  per-wallet fee and a server-side key.
- **Fallback and XRP**: Relay API, quoted in parallel for the same pairs and the only route used for XRP
  out. The page shows the better result after all fees and the other one beside it.
- **$SHIFT**: the Uniswap v4 pool swap stays the default for ETH ↔ $SHIFT on Ethereum; from other chains
  LI.FI and Relay both route into $SHIFT (tested from Base).
- **Later**: XRP in (Relay or THORChain plus GemWallet or Crossmark, after one watched real transfer);
  Squid for XRPL tokens (RLUSD, USDC) once an integrator id is granted; deBridge as a third route.

## What the owner registers

1. **LI.FI** (fees on LI.FI routes, and a key for real traffic): portal.li.fi → create the integration with
   the integrator name you want (for example `nightshift`) → add the EVM fee wallet (the treasury or a
   dedicated fee wallet) and a Solana fee wallet → create an API key (li.fi/plans). In /setup: set
   `LIFI_INTEGRATOR` to that name and `LIFI_API_KEY` to the key. Until then LI.FI routes carry no NIGHTSHIFT
   fee and share 75 quotes per 2 hours.
2. **Relay** (key for limits; fees need no sign-up): dashboard.relay.link → API keys → Create key → set
   `RELAY_API_KEY` in /setup. App fees go to `SWAP_FEE_WALLET` (an EVM address, defaults to the treasury)
   and are claimed in USDC at relay.link/claim-app-fees with that wallet.
3. **Reown**: add the Solana networks to the existing project only if the dashboard asks; no new project.
4. Later, for XRP in: an XRPL wallet choice (GemWallet and Crossmark need nothing; Xaman needs an app on
   apps.xumm.dev with `https://getnightshift.tech` as origin), and for THORChain fees a THORName.

## Unverified

- Who holds the keys of Relay's XRPL depository account, and Relay's XRPL memo format (not in Relay's docs).
- Relay's planned key requirement on `quote/v2` (documented for 2026-10-02, not enforced on 2026-10-22).
- Rango's API (blocked here), Squid's per-request fee, THORChain's THORName rules, Chainflip's official
  asset list (only a third-party broker was read), LI.FI's share of integrator fees.
- The names of two Solana programs in LI.FI routes: `3i5JeuZuUxeKtVysUnwQNGerJP2bSMX9fTFfS4Nxe3Br` (in
  every LI.FI Solana transaction, its fee step) and `D8C8iW6zmoKg5TRr8nQ7h14TMWqQX8FiBdj2ju5MF3wa` (in the
  Mayan FastMCTP route). Both are executable upgradeable programs (RPC); the labels are inferred.
- Security records marked "public reports" were not re-checked against each team's post-mortem.

## shib.exchange

Its page says "Swap any token on Solana with best prices across 20+ DEXes". Its public bundle (read
2026-10-22) calls its own backend (`api.shib.exchange/quotes`, `/exchange/tokens/search`), lists Solana
DEXes by icon (Raydium, Orca, Meteora, Jupiter…), and references Robinhood Chain and Shibarium RPCs and
`api.relay.link`. Raydium is one of its sources, not visibly its interface; the "Raydium interface" claim
is **unverified**.

## Sources (read 2026-10-22)

- LI.FI: https://docs.li.fi/llms.txt, https://docs.li.fi/introduction/integrating-lifi/monetizing-integration,
  https://docs.li.fi/introduction/integrating-lifi/fee-forwarder, https://docs.li.fi/api-reference/rate-limits,
  https://docs.li.fi/faqs/fees-monetization, https://docs.li.fi/introduction/learn-more/security-and-audits,
  https://li.fi/knowledge-hub/incident-report-16th-july, https://revoke.cash/exploits/lifi-2024,
  https://blog.solidityscan.com/li-fi-hack-analysis-521388128d22/, API https://li.quest/v1/{chains,tokens,quote,status,tools}
- Relay: https://docs.relay.link/features/app-fees.md, https://docs.relay.link/references/api/api-keys.md,
  https://docs.relay.link/references/protocol/security.md, https://docs.relay.link/references/protocol/components/depository.md,
  https://docs.relay.link/references/relay-kit/sdk/adapters.md, API https://api.relay.link/{chains,quote,quote/v2,intents/status/v3}
- Rango: https://docs.rango.exchange/integrations.md, https://docs.rango.exchange/technical/monetization.md,
  https://docs.rango.exchange/api-integration/api-key-and-rate-limits.md
- Squid: https://docs.squidrouter.com/, https://docs.squidrouter.com/api-and-sdk-integration/key-concepts/collect-fees.md,
  https://docs.squidrouter.com/api-and-sdk-integration/chain-integration-guides/xrpl-integration.md
- Jupiter: https://developers.jup.ag/docs/swap/add-fees-to-swap, API https://lite-api.jup.ag/swap/v1/quote
- THORChain: https://gateway.liquify.com/chain/thorchain_api/thorchain/{pools,quote/swap},
  https://blog.thorchain.org/decentralised-xrp-swaps-are-live-powered-by-thorchain
- Chainflip: https://chainflip-broker.io/assets (third party)
- deBridge: https://docs.debridge.com/home/monetization/affiliate-fees.md, https://docs.debridge.com/home/resources/status-limits.md,
  API https://dln.debridge.finance/v1.0/{supported-chains-info,dln/order/create-tx}
- 0x: https://docs.0x.org/docs/introduction/supported-chains.md, https://docs.0x.org/evm/0x-swap-api/guides/monetize-your-app-using-swap.md
- NEAR Intents: https://docs.near-intents.org/resources/fees.md, https://docs.near-intents.org/integration/distribution-channels/1click-api/authentication.md,
  API https://1click.chaindefuser.com/v0/tokens
- Across: https://app.across.to/api/available-routes?destinationChainId=4663
- Reown: https://docs.reown.com/llms.txt, https://docs.reown.com/appkit/networks/solana.md
- Xaman: https://docs.xaman.dev/environments/browser-web3.md; npm `@gemwallet/api`, `@crossmarkio/sdk`, `xumm-oauth2-pkce`
- IMD on Robinhood Chain: https://api.imd.fun/requests/capabilities (pairing `imd`, `0x5f7bb59365ce557c26dbcaa4ee9d39a4b95b7127`)
