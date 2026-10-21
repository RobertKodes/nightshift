# The Night Watch: imdUSD keepers

The keeper crew of [imdUSD](https://imdusd.com), IMD's CDP stablecoin (live on Ethereum since 2026-10-11). Every Night Watcher (NIGHT FROGS Gen 2, `docs/forge/FORGE.md`) is a seat, and NIGHT FROG #1 holds the Captain's seat. Built 2026-10-22 on branch `forge`, not deployed.

## What a keeper does (imdUSD's rules, checked onchain 2026-10-22)

- Vault `0x0b69F8DA8D8cE521d74Ea69a7A3475B77302EF82`, imdUSD `0x61aAF8a992A3143e2B0C9cB0030b9fE702854a25`, collateral sIMD `0x9Efa934D9fAd4AE28c998a40195646b965a97247` (ERC-4626 over IMD).
- A loan under `mat` (170%) can be marked (`barkFor(owner, beneficiary)`); after the grace (`lull`, 6 h) and inside the `tail` (1 h) it can be liquidated (`bite(owner, debtToRepay)`), which burns the caller's imdUSD and pays sIMD worth the debt plus 20% (`CHOP_PERCENT`). Of that bonus, 10% goes to the marker (`chip`) and 10% to imdUSD's Treasury (`cut`): a liquidator keeps 16% of the debt, 18% if it marked too. Partial bites are allowed. Everything needs fresh prices (IMD oracle panels); stale is the normal quiet state.
- On 2026-10-22: 145.6k imdUSD out, 148.8k debt, 18 loans above dust, the closest at 242% (it goes under after an IMD fall of ~30%), the largest 83.5k imdUSD at 295%. Peg pool price $0.990.
- Reference keeper: [fa11up/imdusd-keeper](https://github.com/fa11up/imdusd-keeper) (MIT). Our bot is written from scratch after its design (copying it into the repo was refused by the session's safety rules); its README credits it.

## How the Night Watch works

- **Seats.** Seat 0 = the Captain's seat, held by `ownerOf(1)` on NIGHT FROGS, then by `ownerOf(0)` on the forge once `captainForged()` (`captainHolder` in nightwatch.ts). Seats 1–50 = Night Watchers, held by `ownerOf(n)` on the forge. A seat's holder pairs one keeper wallet with an EIP-712 signature (domain `NIGHTSHIFT Night Watch` v1, chain 1, `Seat(uint256 watcher, address keeper, uint256 issuedAt)`), on `/watch`. One keeper per seat; a sold seat stops getting jobs until the new holder pairs.
- **Setup** (like an IMD seat): `curl -fsSL https://getnightshift.tech/nightwatch/install.sh | bash` downloads the bot's files from `/nightwatch/<file>` (only `BOT_FILES` in `watch-routes.ts` are served), installs it, makes a fresh keeper key in `.env` (mode 600) and runs `node bot.mjs start`, which prints the pairing link and waits for the signature. `GET /api/watch/holder?address=` tells the page and the bot which seats a wallet holds (read onchain) and how each is set up. `node bot.mjs doctor` checks Node, RPC, gas, imdUSD, the pairing, that the holder still holds the seat, the cut and the kill switch. Tested 2026-10-22 against the real routes on a scratch server (scratchpad `forge/harness.ts`, `harness2.ts`): stranger pairing 403, unsigned poll 401, holder check, report-only pass, doctor, the installer up to the pairing wait.
- **Bot** (`nightwatch/`, standalone, viem only): `node bot.mjs start | doctor | pair | (report only) | --execute | --once`; it reads `.env` next to it. Signs every coordinator request (`NIGHT WATCH <keeper> <ts>`, EIP-191), polls `GET /api/watch/jobs` every 15 s, marks and bites only what it is handed, pays the cut. Guard rails: kill switch `state/STOP`, gas ceiling, ETH floor, simulate first, gas margin, MEV Blocker for sends.
- **Coordinator** (`apps/engine/src/nightwatch.ts`, every minute from `engine.ts`): reads owners (Lock/Draw/Earn logs forward, cross-checked with Blockscout every 30 min), positions, marks, feeds and the peg (v4 StateView); `assign` hands out jobs: marks to the seat with the fewest marks for its weight (held 10 min), bites split by `split` (imdUSD × weight, capped at each seat's inventory; shares under 15 imdUSD folded into the heaviest seat with room). Nothing while prices are stale; loans under 15 imdUSD are skipped.
- **Terms** (`TERMS`): weight / cut of the kept bonus. Shift Lead 1 / 10%, Foreman 1.25 / 9%, Supervisor 1.5 / 8%, Chief 2 / 7%, Night Boss 3 / 6%, Captain 4 / 5%.
- **Cut.** On each `Bite` by a seat's keeper, the coordinator records the kept bonus and the cut in IMD (at GeckoTerminal's IMD price then). Payments are counted from sIMD `Withdraw(…, to = FeeSplitter, owner = keeper)` and IMD `Transfer(keeper → FeeSplitter)`. The bot pays what the coordinator reports as due, from sIMD first (`withdraw(due, splitter, keeper)`), else IMD. A seat more than 2 h overdue gets no jobs. The FeeSplitter `0x1119…2d44` splits it like every fee: 40% ShiftRewards ($SHIFT stakers and the frog pot), 20% dev, 20% treasury, 20% burn reserve.
- **Routes** (`watch-routes.ts`): `GET /api/watch` (public status), `GET /api/watch/holder?address=`, `POST /api/watch/pair`, `GET /api/watch/jobs` (signed), `GET /nightwatch/<file>` (the installer and the bot). Page: `apps/web/src/WatchPage.tsx` + `watch.css` at `/watch` (Command Room). Community post on every seat liquidation.

## Where it goes (the owner's plan, 2026-10-22; not built, not promised)

A swarm of agentic NFTs that act onchain with their own money: every Night Watcher an AI agent with its own wallet, the Night Watch one swarm with a shared treasury (a bank account controlled by a contract), shared profit-driven values and instructions written onchain, and profits shared by seat: an autonomous fund run by its agents (keeping imdUSD solid, arbitrage, liquidity, hiring the IMD swarm, voting on what to do next). Shown on /watch and in the Forge FAQ as a plan only. Before any of it: its own contracts and audits, and a legal review (pooled money with shared profit is a regulated activity in most places).

## Not done yet

- Hosted seats (we run the bot for holders who do not want a machine): needs a custody design, later.
- The bot does not relay oracle updates; fa11up's keeper does, and the Intake callback usually delivers them.
- The marker's 2% from a loan another keeper liquidates is not counted in the cut (small).
- The bot is installed by cloning the public repo; publishing it as its own repo or npm package needs the owner's OK.

## Going live

1. Deploy the engine (the coordinator starts on its own) after a local preview and the owner's OK.
2. The Captain's seat can pair at once. Night Watcher seats open when `FORGE_ADDRESS` is set.
3. Push `nightwatch/` to the public repo so the Windows `git clone` path works (the one-command installer only needs the site).
