# Hidden station preview

Only `/new` and `/new/*` mount this shell. Existing destinations and their styles
are unchanged. The logo returns to `/new`; no existing page links to the preview.

## Routes and copy

`sitemap.ts` owns the six sections, dock identities, accents, descriptions,
actions, item copy, wallet requirements, search terms, and legacy aliases.
Large hub sections also take their short group headings from this directory.

The hubs are `/new/companies`, `/new/tools`, `/new/play`, `/new/shift`,
`/new/frogs`, and `/new/proof`. Unknown preview paths show a way back.

The directory includes every route family and subpage in `main.tsx` and every
destination in `nx/map.ts`, including old room aliases, `/staking`,
`/agents/start`, `/tg`, `/setup`, company detail pages, crew profiles, league
details, and launchpad subpages. The old footer's two local reading/status
resources are included too. A dynamic URL opens its existing directory, where
the visitor chooses a real record; placeholder IDs are never used as links.

## Navigation

`SiteShell` owns the six-section bar, session wallet control, compact footer,
and search. `FindAnything` uses a native modal with focus restoration. `/` and
Ctrl/Cmd+K open it; arrows choose a result, Enter opens it, and Escape closes it.
Search includes titles, descriptions, keywords, route patterns, and aliases.

## Flight and rendering

`StationHome` places six real quick-action links below the short headline on
phones and beside it on desktop. Public readouts are shown only after valid
responses arrive. Staking reuses token overview; agents reuse swarm stats;
live games reuse the live tables endpoint; products use the existing market
search count, with simulation mode hidden. No payment counters are exposed.

Native document scroll drives stops 1-6 and then the connections overview.
Chips, Back/Next and raycast module taps reach those same positions. Pointer
movement is restrained. Reduced motion and Pause render still frames and
camera cuts. The selected module alone has a small monospace label. Hub
portraits render only on invalidation, resize, font/texture completion or
visibility changes. Hidden and offscreen scenes stop rendering.

The station uses shared PBR materials, locally generated panel grain/seams and
solar-cell textures, merged static hardware, six pressure modules, trusses,
four solar wings, radiator banks, warm windows, docking collars and antennas.
Lighting is one warm-white sun and faint Earth bounce, with a neutral baked
reflection field. ACES filmic tone mapping and sRGB output are enabled. There
are no shadows, bloom, painted backgrounds, nebulae, frog guide or new runtime
dependencies. The background is a sphere with a local NASA Black Marble 2016
emission texture and a thin Fresnel atmosphere. Wide screens load 4096px;
phones load 2048px. Earth rotation is very slow and stars are fine points.

`StationView` lazy-imports the only three.js entry point after the first HTML
render. Its technical SVG station plan is navigable while loading and on
import, texture or WebGL failure. HTML navigation always remains available.
DPR is capped at 1.75 on desktop, 1.5 on phones and 1 in lite mode. Listeners,
observers, frame callbacks, geometry, materials, textures, the reflection
render target and the WebGL context are released on unmount.

All styles are scoped to `.pv`: graphite surfaces, restrained violet actions,
small radii, hairline dividers, system UI text and monospace readouts. Section
colors are limited to small dots and thin indicators. Existing destinations
and the complete searchable site map are preserved. The footer credits NASA.

## Landing

`/new/welcome` (`Welcome.tsx`, `welcome.css`) is the front door, drawn as a ship's
bridge: a windshield over the night-side Earth with the greeting on the glass, a
glareshield of annunciators lit by live reads and a UTC clock, and a graphite
console with three bezelled displays. The main display is a scrollable live
feed of the whole project: the IMD swarm, companies and their next shifts, the
market, the Swarm Desk and house tools, live tables, $SHIFT, NIGHT FROGS, SWARM
MIND, connected agents, a merged event log and the six sections; its header
names the section being read. The side displays (desktop) carry the swarm and
ship instruments; a message display repeats the key readings. One lit push
button leads into the station. Every value comes from public reads
(`usePublicRead` with its own refresh rate, paused in hidden tabs); missing
reads show a dash, never zero. The feed drifts down by itself after a few idle
seconds and loops; any touch, wheel or key hands it back. Nothing floats or
flickers; reduced motion also stops the drift, the Earth's turn and the
message display. The page fits one screen, so only the main display scrolls.

## Operations deck and collection art

`/new/ship` is a separate, lazy-loaded interior preview. `/ship` and its pixel
renderer remain unchanged. The Frogs directory and search open the preview;
the old `/ship` address remains a search alias. The exterior command module
has a locally drawn, embroidered mission-patch decal using the real
`/frogs/frog-001.webp`, with the same collection thumbnail on the Frogs tour
card and hub header. A small arrival inset shows the same canvas patch up
close, so it remains identifiable at the full-station framing. No generated frog image replaces the original art.

`ship3d/data.ts` polls the existing `/api/ship`, `/api/ship/art`,
`/api/games/live`, `/api/companies` and connected-wallet crew endpoints. It
validates responses and separates missing data from empty results. Mission
Frogs, working companies, live tables and Watchers appear in four bays. The
complete searchable, paginated list and details are available without WebGL.
Company operators represent the task feed; it does not identify a particular
NFT as the owner of that company. NFT details preserve onchain art, missions,
traits, rates, owner and forge links; Watchers also show their watch state.

The deck is one module of four rooms joined by doorways: a mission war room
around a holographic table, a company desk island, a games room with a game
table, sofa and pinball machine, and a watch room with the Captain's dais and
the radar. Each room has eight crew from the shipped LASTSPAWN rig
(SkeletonUtils clones of the cached glTF) in department vests and restrained
PBR skin. `ship3d/layout.ts` holds the seats, standing places, walking lanes
and camera shots; `ship3d/brain.ts` lets frogs work at their consoles, roll
their chairs back, walk to the window, the table or a colleague's desk and sit
down again, with at most two away per room. Consoles face into the room, so
faces show over raked screens. Only the rooms in view render and animate. A
small light rig travels with the camera; the windows show the night-side
Earth (NASA Black Marble city lights, a thin limb) and stars. The camera holds
one drifting shot per room, flies through the doorways between rooms and
gives a picked frog a close shot; there is no free flight. Hover shows a
frog's name and duty. Pause, hidden/offscreen suspension, reduced-motion cuts
with still poses, the lite renderer without post effects and DPR caps apply;
desktops add real shadows, phones a contact shadow. List mode releases the
renderer, and unmount releases rig, material, texture, observer and frame
resources while retaining the shared glTF asset cache.

## Review

Run `pnpm --filter @nightshift/web typecheck` with a 1024 MB heap. Review all
six portraits at 390x844 and 375px, short landscape layouts, keyboard and
screen-reader search, reduced motion, no-WebGL fallback, and phone frame times.
Browser review and real-device FPS measurements require a browser/device.
