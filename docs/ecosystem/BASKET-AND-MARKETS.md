# Basket, markets and cooperation: research addendum
Snapshot: 19 October 2026.

## Correction to the discovery scope
The earlier 195-record inventory covers company workflows, not the entire IMD ecosystem. Basket, AskSwarm and additional betting products are delivered through standalone contract, deployment and website jobs. Discovery must combine workflows, jobs, launches, published repositories and community listings, then deduplicate by project, chain and deployment. A token name is not a unique project identity.

This follow-up searched public jobs for basket, betting, prediction and wager, examined selected deployment records, read Basket's current website README and pinned vault documentation, and inspected SwarmMarket at its recorded deployed-source commit. Search results include unrelated oracle questions and repeated updates; they are not a count of independent products. No funds were moved, contracts audited independently or integrations deployed.

## Founder context
Robert describes Nightshift as an existing product-creation and sales system with a shift-based CEO hiring the IMD swarm, NFTs, SHIFT, staking, PvP games, agent participation and spectator bets. The integration objective is mutual utility: add capabilities Nightshift lacks, supply useful interfaces or agent distribution to other projects, and generate attributable activity for IMD. The reported historical burn/stake totals and NFT sellout are founder-supplied context, not independently re-verified in this addendum.

Keep player duel payouts separate from spectator-bet economics in public explanations. Nightshift's latest retrieved BetPool job specifies a 5% fee on the losing side and weighted winning stakes; that is not the same as saying every betting pool pays a flat 95% of its entire pot to one winner.

## Basket Protocol
The current website source targets vault 6 on Robinhood Chain 4663:
BaskVault/BASK: 0x739fd5b653aa092a434534fa1ade67c1770b5a5b.
The published site record points to https://basket-protocol.sites.imd.fun.
Source: https://github.com/identity-md-launches/launch-877-basket
Pinned vault source: https://github.com/identity-md-launches/launch-1110-basket/tree/50acd7248c2ce59907a963a648115900d629f352
Latest retrieved site job: https://explorer.imd.fun/jobs/833805dd-670e-466c-b230-1f22d80673dc

BASK represents shares in a Stock Token index vault. The pinned documentation describes in-kind deposits and pro-rata redemptions, not automatic portfolio rebalancing. Deposit eligibility depends on asset health, prices, configured hours and other controls. Redemptions do not require price feeds, but a failed stock transfer can become an amount owed that must be claimed. Issuer restrictions and chain availability remain external dependencies.

Its fixed fee is 50 basis points, enabled only after a fee recipient is configured. This fee does not become Nightshift revenue because we display the vault. Owner and guardian configuration, timelocks and current fee-recipient state must be visible in any adapter.

**What Nightshift can add:** a read-only Basket building showing holdings, composition, deposit availability, queued claims and configuration changes; an MCP interface that explains these states to agents; alerts and accounting exports. A future transaction adapter must pin vault 6, chain and runtime, preserve quote minimums and deadlines, and require scoped user approval. Do not use abandoned vault addresses from historical root sources.

**Mutual value:** Basket receives an additional operator/agent interface; Nightshift receives a useful portfolio service. Managed monitoring could be separately priced. Referral or fee sharing requires a concrete agreement; none was found or established.

## ITEM is separate from BASK
The retrieved ITEM job reports a live Robinhood launch with ItemStaking, BaskUsdgGauge, ItemEthGauge and DevVesting:
https://explorer.imd.fun/jobs/f74046f2-c50a-427c-95b4-3f8762f59392
https://github.com/identity-md-launches/launch-2241-item

ITEM is a reward token; BASK is the vault share. The described gauges use BASK/USDG and ITEM/WETH v2 LP tokens. Starting a gauge requires its pair to exist and an explicit reward allocation to be funded. Contract deployment does not prove either condition. The public job records note a 740-million-ITEM funding requirement across gauges and vesting. Check actual funding, start state, pool identity and reward release before showing an active yield.

A monitoring panel is a useful first integration. Do not describe LP deposits as simple BASK holdings or promise fixed returns. A second ITEM job was executing when searched, so version lineage needs another check before enabling actions.

## AskSwarm: complementary settlement
Deployment records show:
- Ethereum SwarmMarket, launch 2190: 0x4964d5f08c71e71d490a9b8a30ed796fc38afa55.
- Ethereum SwarmWager, launch 2189: 0xc0b130319ad1e9bb059bc8aab147ca064399bbe6.
- Robinhood launch 2223: registry 0xf3a79f962ec1e75f0087af5491a69dee2a869012; market 0x6c95a84944b05e7de5000caef80a7c487aa57cb8; wager 0xd237dd7564edb7a026613ebb6da31da0292af96c.

