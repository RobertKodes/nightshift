# NIGHTSHIFT Omni: one coin on Solana and Ethereum, built by the swarm

Study of 2026-10-22. Earlier work it builds on: [RESEARCH.md](RESEARCH.md), [DESIGN.md](DESIGN.md). IMD's free check answers for every order below: [checks/omni-*.json](checks/). Code: `apps/engine/src/order-omni.ts` (the orders), `apps/engine/src/omni.ts` (read-only pump.fun status endpoint, `GET /api/omni/pump?mint=`), `apps/engine/scripts/omni-check.ts` (sends the orders to IMD's free check).

**How to read the evidence.** Everything marked *verified* was opened or read from Solana mainnet on 2026-10-22. **[unverified]** means from memory, a search summary, or a page that did not load. Prices: SOL $103.82, ETH $2,377 (CoinGecko, 2026-10-22), IMD about $5.4 (2026-10-17 snapshot, not refreshed).

---

## 0. Summary for the owner

**What you asked:** make a coin on pump.fun, and have the swarm connect "2 LPs into one": Solana, Ethereum and IMD, deeply connected.

**What is possible**

1. **One coin, one supply, on two chains: yes.** A pump.fun coin can be made cross-chain after the fact, because pump.fun revokes the mint and freeze authority at creation (checked on chain on a new coin and a graduated coin). A bridge in "locking" mode on Solana (Wormhole NTT) locks the Solana coin and mints the same amount on Ethereum or Robinhood Chain. Total supply never grows.
2. **One LP, for real: yes, but it is PumpSwap.** When a pump.fun coin graduates, its liquidity moves into a PumpSwap pool on Solana and the LP tokens are burned (the LP mint's supply was 0 on the coin I read). That liquidity cannot move to Ethereum. So the only honest "one LP" is: **PumpSwap stays the one deep pool, and every other chain buys into it.** This works today for graduated coins: a 0.01 ETH quote from Ethereum into a graduated pump.fun coin on Solana came back through LI.FI in an estimated 1 second at 1.5% all-in cost.
3. **A second pool on Ethereum or Robinhood (the IMD swarm's part): yes, as a twin, not as the same LP.** A Uniswap v4 pool on the EVM side can exist, built with a hook, seeded with coins bridged from Solana. It holds its own liquidity. Two pools are never one pool. They stay near the same price because arbitrage bots trade both, and the gap you should expect is about 2% to 5%, not zero.

**What is not possible:** one pool that trades on Solana and Ethereum at once (no such live product exists, checked again today); moving PumpSwap's burned LP; IMD launching the pump.fun coin itself (IMD deploys EVM contracts only); IMD's own hook launch for a bridged coin (it always creates its own token and refuses minting after launch, so the swarm builds the pool from `evm_contracts` orders instead); a trustless view of PumpSwap's price inside an EVM contract without a guardian-signed proof or a signer.

**The recommended architecture, as a flow**

```
Creator's Solana wallet --create_v2--> pump.fun curve (Solana) --graduates--> PumpSwap pool (LP burned)   <== the ONE LP
        |                                                                          ^
        | (after graduation, optional upgrade)                                     | buys from ETH/Base/Robinhood via LI.FI/Relay (already in our swap)
        v
  Wormhole NTT: Solana = hub (locks the coin), Ethereum/Robinhood = spoke (mints what is locked)
        |
        v
  EVM twin pool: Uniswap v4 + OmniPoolHook (0.25% to the FeeSplitter, gap fee, opens only after a guardian-signed proof of graduation)
        ^
        | arbitrage keepers (inventory on both sides; 20% of profit; bounded vault) keep both pools within ~2-5%
```

**Costs** (estimates marked; Solana at $103.82)

| Step | Who pays | Cost |
|---|---|---|
| Create on pump.fun | creator | no creation fee (PumpPortal docs); account rent about 0.003 SOL; optional dev buy pays pump's 1% protocol fee |
| Route buyers from EVM into PumpSwap | buyer | measured 1.5% on $24 (fees, price impact, bridge); NIGHTSHIFT swap fee on top as today |
| NTT program on Solana (per coin) | creator | one program per token; deposit **about 4 SOL, about $400** [unverified: LayerZero documents about 3.9 SOL for its Solana program; Wormhole gives no figure]. Most of a failed or closed deployment's buffer rent comes back |
| NTT contracts on the EVM chain | creator | NttManager + transceiver by CLI; gas only (cents on Robinhood; Ethereum was cents at 0.06 gwei on 2026-10-17, may differ) |
| IMD orders (spoke token, hook, gate, vault, keeper job) | creator | 5 orders x 0.5 IMD = 2.5 IMD, about $14, plus the paying transactions' gas; IMD pays deployment gas |
| Seeding the EVM pool | creator | the coins and ETH the creator chooses; there is no IMD single-sided seed here |

**Risks, in plain words**

- A bridge holds the locked supply. If the bridge is broken, the EVM coin is unbacked (Kelp lost $292M in April 2026 with a single verifier). Wormhole NTT's verifier is 13 of 19 guardians; rate limits cap the damage; a second verifier is not available everywhere [unverified]. Never lock more than you can lose, and keep rate limits low.
- **The Solana NTT program costs about $400 per coin.** That is more than most pump.fun coins' liquidity (the graduated coin I read had 82.8 SOL, about $8,600, in PumpSwap). The EVM upgrade only makes sense for a coin that has traction.
- A thin EVM twin pool is a sandwich target and its arbitrage profit is tiny: on a $5k pool a 3% gap pays a keeper about $0.09 per sync (section 3). Do not promise holders a tight peg.
- Terms: pump.fun's terms page text did not load, so what a third-party site may do is **[unverified]**. Their program docs are public (pump-fun/pump-public-docs), and PumpPortal already sells this same service; get the terms read before launch.
- pump.fun may itself go multichain (a May 2026 report says it lets users trade on Ethereum, Base and BNB with SOL; no official source found; its API already has a `multichain_family` field). That could overlap with this.

**Exact steps to start (nothing needs to be paid to do the first two)**

1. Today, no cost: ship **Stage A** (section 5): create-on-pump.fun and a token page that shows the curve, the graduation and PumpSwap's price (the status endpoint is built), and a "Buy from any chain" button that uses LI.FI into PumpSwap.
2. Decide the section 7 questions.
3. When a graduated coin is worth it, run **Stage B** in this order: (a) pay the spoke token order, (b) run the NTT CLI (section 2.3), (c) set the minter and seal, (d) pay the hook, gate, vault and keeper orders, (e) seed the pool. Every order is already written and passes IMD's free check with 0 blockers.

---

## 1. pump.fun today

### 1.1 Creating a coin programmatically

- **Program:** pump program `6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P`; PumpSwap `pAMMBay6oceH9fJKBRHGP5D4bD4sWpmSwMn52FMfXEA`. Both are the same on mainnet and devnet. Source: [pump-public-docs, PUMP_PROGRAM_README and PUMP_SWAP_README](https://github.com/pump-fun/pump-public-docs), read 2026-10-22.
- **Instruction:** `create_v2` (the docs list only this one; "`create_v2` rejects `is_cashback_enabled = true`, so no new cashback coins can be created"). Accounts include the new `mint` (a signer), `user` ("transaction signer and payer"), the bonding curve and its token account, the Token-2022 program, and the Mayhem program accounts. Optional trailing arguments: `is_mayhem_mode`, `is_holder_reward`. Source: [COIN_CREATION.md](https://raw.githubusercontent.com/pump-fun/pump-public-docs/main/docs/instructions/COIN_CREATION.md), 2026-10-22.
- **Coin facts (verified on chain, 2026-10-22):** Token-2022, 6 decimals, 1,000,000,000 supply (curve account `token_total_supply` = 10^15 raw), extensions only `metadataPointer` and `tokenMetadata` (so no transfer fee and no transfer hook), `updateAuthority` null (name, symbol and URI are frozen), `mintAuthority` null and `freezeAuthority` null. On a coin still on its curve and on a graduated coin. Name 32 characters, symbol 13, URI 200 (docs).
- **Mayhem mode doubles the on-chain supply** (2,000,000,000 on the mayhem coin I read). Do not use it for an omni coin: the EVM cap is 1,000,000,000.
- **Two routes to build the transaction:** (1) build `create_v2` ourselves from the public docs and IDL in the browser, (2) PumpPortal's local-transaction API: `POST https://pumpportal.fun/api/trade-local` with `action: "create"`, `tokenMetadata {name, symbol, uri}`, `mint` (a fresh keypair's public key), dev-buy `amount`, `pool: "pump"`; it returns a serialized transaction to sign with the mint keypair and the creator's wallet. "There is no additional fee for token creation." Metadata must be uploaded to IPFS first: "Pump.fun no longer allows direct metadata uploads to their API." Source: [pumpportal.fun/creation](https://pumpportal.fun/creation), 2026-10-22. If route 2 is used, the page must decode the returned transaction and refuse any instruction outside {pump program, Token-2022, associated-token, system, compute budget}.
- **The official SDK** `@pump-fun/pump-sdk` exists **[unverified: seen only in search results]**.

### 1.2 Curve, graduation, PumpSwap

- Curve: Uniswap-V2-style with synthetic reserves, 30 SOL virtual and 1,073,000,000 virtual tokens at the start; 793,100,000 tokens are sold on the curve; 1% protocol fee on buys and sells (docs). A coin I read on its curve was about 4% sold (account decoded in `src/fixtures/omni`).
- Graduation: the curve is `complete` with zero real token reserves. The graduated curve account stays and still holds `complete = 1` (byte 48), which is what a proof can read. **Migration is permissionless**: "anyone can migrate a completed bonding curve"; the migration fee is 15,000,001 lamports. The LP tokens "are burnt" (docs); the LP mint of the graduated coin I read has supply 0 (verified).
- PumpSwap: constant product; LP fee 20 bps and protocol fee 5 bps on buys and sells; a creator fee goes to the coin's creator and is claimed with `collectCreatorFee` (creator signs); the rate is not in the docs I read, and the Global creator fee is described there as "currently 0" **[possibly stale]**. The canonical pool (index 0) is a PDA, so anyone can find it from the mint: `omni.ts` derives the pump curve and the canonical pool from the mint and matches the real addresses of two coins in its tests.
- Price on chain: `quote vault balance / base vault balance` (the doc says to add `virtual_quote_reserves`, which is 0 on all pools today). The graduated coin I read: 200,317,816.86 coins against 82.78 SOL, or 4.13e-7 SOL per coin.

### 1.3 What a third-party site may do

- Open public docs and an IDL exist; PumpPortal is an established third-party creation API; creating through the program is permissionless. Coins created this way are indistinguishable on chain.
- The terms of service body did not load for me (only the page's welcome text), so any clause on third-party interfaces, bots or branding is **[unverified]**. Ask a lawyer or read https://pump.fun/docs/terms-and-conditions before shipping. Use no pump.fun logo or "official" wording.

### 1.4 Can a pump.fun coin be made cross-chain afterwards?

Yes. With mint and freeze authority null, nothing needs to be handed over. A locking bridge on Solana only needs to hold the coin. What is not possible afterwards: a bridge that needs the mint authority (burn-and-mint on Solana, Chainlink CCIP's self-serve path). See 2.

---

## 2. One supply on Solana and Ethereum/Robinhood

### 2.1 The options, against a pump.fun mint

| | Wormhole NTT | LayerZero OFT Adapter | Chainlink CCIP CCT |
|---|---|---|---|
| Fits a mint with no authority | **Yes.** Hub-and-spoke, Solana hub in locking mode: "no mint authority change is needed when the SVM chain is the hub" ([deploy guide](https://wormhole.com/docs/products/token-transfers/native-token-transfers/guides/deploy-to-solana/), 2026-10-22) | **Yes.** The adapter locks in an escrow owned by the OFT Store ([LayerZero docs](https://docs.layerzero.network/v2/developers/solana/oft/overview), 2026-10-22) | **No self-serve.** The Router checks that the signer is the token's mint authority; a mint authority of None means "Chainlink assistance" ([CCIP SVM guide](https://docs.chain.link/ccip/v1/svm/concepts/cross-chain-token/integration-guide), via search summary 2026-10-22) |
| Token-2022 | The Solana NTT manager works with Token-2022; transfer hooks are supported from `v2.0.0+solana` (docs and search summary). Pump coins have no hook or fee extension | Metadata and metadata pointer "generally work in common setups, but validate initialization and both transfer directions" | not the gating point |
| Robinhood Chain 4663 | **Listed** among the 33 mainnet NTT networks: Ethereum, Base, Robinhood, Solana and more (supported-networks page, 2026-10-22) | EID 30416, but the **default verifier is LayerZero's dead DVN**: nothing moves until you set DVNs (RESEARCH 5.1) | lanes exist; irrelevant here |
| Verifiers | Wormhole guardians, 13 of 19. One transceiver for all routes ("NTT requires the same transceiver for all routes", FAQ); Solana multi-transceiver arrived in `v3.0.0+solana` [unverified how far it is usable on EVM] | You choose: 2 or more required independent DVNs, at most 5 on Solana pathways. **Best verifier diversity** | Chainlink DON plus RMN |
| Rate limits | Per chain, inbound and outbound, **default 0 on Solana until you set them**; cancel-flows refill the opposite direction | RateLimiter in the PeerConfig | token-bucket per lane |
| Per-coin cost on Solana | an NTT program deployment per token (the docs ask for an `ntt...` program keypair); about 4 SOL [unverified] | a Solana OFT program instance; about 3.9 SOL program rent | n/a |
| One adapter rule | n/a | exactly one adapter per mesh ("Multiple OFT Adapters break omnichain unified liquidity") | one lockbox |

### 2.2 Pick: Wormhole NTT, Solana hub (locking), EVM spokes (burning)

Reasons: it needs no authority the pump.fun mint no longer has; it supports Robinhood Chain without LayerZero's dead-DVN setup trap; it has rate limits and queues. LayerZero is the alternative if we want the strongest verifier diversity (two required DVNs); its adapter, DVN and Robinhood notes are in RESEARCH.md 5.2 and in `order-launchpad.ts` (the $SHIFT bridge orders). Do not run both for one coin.

The cost of the choice: the guardians are the one verifier set. Compensate with low rate limits, a multisig on every authority, and a monitor of the invariant "EVM total supply equals the coins locked in NTT's custody account on Solana".

### 2.3 Exact steps, and who signs what

Prerequisites (creator): a graduated pump.fun coin (the status endpoint says `venue: "pumpswap"`); a Solana wallet with about 5 SOL spare; an EVM wallet; a staked Solana RPC (Wormhole says mainnet needs a custom RPC in `overrides.json`, from Triton or Helius); the NTT CLI.

1. **EVM spoke token first (IMD order 1).** The creator pays `omniSpokeOrder` (0.5 IMD). IMD builds, tests, audits, deploys `OmniSpokeToken`: 6 decimals, immutable cap 1,000,000,000 coins, mint only by the minter, owner can `setMinter` once and then `seal()`. Why first: the NTT CLI can then deploy the manager around an existing token [`--token` option: unverified].
2. **Solana NTT, locking mode (creator's Solana wallet signs).** `ntt init Mainnet`, `ntt add-chain Solana --mode locking --token <pump mint>` (deploys the NTT program with the `ntt1...` keypair, then initializes it), set a rate limit (inbound and outbound default to 0). Versions per the guide: Solana 1.18.x, Anchor 0.29. Build with `make artifacts-mainnet` and `solana-verify` for a verifiable build. The payer covers the program deposit.
3. **EVM NTT, burning mode (creator's EVM wallet signs).** `ntt add-chain Ethereum --mode burning --token <spoke>` deploys NttManager and the Wormhole transceiver; same for Robinhood (chain id 72). Set peers, rate limits (inbound and outbound), thresholds. `ntt push`.
4. **Hand over and seal (creator's EVM wallet).** `spoke.setMinter(NttManager)`, then `spoke.seal()`. After this nobody can mint except NTT.
5. **Authorities to a multisig.** NTT owner, pauser and the Solana program's upgrade authority go to Squads (Solana) and a Safe (EVM). Better, after the first successful round trip, burn the upgrade authority.
6. **Test the round trip with a small amount**, then raise limits slowly.

**Security setup:** rate limits at about 2% of supply per 24 hours each way at the start; pauser separate from owner; peers verified by the CLI's `ntt status`; the monitor in 2.2; a minimum of one dry run on devnet. The CLI needs private keys on a machine, so **NIGHTSHIFT should publish the exact commands and a generator, not run them**. A browser deployer for a 700 KB Solana program is a later project **[size unverified]**.

### 2.4 Why not the others

- **CCIP:** needs the mint authority for self-serve. Chainlink help is possible but not a flow we can promise.
- **Hyperlane, Axelar:** Robinhood support gaps (RESEARCH 5.2).
- **Intent bridges only (Relay, LI.FI, Across):** fine for trading, they do not make one supply: they deliver the home chain's token to an address.

---

## 3. "Connecting the 2 LPs into one": what is physically possible

A pool is state in one chain's contracts. Two pools cannot be one. These are the honest options.

### (a) Two pools, one price, by arbitrage keepers

PumpSwap on Solana, a Uniswap v4 twin on EVM. A keeper holds coins and gas on both chains, so each correction is two local trades done seconds apart, with **no bridge in the trade path**. Inventory drifts (the EVM side ends up with too many coins), so the keeper bridges in batches over NTT (minutes, rate-limited).

Numbers (estimates, not measured; fees are what the pools charge):

| Item | Value |
|---|---|
| Dead zone, fees only | EVM pool 1.00% + hook 0.25% + PumpSwap 0.25% (+ creator fee, unknown) = about 1.5% to 2.5% each round trip. Prices inside this band are not worth arbitraging |
| Typical gap during active trading | about 2% to 5% (latency risk on a volatile coin adds to the dead zone) |
| Cost of one correction | Solana transaction about $0.001 plus priority fee; EVM swap cents on Robinhood and Ethereum at current gas; bridge rebalance per batch a fraction of a dollar [Executor fee unverified] |
| Latency | two local trades in seconds; inventory rebalance by NTT in minutes [Wormhole finality unverified here: Solana finalization is about 13 s plus guardian signing] |
| Profit per correction | for a pool with value V on each side, profit is about V x (gap - cost)^2 / 4. **A $5k pool (V = $2.5k) with a 3% gap and 1.8% cost: about $0.09. A $100k pool: about $1.8.** |
| MEV | the thin EVM pool is a sandwich target on Ethereum (public mempool); Robinhood has no public mempool but ordering MEV remains [unverified]; Solana has Jito bundles |
| Bridge risk | the vault's locked float depends on the NTT verifiers (2.1) |

So a Night Watch seat doing "LP sync" earns pennies on small coins. It is worth running only when the EVM pool is deep, or as a service whose cost the coin's fees cover.

**Design: the LP-sync job.** Off-chain library (`omniKeeperOrder`, a job.open, checks clean): reads the PumpSwap pool's two vault balances, the EVM v4 pool's `slot0`, converts SOL/ETH through two medianed public sources, computes the gap in basis points, and `plan_trade` returns the direction, the size that maximizes profit under constant-product maths on both pools, and the expected profit after fees; it returns `null` below a profit floor, above a size cap, with stale prices, or before graduation. It returns the calls as data and signs nothing. On chain, `OmniSyncVault` lets depositors fund up to 5 keepers: a keeper can only swap in the one pool within caps (2 ETH per swap, 10 ETH a day, value may not fall more than 0.5% per swap and 3% a day), and bridge coins to one fixed Solana address within caps. Keepers get 20% of realized profit over a high-water mark. The Solana half of the inventory is the keeper's own wallet, **not** in the vault (a vault cannot hold Solana funds), so the keeper needs real capital on both chains. Honest consequence: the vault is a risk for depositors; the plain way is for each keeper to use its own capital, and the vault is optional.

### (b) A v4 hook that rebalances

A hook cannot pull inventory from Solana synchronously: every message is minutes away and settles in later blocks. What a hook can do:

1. **Charge a dynamic fee by the price gap.** Built into `OmniPoolHook`: a swap that closes the gap pays an extra `min(gap x 50%, 5%)`; one that widens it pays nothing extra; the proceeds go to the FeeSplitter instead of leaking to bots (the arbitrageur still keeps about half the edge). The cost is a wider dead zone, so the cap is the tuning knob.
2. **Never depend on the oracle for safety.** Reference contract `REF` is optional; if it is zero, stale (older than 60 s) or reverts, the gap fee is 0 and trading works. A broken REF can tax closing trades by at most 5%; it cannot touch funds.
3. **Which oracle reads PumpSwap on EVM:**
   - **Wormhole Queries (CCQ):** guardian-signed `sol_account` reads of the pool's two vault accounts, verified in the EVM contract; "most queries resolve in under one second"; the CCQ server is "permissioned but trustless" and needs an API key; cost and Solana mainnet availability **[unverified]**. The strongest option and the one used for the graduation gate.
   - **A keeper-signed price:** cheap, one trusted key; acceptable here only because the fee is capped at 5%.
   - **LayerZero lzRead:** the docs I read do not mention Solana as a source.
   - **Pyth / Switchboard:** no feed for a new pump.fun coin **[unverified]**.
   - **IMD's oracle:** a panel of 5 to 100 seats answers a typed question for 0.5 IMD per request with a 10-minute floor on schedules; it is not a price feed. It is a possible, slower alternative for the graduation gate (skill `oracle-consumer` exists), not for a live fee.
4. **A bounty instead of a pull:** the hook can leave part of its fees as a reward for the swap that closes a large gap. Not built; it would need a reserve and a griefing analysis.

### (c) One canonical pool plus buying from other chains (what DESIGN.md already does)

For a pump.fun coin the canonical pool is PumpSwap, already deep, with burned LP. **This is the closest thing to one LP.** Verified today (2026-10-22), free quotes:

- LI.FI quote, 0.01 ETH ($23.77) on Ethereum into the graduated coin on Solana at a given Solana address: route Relay Depository plus a Solana swap ("nordstern"), estimated execution 1 s, output $23.42, fees: LI.FI fixed $0.0594, relayer gas $0.2253, relayer service $0.0625 (1.5% all-in with price impact).
- Relay's own `/quote`: **no route** for the same coin ("NO_SWAP_ROUTES_FOUND"). So LI.FI is the primary here; the route can change per coin and per day.
- A coin still on its curve: LI.FI "No available quotes". Curves are only reachable through the pump program, not a router. Buying into the curve from an EVM chain needs our own transaction; not built.
- The buyer receives the SPL coin at a Solana address. To get the EVM coin they bridge it with NTT (minutes), or the EVM twin pool buys it locally.

### (d) Anything newer that shares liquidity (2025 to 2026)

Searched again today (extended search). **No live omnichain AMM shares one pool across Solana and EVM for a new token.** What exists: Stargate (omnichain pools for USDC, USDT, WETH and similar, no new tokens), Symbiosis (cross-chain AMM [unverified coverage]), Allbridge Core (stable swaps across EVM, Solana, Tron), intents and solver networks (Relay, deBridge, Across, Mayan), Uniswap's cross-L2 liquidity (a roadmap). RESEARCH 6.1(c) has the table. pump.fun's own multichain trading is reported (CryptoBriefing, 2026-05-26) but without an official source or a statement about where coins are minted.

### Recommendation

**Stage A (closest to one LP, safe, cheap): PumpSwap is the one pool.** Route every chain into it. **Stage B (for coins that earn it): the bridged supply and an EVM twin pool**, presented as a second venue with a visible gap, never as the same LP. In numbers: Stage A costs the buyer about 1.5% and about 1 second, adds no contract and no bridge risk. Stage B adds about $400 plus 2.5 IMD, a 2% to 5% typical gap, and bridge risk, in exchange for EVM-native composability (Uniswap routers, IMD ecosystem) and fees to the FeeSplitter (40% to rewards, 20% dev, 20% treasury, 20% burned).

---

## 4. What the IMD swarm builds (EVM side)

All orders are in `apps/engine/src/order-omni.ts`, owner = the creator (shown with the dev wallet `0x6c4c78f2c3bdf4c4318fe305fb1c8bc1694d19b5` as a stand-in). Each was sent on 2026-10-22 to `POST https://api.imd.fun/requests/check` and edited until it had 0 blockers. The stand-in coin is a real graduated pump.fun mint; its curve address is the real one. **Nothing was paid.**

| Order | Kind and chain | What the swarm builds | Check result |
|---|---|---|---|
| 1. `omniSpokeOrder` | `launch.open`, `evm_contracts`, Ethereum and Robinhood | `OmniSpokeToken`: 6 decimals, immutable cap 10^15 raw (1B coins), only the minter mints, owner `setMinter` then one-time `seal()`, `burn` of own balance only, no other power | Ethereum 0 blockers, Robinhood 0 blockers (9-step plan: build, test, manifest, 4 auditors, judge, deploy) |
| 2. `omniGateOrder` | same, Ethereum | `GraduationGate`: opens the hook only with a Wormhole Queries response, signed by the guardians, of the pump curve account (166 bytes, `complete` at offset 48 == 1, real tokens 0, owner = pump program, block time within 24 h); no owner, no signer of ours | 0 blockers |
| 3. `omniHookOrder` | same, Ethereum and Robinhood | `OmniPoolHook` (closed until `open()`, 0.25% to the FeeSplitter `0x1119d5df2f046bc2d3c0f6279ef2e9ce49422d44`, optional capped gap fee, works through the Universal Router and Quoter) and `OmniPoolSeeder` (one-shot: initialize at fee 1.00%, add one position, hand it to the owner) | Ethereum 0 blockers, Robinhood 0 blockers |
| 4. `omniVaultOrder` | same, Ethereum | `OmniSyncVault`: shares as internal accounting (not a token), up to 5 keepers, swap caps, bridge-only-to-one-Solana-address, 20% keeper share over a high-water mark, depositor withdrawals never blocked. First check had 3 blockers (it thought the shares were a token: name, symbol, supply); the order now states "no token is created" | 0 blockers after the edit |
| 5. `omniKeeperOrder` | `job.open`, steps `scaffold-project` + `adversarial-review`, `github: true` | TypeScript gap monitor and trade planner, recorded-answer tests, signs nothing. First check: "say what to build" (the `impl_tests` template is for contracts); steps fixed it | 0 blockers after the edit |

Facts the answers carried: kind `contracts` (the swarm gives the owner `$owner` roles), plan of 9 steps for each contract order, and `token_*` facts "not applicable" (the check does not treat these as a launch token, which is what we want for a bridged coin). No suggestions were returned.

What is **not** ordered and why:
- **Wormhole NttManager and transceiver:** Wormhole's own audited contracts, deployed by the CLI; a swarm rewrite would be riskier.
- **A hook launch (`univ4_hook`)**: it always creates IMD's own token and "nothing minted after launch" (docs); it cannot be the bridged token. The pool is made by our seeder instead.
- **A graduation gate through IMD's oracle:** a possible variant, not written (needs the oracle consumer pattern and 0.5 IMD per answer).
- **Hook address bits:** a v4 hook's address encodes its permissions, so the deploy needs a mined CREATE2 salt. The check does not test this; the order tells the swarm to do it and to test it. **[Whether IMD's `evm_contracts` deploy path can use a mined salt is the main open question, found only when the order runs.]**

Order of paying: 1 (spoke) first, since NTT is built around its address; 3 (hook) and 2 (gate) need the spoke address and the Wormhole core address; 4 and 5 last.

---

## 5. What NIGHTSHIFT's site must do

Reuse: `apps/web/src/walletkit.ts` already has `connectSolana()` returning `{address, wallet}` with `signTransaction` and `signAndSendTransaction` (AppKit's Solana adapter, loaded on `/swap`); `mswap/run.ts` shows how a Solana transaction is signed and sent; the launchpad page and API live under `apps/web/src/launchpad/` and `apps/engine/src/launchpad.ts`.

**Stage A (build next; no contract, no payment by us)**
1. **Create.** Form: name, symbol, description, image, links, optional dev buy. Upload the image and the metadata JSON to IPFS (a pinning key on our side, or the creator's; pump.fun no longer takes direct uploads). Generate the mint keypair in the browser; build `create_v2` (own builder or PumpPortal, with the instruction allowlist from 1.1); partially sign with the mint keypair; the creator's wallet signs and sends through `connectSolana`. Mayhem mode off. Show the mint, the curve and a link to pump.fun.
2. **Follow.** `GET /api/omni/pump?mint=` (built, tested against a graduated and a live coin): authorities revoked, percent sold, graduation, PumpSwap price, LP burned. Poll like the launchpad does every 15 s.
3. **Token page.** Price and liquidity from PumpSwap; **"Buy from any chain"** through LI.FI into the pool (Relay's `/quote` refused the same coin today, so LI.FI first and Relay second, quote-tested per coin as in RESEARCH 6.2); an honest "you receive the coin on Solana".

**Stage B (when a creator opts in; after graduation)**
4. **"Make it cross-chain" checklist:** shows the exact CLI commands from 2.3 with the coin's values filled in (never keys), and verifies each step by reading chain state (NTT program exists, peers set, spoke minter set and sealed, rate limits non-zero).
5. **Order the EVM side:** builds orders 1 to 5 with `order-omni.ts`, runs IMD's free check from the page (the existing `/api/launchpad/check` pattern), pays from the creator's wallet through the Intake exactly as the launchpad does today, and follows each launch.
6. **Token page, two pools:** both prices side by side (PumpSwap from the endpoint; the EVM pool from DexScreener or `slot0`), **the gap in percent and in a plain sentence** ("about 2.3% apart; trades inside the fees are not worth arbitraging"), the supply check ("locked on Solana: X, minted on Ethereum: Y, must be equal"), and the bridge's rate limits.

---

## 6. Cost and risk, compact

| Item | Number | Source |
|---|---|---|
| pump.fun create | no fee; rent about 0.0027 SOL for the mint account | PumpPortal docs; mint account lamports read on chain |
| Buying through the curve | 1% protocol fee | pump docs |
| PumpSwap | 0.20% LP + 0.05% protocol (+ creator fee) | PumpSwap docs |
| Cross-chain buy into PumpSwap | about 1.5% on a $24 order; about 1 s | LI.FI quote, 2026-10-22 |
| NTT Solana | about 4 SOL, about $400 | **[unverified]**, from LayerZero's 3.9 SOL for its program |
| NTT EVM | gas only | no price source read |
| IMD | 2.5 IMD for the five orders | `GET /requests/capabilities`: 0.5 IMD per `launch.open` and `job.open` |
| Typical gap | 2% to 5% | estimate |
| Keeper profit | V x (gap - cost)^2 / 4 per correction | derived |

Main risks: the bridge float (verifiers, 2.1); the $400 deposit against a small coin; a sandwich-able thin EVM pool; pump.fun terms **[unverified]**; pump.fun's own multichain plans **[unverified]**; a hook address that IMD's deploy path cannot mine; the `GraduationGate` and `OmniPoolHook` are new code (the swarm audits them, nothing has been run on a real v4 PoolManager yet); Wormhole Queries on Solana mainnet **[unverified]**.

---

## 7. What the owner must decide

1. **Ship Stage A first?** (My recommendation: yes. It is the one-LP answer and costs nothing on chain.)
2. **Who pays the NTT program (about 4 SOL)** and from which wallet: the creator only, or a rule that the page offers Stage B only to graduated coins with at least a set PumpSwap liquidity (suggest 300 SOL, about $31k).
3. **NTT or LayerZero.** NTT recommended; LayerZero if two independent verifiers matter more than Robinhood simplicity.
4. **Hook rules:** 0.25% to the FeeSplitter, a gap fee capped at 5%, pool fee 1.00%. The sniper fee of the earlier Launch Hook does not apply (the pool opens after graduation, with the price already known).
5. **EVM chain:** Robinhood (cheap, no public mempool, NTT listed) or Ethereum.
6. **Graduation gate:** guardian-signed Wormhole Queries proof (trustless, more code, mainnet Solana support unverified) or an owner opening after a date (the hook already has that fallback).
7. **Keepers:** own-capital keepers only, or the shared vault (adds depositor risk and a contract to audit).
8. **Terms:** have pump.fun's terms read before launching a "create on pump.fun" button.

---

## 8. Sources

Opened on 2026-10-22 unless marked.

- pump-public-docs index; PUMP_PROGRAM_README, PUMP_SWAP_README, COIN_CREATION, PUMP_CREATOR_FEE_README (github.com/pump-fun/pump-public-docs)
- PumpPortal, "Token creation": https://pumpportal.fun/creation
- Solana mainnet, `api.mainnet-beta.solana.com`: mint, bonding curve, PumpSwap pool, vaults and LP mint of `8QtbrC9d3BezyCwzBFUQbNsWJGte7ckrZ7HWcn81pump` (graduated; curve `26fbbj…BHW9`, pool `B2ajNV…B21`) and `HoWecXvLmS2UgY5iiktHuwM6b3rwptbDE6D7D6dMpump` (on its curve); recorded in `apps/engine/src/fixtures/omni/`
- pump.fun frontend API (`frontend-api-v3.pump.fun/coins`), used only to find the two sample coins; fields `token_program`, `multichain_family`
- Wormhole NTT: overview, Solana deployment guide, FAQ, supported networks (33 mainnet networks including Robinhood and Solana), solana/README, Queries overview and supported methods (`sol_account`, `sol_pda`), GitHub README (wormhole.com/docs, github.com/wormhole-foundation/native-token-transfers)
- LayerZero: Solana OFT overview and lzRead standard (docs.layerzero.network)
- Chainlink CCIP SVM token guides (search summary of docs.chain.link, 2026-10-22; the direct tutorial URL returned 404)
- LI.FI `GET li.quest/v1/quote` and Relay `POST api.relay.link/quote`: free quotes, 2026-10-22 (not executed)
- Crypto Briefing, "Pump.fun expands trading to Ethereum, Base, BNB Chain, and more EVM networks", 2026-05-26 (secondary; no official source found)
- IMD docs `https://imd.fun/docs/llms.txt` (kinds, `customToken` rules, skills list) and `GET /requests/capabilities`, `POST /requests/check`
- CoinGecko simple price (SOL, ETH), 2026-10-22
