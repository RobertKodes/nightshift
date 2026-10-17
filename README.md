# NIGHTSHIFT

An AI company that runs itself. You give it an idea, a daily budget and a limit above which it must ask you. It then works in shifts:

1. **Decide.** The CEO agent reads revenue, visits and what is still building, then picks one move: research, a new product, the website, a site change, a post, or a price change.
2. **Check for free.** Every paid move goes through IMD's free `/requests/check` first. If IMD would refuse the body, nothing is spent.
3. **Respect the owner.** A purchase over your per-action limit waits for your approval. Nothing ever breaks the daily budget.
4. **Build with the swarm.** Products and the site are bought from the [IMD](https://imd.fun) swarm (0.5 IMD per order, x402 + Permit2 + quote approval), then followed through payment, admission and every job step.
5. **Sell to people and agents.** Every product is an x402 link (`/buy/<company>/<product>`). Humans pay from a wallet; AI agents pay automatically. USDC goes straight to the company's own wallet (EIP-3009, settled by the company itself, no facilitator).

Everything is visible live: the CEO's log, the current job's steps, the P&L, and every order and sale.

**Also included:**
- **Wallet sign-in:** each owner sees and controls only their own companies.
- **Withdrawals:** revenue goes to the owner's wallet, with an optional platform fee.
- **The saver from [imd-mcp](https://github.com/RobertKodes/imd-mcp):**
  - published research is reused instead of paid for;
  - the same body is never bought twice.
- **A NIGHTSHIFT MCP endpoint** (`/mcp`), so you can run your companies from Claude or Cursor:
  - list companies and found new ones;
  - run a shift;
  - approve or decline spending;
  - change limits, pause;
  - withdraw.

The site's MCP page offers both servers: the NIGHTSHIFT connector, with per-owner API keys, and imd-mcp for hiring the swarm directly.

## Run it

```bash
pnpm install
pnpm --filter @nightshift/web build
cd apps/engine && pnpm start        # http://localhost:8787
```

By default it runs in **simulation**. The swarm, the buyers and a 20 IMD starting balance are simulated, and nothing leaves the machine. Every simulated sale is labelled as one.

| Variable | Default | |
|---|---|---|
| `NIGHTSHIFT_MODE` | `sim` | `live` sends real IMD orders and settles real USDC sales |
| `OPENROUTER_API_KEY` | — | Lets a model act as CEO and write the deliverables. Without it, a fixed playbook decides |
| `NIGHTSHIFT_MODEL` | `anthropic/claude-sonnet-5.5` | The CEO model on OpenRouter |
| `NIGHTSHIFT_SECRET` | generated | Encrypts every company's wallet key (AES-256-GCM). **Set it before holding real funds** |
| `PUBLIC_URL` | `http://localhost:8787` | Used in buy links and site links |
| `SALES_CHAIN_ID` | `84532` | `8453` for Base mainnet, `84532` for Base Sepolia |
| `IMD_USD` | `6.87` | IMD price used for budgets |
| `SIM_SHIFT_MINUTES` / `SIM_JOB_SECONDS` | `2` / `40` | Demo pacing |

In live mode, each company wallet needs IMD and a little ETH on Ethereum (for the one-time Permit2 approval). To settle sales it also needs a little gas on the sales chain.

## Launch

See [DEPLOY.md](DEPLOY.md):
- `docker compose up -d --build` runs the public demo (simulation);
- the live checklist covers the secret, the CEO model, Base mainnet and fees;
- a first-company rehearsal comes with a $5 budget.

## Layout

| Path | What |
|---|---|
| `packages/imd` | IMD client: capabilities, free check, quote → x402/Permit2 payment → quote approval → submit, order/job/result. Also a simulator with the same shapes |
| `packages/x402` | x402 "exact" seller over EIP-3009: challenge, signature verification, self-settlement |
| `packages/core` | The company: types, spending policy, CEO planner (model or playbook), IMD order catalog, and the shift state machine |
| `packages/ledger`, `trace`, `llm` | Double-entry ledger, tracing, and the OpenRouter client |
| `apps/engine` | HTTP API, live events (SSE), wallet vault, scheduler, buy endpoint, simulated market |
| `apps/web` | Dashboard: found a company, watch the shift, approve spending, and a public page per company |

Tests: `pnpm -r test` (28 tests) covers:
- canonical payment hashing and the simulated plane;
- x402 verification;
- end-to-end shifts, including the approval and budget gates and the saver;
- wallet sign-in and API keys.

`node apps/engine/scripts/e2e.mjs` runs the real engine and checks:
- sign-in, and that ownership isolates companies;
- the public pages;
- MCP over HTTP with an owner key.

## Status

- **Built and tested in simulation:** the shift loop, the spending gates, the IMD and x402 code paths.
- **Not yet run against mainnet:**
  - the live IMD payment, which uses `@x402/core` / `@x402/evm` 2.28.0 as the IMD docs pin;
  - real USDC settlement.

  Do a first live run with a small budget and a fresh wallet.
- **Posting to X and email are drafts only** for now.

Built by [@probert_mihai](https://x.com/probert_mihai). Site: [getnightshift.tech](https://getnightshift.tech) · [X](https://x.com/nightshiftimd) · [Telegram](https://t.me/getnightshift) · [Bluesky](https://bsky.app/profile/nightshifttech.bsky.social)

MIT licensed. `@x402/*` are Apache-2.0 dependencies.
