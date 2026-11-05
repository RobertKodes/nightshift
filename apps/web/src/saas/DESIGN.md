# NIGHTSHIFT // PROTOCOL INTERFACE (v3)

The owner's brief: **techy, DeFi-protocol, SaaS, pixelated, meme (the Pepe frog), IMD-related. Serious but meme-worthy.** Built on React Bits components (reactbits.dev), really used and tuned to us, not pasted in as-is.

The reference page is `saas/Home.tsx` (+ `home3.css`). Read it first. Every page should feel like the same product.

## Look
- **Base:** flat ink `--px-bg #050706`, panels `--px-panel #0a0f0b`, lime hairlines `--px-line` / `--px-line2`, 2px radius at most. Corner ticks on blocks (`.pk-panel`, `.card` get them automatically).
- **Colours:** lime `--px-lime #b8ff3d` (actions, live, money in), Pepe green `--px-pepe #57d97b`, gold `--px-gold` (warnings, burns, $SHIFT), red `--px-red` (danger, loss), **IMD blue `#2f7bff`** only for things that are IMD's own (the swarm, IMD token, IMD tools).
- **Type:** `--px-display` Space Grotesk 600 for titles (tight letter-spacing), `--px-sans` Inter for text, `--px-mono` JetBrains Mono for numbers/addresses/buttons, `--px-pixel` **Silkscreen** for small labels, kickers, tags (uppercase, letter-spacing .05–.07em). No serif, no italics.
- **Meme layer:** the pixel Pepe (`/brand/pepe-pixel.svg`, `/brand/pepe-operator.svg`, `/brand/pepe-sticker.png`), NIGHT FROG art (`/frogs/frog-*.webp`), terminal prompts (`root@nightshift:~$`), split-flap boards, glitch on hover. One or two per page, never noise.
- **No:** gradients-as-decoration, glossy glows, emoji soup, rounded SaaS cards, invented numbers, "earn" promises.

## Building blocks (`saas/kit.tsx`)
`PxHero` (kicker, title + decrypting lime accent, lead, actions, optional aside and React Bits background), `PxStats`/`PxStat` + `PxNum` (CountUp live numbers), `PxPanel` (terminal block with header and LIVE/IDLE state; `tone="imd"` for IMD things), `PxSection`, `PxTag`, `PxButton`. Existing site classes (`.card`, `.btn`, `.pill`, `.field`, tables, `.kpi`, `.docs`) are already restyled site-wide by `protocol.css`.

## React Bits (`src/rb/`, vendor files, don't edit them)
Good fits, by job:
- **Backgrounds** (behind a hero only, low opacity, desktop only via a `matchMedia('(min-width: 900px)')` + reduced-motion check like `useRich()` in Home): `DotGrid` (WebGL2, light — the default choice), `PixelSnow`, `LetterGlitch`, `FaultyTerminal`, `PixelBlast`, `Dither`. At most **one WebGL background per page**.
- **Text:** `DecryptedText` (titles, addresses, hashes), `CountUp` (via `PxNum`), `SplitFlapText` (clocks, prices, countdowns), `GlitchText` (hover on a heading; pass `fontSize="inherit" fontWeight="inherit" color="inherit"`), `TextType` (example prompts), `ShinyText`, `ScrambledText`, `RotatingText`, `FuzzyText` (404 / meme moments).
- **Cards & lists:** `SpotlightCard`, `PixelCard` (hover pixel reveal, see Home "Six ways in"), `MagicBento` (feature grids), `ChromaGrid` (image grids, e.g. frogs — note: needs `.ns3 .chroma-grid[data-reveal] { opacity: 1 }`-style fix if the old `[data-reveal]` rule applies; scope it in your page CSS), `AnimatedList` (feeds; theme vars are inline, override with `!important`, see home3.css), `Counter`, `Stepper` (multi-step forms), `ElasticSlider` (limits/amounts).
- **Effects:** `StarBorder` (the one primary CTA per page), `ElectricBorder` (something that needs attention: a pending approval, a live game), `GlareHover`, `Magnet`, `LogoLoop`, `ClickSpark` (already on every page via the shell).
- **Micro:** `HoldButton` / `SlideCommit` (confirm a money action), `SloshGauge` (budget used), `TearTicket` (receipts), `StatusMark` (state), `CodeSlots` (codes/addresses), `SquishSwitch` (toggles).
- Avoid `StickerPeel` (its WebGL context is lost on load here) and `GridScan` (renders a grey sheen).
- Components that take a theme: pass `theme="dark"` and our colours; override their inline CSS variables with `!important` in your page CSS when needed.

## Rules
- **Keep every feature, link, number and API call** a page has. This is a redesign, not new features. Never invent data; a missing number is "—".
- Page-specific CSS goes in a new file next to the page (e.g. `saas/pages/token.css`), scoped under a page class. Don't edit shared files: `saas/*.css`, `saas/kit.*`, `saas/chrome.tsx`, `rb/*`, `nx/*`, `main.tsx`.
- Phone first: check 390px wide. Heavy effects off on phones and with `prefers-reduced-motion`.
- Accessibility: real headings, `aria-hidden` on decoration, focusable controls stay buttons/links.
- Copy: short, plain, honest, protocol voice ("Receipts, not promises."). Light meme touches ("GM", "always shipping", frogs) are welcome; no hype.
