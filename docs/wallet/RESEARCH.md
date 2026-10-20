# Wallet connection: research notes

Read on 2026-10-20: npm and GitHub live, Reown's docs as `.md` from docs.reown.com, Telegram's own
pages, and the installed package source where the docs were silent (the file is named each time).
Real users reported four problems: sign-in did not work with MetaMask, above all on phones; the
connect flow on a phone was hard to use and looked bad; WalletConnect wallets warned "this is a
malicious website"; and in the Telegram Mini App, MetaMask errored.

| Source | Read | What it is |
|---|---|---|
| https://registry.npmjs.org/-/package/@reown/appkit/dist-tags | 2026-10-20 | `latest` 1.8.24 (published 2026-09-16); `canary` 2.0.0 |
| https://docs.reown.com/appkit/react/core/installation | 2026-10-20 | install line pins `wagmi@2.x`; "a beta version of AppKit that supports Wagmi 3.0 is available" |
| https://docs.reown.com/appkit/faq | 2026-10-20 | keep every `@reown/*` package on the same version; error codes APKT002/APKT005; Telegram/Android custom-scheme note |
| https://docs.reown.com/appkit/domain-verification | 2026-10-20 | allowlist the domain plus `metadata.url`; the four Verify states |
| https://docs.reown.com/cloud/dashboard-configuration-settings | 2026-10-20 | Configuration tab, Domain, allowlist |
| https://docs.reown.com/advanced/security/content-security-policy | 2026-10-20 | Reown's partial CSP (quoted in section 6) |
| https://docs.reown.com/appkit/authentication/siwx/default, .../siwx-custom, .../reown-authentication | 2026-10-20 | SIWX, ReownAuthentication, custom SIWX |
| https://docs.reown.com/appkit/paid-plans/starter, https://reown.com/pricing | 2026-10-20 | Starter (free): 500 authenticated or embedded-wallet MAU, cut off at the limit |
| https://reown.com/learn/how-to-build-a-telegram-mini-app | 2026-10-20 (dated 06.23.2026) | AppKit "works with Telegram bots and mini-apps right out of the box" |
| https://telegram.org/tos/bot-developers (sections 7.2 to 7.4), https://core.telegram.org/bots/blockchain-guidelines | 2026-10-20 | Mini Apps: crypto wallets through TON Connect only (section 7) |
| https://core.telegram.org/bots/webapps | 2026-10-20 (latest entry Bot API 10.1, June 11 2026) | `openLink`, `openTelegramLink` |
| https://viem.sh/docs/actions/public/verifyMessage | 2026-10-20 | EOA, ERC-1271, ERC-6492 and ERC-8010 checks |
| https://github.com/coinbase/smart-wallet/blob/main/src/ERC1271.sol | 2026-10-20 | `replaySafeHash`: a signature is bound to `block.chainid` |
| https://docs.metamask.io/metamask-connect, https://registry.npmjs.org/@metamask/sdk | 2026-10-20 | `@metamask/sdk` 0.34.0 deprecated; successor `@metamask/connect-evm` 2.1.1 |
| https://eips.ethereum.org/EIPS/eip-6963, https://eips.ethereum.org/EIPS/eip-4361 | 2026-10-20 | multi-wallet discovery; Sign-In with Ethereum (chain-id: where contract accounts resolve) |

## 1. The choice: Reown AppKit 1.8.24 with the wagmi adapter (wagmi 2)

- Versions:
  - `@reown/appkit` and `@reown/appkit-adapter-wagmi` are both 1.8.24.
  - The adapter's peers are `wagmi >=2.19.5`, `@wagmi/core >=2.21.2` and `viem >=2.55.13`; the
    engine and site already run viem 2.57.7.
  - Its optional dependency `@wagmi/connectors >=5.9.9` resolves to 8.x, the wagmi 3 line, so the
    root `package.json` pins it at 6.2.0, the version wagmi 2.19.5 ships. Without the pin, pnpm
    installs two wagmi generations side by side.
  - Reown's installation docs pin `wagmi@2.x`; wagmi 3 support is a beta (`2.0.0-wagmi-3.0`).
- Why AppKit:
  - One modal covers browser extensions (EIP-6963, which the old code already used), wallet apps
    on a phone (WalletConnect deep links), a QR code on a computer, a wallet app's own browser and
    Coinbase's smart wallet.
  - It is themeable, and it carries Reown's Verify API, which tells wallets the request comes from
    the real getnightshift.tech.
  - The home-made sheet could not deep-link most apps correctly and had no QR fallback inside
    Telegram.
- Wagmi over ethers: wagmi is documented first and most fully, uses viem (already in both apps),
  and adds no ethers (about 100 kB). Ethers v5 has no social login.
