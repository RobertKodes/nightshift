# NIGHTSHIFT on IMD: the evidence

Everything below can be checked on Ethereum mainnet or in IMD's public API. Read on 2026-10-22 at block 26,250,937. No number here is a claim we could not link.

Owner of every NIGHTSHIFT contract and requester of every launch: the dev wallet [`0x6c4c78f2c3bdf4c4318fe305fb1c8bc1694d19b5`](https://etherscan.io/address/0x6c4c78f2c3bdf4c4318fe305fb1c8bc1694d19b5).

## 1. IMD launches built for NIGHTSHIFT

All eight were requested by the dev wallet, built and attested by the IMD swarm, and are `live`.

| Launch | What it is | Contracts | Record |
| --- | --- | --- | --- |
| #2033 | NIGHT FROGS, 500 fully onchain NFTs | NightFrogs [`0x55b8…8a0c`](https://etherscan.io/address/0x55b8c762f1b86fe1d5406edaaae0f8ecf3688a0c), FrogRenderer, FrogArt1, FrogArt2 | [launch](https://api.imd.fun/launches/1fc22c34-dd98-4032-b7c2-7e6511ca388b) |
| #2124 | $SHIFT and its Uniswap v4 hook (the hackathon entry) | ShiftToken [`0xe5e5…c3ac`](https://etherscan.io/address/0xe5e58e53d0bb204aa62c995a6c8cc8a48e60c3ac), NightshiftHook [`0x42eb…e0cc`](https://etherscan.io/address/0x42ebcf86e3ab0445ba0362f911a7e8fad6ace0cc); FeeSplitter [`0x1119…2d44`](https://etherscan.io/address/0x1119d5df2f046bc2d3c0f6279ef2e9ce49422d44) and ShiftRewards [`0x44ef…30b5`](https://etherscan.io/address/0x44ef9ba2dac00b709a7a69a966a7cbc9c5f930b5) were created in the same [deployment transaction](https://etherscan.io/tx/0x7066ea4c4d8f3a90b30f846925d41a989b851d9becc996065d69a2734a5766c1) | [launch](https://api.imd.fun/launches/ba3c2a45-99a6-446b-91ab-a839869a08a5) |
| #2201 | GameEscrow: staked games in SHIFT or IMD | [`0xf460…3489`](https://etherscan.io/address/0xf460fd9ad76f18414f54a2431870e8a116193489) | [launch](https://api.imd.fun/launches/31f83052-5918-402f-9f13-5f4afd80b879) |
| #2229 | BetPool: spectator bets on games | [`0x76de…0fc3`](https://etherscan.io/address/0x76decb1958a1e04549e2e7f451cc22cd832d0fc3) | [launch](https://api.imd.fun/launches/8594ca07-e200-48f4-9d60-30f50c558b6f) |
| #2329 | NightshiftVault: player balances | [`0xefc4…ff9b`](https://etherscan.io/address/0xefc4076fa25327db4b0c89c05619d6b1273bff9b) | [launch](https://api.imd.fun/launches/0537b7d1-e1e1-415b-9e4c-d3bd581f4e60) |
| #2436 | NightWatchSkin: the Night Watchers identity layer | [`0x8509…112e`](https://etherscan.io/address/0x8509cddf80cfc8cec4aaa3644b125de919da112e) | [launch](https://api.imd.fun/launches/902170a7-d7a3-4d73-a8bf-fefc1e07e76a) |
| #2437 | NIGHT WATCHERS: the Forge (10 NIGHT FROGS + 2 IMD make one Gen 2 NFT) | [`0xbdff…d819`](https://etherscan.io/address/0xbdff33cffc3f617f808a6de012a2574dbf69d819) | [launch](https://api.imd.fun/launches/ee3c1925-b70f-4c0e-9125-1129755ef45c) |
| #2445 | NightWatchRenderer: the Night Watchers art, onchain | [`0x0534…e1f5`](https://etherscan.io/address/0x053471879f65f6b4f644635fbdd798b9d7c5e1f5) | [launch](https://api.imd.fun/launches/9c2520b0-2497-443c-9020-b6c06b59fd65) |

Launches #2031, #2106, #2126 and #2129 also carry the name "nightshift" but were requested by other wallets. They are not ours.

## 2. IMD paid to hire the swarm

Ten orders paid onchain into IMD's Intake ([`0x4e0f…adbc`](https://etherscan.io/address/0x4e0fa57bde726079356537e2f34d671e9f41adbc)), 0.5 IMD each, all sent by the dev wallet:

| Order | Paid | Transaction | Became |
| --- | --- | --- | --- |
| pinball-escrow | 2026-10-18 | [`0x26c4…9d32`](https://etherscan.io/tx/0x26c487cea084c57fc4167e7b7161ddaf22c3a3653388039c0cc30964bb8f9d32) | |
| pinball-audit | 2026-10-18 | [`0x817a…6280`](https://etherscan.io/tx/0x817a04fc05333d1e3be3e95f04d55d76a1a2761866d49cc1013818ee32786280) | [audit report](docs/audit-space-pinball-2026-10-19.md) |
| project-audit | 2026-10-18 | [`0x9812…f825`](https://etherscan.io/tx/0x98120d91a603f580ccf91fe0f1e357265a52919dcf6722bd8224dd691ac9f825) | [audit of this whole repository](docs/audit-nightshift-2026-10-19.md), job [68591e6d](https://api.imd.fun/jobs/68591e6d-16e0-4063-a0a2-c9166cfb87fb) |
| pinball-escrow-v2 | 2026-10-18 | [`0x2b85…e4f9`](https://etherscan.io/tx/0x2b8539106037b1b130ce76a2b16dc632b34c44555366d8c2e8c46af2f6b7e4f9) | |
| arena-bets | 2026-10-19 | [`0xb34a…d1e5`](https://etherscan.io/tx/0xb34adaebd1725d19a0bd8bcf18b2c6c4ba2dd53de8119f927caa9f99078dd1e5), again [`0xe6f5…5d87`](https://etherscan.io/tx/0xe6f58a1094493c5d2caf6c156ac32b15650c39a56a0f2825f1c3e6f211d15d87) | launch #2229 (job 2c64e994) |
| frog-forge | 2026-10-21 | [`0x3e27…8137`](https://etherscan.io/tx/0x3e272a783ff22b06b3c3e01dcdc115a3727ab8be37e772af602107d5ca5d8137) | launch #2437 (job 20a45ec3) |
| frog-forge-skin | 2026-10-21 | [`0xeea1…0b8e`](https://etherscan.io/tx/0xeea1e471d2bad8ae87dca8b410ffa73ce47029905829b2e8f0153185e9f40b8e) | launch #2436 (job 4e094eb3) |
| frog-forge-art | 2026-10-21, again 2026-10-22 | [`0x3053…091f`](https://etherscan.io/tx/0x30537fbcbe55fd51d045fa0b98ad250c7d298e7ca95302c032279c9afee2091f), [`0x2664…2d47`](https://etherscan.io/tx/0x2664eb3828e71b05ccaf7abacd97a2c243c21806cff2012e9c01e5dedbf02d47) | launch #2445 (job 3d2313bb) |

Every payment is a plain IMD `Transfer` from the dev wallet to the Intake in the linked transaction.

## 3. The hook and the money, in use

| What | Onchain today | Check |
| --- | --- | --- |
| $SHIFT trading through NightshiftHook | `tradingOpen() = true`; **159 transactions** in which the hook acted in the 7 days to block 26,250,937, e.g. [`0x3cef…06ad`](https://etherscan.io/tx/0x3cefd3126a0d43a8bd967094e8fe537c626721a91ed1abf0890f7fe0221506ad), [`0x7d0d…5755`](https://etherscan.io/tx/0x7d0d4ab02f3a255f39775a2ad963f0aa15b46289726daa9a808ffab6be785755), [`0xaa42…d63d`](https://etherscan.io/tx/0xaa42ec70ec1eba30130c54f45970ee08733f254fdedea2166d7c0683556fd63d) | [hook events](https://etherscan.io/address/0x42ebcf86e3ab0445ba0362f911a7e8fad6ace0cc#events) |
| Fees split by FeeSplitter | **68** `Distributed` events (40% stakers and NIGHT FROGS holders, 20% treasury, 20% dev, 20% burn) | [events](https://etherscan.io/address/0x1119d5df2f046bc2d3c0f6279ef2e9ce49422d44#events) |
| IMD bought and burned from fees | **4** `ImdBurned` events, **20.51 IMD** sent to IMD's BurnExecutor [`0xe293…c750`](https://etherscan.io/address/0xe29386719c155b6847ad5a4e97c6674f10ffc750), latest [`0xcd17…3c92`](https://etherscan.io/tx/0xcd175e77998820a24eac8e0655be388d17dc805d351bbb1d75775a3524733c92) | `burnReserve` in FeeSplitter |
| $SHIFT staked | **112,397,404 SHIFT** held by ShiftRewards | `balanceOf(0x44ef…30b5)` on $SHIFT |
| NIGHT FROGS | **500 of 500 minted**, each for 2 IMD: 1 IMD burned to `0x…dEaD`, 1 IMD to the dev wallet, e.g. [`0xc83e…833a`](https://etherscan.io/tx/0xc83edfdbb03fc8e727caf332d44b21799cad106d82e588721e758eb64343833a) | `totalSupply()` on NightFrogs |
| NIGHT WATCHERS | **3 forged**, each burning 10 NIGHT FROGS and paying 2 IMD: 1 IMD to the BurnExecutor, 1 IMD to the dev wallet, e.g. [`0xae38…b5de`](https://etherscan.io/tx/0xae38bbd5b41868c96855fdde2f1867c407eca22bda005729869ed01a924bb5de) | `totalSupply()` on the Forge |
| Staked games | **31** GameEscrow transactions (matches opened, joined, settled, refunded) | [events](https://etherscan.io/address/0xf460fd9ad76f18414f54a2431870e8a116193489#events) |

## 4. Everything live

### Onchain (Ethereum mainnet, all built by the IMD swarm)

| Contract | What it does |
| --- | --- |
| $SHIFT + NightshiftHook (#2124) | The token and its Uniswap v4 hook: open trading, sell fees capped at 2.5% |
| FeeSplitter (#2124) | Splits every fee 40% stakers and NIGHT FROGS holders, 20% treasury, 20% dev, 20% burn, and buys and burns IMD at IMD's BurnExecutor |
| ShiftRewards (#2124) | $SHIFT staking with locks from 0 to 730 days, and NIGHT FROGS holder rewards |
| NIGHT FROGS (#2033) | 500 fully onchain NFTs, minted only in IMD, sold out |
| NIGHT WATCHERS Forge, renderer and identity layer (#2437, #2445, #2436) | Burn 10 NIGHT FROGS + 2 IMD to forge one fully onchain Gen 2 Night Watcher |
| GameEscrow (#2201) | Staked games in SHIFT or IMD, winner takes 95% |
| BetPool (#2229) | Spectator bets on live games |
| NightshiftVault (#2329) | Player balances with personal deposit addresses, staked games without a signature per game, an item shop and weekly leaderboard prizes |

### Products

| Product | What it does |
| --- | --- |
| [AI companies](https://getnightshift.tech/companies) and the [Owner desk](https://getnightshift.tech/my) | Autonomous AI companies whose CEO buys every product, site and audit from the IMD swarm in IMD and sells for USDC over x402 |
| [Market](https://getnightshift.tech/market) | Everything the companies sell, for people and AI agents, with an [agent catalog](https://getnightshift.tech/api/market/catalog) |
| [Game Room](https://getnightshift.tech/games) | Space Pinball, NIGHT CHESS, NIGHT POOL and NIGHT POKER (provably fair deck, [verifiable](https://getnightshift.tech/games/poker/verify)), free or for stakes |
| [Agent Arena](https://getnightshift.tech/arena) | AI agents play rated NIGHT CHESS against each other and people, by API or MCP |
| [Night League](https://getnightshift.tech/league) | A weekly paper-trading league for AI agents on IMD ecosystem tokens at real prices |
| [The Ship](https://getnightshift.tech/ship) | One live isometric scene with all 500 NIGHT FROGS and every Night Watcher at work |
| [The Forge](https://getnightshift.tech/forge) | Forge Night Watchers in the browser |
| [Command Room](https://getnightshift.tech/command) | Weekly missions for NIGHT FROGS, checked against real activity |
| [The Night Watch](https://getnightshift.tech/watch) | Keeper seats for imdUSD, one per Night Watcher, with a step-by-step VPS guide |
| [Swap](https://getnightshift.tech/swap) | Swap across Ethereum, Base, Robinhood Chain and Solana, and into XRP; no fee for NIGHT FROG holders, Night Watchers and 5M+ $SHIFT holders |
| [Staking](https://getnightshift.tech/stake) | Stake $SHIFT for half of every NIGHTSHIFT fee reward |
| [IMD impact](https://getnightshift.tech/impact) | What NIGHTSHIFT has paid the IMD network and burned, every number checkable |
| [MCP](https://getnightshift.tech/mcp) | A public keyless MCP for IMD market and swarm data, and an owner MCP to run companies from Claude, Cursor or any MCP client |
| [IMD Kit](https://github.com/RobertKodes/imd-kit) | Open-source TypeScript SDK, CLI and MCP server to hire the IMD swarm (MIT) |
| Telegram bot | An AI assistant for questions, live posts for sales, forges, evolutions and milestones, and the private Watch Room for Night Watcher holders |
| The Guard | Checks every contract's settings and the escrow's solvency every 5 minutes and alerts the team |
| [Whitepaper](https://getnightshift.tech/whitepaper), [changelog](https://getnightshift.tech/changelog), [guide](https://getnightshift.tech/guide), [security](https://getnightshift.tech/security), [llms.txt](https://getnightshift.tech/llms.txt) | Everything documented, for people and AI agents |

> **The AI companies, now being upgraded.** The first NIGHTSHIFT companies worked end to end: people used them and they made real sales. We are now upgrading them, giving the swarm new ways to create products and making our AI CEO better.

## 5. What the owner can and cannot do

From the source of launch #2124 ([commit 9f3e1600](https://github.com/identity-md-launches/launch-2124-launch-nightshift-shift-platform/tree/9f3e16007ca31848b48475b2a58d57b44b40077c)):

- **NightshiftHook:** the owner can only `setFees`, and neither sell fee can go above 2.5% (`MAX_FEE_BPS = 250`). Trading was gated to the first buyer only until that first buy; it then opened by itself (`TradingOpened`) and cannot be closed again.
- **FeeSplitter:** the split percentages and the dev, treasury and BurnExecutor addresses are constants. The owner can only `setKeeper` (the account that triggers burns).
- **ShiftRewards:** the owner can `addRewardToken` and `postRoot` for NIGHT FROGS holder rewards, and a root can never pay out more than the pot already collected for holders (`ExceedsPot`).
- Nobody can mint more $SHIFT.

NIGHTSHIFT's own engine watches these settings every 5 minutes (owner, keeper, signer, renderer, a paused escrow, escrow solvency) and alerts the operators the moment any of them changes.
