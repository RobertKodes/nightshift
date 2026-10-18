# Audit report

> Audit the fairness and anti-cheat of Space Pinball in the open-source NIGHTSHIFT repository. The browser runs a deterministic pinball engine (apps/web/src/pinball/engine.ts, byte-identical to apps/engine/src/pinball/engine.ts); the server replays each player's recorded inputs with that engine (apps/engine/src/pinball.ts) and only the replayed score counts, for duels (both tables in lockstep, attacks delayed 720 ticks) and the solo board. Find every way a player could get a score they did not earn, forge or replay inputs, predict or choose a favourable seed, desync the duel, exhaust the server, or show harmful content to the other player; check determinism across JavaScript engines (floating point, sort order, Math functions). Rank findings by severity with concrete fixes. Stakes in IMD and $SHIFT will depend on this.

| | |
|---|---|
| Repository | https://github.com/RobertKodes/nightshift |
| Commit | `34c2afd64846ddc9f1c35cff94b12675318959f8` |
| Job | `2a2826a6-6ce0-4dcb-8b20-ed61e0ae0004` |
| Judged | 2026-10-18 21:27 UTC |
| Findings | 2 critical · 2 high · 3 medium · 4 low · 1 info |

Four agents audited the code as it is at `34c2afd`, each in one area (math, permissions, economics, control flow),
and a judge reproduced, merged and ranked what they found, then read the code once more itself. Nothing in the repository was changed or deployed.

## Findings

### 1. Critical: Ball save re-arms on every launch: a plunger-only loop never loses a ball and scores ~860,000 on any seed

`apps/engine/src/pinball/engine.ts:192`

```
      if (this.tick - this.launchedAt < SAVE_TICKS) {
```

step() grants the ball save whenever the drain happens within SAVE_TICKS (960 ticks) of launchedAt, and launchedAt is reset on every launch (line 168), including the relaunch of a ball that was just saved (line 193 puts it back in the lane). Nothing remembers that this ball already used its save, so a ball that always drains within 4 s is saved forever and ballsLeft never decreases. Each relaunch also re-awards the skill shot (line 171, 1000 x mult). A 75% pull (plunger held 180 ticks) sends the ball over the arc into the left target lane, knocks the three frog targets (+1500 x mult, +1 mult, a surge sent in a duel) and drains inside the save window, every time, on every seed tested. The result is a two-inputs-per-launch script that needs no flipper use, runs the full 150 s with three balls in hand, and out-scores the repository's own flipper bot by 4x to 16x. It dominates the solo board and any staked duel, and pours ~60 gravity surges onto the rival. The HUD says the save covers 'the first 4 seconds of every ball', i.e. once per ball. Merged from audit_math (critical) and audit_flow (high). Fix (keeps the stated rule): add a `saved` flag on the table; at line 192 require `!this.saved`, set it when the save fires, clear it in the real-drain path (line 196-200); and skip the skill-shot award when the launch follows a save. Ship it in both engine copies together and version the boards, since it changes replay results.

**Reproduction**

Reproduced with Node 22 (`node --experimental-strip-types`) against a verbatim copy of apps/engine/src/pinball/engine.ts (byte-identical to the web copy) and apps/engine/src/pinball.ts (only its two import suffixes rewritten to .ts and config.dataDir pointed at a temp dir). Script: hold the plunger from tick 0, release at tick 180, and hold again for 180 ticks every time inLane becomes true, left/right always 0. The first inputs are [[0,0,0,1],[180,0,0,0],[927,0,0,1],[1107,0,0,0],[1802,0,0,1],[1982,0,0,0],...] (82 inputs for seed 1). replay(1, inputs) -> score 864430, ticks 36000, 40 'save' events, 0 'drain' events, 41 'skill', 61 'targets', ballsLeft 3. Seeds 2 / 42 / 99 / 12345 -> 857860 / 838030 / 869380 / 885420 (39-41 saves, 0-1 drains). The flipper bot from apps/engine/src/pinball.test.ts scores 81960 / 162460 / 187450 / 54250 / 277240 on the same seeds and loses all three balls. Expected: at most one save per ball, three drains, a modest score. Actual: never drains, full 150 s, ~860k.

