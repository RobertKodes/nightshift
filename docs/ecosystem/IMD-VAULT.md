# IMD Vault: Nightshift integration assessment

Research date: 2026-10-19. This document proposes an integration; it does not deploy a vault, move funds, certify safety, or implement an adapter.

## Evidence and deployment

The IMD API reports Ethereum job b384d442-601d-4fbb-9b90-3681b2aa1868 completed and launch 2244 live:
- Job: https://api.imd.fun/jobs/b384d442-601d-4fbb-9b90-3681b2aa1868
- Launch: https://api.imd.fun/launches/d4303b9d-4c8d-4548-9dc4-a10e770c5d53
- Source inspected at commit ccfe47ac07f63b69ffa62313878343f4569b0756: https://github.com/identity-md-launches/launch-2244-audit-deploy-imd-vault
- Reported factory (chain 1): 0xdbaff609cd0500527a2a102f5cbbbbc70fd2ff5b
- Reported deployment transaction: 0x7aa61ef647023da5d49b7fc0d18fd56cfe43b45f5c00719d37af4a0040e78d38
- Reported block: 26227712.

These are API deployment claims, not an independent RPC bytecode verification. The cloned source HEAD matches the pinned commit. Its README's “not deployed yet” text predates the API deployment report. Robinhood job 64ce1d7b-85d2-42cf-a196-0dea01c6cb65 was executing when checked; do not present it as deployed until verified.

## What the contracts provide

VaultFactory registers vaults and creators. VestingVault releases team allocations on a schedule; TreasuryVault lets a manager queue delayed withdrawals to allowed destinations. These complement Nightshift's company creation, product sales, games, and betting; they do not replace those products.

“No owner” does not mean no permissions: treasury managers and vesting beneficiaries still exist. The useful property is bounded custody rules without an owner/admin escape path.

Important display semantics:
- Treasury rate is capped at 25% per fixed seven-day epoch (block.timestamp / 7 days), not per rolling seven days. The first execution sets that epoch's cap from the then-current balance; later deposits do not increase it.
- Two epochs may fall within a rolling seven-day interval. At the maximum rate, 25% plus 25% of the remaining 75% permits 43.75% of the initial balance to leave, absent inflows. The README and TreasuryVault.sol explicitly document this.
- Treasury withdrawals wait at least 24 hours. Show the actual vault delay, destination, amount, execution eligibility, expiry, and transaction evidence.
- Vesting duration is at least four weeks. Bound-token top-ups share the original schedule and may already be partly or fully releasable. Balance is not synonymous with locked balance.
- Open prelaunch vaults can receive a swarm allocation through remainderTo. For open vesting vaults, record token arrival with sync(token); the schedule accounts for recorded arrival. This needs launch-specific validation before routing allocations.
- Rule tightening, manager changes, and beneficiary changes have their own contract semantics; “immutable” should not imply every parameter never changes.

## Radar seal and attribution

Radar's seal is an offchain review policy, not a contract guarantee. The README describes a paid fee, at least 3% of supply actually locked (balance minus releasable), and project review. Open vault tokens also need the specified single-address checks.

Authenticate project affiliation through creatorOf(vault) and a project-confirmed wallet. After a token's fee is paid, others can create vaults for that token; merely appearing in vaultsByToken does not prove project endorsement. Index creation events with creator attribution instead of trusting an unbounded registry list.

Only display “Radar verified” from an authoritative Radar source with timestamp and source link. Otherwise show “review status unavailable”; Nightshift must not issue Radar's seal itself.

## Recommended first implementation

A read-only IMD Vault / Radar building in the Nightshift town:
1. Factory event indexer with chain ID, block number/hash, finality status, and reorg handling.
2. Project association records authenticated by project wallets, with separate observed and confirmed associations.
3. Vault adapters exposing vested, releasable, actually locked, next unlock, epoch allowance, queued withdrawals, and current restrictions.
4. Agent-readable endpoints and MCP reads for project vault summaries and queued withdrawals, with source contracts, observation times, and stale/error states.
5. Town building panel with vault cards and withdrawal timeline. Animate real observed events distinctly from decorative resident movement.
6. Optional operator alerts after subscription, using stable event IDs and deduplication.

Do not describe custom Nightshift endpoints as an ecosystem discovery standard. Agent documentation and reciprocal links are needed for adoption.

## Revenue and distribution thesis

The factory's documented 5 IMD fee goes to Radar, not Nightshift. There is no evidenced automatic Nightshift referral commission.

Nightshift can charge for services it provides: managed monitoring, notifications, treasury reporting, and company setup workflows. Keep core public evidence readable, and charge for useful operational features. Test demand before setting prices.

A reciprocal integration could let Radar project pages link to a project's Nightshift town profile while Nightshift links to Radar reviews and vault records. This requires Radar participation; reading its contracts alone does not make its operators discover Nightshift.

Sequence: public monitor -> real project onboarding -> paid monitoring experiment -> optional transaction preparation. Treasury locking and remainderTo changes require a separate project-specific decision. No funds were moved in this research.
