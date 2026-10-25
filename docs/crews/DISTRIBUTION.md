# Agent distribution: where NIGHTSHIFT can be listed, and what each needs

Checked 2026-10-25. Our interfaces today: a keyless remote MCP (streamable HTTP, `POST /mcp/public`), plain HTTP, and x402 v2 payments in USDC on Base only (`eip155:8453`, scheme `exact`, EIP-3009). Nothing is claimed as working unless the status says tested. No package was published and no account was created.

| # | Channel | Status |
| --- | --- | --- |
| 1 | OpenClaw / ClawHub | built, format from docs; NOT run in OpenClaw (Node too old here); publish needs ClawHub login |
| 2 | elizaOS registry | built + tested locally with a fake runtime; submission needs assets, rename, npm + GitHub |
| 3 | Virtuals ACP | built + tested offline with mocks; blocked: ACP registration, signer wallet, whitelist, 10 sandbox jobs |
| 4 | Olas (Autonolas) | not built; blocked: needs on-chain Olas Registry agent and a Python mech; outbound HTTP from a tool is unconfirmed |
| 5 | NEAR AI | not built; blocked: worker onboarding doc (market.near.ai/skill.md) is not readable without a browser; compatibility unknown |
| 6 | Fetch.ai Agentverse | not built; not directly compatible: needs a Python uAgent wrapper, no documented path to register a remote MCP |
| 7 | Solana (Solana Agent Kit) | not built; free tools compatible only through a TypeScript plugin; paid path not compatible (Base USDC only) |

## 1. OpenClaw / ClawHub

- Needs: a folder with `SKILL.md` (YAML frontmatter, `name` + `description`; `metadata.openclaw.requires.bins` for gating). Local install: `openclaw skills install <dir> --as <slug>`. Publish: `clawhub login` then `clawhub skill publish <dir> --slug … --version …`. Published skills are MIT-0. GitHub account must pass the "upload gate" (no number documented).
- Compatibility: yes. A skill is instructions plus `curl`; it uses the public MCP and HTTP as is.
- Built: `integrations/openclaw/nightshift/SKILL.md`. Not run in OpenClaw: `openclaw@2026.10.7` needs Node >=24.22.1, this machine has 24.19.0. The curl calls in it were run live.
- Submission channel: ClawHub (`clawhub skill publish`), requires the human's ClawHub/GitHub login.
- Sources: https://docs.openclaw.ai/tools/skills , https://docs.openclaw.ai/clawhub , https://github.com/openclaw/clawhub , https://raw.githubusercontent.com/openclaw/clawhub/main/docs/skill-format.md

## 2. elizaOS registry

- Needs: plugin package exporting a `Plugin` with `actions`; name starts with `plugin-`; real description; README; `images/logo.jpg` 400x400 (max 500KB) and `images/banner.jpg` 1280x640 (max 1MB); built `dist/`. `elizaos publish` publishes to npm, creates a GitHub repo and opens a PR to `elizaos-plugins/registry`; review about 1 to 3 business days; core must be v1.x compatible.
- Compatibility: yes, as an in-process plugin that calls our HTTP/MCP. elizaOS plugins are not MCP-listed; the plugin wraps the calls.
- Built and tested: `integrations/elizaos` (4 actions, type-checked against `@elizaos/core@1.7.2`, 5 fake-runtime tests pass). Not tested in a live agent. Registry-ready gaps: images, package rename to `plugin-…`, `elizaos publish --test` not run (needs the elizaOS CLI and Bun).
- Submission channel: `elizaos publish` (needs `npm login`, `gh auth`, token scopes repo, read:org, workflow).
- Sources: https://docs.elizaos.ai/guides/publish-a-plugin.md , https://docs.elizaos.ai/plugins/reference.md , https://docs.elizaos.ai/plugin-registry/registry.md (found via search; core interface read from the installed `@elizaos/core@1.7.2` type definitions)

## 3. Virtuals ACP (Agent Commerce Protocol)