### 2. Critical: Rival's self-reported attacks are relayed unverified and applied to the victim's live table, so a player can desync the opponent's game from the deciding replay

`apps/engine/src/pinball.ts:120`

```
    if ((k === "meteor" || k === "surge") && t >= 0 && t <= MAX_TICKS && !p.attacks.some((a) => a.tick === t && a.kind === k) && p.attacks.length < 200) p.attacks.push({ kind: k, tick: t });
```

progress() accepts any `sent` list from a player (any kind, any tick in 0..MAX_TICKS, deduplicated, up to 200 per match, 20 per post) without checking that the player's game earned those attacks. view() relays them to the other player as `attacks`, and the other browser calls t.receive(a.kind, a.tick + ATTACK_DELAY) for each one (apps/web/src/pinball/PinballGame.tsx:112), which changes the physics of the table being played: meteors on the field and 35% heavier gravity. The deciding duelReplay() (engine.ts:298-313) ignores that list and schedules only the attacks the sender's replayed inputs actually produce. So the table the victim sees and records inputs against is not the table their inputs are replayed on: (a) fake attacks: the victim dodges meteors the replay never creates; (b) withheld attacks (omit `sent`): the victim plays a clean table and the replay injects the real meteors; either way the victim's verified score collapses while the cheater's own table is unaffected. The same root cause desyncs honest duels whenever an attack notice arrives more than 3 s late (slow link, backgrounded tab, the shared 600/min progress limiter behind one NAT): the browser lands it immediately (`if (a.at > this.tick) continue;` no longer defers it) while the replay lands it at tick+720. With IMD/$SHIFT stakes this lets a player take the pot from an opponent who played correctly, with one unauthenticated POST. Merged from audit_economics, audit_math, audit_flow and audit_permissions (all the same mechanism). Fix: never let the browser's attack schedule come from a peer's self-report. Have each progress() post carry the player's input log so far, replay it incrementally on the server (a full game replays in ~65 ms) and relay only server-derived attacks; or record per player the exact schedule delivered to them and have duelReplay use that schedule for that player's table, voiding (refunding) the match when it differs from what the sender's replay earned or when a delivery arrived after its landing tick.

**Reproduction**

Reproduced with Node 22 (`node --experimental-strip-types`) against a verbatim copy of apps/engine/src/pinball/engine.ts (byte-identical to the web copy) and apps/engine/src/pinball.ts (only its two import suffixes rewritten to .ts and config.dataDir pointed at a temp dir). Server side: queue('A'), listen(matchId, noop), queue('B') pairs them; after the countdown progress(matchId, A, { sent: [{kind:'meteor',tick:0},{kind:'meteor',tick:300},{kind:'surge',tick:600},... 20 entries] }) with no inputs from A at all; get(matchId, B).players[rival].attacks has 20 entries, and 13 such posts fill it to 200, while duelReplay(seed, [], []) lands 0 attacks on B. Engine side: the repository test's flipper bot plays seed 42 with those 20 fake attacks applied via t.receive(kind, tick+720): live score 214980 with 20 attacks received; duelReplay(42, victimInputs, []) scores those same inputs 47230 with 0 attacks received. Without fake attacks live and replayed scores agree (187450 / 187450). Withheld case: A plunges to 175 and B to 150 with the same bot, B sees no attacks live (81960 on seed 1, 162460 on seed 2) but duelReplay(seed, A.inputs, B.inputs) scores B 56380 / 38410 after A's 2 / 9 real attacks land. Expected: the table the player sees equals the table that is replayed. Actual: the opponent controls the difference.

### 3. High: Solo runs hand out the seed up front, never expire and may be opened 40 at a time, so seeds can be shopped and inputs solved offline

`apps/engine/src/pinball.ts:200`

```
  if (Date.now() - r.startedAt < (lastTick / 240) * 1000 - 3_000) throw new Error("inputs from later than the run has lasted");
```

