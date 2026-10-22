# NIGHT WATCH

The keeper bot of a **Night Watcher** seat. Night Watchers are the NIGHT FROGS Gen 2: 10 frogs and 2 IMD forge one at [getnightshift.tech/forge](https://getnightshift.tech/forge), and each one is a seat in the Night Watch, the keeper network that keeps [imdUSD](https://imdusd.com) solvent.

imdUSD is a dollar stablecoin borrowed against staked IMD. When IMD falls and a loan drops under the vault's minimum ratio (170%), a keeper **marks** it, and once the borrower's grace (about 6 hours) has passed without a top-up, a keeper **liquidates** it: it repays part of the debt with its own imdUSD and receives staked IMD worth that much **plus a 20% bonus**. The bot does this for your seat.

It runs on **your** machine with **your** keeper wallet. NIGHTSHIFT never holds your money: the coordinator only tells the seats which loan to mark and how much of each liquidation is theirs, so the Night Watch works as one crew instead of 50 bots racing each other.

## Seats

| Seat | Share of each liquidation | Cut |
|---|---|---|
| Captain (NIGHT FROG #1) | 4× | 5% |
| Night Boss | 3× | 6% |
| Chief | 2× | 7% |
| Supervisor | 1.5× | 8% |
| Foreman | 1.25× | 9% |
| Shift Lead | 1× | 10% |

A liquidation the crew can cover is split by the imdUSD each seat brings times its share, never more than a seat holds; marks rotate the same way.

## What a seat earns

| | |
|---|---|
| Liquidating your share | 16% of the debt you repay, as staked IMD (18% when your seat also marked it) |
| Marking a loan first | 2% of its debt when it is liquidated; marks rotate between the seats |
| INFER points | imdUSD's season points: 3 days of holding points per imdUSD repaid, and 1 a day per imdUSD the keeper holds |

Liquidations happen only when IMD falls hard enough to put loans under 170%. In calm markets there is nothing to do and the bot only watches. Earnings are not guaranteed, and the bonus is paid in staked IMD, whose price moves with IMD.

**The cut.** A share of the bonus your seat keeps (10% for a Shift Lead down to 5% for the Captain) goes in IMD to the NIGHTSHIFT FeeSplitter `0x1119d5df2f046bc2d3c0f6279ef2e9ce49422d44`, which splits every fee the same way: 40% to $SHIFT stakers and NIGHT FROGS holders, 20% to the dev wallet, 20% to the treasury, 20% burned as IMD. On $100 of debt repaid a Shift Lead keeps $16, pays $1.60 and nets $14.40; the Captain nets $15.20. The bot pays it on its own after each liquidation. A seat whose cut is more than 2 hours overdue gets no jobs until it is paid.

## Set up

You need Node.js 20 or newer and a machine that stays on (a small VPS is ideal; the box that runs your IMD worker is fine). Then one command:

```bash
curl -fsSL https://getnightshift.tech/nightwatch/install.sh | bash
```

It installs the bot into `~/nightwatch`, makes a fresh keeper wallet (its key stays in `~/nightwatch/.env`, on that machine only), prints your pairing link and waits. Open the link, connect the wallet that holds your seat (a Night Watcher, or NIGHT FROG #1 for the Captain's seat), and sign. Then:

```bash
cd ~/nightwatch
node bot.mjs doctor        # checks Node, gas, imdUSD, the pairing, that you still hold the seat, the cut
node bot.mjs --once        # one report-only pass: what it would do, nothing sent
node bot.mjs --execute     # do the jobs
```

`node bot.mjs start` runs the same first-time flow by hand (on Windows: `git clone https://github.com/RobertKodes/nightshift`, `cd nightshift/nightwatch`, `npm install`, `node bot.mjs start`). To use a wallet of your own instead, put `KEEPER_MNEMONIC` or `KEEPER_PRIVATE_KEY` in `.env` first (see `.env.example`).

**The keeper wallet** is a new wallet that holds only the bot's funds, never the wallet that holds your seat:

- **ETH for gas**: 0.03 ETH is plenty to start. Nothing is sent below 0.003 ETH.
- **imdUSD to liquidate with**: as much as you want to put to work. A liquidation burns your imdUSD and pays it back as staked IMD plus the bonus, so it is working capital, not a cost. Buy it in the imdUSD/USDC pool or borrow it at imdusd.com. A seat with no imdUSD can still mark loans.

Pairing works like an IMD seat: the holder signs once on [getnightshift.tech/watch](https://getnightshift.tech/watch), which also checks which seats a wallet holds and shows each one's status. The pairing ends if the seat is sold (the new holder pairs their own keeper).

### On a rented server

Paste `cloud-init.yaml` into the server's startup/cloud-config box when you create it (or run `vps-setup.sh` as root): it installs Node, the bot as a service in report-only mode, and prints your pairing link (`nightwatch-link`). `nightwatch-live` switches live mode on. Costs and providers: `docs/nightwatch/VPS.md`.

### Keep it running

```bash
mkdir -p ~/.config/systemd/user state
cp nightwatch.service ~/.config/systemd/user/     # edit WorkingDirectory if the folder is not ~/nightwatch
loginctl enable-linger $USER
systemctl --user daemon-reload && systemctl --user enable --now nightwatch
journalctl --user -u nightwatch -f
```

The unit is report-only until you add `--execute` to its `ExecStart`.

## Guard rails

Every transaction is simulated first, so a liquidation someone else already took costs nothing. Sends go through MEV Blocker (a private mempool), stop while gas is above 30 gwei and stop below 0.003 ETH. `touch state/STOP` halts every send without stopping the bot. Settings are in `.env.example`.

## Credit

The liquidation rules and the guard rails follow [fa11up/imdusd-keeper](https://github.com/fa11up/imdusd-keeper) (MIT), the reference keeper for imdUSD. That keeper also relays oracle updates and paces the vault; run it beside this bot if you want to help with those public jobs.

MIT licensed.
