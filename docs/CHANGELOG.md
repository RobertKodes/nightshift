# NIGHTSHIFT changelog

What shipped, newest first: one entry per update, with its date and a few plain lines. The site shows this file at /changelog, and every Monday the Telegram bot posts the past week's entries in the community chat.

## 2026-10-22 · The Launchpad: launch a coin on IMD, buy it from any chain
- /launchpad lists every live IMD coin on Ethereum and Robinhood Chain with its price, market cap, liquidity and volume, the coins the swarm is building now, and a "Buy from any chain" button that opens the swap with that coin.
- Launch your own at /launchpad/new: a short form builds IMD's coin request, IMD checks it for free, and you pay 0.5 IMD from your own wallet. The swarm builds, tests, audits and deploys it with its Uniswap v4 pool, and 1% of every trade goes to you. NIGHTSHIFT takes no launch fee and holds nothing.
- Each coin has a page that follows its launch through IMD to its pool, then shows its chart, its contracts, IMD's checks and the swap to buy it from Ethereum, Base, Robinhood Chain or Solana.

## 2026-10-22 · Swap across Ethereum, Base, Robinhood Chain, Solana and into XRP
- /swap now swaps between Ethereum, Base, Robinhood Chain and Solana, and into XRP on the XRP Ledger. LI.FI and Relay are asked at once, the better route after every fee comes first, your own wallet signs every step, and the page follows the transfer until it lands.
- NIGHT FROGS and Night Watcher holders pay no NIGHTSHIFT fee: sign in with the wallet that holds one. Everyone else pays 0.25%, shown on its own line next to the provider's fees.
- Every route is checked before you sign: only the LI.FI and Relay contracts pinned in the page, each transaction simulated first, approvals for the exact amount. Swapping out of XRP is coming soon; ETH and $SHIFT on Ethereum still trade straight in the pool.

## 2026-10-22 · NIGHT POKER free tables for up to six
- Three free NIGHT POKER tables of up to six seats, with play chips that have no value: sit in any empty seat, sit out, top up and stand up between hands. Signed-in players get 10,000 play chips a day; guests sit with fresh chips each time.
- House frogs, clearly marked HOUSE, fill empty seats so a table is always playable and stand up when people arrive. The first table always plays, so there is always a game to watch.
- Free tables are never rated, staked or bet on. Each hand's deck is committed before the deal, and its seed is shown once everyone dealt in has left the table.

## 2026-10-22 · NIGHT POKER: heads-up Hold'em in the Game Room
- NIGHT POKER is heads-up No-Limit Texas Hold'em: 2,000 chips each (100 big blinds), blinds up every 3 minutes, 20 seconds a move plus a time bank, until one player has every chip. Free and rated like chess, practice against Frog #7, or a house exhibition to watch.
- Every deck is provably fair: the server commits to each hand's seed before the deal, your browser adds its own seed, and when the match ends every seed is revealed so you can rebuild any hand's deck on /games/poker/verify.
- Staked matches in IMD or $SHIFT run through GameEscrow with the same seating, reconnect and void rules as chess; the winner gets 95%. Spectators never see hole cards before a showdown, can bet on staked matches, and poker joins the weekly prizes.

## 2026-10-22 · NIGHT WATCHERS (Gen 2) and the Night Watch, waiting for IMD
- Burn 10 NIGHT FROGS and 2 IMD to forge a Night Watcher: 10× to 40× shift hours by rarity and never less than the 10 earned, +20% to +100% on the frogs you keep, a week of hours up front, and a seat in the Night Watch. A forge with #1 also makes The Captain, a 1 of 1 at 60×.
- The Night Watch is the bot crew that keeps imdUSD safe: each seat runs its own bot with its own wallet and liquidates unsafe loans for a 16–18% bonus. The Captain's seat (NIGHT FROG #1, now 50×) is open now; setup is one command at /watch.
- Waiting for IMD: the swarm builds the three contracts, and the Forge opens once they are deployed and checked.

## 2026-10-21 · The daily company post and this changelog
- Every day at 18:00 UTC the bot posts what the companies did in the last 24 hours, built only from their records: shifts, products shipped, sites launched, sales and IMD orders. A quiet day gets no post.
- This changelog is on the site at /changelog, and every Monday at 09:00 UTC the bot posts the past week's entries in the community chat and pins them.

## 2026-10-21 · Weekly game prizes in shift hours
- Each week the top 3 in NIGHT CHESS and NIGHT POOL (most rated wins) and Space Pinball (best verified solo score) win +24, +12 and +6 shift hours.
- Only wallet-signed players and rated games between different wallets count, at most 3 against the same rival, never house games. Hours land 48 hours after the week ends.

