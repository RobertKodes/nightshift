# Staked games: how a joined match gets its game, and why match 0x6315… was voided

How a NIGHT CHESS, NIGHT POOL or Space Pinball game for a stake in IMD or $SHIFT goes from the
`Joined` event to both players at the table, what voided the 100,000 $SHIFT chess match on
2026-10-21, and what changed so it cannot happen that way again. Written from the code
(`apps/engine/src/escrow.ts`, `games-routes.ts`, `chess.ts`, `pool.ts`, `pinball.ts`,
`apps/web/src/stakes.tsx`, `ChessPage.tsx`) and the server's own record of the match.

## 1. The path from the chain to the seats

1. **Challenge.** Player A's page asks `POST /api/games/challenge` (signed-in session). The server
   makes a random match id and records the terms (game, token, stake, clock, A's name). A's wallet
   approves exactly the stake and calls `open()` on GameEscrow v2 (one confirmation where the
   wallet batches, EIP-5792).
2. **Opened.** `Escrow.sync()` follows the contract every 10 s, two blocks behind the head. An
   `Opened` event counts only from A, with exactly the recorded token, stake and game label.
3. **Join.** Player B's page records B's name (`POST …/accept`, memory only), then B's wallet
   approves and calls `join()`. With an EIP-7702 wallet (0x3322… in this match) both calls go in
   one batch from B's own address, so the `Joined` event and `matches()` name B's address as
   usual: nothing about 7702 changes how B is matched.
4. **Dealt.** On `Joined` (checked against `matches()` on chain), `Lobby.#deal` makes the game
   for exactly the two wallets (`chess.createStaked`, `pool.createStaked`, `pinball.createStaked`)
   and records `dealtAt`. Each wallet has a private seat token; the game waits for both.
5. **Seats.** A seat is handed only to that wallet's signed-in session (`POST …/seat`). Before this
   change the **only** code that asked for it was the `StakeLobby` component on the game page,
   polling every 3 s, and only while:
   - the stake lobby was on screen (the page's money toggle on IMD or $SHIFT; it starts on FREE
     after any reload or new visit, unless the URL carries `?token=`),
   - the page knew the match id (kept in `sessionStorage`: one tab only), and
   - the tab was visible (`document.hidden` stopped the poll).
6. **Start.** A player is "at the table" while their page holds the game's event stream
   (`/api/chess/match/<id>/events`). The game started when both were connected, or
   `STAKED_SHOW_MS` (5 min) after the deal "whoever is there"; with nobody there it ended as a
   draw ("abandonment"), which the escrow signs and the keeper relays as a refund.
7. **Away rule.** In a running game, a player with no open stream for 45 s on their own turn
   lost by abandonment, staked or not, even before their first move.

## 2. What happened to match 0x631511821b10…

From the server's `escrow.json`: created by 0xdc73… ("SOLDIER") at 1792544121.9 s, opened on
chain at 1792544207, joined by 0x3322… at 1792544483 (EIP-7702 batched approve + join), **dealt
26 s after the join** (1792544509.6), outcome **draw exactly 300.19 s after the deal**
(1792544809.8), signed, relayed and mined at 01:07:23 UTC.

300 s after the deal is `STAKED_SHOW_MS`: `chess.tick()` found the game unstarted at its deadline
with **no player holding a stream**, and ended it as a draw. So the server, the escrow follower,
the 7702 join and the deal all worked; **neither player's page ever asked for its seat** in those
five minutes. (A server restart would also have voided it, but with a different reason and not
at exactly +300 s.)

Why neither page sat down, from the code above:

- **A (creator)** waited four and a half minutes for a rival. A page that was reloaded, reopened in
  another tab, or left for another part of the site comes back on the FREE toggle with no stake
  lobby mounted, so nothing asks for the seat, and nothing on the page says a staked game is
  waiting. A tab left in the background (to tell the rival in Telegram, say) stopped polling.
- **B (joiner)** confirmed approve + join in the wallet app. On a phone the browser page is hidden
  or discarded while the wallet app is in front; coming back reloads it on the FREE toggle, so the
  same gap applies. Even on a page that stayed open, B was shown A's "Waiting for a rival" dialog
  (with A's cancel button) until the chain confirmed the join, which reads as "it didn't work".

Match 2 (0x20cbed0f…, 3322 as A, 0x096a… as B) shows the second problem: both sat down and the
game started, then A lost the whole stake 51 s after the deal by the 45-second away rule, most
likely a phone switching apps or sleeping, possibly before making a move.

## 3. What changed

**Every page finds the game by wallet.** `GET /api/games/mine` (signed-in session) returns the
wallet's staked matches still to be played: its open or pending challenge, a join it said it is
making (before the chain confirms it), and each joined match with its own seat once dealt, plus
`startBy` (when it is void). `apps/web/src/games/staked.tsx` polls it on every page (every 4 s in
view, every 15 s hidden, and at once on focus or return), and:

- `StakedBanner` (on every page, at the top): "Your staked game is ready · Take your seat", with a
  sound and a notification while the page is hidden; also "your stake is on its way", "your
  table is being set up", "your challenge is open".
- `useStakedSeat` on the chess and pinball pages takes the seat by itself (or the one in
  `?seat=<match>` from the banner), whatever the money toggle shows, unless another game is in
  progress on that page.
- The lounge lists "Your staked games" with Take your seat / Open.
- `StakeLobby` follows a challenge the server knows (another tab, after a reload), keeps its own in
  `localStorage`, keeps polling while hidden (less often) and at once on return, and shows the
  joiner its own state ("Your stake is on its way", then "Setting up your table") instead of the
  creator's waiting dialog.

**Fair start and fair absence (chess and pool; pinball where it applies).**

- The clock never starts with one player: a staked game starts only when both are connected,
  after a 10 s countdown both see. If they have not both been there within **15 minutes**
  (`STAKED_SHOW_MS`) the game is **void**: a draw, both stakes refunded. The waiting room shows who
  is at the table and the countdown to the deadline.
- Away on one's own turn, a staked player has **2 minutes in all for the game**
  (`STAKED_GRACE_MS`), not 45 s; both players (and spectators) see "reconnecting 1:12".
- A staked player who **never made a move** (chess) or **never took a shot** (pool) never loses
  the stake by abandonment or the clock (pool: time fouls): the game is void (reason `void`), a
  draw that refunds both. Resigning stays a choice that loses. Space Pinball: a duel never starts
  with one player (void at 15 minutes), and a player who sat down but never played a ball makes
  the duel void.
- Free games keep their rules (45 s away rule, 5 s countdown).

**The payout never depends on the server's relay alone.** `GameEscrow.settle()` is open to
anyone holding the server's signed result. The keeper (0x0Ff1…3454) relays it once; when that
relay fails (no ETH for gas, a revert), never ran, or has not landed after 2 minutes
(`RELAY_SLOW_MS`), the challenge is `claimable`:

- `GET /api/games/escrow/:matchId/result` returns the signed result to either player's signed-in
  session (re-signed with a fresh deadline when the old one is close); nobody else gets it.
- The game's result screen shows the winner (both players for a draw or a void) "Claim winnings"
  / "Refund both stakes": the page fetches that result, checks it is for this match on the pinned
  contract, simulates `settle()` first (an already-paid match says so, nothing is signed), then
  asks for one confirmation.
- `/api/games/mine` keeps a decided match listed while it is claimable for that wallet, so the
  banner on every page ("Your winnings are waiting") and the lounge's "Your staked games" (with the
  same claim) bring the player back to it after leaving the game. The YOUR REWARDS card
  (`rewards.ts`, `nx/Rewards.tsx`) applies the same rule: a failed or a slow relay puts the win
  (or the draw's refund) in the player's claims.

## 4. Tests

- `escrow.test.ts`: the clock never starts with one player and the game is void at 15 minutes;
  a late second player still starts it (with the countdown); a player away from the start makes
  the game void after the 2-minute grace and both see `awayUntil`; the grace is a total per game
  (70 s, back, then 50 s more loses for a player who moved); `/api/games/mine` (Lobby.mine) for
  the open challenge, the join on its way (7702 batch), the seats for both once dealt, and
  nothing for anyone else; a failed relay makes the result claimable by the winner only (a draw
  by both), a sent relay becomes claimable after 2 minutes, and a settled match is not.
- `pool.test.ts`, `pinball.test.ts`: void at 15 minutes with one player; a player who never shot
  or never played makes the game void.
- In two browsers against the local engine with the escrow fake (`escrow.fake.ts` behind
  `setLobby`): A opens and reloads the plain chess page, B joins and its page reloads; both get
  their seat, see the countdown and play; B drops and A sees "reconnecting 1:59"; B comes back
  from `/games` through the banner; A resigns and the escrow records and relays B's win. With the
  relay failing (no gas), B's result screen and the lounge show "Claim winnings", the result
  endpoint answers B and refuses a stranger and a visitor with no session.

## 5. Still worth knowing

- A deploy or restart during a dealt game voids it (both refunded): the game state is in memory
  and a game is never dealt twice. Deploy between games.
- The seat is the session's: a player must be signed in with the wallet that deposited. A smart
  wallet that signs in with another address than the one that joined (not the case with EIP-7702,
  where it is the same address) would not get the seat.