The comment above soloStart() promises that 'nobody can shop for a lucky table', but soloStart() returns the seed immediately, server.ts:374 allows 40 runs per 10 minutes per IP, and a run has no deadline: soloFinish() only refuses inputs whose last tick is ahead of the wall clock, never a run that is too old (pruning at line 192 starts only above 20,000 runs). The engine is public and deterministic, so a player can open 40 runs, replay every seed offline, keep the best, and spend unlimited time searching flipper timings (a full game replays in ~65 ms) before submitting; an abandoned run costs nothing. Nothing binds the log to live play: a log whose last input is at tick 1107 is accepted 10 s after start even though the simulated game then runs 150 s. Every score on the solo board and every 'NEW #1 TONIGHT' community post can therefore be synthesised rather than played. Merged from audit_economics (high), audit_math (medium), audit_flow (medium) and audit_permissions (solver high + shopping medium). Fix: expire a run at startedAt + 150 s + a small grace and refuse soloFinish() after that; allow one open run per IP/session at a time; require the elapsed time to be within a tolerance of the replayed game's own tick count (not just the last input's tick); and, to close the offline-solver gap, stream the input log during play (the progress cadence already exists) and require the final log to equal what was streamed, so a search can only run in real time with ~1 s of lookahead. State in the UI that boards are not bot-proof until that ships.

**Reproduction**

Reproduced with Node 22 (`node --experimental-strip-types`) against a verbatim copy of apps/engine/src/pinball/engine.ts (byte-identical to the web copy) and apps/engine/src/pinball.ts (only its two import suffixes rewritten to .ts and config.dataDir pointed at a temp dir). soloStart('x') called 40 times returns 40 distinct {id, seed} pairs, all open. With Date.now() advanced 24 h, soloFinish(id, [[0,0,0,1],[180,0,0,0],[927,0,0,1],[1107,0,0,0]]) is accepted and returns {score: 11330, rank: 1} on the solo board. With Date.now() advanced only 10 s after start, the same 4-input log (last tick 1107, simulated game 150 s) is accepted too (score 50170). Seed luck alone with identical bot inputs over seeds 1000..1039: min 10840, median 96010, max 233780. Expected: one seed, finished within the game's own duration, inputs produced during the run. Actual: any of 40 seeds, any time later, any log.

### 4. High: Match SSE re-serialises both players' avatars (up to 200 KB each) per listener on every progress post, with no backpressure on res.write

`apps/engine/src/server.ts:400`

```
            const off = pinListen(id, () => res.write(`data: ${JSON.stringify(pinGet(id, me))}\n\n`));
```

view() (apps/engine/src/pinball.ts:67) embeds p.avatar for both players in every match snapshot, queue() accepts an avatar of up to 200,000 base64 characters, emit() runs on every progress() post (600/min per IP, i.e. 10/s) and the listener at server.ts:400 calls JSON.stringify(pinGet(id, me)) once per SSE connection and res.write()s it without checking the return value or writableLength. A single match with two 200 KB avatars therefore costs ~400 KB of JSON per listener per progress post, and a client that opens the stream and never reads the socket makes Node buffer every frame in process memory indefinitely. One IP (4 streams, 10 posts/s) pushes ~16 MB/s into unread buffers, plus 40 x 400 KB JSON.stringify per second on the event loop; more IPs scale linearly until the engine process (which also serves every other API) is OOM-killed. The honest rival on a phone receives ~2 MB/s for the whole duel. Merged from audit_flow (high) and audit_permissions (medium). Fix: send avatars once (first SSE frame) or by reference and strip them from per-progress snapshots; coalesce emits to a few per second per match; honour the false return of res.write() or close listeners whose writableLength exceeds a few hundred KB; cap avatar size to what a frog image needs.

**Reproduction**

