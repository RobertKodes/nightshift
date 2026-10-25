# Crews launch: progress notes

Working notes for the Crews launch (started 2026-10-25), kept so the work survives a context reset.
Newest first under each heading.

## Findings checked on 2026-10-25

- Coinbase x402 Bazaar (public discovery API, 53,498 resources): the only NIGHTSHIFT resource indexed is
  LeadNest's playbook (`/buy/leadnest/p-64ef…`, payTo 0x00b0…089e, last updated 2026-10-20). Nothing for the
  house wallet 0x989d…5a36.
- Root cause for the house services: `services/house.ts` settles with `checkout.settle(...)` without the
  offer, and the CDP facilitator path needs it, so every house payment would settle itself and never be
  indexed. Coinbase's validator accepts all three house services' metadata (`valid: true`, simulation
  `accepted`). Indexing still needs one settled payment through CDP.
- MCP usage (from v0.303): almost all sessions are discovery probes; very few tool calls.

## Plan

1. House settlement through CDP (pass the offer). Verdict wording: no blanket "safe".
2. Watchtower module (`apps/engine/src/watchtower/`).
3. Crews core (`apps/engine/src/crews/`): job ledger, metrics, season, Research Desk, Build & Check, operators.
4. Recruiter (`apps/engine/src/recruiter/`): durable outbox, caps, pause, digest.
5. Integrations (`integrations/`, `integrations/nightshift-client/`, `examples/`).
6. Wiring, offers, MCP tools, proof dashboard, web pages; tests; deploy; Bazaar recheck; first recruitment cycle.

## Status (2026-10-25, v0.310 pushed, not deployed: AWS session expired)

Tested locally (sim engine on a copy of demo data, real Ethereum and GitHub reads):
- Watchtower: baseline then comparison on $SHIFT at block 26,268,8xx, 14 checks completed, 0 unavailable; paid routes answer 402 at $0.05 / $1.00 (holder $0.025 / $0.50).
- Build & Check: quick check of https://getnightshift.tech/mcp/public: reachable pass, MCP pass (18 tools), x402 warn (a free endpoint).
- Outside operator: SIWE Arena registration, operator registration, onboarding run passed, listed as an external crew; onboarding without the key refused (401).
- Recruiter: dry run discovered 183 public GitHub repositories, qualified 155, sent and drafted nothing; starts paused.
- Proof: 59 simulated payments excluded as test, no profit figure.
- Pages: /crews, /crews/:id, /watchtower, /agents/start, /proof at 1280 and 390 px, no overflow, no console errors.
- Engine tests: 750 / 750. Web: tsc and vite build pass.

Blocked:
- Deploy, the Telegram post and the first real recruitment cycle need the AWS session (`aws login --profile solstones`).
- Bazaar indexing of the house services needs one payment settled through the CDP facilitator per resource, after deploy.
- ClawHub, elizaOS registry, Virtuals ACP, Glama, Smithery, mcp.so, MCP Market need the owner's own accounts.

Next after access: deploy (OPERATIONS.md), verify live, recruiter dry run then unpause, registry entry v1.2.0, Telegram post.