Sources:
https://api.imd.fun/launches/01cfb128-811e-4584-8035-85249f0a4884
https://api.imd.fun/launches/9781dc7e-23dc-4f1c-93f8-4766c016cac7
https://api.imd.fun/launches/ffd8f76a-484d-4366-b1d6-a3100b9766e4

The registry stores verified oracle answers. SwarmMarket offers pooled yes/no markets; SwarmWager offers matched two-party wagers. SwarmMarket's recorded source commit 87a283bd813de9d56d75ded5821ec7640470404a contains a one-hour resolution window and a 2% losing-pool fee split between creator and treasury. Earlier review findings about unbounded resolution timing should not be presented as unresolved in this version. Absolute evidence windows are still needed for time-sensitive questions.

**What Nightshift can add:** discovery, readable question terms, evidence-window validation, result monitoring, operator alerts and agent-visible receipts. Keep external oracle settlement separate from Nightshift's verified game-result signer. Creator fee eligibility is role-specific; linking an existing market grants no commission. We have not checked market liquidity, all current configuration or every settlement path.

## Verdict is not one unambiguous project
A standalone Verdict deployment uses VerdictBurnVault, VerdictOracle and VerdictMarkets on Ethereum, launch 1346:
https://api.imd.fun/launches/f738bb79-c5d4-41ed-8031-23b6c934f2f8
Markets address: 0x279ac25fb2ef2239241c439a007f39c42f99e334.

The deployment brief describes allowlisted market creators, IMD/WETH collateral and configurable oracle dependencies. Creator admission starts restricted; do not assume Nightshift is authorized. The brief sets a 2.5% total fee with a 1.5% creator component, with different burn/treasury splits by collateral. Verify the exact fee base and current settings against deployed source before quoting earnings.

This is distinct from the earlier Tribunal/VERDICT company workflow and from token-only launches sharing VERDICT branding. Store chain, contract and source identity in the directory.

## Other betting and gaming candidates
| Project | Research status | Recommended treatment |
|---|---|---|
| Hamster Hour | Completed company workflow; physical-wheel observation and oracle-dependent markets | Read-only market/history panel first; reconcile final accepted source with early review findings |
| Tribunal / Verdict | Separate company workflow with oracle-settled prediction markets | Keep distinct from launch 1346; review setup and signer configuration |
| Sorphera | Latest retrieved Passport work is release rehearsal, explicitly excluding production sales | Experimental listing; no claim that public lottery sales are live |
| CAT WARS | Earlier company workflow blocked | Watchlist until a newer successful deployment is verified |
| Oddsmaker, Wager, Draw, Ticket, Noughts | Sepolia examples in the original inventory | Sandbox district only |
| FAIRDRAW | Community verifiable-draw tooling | Potential event/draw transparency integration; not a generic casino |
| Nightshift BetPool | Own contract job reports live Ethereum deployment | Integrate existing spectator system rather than build a competing copy |

Sorphera source: https://explorer.imd.fun/jobs/60960f29-4054-4c00-ac58-4788e78800c9
Hamster Hour: https://explorer.imd.fun/jobs/51bec67e-efec-4e88-bb68-297892343ce0
Nightshift BetPool: https://explorer.imd.fun/jobs/583d6d41-bf45-4af4-beca-cb8ac23a2128

## What we contribute across projects
Build a shared agent integration kit, with reviewed project metadata, capability descriptions, read/quote/action separation and normalized receipts. Useful missing pieces must be verified with each project's current tooling; this research does not establish that no competing adapter exists.

The strongest pilot is:
1. Basket read-only vault/claim monitoring.
2. AskSwarm question/result discovery and receipt display.
3. Nightshift game and spectator events feeding the same town activity interface.
4. Proof House gallery/broker reads alongside these services.

Each partner keeps its contracts, economics and branding. Nightshift offers the agent interface, workflow coordination and public activity view. Signed opt-in identities and source-backed receipts support trust; idle avatar movement remains cosmetic.

Measure successful cross-project tasks, repeat operators, attributed partner traffic and paid outcomes. Do not use token turnover or burns as substitutes for platform revenue. No referral agreements, partnership claims, outreach, automatic staking or wagering were authorized or performed here.
