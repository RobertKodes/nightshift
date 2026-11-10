# NIGHTSHIFT // PROTOCOL INTERFACE (v3)

The owner's brief: **techy, DeFi-protocol, SaaS, pixelated, meme (the Pepe frog), IMD-related. Serious but meme-worthy.** Built on React Bits components (reactbits.dev), really used and tuned to us, not pasted in as-is.

The reference pages are `saas/Home.tsx` (+ `home3.css`) and `saas/Observatory.tsx` (+ `pages/observatory.css`). Read them first. Every page should feel like the same product.

## Look
- **Base:** flat ink `--px-bg #050706`, panels `--px-panel #0a0f0b`, lime hairlines `--px-line` / `--px-line2`, 2px radius at most. Corner ticks on blocks (`.pk-panel`, `.card` get them automatically).
- **Colours:** lime `--px-lime #b8ff3d` (actions, live, money in), Pepe green `--px-pepe #57d97b`, gold `--px-gold` (warnings, burns, $SHIFT), red `--px-red` (danger, loss), **IMD blue `#2f7bff`** only for things that are IMD's own (the swarm, IMD token, IMD tools).
- **Type:** `--px-display` Space Grotesk 600 for titles (tight letter-spacing), `--px-sans` Inter for text, `--px-mono` JetBrains Mono for numbers/addresses/buttons, `--px-pixel` **Silkscreen** for small labels, kickers, tags (uppercase, letter-spacing .05–.07em). No serif, no italics.
- **Meme layer:** the pixel Pepe (`/brand/pepe-pixel.svg`, `/brand/pepe-operator.svg`, `/brand/pepe-sticker.png`), NIGHT FROG art (`/frogs/frog-*.webp`), terminal prompts (`root@nightshift:~$`), split-flap boards, glitch on hover. One or two per page, never noise.
- **No:** gradients-as-decoration, glossy glows, emoji soup, rounded SaaS cards, invented numbers, "earn" promises.

## Building blocks (`saas/kit.tsx`)
`PxHero` (kicker, title + decrypting lime accent, lead, actions, optional aside and React Bits background), `PxStats`/`PxStat` + `PxNum` (CountUp live numbers), `PxPanel` (terminal block with header and LIVE/IDLE state; `tone="imd"` for IMD things), `PxSection`, `PxTag`, `PxButton`. Existing site classes (`.card`, `.btn`, `.pill`, `.field`, tables, `.kpi`, `.docs`) are already restyled site-wide by `protocol.css`.

## React Bits (`src/rb/`, vendor files, don't edit them)
Only the components a page uses are kept in the repo (the rest were removed in v2; take them again from reactbits.dev when a page needs one):
- **Background** (behind a hero only, wide screens only via a `matchMedia('(min-width: 900px)')` + reduced-motion check like `useRich()` in Home, and loaded with `lazy()`): `Dither`, `DotGrid`. At most **one WebGL background per page**, none on phones.
- **Text:** `DecryptedText` (titles, addresses, hashes), `CountUp` (via `PxNum`), `SplitFlapText` (clocks, prices, countdowns), `GlitchText`, `TextType`.
- **Cards & lists:** `SpotlightCard`, `PixelCard`, `ChromaGrid` (image grids; needs a `[data-reveal] { opacity: 1 }` fix scoped in the page CSS), `AnimatedList` (feeds; theme vars are inline, override with `!important`).
- **Effects:** `StarBorder` (the one primary CTA per page), `ElectricBorder` (something that needs attention), `ClickSpark` (already on every page via the shell).
- **Micro:** `SloshGauge` (budget used), `TearTicket` (receipts), `StatusMark` (state).
- Components that take a theme: pass `theme="dark"` and our colours; override their inline CSS variables with `!important` in your page CSS when needed.

## Navigation
One file: `saas/nav.ts`. The header, the phone drawer and tabs, the page tabs under the header, the footer and the /new index all read it. A page that is not listed there still opens by its address; it is simply not in a menu. The AI and agent pages are listed in `SYSTEMS`: they are shown live on the Observatory (`saas/Observatory.tsx`) and linked from it as "details".

## Rules
- **Keep every feature, link, number and API call** a page has. This is a redesign, not new features. Never invent data; a missing number is "—".
- Page-specific CSS goes in a new file next to the page (e.g. `saas/pages/token.css`), scoped under a page class. Don't edit shared files: `saas/*.css`, `saas/kit.*`, `saas/chrome.tsx`, `rb/*`, `nx/*`, `main.tsx`.
- Every page is its own chunk (`page()` in `main.tsx`); only the front page is in the entry. Keep heavy code (three.js, the wallet kit, WebGL backgrounds) behind a `lazy()` or a dynamic `import()`. The shared stylesheets are not split: they load together, in a fixed order, from `src/styles-order.ts` (older page styles restyle each other and depend on that order). A new page scopes its CSS under its own class and imports it from its own module.
- Class names inside a child span: components like `CountUp` render their own `<span>`, so style labels with `>` (`.x > span`), not a bare descendant selector.
- Phone first: check 390px wide. Heavy effects off on phones and with `prefers-reduced-motion`.
- Accessibility: real headings, `aria-hidden` on decoration, focusable controls stay buttons/links.
- Copy: short, plain, honest, protocol voice ("Receipts, not promises."). Light meme touches ("GM", "always shipping", frogs) are welcome; no hype.
