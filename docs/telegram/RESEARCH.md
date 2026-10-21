# Telegram Mini App and bot: research notes

> **2026-10-21: the Mini App was removed.** Telegram's Bot Developer Terms (section 7) allow only TON
> for crypto inside a Mini App, and the NIGHTSHIFT games use $SHIFT, IMD and ETH. The games are played
> on the website and its installable app (PWA) only. @nightshiftimdbot keeps its community side (buy
> bot, frog alerts, announcements, company alerts); its menu button is the command list, and `/play`,
> `/live`, `/challenge`, `/profile` and inline `@bot chess` answer with plain links to
> getnightshift.tech/games, which Telegram opens in its in-app browser (where the site's wallet
> works). `/tg` only says the Game Room moved (inside a Mini App webview) or redirects to `/games`.
> DATA_DIR/telegram.json is still read for `/profile`. The notes below are kept as history.

Read on 2026-10-20 from Telegram's own documentation. Every claim below links to the page it comes
from; the "Recent changes" of each page are quoted with their dates so a later reader can see
what moved since.

| Source | Read | What it is |
|---|---|---|
| https://core.telegram.org/bots/webapps | 2026-10-20 (latest entry: Bot API 10.1, June 11, 2026) | Mini Apps: launch modes, WebApp JS API, initData, validation |
| https://core.telegram.org/bots/api | 2026-10-20 (latest entry: Bot API 10.3, August 24, 2026) | Bot API: buttons, menu button, inline mode, getUpdates |
| https://core.telegram.org/bots/inline | 2026-10-20 | Inline mode overview (BotFather `/setinline`) |
| https://telegram.org/js/telegram-web-app.js | 2026-10-20 (Last-Modified: Tue, 06 Oct 2026 09:27:17 GMT) | The WebApp script itself (read line by line for CSP) |
| https://telegram.org/tos/bot-developers | 2026-10-20 | Bot Platform Developer Terms (ownership of Telegram's code, section 8) |

## 1. initData and how the server checks it