- Our own server sign-in stays (nonce, EIP-4361 message, `personal_sign`, HMAC cookie):
  - AppKit only connects, and the page then signs through the connector's EIP-1193 provider.
  - Nothing in the docs requires SIWX. With SIWX on, the free plan counts every signed-in user
    against its 500 MAU (pricing page, "Authenticated MAUs (if SIWX / SIWE enabled)").
  - One-click auth would also rebuild the message with ReCaps (`SIWXUtil.universalProviderAuthenticate`),
    which our byte-for-byte check would refuse.
- Alternatives:
  - MetaMask SDK is deprecated. MetaMask Connect (`@metamask/connect-evm`) serves MetaMask only.
  - wagmi's `metaMask()` connector needs that same package.
  - Plain EIP-6963 has no answer for phones.

## 2. What the installed source shows (docs were silent)

- **Dashboard switches win over code.**
  - `ConfigUtil.fetchRemoteFeatures` (`@reown/appkit/dist/esm/src/utils/ConfigUtil.js`) ignores
    local `features` whenever the project config loads. Read on 2026-10-20, our project
    (`adbab93f…`) returns:
    - `reown_authentication: isEnabled true`
    - `swap`, `onramp`, `activity` and `event_tracking` on
    - `social_login` with `config: null`, so the local value decides
  - With Reown Authentication on, every connected wallet got a second "Sign In" prompt to Reown
    before ours. That is confirmed headless; the screenshot was taken before the fix.
  - `walletkit.ts` therefore switches SIWX, swaps, on-ramp, activity, payments, email and socials
    off itself, after `modal.ready()`.
- **`enableBaseAccount: false` does nothing in 1.8.24.**
  - The client never calls `OptionsController.setEnableBaseAccount`, so the adapter adds Base's
    account SDK for everyone: 92 kB gz, plus 38 kB of the `@wagmi/connectors` index, plus an
    inline telemetry script that our CSP refuses.
  - `walletkit.ts` skips the adapter's `addThirdPartyConnectors`. Those connectors are Base
    Account, Coinbase and Safe's in-app connector.
  - We add Coinbase ourselves: `coinbaseWallet` version 4, telemetry off, wrapped so its SDK
    (70 kB gz) loads only when someone picks Coinbase or reconnects with it.
- **Catalogue ids.**
  - AppKit maps its Coinbase SDK connector to catalogue id `d0ca99ff…` (`PresetsUtil.ConnectorExplorerIds`).
    `fd20dc42…` ("Base, formerly Coinbase Wallet") is Base Account's id.
  - Featuring `fd20dc42…` hid Coinbase on phones, where only WalletConnect-capable or mandatory
    ids are shown (`WalletUtil.filterWalletsByWcSupport`).
  - Featured, in order: MetaMask `c57ca95b…`, Trust `4622a2b2…`, Coinbase `d0ca99ff…`,
    Rainbow `1ae92b26…`, OKX `971e689d…`.
- **Telegram.**
  - `CoreHelperUtil.isTelegram()` checks for `window.Telegram` or `TelegramWebviewProxy`. Inside
    Telegram, AppKit opens every deep link with `window.open(href, "_blank")` and encodes the
    wc URI twice on Android.
  - `telegram-web-app.js` `openLink` throws `WebAppTgUrlInvalid` for anything that is not
    http(s), so `metamask://` can never go through it.
- **Theme.** AppKit writes `--apkt-tokens-theme-*` on `:root` (`ThemeHelperUtil.createRootStyles`).
  `--w3m-color-mix` tints the accent too, so `walletkit.css` sets the NIGHTSHIFT surfaces
  directly under `:root:root`, and the lime accent comes through untouched.

## 3. The Telegram Mini App: no EVM wallet at all

- The rule: Telegram's Bot Platform Developer Terms (sections 7.2 to 7.4) and its blockchain
  guidelines say a Mini App may interface with crypto wallets **only through TON Connect**. It
  must not promote non-TON assets or wallets, or send people to outside sites for them.
- What changed:
  - v0.150 removed from `/tg`:
    - wallet linking
    - the IMD and $SHIFT stake options and their "opening soon" labels
    - the real-money notices
    - staked challenges, staked live games and stake badges
    - the NIGHT FROG avatar in embedded pinball
  - `wallet.ts` `inTelegramApp()` refuses before the wallet layer is even downloaded when any of
    these is true:
    - the path is `/tg`
    - the hash carries `tgWebAppData`
    - `Telegram.WebApp.initData` is set
    - `TelegramWebviewProxy` exists
  - `walletkit.ts` checks the same again.
- Reown's own Telegram guidance ("works out of the box") and its double-encoded Android deep links
  therefore do not apply here.