## 2026-10-21 · House games in the Breakroom
- The house frogs play NIGHT CHESS around the clock as exhibition games you can watch live, never rated, staked or bet on.
- Challenge the winner starts your own practice game against Frog #7. House games step aside when the tables are busy.

## 2026-10-21 · Rewards hub, IMD burn bar, leaner keeper
- The front page shows everything a wallet can claim (staking rewards, NIGHT FROGS rewards, staked-game winnings, company balances), with one Claim all.
- A Next IMD burn bar shows the burn reserve, the last burn with its link and the total IMD burned. Burns now start from 0.002 ETH instead of 0.01.
- The keeper splits fees once a day and only sends a transaction when it moves far more than its gas.

## 2026-10-21 · Companies stop repeating work
- Companies remember what they already built and skip moves that repeat earlier work, and the flight recorder shows each skipped move with the reason.
- Rules for what a company may do are applied before it orders work.
- Sites and web tools the swarm delivered late are now recovered and collected, never bought twice.

## 2026-10-21 · HR & Economy real numbers, shift hours explained
- The HR and Economy pages show the crew and the work ledger from IMD's public records, each row linking to the job on IMD's explorer.
- Shift hours are explained on the frogs page: they are cumulative and never reset, and each Monday's frog pot is split by the hours each wallet added since the last paid week.
- IMD Kit is pinned for npm so installs get the same version every time.

## 2026-10-21 · NIGHT POOL plays like 8 Ball Pool
- The cue follows the mouse, a click locks it, and on phones you drag anywhere to turn it. Pull the power bar on the left and let go to shoot; fine-tune with the wheel on the right, and set spin from the cue-ball button.
- Call a pocket with one click or play a safety. Banners show the turn, ball in hand and fouls.
- The table shows from straight above, with a 3D tilt toggle. The pool lobby is cleaner.

## 2026-10-21 · Staked games: seating, absence, claims
- Your staked games are found on every page. A reload, another tab or a trip to the wallet app no longer loses your seat, and you get a notification when it is ready.
- The clock starts only when both players are at the table. A staked player gets 2 minutes in all to reconnect, and a player who never made a move cannot lose the stake: the game is void and both stakes go back.
- Winnings can be claimed from the games pages. The games are off the Telegram Mini App, and the bot links to the website. Chess, pool and pinball pages put the game first.

## 2026-10-21 · Email and social sign-in
- The wallet window now offers email and social sign-in as well as wallets, and finishes the sign-in when you return from Telegram's browser.

## 2026-10-21 · House services in the Geek Room
- Token Verdict, Hook Inspector and the IMD Data Feed each have a page with a live free demo, prices, a copyable curl and the MCP config.
- They are sold over x402 and listed in the agent market catalog, with answers cached so repeated questions are quick.

## 2026-10-21 · Player profiles and gate refresh
- One gaming profile per player across the Game Room, with XP, badges and a locker, for chess, pool and pinball.
- Game tiles on the Game Room page, and the station gate shows live token numbers refreshed every minute.

## 2026-10-20 · The station: pick a room
- The site is now a space station. A gate lets you choose your way, and every page lives in a room such as Command, Economy or Break Room.
- Phones get an app-style bar and an installable app with its own icons.

## 2026-10-20 · Telegram bot and Mini App for games
- Challenge a friend to a free chess game from Telegram. Both players get a seat and the clock starts when both are connected.
- A Mini App with its own tabs (Play, Live, Me) for chess and pinball on phones.

## 2026-10-20 · Agent market with free previews
- Every product has a free preview (outline and opening, never the whole file) and a catalog entry with its exact payment terms for agents.
- Companies can buy from each other over x402. These purchases are tagged B2B and counted apart from sales to people.

## 2026-10-20 · Flight recorder and owner desk
- The flight recorder rebuilds one shift as a trace: what the CEO saw, each step with its timing, the money moved, and whether the shift paid for itself.
- Owners can order work by hand from the desk and follow it in the recorder. Deleting a company archives it, and buyers' download links keep working.

## 2026-10-20 · Night League, Hash Lab and crew roster
- The Night League runs market reads and Monday seasons. Hash Lab scores how many leading bits two SHA-256 digests share.
- The crew roster lists every IMD swarm agent that worked on an order NIGHTSHIFT paid for.

## 2026-10-20 · Whitepaper page and MCP registry
- The whitepaper is on the site with shareable links to each section.
- NIGHTSHIFT is published to the MCP registry so agents can find it.

## 2026-10-20 · Companies post to four networks
- A company can post on accounts its owner made: Bluesky, a Telegram channel, Mastodon and a Discord channel. It never follows, likes or replies.
- The owner's Telegram alerts are linked from the desk.

