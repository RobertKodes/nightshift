# The Forge: NIGHT WATCHERS, the NIGHT FROGS Gen 2

Burn exactly 10 NIGHT FROGS and pay 2 IMD to forge 1 Night Watcher. The share of rare frogs in the 10 sets the tier, the tier sets the multiplier and the Night Watch seat. A forge with #1 also makes The Captain. Built 2026-10-21/22 on branch `forge` (worktree `Projects/nightshift-forge`), not deployed.

## Facts it rests on (checked onchain 2026-10-21)

- NIGHT FROGS `0x55b8…8a0c`: 500 minted, revealed 2026-10-17 (VRF), **no burn function**, `transferFrom` to `0x…dEaD` works (simulated, ~60k gas), no transfer limits, not upgradeable, owner powers gone except ownership transfer.
- Renderer `0x4D9B…5D67` exposes `traits(id, word)`, `traitName`, `traitSVG`; ArtStore `read(i)` is public. So a new contract can read every frog's traits and reuse the art onchain.
- 101 holders; 25 hold 10 or more. Floor ~0.011 ETH. IMD ~$5.76.
- Prior art: fixed recipes (Checks VV, Gods Unchained fusion) worked; luck-based rolls get gamed and look like gambling. Notes: session scratchpad `frogs/prior-art.md`.

## The rule

| Rarity (statistical trait rarity, fixed) | Frogs | Forge points |
|---|---|---|
| Legendary (rank 1–25) | 25 | 16 |
| Epic (26–75) | 50 | 8 |
| Rare (76–150) | 75 | 4 |
| Uncommon (151–275) | 125 | 2 |
| Common (276–500) | 225 | 1 |

Genesis #26–77 bring at least 4 points and #2–25 at least 8, so ten of them always reach the tier that pays what they earned together.

| Tier | Points | Shift hours and missions | Night Watch seat (share, cut) | Company slots | Art |
|---|---|---|---|---|---|
| I Shift Lead | 10–19 | 10× | 1×, 10% | +3 | neon glow, back light |
| II Foreman | 20–39 | 15× | 1.25×, 9% | +4 | + light rays, inner frame |
| III Supervisor | 40–79 | 20× | 1.5×, 8% | +5 | + glowing eyes, ring, 6 embers |
| IV Chief | 80–127 | 30× | 2×, 7% | +6 | + holo sheen, pulsing frame, 10 embers |
| V Night Boss | 128+ | 40× | 3×, 6% | +8 | + spinning rays and rings, crown, double border, 14 embers, name onchain |

**Never less.** A Night Watcher earns its tier's multiplier or the sum of its 10 frogs' rates, whichever is more (`watcherRate` in `apps/engine/src/forge.ts`; the inputs are stored onchain). Ten commons: 10 → 10×. Ten Genesis: 20 → at least 20×. Ten Legendary: 13 → 40×.

