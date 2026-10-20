# NIGHT POOL: research

What NIGHT POOL is built on, and why: the rules it follows, the physics it simulates, the
open-source engines we compared, the one we adapted and how its license is kept. Written before
and while building `apps/engine/src/pool/*` and `apps/web/src/pool/*`.

## 1. The rules: WPA 8-ball

Source: World Pool-Billiards Association, *Rules of Play*, effective 2025-09-15
([index](https://wpapool.com/rules-of-play/), [PDF](https://wpapool.com/wp-content/uploads/2026/01/2026.01.02-WPA-Rules.pdf)).
Section 4 is 8-ball; it refers to the general rules (1.x), definitions (2.x) and fouls (3.x).
What we implement (`pool/rules.ts`), with the section it comes from:

| Topic | WPA | NIGHT POOL |
| --- | --- | --- |
| Rack | 4.2: apex on the foot spot, the 8 the first ball below the apex (middle of row 3), one solid and one stripe in the two back corners, the rest random | `rack(seed)`: exactly that, the rest shuffled from the server's seed, racked tight with 0.1–0.3 mm between balls |
| First break | 4.1 / 1.2: lag | decided by lot (no lag online); a rematch alternates the breaker (1.3) |
| Break | 4.3(a)(b): cue ball in hand above the head string, nothing called, any ball first | kitchen placement checked (centre strictly above the head string), no call allowed |
| Legal break | 4.3(d): a ball pocketed, or at least four object balls driven to rails | counted from the physics events; a pocketed ball counts as driven to a rail (2.7) |
| Illegal break | 4.3(d): incoming player accepts the table, re-racks and breaks, or re-racks for the offender | a decision for the incoming player: `accept`, `rebreak`, `rebreak-other` |
| 8 on a legal break | 4.3(e): no foul; breaker spots the 8 and plays on, or re-breaks | decision for the breaker: `spot`, `rebreak` |
| 8 on a foul break | 4.3(f): opponent spots it and takes ball in hand above the head string, or re-breaks | decision for the opponent: `spot` (+ kitchen), `rebreak` |
| Other break fouls | 4.3(h): accept, or ball in hand above the head string | a scratch leaves no table to accept: ball in hand above the head string |
| Open table | 4.4: groups decided by legally pocketing a called ball; any ball may be hit first except the 8 | as written; a cleared group lets the shooter claim it and shoot the 8 |
| Continuing | 4.5 | stays at the table while the called ball drops in the called pocket |
| Called shots | 4.6 / 1.7: ball and pocket each shot; a safety may be called | WPA mode: ball + pocket or "safety" each shot (the page pre-fills the call from the aim) |
| Spotting | 4.7 / 1.5: only the 8; long string, foot spot, else behind it against the ball in the way, a gap from the cue ball, else in front | `spot()` does exactly that |
| Losing the rack | 4.8: the 8 on a foul, before the group is cleared, in an uncalled pocket, off the table | first three judged; off the table cannot happen (2D table) |
| Fouls | 4.9 / 3.1–3.3: scratch, wrong ball first, no rail after contact | `scratch`, `no-contact`, `wrong-ball`, `no-rail` |
| Ball in hand | 4.9 / 1.6: anywhere after a foul | placement checked: on the cloth, touching no ball |
| Kitchen | 3.10 / 3.11 / 1.6: from above the head string the first ball must be on or past it unless the cue ball crosses first; nearest legal ball spotted on request if all are above | `kitchen` foul from the cue ball's path; the nearest ball is spotted automatically |
| Slow play | 3.14: a shot clock may be imposed; exceeding it is a foul | 40 s per shot (50 s with ball in hand or for the break): a `time` foul |
| Three fouls | 3.13: a serious foul, but "some games such as 8-Ball do not include this rule" | off for WPA 8-ball; an option (`threeFouls`) the engine and tests support |
| Not online | 3.4, 3.6–3.9, 3.15 (foot on floor, touched ball, double hit, push, moving balls, template) | cannot occur: the server strikes the ball itself |

A second rule set, **quick** (the 8 Ball Pool convention), calls only the 8: the first ball
legally pocketed on an open table decides the groups and any ball of yours keeps you at the table.
Everything else is WPA.

Equipment: WPA *Recommended Equipment Specifications*
([PDF](https://wpapool.com/wp-content/uploads/2024/01/RECOMMENDED-EQUIPMENT-SPECIFICATIONS.pdf)):
playing surface 100 × 50 in (9 ft), 92 × 46 (8 ft); balls 2¼ in, 5½–6 oz; cushion nose at
62.5–64.5% of the ball's diameter; corner pocket mouth 4.5–4.625 in, side 5–5.125 in; cut angles
142° (corners) and 104° (sides). We play a 7-foot table (78 × 39 in), the usual 8-ball bar table,
which also keeps the balls big enough to read on a 390 px phone; the pocket geometry is pooltool's
7-foot table (mouths 118 mm and 137 mm, a little more forgiving than a WPA 9-footer's).

## 2. The physics

| Effect | Source | In NIGHT POOL |
| --- | --- | --- |
| Sliding, rolling, spinning, and the transitions between them | E. Kiefl, [pooltool theory](https://ekiefl.github.io/2020/04/24/pooltool-theory/) (after Leckie & Greenspan, Alciatore) | closed-form motion per state: μ_slide 0.2, μ_roll 0.01, μ_spin 0.0127; a centre-ball hit rolls at 5/7 of its speed |
| Event times | E. Kiefl, [pooltool's algorithm](https://ekiefl.github.io/2020/12/20/pooltool-alg/) | ball-ball, ball-jaw and ball-pocket times are roots of quartics, ball-rail times of quadratics |
| Ball-ball collisions | D. Alciatore, [technical proofs](https://billiards.colostate.edu/technical_proofs/) TP A-5, A-6, A-14; pooltool's `frictional_inelastic` | restitution 0.95, friction μ = 0.00995 + 0.108·e^(−1.088·v) (cut- and spin-induced throw) |
| Ball-cushion collisions | I. Han, *Dynamics in carom and three cushion billiards*, J. Mech. Sci. Tech. 19 (2005) 976–984 | impulse at the nose above the equator (sin θ = h/R − 1), restitution 0.85, friction 0.2, sliding or sticking |
| The stroke | Alciatore TP A-30 (instantaneous point strike), TP A-31 (squirt) | cue mass 0.567 kg, tip offset up to half a radius, elevation to 60°, squirt from the tip's end mass |
| Spin | the same | follow, draw and stun; side spin changes cushion rebounds (running english throws longer; reverse meets saturated friction); squirt; masse curves from elevation |
| Pockets | pooltool's 7-foot layout: 6 rails, 12 angled jaw faces, 12 rounded jaw tips, 6 pocket circles | a ball whose centre enters the pocket circle drops; jaws rattle |

Two changes of our own, both measured:

* **The rack is resolved in waves.** Resolved one pair at a time (pooltool's way), a nearly
  touching rack passes the whole stroke down a single chain, whichever pair is a hair closer: in
  200 test breaks about 5 balls reached a rail and 0.4 dropped. Solved as one rigid block, every
  ball flies (11.6 rails, 4.8 dropped, 8–22% scratches). In waves (every contact closing at once
  parts together, then the contacts that close because of it), the stroke travels through the rack
  and splits evenly at every fork: **11.6 balls to a rail, 0.8 dropped from the centre and 1.3
  from the side, every break legal, 7–12% scratches**, close to what good breaks do.
* **A minimum parting speed (5 mm/s).** A rolling ball pushing a sliding one would otherwise
  meet it again and again in ever shorter steps (inelastic collapse); one break took 1,551
  collisions of the same pair. With the floor the same break takes 22, and the energy it adds is
  far below a millijoule (the tests allow 0.1 mJ per event and never need it).

**Event-based, not a fixed timestep.** A fixed timestep (the usual game loop) moves every ball a
small step at a time and looks for overlaps: deterministic too, but it approximates every contact
time to within a step, can tunnel at break speed unless the step is tiny, and needs a long log of
positions to replay. pooltool's event-based scheme instead solves for the exact time of the next
event (a collision, a cushion, a pocket, a ball going from sliding to rolling or stopping) and moves
every ball there in closed form: no step size, no tunnelling, a few hundred events for a whole break
(about 2 ms of CPU), and those events are the keyframes the browser replays. It is the "fixed step"
taken to its limit: the arithmetic is the same on every machine, and there is no step to round.

**Determinism.** The server and every browser must get the same result from the same shot.
JavaScript numbers are IEEE 754 doubles, and `+ − × ÷` and `Math.sqrt` are exactly rounded in
every engine; `Math.sin`, `cos`, `exp`, `pow`, `atan2` are not (each engine has its own
approximation). So `physics.ts` uses nothing else at run time: sine and cosine are Taylor series
on an angle reduced exactly in integers (the aim is an integer in thousandths of a degree), `exp`
is range-reduced by powers of two, roots are isolated through derivatives and found by 64
halvings, and the table geometry (computed with trigonometry) was computed once offline and is
written as literal numbers. A test forbids the other `Math` functions and `**` in the file, checks
the sine and cosine against the platform's (within 2·10⁻¹⁵), and pins a golden hash of a full
break. Inputs are integers (aim, power, tip offset, elevation); the cue ball placement is rounded
to 0.1 mm. Same rack, same shot, same keyframes, everywhere.

**Server authority.** The browser sends only the shot's inputs. The server checks them (turn,
clock, limits, the call, the placement), simulates, judges and sends everyone the same keyframes:
one per event, each with the full state of the balls it changed. Between two keyframes a ball's
motion is closed-form, so the browser's replay is the server's simulation exactly, at 60 fps or any
frame rate. The aim guide is drawn by the browser from geometry alone (a straight line: the first
ball or cushion, the ghost ball, both balls' directions); a modified client could draw a longer
guide, as in every online pool game, but it can never move a ball.

## 3. Open-source engines compared

Licenses read from each repository through the GitHub API on 2026-10-20.

| Project | License | What it is | Physics | Fit for a server-authoritative game |
| --- | --- | --- | --- | --- |
| [ekiefl/pooltool](https://github.com/ekiefl/pooltool) (424★, active) | **Apache-2.0** | a billiards sandbox game and simulator in Python (Panda3D), peer-reviewed (JOSS) | the best open model we found: event-based, sliding/rolling/spinning, Han 2005 and Mathavan 2010 cushions, Alciatore ball-ball friction, squirt, pocket jaws | excellent: event-based simulation is exact and deterministic in shape, its events are natural keyframes; 8-ball rules exist but are simplified (no break options, no open-table subtleties) |
| [tailuge/billiards](https://github.com/tailuge/billiards) (261★) | **GPL-3.0** | TypeScript + three.js pool, snooker and three-cushion | time-stepped, spin, decent | not usable: GPL code may not be copied into this MIT repository; we checked only its license and did not read its code |
| [henshmi/Classic-Pool-Game](https://github.com/henshmi/Classic-Pool-Game) (292★, 2020) | MIT | 2D canvas 8-ball with an AI | point masses with damping; no spin, no real cushions | low: physics too simple to keep; no server |
| [piqnt/polymatic-example-eight-ball](https://github.com/piqnt/polymatic-example-eight-ball) (2026) | MIT | TypeScript multiplayer 8-ball, Socket.io rooms, Planck.js (Box2D) | 2D rigid bodies with linear damping; no spin | good architecture idea (server room, fixed loop), but rules are minimal (any own ball wins, no fouls) and Box2D damping is not billiards physics |
| [jzitelli/poolvr](https://github.com/jzitelli/poolvr) | MIT | WebVR pool with three.js | its own simple collision code | a rendering reference only |
| [Sk4rKr0w/8ball-threejs-game](https://github.com/Sk4rKr0w/8ball-threejs-game) | MIT | a small three.js 8-ball | basic | too small to build on |
| [pmndrs/cannon-es](https://github.com/pmndrs/cannon-es) | MIT | a general 3D physics engine | contact friction, no rolling resistance or cushion model | general engines approximate rolling and spin poorly and are not deterministic across machines |
| [dimforge/rapier.js](https://github.com/dimforge/rapier.js) | Apache-2.0 | Rust/WASM physics with a cross-platform deterministic build | excellent rigid bodies, but no billiards model | deterministic, but we would rebuild every billiards effect on top of it |

**Chosen: pooltool**, the physically best and the best fit for a server that must be the only
judge: we ported its physics to TypeScript (`apps/engine/src/pool/physics.ts`) and built the WPA
rules on its 8-ball ruleset's structure (`rules.ts`), then rewrote the numerics for determinism
(section 2). Nothing else was copied from any project; all art is procedural (three.js materials,
canvas textures, SVG), so no third-party assets are used.

**License compliance (Apache-2.0, section 4).** The full license with pooltool's attribution is in
`apps/engine/src/pool/LICENSE-pooltool.txt` and its byte-identical copy in `apps/web/src/pool/`;
`physics.ts` and `rules.ts` state in their headers what is pooltool's and what NIGHTSHIFT changed;
pooltool has no NOTICE file to carry. Apache-2.0 is compatible with distribution inside an MIT
repository; those files stay under Apache-2.0.

## 4. Platform rules

* **Telegram.** Telegram's [Bot Developer Terms](https://telegram.org/tos/bot-developers) (6.2, 7)
  allow digital goods inside a Mini App only for Telegram Stars, with no crypto wallet but TON
  Connect and no promotion of non-TON tokens. NIGHT POOL is therefore not in the Mini App at all: it
  lives on the website and the PWA, with the four-asset prices, staked duels and cosmetics, and
  Telegram's bot links to the website game, which opens in Telegram's in-app browser. That browser
  has no injected wallet, so signing in and paying go through the site's wallet chooser, which
  offers WalletConnect (deep links to a wallet app on phones, a QR code on desktop); the game runs
  in lite mode there (`lite.ts` detects Telegram's webview), and free play needs no wallet at all.
* **Fair play.** Cosmetics carry no power: the only stat is a cue's aim-guide length, at most +12%,
  and it never applies in a staked duel (both players get the standard guide).
