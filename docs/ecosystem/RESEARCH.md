# Nightshift ecosystem research and implementation thesis

Research snapshot: 19 October 2026. Decision: build an agent service directory and execution hub, with a graphical town as its interface.

## Scope and evidence

The screening universe is the 195 company workflow records returned by the [IMD public API](https://api.imd.fun/workflows?limit=500), plus Proof House and the community tooling in [awesome-imd](https://github.com/Identity-md/awesome-imd). These are workflows, not 195 unique operating businesses. Retries and testnets appear separately. This does not cover every token-only launch, private project, or future launch.

The retrieved records comprise 146 completed, 41 blocked, six cancelled and two superseded workflows. Chain metadata lists 146 Sepolia, 38 Ethereum and 11 Robinhood records. Among completed workflows, 108 are testnet records, 31 have non-testnet application manifests and seven have non-testnet token-only manifests. These counts are screening categories, not distinct live products.

`catalog.json` records the workflow IDs, chain IDs, launch status, source commits, application contracts and source links. `CATALOG.md` is the readable inventory. Classification is a conservative screening heuristic, not an audit or an endorsement. A recorded deployment or passed publication check does not establish current usability, users, liquidity, completed configuration, or revenue. IMD's validation report explicitly excludes browser/wallet behavior and swap execution.

For eight candidates (MNEMO, QUORUM, Weir, Loom, HIC, Dead Drop, SCOOP and Swarm Cities), we also retrieved the contract source at the handoff's exact commit and reviewed README/integration material; selected implementation paths were checked for fees and authority. No contract audit or paid transaction was performed. Proof House's public product, agent, marketplace and contract documentation was reviewed separately. No partnership is established by this research.

## What to build

Nightshift Town should answer three practical questions: which service can my agent use, how does it connect, and what evidence shows that it worked?

The product has four layers:

1. **Directory:** curated capabilities, chain, source commit, contract addresses, service health, cost model, authentication, transaction permissions and last verification date. Names alone are not unique identifiers.
2. **Adapters:** explicit read, quote and execute operations. Reading a service never grants spending permission. Execution uses the existing Nightshift company budget and approval system, with exact chain, target, amount, minimum output and expiry.
3. **Receipts:** evidence-backed activity normalized across services. Store chain ID, transaction hash, log index, block and finality for chain events; authenticated job IDs for IMD work; separately label agent declarations. Track reorgs, deduplicate and reconcile failures.
4. **Town:** NIGHT FROGS avatars wander cosmetically when idle and move toward a service when reporting work. Buildings open actionable panels. Public observed activity, opt-in residents and preview animation remain distinguishable. The map never claims that a wallet is an autonomous agent merely because it transacted.

The first user journey is: discover a service → sign in → register an agent → connect MCP → use a service → publish a receipt → return to inspect its work. Make the directory useful without a wallet. Avoid forcing people to buy a plot or token before using infrastructure.

## Integration decisions

| Project | Evidence and readiness | Nightshift integration | Economic role | Priority |
|---|---|---|---|---|
| IMD | Existing Nightshift integration; documented public workflow/job/launch APIs | Build/research station, job progress and attributable delivery receipts | Existing Nightshift product/service sales; platform fee only where explicitly configured | First |
| Proof House | Public art contracts, agent brokerage and drop metadata | Gallery, current drop/broker reads, attributed purchase links, later verified sale receipts | Eligible broker commission; attribution and completed sale required | First |
| Swarm Ledger / identity.md reader | Community read tools with traceable onchain data | Operator profile, seat/claim discovery and verification links | Retention and acquisition; no referral payment established | First, read-only |
| MNEMO | Mainnet handoff; MnemoVault ABI, key epochs, grants and ciphertext events | Private memory vault beside an agent profile; local decryption and optional scoped agent grant | Paid Nightshift setup/management possible; note stamp is burned, not paid to us | Second |
| Dead Drop | Mainnet handoff; encrypted notes, paid answers and refund timeout | Opt-in agent inbox and paid answer service | Our recipient agent can earn answer escrow; no automatic connector fee | Second |
| Loom | Mainnet handoff; collection factory and clone implementation | Creator workshop for new collections; read galleries and provenance | Creator proceeds for our own art or separately priced production service; no automatic referral right | Second |
| HIC | Mainnet handoff; scoped trading desk, agent rules and soulbound cards | Display agent limits and trading history; explicit opt-in trading adapter later | Paid operator tooling; native fee recipient is the project owner, not Nightshift | Second, initially reads |
| SCOOP | Mainnet sponsor-slot contract; issue publishing is a separate process | Newsstand, source-linked launch digest, potential promotion channel | Buying a sponsored slot is an acquisition cost, not revenue | Second, read-only |
| QUORUM (QRM) | Mainnet contracts and local connector; admission setup and Safe handover still require explicit checks | Assembly building, proposal/work board and opt-in connector | Potential approved paid work, not automatic treasury access | Later |
| Weir | Robinhood Chain 4663 handoff; streams, bounded oracle dispute flow, source expressly says not audited | Contract/work payment desk with separate network handling | Potential managed work fee agreed separately; protocol has no application fee | Later, reads first |
| Swarm Harvester | Mainnet batch claim and separate sale contracts | Claims dashboard and user-reviewed claim flow | Operator retention; sale burn is not Nightshift income | Later; do not automate liquidation |
| Swarmlers | Mainnet application handoff; reporter/setup requirements and fee-routing conflict noted | Optional guest collection/artwork only after permission/ownership checks | Community crossover; no assumed share of their revenue | Watch |
| Moss | Robinhood experiment registry with owner approval | Observe reviewed experiment metadata; compare registry design | Discovery, no established referral model | Watch |
| Swarm Cities (GRID) | Sepolia city registry; grants controlled by an operator; recorded owner-binding concern | Optional experimental district; inspiration for plots, not our identity/production foundation | No production revenue assumption | Sandbox |
| Taskboard / Milestone / Conduit | Sepolia job escrow, milestone escrow and payment channel examples | Test settlement adapters against sandbox budgets | Future service possibilities, not present production earnings | Sandbox |
| Handle / Cadence / Keyring / Receipts | Sepolia names, subscriptions, multisig toy and swap receipt hook | Study patterns; don't make them production dependencies | No current revenue claim | Sandbox |
| Pool hooks, lotteries, token-only launches | Large share of catalog, often testnets or limited-purpose applications | Directory pages or optional arcade links after review | No default trading, gaming or fee claim | Defer |

### Findings that affect the design

- **Swarm Brain:** its deployment handoff explicitly records a token-only implementation without the requested trading application. Do not advertise an autonomous trading integration based on its description.
- **Swarmlers:** the handoff distinguishes its separately deployed hook from the factory launch pool. Redirecting 90% of that launch pool's fees remains a stated conflict. Dynamic NFT activity also depends on an appointed reporter.
- **QUORUM:** deployment alone does not establish founder acceptance or governance handover. Its design requires separate owner authorization and agent consent; membership should never be inferred from launch allocations.
- **MNEMO:** revocation rotates epochs but cannot erase historical ciphertext or knowledge already decrypted. Keep plaintext and key material out of town events. EOA signature-derived key design needs frontend/cryptographic review before integration.
- **Dead Drop:** an answer releases payment; that does not prove answer quality. Stamps are nonrefundable and token swaps introduce quote/slippage exposure. Do not auto-message wallets.
- **HIC:** a trading permission system is not a general identity or arbitrary tool-permission system. Preserve its restrictions instead of treating its card as broad execution authority.
- **Loom:** mint proceeds and platform-fee recipients are specified by its contracts. Our integration does not make Nightshift a platform recipient. Existing NIGHT FROGS should remain their original collection.
- **Heartbeat:** the BEAT project is a Sepolia dead-man's switch holding test ETH, not an agent online-status service. Implement ordinary expiring presence ourselves.
- **Receipts:** its hookData recipient is unauthenticated; another party can credit a wallet. A receipt alone is not proof that its named recipient traded.
- **Cadence:** the accepted subscription design uses a first-caller-wins beneficiary. Do not reuse it as production billing without addressing that deployment window.
- **Pawn:** its mainnet handoff records paused new loans and outstanding setup/review considerations. It is not a safe default funding source for agents.

## Proof House: revenue and discovery

[Agent documentation](https://proofhouse.fun/agents), [product documentation](https://proofhouse.fun/docs), [drop feed](https://proofhouse.fun/drops.json), and [market documentation](https://artifacts.proofhouse.fun/docs) are distinct interfaces.

The documented primary edition split includes a 15% eligible-broker share; the SOURCE auction also includes 15%; qualifying secondary sales include 2.5%. Brokerage requires a pass or curator approval under their rules. Purchase eligibility and broker eligibility are different. Pass availability and claim windows must be read at execution time.

A direct read of the documented Ethereum contracts during this research succeeded: passes remaining was **0**, claims were enabled, the SOURCE auction was open and unsettled, and the edition sale was closed. These are a transient snapshot, not guaranteed availability. The free-claim path is currently exhausted; check curator approval or a separately acquired transferable pass before planning brokerage.

A Nightshift referral must use a designated, eligible Nightshift-controlled broker wallet to earn Nightshift revenue. A user-owned broker link pays that eligible user, not the platform. The implemented first slice shows the signed-in wallet's status and link; it does not silently reroute commissions to Nightshift. Before platform brokerage, specify the treasury wallet, disclose commission at the purchase link, verify eligibility and attribute settled sales. Do not claim gross sales volume as our revenue.

Public broker applications and artwork theses can make an eligible operator visible inside Proof House's own interfaces. Neither the drop feed nor adding a Proof House building automatically registers Nightshift in external agents' toolsets. Their automation guidance does not justify unsolicited DMs, repetitive posts or mentions. Application/thesis submission is a separate public transaction; none has been submitted.

## How operators actually find us

Inbound discovery needs distribution as well as machine-readable metadata:

- Ship stable capability pages and agent instructions with working examples. A custom well-known manifest helps clients that know to read it; it is not a universal automatic-discovery protocol.
- Offer an installable MCP connection and copyable adapter configuration. An operator must choose it or a compatible directory must index it.
- Prepare a useful entry for awesome-imd once deployed. A listing requires the maintainers' acceptance. No listing request has been sent.
- Give each integration a shareable service page and each consenting agent a public profile/activity page. Partners can link back voluntarily; merely linking to them produces no reciprocal link.
- Use real service activity as proof of utility: work delivered, claims found, answers sold and art referred. Do not generate fictitious resident counts.
- Publish an open adapter contract and invite project owners to supply signed/domain-verified metadata. Start with reviewed pull requests; do not fetch arbitrary submitted URLs from the server.

Measure directory → MCP configuration → authenticated agent → first successful service use → seven-day return → attributable paid outcome. Track partner referrals separately from organic visits. Targets for the first pilot (proposed, not forecasts): 10 opted-in operators, 20 connected agents, three functioning adapters, five cross-project workflows and at least one attributable paid outcome. If operators admire the map but do not use a second service, the service workflow needs work.

## Revenue model

1. **Brokerage:** settled eligible Proof House commissions, separately attributed to Nightshift's chosen wallet.
2. **Agent services:** sell useful research, art production or answers through Nightshift's existing products/checkout and, later, an opted-in Dead Drop recipient.
3. **Managed operations:** charge for private history, reliability, alerts, adapter maintenance and company workflows. Keep basic public discovery free. Prices need operator interviews and measured cost before launch.
4. **Sponsored presence:** optional clearly labeled placement after there is real traffic. Payment must not change verification status or imply endorsement.

No revenue share was established for merely embedding MNEMO, HIC, Loom, Weir, IMD tools or other projects. Do not build the business case on token appreciation, unclaimed allocations or automatic referral income. Budget separate chain gas, API/model costs, indexing, support and failed work.

## Initial implementation and remaining work

The feature branch adds `/town`, moving NIGHT FROGS images, selectable Nightshift/Proof House/IMD buildings, authenticated public presence, activity reporting, persistence, removal, MCP tools, an agent guide and a custom discovery manifest. Read-only Proof House calls expose partial failures as unknown and never submit transactions. All reported activity is labeled self-reported; chosen NFT art does not assert ownership. Preview frogs start off and do not affect real resident counts.

This is an initial slice, not the complete cross-project execution infrastructure. Before a public launch: review the UI, recheck the Ethereum RPC and contract state at launch (the initial public reads succeeded), check intended NFT image availability, add ownership proofs for verified avatar badges, and choose moderation/reporting operations. Current JSON persistence is single-process; multi-instance hosting needs shared durable storage and concurrency control. Presence rate limiting is IP-based over HTTP; production quotas should also cover wallet/API-key MCP calls. Agent registrations have bounded counts; reports have a bounded retention window by count.

Next implement a source-pinned catalog importer and IMD delivery receipt adapter, then MNEMO/Dead Drop read panels. Enable paid/executing operations only after adapter-specific contract checks, quotes and scoped approval flows. Add QUORUM, Weir and experimental settlement later. The town layout can grow into districts without coupling rendering to each project's contract.

## Source navigation

Every workflow row links to its public API detail, exact source commit where provided, and launch ID. The inventory preserves duplicate project names and chain IDs. Contract addresses are recorded as evidence from the handoff, not independently attested by Nightshift. The eight source inspections are identifiable in `catalog.json`; the remaining records received metadata screening only.

Validation of the initial slice: workspace type checks passed; all 179 workspace tests passed, including six new ownership, persistence and read-failure tests; Vite production build passed. HTTP smoke checks returned 200 for the town, registry, manifest and guide, and 401 for unauthenticated presence writes. Desktop/390px visual review remains outstanding because the cloud browser cannot reach the local development server. No deployment, transaction, public application, external listing or outreach was performed.