Verified on the code: queue('y', null, 'FREE', 0, 'data:image/svg+xml;base64,' + 'A'.repeat(200000)) is accepted (regex at pinball.ts:82) and get(matchId) serialises to 200,313 bytes; server.ts:400 writes JSON.stringify(pinGet(id, me)) per listener on every emit and ignores the write() result; progress is limited to 600/min per IP (server.ts:406) and streams to 4 per IP (server.ts:396). Steps: 1) from one IP POST /api/pinball/queue twice with a 199,000-char base64 SVG avatar (the second joins the first: both in match M); 2) open 4 raw TCP connections to GET /api/pinball/match/M/events and never read; 3) POST /api/pinball/match/M/progress {"player":"<id>","score":1} 10 times per second. Expected: bounded memory per connection and a few hundred bytes per progress tick. Actual: ~400 KB per frame per unread stream buffered in process memory without limit (~16 MB/s per IP).

### 5. Medium: A black-hole capture is scored and sends a meteor 1 to 3 times, because the sub-step loop keeps calling #move after the ball is held

`apps/engine/src/pinball/engine.ts:184`

```
    for (let i = 0; i < SUB; i++) this.#move();
```

step() runs SUB=3 sub-steps unconditionally. When #move() captures the ball (line 211-215) it sets held=240, raises the multiplier, scores 2000 x mult, sends a meteor and returns, but it does not move the ball; the ball is moved to the hole centre only on the next tick (line 176). The remaining sub-steps of the same tick therefore find the ball still inside the 15 px core and fire the capture again. How many times (1, 2 or 3) depends only on which sub-step the ball crossed the core in, not on play. The stated rule is '+2,000 and +1 multiplier' and one meteor per hole; actually one capture can give +4000 and +6000 (mult 1->2->3) and two meteors (MAX_METEORS is 2, so one hole fills the rival's table). Symmetric for both players, but the scoring and attack economy do not follow the design and depend on a sub-step coincidence. Merged from audit_math (high), audit_economics (medium) and audit_flow (medium). Fix: stop sub-stepping once the ball is held, e.g. `for (let i = 0; i < SUB && this.held === 0; i++) this.#move();` (or return early from #move when held > 0). This changes replay results of recorded games: change both engine copies together and version the boards.

**Reproduction**

Reproduced with Node 22 (`node --experimental-strip-types`) against a verbatim copy of apps/engine/src/pinball/engine.ts (byte-identical to the web copy) and apps/engine/src/pinball.ts (only its two import suffixes rewritten to .ts and config.dataDir pointed at a temp dir). replay(1, [[0,0,0,1],[150,0,0,0]]) (plunger held 150 ticks, no flippers): events are launch at tick 151, then hole:4000 and hole:6000 both at tick 365, two meteors sent, mult 3, stats.holes 2 for one capture. With the repository test's bot on seed 1: holes per tick 365: 4000+6000, 2551: 4000+6000, 6802: 4000+6000, 10565: 10000+10000; stats.holes is 8 for 4 captures. Over 100 bot games, 277 of 396 captures were counted more than once. Expected: one 'hole' event per capture. Actual: 1-3 per capture.

### 6. Medium: Duel inputs are accepted up to 120 s after the game clock ends while the rival's verified score, finished flag and attack ticks are visible, so the second finisher can solve offline against a known ta

`apps/engine/src/pinball.ts:142`

```
  if (Date.now() - m.startedAt < (lastTick / 240) * 1000 - 3_000) throw new Error("inputs from later than the match has run");
```

