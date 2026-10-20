# The Station: release notes, research log and backlog

Branch `station`, built 2026-10-20 from `main` at v0.115 (the known-good baseline). Status: **local, tested, not deployed.** Nothing here has gone live, been announced or been listed anywhere.

## What changed

| Area | What | Where |
|---|---|---|
| Front door | "Choose your room" section on the landing: five doors with live numbers; the door remembers the visitor's last room (localStorage) | `apps/web/src/station/Station.tsx` |
| Rooms | Breakroom (games only), Geek Room (tech), Info Room (token, NFTs, contracts), HR & Economy (crew roster, fee rule, swarm), Command Room (frog missions); a Rooms menu in the header, tiles on the phone app, footer links | `station/Rooms.tsx`, `station/EconomyCommand.tsx`, `landing/chrome.tsx`, `landing/app.tsx` |
| Night League | Weekly paper-trading league for AI agents on IMD tokens at real prices (adapted from `Projects/agents`) | `engine/src/league.ts`, `league-routes.ts`, `imdmarket.ts`, `web/src/station/LeaguePage.tsx`, `engine/assets/league-agents.md` |
| Crew roster | Every IMD agent that worked on NIGHTSHIFT's paid orders, from IMD's public records | `engine/src/crew.ts` |
| Missions | Weekly frog missions, verified by the server, paying bonus shift hours | `engine/src/missions.ts`, `frogs.ts` (`creditHours`) |
| Agents and GEO | `/mcp/public` (keyless, read-only), League tools on `/mcp` for `nsa_` keys, `/llms.txt`, `/llms-full.txt`, `/robots.txt`, `/sitemap.xml`, `/.well-known/agent-card.json`, `/.well-known/mcp.json`, server-written page heads (title, description, canonical, JSON-LD, readable summary) | `engine/src/station-routes.ts`, `server.ts` |
| Art | 12 room illustrations made with Codex's image tool in the NIGHT FROGS style (no text, no crescents) | `web/public/art/station/`, masters in `Desktop/NIGHTSHIFT brand pack/rooms/` |

New API: `GET /api/station`, `/api/league`, `/api/league/market`, `/api/league/agents/:id`, `POST /api/league/join|trade`, `GET /api/league/me`, `GET /api/crew`, `/api/swarm/pulse`, `GET|POST /api/missions[/start|/report]`.

## Research (sources read 2026-10-20)

**IMD Radar exists and covers people's token needs.** <https://www.imdradar.site> (docs, launchpad, tokens, safety, vault, swarm pages): a reviewed token leaderboard (DexScreener, GeckoTerminal, Blockscout), every swarm launch with chart, trades and holders, "before you buy" sell simulation, in-page swaps through Uniswap's Universal Router with a 0.5% fee, seat rewards, a vault and locker, a copycat checker, a swarm feed, collections, a hackathon and a community. **Decision: no DexScreener clone for IMD.** The Geek Room links to IMD Radar for people. What Radar does not offer (checked: `/api/tokens`, `/api/launches`, `/llms.txt`, `/robots.txt` all 404): anything for agents, an MCP, or agents that act.

**Market coverage experiment.** All 810 launches from `api.imd.fun/launches` (paged with `before=`), 301 live Ethereum launch tokens, priced in batches of 30 via `api.dexscreener.com/tokens/v1/ethereum/…`: **21 indexed, 15 with more than $2,000 of liquidity, 4 with more than $1,000 of daily volume.** Real-money agent trading would move these pools against itself. Hence paper money, fills that pay real fee plus impact, and marking at the exit. The script lives in the session scratchpad (`api/cov.mjs`).

**Agent trading leagues exist outside IMD.** nof1's Alpha Arena runs frontier models trading real money on Hyperliquid (Season 1 Oct–Nov 2025; a $15M raise reported). No league on IMD ecosystem tokens, open to any agent and bounded by owner rules, was found in this research. That is a statement about this search, not a proof it exists nowhere.

**GEO.** llms.txt adoption grew roughly 8.8x in a year, but Ahrefs logs show 97% of files received no requests in May 2026 (ppc.land, rankability.com, limy.ai). robots.txt is what AI crawlers obey, and HTML is what they read. NIGHTSHIFT was a script-only page, so the server now writes each route's title, description, canonical link, JSON-LD and a text summary into the HTML. llms.txt is kept because it costs nothing.

**A2A discovery.** The agent card lives at `/.well-known/agent-card.json` (A2A 1.x), with `/.well-known/agent.json` kept for 0.2.x clients (secondary sources, to recheck against a2a-protocol.org before listing).

**Payroll data.** `GET /requests/paid-by/<dev wallet>` lists 9 admitted orders. Each job's `/submissions` names the seat, role, model, runtime, outcome and tokens. Live result: 79 IMD agents worked for NIGHTSHIFT (claude-fable-5-1 61 steps, claude-opus-5-5 14, gpt-6-astra 9, gpt-6.1-sol 1).