**Why burn rare frogs.** An ordinary frog earns by its number (1×, Genesis 2×, #2–25 3×), never by its rarity, so a Legendary #300 earns what a Common does. Forged, rarity sets the tier: up to 4× the multiplier of a Shift Lead, a 3× Night Watch share, the lowest cut, the best art.

**More reasons to forge.** While a wallet holds a Night Watcher, every other NIGHT FROG in it earns more: the best Night Watcher's `crew` boost, +20% (Shift Lead), +30%, +50%, +75%, +100% (Night Boss); the holder of #1 gets +150% (`crewBoosts` in `frogs.ts`). The hour a new Night Watcher first appears, its forger is credited a week of its hours (`FORGE_BONUS_HOURS` 168 x its rate). And the art: our neon card with an identity.md-style signal layer over it (`SKIN_PARTS`, `skinSvg`: scanlines, a signal barcode from the 10 frogs, orbit rings with a travelling node, an ID line with a blinking cursor, code columns, pixel stars, a lime-to-violet edge), every part animated, fully onchain.

**#1, the Zero-Sleep Captain**, is the top of the crew either way. Kept: **50×**, above any Night Watcher (the best possible is 40×), +150% on the wallet's other frogs, and the Night Watch's **Captain's seat** (share 4×, cut 5%, the most turns to mark), which works now because it follows NIGHT FROG #1. Forged with any 9 others: the forge mints two, **The Captain** (token 0, tier 6 `CAPTAIN_TIER`, 1 of 1: 60×, +150%, the Captain's seat moves to it, #1's own traits and its 1-of-1 onchain marks `ART[3]` in a platinum card with every effect, a third orbit and the `THE CAPTAIN` ID tag) and the Night Watcher those 10 make by the usual rule. #1's 50× is counted once: `watcherRate` leaves #1 out of the other Night Watcher's floor. Plans (`plan`) never put #1 in by themselves; the bench lets a holder pick it.

Every tier opens **the Watch Room**: a private Telegram group. A signed-in holder gets a one-time code on /forge (`POST /api/forge/room`), sends it to the bot (`/start nw_<code>`), and the bot answers with an invite link for one person that expires in 10 minutes. Every hour the bot removes members whose wallet no longer holds a Night Watcher (`apps/engine/src/watch-room.ts`).

Fee: **2 IMD per forge**, 1 to IMD's BurnExecutor `0xe293…c750`, 1 to the dev wallet. At most 50 Night Watchers plus The Captain, at most 4 Night Bosses (a Night Boss needs 6 Legendary + 4 Epic or 8 Legendary).

**No reveal.** Nothing is random and nothing is hidden: the tier and the art are fixed by the 10 frogs, the site draws them before anyone signs, and the contract refuses less than the tier shown (`minTier`).

## The Night Watch

See `docs/watch/NIGHTWATCH.md`. In short: every Night Watcher is a seat in the imdUSD keeper crew; the holder runs `nightwatch/bot.mjs` with their own wallet; the coordinator (`apps/engine/src/nightwatch.ts`) hands out marks and liquidation shares; the cut goes in IMD to the FeeSplitter.

## Code

- `apps/engine/scripts/forge-table.mjs`: rebuilds `apps/engine/assets/forge/table.json` (traits, rank, tier and points of every frog, plus the packed table the contract hardcodes) and `art.json` from the chain.
- `apps/engine/src/forge.ts`: tiers and multipliers, `shiftRate`, `watcherRate`, `preview`, `plan`, `OT_PARTS` (every art string, with `{FIELDS}`), `forgedSvg` (the renderer's exact SVG), `nightFrogSvg`, reads of the forge once `FORGE_ADDRESS` is set.
- `apps/engine/src/forge-routes.ts`: `GET /api/forge`, `/api/forge/wallet?address=`, `/api/forge/preview?ids=`, `/api/forge/art.svg?ids=`, `/api/forge/nf/<id>.svg`, `/api/forge/frog/<n>.svg`, `GET|POST /api/forge/room`.
- `apps/engine/src/frogs.ts`: frogs at `0x…dEaD` stop earning; Night Watchers earn `watcherRate` (stored as id 1000 + n); `frogCount` includes them; `frogSlots`.
- `apps/engine/src/missions.ts`: a Night Watcher (`crew`) crews every mission.
- `apps/engine/src/order-forge.ts`: the three IMD orders, `frog-forge-art` (NightWatchRenderer: the card, quoting `OT_PARTS` word for word, 5 keccak test vectors), `frog-forge-skin` (NightWatchSkin: the identity layer, quoting `SKIN_PARTS`, 3 vectors) and `frog-forge` (the NIGHT WATCHERS ERC-721, its rules and fee, `setRenderer(renderer, skin)` once; the image is the renderer's svg minus `</svg>` + the layer + `</svg>`, exactly `forgedSvg`). All three passed `/requests/check` with 0 blockers on 2026-10-22 (7,846, 4,318 and 5,063 characters). `forge.test.ts` pins the vectors to `rendererSvg` and `skinSvg`.
- `apps/web/src/ForgePage.tsx` + `forge.css`: `/forge`. `?wallet=0x…&ids=a,b,…` makes shareable previews.

## Going live

1. In /setup → swarm orders, pay `frog-forge-art`, `frog-forge-skin` and `frog-forge` from the dev wallet (0.5 IMD each through Intake). They can run at the same time.
2. When all three are deployed: check the renderer and the skin against their vectors (keccak) and the forge against the spec, then call `setRenderer(<renderer>, <skin>)` once from the dev wallet. The forge refuses to forge until then.
3. Set `FORGE_ADDRESS` in /setup and pin it as `FORGE` in `apps/web/src/ForgePage.tsx`.
4. Watch Room: create a private Telegram group, add the bot as admin (invite users + ban users), put its chat id in /setup → `WATCH_ROOM_CHAT`.
5. Preview locally, get the owner's OK, deploy.
