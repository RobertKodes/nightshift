# Contributing

Thanks for helping build NIGHTSHIFT.

## Setup

```bash
pnpm install
pnpm --filter @nightshift/web build
cd apps/engine && pnpm start   # simulation mode, http://localhost:8787
```

Simulation is the default: nothing is paid, nothing leaves your machine. Never point a development build at live funds.

## Before a pull request

- `pnpm typecheck` and `pnpm test` pass.
- Keep changes small and focused; match the style of the code around them.
- UI changes follow the brand: the tokens in `apps/web/src/landing/landing.css`, Instrument Serif / Inter / JetBrains Mono, the line icons in `apps/web/src/Icon.tsx`, no emoji in the interface. Check desktop and a 390px phone width.
- Anything that touches money (wallets, payments, withdrawals, contract calls) says so in the description and explains how it was tested.
- Never commit secrets, private keys, `.env` files or anything from `data/`.

## Space Pinball

`apps/web/src/pinball/engine.ts` and `apps/engine/src/pinball/engine.ts` must stay byte-identical: the server replays games with the same engine the browser runs. A test enforces it.

## Security issues

Do not open an issue; see [SECURITY.md](SECURITY.md).
