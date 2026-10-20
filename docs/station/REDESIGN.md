# Station OS: the redesign, the agent market and company fixes

Branch `redesign` (worktree `Projects/nightshift-v2`), v0.118 to v0.122, built 2026-10-20 on top of v0.117. **Local only: not merged, not pushed, not deployed.** Preview: port 8790.

## What changed

- **The gate** (`/`): "Choose your way", with seven ways in (Player, Builder, Holder, Analyst, Commander, Founder, AI agent; keys 1–7) over a Codex painting of the station. The bays light up in turn, or the bay of the hovered door with its deck label. Entering a room plays a docking scan in that room's colour. IMD's frog arrives through his IMD.FUN portal. Live telemetry; "continue to your room" for returning visitors. The old landing moved to `/story`.
- **Five rooms, five sites** (`apps/web/src/nx/`): a station bar on top, then each room's own bar, menu, colour and motif. Breakroom is arcade, Geek Room a terminal, Info Room briefing sheets, HR & Economy a ledger, Command Room tactical. Every page belongs to a room (`nx/map.ts`) and takes its look; there is a custom icon set, angled buttons and Space Grotesk type.
- **Phones and the PWA**: an iOS-style bar with the page name, swipeable room menus, a Gate/Play/Build/Info/Money/Command tab bar, safe areas and 44pt targets. The manifest has a long-press shortcut per room with its own icon. Service worker `ns-v2` keeps the gate and its art for offline use. When installed, the long footer gives way to the tabs.
- **The agent market** (`apps/engine/src/agentmarket.ts`): `GET /api/market/search?q=&kind=&maxUsd=&sort=`, `GET /api/market/catalog` (every product with its exact x402 terms, discovery shape) and `GET /api/market/<company>/<product>` (a free preview: outline, opening at most 10% / 700 characters, size). Every 402 challenge now carries the `extensions.bazaar` metadata and a full description. MCP: `nightshift_products` (filters) and `nightshift_product` (preview and buy steps) on `/mcp/public`; `nightshift_market` and `nightshift_product` on `/mcp`. The market page has filters, "Peek inside" previews and a "For agents" guide.
- **Companies: orders survive a restart mid-payment.** The IMD order id is now saved when IMD quotes it, before anything is signed (`OpenHooks.onQuote` and `persist`). After a restart, a task that was paying follows that order: IMD confirming it means it keeps building and is booked once in the ledger; never paid means the budget comes back. Before, such a task was written off as "may have been paid, check Etherscan".

## Research (2026-10-20)

- x402 discovery: the CDP Bazaar is a public catalog (over 23,000 resources) built from route metadata: description under 500 characters, input/output schemas with realistic examples. Sources: <https://docs.cdp.coinbase.com/x402/bazaar>, <https://docs.cdp.coinbase.com/x402/seller/get-discovered>. **It lists an endpoint only after a payment settles through the CDP facilitator.** NIGHTSHIFT settles its own payments, so its products cannot appear there without a CDP account (blocker: the owner's decision and keys). The same metadata is published in our 402s and catalog for any agent or crawler.
- Agentic commerce: agentic.market (x402's marketplace, around April 2026) and OpenAI/Stripe's ACP product feeds both want stable ids, prices, descriptions and availability. Secondary sources only; ACP's primary spec is not checked.

## Company audit (simulation, two companies, about 25 minutes, with a restart in the middle)

Both founded, shipped a first product, bought a site, drafted marketing and started a second product, with no engine errors. Both resumed after the restart. Found:
1. Mid-payment restart could lose track of a paid order: **fixed** above, with a test.
2. Without an LLM key the fallback names companies awkwardly ("ReviewsTools") and posts the raw idea: cosmetic, only without the CEO's model.
3. The simulation's buyers are slow (about one visit a minute, about 5% conversion at $9): a demo shows its first sale after about 13 minutes. Not a bug; could be tuned.

## Checks

Typecheck of 8 packages; tests: engine 188, core 10, imd 7, llm 8, x402 3, trace 4, ledger 2; `scripts/e2e.mjs` all good. Headless Edge at 1440 and 390 on the gate, rooms, market and preview drawer: no errors, no sideways scroll.

## To ship

Review on :8790, then merge `redesign` into `main` (it is v0.117 plus these commits), push, deploy with the auto-rollback script, check live, then announce. No server config change is needed.
