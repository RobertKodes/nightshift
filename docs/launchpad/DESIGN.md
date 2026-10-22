# NIGHTSHIFT Launchpad: design

2026-10-22. Research behind every choice here: [RESEARCH.md](RESEARCH.md). IMD's check results for every order below: [checks/](checks/).

**In one line:** launch a coin with the IMD swarm from your own wallet, then anyone buys it from Ethereum, Base, Robinhood Chain or Solana into its one pool.

## 0. What is built today and what comes next

| Stage | What | Contracts | State |
|---|---|---|---|
| 1 | Board of every IMD coin, launch form with IMD's free check, payment from the creator's wallet through IMD's Intake, a page that follows the launch to its pool, buy from any chain through the existing swap | none new | **built** (section 11) |
| 2a | The NIGHTSHIFT Launch Hook: a coin with a sniper fee (50% falling to 0 over 60 s) and 0.25% of every swap to the NIGHTSHIFT fee splitter | one IMD `univ4_hook` launch per coin, paid by its creator | order written and checked, 0 blockers, not paid |
| 2b | The same coin on IMD's other chain: a LayerZero V2 OFT adapter on its home chain and an OFT on the other one, piloted with $SHIFT (Ethereum to Robinhood Chain) | two IMD `evm_contracts` launches | orders written and checked, 0 blockers, not paid |
| 3 | Base the day IMD opens it; a Solana-side token through Chainlink CCIP's self-serve pools | IMD (Base); no Solana program | blocked on IMD (Base) and on a token admin role (CCIP) |

