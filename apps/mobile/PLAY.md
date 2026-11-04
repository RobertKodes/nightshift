# NIGHTSHIFT on Google Play

Everything the Play Console asks for, ready to paste. Package `tech.getnightshift.app`, personal developer account.

## 1. Before the first upload (owner)

1. **Firebase (phone notifications).** Follow the to-do in `/setup` on the site: make the Firebase project, add the Android app `tech.getnightshift.app`, download `google-services.json` and put it at `apps/mobile/google-services.json`, then paste the service-account key in `/setup`. Rebuild the app after adding the file.
2. **Reown (wallet sign-in).** On dashboard.reown.com, open the project the site uses → its allowlist → add the Android package name `tech.getnightshift.app` next to the domain. Without it, wallets show the app as unverified.
3. **The upload key.** `apps/mobile/scripts/make-upload-key.ps1` makes it once, outside the repository, in `%USERPROFILE%\.nightshift-android\`. Back up that folder (a password manager or an encrypted USB stick): without it you cannot ship updates, though Google can reset an upload key on request.
4. **Build.** `apps/mobile/scripts/build-release.sh` makes `nightshift-<version>.aab`.

## 2. Create the app

Play Console → **Create app**: name `NIGHTSHIFT: Run AI Companies`, default language English (United States), **App**, **Free**. Accept the declarations.

**App signing:** keep **Play App Signing** on (the default) and upload the AAB signed with the upload key. After the first upload, copy **Test and release → App integrity → App signing → SHA-256 of the app signing key** into the to-do in `/setup` (it turns on links from getnightshift.tech into the app).

## 3. Testing, then production

A personal account opened after November 2023 needs a **closed test with at least 12 testers opted in for 14 days in a row** before it can apply for production.

1. **Internal testing** first (minutes, up to 100 testers): upload the AAB, add your own Google account, install it from the opt-in link and check sign-in, push and an approval end to end.
2. **Closed testing**: make a track, add a Google Group or an email list of 12+ real testers (holders, friends), share the opt-in link, and keep them opted in for 14 days. Ask for honest feedback; never offer anything for ratings or reviews.
3. After 14 days: **Apply for production** and answer the questionnaire (who tested, what changed, why it is ready).

## 4. Store listing

- **App name (30):** NIGHTSHIFT: Run AI Companies
- **Short description (80):** Found AI companies, watch every shift live, approve spending with a fingerprint.
- **Full description:**

> NIGHTSHIFT is the owner's app for AI companies. You write one sentence about what a company should sell and to whom; its AI CEO picks the products, orders the work from the IMD agent swarm, puts it on sale, and reports back. You stay in charge of the money.
>
> YOUR DESK
> Every company you run at a glance: what it is doing right now, what it spent today against its budget, its revenue and its profit.
>
> APPROVE WITH YOUR FINGERPRINT
> You set a daily budget and a limit for single purchases. Anything over the limit stops and waits for you. Your phone shows what it is, why the CEO wants it and what it costs; you approve with your fingerprint, and the phone's own security key signs the approval for that exact price. Declining is one tap.
>
> WATCH EVERY SHIFT LIVE
> The live feed shows each decision, check, order, delivery and sale as it happens. Open any shift for its flight record: what the CEO saw, every step with timings, the money that moved and whether it paid for itself.
>
> STEER THE CEO
> Give each company a standing direction it reads every shift. Ask its CEO questions; its answers come with buttons that order research or a build. Report any AI answer that looks wrong or offensive.
>
> BOOKS AND PRODUCTS
> Revenue against spend by day, the full ledger, a CSV to share with your accountant. Set prices and take products off sale.
>
> ON YOUR LOCK SCREEN
> Notifications for approvals, sales and deliveries. A notification only opens the app: nothing is ever approved from the lock screen.
>
> Sign in with your own wallet over WalletConnect (MetaMask, Rainbow, Trust, Coinbase Wallet and others). NIGHTSHIFT never sees your keys and nothing is sold in the app. Not ready to connect a wallet? Look around first with example companies.
>
> For people 18 and over. Results vary: an AI company can spend its budget and make nothing.

- **App icon:** `store/play-icon-512.png`
- **Feature graphic (1024×500):** `store/feature-graphic.png`
- **Phone screenshots:** `store/screenshots/01-desk.png` … (1080×2400 or similar, 2 to 8)
- **Category:** Business. **Tags:** business, productivity.
- **Contact:** a support email you are happy to show publicly; website https://getnightshift.tech
- **Privacy policy:** https://getnightshift.tech/privacy

## 5. App content (Policy → App content)

| Form | Answer |
|---|---|
| **Privacy policy** | https://getnightshift.tech/privacy |
| **Ads** | No ads. |
| **App access** | Some functionality is restricted. Instructions for reviewers: *"On the first screen, tap 'Look around first': a demo with example data opens every screen (Desk, Approvals, Live, Books, More). Signing in needs a crypto wallet app over WalletConnect (for example MetaMask): sign-in is a wallet signature, so there is no username or password to give. Approvals in the demo explain what they would do; in a real account they ask for the fingerprint."* |
| **Content rating** | Category: Utility, Productivity, Communication or Other. Violence, sexuality, language, drugs: none. Gambling or simulated gambling: **No**. Users interact or share content with each other: **No** (the CEO chat is with an AI, private to the owner). Shares location: No. Digital purchases: No. |
| **Target audience** | 18 and over only. Not designed for children. |
| **News app** | No. |
| **Health / COVID / Government** | No. |
| **Financial features** | See section 6. |
| **Data safety** | See section 7. |
| **Account deletion** | In the app: More → Settings → Delete account. On the web: https://getnightshift.tech/delete-account |
| **Generative AI** | Yes: the CEO chat. Users can report any answer (long-press it); reports are kept and reviewed. |

## 6. Financial features and blockchain

- The app **sells nothing** and has **no links** to buying $SHIFT, IMD, NIGHT FROGS, staking, games or company funding (Payments policy). Funding a company is done on the website and is not linked from the app.
- The owner's wallet is an **external** wallet app connected over WalletConnect; the app holds **no wallet keys**, so it is not a software wallet.
- Each company's wallet is held by the NIGHTSHIFT service. The app approves the company's purchases of services (signed approvals the server enforces) and shows balances. In the Play build, **withdrawing and stopping a company happen on the website**, not in the app (`EXPO_PUBLIC_MONEY_OUT` is left unset). Turning them on in the app (`EXPO_PUBLIC_MONEY_OUT=app`) could make Google treat the app as a custodial wallet, which needs an organization account and licences.
- **Declaration to make:** in the Financial features form, describe the app as a business-management app that approves service payments from company accounts held by the service, with no exchange, trading, lending or wallet. If the form asks about tokenized digital assets: the companies receive USDC for the products they sell; the app does not promise or promote earnings.

## 7. Data safety

| Data type | Collected | Shared | Why | Optional |
|---|---|---|---|---|
| Personal info → **User IDs**: wallet address | Yes | No | Account management, app functionality | Required to sign in (the demo needs nothing) |
| **Device or other IDs**: push token, the phone's public approval key, phone name | Yes | No | App functionality (notifications, signed approvals) | Push is optional |
| App activity → **App interactions**: approvals, declines, settings | Yes | No | App functionality | Required |
| App activity → **Other user-generated content**: messages to the AI CEO, reports | Yes | No | App functionality, safety (reports) | Optional |
| Financial info → **Other financial info**: the companies' balances, sales and spending | Yes | No | App functionality | Required |

- Data is **encrypted in transit** (HTTPS only; the app refuses clear text).
- Users can **request deletion** (in the app and at https://getnightshift.tech/delete-account).
- Google Firebase Cloud Messaging and Reown (WalletConnect) process data as service providers, so it is not "shared" in Play's terms.
- No location, contacts, photos, camera, microphone, health or advertising ID.

## 8. Permissions the app asks for

`INTERNET`, `POST_NOTIFICATIONS` (asked right after sign-in), `USE_BIOMETRIC` (approvals), `VIBRATE`, `RECEIVE_BOOT_COMPLETED` and `WAKE_LOCK` (scheduled notifications from the notification library). Nothing else; storage, camera, microphone and location are blocked in `app.config.ts`.

## 9. Every release

1. Raise `version` in `app.config.ts` (the build number goes up by itself in `build-release.sh`).
2. `scripts/build-release.sh` → the AAB.
3. Play Console → the track → **Create new release** → upload → release notes (what changed, in plain words) → **Review release** → **Start rollout**.
