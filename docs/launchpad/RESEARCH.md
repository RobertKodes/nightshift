# NIGHTSHIFT Launchpad: research

Research run of 2026-10-22 for the ask: "a launchpad, cross chain for one token launched: same token traded in the same LP but on different chains, pump.fun for all the chains, especially IMD; see what IMD can help with".

**How to read this.** Every source was opened on 2026-10-22 unless the line says otherwise. Anything taken from memory, a search-engine summary or a page that did not load is marked **[unverified]**. Numbers from APIs (IMD, DexScreener, DefiLlama, LI.FI, Relay, GeckoTerminal) are snapshots of that day. The raw answers behind section 2 are in `docs/launchpad/checks/` and in the recorded test fixtures in `apps/engine/src/fixtures/launchpad/`.

## Contents

1. Verdict
2. What IMD can do (and what it already does)
3. What exists already, so we do not build it twice
4. The launchpad landscape (single-chain and multichain)
5. Cross-chain token standards and intent bridges
6. How "the same LP on different chains" can really work
7. Sources

---

## 1. Verdict

- **Architecture: one hub pool per coin, bought from any chain.** A coin lives on one chain (Ethereum or Robinhood Chain), in one Uniswap v4 pool deployed by IMD. Buyers on Ethereum, Base, Robinhood Chain and Solana reach that same pool through intent routers (Relay first, LI.FI second) that the NIGHTSHIFT swap already integrates. This is the only design that is "the same LP" for real; it needs no new contract and it works today (section 6, tested live). Mirrored bonding curves on several chains are a different thing (N prices, N pools, arbitrage, supply races) and the only live product built that way, Printr, earns about $230 a month.
- **IMD's `launch.open` already is a launchpad: plug into it, do not rebuild it.** IMD's explorer has a coin launcher (explorer.imd.fun/launch, "Coin"), 413 coins are live on Ethereum and Robinhood Chain, and every launch gets a build, a second tester, four auditors and a judge, a deployment by IMD's factory and a single-sided v4 pool that behaves like a bonding curve from the first block, with no graduation step. NIGHTSHIFT adds what IMD does not have: a launch form that runs IMD's free check before paying, a board that ranks every IMD coin with prices, a page that follows a launch from payment to pool, and the buy from any chain.
- **What IMD can add next (ordered, all checked with 0 blockers, none paid):** a NIGHTSHIFT launch hook (sniper fee falling from 50% to 0 over 60 seconds, then 0.25% of every swap to the NIGHTSHIFT fee splitter, so launches reward $SHIFT stakers and NIGHT FROGS holders and burn SHIFT and IMD), and a LayerZero V2 bridge for a launched coin (an OFT adapter on its home chain and an OFT on the other IMD chain). IMD's swarm already built such a pair once (launches #778 and #782) but it was never wired; section 2.6 says why and how to avoid it.
- **What is not possible yet:** IMD does not deploy on Base (its check refuses chain 8453 today) or Solana (EVM only). So a coin cannot have an IMD-built pool or token contract on Base or Solana; buyers there pay on their chain and receive the coin on its home chain. A Solana-side token would come from Chainlink CCIP's self-serve pools (no Solana program to write) or a LayerZero OFT program deployed by someone other than IMD.
- **Market fit.** Robinhood Chain is where launchpad money is in late 2026: Pons V2 took $132.3M of fees in September 2026 against pump.fun's $46.4M (DefiLlama). IMD launches there for cents of gas. The NIGHTSHIFT angle that no one has shipped: an audited launch by a paid agent swarm, buyable from four chains into one pool.

---

## 2. What IMD can do (and what it already does)

Read on 2026-10-22 from `GET https://api.imd.fun/requests/capabilities`, `GET /launch/policies`, `GET /launches` (all pages), `GET /launches/:id`, `GET /jobs/:id`, `GET /intake/:chain/:tx`, the docs at https://imd.fun/docs/llms.txt (143 KB, control plane `a26ee00d`) and the explorer's own launch page code (https://explorer.imd.fun/launch, its JavaScript bundle).

### 2.1 The actions and what they cost

- Every action is **0.5 IMD** (`500000000000000000` wei of the chain's IMD), quote TTL 600 s. Paid either by HTTP x402 + Permit2, or **on chain through Intake v2 `0xa43e6f75ee006411f79ac1c84120606c2330de82`** (same address on every chain): approve the Intake once, then `request(bytes32 action, bytes body, (address,bytes4) callback, address asset, uint256 amount)`. `launch.open@launch-1` is sold on **Ethereum and Robinhood Chain** (IMD there is `0x5f7bb59365ce557c26dbcaa4ee9d39a4b95b7127`). No refunds: "a refused body is a spent payment", so `POST /requests/check` (free) comes first.
- Gas: IMD's launch wallet `0xcecc29b037f5064fcdf45a5c318f132ef76aa551` deploys and pays deployment gas (ceiling 0.05 ETH on Ethereum, 0.01 ETH on Robinhood Chain per policy). The creator pays only the Intake transaction (cents at 0.06 gwei on Ethereum, less on Robinhood Chain).
- The free check is fast: 0.4 to 0.7 s for every body we sent today.

### 2.2 The launch kinds and their rules (docs, "Launch fields")

| Kind | Token | Pool | Owner | Notes |
|---|---|---|---|---|
| `custom_token` (the explorer's "Coin") | yours: name, symbol, any supply, 18 decimals, minted once, plain transfers | single-sided v4 pool; `economics.poolBps` 1,000 to 9,000 of the supply, `initialMarketCapWei` within the pairing's cap | **refused** (no owner) | `remainderTo` required unless poolBps is 9,000 |
| `univ4_hook` | IMD's fixed 1B token, or `customToken: true` for your own (no transfer fee, no mint after launch, nobody can move or freeze holders' tokens) | the hook's pool, opened at the policy cap (the check says "opening at a 10 ETH market cap") | the hook's owner functions go to `owner` | a fee on buys and sells is the hook's |
| `evm_project` | IMD's fixed 1B token | yes | `owner` gets the contracts' roles | up to 8 contracts around the token |
| `evm_contracts` | none | none | `owner` | 1 to 8 contracts, constructors with static args, `$owner`, `$contract:Name`; **nothing is called after deployment** |

Common to every token kind: **10% of the supply goes to IMD's swarm** (2% split between the wallets with accepted work, 8% equally per connected seat, claimed from the launch's MerkleDistributor), the pool fee is **1.25%: 1% to the paying wallet, 0.25% to IMD's network** (the payer can redirect its share with `setRequester`). The pool position is seeded and held by IMD's factory (`seeded.positions[].factory`), not by the creator.

### 2.3 Chains and pairings (capabilities, 2026-10-22)

| Chain | Kinds | Pairings and opening-cap range |
|---|---|---|
| Sepolia 11155111 (default) | all four | ETH, 1 to 1,000 ETH |
| Ethereum 1 | all four | ETH 1 to 1,000 ETH; IMD 250 to 250,000 IMD; FWA 200k to 200M |
| Robinhood Chain 4663 | all four | ETH 1 to 1,000 ETH; IMD 250 to 250,000 IMD |
| **Base 8453** | policies exist (`/launch/policies` versions 24, 41) | **not open**: the check answers `invalid_input`, "Base (8453) is not open for launches" (`checks/coin-base-refused.json`) |
| Solana | none | IMD builds and deploys EVM contracts only |

### 2.4 IMD already has a coin launcher

explorer.imd.fun/launch ("Hire the swarm": Coin, v4 hook, Contracts, Company, Oracle, Website, Audit, Report, Indexer, Image, Audio, Video). Its Coin form (read from its bundle) validates: name 1 to 40 characters, symbol `^[A-Z0-9]{2,11}$`, supply 1 to 18 digits, pool share 10 to 90% in whole percent (default 88), opening cap within the pairing's range (default 10 ETH or 2,500 IMD), `remainderTo` required below 90%. It sends:

```json
{ "objective": "A custom token: NAME (SYM).\nToken name: NAME\nToken symbol: SYM\nToken supply: N with 18 decimals, all minted once to the deployer in the constructor.\nWhat it does: …",
  "shape": "chain", "steps": [{ "skill": "build-contract-project" }, { "skill": "adversarial-review" }],
  "onchain": "custom_token", "github": true, "chainId": 1, "pairWith": "imd",
  "economics": { "poolBps": 8800, "initialMarketCapWei": "…", "remainderTo": "0x…" } }
```