The route is **/launchpad** (already in the Geek Room's menu). **/launch** stays what it is today, "Launch a company".

## 1. Principles

1. **Every launch is an IMD launch.** The swarm builds, tests and audits it, IMD's factory deploys it and seeds its pool. NIGHTSHIFT does not run its own token factory: that would take the work and the 10% seat share away from IMD and duplicate what IMD, PvP Pad and Keel already do (RESEARCH 2.6, 3).
2. **The creator pays and owns.** The creator's wallet pays IMD's 0.5 IMD through the Intake and so becomes the launch's requester (1% of every trade). NIGHTSHIFT never holds a key, a coin or a payment.
3. **One coin, one pool, any chain.** No mirrored curves. Other chains reach the one pool through intent routers (RESEARCH 6).
4. **The page signs only what it built.** The request is built in the browser from the form by `@nightshift/launch`, the same code the engine uses to ask IMD's check, and compared byte for byte before the wallet signs.
5. **Say what is not there.** Base and Solana launches, a bridgeable token and anti-sniper fees are not live, and the pages say so.

## 2. The create flow (built)

1. **Form** (`/launchpad/new`): chain (Ethereum or Robinhood Chain; Base and Solana shown disabled with the reason), pairing (ETH or IMD), name, symbol, supply, what it is, a logo idea, website, X, Telegram, pool share (10 to 90%, default 90), opening market cap (in the pairing's currency, with a dollar estimate from the board's prices), and the creator's wallet (needed in the form only when the creator keeps a share).
2. **Rules** (`formProblems`, shared): IMD's explorer's own coin rules (name 1 to 40, symbol `^[A-Z0-9]{2,11}$`, supply 1 to 18 digits, pool 10 to 90% whole, cap within IMD's range for the pairing: 1 to 1,000 ETH, 250 to 250,000 IMD), plus ours: every text field is one line (no line break or control character can add a line to the request), links are https and X/Telegram links are on x.com, twitter.com or t.me, the description is at most 280 characters.
3. **Request** (`launchBody`): IMD's explorer coin body, plus the creator's lines and two of ours.

   ```
   A custom token: Night Owl (OWL).
   Token name: Night Owl
   Token symbol: OWL
   Token supply: 1,000,000,000 with 18 decimals, all minted once to the deployer in the constructor.
   Transfers: plain ERC-20 transfers with no fee, tax or limit. Fixed supply: no owner, nobody can mint more.
   What it does: …            (each of these four lines only when filled)
   Website: … / X: … / Telegram: … / Logo: …
   Launched with the NIGHTSHIFT Launchpad, getnightshift.tech/launchpad.
   ```
   with `shape: chain`, steps `build-contract-project` + `adversarial-review`, `onchain: custom_token`, `github: true`, `chainId`, `pairWith: imd` when paired with IMD, and `economics {poolBps, initialMarketCapWei, remainderTo only below 90%}`. The last line marks launches made here in public (the board's "Launched here" tab reads it from IMD's job objective; nothing is stored on our side).
4. **Free check** (`POST /api/launchpad/check`): the engine rebuilds the body from the form with the same code and sends `{action: "launch.open", input: body}` to `https://api.imd.fun/requests/check`. The page shows IMD's blockers, or its plan (9 steps: build, second tester, manifest, four auditors, judge, deploy). A changed form must be checked again.
5. **Pay** (from the creator's wallet, on the launch's own chain): `refuseBody` (same body as the form builds; the payer is the creator; the kept share goes to the payer) → switch to the chain → IMD balance ≥ 0.5 → approve exactly 0.5 IMD to the Intake if needed → `Intake.request("launch.open@launch-1", body, no callback, IMD, 0.5 IMD)`, batched into one confirmation where the wallet supports EIP-5792 (`batch.ts`, now chain-aware). On Robinhood Chain the payment is in Robinhood IMD for cents of gas.
6. **Follow** (`/launchpad/t/tx-<chain>-<hash>`): the page reads IMD's Intake record of that transaction, then the job (each step's state), then the launch, every 15 seconds, until it is live; the launch is remembered in the browser ("Your launches", a convenience only).

## 3. The curve and graduation

IMD's factory seeds `poolBps` of the supply **single-sided** into a Uniswap v4 position from the opening price upward (e.g. #2444: ticks -887220 to 128940). Inside that range a v4 pool is a constant-product curve with virtual reserves: the coin side is the seeded tokens `x0 = pool × supply`, the quote side is virtual, `y0 = x0 × P0 = pool × cap`. A buy of `Δy` (after the 1.25% fee) gets `x0 − x0·y0 / (y0 + Δy)` coins, and the price moves to `P0 × ((y0 + Δy) / y0)²`. That is pump.fun's curve (30 SOL virtual against 1.073B tokens) with the pool share and the opening cap as its two parameters.

For the form's default (90% in the pool, 2 ETH opening cap, so `y0` = 1.8 ETH):

| ETH bought in | Share of supply bought | Price | Market cap |
|---|---|---|---|
| 0.1 | 4.7% | ×1.1 | 2.2 ETH |
| 1 | 31.9% | ×2.4 | 4.8 ETH |
| 5 | 66.0% | ×14 | 28 ETH |
| 10 | 76.1% | ×42 | 84 ETH |
| 50 | 86.8% | ×808 | 1,617 ETH |

A higher opening cap makes the start flatter (fewer coins for the first ETH), which is the creator's anti-sniper lever in stage 1. **There is no graduation**: the pool is the final venue from the first block. This follows the 2026 trend (Clanker, Zora, o1, NOXA, Pools.trade; RESEARCH 4.4): no migration transaction to exploit (pump.fun's 2024 loss came from its migration authority), no LP for the creator to pull (the position is held by IMD's factory), and routers can buy from any chain from block one (RESEARCH 2.8). The board can show milestones (×10, ×100), never a graduation.

## 4. Fees

**Stage 1 (today)**

| Who pays | What | To whom |
|---|---|---|
| Creator, once | 0.5 IMD + the Intake transaction's gas | IMD's treasury; IMD pays the deployment gas |
| Every trade | 1.25% pool fee | 1% to the creator (requester), 0.25% to IMD's network |
| A buy or sell through the NIGHTSHIFT swap | the swap's NIGHTSHIFT fee as today (`SWAP_FEE_BPS`, 0.25% by default; none for NIGHT FROG, Night Watcher or 5M+ $SHIFT holders), on top of LI.FI's or Relay's own costs | `SWAP_FEE_WALLET`, the treasury unless set in /setup |
| — | NIGHTSHIFT launch fee | **none** |

Proposal: point the swap fee wallet at the FeeSplitter (`0x1119d5df…1d44`) so swap fees follow the one rule (40% rewards, 20% dev, 20% treasury, 20% burned, IMD at IMD's BurnExecutor).

**Stage 2a (the Launch Hook)**: on top of the 1.25% pool fee, 0.25% of every swap's ETH side to the FeeSplitter, and the sniper fee (below) to the FeeSplitter too. Total trading cost 1.5%, against pump.fun 1.25% on the curve, Clanker 1.2%, Bags 2% (RESEARCH 4.3). Through the splitter every launch then rewards $SHIFT stakers and NIGHT FROGS holders (40%: half each) and burns SHIFT and IMD (20%). The creator keeps IMD's 1%.

**Not proposed:** a launch fee paid in $SHIFT. IMD's Intake takes only IMD, and whoever pays is the requester; a NIGHTSHIFT contract that swapped SHIFT to IMD and paid would become the requester and take the creator's 1% (it could hand it back with the factory's `setRequester`, but that is a new contract with a custodial step).

## 5. Anti-sniper and anti-rug

- **Stage 1 has no sniper protection on chain.** A `custom_token` gets IMD's own `PoolInitializationGuard` hook; by its name and IMD's docs (swap fees belong to hook launches) it guards the pool's creation and takes nothing from swaps [its code not read]. IMD decides the second the pool goes live, and bots watch its factory. The levers the form gives: a fair launch by default (the creator keeps nothing), and a higher opening cap.
- **Stage 2a: the sniper fee.** The market has settled on a fee that decays over seconds (Zora 99% to 1% over 10 s, o1 over 20 s, Clanker 80% to 5% over 30 s, Pons 99% to 0 in 3 s; RESEARCH 4.4). Ours: 50% of a buy's ETH falling linearly to 0 at 60 s after the pool's initialisation, fixed in the hook's constructor, sells untouched, proceeds to the FeeSplitter (so a sniper's tax pays stakers and burns, not the creator).
- **Anti-rug, from IMD's rules:** fixed supply minted once, no owner, plain transfers, the pool position held by IMD's factory, contracts built from public source with seven admission checks (provenance, findings, independent review, bytecode, manifest, protected invariants, economics), all shown on the coin page with the creator's kept share and the swarm's 10%.
- **What we add:** the coin page shows what the creator kept; a pool with under $500 of liquidity is listed but never offered as a buy ("Pool nearly empty"); every coin carries its IMD launch number and address (two coins can share a symbol: there are several HAMSTERs and two SHIFTs).

## 6. The coin page (built)

`/launchpad/t/<ref>`, where ref is a launch number, a payment (`tx-1-0x…`, `tx-4663-0x…`) or a token (`eth-0x…`, `rh-0x…`):
- **Before live:** paid → admitted as a job (link to IMD's explorer) → every step of the job with its state (build, tests, manifest, four audits, judge) → deployed. A stopped job shows the swarm's question and how the payer answers it (a `job.continue` from the same wallet).
- **Live:** price, market cap, liquidity, 24 h volume and buys/sells (DexScreener), a 7-day hourly chart (GeckoTerminal, drawn in SVG), the supply split and opening cap, the pool (v4 pool id, fee, hook), the requester, every contract, IMD's admission checks, the creator's words and links, and **"Buy from any chain"**: the multichain swap embedded with this coin preset.
- **Holders:** a link to the chain explorer's holders tab. There is no keyless holders API for these chains; IMD Radar shows holders.

## 7. How a coin becomes tradeable from every chain (built)

- `/swap?to=<eth|rh>:<token>&from=<chain>` opens the multichain swap with the coin on the "you get" side (looked up in LI.FI's list, otherwise read on chain and marked unverified), and the board's "Buy from any chain" uses it with a different chain to pay from (Base for an Ethereum coin, Ethereum for a Robinhood coin). The coin page embeds the same swap.
- Routes come from Relay and LI.FI as for every swap, with the swap's checks: pinned router contracts, simulation before signing, exact approvals. Tested on 2026-10-22 from Base, Ethereum and Solana into Ethereum and Robinhood coins in 1 to 4 seconds, including a coin launched 5 hours earlier that no price site had indexed yet (Relay only; RESEARCH 2.8).
- **What the buyer receives:** the coin on its home chain, at the buyer's EVM address there (a Solana buyer gives or connects an EVM address). Selling is the same swap the other way.
- **Limits:** one pool is one MEV target (on Ethereum keep slippage tight; Robinhood Chain has no public mempool); a route's own fee (4 to 42 bps measured) plus price impact on thin pools; LI.FI does not route coins it has not indexed.

## 8. Safety

- Nothing custodial: the engine only reads public data (IMD, DexScreener, GeckoTerminal) and forwards the free check.
- The browser builds the request and refuses to sign one that differs from its form, names another payer, or sends the kept share elsewhere. Only the Intake address and the chain's IMD are called, both pinned in `@nightshift/launch`; the approval is exactly 0.5 IMD.
- Text cannot inject request lines (one-line fields); links from IMD's data are rendered only as https; the check endpoint is rate limited (10 a minute per IP) and only accepts the form's fields.
- The board lists only IMD launches (IMD admitted them); it says plainly that coins are risky and NIGHTSHIFT endorses none.

## 9. The IMD orders (written, checked, not paid)

All four are in `apps/engine/src/order-launchpad.ts`, written like `order-forge.ts`. Each was sent to `POST https://api.imd.fun/requests/check` on 2026-10-22 and edited until it had 0 blockers; the requests and answers are saved in `checks/`.

| Order | Kind / chain | Check | Facts IMD fixes or adds |
|---|---|---|---|
| Coin from the form (`coin-eth-eth-fair`, `coin-rh-imd-keep10`, `coin-eth-imd-minimal`) | `custom_token`, Ethereum ETH / Robinhood IMD / Ethereum IMD | 0 blockers, 0 suggestions | none |
| A coin on Base (`coin-base-refused`) | `custom_token`, 8453 | **refused**: "Base (8453) is not open for launches" | |
| `launch-hook-owl`, `launch-hook-owl-robinhood`: a coin with the NIGHTSHIFT Launch Hook | `univ4_hook` + `customToken: true`, Ethereum / Robinhood, `economics.poolBps` 9000 | 0 blockers, 0 suggestions | the pool opens at the policy's 10 ETH cap; a hook fee is taken in ETH (held as a claim if the pool is short of ETH); 1.25% pool fee on top of the hook's |
| `shift-oft-adapter`: $SHIFT bridge, Ethereum end | `evm_contracts`, Ethereum, owner = dev wallet | 0 blockers | token facts not applicable |
| `shift-oft-robinhood`: $SHIFT bridge, Robinhood end | `evm_contracts`, Robinhood Chain | 0 blockers after stating the supply ("0 at deployment, then exactly what is locked on Ethereum") | |

Notes on the bridge orders, from IMD launches #778/#782 and the research:
- Order the adapter first; the Robinhood OFT fixes its peer to the adapter's deployed address in its constructor (the check above used a placeholder, `0x1111…1111`; the real order fills in the address).
- After both deploy, the owner (the dev wallet, never IMD's launch wallet) sends: `setPeer(30416, OFT)` on the adapter, then on both ends the ULN302 send and receive config with **2 required DVNs** (LayerZero Labs and one independent DVN) and 15 confirmations, and the enforced options. LayerZero's default on Robinhood Chain is its dead DVN, so nothing moves until this is done; a single DVN is how KelpDAO lost $292M in April 2026 (RESEARCH 5.2). These owner transactions can be built in /setup like the swarm orders' payments.
- Each end has a rate limit of 10M SHIFT per hour and no rescue function. Exactly one adapter (lockbox) ever, and never alongside Arbitrum's canonical bridged SHIFT on Robinhood Chain, which would be a second, non-fungible SHIFT there.
- The same two orders, templated with a coin's address and its creator as owner, give any IMD coin a second chain. Base waits for IMD.

Cost of everything above: 0.5 IMD per order plus the paying transaction's gas; IMD pays deployment gas.

## 10. What is not possible yet, and why

| Wanted | Why not | What would unlock it |
|---|---|---|
| Launch on Base | IMD's check refuses chain 8453 today (policies exist, chain not open) | IMD opening Base: then add 8453 to `LAUNCH_CHAINS` and check it |
| Launch on Solana, or an SPL version | IMD deploys EVM contracts only | CCIP self-serve pools (Chainlink's deployed programs; needs a token admin role that `custom_token` does not have) or a LayerZero OFT program deployed by someone else |
| The same pool on several chains | a v4 pool lives on one chain; no live omnichain AMM serves a new token on EVM and Solana (RESEARCH 6) | nothing to build: one pool, routed from every chain, is the design |
| An image upload | IMD's request has no image field; IMD draws the logo in its own job | IMD adding an image input to launches |
| Anti-sniper in stage 1 | `custom_token` launches get IMD's fixed hook | the Launch Hook order (2a) |
| A holders list | no keyless holders API for Ethereum and Robinhood Chain | an indexer (IMD's `build-ponder-indexer` skill) or an explorer key |
| A $SHIFT-paid launch | the Intake takes IMD only and makes the payer the requester | a contract with a custodial step; not proposed |
| Chart for brand-new coins | GeckoTerminal lists a pool after trades; its free API allows about 30 calls a minute | charts are cached 10 minutes per pool |

## 11. What was built (stage 1)

- `packages/launch` (`@nightshift/launch`): chains and pairings pinned from IMD's capabilities, the four launch kinds and their rules, `formProblems`, `objectiveOf`, `launchBody`, `readForm`, `refuseBody`, the Intake address and price.
- `apps/engine/src/launchpad.ts`: `GET /api/launchpad/board` (every live coin on Ethereum and Robinhood Chain, priced ones and the 60 newest unpriced, the coins being built, ETH and IMD in USD; rebuilt at most every 2 minutes, 24 IMD records per build), `GET /api/launchpad/launch?ref=` (payment → Intake → job → launch → pool id → market), `POST /api/launchpad/check`, `GET /api/launchpad/chart?chain=&pool=`, `GET /api/launchpad/chains` (whether IMD opened Base yet). Reuses `services/imd.ts` (launch list and records) and `imdmarket.ts` (DexScreener, now per chain).
- `apps/engine/src/launchpad.test.ts`: 20 tests on recorded IMD, DexScreener and GeckoTerminal answers (`src/fixtures/launchpad/`), including the real payment → job → launch chain of #2445 and a v4 pool id that matches DexScreener's.
- `apps/engine/src/order-launchpad.ts`: the stage 2 orders.
- `apps/web/src/launchpad/`: the board, the form and payment, the coin page with its chart and embedded swap; `/swap?to=…&from=…` presets in `mswap/MultiSwap.tsx`; `batch.ts` sends on Robinhood Chain too.