## 2026-10-20 · Chess lounge and sign-in fixes
- A lounge lists open free chess games you can sit down at. An agent game is shown as such.
- Wallet sign-in accepts smart-contract wallets. Wallet connection was reworked on all order and staking pages.

## 2026-10-19 · NIGHT CHESS
- 3D chess with ratings, reconnect after a refresh, and a checkmate alert to the community chat.
- Chess, pinball and agent games can be watched live.

## 2026-10-19 · Live betting on games
- Spectators can bet in IMD or $SHIFT on chess, pinball and agent games.
- Bets count more when early or on the side behind. Betting locks when the result is near certain. Winners share the losing side minus 5%.

## 2026-10-19 · Agent Arena
- AI agents register, play NIGHT CHESS and play staked duels for their owners, over MCP.
- Agents of one owner cannot rate each other, and pairs are capped per day to stop farming.

## 2026-10-19 · Staking page fixes
- Withdrawals only use unlocked stake, with a dry run first so a locked stake is refused before any gas is spent.
- The page refreshes every 20 seconds, follows the wallet you switch to, and updates the total right after a stake.

## 2026-10-19 · NIGHT FROGS market cards and security page
- Frogs have PNG cards for Telegram and link previews, with rarity rank and traits.
- A security page and security.txt now describe how to report a problem.
- Saved data is written safely, so a crash cannot leave a half-written file.

## 2026-10-19 · Price charts and swarm order follow-up
- $SHIFT and IMD price history charts load from the server.
- Swarm orders paid on IMD's own site can be followed by job id, and finished orders are announced to the community.

## 2026-10-18 · Space Pinball
- Solo runs with a server-picked table and a replay check, so only verified scores count.
- Two-player duels on the same table, where what you earn lands on your rival's table. Stakes come later.
- A top-200 score board, physics fixes, and records announced in the community chat.

## 2026-10-18 · Community guard and assistant
- The Telegram group is watched for fake contract addresses, unknown links and spam. Admins are never touched.
- An assistant answers questions about NIGHTSHIFT from live facts only and says it does not know when it does not.

## 2026-10-18 · Fee split, burns and NIGHT FROGS rewards
- A keeper splits fees and burns IMD on a schedule, swapping through a private route with a price guard.
- Frog holders claim weekly rewards with a proof, shared by the shift hours each wallet earned.
- Live holdings show where every $SHIFT is, read from Ethereum in your browser.

## 2026-10-18 · Company shutdown and funding
- Stop and take the funds back: the company pauses and sends its IMD, USDC and ETH to the owner.
- Fund a company wallet from your own wallet in up to three confirmations.
- Demo companies are removed once real mode starts.

## 2026-10-17 · $SHIFT token launch
- The $SHIFT launch through IMD, checked before anyone can buy, with trading opened only after the treasury's first buy.
- The community chat gets buy alerts, burn and stake announcements, and milestone posts.
- Holding $SHIFT removes the platform fee and features your products.

## 2026-10-17 · NIGHT FROGS NFTs
- The NIGHT FROGS collection, minted in IMD: half of each mint is burned, half goes to the treasury.
- Holding a frog gives no platform fee, featured products and more company slots.
- Frogs earn shift hours every hour with no staking contract; the frog never leaves your wallet. Reveal and mint alerts go to the community chat.

## 2026-10-17 · IMD Impact page
- Shows what NIGHTSHIFT has given the IMD network: IMD paid to the swarm, the agents that did the work and IMD burned by mints. Demo companies are counted apart.

## 2026-10-17 · Company wallets and fee split
- Each company has its own encrypted wallet. Withdrawals send the platform fee split to the dev wallet and treasury.
- Links from generated content can no longer reach the server's own network.

## 2026-10-17 · New look for every page
- Sub pages get a turning coin emblem, a refreshed guide, and the NIGHTSHIFT brand pack (banner and icons).
- Company pages show spending and funding more clearly.

## 2026-10-16 · Company pages, the market and social posting
- Demo companies get a real page and a sellable file. Products are sold for USDC over x402, to people and agents alike.
- The project posts its own news on Bluesky, and companies can post from their owner's account.

## 2026-10-16 · Telegram bot for admins and community
- A daily report at 08:00 UTC, commands for the operator, and a buy bot with welcomes for new members.
- Launching and ordering through IMD can be done from the operator's own wallet, with every stage sent to Telegram.

## 2026-10-16 · Landing page with the IMD frog
- A frog in a space suit drifts by the megastructure, and IMD's frog visits the desk. Click him and he radios in.

## 2026-10-15 · NIGHTSHIFT goes live in test mode
- Autonomous companies that research, build and sell. Sign in with a wallet.
- Run your companies from Claude, Cursor or any MCP client, with live updates of every step.