From [Validating data received via the Mini App](https://core.telegram.org/bots/webapps#validating-data-received-via-the-mini-app):

- `Telegram.WebApp.initData` is a query string. The data-check-string is **every received field
  except `hash`**, sorted alphabetically, as `key=<value>`, joined with `\n` (0x0A).
- `secret_key = HMAC_SHA256(<bot_token>, "WebAppData")` (the constant is the HMAC key, the token
  the message), then `hex(HMAC_SHA256(data_check_string, secret_key)) == hash`.
- "To prevent the use of outdated data, you can additionally check the `auth_date` field."
- `initDataUnsafe` "should not be trusted"; only `initData`, validated on the server.
- Since Bot API 8.0 there is also `signature` (Ed25519, for third parties, with Telegram's public
  keys: production `e7bf03a2fa4602af4580703d88dda5bb59f32ed8b02a56c187fe7d34caed242d`). We hold
  the bot token, so we use the HMAC check; `signature` stays in the data-check-string as a field
  (the HMAC rule excludes only `hash`).
- `WebAppUser.id` "has at most 52 significant bits": safe as a JS number. `photo_url` is "now
  available to all Mini Apps" (Bot API 8.0) when the user's privacy settings allow it.
- `start_param` carries the `startapp` value of a direct link (and the GET parameter
  `tgWebAppStartParam`).

What we built (apps/engine/src/tg.ts `validateInitData`): constant-time hash compare, exactly one
64-hex `hash`, `auth_date` at most `TELEGRAM_INITDATA_MAX_AGE` seconds old (24 h by default, a Mini
App keeps the initData it was opened with) and not more than 60 s in the future, a user with a
positive safe-integer id. The Mini App sends it as `Authorization: tma <initData>` (the scheme
Telegram's own Serverless helper in telegram-web-app.js uses) on every `/api/tg/*` request, and the
server checks it on every request.

## 2. Launching the Mini App, deep links, buttons

From [Implementing Mini Apps](https://core.telegram.org/bots/webapps#implementing-mini-apps):

- **Inline button** (`web_app` InlineKeyboardButton): opens our URL with the user's data.
  [InlineKeyboardButton](https://core.telegram.org/bots/api#inlinekeyboardbutton): `web_app` is
  "Available only in private chats between a user and the bot". In groups we use a **url** button
  to a t.me link instead.
- **Menu button**: [setChatMenuButton](https://core.telegram.org/bots/api#setchatmenubutton) with
  `MenuButtonWebApp`; without `chat_id` it changes the default for everyone. We set it to the Mini
  App and give operator chats `MenuButtonCommands`, so their command list stays where it was.
- **Direct link**: `https://t.me/<bot>/<appname>?startapp=<param>` (the app is created with
  BotFather `/newapp`). **Main Mini App** (Bot API 7.8): `https://t.me/<bot>?startapp=<param>`,
  set in BotFather's Mini App settings. Both pass `start_param`. Since Bot API 7.6 they open full
  height by default (`mode=compact` for half). `startapp` allows `A-Z a-z 0-9 _ -`, up to 512
  characters.
- A `web_app` button gets no `start_param`, so our buttons add `?s=<param>` to the Mini App URL
  (only a navigation hint; who the user is still comes from initData).

Our start parameters (apps/engine/src/tg.ts `parseStartParam`): `chess_<id>` (a challenge, an open
table to join, your own seat to resume, or a game to watch), `pinball_<id>`, `watch_<id>`,
`watch_chess_<id>`, `watch_pinball_<id>`, `lounge`, `live`, `me`.

## 3. The WebApp JS API we use

From [Initializing Mini Apps](https://core.telegram.org/bots/webapps#initializing-mini-apps) and the
class tables on the same page:

| Feature | API | Since |
|---|---|---|
| Ready, full height | `ready()`, `expand()` | 6.0 |
| Theme | `colorScheme`, `themeParams` (`bg_color`, `hint_color`, `destructive_text_color`, …), event `themeChanged` | 6.0 / 7.0 |
| Our colours on Telegram's chrome | `setHeaderColor`, `setBackgroundColor` (6.1), `setBottomBarColor` (7.10) | |
| Back button | `BackButton.show/hide/onClick/offClick` | 6.1 |
| Haptics | `HapticFeedback.impactOccurred(light…heavy)`, `notificationOccurred(success/warning/error)`, `selectionChanged` | 6.1 |
| Full screen | `requestFullscreen`, `exitFullscreen`, `isFullscreen`, event `fullscreenChanged` | 8.0 |
| Safe areas | `safeAreaInset`, `contentSafeAreaInset`, events `safeAreaChanged`, `contentSafeAreaChanged` | 8.0 |
| No swipe-to-close during a game | `disableVerticalSwipes`, `enableVerticalSwipes` | 7.7 |
| Ask before closing during a game | `enableClosingConfirmation` | 6.2 |
| Share | `switchInlineQuery(query, chat types)` | 6.7 |
| Links | `openTelegramLink` (no longer closes the app since 7.0), `openLink` | 6.1 |
| Confirm | `showConfirm` | 6.2 |
| CloudStorage | `setItem/getItem/…`, up to 1024 keys per user, values up to 4096 characters | 6.9 |

Every call in apps/web/src/tg/telegram.ts is behind `isVersionAtLeast`, so an older client degrades
quietly. We do not use CloudStorage: profiles live on the server (the only place a Telegram
identity can be trusted), and seat tokens stay in `sessionStorage` for a reload.

Android adds `Telegram-Android/… (…; LOW|AVERAGE|HIGH)` to the User-Agent ("minimizing animations
… on low-performance devices"); the games run in lite mode in Telegram anyway (apps/web/src/lite.ts).

## 4. Inline mode

From [answerInlineQuery](https://core.telegram.org/bots/api#answerinlinequery) and
[InlineQueryResultArticle](https://core.telegram.org/bots/api#inlinequeryresultarticle):

- Enabled with BotFather `/setinline`; updates of type `inline_query` must be in
  `allowed_updates` of `getUpdates` (we add it only when the inline handler exists).
- At most 50 results; `cache_time` (default 300 s); `is_personal` caches per user. Our results are
  per user (each card carries its sender's own challenge), so `is_personal: true, cache_time: 5`.
- Article: `type: "article"`, `id` 1–64 bytes, `title`, `input_message_content`
  (InputTextMessageContent with `parse_mode`), optional `reply_markup`, `description`,
  `thumbnail_url`. "All URLs passed in inline query results will be available to end users."
- `button` (InlineQueryResultsButton) above the results: `start_parameter` 1–64 chars
  `A-Za-z0-9_-`. Ours opens the bot with `/start play` (which also opts the user in to DMs).
- `web_app` buttons are private-chat only, so inline cards use t.me url buttons.

## 5. telegram-web-app.js and our Content-Security-Policy

The live site's policy is set by Caddy (read with `curl -I https://getnightshift.tech/` on
2026-10-20): `script-src 'self'`, `frame-ancestors 'none'`, plus `X-Frame-Options: DENY`. What the
script needs, from reading it (version of 2026-10-06, 119,731 bytes, SHA-256
`124bdff7ba3fe86c8ba5143467afec21e020405e74abdb92cfdda6c0ee3b5908`):

- **script-src**: Telegram's docs load it from `https://telegram.org/js/telegram-web-app.js`. We
  serve an unmodified copy from our own origin (`/tg/telegram-web-app.js`, see
  `apps/web/public/tg/NOTICE.txt`), so `script-src 'self'` stays as it is. The engine puts the
  script tag first in the head of the /tg page only.
- **style-src**: the script writes `<style>` elements (`iFrameStyle.innerHTML = …` from
  `set_custom_style` messages sent by `https://web.telegram.org` only, and the bottom button's shine
  animation) and CSS variables on `<html>` (`--tg-theme-*`, `--tg-viewport-*`, `--tg-safe-area-*`).
  Our `style-src 'self' 'unsafe-inline' …` already allows that.
- **connect-src**: nothing. It talks to Telegram through `window.TelegramWebviewProxy.postEvent`
  (phones), `window.external.notify` (old desktop) or `window.parent.postMessage(…, '*')` (Telegram
  Web, inside an iframe). Its only `fetch` is the optional Serverless helper (`/api/<name>`, same
  origin), which we do not use.
- **frame-src**: only for `tg://` links opened outside Telegram on iOS (a hidden iframe); inside
  Telegram links go through `openTelegramLink`. Nothing to add.
- **frame-ancestors**: this is the one change. Telegram's phone and desktop apps open the Mini App
  as their own page in a webview, unframed, so `frame-ancestors 'none'` does not stop them. **Telegram
  Web (web.telegram.org/k and /a) shows a Mini App in an iframe**, and the script itself checks
  `event.origin === 'https://web.telegram.org'`. With `frame-ancestors 'none'` and `X-Frame-Options:
  DENY` the Mini App is blank in Telegram Web.

### The Caddy change needed (not applied: the server is not edited from here)

For the paths `/tg` and `/tg/*` only, the same policy with Telegram Web allowed as a parent, and no
`X-Frame-Options` (CSP `frame-ancestors` already replaces it; leaving `DENY` there would contradict
it and older browsers obey it). In the `getnightshift.tech` site block, before the existing site-wide
header line, add a matcher and give it its own headers, and keep the existing headers for everything
else:

```caddyfile
@tg path /tg /tg/*
header @tg {
	-X-Frame-Options
	Content-Security-Policy "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com data:; img-src 'self' data: blob: https:; media-src 'self' https:; connect-src 'self' https://ethereum-rpc.publicnode.com https://rpc.mevblocker.io https://eth.drpc.org https://mainnet.base.org https://sepolia.base.org https://api.imd.fun https://api.dexscreener.com https://*.walletconnect.com https://*.walletconnect.org https://*.reown.com https://*.web3modal.org https://*.web3modal.com wss:; frame-src https://verify.walletconnect.com https://verify.walletconnect.org https://*.reown.com; frame-ancestors https://web.telegram.org https://webk.telegram.org https://webz.telegram.org; base-uri 'self'; form-action 'self'; object-src 'none'"
}
@site not path /tg /tg/*
```

and change the existing site-wide `header { … }` (the one that sets `Content-Security-Policy … 
frame-ancestors 'none' …` and `X-Frame-Options DENY`) to `header @site { … }`, so the two never
both apply to /tg. The value above is the live policy as served on 2026-10-20 with exactly one
directive changed: `frame-ancestors 'none'` → `frame-ancestors https://web.telegram.org
https://webk.telegram.org https://webz.telegram.org` (webk/webz are Telegram Web's older hosts that
still redirect; keep or drop them). Nothing else changes: `script-src 'self'` stays, the script is
ours to serve. Check after reloading Caddy:

```sh
curl -sI https://getnightshift.tech/tg | grep -iE "content-security|x-frame"   # frame-ancestors https://web.telegram.org …, no X-Frame-Options
curl -sI https://getnightshift.tech/   | grep -iE "content-security|x-frame"   # unchanged: frame-ancestors 'none', X-Frame-Options: DENY
```

The engine sends the same policy itself for /tg (apps/engine/src/server.ts `TG_CSP`), so a deploy
without Caddy in front behaves the same.

Note on cookies: inside Telegram Web the Mini App is a third-party frame, so the site's
`SameSite=Lax` session cookie is not sent there. The Mini App never needs it for its own API
(initData is the credential). For staked duels, linking a wallet returns the session token to the
page once, kept in memory only, and sent as `Authorization: Bearer` to the escrow routes.

## 6. BotFather setup (operator, once)

1. `/setinline` → the bot → placeholder `chess` (turns on "@nightshiftimdbot chess").
2. Bot Settings → Configure Mini App → Enable, URL `https://getnightshift.tech/tg` (the Main Mini
   App: links `t.me/nightshiftimdbot?startapp=…`). Optionally `/newapp` with short name e.g. `play`
   and the same URL, then set `TELEGRAM_APP_NAME=play` so links read `t.me/nightshiftimdbot/play?startapp=…`.
3. The engine sets the chat menu button itself at start (`setChatMenuButton`, web_app "Play").
4. Optional: `TELEGRAM_BOT_USERNAME` if the bot is not `@nightshiftimdbot`.

## 7. Decisions that follow from the research

- No custody: the Mini App never holds funds, keys or balances. Staked duels use the existing
  GameEscrow flow with the player's own wallet (WalletConnect/injected, apps/web/src/wallet.ts).
- The Telegram id is a server-side key only (DATA_DIR/telegram.json, mode 0600). Every view and
  link uses a random public id; other players see the display name and Elo only; the photo is shown
  to its owner alone (Telegram's photo URLs can carry the username).
- DMs only after the user pressed Start in a private chat (the Bot API cannot message users who
  never did, and a 403 "blocked by the user" turns them off again), at most 20 an hour.
- `TELEGRAM_OFFLINE=1` keeps every Bot API call on the machine (no polling, no sends): for local
  runs with a made-up token and for the smoke test.