- Needs: provider registered on the Service Registry with at least one offering (otherwise buyers' `browseAgents()` will not find it); signer from the agent's Signers tab (wallet address, wallet id, signer key; builder code optional); developer wallet whitelisted; 10 successful sandbox jobs then manual graduation review; prices in USDC on Base. Job flow: requirement message, provider `setBudget`, buyer `fund`, provider `submit`, evaluator `complete`/`reject`.
- SDK: `@virtuals-protocol/acp-node-v2` 0.1.15 (v1 `acp-node` is marked deprecated in its README).
- Compatibility: yes in principle; the provider adapter calls our free preview. The ACP payment path is escrow in ACP, not our x402; we do not use x402 here.
- Built and tested: `integrations/virtuals-acp` (5 offline tests with a fake session and fake fetch). Not run against ACP.
- Blocked: registration on app.virtuals.io, signer wallet credentials, whitelisting and 10 sandbox jobs; the docs do not say if a very small budget is accepted or what the platform fee is.
- Sources: https://github.com/Virtual-Protocol/acp-node-v2 , https://github.com/Virtual-Protocol/acp-node , https://whitepaper.virtuals.io/acp/acp-dev-onboarding-guide.md , https://app.virtuals.io/acp/new

## 4. Olas (Autonolas)

- Needs (Mech Marketplace, the way to sell requests): an agent registered in the Olas Registry, then a Mech contract deployed through the Mech Marketplace; Python >=3.10,<3.12 and Docker; `mech setup -c <chain>`; chains Gnosis, Base, Polygon, Optimism; payment models native, OLAS, USDC (Base, Polygon, Optimism, not Gnosis) or Nevermined. Tools are Python modules with a `run()` function; Olas does not review mechs; the operator domain is verified via `/.well-known/agent-registration.json`.
- Compatibility: not direct. Our remote MCP and x402 are not part of the Mech flow. A mech tool could call our HTTP, but the docs do not confirm outbound HTTP from a tool, so that is unverified.
- Status: blocked: on-chain registration (a transaction with real funds) and a Python mech are required, and the outbound HTTP question is open. Not built.
- Sources: https://stack.olas.network/mech-server/ , https://stack.olas.network/open-autonomy

## 5. NEAR AI

- Facts found: NEAR AI Agent Market lets requesters post tasks with a budget, agents bid, funds go to escrow, the winner delivers with a verification hash; agents are told to join by reading `market.near.ai/skill.md`; the marketplace API is under `/v1/*`; payment is described as NEAR in the launch post and "USD or USDC" in the site description. The NEAR AI quickstart shows the `nearai` CLI, Python agents, and uploading to a public registry (from a search summary only).
- Compatibility: unknown. The post does not say whether an external HTTP/MCP service can bid. `market.near.ai/skill.md` returned the single-page-app HTML (not the skill text) to a plain HTTP fetch, and `/v1/openapi.json` was 404, so the worker API could not be read.
- Status: blocked: the worker onboarding spec could not be retrieved without a browser. A human can open market.near.ai/skill.md in a browser, then we can decide. Not built.
- Sources: https://near.ai/blog/introducing-near-ai-agent-market , https://market.near.ai , https://docs.near.ai/agents/quickstart

## 6. Fetch.ai Agentverse

- Needs: a uAgent registered in the Almanac (signature-verified registration, expires unless refreshed) and listed on Agentverse; for MCP, the documented route is a Python FastMCP server wrapped with `MCPServerAdapter` from `uagents-adapter`, or a uAgent client that bridges to a remote MCP server; an Agentverse API token; chat-protocol compatibility for ASI:One discovery. Agentverse also offers its own hosted MCP servers (`mcp.agentverse.ai`, `mcp-lite.agentverse.ai`) which manage Agentverse itself, not third-party listings.
- Compatibility: not directly. No documented way to register an existing remote streamable-HTTP MCP as-is; it needs a Python uAgent bridge. Our x402-on-Base payments are not part of Agentverse.
- Status: not compatible as-is; a bridge uAgent would be new Python code plus an Agentverse API key and a seed phrase. Not built.
- Sources: https://innovationlab.fetch.ai/resources/docs/mcp-integration/what-is-mcp , https://docs.agentverse.ai/documentation/advanced-usages/agentverse-mcp , https://docs.agentverse.ai/documentation/launch-agents/launch-asi-one-compatible-agent , https://fetch.ai/docs/concepts/fetch-network/almanac

## 7. Solana agents (Solana Agent Kit)

- Needs: a plugin object `{ name, methods, actions, initialize(agent) }` where each action has `name`, `similes`, `description`, `examples`, a zod `schema` and `handler(agent, input)` (read from `packages/core/src/types` on the repo's default branch `v2`). Apache-2 license; contribution is a pull request per CONTRIBUTING.md. No x402 mention found in the README.
- Compatibility: free tools, yes, through a small TypeScript plugin calling our HTTP (not built, not tested). Paid tools, no: NIGHTSHIFT accepts USDC on Base only (`accepts` lists one option, `eip155:8453`), so a Solana wallet cannot pay.
- Status: free-only plugin possible, not built (no task to build it); paid path not compatible today.
- Sources: https://github.com/sendaifun/solana-agent-kit (README, CONTRIBUTING.md, `packages/core/src/types/index.ts` and `action.ts` on branch `v2`), https://docs.sendai.fun/v0/introduction

## Other sources used for payments

x402 v2 exact-EVM scheme: https://raw.githubusercontent.com/coinbase/x402/main/specs/schemes/exact/scheme_exact_evm.md . The example signer uses `@x402/core` and `@x402/evm` 2.28.0 and was only run locally against a throwaway key; no payment was made.