It is the format of every `custom_token` launch we sampled (#945, #1104, #2109, #2444; JURY #2444 on Robinhood Chain was paid `via: explorer.imd.fun`), out of 303 live `custom_token` launches. The NIGHTSHIFT form sends the same body plus the creator's words (one line each), the transfer rules said outright (so the check assumes nothing) and one line that marks the launch as made here. Checked today with **0 blockers and 0 suggestions** on Ethereum/ETH, Robinhood/IMD and Ethereum/IMD (`checks/coin-*.json`). Before the rules line was added, the check suggested stating the transfer rules.

There is **no image field**: IMD runs its own logo job (launch `logo: {jobId, state, hash}`) and serves the image at `https://api.imd.fun/artifacts/<hash>`. A creator can only describe the logo in the objective.

### 2.5 What IMD has launched (GET /launches, all pages, 2026-10-22)

- 897 launches. Live coins (a token artifact, status live): **413**, of which **337 on Ethereum and 76 on Robinhood Chain**. By kind and status: 262 live `custom_token` on Ethereum, 41 on Robinhood; 44 live `univ4_hook` on Ethereum, 25 on Robinhood; 31 + 10 live `evm_project`.
- DexScreener (`tokens/v1/{ethereum,robinhood}`) prices **37** of the 413 (26 Ethereum, 11 Robinhood); **30** have $2,000 or more of liquidity. Most coins never get a trade. The top by 24 h volume today: INK $28.5k, YOLO $21.0k, INFER $16.9k, IDM (Robinhood) $16.7k, SHIFT $2.6k.
- Pace: launches #2444, #2445, #2448 and #2450 were all created between 00:33 and 02:48 UTC on 2026-10-22 (launch numbers are shared with jobs, so there are gaps).

### 2.6 Bonding curves, launchpads and cross-chain tokens already built on IMD

Searched every launch's repository name and artifact names for bond, curve, pad, factory, bridge, LayerZero, OFT, omni, cross, multichain:

- **LayerZero V2 bridge, #778 + #782 (2026-10-06).** #778 `ZTOAdapter` on Ethereum (`0x68d443f419064b11cc427b9b72faa6c1cedf6378`), an OFT adapter for the existing token ZTO, EndpointV2 `0x1a44076050125825900e736c501f859c50fE728c`, eid 30101. #782 `ZeroToOne` on Robinhood Chain (`0xb7c3ab1304513eb87699a33670cc79a3d7840517`), an OFT with no supply whose peer is fixed in the constructor to the adapter, EndpointV2 `0x6F475642a6e85809B1c36Fa62763669b1b48DD5B`, eid 30416. Read on chain today: the Robinhood OFT's `peers(30101)` is the adapter, but **the adapter's `peers(30416)` is zero, its owner is IMD's launch wallet, its ZTO balance is 0 and the OFT's supply is 0**. So IMD's swarm can build and deploy both ends of an OFT bridge on its two chains, but because `evm_contracts` calls nothing after deployment and the owner was set to IMD's own wallet, nobody else can ever wire it. Lessons for our orders: the owner must be the creator, the second end must have its peer fixed in its constructor, and the owner must set the peer and the DVN config afterwards (LayerZero's default on Robinhood Chain is its dead DVN, section 5).
- **PvP Pad, #1643, #1715, #1764, #1870 (Robinhood Chain).** "launchpad where every launch is a fast Spireth game played entirely in IMD, and every coin graduates into a coin/IMD pool": a bonding curve with virtual reserve 400 units against 1e9 virtual coins, 800M on the curve, sold out at 1,600 units raised (unit = 1 IMD), graduating into a full-range coin/IMD v4 pool whose LP is held forever. Deployed (PvPPad `0xb2c3ad3a9401d406a35fcf6ca81b3f80c952a16c` has code); its usage was not measured [unverified].
- **Keel, #1233 (Ethereum).** KeelFactory, KeelRouter, KeelToken (clone template), KeelVault and a KeelHook: "Ethereum mainnet launchpad contracts… Each project has a permanently locked TOKEN/IMD Uniswap v4 position. A 1% IMD swap fee funds the team, creator and continued IMD work." Launches need a signed permit from the operator. `paused()` reads false today.
- Others: #945 `TokenFactory`, #1104 "Swarms Launchpad Official token" (SPAD, a coin only), #2109 "World multichain token" (a plain `custom_token`, nothing cross-chain), #2093 SuperIMD with `SuperIMDHookFactory` (Robinhood), #83 `DutchAuction` (Sepolia).
- None of them makes one token tradeable on several chains. None is a cross-chain bonding curve.

### 2.7 What IMD can and cannot do for this launchpad

| Piece | IMD today | How |
|---|---|---|
| A coin with a v4 pool, audited and deployed | **Yes**, Ethereum and Robinhood Chain | `launch.open` `custom_token` (what the form sends) |
| A coin with a custom hook (anti-sniper, fee split) | **Yes** | `launch.open` `univ4_hook` + `customToken: true`, one build per coin; order text checked with 0 blockers (`checks/launch-hook-owl*.json`) |
| A pump.fun-style bonding-curve factory | Yes in principle (PvP Pad and Keel were built and deployed by the swarm) | `evm_contracts`; but coins from such a factory are no longer IMD launches (no swarm audit per coin, no 10% to seats), so we do not recommend it |
| OFT adapter + OFT (LayerZero V2) | **Yes** on Ethereum and Robinhood Chain (#778/#782) | two `evm_contracts` orders; owner must wire peers and DVNs afterwards (checked: `checks/shift-oft-*.json`) |
| CCIP token pools | Probably, for EVM pools via the chain's TokenPoolFactory [unverified: not ordered]; registration needs the token to expose `owner()`/`getCCIPAdmin()`, which `custom_token` does not | |
| Anything on Base | **No**, not open | |
| A Solana program or SPL token | **No**, EVM only | |
| A price feed | **No**: IMD's oracle answers typed questions by a panel or from chain evidence, and says it is "not a price feed" | |
| A website for a coin | Yes (`workflow.open`, `ipfs` site) | not needed here: the coin page is on getnightshift.tech |

### 2.8 Routing into IMD coins from other chains (tested live, 2026-10-22)

Quotes for about $12 of ETH (0.005 ETH) or $5 of SOL, preview addresses, nothing signed (`apps/engine/src/fixtures/launchpad` holds the recorded IMD and DexScreener answers; the route answers are summarised here):

| From → to | LI.FI | Relay |
|---|---|---|
| Base ETH → INK (Ethereum, IMD pair, univ4_hook) | via Relay depository, 4 s, $11.72 out | 4 s, $11.87 out (impact -2.5%) |
| Base ETH → EMBEO (Ethereum, ETH pair) | 4 s, $12.13 | 4 s, $12.05 |
| Ethereum ETH → IDM (Robinhood, ETH pair) | via Across + nordstern, 2 s, $12.11 | 1 s, $11.97 |
| Base ETH → SVO (Robinhood, IMD pair) | via Across + nordstern, 1 s, $11.52 | 1 s, $11.70 |
| Solana SOL → INK (Ethereum) | via Relay, 4 s, $4.97 for $5.31 | 4 s, $5.03 for $5.26 |
| Solana SOL → IDM (Robinhood) | no route (1001) | 1 s, $5.11 for $5.26 |
| Base ETH → JURY (Robinhood, launched 5 hours earlier, not on DexScreener) | no route ("Across does not send ETH to contracts") | **routes**: 836,790 JURY for 0.005 ETH, 1 s (USD value unknown to Relay) |
| Base ETH → SHIFT (Ethereum, our own hooked pool) | LI.FI Intents, 26 s, $11.95 | 4 s, $10.94 (impact -10%) |

So IMD's hooked v4 pools (PoolInitializationGuard, custom hooks) are routable from four chains within seconds, and Relay reaches a brand-new coin before any price site indexes it. The swap's own checks (pinned router contracts, simulation, exact approvals) still apply to every route.

---

## 3. What exists already, so we do not build it twice

- **IMD's explorer launcher** (explorer.imd.fun/launch): the coin form and payment. We do not duplicate it; we send the same body, and add the free check up front, the board, the follow page and the multichain buy.
- **IMD Radar** (https://www.imdradar.site, community; noted on 2026-10-20, not reopened today [unverified today]): a reviewed leaderboard of every swarm launch with chart, trades, holders, a before-you-buy sell simulator and in-page swaps (0.5% fee). The NIGHTSHIFT board is not a screener: it lists coins to launch next to and to buy from any chain, and links IMD Radar for depth.
- **IMD-built launchpads**: PvP Pad (Robinhood, IMD-quoted curve game) and Keel (Ethereum, signer-gated factory). Different products (a game; an operator-gated pad); neither is multichain.
- **Multichain launchpads elsewhere**: Flap.sh, o1, NOXA, Clanker, Bags, Virtuals and Doppler deploy separately per chain; Printr, OFT Pad and omni.fun are the omnichain attempts (section 4). None offers one pool bought from any chain.
- **Inside NIGHTSHIFT**: the multichain swap (`packages/swap`, `apps/engine/src/swap.ts`, `apps/web/src/mswap`) already quotes LI.FI and Relay across Ethereum, Base, Robinhood Chain and Solana, checks every route against pinned contracts and signs in the visitor's wallet; `apps/engine/src/imdmarket.ts` and `services/imd.ts` already page IMD's launches and price them on DexScreener. The launchpad reuses all three.

---

## 4. The launchpad landscape

**Traction baseline.** Unless stated otherwise, traction figures come from the DefiLlama fees API (`api.llama.fi/overview/fees`, `.../summary/fees/<slug>`), pulled 2026-10-22. "30d" covers roughly 2026-09-21 to 2026-10-21. "Oct-26" is a partial month (1 to 21 Oct). DefiLlama "fees" definitions differ by adapter: some count only curve fees, some include post-graduation hook fees or token taxes. Compare orders of magnitude, not exact ratios.

---

### 4.1 Single-venue launchpads

#### pump.fun (+ PumpSwap)
- **Chain:** Solana. Program `6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P`.
- **Curve:** a Uniswap-V2-style constant product with synthetic reserves. Global config: `initial_virtual_token_reserves` = 1,073,000,000 (6 decimals), `initial_virtual_sol_reserves` = 30 SOL, `initial_real_token_reserves` = 793,100,000, total supply 1B. Derived figures: the curve completes when real tokens reach 0, at about 85.0 SOL real (115.0 SOL virtual) and an implied FDV of about 411 SOL. 206.9M tokens are left over for the pool. Since 2026 coins can also be quoted in USDC (`initial_virtual_quote_reserves`) or in another pump coin, up to depth 2 (live since Oct 13).
- **Graduation:** `complete=true` when `real_token_reserves==0`. Anyone can call `migrate` (permissionless, idempotent) to move liquidity into a canonical PumpSwap pool, and **the LP tokens are burnt**. The `pool_migration_fee` is 0.015 SOL (account rent). "Synthetic migration" (v3 buys) lets the buy that crosses the limit overfill: it buys from the tokens reserved for the pool at the pool's price.
- **Fees:** dynamic tiers by market cap, effective 2025-09-01 ("Project Ascend", Dynamic Fees V1, still documented as current):
  - On the curve: creator 0.30% + protocol 0.95% = 1.25%.
  - PumpSwap canonical pools: creator 0.30% / protocol 0.93% / LP 0.02% (total 1.25%) for 0 to 420 SOL mcap. Then creator 0.95%, protocol 0.05%, LP 0.20% (total 1.20%) at 420 to 1,470 SOL, with the creator share stepping down to 0.05% (total 0.30%) above 98,240 SOL (about $20M).
  - 2026 changes: creator fees can be split (fee sharing). "Holder rewards coins" route the creator fee to holders. Cashback coins are deprecated. New v3 instructions keep fees on the curve or pool until a permissionless `sweep`.
  - Per DefiLlama's methodology, pump kept 100% of its fee slice before 2025-07-14, sent 100% to PUMP buybacks from 2025-07-14, and has sent 50% since 2026-04-28.
- **Anti-sniper / anti-rug:** no on-chain sniper tax. Fixed supply, LP burn, permissionless migration. Since Sept 30 2026, PumpSwap `virtual_quote_reserves` can be negative (fees parked in the pool), and integrators must use effective reserves.
- **Traction (DefiLlama, 2026-10-22):**
  - pump.fun launchpad: fees 24h $2.0M, 30d $62.9M (revenue $45.5M), 1y $431M.
  - PumpSwap: 30d fees $116.4M.
  - Pump mobile app: 30d fees $10.7M.
  - Monthly launchpad fees: Jan-25 $149.8M (peak), Jun-26 $23.6M (low), Aug-26 $48.0M, Sep-26 $46.4M.
- **Notes:**
  - On 2024-05-16 a former employee who held the `withdraw` authority used flash loans to push curves to 100% and took about 12,300 SOL (~$1.9M). Pump halted trading, upgraded the contracts, re-seeded the affected pools and charged 0% fees for 7 days (The Block). The old `withdraw` path (off-chain migration to Raydium) is now disabled in favour of the permissionless `migrate`.
  - Share of graduated tokens swung from about 5% to about 90% within two weeks in Aug 2025 during the LetsBonk war (The Block, 2025-08-18).
- **Sources:** github.com/pump-fun/pump-public-docs (README; docs/PUMP_PROGRAM_README.md; FEE_PROGRAM_README.md + docs/fees.png; PUMP_CREATOR_FEE_README.md; HOLDER_REWARDS_README.md; VIRTUAL_QUOTE_RESERVES_FEE_ADJUSTMENT.md); api.llama.fi/summary/fees/pump.fun; theblock.co/post/295029/pump-fun-post-mortem; theblock.co/post/367266 (2025-08-18).

#### LetsBonk / bonk.fun
- **Chain:** Solana. It is a Raydium LaunchLab platform config, built with Graphite Protocol.
- **Curve:** LaunchLab constant-product with virtual reserves (see LaunchLab below). JustSendit mode: 85 SOL fixed target.
- **Graduation:** to a Raydium pool (all new LaunchLab launches go to CPMM).
- **Fees:**
  - Trade fee 1% [unverified: Coinranking/cryptonews via search; a Blockworks Q1-2026 report summary says 0.3%].
  - DefiLlama methodology: after 2025-06-10, 58% of fees go to holders (buy/burn 50%, SBR 4%, BonkRewards 4%) and 2% to marketing. Graphite Protocol receives 40% of joint-venture fees (57.68% before 2025-06-10).
  - 2025-12-04: 51% of platform fees redirected to buying BONK for BNKK's Digital Asset Trust, up from 10%. This removed the 35% buy-and-burn, 4% SBR and 2% BONKrewards lines (Whale Alert).
- **Anti-sniper / anti-rug:** inherits LaunchLab: mint authority revoked, LP 90%+ burned or locked per platform config.
- **Traction:** 30d fees $5.65M; Graphite 30d $2.27M. Monthly: Jul-25 $33.4M peak, May to Aug 2026 under $0.35M, Sep-26 $8.4M. Hit 80%+ share of graduations in early Aug 2025, then fell to about 3% two weeks later (The Block). KuCoin blog: daily fees peaked at $352,793 around Jan 4 2026.
- **Sources:** defillama summary bonk.fun-launchpad, graphite-protocol; whale-alert.io/stories/9667aa65e5a5 (2025-12-04); kucoin.com/blog/ae-solana-launchpad-letsbonk-fun-sees-600-revenue-surge-in-early-2026; theblock.co/post/367266.

#### Raydium LaunchLab (and StonkFun on top of it)
- **Chain:** Solana.
- **Curve:** `curve_type` 0 = constant product with virtual reserves (the default and the only live type), 1 = fixed price, 2 = linear. Sale share is usually 80% of supply (`min_base_sell_rate` 20%; UI allows 51 to 80% on the curve). `min_base_migrate_rate` 20%. Vesting up to 30% of supply (`max_lock_rate`).
- **Graduation:** when `quote_vault >= quote_reserve_target`. JustSendit: 85 SOL fixed. LaunchLab mode: at least 24 SOL. Migrates to CPMM (all new launches CPMM-only after the 2026-09 upgrade), and the mint authority is revoked. LP is split by `platform_scale/creator_scale/burn_scale`; Raydium's own default is 90% burn / 10% locked.
  - **2026-08-17 change:** for new migrations, the creator's LP share is merged into a platform-owned Fee Key NFT. Creators lost the LP Fee Key; they keep only CPMM creator fees if enabled.
- **Fees:**
  - Raydium protocol `trade_fee_rate` (value not stated on the page read). 25% of the protocol fee buys back RAY (DefiLlama methodology).
  - Plus platform `fee_rate`, cap raised from 100 to 500 bps on 2026-08-26.
  - Plus creator fee, capped at 50 bps.
  - Plus an optional referral share fee of up to 100 bps.
  - Post-graduation: CPMM `AmmConfig`, typically 0.25%.
- **Anti-sniper / anti-rug:** fixed supply, mint authority revoked at init, burned or locked LP, optional vesting with cliff. No sniper tax.
- **Traction:** LaunchLab 30d fees $7.08M (covers all platforms' curve fees); Jul-25 peak $47.0M. **StonkFun** ("coins paired with anything", LaunchLab platform, 1% platform fee): 30d $16.8M, Sep-26 $32.5M, launched 2026-07-25.
- **Sources:** docs.raydium.io/products/launchlab/{overview, bonding-curve, global-config, platform-config, creator-fees}.md; docs.raydium.io/user-flows/{creating-a-launchlab-token, how-creator-fees-work, launchlab-platforms}.md; defillama summary launchlab, stonkfun.

#### Meteora Dynamic Bonding Curve (DBC): infrastructure for Believe, Bags, Moonit, Printr-Solana and others
- **Chain:** Solana.
- **Curve:** a "universal curve" with configurable multi-segment concentrated-liquidity price ranges; partners create reusable configs.
- **Graduation:** at a configured quote threshold, migrates to DAMM v2 (DAMM v1 only for legacy pools). At least 10% of liquidity must stay locked at day 1, and vesting locks are capped at 2 years. Fixed 0.2% protocol liquidity migration fee, plus an optional partner/creator migration fee.
- **Fees:**
  - Base fee between 0.25% and 99%, using a linear or exponential scheduler (anti-sniper decay). Optional volatility-based dynamic fee. The rate limiter (fee rises with buy size, max 12h) is deprecated.
  - Protocol takes 20% of the trading fee; referral takes 20% of the protocol fee. The rest goes to partner/creator per `creator_trading_fee_percentage`.
- **Anti-sniper / anti-rug:** fee schedulers; mandatory partial LP lock.
- **Traction:** 30d fees $3.32M; May-25 peak $27.9M; Jan-26 $11.4M.
- **Sources:** docs.meteora.ag/core-products/dbc/{what-is-dbc, fees/overview, migration-and-liquidity, fees/rate-limiter}.md; defillama summary meteora-dynamic-bonding-curve.

#### Believe (believe.app / Launchcoin)
- **Chain:** Solana, on Meteora DBC [unverified for the current config]. Coins were launched by replying "@launchcoin +name" on X.
- **Curve / graduation / fees:** DBC-based. Exact parameters [unverified].
- **Traction:** effectively dead. DefiLlama 30d fees $469, all-time $40.9M; monthly fees fell from $26.7M in May-25 to $0 from Dec-25. believe.app returned HTTP 402 when probed on 2026-10-22.
- **Notes:** in Oct 2025 LAUNCHCOIN was migrated to BELIEVE (supply 1.0B to about 1.33B; unconverted tokens burned). An April 2026 class action alleges about $54M in fees collected and at least 12 unhonoured buyback pledges (allegations only).
- **Sources:** defillama summary launch-coin-on-believe; whale-alert.io/stories/f5ac016fa58a36 (2026-04-29).

#### Bags (bags.fm)
- **Chain:** Solana (Meteora DBC, then DAMM v2) and, since 2026, Robinhood Chain (own contracts).
- **Curve:**
  - Solana: DBC configs. A "DAMM v2 custody" direct launch has no curve and no migration.
  - Robinhood Chain: per-token `BagsBondingCurve`, virtual x*y=k, 830M of 1B sold on the curve.
- **Graduation:**
  - Solana: to DAMM v2.
  - Robinhood Chain: when `realQuoteReserves >= thresholdQuote`, the remaining 170M tokens plus the raise go into a Uniswap v4 pool with the Bags hook, and the LP is locked.
- **Fees:**
  - Solana default: 2% (1% protocol, 1% claimers pre-migration; post-migration 0.75/0.75/0.5% compounding). Seven fee modes exist. The deployer gets 25% of the claimers pool, and up to 100 fee claimers are allowed.
  - Robinhood Chain: flat 2% on the ETH leg in both phases, 1% to the creator and 1% to protocol (partner gets 25% of the protocol half by default). Creation fee 0.02 ETH.
- **Anti-sniper / anti-rug:** fee modes, locked LP. No time-decay tax documented on Robinhood Chain.
- **Traction:** 30d fees $330k. Spikes: Aug-25 $25.7M, Jan-26 $20.1M.
- **Sources:** docs.bags.fm/robinhood/overview.md; docs.bags.fm/how-to-guides/customize-token-fees.md; defillama summary bags.

#### Moonshot (DEX Screener), now Moonit (moon.it)
- **Chain:** Solana (Helio/MoonPay).
- **Curve:** "Classic" accelerating curve inherited from DEX Screener's Moonshot, about 80% of 1B sold. "Flat" fixed-price curve with volume limits.
- **Graduation:** Classic at about $75k mcap (about 431 SOL), to Raydium or Meteora.
- **Fees:** 1% on all trades. On Meteora, 80% of LP fees go to the creator and 20% to Moonit. Launch cost 3 to 6 SOL.
- **Anti-sniper:** Flat curve plus UI-only and volume limits.
- **Traction:** DefiLlama "Moonshot Create" 30d $32.7k; moon.it 30d $42. Solana Compass's "third-largest" claim is from Jul 2025 and is stale.
- **Sources:** solanacompass.com/projects/moonit; defillama overview.

#### Metaplex Genesis
- **Chain:** Solana.
- **Curve:** a bonding curve option, plus Launch Pool (pro-rata deposit window), Presale and uniform-price auction.
- **Graduation:** to a CPMM on Raydium. Launch Pool and Presale must put at least 20% of proceeds into LP, with a 1-year lock and quarterly unlocks.
- **Fees:** curve 0.50% protocol + 0.60% creator. Post-graduation CPMM: 0.40% protocol, 0.60% creator, 0.21% LP, 0.04% Raydium. Pools charge a 5% fee only on creator withdrawals (page updated 2026-09-22).
- **Traction:** Metaplex (all products) 30d fees $177k.
- **Sources:** metaplex.com/docs/smart-contracts/genesis.

#### Heaven / Boop / time.fun (inactive)
- **Heaven** (Solana, own AMM, no standard curve, 100% of revenue to LIGHT buyback [unverified]): DefiLlama 30d $0, all-time $4.6M. Site still up.
- **boop.fun:** 30d $0, all-time $4.5M; domain did not resolve on 2026-10-22.
- **time.fun:** now listed on Base, 30d $0.
- **Sources:** defillama overview; site probes.

#### four.meme
- **Chain:** BNB Chain. Quote assets: BNB, USDT, USD1, UUSD or bStocks.
- **Curve:** fixed 1B supply. Classic TokenManager. "OpenFour" lets third parties ship custom curve modes, after a security review.
- **Graduation:** at 100% of the curve (docs say about 18 BNB). 20% of tokens plus all raised funds are paired on PancakeSwap.
- **Fees:**
  - 1% trading fee (minimum 0.001 BNB). Launch costs gas only (about 0.005 BNB).
  - Tax Tokens: 1/3/5/10% tax applied on the curve and after graduation, routed to a wallet, dividends (paid out at $1,000 accumulated) or burn.
  - OpenFour "creator fee" scales from 0.02% up to 1% with market cap.
  - GoPlus SkillRoyalty mode: 70% creator / 15% users / 15% ecosystem.
- **Anti-sniper / anti-rug:**
  - X Mode (2025-10-30): fees fall block by block after creation, and any launch fees above 1% are used to buy back and burn the token after graduation.
  - Tax-token mode: high fees in the first blocks.
  - Atomic dev buy at creation.
- **Traction:** 30d fees $231k (down sharply). Oct-25 peak $44.0M; Jan-26 $10.5M; Sep-26 $0.22M.
- **Sources:** four-meme.gitbook.io/four.meme/{guide/how-it-works, guide/introducing-tax-tokens-on-four.meme, openfour/about-openfour-en, product-update/6-product-update-25-10-30}.md; docs.codex.io/launchpads/four-meme; defillama summary four.meme.

#### Flap.sh
- **Chain:** BNB Chain, Robinhood Chain, Base, X Layer, Monad, Morph, plus white-label "Toshimart" and "Muffun". Each chain has a separate Portal deployment.
- **Curve:** (x+h)(y+r)=K over 1B supply, with h and r as virtual reserves. BSC latest (BNB quote): r=6.14, h=107,036,752, K=6,797,205,657.28. USD1 quote: r=3837. Monad: r=50,000. X Layer: r=28.25. Parameters are immutable per token.
- **Graduation:** at 800M sold (no overfill). BSC: 16 BNB or 10,000 USD1. Non-tax tokens go to Uniswap/Pancake v3 with a concentrated range from the initial price to 10,000x, falling back to v2. Tax tokens go to v2 only.
- **Fees:** curve fee 1% on BNB Chain, Robinhood, X Layer and Monad (2.5% on Morph). Tax tokens (V1 to V3) add up to 0.3% protocol fee on top of the creator tax. PreBond tax exists.
- **Anti-sniper / anti-rug:** token locker and registry. No time-decay tax found in the pages read.
- **Traction:** 30d fees $32.3M (revenue $7.8M), 24h $684k. Monthly: Aug-26 $12.4M, Sep-26 $41.7M (more than pump.fun's launchpad that month). The #2 launchpad by fees right now.
- **Sources:** docs.flap.sh/flap/developers/basic-and-mechanism/{bonding-curve, list-on-dex, protocol-economics}.md; docs.flap.sh/flap/developers/deployed-contract-addresses.md; docs.bitquery.io/docs/blockchain/robinhood/flap-sh-api/; defillama summary flap-sh.

#### Pons (ponsfamily.com), Robinhood Chain
- **Chain:** Robinhood Chain (chain id 4663, Arbitrum Orbit L2). V1 used Uniswap v3; V2 (data from 2026-08-03) uses Uniswap v4.
- **Curve:** per-token curve contract with fixed 1B supply. 5/7 (about 714.3M) sold on the curve. Of the 2/7 swept at graduation, 10/49 of supply goes to the locked v4 position and 4/49 is locked supply. Quote in ETH, USDG, cbBTC or tokenized stocks.
- **Graduation:** at 4.2 ETH for ETH-quoted launches. Two-step permissionless `graduate` then `createGraduatedPool` into a v4 full-range position with pool fee 0 (all fees taken by `PonsV2MemeHook`). Liquidity is permanently locked.
- **Fees:** 1% curve fee (per launch config), launch fee 0.0005 ETH, optional creator tax capped by the factory, optional buybacks.
- **Anti-sniper:** `snipeTaxBps = 9900 >> (elapsed*14/3)`, i.e. 99% in the launch second, 6.18% the next, 0.19%, then 0. Exempt wallets can be pre-declared. The curve snapshots factory settings at init.
- **Traction:** Pons V2 30d fees $28.9M (revenue $4.3M). **Sep-26 $132.3M**, about 2.9x pump.fun's $46.4M. Total since Aug-26 $168M. The Defiant (undated): Robinhood Chain DEX volume of $1.49B in 24h, with Pons taking about two-thirds of launchpad fees.
- **Sources:** docs.bitquery.io/docs/blockchain/robinhood/pons-api/; thedefiant.io/news/blockchains/robinhood-chain-dex-volume-hits-usd1-49-billion-as-pons-takes-two-thirds-of-launchpad-fees; defillama summary pons-v2.

#### Pools.trade (Uniswap "LiquidityLauncher"), Robinhood Chain
- **Chain:** Robinhood Chain. Contracts live since 2026-07-08; public launch 2026-08-05.
- **Curve:** **none.** A real Uniswap v4 pool from launch (ETH quote, 0.25% fee, no hook, tick spacing 25 or 60), seeded with single-sided concentrated liquidity. 1B supply. "Crowd Launch" mode runs a Continuous Clearing Auction (CCA, about 4h window) before the pool opens.
- **Graduation:** cosmetic only. Computed off-chain as FDV / $50k target; no migration.
- **Fees / anti-sniper:** platform fee split not documented in the page read. CCA is the anti-snipe path.
- **Traction:** DefiLlama "Pools" 30d $322k.
- **Sources:** docs.bitquery.io/docs/blockchain/robinhood/pools-trade-api/; defillama overview.

#### Clanker
- **Chain:** Base, Arbitrum, Unichain, Ethereum, BNB, Monad, and Robinhood Chain per DefiLlama. Solana tokens are deployed via Meteora when tagging @clanker. DefiLlama lists it under parent "Farcaster".
- **Curve:** **none.** The full supply goes into a single-sided Uniswap v4 position (the "initial LP"). Default starting mcap is $40k. v4 is modular: hooks (static or dynamic fee), MEV modules, extensions (vault, airdrop, dev buy, presale).
- **Graduation:** none (no migration). LP is locked in a locker contract and fees are claimable via ClankerFeeLocker.
- **Fees:** creator LP fee (for example 1%), plus Clanker's 20% of it on top: 1% becomes 1.2% total, 2% becomes 2.4%. 100% of the creator LP fee goes to the creator. Clanker uses its share to buy back CLANKER.
- **Anti-sniper:** `ClankerMevDescendingFees` / `ClankerSniperAuctionV2`. Starting fee up to 80% (recommended 80% falling to 5% over 30s, quadratic decay), meaning snipers effectively pay a $200k mcap price. There is also a 2-block-delay module and sniper auctions (MEV bids).
- **Traction:** 30d fees $1.36M; 1y $51.2M. Monthly: Feb-26 $22.4M peak, Sep-26 $0.55M.
- **Notes:** `ClankerToken` implements IERC7802 (SuperchainERC20). The full supply is minted only on `initialSupplyChainId`; `crosschainMint/Burn` is callable only by the `SUPERCHAIN_TOKEN_BRIDGE` predeploy (see multichain section).
- **Sources:** clanker.gitbook.io/documentation/{general/creator-rewards-and-fees, references/core-contracts/v4, references/core-contracts/v4/mev-modules/clankermevdescendingfees, .../clankersniperauctionv2, references/deployed-contracts}.md; raw.githubusercontent.com/clanker-devco/v4-contracts/main/src/ClankerToken.sol; defillama summary clanker.

#### Flaunch
- **Chain:** Base and Robinhood Chain per the launch API. Game Mode also lists Ethereum and Arbitrum.
- **Curve:** Uniswap v4 hooks with no separate curve. Optional Fixed Price Fair Launch: everyone gets the same price, no sells during the window, buys can be sold back at the same price. Docs mention 30 min and a 5 min default, and the current API has fair launch **paused**. Starting mcap is configurable; docs conflict between $10k and $4k defaults.
- **Graduation:** none.
- **Fees:** 1% swap fee. Default 80% creator / 20% Progressive Bid Wall (auto-buyback limit orders in 0.1 ETH steps under spot). Protocol 0% by default; a FLAY governance fee switch allows up to 10%. Revenue rights are an NFT ("Memestream"), routable to managers.
- **Anti-sniper:** CAPTCHA plus per-wallet cap during the fair launch window; Game Mode gating.
- **Traction:** 30d fees $18k; all-time $3.6M. Small.
- **Notes:** a Solana-to-Base bridge for creator tokens is live (bridge.flaunch.gg, 2025-12-11), with no platform fee on bridged tokens. Docs do not name the bridge standard.
- **Sources:** docs.flaunch.gg/{features/fixed-price-fair-launch, features/creator-revenue, features/auto-buybacks, features/sniper-protection, getting-started/flaunch-a-coin, updates/11-december-..., updates/12-december-...}.md, plus a docs Q&A endpoint answer; defillama summary flaunch.

#### Zora coins
- **Chain:** Base. A separate "Zora Solana" deployment trades as plain DEX pairs with no curve (Codex).
- **Curve:** none. Uniswap v4 pools whose initial liquidity is placed by Doppler multicurve positions.
  - Creator coin: 1B supply, 500M vests to the creator over 5 years, paired with ZORA.
  - Content coin: 990M to the pool, 10M to the creator, paired with the creator coin.
  - Trend coin: 1B to the pool, 0.01% fee, all fees to protocol, unique tickers.
- **Graduation:** none.
- **Fees (v2.2.0+):** 1% total (3% before). Of the total: creator 50%, platform referral 20%, trade referral 4%, Doppler 1%, protocol 5%, LP remint 20% (re-added as out-of-range liquidity, effectively locked). All payouts are converted to ZORA via multi-hop swaps.
- **Anti-sniper:** since v2.5.0, a "sniper tax" falls linearly from 99% to the base fee over 10s; the creator's initial buy is exempt.
- **Traction:** collapsed. DefiLlama 30d fees $6.9k (Jul/Aug-25 about $2.4M per month; Sep-26 $10k).
- **Sources:** docs.zora.co/coins; docs.zora.co/coins/contracts/{rewards, architecture, hook-registry}; docs.zora.co/changelogs/coins; docs.codex.io/launchpads/zora-solana.md; defillama summary zora-coins.

#### Doppler (protocol used by Zora and others)
- **Chain:** Ethereum, Base, Arbitrum, Monad, Robinhood Chain and Solana (canonical list).
- **Curve:** price-discovery auctions. Static (v3 curve), Multicurve, and Dynamic (v4 Dutch-auction-style curve adjusted by demand and time). Proceeds seed and migrate to an AMM; Solana launches migrate to CPMM.
- **Fees:** protocol share (Zora shows "Doppler 1% of fees"). Fee rehypothecation hook available.
- **Sources:** docs.doppler.lol/core-concepts/price-discovery-auctions.md; docs.doppler.lol/reference/contract-addresses.md; docs.zora.co/coins/contracts/rewards.

#### Virtuals Protocol (agent tokens)
- **Chain:** bonding-curve contracts on Base and Robinhood Chain. VIRTUAL token on Base, Ethereum, Solana, Robinhood Chain and Arc. Solana launches are a paid module.
- **Curve:** agent token vs VIRTUAL bonding curve. Exact reserves are not published in current docs (legacy 1B supply). The launchpad is modular: 60 Days trial with refunds, pre-buy, Automated Capital Formation, fee delegation. "Genesis" (points-based) is described as an earlier experiment and "Unicorn" as a later model; current mechanics are not documented.
- **Graduation:** at 42,000 VIRTUAL liquidity, to Uniswap V2. LP tokens are locked for 10 years. "Hyperboost" streams idle supply to post-graduation traders over 14 days.
- **Fees:** 1% trading tax, 70% creator / 30% treasury. The tax is swapped to VIRTUAL/USDC and distributed once it reaches 1 VIRTUAL.
- **Anti-sniper:** optional tax falling from 99% to 1% over 0s, 60s, 10min or 98min (buy, sell or both). Proceeds fund buybacks over 24h, and the bought tokens vest to the team (3-month cliff, 9-month linear).
- **Traction:** 30d fees $381k; Jan-25 $16.6M peak; Oct-26 (partial) $0.19M.
- **Sources:** whitepaper.virtuals.io/about-virtuals/capital-formation-layer/{virtuals-launch-mechanics, anti-sniper-protection-for-token-launches}.md; whitepaper.virtuals.io/info-hub/virtuals-builder-and-agent-token-launch-faq.md; .../virtuals-protocol-contract-addresses.md; defillama summary virtuals-protocol.

#### Wow (wow.xyz), Base
- **Status:** apparently shut down. wow.xyz redirected to a domain-sale page (domains.atom.com) on 2026-10-22, and DefiLlama has no adapter. Historically a Zora-affiliated Base bonding curve that graduated to Uniswap v3 [unverified].

#### Ape.Store, Base
- **Mechanics:** bonding curve, then a DEX [unverified details]. Site still up.
- **Traction:** DefiLlama 30d fees $1,078, all-time $1.64M.

#### SunPump, Tron
- **Mechanics:** 1B supply, about 800M on the curve. Graduates at about $69,420 mcap to SunSwap V2 with liquidity burned. 20 TRX creation fee, 1% trade fee [all unverified: search summaries of TRON DAO FAQ and secondary guides].
- **Traction:** DefiLlama 30d fees $10.1k, all-time $6.5M.

#### Other chains (single-chain, small)
- **Monad:** Nad.fun V1, 30d $125k.
- **HyperEVM:** LiquidLaunch 30d $134; Alt Fun $4k.
- **Arc:** Argus World 30d $1.73M (largest there).
- **Abstract:** ZOO.FUN about $0.
- **TON:** GasPump $0 (30d), topblast $12k.
- **Sonic:** no launchpad adapter found.
- **Rho/Movement:** nothing found.
- **Source:** defillama overview.

---

### 4.2 Multichain and omnichain launchpads

Cross-chain designs found, sorted by how cross-chain actually works.

**A. Separate deployments per chain, no cross-chain token.** By far the most common, and the only model with real volume.
- **Flap.sh:** separate Portals and curve parameters per chain (BSC, Robinhood, Base, X Layer, Monad, Morph). A token lives on one chain. 30d $32.3M. Live.
- **o1 Launchpad** (o1.exchange): Base, Robinhood, Monad, Arc, BSC and X Layer.
  - Mechanics: no curve. The full 1B supply goes single-sided into a permanently locked Uniswap v4 position. 1% fee, split 50% creator / 30% platform / 20% referrer.
  - Anti-snipe: 99% falling to 1% over 20s, except on Arc.
  - Products: Tax and $O (wstO-burn) variants; stock-token pairs. Each chain has its own factory.
  - Traction: 30d $599k. Live.
- **NOXA Fun:** Monad, MegaETH, Intuition, Stable, Merlin, Arc and Robinhood.
  - Mechanics: single-sided Uniswap v3 LP at the 1% tier, locked forever. "Graduation" is only a milestone (e.g. 4.2 ETH on Robinhood/MegaETH, 100,000 MON). All fees go to creators; revenue is currently disabled.
  - Strategy: deploy first on new chains.
  - Traction: 30d $613k, Jul-26 $16.7M. Live.
- **Clanker:** factories on 6+ EVM chains, plus Meteora on Solana. Each deployment is its own token and pool. Live.
- **Doppler:** the same protocol on 5 EVM chains plus Solana. Live.
- **Virtuals:** curves on Base and Robinhood; VIRTUAL on 5 chains. Live.
- **Bags:** Solana (DBC) plus Robinhood (own v4 hook). Live.
- **Flaunch:** Base plus Robinhood. Live.
- **Zora:** Base plus a Solana deployment. Live, low volume.
- **Others:** Binance Alpha, PinkSale, Smithii, basedbid and sTONks list many chains on DefiLlama, but each launch is single-chain.

**B. One token bridged (burn/mint), with a separate curve on each chain.**
- **Printr** (app.printr.money): "Each chain gets its own bonding curve instance, pricing is independent per chain". Deployment is via LayerZero OFTs; moving holdings between chains is an OFT burn/mint, and cross-chain price gaps are left to arbitrage.
  - Chains: Solana, Base, BNB, Ethereum, Mantle, Arbitrum, Avalanche and Monad, with more listed (Unichain, HyperEVM, MegaETH, Plasma).
  - Solana side uses Meteora DBC. Fees on Solana: platform 0.4% + DBC up to 0.4% + custom up to 1.2% (max 2%). DefiLlama's methodology describes EVM curves at 1%, split 25% creator, 40% buyback, 10% team, 25% reserve.
  - Anti-vamp: ticker/image locked for 48h after $100k daily volume.
  - V2 shipped 2026-04-14.
  - Traction: **DefiLlama 30d fees $230; all-time $576k** (Apr-26 peak $0.48M). Live but near zero.
- **OFT Pad** (oftpad.fun): "one token, one coordinated supply" across Solana, Ethereum and Base (Arbitrum and BNB "soon") on LayerZero OFT. The site's token dashboard showed **0 tokens** live on 2026-10-22. No curve or pool described.
- **omni.fun:** 8 chains (Base, Arbitrum, Optimism, Polygon, BSC, Ethereum, Avalanche, Solana).
  - Token: OFT on LayerZero V2.
  - Trading: buys routed via deBridge DLN, sells via Across or deBridge.
  - Curve: linear (price = base + increment x sold). Graduates at $69k to Uniswap V3 with locked LP. 0.5% creator fee.
  - Status: the MCP README says this, but whether there is one home curve or one per chain is not stated. api.omni.fun did not resolve on 2026-10-22; Glama lists the MCP server as inactive. **Live status unverified.**

**C. One home market, reachable from other chains via intents or chain abstraction.** This is the "one token, one pool, tradeable from any chain" pattern. It already exists as infrastructure, not as a launchpad product.
- **deBridge DLN + Hooks:** cross-chain orders can attach an arbitrary destination-chain action (an EVM call or Solana instructions) executed when the order fills, e.g. "buy on the home chain's curve on behalf of the user". The 0-TVL design means a solver fronts the funds. Live; deBridge 30d fees $470k.
- **Particle UniversalX / Universal Accounts:** an ERC-4337 smart account plus EIP-7702 with a unified balance across EVM chains and Solana.
  - How a buy works: a filler pays for the trade on the destination chain and is repaid from the user's Universal Account. Swaps route via Jupiter, LI.FI or OKX.
  - Primary assets: ETH, USDC, USDT, BTC and SOL [unverified via search, partly confirmed in the whitepaper page]. Users can "trade any token on any chain, without bridging". Live.
- **NEAR Intents:** DefiLlama 30d fees $6.76M (bridge category). No launchpad built on it was found.
- **OneBalance, Socket/Bungee, Relay, Across:** same class [not opened; unverified].

**D. Token standards that let one supply span chains.**
| Standard | Model | Notes (from docs) |
|---|---|---|
| LayerZero OFT v2 | burn/mint (new tokens) or OFT Adapter lock/mint (existing tokens) | "single unified global supply". Used by Printr, OFT Pad, omni.fun |
| Wormhole NTT | hub-and-spoke (lock on hub) or burn-and-mint | per-chain rate limits plus a global accountant. **Sunrise** (since Nov 2025) uses NTT to make one canonical SPL mint per external asset (MON, PEPE, APE) [Sunrise details unverified: search summary] |
| Chainlink CCIP CCT | token pools, lock/release or burn/mint | per-lane rate limits. The Base-Solana bridge (live 2025-12-04) uses CCIP plus Coinbase co-verification |
| Hyperlane Warp Routes | collateral, synthetic or native; permissionless deploy | deployer picks ISMs; EVM plus SVM |
| Axelar ITS | same EVM address on all chains; Token Manager mint/burn or lock | flow limits; EVM, Sui, Stellar (Solana pages exist) |
| deBridge dePort | lock-and-mint deAssets, 1:1 backed | auto-deployed on first claim |
| SuperchainERC20 (IERC7802) | `crosschainMint/Burn` via SuperchainTokenBridge predeploy | used by ClankerToken, but **OP Stack interop is still "in active development"** per Optimism docs (2026-10-22), so it is not usable cross-chain today |

**E. Post-hoc bridging of a launched token.**
- Flaunch's Solana-to-Base bridge (live, standard undisclosed).
- Sunrise (NTT) for bringing outside tokens to Solana.
- Velodrome/Aerodrome "Superchain" token bridging [unverified; not opened].

**Sources (multichain section, all read 2026-10-22):**
- printr.gitbook.io/printr-docs/{cross-chain-features/omnichain-token-launching, cross-chain-features/cross-chain-swap-and-bridge, start-here/printr-vs-others, printr-v2-new-features/custom-fees, printr-v2-new-features/anti-vamp-protection}.md
- oftpad.fun
- github.com/0xzcov/omni-fun-mcp-server (README); glama.ai/mcp/servers/0xzcov/omni-fun-mcp-server
- docs.o1.exchange/launchpad/{introduction, how-it-works, create/token-creation}.md
- docs.noxa.fi/launchpad/{overview, chains}/
- docs.debridge.com/home/products/deport-overview.md; docs.debridge.com/dln-details/overview/deBridge-hooks.md
- whitepaper.particle.network/particle-network/abstraction-functionalities/universalx.md; developers.particle.network/universal-accounts/cha/overview
- wormhole.com/docs/products/token-transfers/native-token-transfers/overview/
- docs.layerzero.network/v2/concepts/applications/oft-standard
- docs.chain.link/ccip/concepts/cross-chain-token
- docs.hyperlane.xyz/docs/applications/warp-routes/overview
- docs.axelar.dev/dev/send-tokens/interchain-tokens/intro/
- docs.optimism.io/op-stack/interop/explainer
- theblock.co/post/381437/coinbase-ethereum-l2-base-bridge-solana (2025-12-04)
- docs.codex.io/launchpads/{zora-solana, baseapp}.md
- DefiLlama fees API (slugs printr, noxa-fun, o1-launchpad, flap-sh, NEAR Intents, deBridge)

**Not found:**
- A bonding curve that is literally shared across chains (one curve state, settled cross-chain).
- A Hyperlane-based launchpad.
- A "Solana + Base launch together" product other than Printr, OFT Pad and Clanker's dual Base/Solana paths.

---

### 4.3 Comparison table

Total fee = curve or launch-pool trade fee. Creator share = share of volume during the main phase. "Live?" uses DefiLlama 30d fees as of 2026-10-22.

| Name | Chains | Curve | Graduation | Total fee | Creator share | Anti-sniper | Live? (30d fees) |
|---|---|---|---|---|---|---|---|
| pump.fun | Solana | CP, virtual 30 SOL / 1.073B, 793.1M sold | ~85 SOL to PumpSwap, LP burned | 1.25% curve; 1.25% to 0.30% tiered | 0.30% curve; 0.95% to 0.05% after | none on-chain | yes ($62.9M; PumpSwap $116M) |
| bonk.fun | Solana | LaunchLab CP | 85 SOL to Raydium CPMM | ~1% [unverified] | platform-set | none | yes ($5.65M) |
| Raydium LaunchLab | Solana | CP/linear/fixed | ≥24 SOL (85 JustSendit) to CPMM | protocol + platform (≤5%) + creator (≤0.5%) | ≤0.5% | vesting only | yes ($7.08M) |
| StonkFun | Solana | LaunchLab | to CPMM | 1% platform + Raydium | yes (flywheel) | none found | yes ($16.8M) |
| Meteora DBC | Solana | multi-segment universal curve | quote threshold to DAMM v2, ≥10% locked | 0.25% to 99% configurable | partner/creator config | fee scheduler | yes ($3.32M) |
| Bags | Solana, Robinhood | DBC / CP 830M sold | to DAMM v2 / Uni v4, LP locked | 2% | 1% | fee modes | yes ($330k) |
| Believe | Solana | DBC | DAMM | n/a | n/a | n/a | no ($469) |
| Moonit (ex-Moonshot) | Solana | classic or flat | ~$75k to Raydium/Meteora | 1% | 80% of Meteora LP fees | flat curve, limits | barely ($33k) |
| Metaplex Genesis | Solana | curve / launch pool / auction | to Raydium CPMM, 20% LP 1y lock | 1.1% curve | 0.6% | pro-rata pools | yes ($177k) |
| four.meme | BNB | fixed 1B curve | ~18 BNB to PancakeSwap | 1% (+tax 1 to 10%) | via tax or OpenFour ≤1% | block-decaying fee (X Mode) | yes ($231k) |
| Flap.sh | BSC, Robinhood, Base, X Layer, Monad, Morph | (x+h)(y+r)=K, 800M sold | 16 BNB to v3 range (v2 for tax) | 1% (2.5% Morph) + tax | via tax | not found | yes ($32.3M) |
| Pons V2 | Robinhood | per-token curve, 5/7 sold | 4.2 ETH to Uni v4, locked | 1% + optional creator tax | creator tax | 99% to 0 in 3s | yes ($28.9M) |
| Pools.trade | Robinhood | none (single-sided v4) or CCA | none ($50k FDV cosmetic) | 0.25% pool | n/a in docs | CCA option | yes ($322k) |
| Clanker | Base, Arb, Uni, Eth, BNB, Monad, (Robinhood), Solana | none (single-sided v4) | none | 1.2% (creator 1% + 20%) | 1% | 80% to 5% over 30s, sniper auction | yes ($1.36M) |
| Flaunch | Base, Robinhood | none (v4 hook), fair launch paused | none | 1% | 80% default | captcha + wallet cap | barely ($18k) |
| Zora coins | Base (+Solana) | none (Doppler multicurve v4) | none | 1% (trend 0.01%) | 0.5% | 99% to 1% over 10s | barely ($6.9k) |
| Virtuals | Base, Robinhood (+Solana) | curve vs VIRTUAL | 42k VIRTUAL to Uni V2, 10y lock | 1% | 0.7% | 99% to 1% over 60s to 98min | yes ($381k) |
| o1 Launchpad | Base, Robinhood, Monad, Arc, BSC, X Layer | none (single-sided v4, full supply) | none | 1% | 0.5% | 99% to 1% over 20s | yes ($599k) |
| NOXA Fun | Monad, MegaETH, Intuition, Stable, Merlin, Arc, Robinhood | none (single-sided v3 1%) | milestone only | 1% pool fee | 100% of fees | not found | yes ($613k) |
| Printr | 8+ chains | separate DBC/curve per chain + OFT | to DEX per chain | up to 2% | default 25% of fees | anti-vamp only | near zero ($230) |
| OFT Pad | Solana, Eth, Base | n/a | n/a | n/a | n/a | n/a | 0 tokens |
| omni.fun | 8 chains | linear; OFT + DLN/Across | $69k to Uni V3 | n/a | 0.5% | n/a | unverified |
| SunPump | Tron | curve, 800M [unv.] | ~$69k to SunSwap V2 [unv.] | 1% [unv.] | n/a | n/a | barely ($10k) |
| Ape.Store | Base | curve [unv.] | [unv.] | [unv.] | [unv.] | [unv.] | barely ($1k) |
| Wow / Heaven / Boop | Base / Solana / Solana | | | | | | no |

---

### 4.4 What this means for a new multichain launchpad

- **No one has shipped a working "one token, one pool, any chain" launchpad.** Every multichain launchpad with real volume (Flap, o1, NOXA, Clanker, Bags, Virtuals, Doppler) is a set of separate per-chain deployments. The only OFT-based omnichain one with data, Printr, earns about $230 per 30 days. Its per-chain curves split liquidity and attention, and price differences are left to arbitrageurs.
  - Better design: one canonical curve or pool on a home chain, with buys from other chains through intents (deBridge DLN hooks, Across, NEAR Intents, a UniversalX-style smart account).
  - Make the token portable (OFT v2 / NTT / Hyperlane burn-mint) only after graduation, and never run two live curves.
- **Being first on a new chain beat being omnichain in 2026.** Robinhood Chain went from nothing to the largest launchpad fee pool within about two months: Pons V2 earned $132M in Sep-26 against pump.fun's $46M. Flap ($41.7M in Sep-26), NOXA and o1 won by deploying quickly to new chains. Keep the factory deployable per chain within days; chain-agnostic contracts plus per-chain parameters (Flap's r/h/K table) are the proven pattern.
- **About 1% is the market fee.** Creator share runs from 0.3% to 1%:
  - pump.fun 1.25% on the curve with 0.30% to the creator.
  - Virtuals 1% split 70/30.
  - o1 and Flaunch 1% (50% and 80% to the creator).
  - Clanker 1.2%; Bags 2%.
  - pump.fun's market-cap-tiered post-graduation fee (1.25% falling to 0.30%) is the most refined schedule. It is in production and published in its SDK, so it is easy to copy.
- **Anti-sniper protection has settled on a time-decaying surcharge**, not captchas:
  - Zora: 99% to 1% over 10s. o1: 99% to 1% over 20s. Pons: halving every ~0.2s over 3s. Clanker: 80% to 5% over 30s. four.meme: block by block. Virtuals: 60s to 98min, configurable.
  - Usually the creator's atomic dev buy is exempt, and Virtuals sends the surcharge to buybacks.
  - Freeze the schedule per launch at creation, as Pons ("curve snapshots factory settings"), o1 and Zora hooks do.
- **Prefer no-migration designs.** Clanker, Zora, o1, NOXA and Pools.trade put the full supply into a locked single-sided v3/v4 position at block one. Benefits:
  - There is no graduation transaction to exploit. Pump's 2024 $1.9M loss came from a privileged `withdraw` authority on the old migration path.
  - Aggregators, bridges and intent solvers can route to the token immediately, which matters for cross-chain buys.
  - If you keep a curve, make migration permissionless and idempotent (pump `migrate`, Pons two-step `graduate`) and burn or permanently lock the LP.
- **Fix the fee rights per launch and make them non-custodial.**
  - Raydium's 2026-08-17 upgrade moved the creator LP Fee Key to platforms for new migrations.
  - bonk.fun re-allocated 51% of fees to a corporate treasury in Dec 2025.
  - Believe faces a class action over fee capture and a 33% dilutive token migration.
  - Tokenized revenue rights (Flaunch Memestream NFT, Raydium Fee Key) and per-launch fee snapshots protect creators.
- **Activity moves fast, and buybacks did not keep platforms alive.** Believe, Boop, Heaven, Wow and Zora coins on Base all went to about zero. LetsBonk swung between 3% and 80% share within weeks. four.meme fell from $44M (Oct-25) to $0.2M (Sep-26). Plan on chain portability and white-labelling (LaunchLab platforms, DBC partner configs, OpenFour, o1's "launchpad of launchpads") rather than one flagship UI.
- **Quote-asset flexibility is a 2026 baseline.** USDC, USD1 or stablecoins (pump, four.meme, Flap), tokenized stocks (Pons, o1, four.meme bStocks, Bags), and launchpad-native quotes (pump coins as quotes, ZORA, VIRTUAL, wstO). A multichain design should treat the quote asset per chain as configurable, and use stable or bridged-canonical quotes if cross-chain buyers are expected.
- **Choosing a cross-chain token standard:**
  - OFT v2 and NTT both offer burn/mint plus rate limits, and NTT's global accountant caps supply drift.
  - SuperchainERC20, as used in ClankerToken, cannot move tokens yet because OP Stack interop is still in development.
  - On Solana, use one canonical mint (the Sunrise approach) to avoid duplicate wrapped tokens splitting liquidity.
  - Publish uniform events across chains. Indexers (Codex, Bitquery, DefiLlama) already cover per-chain launchpads and give listing and visibility on launch.

---

## 5. Cross-chain token standards and intent bridges

### 5.1 Key findings (TL;DR)

1. **Robinhood Chain 4663 is supported by** LayerZero v2 (EID 30416), Chainlink CCIP (lanes to Ethereum, Base and Solana, 20 tokens registered), Wormhole (chain id 72, core and Executor deployed), Hyperlane (domain 4663, core deployed, no warp routes registered yet), Relay, Across, deBridge, LI.FI, and Uniswap v4 (PoolManager deployed). It is **not** in Axelar's mainnet config. Superchain interop does not apply to it.
2. **LayerZero on Robinhood is unsafe if left on defaults, but that fails closed.** Read on-chain today, the default receive and send ULN config for every Robinhood pathway (ETH, Base, Solana) is the `LZDeadDVN`, so no message verifies. An OFT on 4663 must set its DVNs explicitly. After the KelpDAO exploit (Apr 2026, $292M, 1-of-1 DVN), LayerZero Labs stopped serving 1/1 configs and is moving defaults to 5/5 (3/3 minimum).
3. **CCIP fits a team that cannot write Solana programs best.** On Solana, Chainlink deploys and maintains the BurnMint and LockRelease pool programs, and a token team only initializes a pool (self-serve). EVM chains have a `TokenPoolFactory` (Robinhood included). Memecoins already use exactly the pattern we need: SPX6900 and NPC run lock-release on Ethereum with burn-mint on Robinhood, and VIRTUAL runs lock-release on Base with burn-mint on Solana and Robinhood. There is one catch: self-serve registration needs the token to expose `owner()` or `DEFAULT_ADMIN_ROLE` or `get/setCCIPAdmin`. A plain ERC-20 with no owner needs manual registration.
4. **"Same LP on different chains" exists in production only as one hub pool plus cross-chain order flow.** Intent routers already settle buys from Base and Solana into a single pool, in 1 to 21 s per today's live quotes. No live product found shares one AMM pool across EVM and Solana. Uniswap calls unified cross-L2 liquidity a roadmap item. Mirrored per-chain bonding curves exist (Printr: one curve per chain with supply partitioned), but they are separate prices bridged by arbitrage, not one LP.
5. **Recommendation:** stage 1 is a hub pool plus the existing Relay/LI.FI routes (zero new contracts). Stage 2 makes the token natively multichain with a CCIP CCT (lock-release hub, burn-mint spokes), or an OFT Adapter with at least 2 required independent DVNs. Stage 3 is optional thin per-chain pools kept in line by arbitrage. A Solana buyer in stage 1 receives the hub-chain ERC-20 at an EVM address, not an SPL token.

---

### 5.2 Part A: Cross-chain token standards

#### Support matrix

| Standard | Ethereum | Base | Robinhood 4663 | Solana | Model | Security | Cost / transfer (rough) | Incidents |
|---|---|---|---|---|---|---|---|---|
| LayerZero OFT v2 | Yes (EID 30101) | Yes (30184) | Yes (EID 30416; defaults = Dead DVN, must configure) | Yes (30168; own OFT program instance) | OFT burn/mint; OFT Adapter lock/unlock (one lockbox per mesh) | App-chosen DVN set X-of-Y-of-N + Executor | Measured ZRO OFT: Base->ETH 0.000632 ETH (~$1.54), ETH->Base 0.000204 ETH (~$0.50) + source gas | KelpDAO rsETH Apr 2026, $292M (1-of-1 DVN) |
| Wormhole NTT | Yes | Yes | Core + Executor deployed (chain id 72); NTT on 4663 not verified | Yes (NTT program deployed via NTT CLI) | Hub-and-spoke (lock on hub) or burn-and-mint | 19 Guardians, 13-of-19 VAA; NTT rate limits; Global Accountant; optional extra transceivers | Executor relay fee per route [unverified $] | Wormhole token bridge Feb 2022, ~$326M (Solana sig-verify bug); none found for NTT |
| Chainlink CCIP CCT | Yes | Yes | Yes (lanes to ETH/Base/Sol, TokenPoolFactory v2.0.0) | Yes (Chainlink-deployed pool programs, self-serve) | LockRelease / BurnMint pools, any combination | CCIP 2.0 Committee Verifier DON (16 operators) + RMN curse; per-lane token-bucket rate limits | Network fee $0.225-$1.50 (to ETH $1.35-1.50) + dest gas | None found for CCIP itself |
| Hyperlane Warp Route | Yes | Yes | Core deployed, no warp routes yet; default ISM 2-of-2 for 4663-origin msgs | Yes (compile and deploy own SVM warp programs) | Collateral (lock) / synthetic (mint) / native | Per-route ISM (multisig validators etc.) | IGP gas fee [unverified $] | None found for Hyperlane core |
| Axelar ITS | Yes | Yes | **No** (not in mainnet config) | Yes (ITS on svm) | Lock/unlock home + mint/burn remote; ITS Hub | Axelar PoS validator set | Gas service [unverified $] | None found |
| OP SuperchainERC20 | n/a (L1 not in interop) | Base moving off OP Stack (Feb 2026) | **No** (Arbitrum Orbit) | **No** | Burn/mint same address across OP chains | OP interop (in development) | n/a | n/a |
| Arbitrum canonical (Orbit) | Yes (L1 side) | No | Yes (canonical) | No | Lock on L1, mint StandardArbERC20 on L2 (different address) | Inherits Ethereum + fraud proofs | L1 gas; deposit ~10 min, withdraw ~7 days | none found |
| Across (intents) | Yes | Yes | Yes | Yes (bridge; no destination swaps on Solana routes) | Relayer fronts funds, settles later | Relayer + settlement layer | Measured 14 bps (Base->ETH token), $0.04 ETH Base->4663 | none found |
| Relay (intents) | Yes | Yes | Yes (tokenSupport "All") | Yes (tokenSupport "All") | Solver fronts funds; Depository + Allocator settlement | Non-upgradable Depository; Allocator signer; Security Council multisig | Measured 4-42 bps + DEX costs | none found |
| deBridge DLN (intents) | Yes | Yes | Yes | Yes | Solver fills limit order; unlock via deBridge messaging | deBridge validators for unlock | 0.015 SOL / 0.001 ETH flat + 4 bps + ~4 bps margin | none found in FAQ |

Sources for the matrix are in each section below.

#### LayerZero OFT v2 (EVM + Solana OFT program)

- **Model.** A native OFT burns on send and mints on receive. The **OFT Adapter** is a lockbox for an existing ERC-20 that "lack[s] mint capabilities". "There can only be one OFT Adapter lockbox in your omnichain deployment". Multiple adapters "can cause permanent token loss due to insufficient destination supply". `MintBurnOFTAdapter` is the exception that allows several. Fee-on-transfer and rebasing tokens are unsupported. There is an optional `RateLimiter` per destination. (docs.layerzero.network/v2/developers/evm/oft/adapter)
- **Solana.** The OFT Program supports "new or existing Fungible Tokens". Developers "should deploy their own instance of the OFT Program" so that they own the upgrade authority. Shared decimals default to 6 (u64 cap of about 18.4T tokens). Token-2022 support is partial. Sends to Solana must fund the recipient ATA rent (2,039,280 lamports = 0.00204 SOL) if the ATA is missing. Verified builds use `solana-verify`. The program code is not custom, but someone must build and deploy a Solana program. (docs.layerzero.network/v2/developers/solana/oft/overview and its .md)
- **Robinhood support (registry).** `robinhood-mainnet`: nativeChainId 4663, ARB_STACK, EID v2 **30416**, EndpointV2 `0x6f475642a6e85809b1c36fa62763669b1b48dd5b`, SendUln302 `0xc39161c7...`, ReceiveUln302 `0xe1844c5d...`. There are 19 DVN entries, including LayerZero Labs, Twinstake, Horizen, Paxos, Canary, Luganodes, P2P, Deutsche Telekom, BitGo, Nansen, Frax, Ondo, Superform, StablecoinX, ApeDVN and LZDeadDVN. (metadata.layerzero-api.com/v1/metadata/deployments)
- **On-chain default config (eth_call `getUlnConfig(0x…dEaD, eid)`, 2026-10-22):**
  - ETH receive from Robinhood: required = [LZDeadDVN], 5 confirmations.
  - Robinhood send to ETH: [LZDeadDVN], 5 confirmations.
  - Robinhood receive from ETH: [LZDeadDVN], 15 confirmations. From Base: [LZDeadDVN], 10. From Solana: [LZDeadDVN], 32.
  - For comparison, ETH receive from Base: 4 required DVNs (Horizen, LayerZero Labs, Canary, Twinstake), 10 confirmations.
  - So on 4663, nothing works until the OApp sets DVNs. That matches the docs: "Defaults are placeholder configurations… You should always set your DVN configuration explicitly". On some pathways "the network default is fully non-functional". (docs.layerzero.network/v2/concepts/modular-security/security-stack-dvns)
- **Security model.** Every required DVN must verify the payloadHash, and optional DVNs count toward a threshold. The OApp owner or delegate sets the config. The docs recommend at least one required DVN not run by LayerZero Labs.
- **Cost.** Measured `quoteSend` on the ZRO OFT (`0x6985884C…71cd`, 1 ZRO, empty options):
  - Base->Ethereum: 0.000632 ETH (about $1.54 at ETH $2,440.16, CoinGecko 2026-10-22).
  - Ethereum->Base: 0.000204 ETH (about $0.50), plus source gas.
  - Ethereum gas was 0.058 gwei at the time, so a ~150k-gas send costs about $0.02.
  - The fee scales with the number of DVNs and destination gas. Fee components are listed on the docs' transaction-pricing pages.
- **Latency.** Source confirmations plus DVN verification plus Executor. Robinhood's docs list LayerZero as "Minutes (varies with source-chain finality)".
- **Incident: KelpDAO rsETH, 2026-04-18.**
  - An attacker forged a packet "from Unichain", and a **single required DVN (1-of-1)** verified it. Kelp's Ethereum OFTAdapter `0x85d456B2…8Ef3` released 116,500 rsETH (~$292M).
  - A second packet for 40,000 rsETH was stopped when the pauser multisig paused 46 min after the drain. Blockaid recommends at least 2-of-N required DVNs and per-transaction caps. (blockaid.io blog)
  - LayerZero first blamed Kelp, then on 2026-05-09 said it "made a mistake". It attributed the attack to compromised internal RPC infrastructure of the LZ Labs DVN plus DDoS. Policy changes: "LayerZero Labs' DVN will no longer serve 1/1 DVN configurations", and defaults are moving to 5/5 where possible (3/3 minimum).
  - Kelp moved rsETH to CCIP, and Solv said it would move more than $700M to CCIP. (coindesk.com 2026-05-09)
  - A claim that ~47% of OApps were still 1-of-1 in May 2026 appears in one outlet only [unverified].

#### Wormhole NTT

- **Modes.** Hub-and-spoke "Locks tokens on a central 'hub' chain and mints equivalents on 'spoke' chains", which is "ideal for integrating existing tokens… without altering their original contracts". Burn-and-mint distributes supply across chains. Rate limits are set "per chain and period". The Global Accountant "Ensures the amount burned and transferred on chains never exceeds the amount… minted". Supports ERC-20 and SPL. (wormhole.com/docs/products/token-transfers/native-token-transfers/overview/)
- **Solana.** Deployed with the NTT CLI: `ntt init`, then `ntt add-chain … --program-key` with a ground keypair, then `ntt push`. Burn-and-mint "requires transferring the SPL token's minting authority to the Program Derived Address" (or an SPL multisig). Hub-and-spoke does not require it. This is still a Solana program deployment, done by CLI. (…/guides/deploy-to-solana/)
- **Security.** "19 distributed nodes called Guardians". "A quorum of 13 signatures is required". Ethereum and Solana are "secured by all 19 Guardians". Some chains can use a Delegated Guardian subset (example given: 7-of-9) whose quorum gates the 13/19 signature. The docs do not say whether Robinhood is delegated [unverified]. (wormhole.com/docs/protocol/infrastructure/guardians/)
- **Robinhood support.** Wormhole SDK constants list `[72, "Robinhood"]`, mainnet core `0x141fBa8AD5D61bdaB45A047cF60b5Ad9784987FB` and mainnet Executor `0xd19aAd5a69F7D35Cee169D9D90e1BbCB795ABB38`. There is no legacy Token Bridge entry for Robinhood. NTT on 4663 has not been seen deployed [unverified]. (github.com/wormhole-foundation/wormhole-sdk-ts core/base/src/constants/{chains.ts, contracts/core.ts, contracts/executor.ts})
- **Cost.** Executor relay quote per route; no figure collected [unverified].
- **Incident.** 2022-02-02, ~$326M: the Solana `verify_signatures` path "didn't correctly verify the address being provided" (sysvar spoof), so 120k wETH was minted unbacked. Backing was restored within 24 h. (rekt.news/wormhole-rekt) This hit the legacy token bridge, not NTT.

#### Chainlink CCIP Cross-Chain Token (CCT)

- **Model.** `BurnMintTokenPool` and `LockReleaseTokenPool` can be combined as burn/mint, lock/mint (hub-and-spoke), burn/unlock, or lock/unlock. On the lock chain there are "no other requirements" for the token. Mint and burn are required only where the token is minted. (docs.chain.link/ccip/concepts/cross-chain-token/overview)
- **Self-serve registration.** The Token Admin Registry uses a propose-then-accept flow. Self-serve requires `owner()` or `DEFAULT_ADMIN_ROLE` or `setCCIPAdmin()/getCCIPAdmin()`. "If none of these options is feasible, manual registration may be possible". This gates any IMD-deployed token: check whether it has an owner. Rate limits use token buckets per lane, in and out, with separate settings for Faster-Than-Finality (FTF) transfers. "If a limit isn't enabled, transfers are unlimited."
- **Solana (decisive for this team).** "Approach 1: Self-Serve Mode (Recommended)": "Chainlink Labs deploys and maintains the standard token pool programs (BurnMint and LockRelease) on Solana… You simply initialize your token pool from these existing deployed programs". BurnMint requires moving mint authority to the pool signer PDA. Registration requires signing as the mint authority. (docs.chain.link/ccip/concepts/cross-chain-token/svm/token-pools.md and integration-guide.md)
  - The CCIP config lists Solana pool programs `BurnMintTokenPool 41FGToCmdaWa1dgZLKFAjvmx6e6AjVTX7SVRibvsMGVB` and `LockReleaseTokenPool 8eqh8wppT9c5rw4ERqNCffvU6cNFJWff9WmkcYtmGiqC`.
  - So no Solana program needs to be built or deployed. Only an SPL mint is created and a pool initialized.
- **Robinhood support** (smartcontractkit/documentation `src/config/data/ccip/v1_2_0/mainnet/{chains,lanes,tokens}.json`):
  - `robinhood-mainnet`: selector `6180753054346818345`, router `0x06fC836c…Ae1c9`, TokenAdminRegistry `0x1912C3cF…37Ca`, TokenPoolFactory v2.0.0 `0x614B3678…06D9`, fee tokens LINK and WETH.
  - Lanes from Robinhood go to 11 chains, including mainnet, Base and Solana. Ethereum, Base and Solana each have a lane to Robinhood. OnRamp/OffRamp are v2.0.0.
  - 20 tokens are registered on Robinhood, all burnMint. Precedents:
    - **SPX** (mainnet lockRelease, robinhood burnMint)
    - **NPC** (mainnet lockRelease, Arbitrum and Robinhood burnMint)
    - **VIRTUAL** (Base lockRelease, Solana, Robinhood, BSC and Arc burnMint)
    - **USDUC** (Solana lockRelease, Robinhood and Hyperliquid burnMint)
  - Observed Robinhood->mainnet lane rate limiters for SPX, NPC, BWLK and LINK: `isEnabled:false`. Issuers often leave them off; we should not.
- **Security.** In CCIP 2.0, every lane has a default "Committee Verifier… A Chainlink DON of 16 independent node operators". "V2 pools can declare their own verifiers". The RMN contract can "curse" a chain or lane, which makes sends and executions revert. Messages "wait for full source-chain finality" unless FTF is opted into by both sender and issuer. (docs.chain.link/ccip/concepts/architecture/offchain/risk-management-network, …/key-concepts)
- **Cost** (docs.chain.link/ccip/billing). Network fee for token transfers, paid in LINK / other token:
  - ETH -> non-ETH: $0.45 / $0.50
  - ETH -> Solana: $0.54 / $0.60
  - non-ETH -> Solana: $0.315 / $0.35
  - non-ETH -> ETH: $1.35 / $1.50
  - non-ETH -> non-ETH: $0.225 / $0.25
  - Plus destination gas. Token pools may add a flat or bps fee.
- **Latency.** Finality-bound. Robinhood's docs say "Minutes". Typical Ethereum finality is ~13-15 min, and an Orbit L2 is final only when its batch is final on L1 [unverified].
- **No-code UI.** The "Token Manager" page now redirects to a "Tools Cheatsheet" (last updated 2026-07-20) with no Token Manager. The CCT path is Foundry/Hardhat kits plus the CLI/SDK. Treat no-code as unavailable [verify].
- **Incidents.** None found for CCIP. It was the destination of the post-Kelp migrations.

#### Hyperlane Warp Routes

- **Model.** Collateral "Locks ERC20 tokens as collateral on the source chain". Synthetic "Mints new ERC20 tokens on the destination". Native is also available. Routes are permissionless, "Each HWR may have a unique security configuration" (ISMs). (docs.hyperlane.xyz/docs/applications/warp-routes/overview)
- **Solana.** You build the SVM token programs (`./build-programs.sh token`, Solana CLI 3.0.14) and deploy them with your own keypair as owner. A synthetic route deploys a new Token-2022 mint. Per search snippets of that guide, EVM<->SVM routes "contact the Hyperlane team" [partly unverified]. (docs.hyperlane.xyz/docs/guides/warp-routes/svm/svm-warp-route-guide.md)
- **Robinhood.** `chains/robinhood`: chainId and domainId 4663, technicalStack arbitrumnitro, reorgPeriod 5. Mailbox `0x3a867fCf…2aa7`, plus ISM factories and an ICA router. The registry was last touched 2026-10-20. **0 of 1,012 `deployments/warp_routes` files mention robinhood.** (github.com/hyperlane-xyz/hyperlane-registry)
- **Default multisig ISM thresholds** (hyperlane-monorepo `typescript/sdk/src/consts/multisigIsm.ts`):
  - robinhood **2-of-2** (Abacus Works, Mitosis)
  - ethereum 6-of-9
  - base 3-of-5
  - solanamainnet 3-of-4
  - So messages originating on 4663 are verified by two parties unless the route sets a custom ISM.

#### Axelar Interchain Token Service (ITS)

- **Model.** You can create new Interchain Tokens or register existing ones with token managers. The ITS Hub on Axelar routes between chains. The ITS Portal is a no-code UI. Security is a "dynamic validator set". (docs.axelar.dev/dev/send-tokens/interchain-tokens/intro/)
- **Chains.** `axelar-chains-config/info/mainnet.json` lists 30 chains. Ethereum, Base and Solana (svm) have `InterchainTokenService`. **Robinhood is absent**, so Axelar is out for 4663.

#### Optimism Superchain ERC-20 / interop

- Official docs: "OP Stack interop is in active development. Some features may be experimental", and the interop cluster "is being rolled out iteratively". (docs.optimism.io/interop/explainer)
- Base announced in Feb 2026 that it is moving off the OP Stack to "its own unified stack". (thedefiant.io, 2026-02-20)
- SuperchainERC20 only covers OP-Stack chains: not Ethereum L1, not Robinhood (Orbit), not Solana. **Not applicable.**

#### Arbitrum canonical bridge for Robinhood Chain

- Robinhood docs (docs.robinhood.com/chain/bridging/) describe the canonical bridge as trustless:
  - Deposits take ~10 min (retryable tickets).
  - Withdrawals take ~7 days (challenge period) and are claimed on L1.
  - "a bridged ERC-20's contract address on Robinhood Chain differs from its address on Ethereum" (`calculateL2TokenAddress`).
- Other listed routes: LayerZero OFT/Stargate, CCIP/Transporter ("Minutes"), Relay and Across ("Seconds"), LiFi/0x.
- **Fragmentation warning.** If the token's home is Ethereum and it also gets a CCIP or OFT representation on 4663, there will be two non-fungible tokens on 4663. Pick one canonical representation per chain.

#### Base–Solana bridge (adjacent option)

- Launched 2025-12-04. Secured by CCIP plus Coinbase ("Coinbase and Chainlink node operators both verify messages"). (theblock.co/post/381437)
- The repo `base/bridge` can "Transfer tokens between Base and Solana… Deploy wrapped tokens on either chain". Base->Solana takes ~15 min, then prove and finalize steps. It was last pushed 2026-10-13.
- It covers only Base<->Solana, so it is useful only if Base becomes the home chain.

#### Intent bridges (Across, Relay, deBridge) and LI.FI

- **Relay.**
  - `api.relay.link/chains`: 59 chains. 4663 "Robinhood Chain" is enabled with `tokenSupport:"All"`, `depositAddressEnabled:true`, and v3/v3.2 router contracts. Solana 792703809 also has `tokenSupport:"All"`. There is also "Robinhood Lighter" (548123634).
  - Fees: $0.02 flat plus destination gas, swap costs (DEX fees and impact), and a platform fee of 0% bridge, 0.01% stablecoin, 0.06% major, 0.15% minor. (docs.relay.link/references/api/api_core_concepts/fees)
  - Cross-chain calls: `txs` on `/quote`, `EXACT_OUTPUT` for fixed-amount calls. `EXACT_INPUT` "usually needs an integrator-owned proxy contract". (docs.relay.link/.../calling-integration-guide)
  - Settlement uses a non-upgradable Depository that releases on Allocator signatures; the Allocator is changeable by a Security Council multisig. Audits: Certora (Jun 2025), Zellic (Nov 2025, Apr 2026). (per search snippet of docs.relay.link security and depository pages [partly unverified])
- **Across.**
  - `app.across.to/api/swap/chains`: 24 chains, including 4663 and Solana (34268394551451).
  - "fills most transfers in ~2 seconds". Origin swaps are automatic. Destination actions go through MulticallHandler (embedded actions, "Across+"). (docs.across.to/introduction/features)
  - Live API answer for Solana->ETH token: **"Destination swaps are not supported yet for routes involving Solana."**
- **deBridge DLN.**
  - `supported-chains-info`: 18 chains, including 4663 (Robinhood) and Solana (7565164).
  - Fees: flat "0.001 ETH on Ethereum, 0.015 SOL on Solana", 4 bps protocol fee, ~4 bps taker margin. "Most trades complete in under 2 minutes". "Hooks let you execute arbitrary contract calls alongside trades". (docs.debridge.com/home/resources/faq)
- **LI.FI.**
  - `li.quest/v1/chains`: 66 chains, including 4663 (key `out`) and Solana.
  - `POST /quote/contractCalls` (beta): bridge plus destination calls, fallback to `toFallbackAddress`. (docs.li.fi/api-reference/perform-multiple-contract-calls-across-blockchains-beta)

**Live quotes on 2026-10-22.** PEPE on Ethereum stands in for "an ERC-20 with a DEX pool". A thin new v4 pool would add large price impact. Sizes were about $100.

| Route | Provider | Quoted time | Fee (excl. pool impact) |
|---|---|---|---|
| 1 SOL -> ETH on 4663 | Relay | 1 s | $0.25 (24 bps) |
| 1 SOL -> PEPE on Ethereum | Relay | 4 s | $0.44 (42 bps) |
| 1 SOL -> PEPE on Ethereum | LI.FI (via Mayan) | 3 s | out $103.61 for $106.20 in (-2.4% all-in; LI.FI fee $0.27) |
| 1 SOL -> PEPE on Ethereum | deBridge | ~21 s (approximateFulfillmentDelay) | out $104.32 for $106.47 (-2.0%; flat 0.015 SOL ≈ $1.58 + 4 bps) |
| USDC (Solana) -> PEPE on Ethereum | Across | n/a | rejected: no destination swaps on Solana routes |
| 0.04 ETH Base -> PEPE on Ethereum | Relay | 3.5 s | $0.24 (25 bps) |
| 0.04 ETH Base -> PEPE on Ethereum | Across | 7 s | $0.137 (14 bps incl. swap impact) |
| 0.04 ETH Base -> ETH on 4663 | Relay / Across | 1 s / 1 s | $0.041 / $0.037 |

Gas snapshot (`eth_gasPrice`): Ethereum 0.058 gwei, Robinhood 0.020 gwei, Base 0.006 gwei. L2 totals also include the L1 data fee, and Ethereum gas is volatile.

#### Bridge security incidents (reference)

Amounts and dates are from rekt.news/leaderboard. Causes are from the cited post-mortems; causes from memory are marked.

| Incident | Date | Loss | Cause |
|---|---|---|---|
| Poly Network | 2021-08-10 | $611M | [cause unverified: keeper/role bug] |
| Wormhole | 2022-02-02 | $326M | Solana signature-verification account spoof (rekt.news/wormhole-rekt) |
| Ronin | 2022-03-23 | $624M | [unverified: 5-of-9 validator keys] |
| Harmony Horizon | 2022-06-23 | $100M | [unverified: 2-of-5 multisig keys] |
| Nomad | 2022-08-01 | $190M | "0x00 address was set as a trusted root"; copy-paste mass exploit (rekt.news/nomad-rekt) |
| BNB Bridge | 2022-10-06 | $586M | [unverified: proof verification bug] |
| Multichain | 2023-07-06 | $126.3M | [unverified: MPC keys controlled by CEO] |
| Orbit Bridge | 2023-12-31 | $81.5M | "compromised keys of signer-addresses on the… ETH Vault multisig" (assumed) (rekt.news/orbit-bridge-rekt) |
| Ronin II | 2024-08-07 | $12M | [unverified: misinitialized upgrade; whitehat] |
| Force Bridge | 2025-06-01 | $3.76M | compromised private key [search snippet; unverified] |
| Hyperbridge | 2026-04-13 | $2.5M | forged message / MMR leaf, then mint of 1B bridged DOT (1inch.com blog) |
| KelpDAO rsETH (LayerZero) | 2026-04-18 | $292M | 1-of-1 DVN compromised; OFTAdapter lockbox drained |
| Verus-Ethereum bridge | 2026-05 | ~$11.6M | "Missing source-amount validation" (1inch.com blog) |
| Gravity Bridge | 2026-05-29 | $5.4M | [cause unverified] |
| Aztec Bridge | 2026-06-17 | $2.2M | [cause unverified] |
| Symbiosis | 2026-09-11 | n/a | minting exploit [search snippet only; unverified] |

Pattern: losses concentrate where one key set or verifier can release a **lockbox**. Hub-and-spoke designs put the full float in one contract, so verifier diversity, rate limits and pausers matter most there.

---

---

## 6. How "the same LP on different chains" can really work

### 6.1 The three designs

#### (a) One hub pool + natively cross-chain token + intents that settle into the hub

**How it works.**
- One Uniswap v4 pool on one chain (the "hub") holds all liquidity and sets the only price.
- A buyer on Base or Solana signs one transaction on their chain. A solver fronts ETH on the hub, swaps in the hub pool, and delivers the token. The solver is repaid from the user's deposit on the origin chain.
- Sells run in reverse: swap on the hub, bridge out the proceeds.

**What is live today (verified above).**
- Relay: `tokenSupport:"All"` on Ethereum, 4663 and Solana. Quotes for Solana->ERC-20 on Ethereum return in 1-4 s.
- LI.FI via Mayan (3 s) and deBridge (~21 s) also route SOL -> ERC-20 on Ethereum.
- Across works for EVM origins (7 s with destination swap) but **not** for destination swaps on Solana routes.
- Uniswap's Trading API "Chained Actions" plans swap->bridge->swap, with "Solana chain is not supported". (developers.uniswap.org/…/chained-actions)
- For custom flows, explicit destination calls are available: Relay `txs`, LI.FI `contractCalls` (beta), deBridge hooks, Across embedded actions.

**Standard.** ERC-7683 is still **Draft**. The current draft standardizes a solver-facing "resolver" representation and does "not require protocols to use a common escrow, settlement contract, or fill function". Non-EVM support comes via ERC-7930 addresses and "sibling standards". It is a nice-to-have, not a dependency. (eips.ethereum.org/EIPS/eip-7683)

**Honest limits.**
- **Routing a brand-new token.** Aggregators and solvers must be able to find the v4 pool. A pool with a custom hook may not be indexed by Relay or LI.FI; that needs a live test per token.
  - Tested on 2026-10-22 (section 2.8): Relay routed from Base, Ethereum and Solana into IMD coins with IMD's PoolInitializationGuard and custom hooks, including a 5-hour-old coin no price site had indexed; LI.FI routed the indexed ones and not the new one.
  - Fallback is an explicit destination call. Relay `EXACT_OUTPUT` with `txs` = Universal Router `execute{value}` on a native-ETH/TOKEN v4 pool. Set the explicit recipient and min-out to the user.
  - `EXACT_INPUT` would need a proxy contract, which is a new contract.
- **MEV.** All trades hit one pool. On Ethereum L1 the solver's destination swap is a public transaction unless it is sent privately. Thin new pools are prime sandwich targets, so enforce tight `minAmountOut` and use private submission where possible.
  - Robinhood Chain (Arbitrum Nitro sequencer) has no public mempool, which limits classic sandwiches, but ordering and backrun MEV still exist [unverified for 4663 specifics].
- **What a Solana buyer receives.** The hub-chain ERC-20 at an **EVM address** (e.g. Phantom's EVM account), not an SPL token. To hold it on Solana you need stage 2.
- **Cost.** About 4-42 bps router fee, plus the pool fee (v4 fee tier or hook), plus price impact. deBridge's 0.015 SOL flat fee dominates small orders.
- **Risk.** In intent routes the solver takes the cross-chain risk: the user gets the fill or a refund. The settlement layer (Relay Allocator signer, Across settlement, deBridge validators) remains a trust point, but it does not custody the token float.

#### (b) Mirrored bonding curves on each chain with cross-chain state sync

**Live example: Printr.**
- "A Telecoin may have one curve per chain". The per-curve max supply is `maxTokenSupply / totalCurves`, and progress is measured per curve. "Telecoin supply and progress are distributed across multiple chains". (docs.mobula.io/almanac/robinhood-launchpads/printr)
- On Robinhood the protocol is `0xb77726291b125515d0a7affeea2b04f2ff243172`.
- It is "Built using the LayerZero and Axelar interoperability solutions". V2 is live on 8 chains (Solana, Base, BNB, Mantle, Ethereum, Monad, Avalanche, Arbitrum). V1 "had limited uptake". (theblock.co/post/397357)
- Printr's GitHub has a LayerZero-v2 fork, a Meteora-style "dynamic-bonding-curve" fork and deBridge API codegen. (api.github.com/orgs/printrfi/repos)
- So Printr **partitions** supply statically per chain rather than syncing one curve. Its exact sync and arbitrage mechanism is not publicly documented [unverified].

**Dangers (analysis).**
1. **Price divergence and arbitrage.** N curves give N prices. Arbitrageurs buy the cheap curve, bridge, and sell on the rich one. Profits go to bots, not holders, and the bridge becomes part of price discovery. Divergence is bounded by bridge fee plus latency risk, and it is large during launches.
2. **Message latency.** CCIP waits for finality (minutes). LayerZero needs source confirmations (Robinhood defaults are 5-32 blocks on top of DVN time). Any synced global variable (total sold, curve progress) is stale for that long.
3. **Supply double-spend.** With a shared global cap, two chains can sell the "last" tokens at the same time, so issuance exceeds the cap. The only safe options are a static partition (Printr) or a lock-reserve protocol, which adds latency and failure modes.
4. **Reorgs and fast-finality modes.** A curve that acts on a message from a block later reorged (FTF, low confirmations) has minted or sold unbacked tokens.
5. **Graduation race.** Two curves can cross the threshold at the same time. Moving the reserves (ETH on Base, SOL on Solana, different quote assets) into one DEX pool needs cross-chain transfers of the reserves themselves. Per-chain graduation means per-chain pools, which means fragmentation.
6. **Quote-asset mismatch.** A SOL-denominated curve and an ETH-denominated curve diverge whenever SOL/ETH moves, even with no trading.
7. **Security surface.** Every curve contract trusts the messaging layer. A Kelp-style forged message could mint or release on the weakest chain.
8. **Team constraint.** This needs custom contracts on every chain plus a Solana program. That rules it out for this team.

#### (c) Shared-liquidity layers: what is live vs theory

| Layer | What it is | Live? | Usable for a new IMD token across ETH/Base/4663/Solana? |
|---|---|---|---|
| Stargate v1 Delta / v2 Hydra | Unified asset pools (Delta); v2 Hydra locks in a pool chain and mints USDC.e/USDT/WETH on Hydra chains (stargateprotocol.gitbook.io) | Live | No. Only listed assets (USDC, USDT, WETH). It is a bridge-liquidity design, not a token AMM. |
| Uniswap v4 cross-chain hooks / unified L2 liquidity | UF roadmap (2025-05-14): "sets the stage for unified liquidity… across L2s"; hooks "can be scaled to other chains" (uniswapfoundation.org) | Theory / roadmap | No. v4 pools are per chain (v4 is on 4663). |
| Uniswap Trading API Chained Actions | Swap -> bridge -> swap plan across chains | Live | EVM only ("Solana chain is not supported"). |
| UniswapX cross-chain | Filler-based cross-chain orders | Same-chain UniswapX live on several chains (June 2026 changelog via search); cross-chain status [unverified] | Not relied upon |
| Superchain interop | Native OP-chain messaging and SuperchainERC20 | "In active development"; Base leaving OP Stack | No (no L1, Orbit or Solana) |
| Agglayer (Polygon) | Unified bridge, pessimistic proofs, "Assets maintain their identity across connected chains" (docs.polygon.technology/interoperability/agglayer) | Live for CDK/connected chains | No (Base, 4663 and Solana not listed) |
| Everclear (ex-Connext) | Netting and clearing of solver settlements (docs.everclear.org) | Live per its docs (mainnet status not stated on page) | Indirect only: lowers solver costs for major assets |
| THORChain | Native-asset AMM; EVM tokens must be whitelisted per chain via merge request; "Solana (coming soon)" for whitelisting (dev.thorchain.org) | Live | No (permissioned listing) |
| Chainflip | Native-asset cross-chain AMM [unverified: governance-listed assets only] | Live [unverified] | No |
| Orderly | "common orderbook" across chains; "primary product is… perpetual futures" (orderly.network docs) | Live | No (perps); it is a hub model, like (a) |
| Base–Solana bridge | CCIP + Coinbase verified; wrapped tokens either side | Live (Dec 2025) | Only if home = Base |
| Mitosis, Hyperunit, Polymer, Espresso, Wormhole Queries, Hyperlane Nexus, Socket/Eco/Euler unified liquidity | Liquidity orchestration, asset tokenization, cross-chain proofs, shared sequencing/confirmations, cross-chain reads, bridge UI | [unverified: not opened] | No shared EVM+Solana AMM pool for an arbitrary new token was found in any of them |
| Clanker / Zora multichain | [unverified: not researched in depth] | n/a | n/a |

Bottom line for (c): as of 2026-10-22 there is no production "omnichain AMM" in which one pool serves both EVM and Solana for an arbitrary new token. Everything live is either (a) a hub venue plus cross-chain order flow, or bridge liquidity for blue-chip assets.

---

### 6.2 Recommendation (small team, no Solana programs, EVM contracts deployed by IMD swarm)

**Architecture: (a), one hub pool.** The "same LP on different chains" claim should be shown in the UI as **"one pool, buy from any chain"**, not as pools on every chain.

**Hub choice.** Keep the hub where IMD deploys the token and the v4 pool: Ethereum, or Robinhood 4663, where Uniswap v4 PoolManager is `0x8366a39c…0951`.
- Ethereum has the widest solver and aggregator coverage, but carries public-mempool sandwich risk.
- 4663 is cheaper and has no public mempool, and all four routers support it. It has thinner solver inventory.

#### Stage 1: zero new contracts (now)

- Buy and sell from Base, Solana and Ethereum through Relay (primary) and LI.FI (fallback). Both are already integrated.
- Before listing each token, run a live quote test that the router can price the specific v4 pool (hooked pools may not be indexed). If routing fails, show "buy on hub chain only" rather than a broken quote.
- Solana and Base buyers must provide an EVM recipient on the hub chain. Display this clearly: "you receive the token on Ethereum/Robinhood at 0x…".
- Expected per route: 1-7 s (Relay/Across/LI.FI), ~21 s (deBridge). Fees are about 4-42 bps plus the pool fee plus impact, and gas on the hub is currently cents.
- MEV controls: strict min-out (no default 5% slippage), show price impact, and on Ethereum prefer routes that submit privately.

#### Stage 2: holders on other chains get the same token (OFT/NTT/CCT adapter)

**Preferred: CCIP CCT.**
- Hub: `LockReleaseTokenPool` (no change to the IMD token).
- Spokes on Base and 4663: a `BurnMintERC20` plus `BurnMintTokenPool`, deployed by IMD through the chain's TokenPoolFactory.
- Solana: create an SPL mint, then **self-serve** initialize a pool from Chainlink's deployed BurnMint program. Mint authority goes to the pool PDA, so no Solana program is written or deployed.
- Enable per-lane rate limits, sized to a fraction of hub float per hour.
- Cost: $0.25-$1.50 network fee plus destination gas. Latency is minutes (finality-bound).
- Precedents on 4663: SPX, NPC and VIRTUAL.
- Gate: the IMD token must expose `owner()`, `DEFAULT_ADMIN_ROLE` or `getCCIPAdmin()`, otherwise registration is manual or assisted. Check this before committing.
- For IMD coins specifically: a `custom_token` has no owner by IMD's rule, so it cannot self-register. A `univ4_hook` launch with `customToken: true` could add a `getCCIPAdmin()` view naming the creator (an admin of the CCIP registration only, with no power over balances); whether IMD's `own_token` check accepts it has not been tested [unverified].

**Alternative: LayerZero OFT Adapter on the hub plus native OFTs on spokes.**
- Pros: permissionless, and works for ownerless tokens.
- Cons on 4663:
  - Defaults are the Dead DVN, so you must set at least 2 independent required DVNs on both sides of every pathway, plus block confirmations.
  - Solana needs your own OFT program instance (build, deploy, verify), which conflicts with "no Solana programs" unless a vendor deploys it.
  - The single-lockbox rule: exactly one adapter.

**Alternative: Wormhole NTT hub-and-spoke (locking on hub).**
- Pros: Global Accountant and rate limits.
- Cons: the NTT CLI deploys a Solana program, and NTT on 4663 is unverified.

**Rules for any choice.**
- Exactly one cross-chain standard and one lockbox per token.
- Never mix it with the Arbitrum canonical `StandardArbERC20` on 4663. That would create a second, non-fungible "same" token.
- Pausers held by a multisig, and monitoring for messages whose source transaction does not exist (Blockaid's Kelp lesson).

**What a Solana holder gets now:** an SPL token, the CCIP or OFT representation. It has **no Solana liquidity**. Selling means bridging back (minutes) and swapping in the hub pool, or a router that can chain both.

#### Stage 3 (optional): per-chain pools rebalanced by arbitrage

- Seed small pools: a Uniswap v4 pool on Base or 4663 for the spoke representation, and a permissionless Solana CPMM/DLMM pool (Raydium/Meteora UI) for the SPL. Creating these needs no program code [unverified for specific UIs].
- Arbitrage bots, or a NIGHTSHIFT keeper, move inventory over the CCT/OFT lane. Price bands are roughly the bridge fee plus the spread needed to cover minutes of latency.
- This is no longer "one LP". Liquidity fragments, and a bridge pause or curse de-pegs spokes from the hub. Present spoke pools as secondary venues; the hub stays the reference price.

#### Honest summary of limits

| Item | Stage 1 (hub + intents) | Stage 2 (CCT/OFT) | Stage 3 (per-chain pools) |
|---|---|---|---|
| Latency | 1-7 s (Relay/Across/LI.FI), ~21 s deBridge | Minutes (CCIP finality; LZ confirmations + DVNs) | Trade instant locally; rebalancing takes minutes |
| Fees | 4-42 bps router + pool fee + impact; deBridge flat 0.015 SOL | $0.25-$1.50 CCIP (LZ example $0.50-$1.54) + gas | Pool fee per chain + arbitrage spread |
| MEV | Single hub pool is the sandwich target; enforce min-out | n/a | Cross-pool arbitrage extracts value |
| Bridge/verifier risk | Solver and settlement layer; no token float at risk | Lockbox holds the float: verifier diversity + rate limits mandatory | Same as stage 2, plus pool de-peg on outage |
| Solana buyer receives | ERC-20 on hub chain at an EVM address | SPL representation (no local liquidity) | SPL with local pool |
| New contracts | None | Pools and spoke tokens (EVM, by IMD); Solana pool init only (CCIP) | None beyond pools |

---

### 6.3 Sources for sections 5 and 6 (all opened 2026-10-22)

Registries, APIs, on-chain:
- https://metadata.layerzero-api.com/v1/metadata/deployments
- https://raw.githubusercontent.com/hyperlane-xyz/hyperlane-registry/main/chains/robinhood/metadata.yaml
- https://raw.githubusercontent.com/hyperlane-xyz/hyperlane-registry/main/chains/robinhood/addresses.yaml
- https://api.github.com/repos/hyperlane-xyz/hyperlane-registry/git/trees/main?recursive=1
- https://raw.githubusercontent.com/hyperlane-xyz/hyperlane-monorepo/main/typescript/sdk/src/consts/multisigIsm.ts
- https://raw.githubusercontent.com/smartcontractkit/documentation/main/src/config/data/ccip/v1_2_0/mainnet/chains.json (also lanes.json, tokens.json)
- https://raw.githubusercontent.com/wormhole-foundation/wormhole-sdk-ts/main/core/base/src/constants/chains.ts (also contracts/core.ts, contracts/executor.ts)
- https://raw.githubusercontent.com/axelarnetwork/axelar-contract-deployments/main/axelar-chains-config/info/mainnet.json
- https://api.relay.link/chains and POST https://api.relay.link/quote
- https://app.across.to/api/swap/chains and https://app.across.to/api/swap/approval
- https://dln.debridge.finance/v1.0/supported-chains-info and https://dln.debridge.finance/v1.0/dln/order/create-tx
- https://li.quest/v1/chains and https://li.quest/v1/quote
- https://api.coingecko.com/api/v3/simple/price?ids=ethereum,solana&vs_currencies=usd
- eth_call/eth_gasPrice via https://ethereum-rpc.publicnode.com, https://mainnet.base.org, https://rpc.mainnet.chain.robinhood.com (OFT `quoteSend` on ZRO; ULN302 `getUlnConfig`)
- https://developers.uniswap.org/llms.mdx/docs/protocols/v4/deployments

Docs:
- https://docs.layerzero.network/v2/developers/evm/oft/adapter
- https://docs.layerzero.network/v2/developers/solana/oft/overview (+ .md)
- https://docs.layerzero.network/v2/concepts/modular-security/security-stack-dvns
- https://wormhole.com/docs/products/token-transfers/native-token-transfers/overview/
- https://wormhole.com/docs/products/token-transfers/native-token-transfers/guides/deploy-to-solana/
- https://wormhole.com/docs/protocol/infrastructure/guardians/
- https://docs.chain.link/ccip/concepts/cross-chain-token/overview (+ .md)
- https://docs.chain.link/ccip/billing
- https://docs.chain.link/ccip/concepts/architecture/offchain/risk-management-network
- https://docs.chain.link/ccip/concepts/architecture/key-concepts
- https://docs.chain.link/ccip/concepts/cross-chain-token/svm/integration-guide.md
- https://docs.chain.link/ccip/concepts/cross-chain-token/svm/token-pools.md
- https://docs.chain.link/ccip/tools-resources/token-manager.md (redirects to the Tools Cheatsheet)
- https://docs.hyperlane.xyz/docs/applications/warp-routes/overview
- https://docs.hyperlane.xyz/docs/guides/warp-routes/svm/svm-warp-route-guide.md
- https://docs.axelar.dev/dev/send-tokens/interchain-tokens/intro/
- https://docs.optimism.io/interop/explainer
- https://docs.robinhood.com/chain/bridging/
- https://docs.across.to/introduction/features
- https://docs.relay.link/references/api/api_core_concepts/fees
- https://docs.relay.link/references/api/api_guides/calling-integration-guide
- https://docs.debridge.com/home/architecture/fees-overview
- https://docs.debridge.com/home/resources/faq
- https://docs.li.fi/api-reference/perform-multiple-contract-calls-across-blockchains-beta
- https://eips.ethereum.org/EIPS/eip-7683
- https://developers.uniswap.org/llms.mdx/docs/trading/swapping-api/concepts/chained-actions
- https://uniswapfoundation.org/blog/a-roadmap-for-programmable-liquidity
- https://stargateprotocol.gitbook.io/stargate/v2-user-docs/whats-new-in-stargate-v2/hydra
- https://stargateprotocol.gitbook.io/stargate
- https://docs.everclear.org/
- https://docs.polygon.technology/interoperability/agglayer
- https://dev.thorchain.org/chain-clients/token-lists.html
- https://orderly.network/docs/introduction/getting-started/what-is-orderly
- https://docs.mobula.io/almanac/robinhood-launchpads/printr
- https://api.github.com/orgs/printrfi/repos
- https://raw.githubusercontent.com/PrintrFi/printr-mcp/main/README.md
- https://raw.githubusercontent.com/base/bridge/main/README.md

Post-mortems / news:
- https://blockaid.io/blog/how-a-single-layerzero-dvn-compromise-drained-292m-from-kelpdao
- https://www.coindesk.com/tech/2026/05/09/layerzero-says-it-made-a-mistake-in-usd292-million-kelp-exploit
- https://1inch.com/blog/post/the-biggest-bridge-hacks-in-2026
- https://rekt.news/leaderboard/
- https://rekt.news/wormhole-rekt
- https://rekt.news/nomad-rekt
- https://rekt.news/orbit-bridge-rekt
- https://www.theblock.co/post/397357/omnichain-token-launchpad-printr-rolls-out-v2-aiming-for-greater-flexibility
- https://www.theblock.co/post/381437/coinbase-ethereum-l2-base-bridge-solana
- https://thedefiant.io/newsletter/defi-daily/base-shift-raises-questions-for-optimism

Not opened (search snippets only, treated as [unverified]): VaasBlock (47% of OApps on 1-of-1), Force Bridge root cause, Symbiosis 2026-09-11, Relay security and depository pages, Hyperlane EVM-SVM "contact team" note, UniswapX June 2026 changelog, Chainflip listing rules.

---

## 7. Sources for sections 1 to 3 (all opened 2026-10-22)

IMD, read directly:
- https://api.imd.fun/requests/capabilities (saved as `apps/engine/src/fixtures/launchpad/imd-capabilities.json`)
- https://api.imd.fun/launch/policies (42 policies)
- https://api.imd.fun/launches?limit=500 and `&before=` (all pages, 897 launches)
- https://api.imd.fun/launches/:id for #778, #782, #944, #945, #1104, #1233, #1870, #2093, #2109, #2124, #2303, #2321, #2444, #2445, #2448
- https://api.imd.fun/jobs/:id (the jobs of #2444 and #2445, one job executing and one blocked on 2026-10-22) and https://api.imd.fun/jobs?limit=60
- https://api.imd.fun/intake/1/0x2664eb3828e71b05ccaf7abacd97a2c243c21806cff2012e9c01e5dedbf02d47 and https://api.imd.fun/requests/paid-by/0x6c4c78f2c3bdf4c4318fe305fb1c8bc1694d19b5
- POST https://api.imd.fun/requests/check: every body in `docs/launchpad/checks/`
- https://imd.fun/docs/llms.txt (control plane `a26ee00d`) and https://api.imd.fun/openapi.json
- https://explorer.imd.fun/launch and its bundle `/_next/static/chunks/2q0lcdiqao7o_.js` (the Coin form's rules and body), https://explorer.imd.fun/tokens
- https://raw.githubusercontent.com/identity-md-launches/launch-1233-deploy-repository-ethereum-mainnet/HEAD/README.md (Keel)

On chain (public RPCs ethereum-rpc.publicnode.com and rpc.mainnet.chain.robinhood.com):
- ZTOAdapter `0x68d443f4…6378` on Ethereum: `peers(30416)`, `owner()`, `token()`, and ZTO `balanceOf(adapter)`
- ZeroToOne `0xb7c3ab13…0517` on Robinhood Chain: `peers(30101)`, `totalSupply()`, `owner()`
- KeelFactory `0x39dfa7d3…9f5f`: `paused()`; PvPPad `0xb2c3ad3a…a16c`: code size

Markets and routes:
- https://api.dexscreener.com/tokens/v1/ethereum/… and /robinhood/… (all 413 live coin tokens), https://api.dexscreener.com/latest/dex/search
- https://api.geckoterminal.com/api/v2/networks/eth/pools/:pool/ohlcv/hour and /networks (Robinhood Chain is `robinhood`)
- https://li.quest/v1/quote and POST https://api.relay.link/quote, for the routes in section 2.8
