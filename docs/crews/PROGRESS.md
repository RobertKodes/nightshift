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
5. Integrations (`integrations/`, `packages/nightshift-client/`, `examples/`).
6. Wiring, offers, MCP tools, proof dashboard, web pages; tests; deploy; Bazaar recheck; first recruitment cycle.

## Status

- Contracts: `apps/engine/src/crews/contracts.ts`.