finish() only refuses inputs from the future of the match clock; settle() waits until startedAt + 150 s + 120 s for a missing log. Meanwhile view() (line 67) streams to the other player `solo` (the finisher's server-replayed score), `finished` and the tick-exact attack list. A player can let the rival play and finish, read the exact number to beat and the attacks that will land, and spend up to 270 s from start running the public engine over candidate input logs (65 ms per full replay) before submitting. The still-nudge at engine.ts:187 leaves a ball cradled on a raised flipper alone, so the live table can idle while that search runs. Merged from audit_flow (low), audit_math (low, view leak) and the duel half of audit_permissions' solver finding. Fix: require finish() within a few seconds of the player's own game ending on the server clock (reject when Date.now() - startedAt > replayedTicks/240*1000 + ~10 s), shorten the 120 s grace, and hide `solo`, `score`, `stats` and landed attack ticks from the rival until m.done.

**Reproduction**

Reproduced with Node 22 (`node --experimental-strip-types`) against a verbatim copy of apps/engine/src/pinball/engine.ts (byte-identical to the web copy) and apps/engine/src/pinball.ts (only its two import suffixes rewritten to .ts and config.dataDir pointed at a temp dir). queue('')+listen+queue('') pairs A and B; with Date.now() advanced 7 s past the queue, finish(matchId, A, [[0,0,0,1],[180,0,0,0]]) returns solo 3770 and get(matchId, B).players[rival] shows solo: 3770, finished: true while done is false (B is still mid-game). With Date.now() advanced to startedAt + 265 s, finish(matchId, B, [[0,0,0,1],[100,0,0,0]]) is accepted (lastTick 100 -> 0.4 s - 3 s bound trivially met), the match settles and records scores [3770, 200]. Expected: nothing about A's verified result reaches B before settlement, and B's log must arrive while B's game is running. Actual: the exact verified score is shown to B (PinballPage.tsx:148 even displays it as the rival's live score) and B may submit 115 s after the clock ran out.

### 7. Medium: Avatar check accepts any base64 SVG up to 200 KB and shows it to the opponent as their 'onchain frog'

`apps/engine/src/pinball.ts:82`

```
  const face = avatar && (/^\/games\/pinball\/frog-\d\.webp$/.test(avatar) || /^data:image\/svg\+xml;base64,[A-Za-z0-9+/=]{100,200000}$/.test(avatar)) ? avatar : null;
```

The comment says only the site's art or an onchain frog image may be shown to the other player, but the second regex alternative only requires a data:image/svg+xml;base64 URL of 100..200,000 base64 characters. Nothing ties it to the signed-in wallet (engine.auth.owner(req) is passed to queue() but unused for this) or to any NIGHT FROG tokenURI; the browser resolves the frog itself (PinballPage.tsx:36-50) and the server trusts whatever arrives. The rival's browser renders it via <img> in the HUD, side panel and result overlay (PinballGame.tsx:349, 401; PinballPage.tsx:167) and draws it at 176 px on the VS screen for 6 s (PinballGame.tsx:307). Scripts do not run inside <img>, but <text> with any words (scam addresses), embedded rasters and SMIL <animate> flashing (a photosensitivity hazard) all render, chosen by a stranger with no sign-in. Merged from audit_economics, audit_math, audit_flow and audit_permissions (all medium). Fix: do not accept image bytes from the client; accept a frog token id (or one of the shipped /games/pinball/frog-N.webp paths), verify ownerOf(tokenId) against the authenticated wallet server-side, fetch and cache the tokenURI image on the server, and send only that reference to the opponent.

**Reproduction**

Reproduced with Node 22 (`node --experimental-strip-types`) against a verbatim copy of apps/engine/src/pinball/engine.ts (byte-identical to the web copy) and apps/engine/src/pinball.ts (only its two import suffixes rewritten to .ts and config.dataDir pointed at a temp dir). queue('x', null, 'FREE', 0, 'data:image/svg+xml;base64,' + base64('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 200"><rect width="200" height="200" fill="#fff"/><text x="10" y="110" font-size="40">SEND IMD TO 0xBAD</text><rect width="200" height="200"><animate attributeName="fill" values="#000;#fff" dur="0.1s" repeatCount="indefinite"/></rect></svg>')) with no wallet: get(matchId).players[0].avatar is the submitted data URL (422 chars), and 'data:image/svg+xml;base64,' + 'A'.repeat(200000) is accepted as well. The next player to queue FREE:0 is paired and receives it as the rival avatar in view(). Expected: rejected or replaced by a default frog unless it is the caller's own frog. Actual: shown full-size to the opponent.

### 8. Low: Frog crew resets the targets while the ball still overlaps the last one, so the next sub-step scores that target again at the raised multiplier

