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

`StationHome` measures the native scroll track, giving the scene progress 1–6
for Companies through Proof, then 7 for the connections overview. Chips,
Back/Next, and raycast dock taps scroll to those same positions. It measures
the headline and card clearance to keep the portrait above the controls.
The first stop fits the entire station between its quiet headline area and
the controls. Preview home resets the legacy `main` padding so canvas and
viewport measurements agree and the controls clear the bottom bar.

`StationView` imports the scene after the first HTML render. Its drawn SVG map
is clickable during loading and remains available on import/WebGL failure.
The canvas has a reserved size and fades in without moving the text.

The scene derives all six bays from the site map. Camera targets and offsets
come from each bay's world position and outward normal, with small individual
pitch/side variations. Exact critically damped springs and a slow-scroll hold
settle each stop. The guide is half its previous scale and parks beside bays.
Only the selected bay shows a name. Its oversampled texture uses a 36 CSS px
plaque (about 14 CSS px type), with projection clamping to the clear canvas
area. Hub portraits fit closer to that bay and dim the surrounding hull.

Hub cards are compact whole-card links, two columns from 360px and three on
desktop. Groups do not remove routes. Programmatic heading focus remains
available to screen readers; only keyboard focus draws its visible outline.

Hub headers render only on initialization, texture/font completion, resize,
or visibility changes. Reduced motion and Pause use still frames and camera
cuts. Home animation stops while hidden or outside the viewport. Observers,
listeners, frame callbacks, geometries, instance buffers, materials, textures,
the environment target, and the WebGL context are released on unmount.

DPR is capped at 1.75 (1 in lite mode). The existing merged/instanced station,
fake glow textures, and original painted Earth remain; there are no shadows,
postprocessing, new images, external fonts, or additional runtime packages.
Live figures reuse `readings.ts`, `publicRead.ts`, and `swarmStats.ts`; missing
figures are hidden and customer payment counts are never shown.

## Review

Run the web TypeScript check with a 1024 MB heap. Browser/server rendering,
live endpoint checks, and device FPS profiling are reserved for the owner's
review workflow. Next review targets: all six portraits at 390×844 and 375px,
short landscape layouts, keyboard/screen reader search, no-WebGL fallback,
and actual phone frame times. Existing destination pages remain phase 2.