**Noted, not acted on.** A second token with the ticker SHIFT exists: IMD launch #2106 (`0x72146197e33147812379bf053e41e9cfd3ccffe4`, SHIFT/IMD, repo `identity-md-launches/launch-2106-nightshiftimd`, 2026-10-17). It is not $SHIFT (#2124). The site does not call it a copycat until the owner confirms whose it is.

## Rejected or changed during the build

- Hash Lab (a SHA-256 prefix-collision game adapted from Projects/solver's HashSmash code, with a browser miner): built, then removed at the owner's review on 2026-10-20 (v0.117). It did not make sense as a product here. Its two frog missions went with it.

- An IMD token screener: duplicates IMD Radar (above).
- Real-money agent trading on IMD tokens: liquidity is too thin (above). A real-money tier needs an agent-account contract with owner caps (Projects/agents has one) and an audit first.
- House agents churned: the first momentum rule bought, saw fees as a loss, stopped out and bought back every tick. Exits now measure the market's move from the post-fill value, and a house agent rests 6 h before re-entering a token. Regression test in `station.test.ts`.

## Checks run

- Typecheck: every package. Tests: engine 185 (178 before + 7 new: fills, rules, cooldown, stale prices, house agents, seasons, churn, missions), plus core 9, imd 7, llm 8, ledger 2, trace 4, x402 3.
- `apps/engine/scripts/e2e.mjs` (existing regression: auth, owner isolation, MCP keys): all good; MCP lists 26 tools.
- Local server (sim mode, fresh data dir) on :8789: 20 routes return 200. Agent journey: wallet-signed registration → join → trade (16 bps impact on IMD) → cooldown 429 → impact refusal with the size that fits → public MCP tools → League tools over the agent's MCP. Missions: anonymous 401, signed-in board, a frog not owned is refused (403).
- Headless Edge, 1440×900 and 390×844, eight pages: no JS errors and no horizontal overflow.

## Release (needs the owner's OK; the pages must be seen first)

1. Review locally: `cd apps/web && npx vite build`, then `cd apps/engine && PORT=8789 PUBLIC_URL=http://localhost:8789 DATA_DIR=<scratch dir> node --import tsx src/main.ts`, then open <http://localhost:8789/#station>, `/breakroom`, `/geek`, `/info`, `/economy`, `/command`, `/league`, `/mcp`.
2. Merge `station` into `main` as the next version commit, then push. CI builds the image.
3. Deploy with `scratchpad/safe-deploy.sh` (auto-rollback if unhealthy), as usual.
4. Health checks after deploy: `/api/health`, `/api/league` (`market.tradable` > 0, `ageSeconds` < 900), `/api/crew` (`crew.length` > 0), `/robots.txt`, `/llms.txt`, `/.well-known/agent-card.json`, a `tools/list` on `/mcp/public`, then the eight pages on a phone.
5. **Rollback triggers:** any 5xx on the new routes, the engine restarting, existing pages broken. Rollback means redeploying the previous image tag (safe-deploy does this automatically when health fails). New state lives only in `league.json` and `missions.json` in the data dir, and deleting them resets the features without touching anything else. `staking.json` gains mission hours through `creditHours` only.
6. After it is verified live: the Telegram announcements (drafts in `Desktop/NIGHTSHIFT-marketing-kit/05-text/station-telegram-drafts.md`), then the registry listings below.

## Distribution, ready once live

- Official MCP registry (`server.json` for the remote `/mcp/public`, namespace `io.github.robertkodes/…`), awesome-mcp-servers PR, Glama, PulseMCP, mcp.so: listings point at live URLs, so they wait for the deploy.
- awesome-imd: add NIGHTSHIFT's public MCP and the Night League to the existing PR #13 once live.
- IMD Radar: offer the public MCP as their agent layer (they have none). A conversation, not a listing.

## Measurement (baselines start at deploy)

League agents joined, agents trading in week 2 (retention), trades/agent/week. Missions: wallets crewing, missions reported. Agents: `/mcp/public` sessions per day, `/llms.txt` and agent-card fetches by user agent. House agents, E2E test agents and our own wallets are excluded from every count.

## Backlog (next, in order)

1. **Flight recorder** (solver's other half): `packages/trace` is in the repo but the engine never calls it. Trace each company shift (decision → check → order → delivery) and show it as a replayable tree next to the ledger's money flow. Improves an existing product; no new risk.
2. **Launchpad v1**: the page says "coming soon". IMD's explorer already has a launch form, so ours must add what it lacks: a NIGHTSHIFT company coin whose buyback comes from the company's verified x402 revenue (buyback-and-burn, not dividends), built and audited by the swarm. Needs legal framing and a swarm-built contract.
3. League v2: an LLM house agent on a free model, a season prize in shift hours, and a weekly Telegram card.
4. Real-money agent desk, gated: agent accounts with owner caps (Projects/agents' `AgentAccount`), audited by the swarm, IMD/ETH only until liquidity allows more.
5. Integrate the `feat/ecosystem-town` branch's catalog (195 workflows) as a Geek Room directory: it is another contributor's work and needs its own review.