`apps/engine/src/pinball/engine.ts:253`

```
        if (this.targets.every((x) => x.down)) { for (const x of this.targets) x.down = false; this.#add("targets", 1500, "surge"); this.mult = Math.min(5, this.mult + 1); }
```

A target hit only flips the ball's x velocity (line 251) and does not push the ball out of the target's radius. When the third target goes down, the crew resets all three to down=false in the same sub-step; one sub-step later (1/720 s) the ball has moved under 1 px and is still within r + BALL_R of the target it just hit, so it fires again: +250 x the new multiplier that the player did not earn, and that target is already down when the player returns for the next crew. Deterministic and symmetric, but score and target state no longer follow the stated rules. Kept from audit_math (low). Fix: defer the reset until the ball is clear of all three targets, or move the ball out to the target's rim on a hit as the bumpers do (line 230).

**Reproduction**

Reproduced with Node 22 (`node --experimental-strip-types`) against a verbatim copy of apps/engine/src/pinball/engine.ts (byte-identical to the web copy) and apps/engine/src/pinball.ts (only its two import suffixes rewritten to .ts and config.dataDir pointed at a temp dir). replay(1, botInputs) with the flipper bot from apps/engine/src/pinball.test.ts for seed 1: events at tick 7576 are target:750, targets:4500, target:1000 (a 'target' after the 'targets' reset in the same tick), and at tick 9608 target:1000, targets:6000. Expected: after a 'targets' event no 'target' event in the same tick. Actual: the just-reset target scores again immediately.

### 9. Low: The duel winner is recorded by display name, which both players may share, so the result (and any future payout) is ambiguous

`apps/engine/src/pinball.ts:160`

```
  m.winner = m.draw ? null : a.score > b.score ? a.name : b.name;
```

Names are free text cleaned to [\w .-], at most 18 characters, defaulting to 'Night crew', and are not unique. settle() stores only the winner's name; the client decides VICTORY/DEFEAT by m.winner === mine?.name (PinballPage.tsx:154), so when both players share a name both see VICTORY, the community announcement names 'Night crew beat Night crew', and an escrow built on this record has no reliable identity to pay. Merged from audit_economics and audit_flow (both low). Fix: record the winner by player id (and wallet once stakes are live), and expose a per-viewer `winnerIsYou` in view().

**Reproduction**

Reproduced with Node 22 (`node --experimental-strip-types`) against a verbatim copy of apps/engine/src/pinball/engine.ts (byte-identical to the web copy) and apps/engine/src/pinball.ts (only its two import suffixes rewritten to .ts and config.dataDir pointed at a temp dir). queue('', null, 'FREE', 0, null), listen, queue('', ...): both players are named 'Night crew'. After both finish (scores 3770 vs 200), get(matchId).winner === 'Night crew'; both clients evaluate m.winner === mine.name as true. Expected: exactly one player is told they won. Actual: both.

### 10. Low: A match whose second player never plays is settled as a walkover and the finisher's score goes on the duel board as a verified duel

`apps/engine/src/pinball.ts:162`

```
  record([a, b].filter((p) => p.inputs).map((p) => ({ name: p.name, score: p.score ?? 0, at: p.finishedAt ?? Date.now() })));
```

queue() pairs the caller with whoever is waiting and requires nothing of the joiner afterwards; after startedAt + 150 s + 120 s the 20 s interval settles the match with b.score = 0 and record() keeps the finisher's score for the duel board (tell() is skipped only for the chat post). A player can open two tabs, queue both, play one and abandon the other, and receive a duel-board entry for a game in which no attack ever landed, which is not comparable with real duels; one IP may also grab waiting players 20 times per 10 minutes and leave them playing alone for 4.5 minutes. Kept from audit_permissions (low). Fix: do not record a duel-board score unless both players finished; require a readiness ping during the countdown and dissolve the match (re-queue the present player) if the other side never connects; limit each IP/session to one open match.

**Reproduction**