- If wallets ever come back to the Mini App, the allowed route is TON Connect (`@tonconnect/ui`),
  not AppKit.

## 4. Email and social login

- Embedded wallets: `features.email`, `features.socials`. They are non-custodial (Magic behind
  Reown) and use the `https://secure.walletconnect.org` iframe; OAuth goes through `auth.magic.link`.
- The free Starter plan allows 500 "Authenticated (SIWX/SIWE) or Embedded Wallet MAUs", then
  "Cut off at limit", which pauses the project, WalletConnect included. Pro is $89 a month for
  7,500 MAU.
- Google refuses OAuth in embedded webviews (`disallowed_useragent`), and AppKit itself drops
  Google inside Telegram on iOS (`OptionsUtil.filterSocialsByPlatform`).
- Decision: **off**. One hard cap would take every wallet connection down with it.
- To offer them later:
  - set `email: true` and `socials: [...]` in the `features` of `walletkit.ts`
  - remove `email`/`socials` from the post-ready override
  - switch them on in the dashboard
  - add `frame-src https://secure.walletconnect.org`
  - have the owner accept the MAU cap

## 5. Domain verification (the "malicious website" warning)

- Reown's current docs list two steps only:
  1. dashboard.reown.com, then the project, then the **Configuration** tab, then **Domain**,
     **+ Domain**, **Allowlist**.
  2. `metadata.url` set to the same domain.
- Propagation takes up to 5 minutes. There is **no file to serve**: the DNS TXT record or
  static-file method appears only on the old `/cloud/verify` page, which now returns 404.
  So no `/.well-known/walletconnect.txt` route was added.
- `metadata.url` comes from the engine's `PUBLIC_URL` origin (`/api/wallet-config`, `site`):
  - On live it is `https://getnightshift.tech`.
  - The www twin is used when the page itself is on `www.getnightshift.tech`, which must then be
    allowlisted too.
  - Never `/tg`.
- The four Verify states in wallets:
  - VALID: Domain Match
  - UNKNOWN: Cannot Verify
  - INVALID: Domain Mismatch
  - `isScam`: Security Risk, sourced from Hexagate, ChainPatrol and Hypernative. If that one ever
    shows, request delisting from those three providers. Reown cannot clear it.
- An origin that is not allowlisted raises AppKit alert APKT002. Some wallets run their own checks
  as well: Reown's FAQ notes MetaMask Mobile's August 2026 UI update "preventing validation of
  valid apps".

## 6. Content Security Policy

- Reown's partial CSP, quoted from the docs:
  - `connect-src`:
    - rpc, relay, pulse, keys, notify, echo and push `.walletconnect.com/.org`
    - `api.web3modal.com/.org`
    - `wss://relay.walletconnect.*`
    - `wss://www.walletlink.org`
    - `https://cca-lite.coinbase.com`
  - `frame-src`: `verify.walletconnect.*`, `secure.walletconnect.*`
  - `img-src`: `* data: blob:` plus Reown's hosts
  - `font-src`: `https://fonts.reown.com`
  - `Cross-Origin-Opener-Policy: same-origin-allow-popups`
  - Reown's lab middleware also allows `api.reown.com` and `secure.reown.com`.
- What the headless check saw (2026-10-20, under the engine's own CSP, zero violations):
  - `api.web3modal.org`: wallet list, images, project config
  - `rpc.walletconnect.org`: AppKit's chain reads
  - `ethereum-rpc.publicnode.com`: wagmi
  - `fonts.googleapis.com` and `fonts.gstatic.com`: our fonts. With our font set, AppKit never
    loads `fonts.reown.com`.
  - Coinbase opens `https://keys.coinbase.com` as a popup, which CSP does not govern.
- The engine's CSP in `server.ts` now matches. Caddy must allow at least the same, because two CSP
  headers both apply.

## 7. Smart accounts

- viem's public `verifyMessage` checks deployed accounts (ERC-1271), undeployed ones (ERC-6492)
  and EIP-7702 delegations (ERC-8010). The standalone util that `auth.ts` used before checks EOAs
  only, so every smart account failed.
- A Coinbase Smart Wallet signature verifies only on the chain it was signed for. EIP-4361 says
  the message's Chain ID is where contract accounts resolve.
- So:
  - the engine checks on Ethereum mainnet: the message says Chain ID 1, and Base is never
    accepted for it, so another account at the same address on another chain cannot sign for it
  - the site switches the wallet to Ethereum before signing
- `auth.ts` checks the key locally first (no node for a plain wallet), then on Ethereum.
- A node that does not answer is reported as "could not be checked", not as a wrong signature,
  because viem returns `false` on a failed call.
- Each nonce gets one try.
