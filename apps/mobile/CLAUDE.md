# NIGHTSHIFT mobile (apps/mobile)

The Android owner app for NIGHTSHIFT AI companies: found, set limits, steer, watch shifts live, approve spends from a push.
Focus: company control. Games, frogs and $SHIFT are a read-only tab at most (More → The night).

## Stack
- Expo SDK 58 (React Native 0.88, TypeScript, expo-router), outside the pnpm workspace (`!apps/mobile`), own npm lockfile.
- Views come from the engine's owner routes; their shapes are in `src/api/types.ts` (the web's `apps/web/src/api.ts` reads the same). No engine code in the app.
- Wallet: Reown AppKit React Native (`src/lib/wallet.tsx`). projectId from GET /api/wallet-config, falling back to `.env`.
- Auth: SIWE with the phone key's fingerprint in the message (GET /api/auth/nonce?device=) → personal_sign → POST /api/auth/verify with the public key. The engine returns an app session (`a.` token) and registers the phone. Kept in SecureStore.
- Realtime: SSE GET /api/events?company=<id> with Bearer, foreground only, `since=` replay (`src/api/live.ts`).
- Push: FCM data messages from the engine (apps/engine/src/push-fcm.ts) in the shape expo-notifications presents itself (title, message, body, channelId, categoryId).
- Approvals: `modules/device-key` (Kotlin): Keystore P-256 key + BiometricPrompt signs `nightshift-approve|company|task|cost|ts`.
- Demo: "Look around first" serves example data from `src/api/demo.ts`; every write answers that it is the demo.

## Ground rules
- Never invent an endpoint. The engine router is apps/engine/src/server.ts. If a screen needs one that is missing, add it there with a vitest test.
- Every money action needs biometric. Raising a limit, deleting a company, adding a phone and deleting the account also need a fresh wallet signature (step-up: POST /api/auth/step, then X-Step-Up). The engine enforces it for app sessions (428).
- Withdrawing and stopping stay on the website in the Play build; `EXPO_PUBLIC_MONEY_OUT=app` turns them on in the app (see PLAY.md §6 first).
- No crypto purchase, top-up, swap, stake, bet or link to one in the app (Play payments policy).
- Never queue money actions offline. Show cached data with an offline banner (`src/api/useData.ts`).
- Show the engine's own error text; do not rewrite it.
- Target SDK 36. Ask POST_NOTIFICATIONS right after sign-in.

## Commands
- `npm install`, `npx tsc --noEmit`, `npx expo-doctor`
- Engine in sim mode with sign-in on: `NIGHTSHIFT_MODE=sim REQUIRE_AUTH=1 PORT=8899 DATA_DIR=<scratch> npx tsx src/main.ts` (from apps/engine)
- Metro against it: `EXPO_PUBLIC_API_URL=http://10.0.2.2:8899 npx expo start`
- Native builds run from a short path (Windows' 260-character limit): `bash scripts/sync-build-dir.sh`, then from `C:\m` (release builds need a root this short): `bash scripts/build-debug.sh [--clean]` or `bash scripts/build-release.sh`.

## Done means
Typecheck passes, the change works on the emulator (NightshiftPixel, PIN 1111, `adb emu finger touch 1`), and it is one small commit named v0.NNN.