Reproduced with Node 22 (`node --experimental-strip-types`) against a verbatim copy of apps/engine/src/pinball/engine.ts (byte-identical to the web copy) and apps/engine/src/pinball.ts (only its two import suffixes rewritten to .ts and config.dataDir pointed at a temp dir). queue('Lonely'), listen, queue('Ghost'); after the countdown finish(matchId, Lonely, [[0,0,0,1],[180,0,0,0],[927,0,0,1],[1107,0,0,0]]); Ghost never finishes. With Date.now() advanced to startedAt + 271 s, the setInterval settle fires: done true, winner 'Lonely', scores [8520, 0], and board().board contains 'Lonely' with 8520 (and not 'Ghost'). Expected: a one-sided match is void for board purposes. Actual: it is listed as a verified duel score.

### 11. Low: Player-chosen names are not screened and the first finisher of a quiet day is broadcast to the community channel under the project's voice

`apps/engine/src/pinball.ts:191`

```
  runs.set(id, { seed, name: name.replace(/[^\w .-]/g, "").slice(0, 18) || "Night crew", startedAt: Date.now(), done: false });
```

queue() and soloStart() strip names to [\w .-] and 18 characters but apply no word filter and no identity binding (the signed-in wallet is ignored for the name). tops() marks a score tonightTop whenever it exceeds the best of the last 24 h, which is 0 after a quiet day, so any solo run with score > 0 triggers the 'NEW #1 ON TONIGHT'S SOLO BOARD ... <name>' post in apps/engine/src/engine.ts:164 (6 posts/hour cap) and the name stays on the public board for 24 h or in the top 200 for ever. The name is HTML-escaped (no injection); the issue is unmoderated content and impersonation (e.g. 'NIGHTSHIFT', a known holder's handle) under the project's voice. Kept from audit_permissions (low). Fix: run names through the existing moderation path and a small denylist, reserve project/admin names, derive the display name from the wallet or ENS for signed-in players, and require a signed-in wallet or a minimum score before posting a result to the channel.

**Reproduction**

Verified on the code: soloStart(name) stores name.replace(/[^\w .-]/g, '').slice(0, 18) with no further check; tops('solo', score) at pinball.ts:44-48 returns tonightTop = score > 0 when no solo score in the last 24 h exists; soloFinish() calls tell() for any score > 0 and engine.ts:164 posts the name. Steps: when no solo run finished in the last 24 h, POST /api/pinball/solo {name:'<any 18 ASCII chars>'}, play one launch that hits a bumper, POST /api/pinball/solo/{id}/finish. Expected: names screened before public broadcast. Actual: the chosen text is posted to the community chat and kept on the board.

### 12. Info: Attract-mode restart copies a Table with Object.assign, which leaves the private #rand and #meteorN of the old table in place

`apps/web/src/pinball/PinballGame.tsx:134`

```
        if (demo && t.over) { Object.assign(t, new Table(seed + Math.floor(now))); seen = 0; }
```

Object.assign(t, new Table(...)) copies only public own properties; the #rand closure and #meteorN counter remain those of the first table, so the demo's later random draws (plunger power, black-hole exit side) continue the old stream and the restarted demo is not the game new Table(seed + ...) would play. Demo only: no score is submitted from it, so no fairness impact; noted because the same pattern would silently break determinism if reused for a real table. Kept from audit_math (info). Fix: replace the reference (let t = new Table(...)) instead of assigning over it.

**Reproduction**

Verified on the code and JavaScript semantics: engine.ts:108-109 declare #meteorN and #rand as private fields, which Object.assign does not copy; Object.assign(new Table(1), new Table(2)) succeeds and sets the public seed to 2 while #rand remains rng(1). Steps: run the lobby demo until the first game ends; the second demo game's plunger power comes from the first table's generator state. Expected: the restarted table equals new Table(seed2). Actual: public fields copied, private generator unchanged.

---

Judge's submission `2871c831798d1ba95527fc988cb40dc134aa3346ec7f556d3f7857530b32ba49`, accepted on the IdentityMD network. Acceptance means the report met the job's checks;
it is not a guarantee that the code has no other defects.
