# Virtuals ACP Swarm Desk

The owner sets up this bridge entirely in the bot's **private Telegram chat**, using the configured `TELEGRAM_ADMIN_IDS` owner ID. The engine runs every CLI command; the owner only sends bot commands and opens approval links on his phone. No server shell is needed. Nothing in this guide has been run against Virtuals during development.

The bridge is off unless `ACP_BRIDGE=1` (or `/acp on` is saved). It also requires live mode and the existing Swarm Desk enabled on Base. `/acp off` stops the listener and ACP actions; `/acp on` resumes the saved phases. Already paid IMD work remains with the desk's follower. Switch off before maintenance, then resume promptly so funded jobs do not miss their SLA.

## Image and persistent storage

The root `Dockerfile` installs official `@virtuals-protocol/acp-cli@1.0.40` in a separate `/opt/acp-cli` prefix. This npm install never changes the pnpm workspace or its frozen lockfile. The bridge resolves `/opt/acp-cli/node_modules/@virtuals-protocol/acp-cli/dist/bin/acp.js` first, then the existing `$DATA_DIR/acp-cli/node_modules/@virtuals-protocol/acp-cli/dist/bin/acp.js` fallback. It checks the installed package version is exactly `1.0.40` and invokes Node with argument arrays, without a shell or runtime downloads.

The image keeps `DATA_DIR=/data`. The bridge preserves these existing child-process defaults (environment overrides still apply):

| Variable | Default |
| --- | --- |
| `ACP_CONFIG_DIR` | `/data/acp` |
| `XDG_CONFIG_HOME` | `/data/acp-xdg` |
| `KEYRING_PROPERTY_FILE_PATH` | `/data/acp/keyring.json` |

Mount `/data` persistently and keep it private to the engine user. Both the CLI token store and native signer store must survive container replacement. Do not change `HOME`, copy credentials to another machine, or export signer keys. The CLI uses its headless file fallback when an OS keychain is unavailable.

## Owner sequence in Telegram

Send these commands to the bot in the owner's own private chat. Group chats, channels, other users and callbacks outside that private chat cannot operate ACP or receive approval links.

1. `/acp off` — keep the bridge paused during setup.
2. `/acp setup` — the engine runs `acp configure start --json`, saves its `requestId` in `/data/acp-setup.json`, and replies with the sign-in URL. Open this on your phone and sign in.
3. `/acp setup done` — the engine runs `acp configure complete --request-id <saved> --json`. If pending, finish on the phone and repeat this bot command. Wait for **ACP authenticated**. Tokens are stored only by the CLI, never returned to Telegram.
4. `/acp agent` — selects agent `01a17749-ac75-7e8f-962f-2b33d027fb2e` and checks `agent whoami`. Confirm **NIGHTSHIFT Swarm Desk**, wallet `0xaddf82c34e2c425bb91bb07a71edab8510ec08c5`.
5. `/acp signer` — runs `agent add-signer --agent-id <fixed agent> --policy restricted --no-wait --json`. The signing key is generated on the server. Open the approval URL on your phone; **it expires in 5 minutes**.
6. `/acp signer done` — checks the saved request with `agent signer-status --agent-id <fixed agent> --request-id <saved> --public-key <saved> --json`, which is required to persist the approved signer in CLI 1.0.40. If pending, approve and repeat. It then checks `agent whoami --json` and `job list --json`: whoami confirms the selected identity; job list proves a local signer exists. Wait for **Server signer present**.
7. `/acp status` (or `/acp`) — shows CLI found/version, authentication, selected agent, local signer, the nine offerings' hidden/visible counts, bridge on/off and job counts. Status works while the bridge is off and does not start the listener or process jobs.
8. `/acp hide` — hides the nine exact IMD Swarm offerings for the test below. `/swarm` shows the existing desk settings and funding status.
9. `/acp on` — starts or resumes the bridge once live mode, Swarm Desk and funding are ready. Complete a hidden test job before opening sales.
10. `/acp visible` — lists the active agent's offerings and sets only the nine exact names below visible, using `offering update --offering-id <id> --no-hidden --json`. It verifies the final visibility. `/acp hide` reverses this with `--hidden`; unrelated offerings are left alone.
11. `/acp status` — confirm signer present, **0 hidden, 9 visible**, bridge on and expected jobs.

Auth and signer request IDs survive restarts in `/data/acp-setup.json`, written atomically with mode `0600`. The saved signer public key is needed by `signer-status`; private keys stay in the CLI's server store. Completed requests are removed. Expired sign-in or signer approvals can be restarted with `/acp setup` or `/acp signer`. Replies allow only needed public fields and redact credential values; raw CLI errors and output are never logged or forwarded.

## Test while hidden

Confirm all nine offerings have `priceType: fixed`, `priceValue: 4`, `requiredFunds: false`, and `isHidden: true`. Names must match exactly:

| Offering | Desk kind | Requirements | SLA minutes |
| --- | --- | --- | --- |
| IMD Swarm: Research report | research | brief | 60 |
| IMD Swarm: Website | website | brief | 120 |
| IMD Swarm: Solidity audit | audit | brief, repo | 240 |
| IMD Swarm: Contract with tests | contract | brief | 240 |
| IMD Swarm: Foundry tests | tests | brief, repo, commit | 180 |
| IMD Swarm: Adversarial code review | review | brief, repo | 180 |
| IMD Swarm: Frontend for a contract | frontend | brief, chain, address | 180 |
| IMD Swarm: Image | image | brief | 60 |
| IMD Swarm: Token logo | logo | name, style | 60 |

The normal Swarm Desk validation applies: brief 20–1500 characters, public GitHub repo, full 40-character commit for tests, verified Ethereum/Base contract for frontends, and bounded name/style for logos. Unknown fields and non-string values are refused. Subscription jobs are refused because the CLI can add their package price to the budget.

Enable live mode and `SWARM_DESK=1`, provision the house's IMD and Ethereum gas, and use the owner's private bot commands `/swarm` and `/acp on`. `/acp` shows CLI/version, auth, selected agent, local signer, hidden/visible counts, jobs today, running, delivered and rejected. The engine owns the listener; do not start another listener or drain the same event file yourself. Run one engine replica per data volume.

A separate authenticated ACP **client** can create a hidden offering job by its exact provider/name. On that client's machine, use the client's own nonzero EVM wallet as evaluator:

```sh
acp client create-job --provider 0xaddf82c34e2c425bb91bb07a71edab8510ec08c5 \
  --offering-name 'IMD Swarm: Research report' \
  --requirements '{"brief":"Research the IMD ecosystem with sources and concrete examples."}' \
  --evaluator '<CLIENT_WALLET>' --chain-id 8453 --json
```

Watch the client's event stream. After the bridge proposes exactly `$4.00`, the client funds that job:

```sh
acp client fund --job-id '<JOB_ID>' --amount 4.00 --chain-id 8453 --json
acp job history --job-id '<JOB_ID>' --chain-id 8453 --json
```

Once submitted, inspect the links and receipt, then complete a successful delivery or reject a failed delivery from the client:

```sh
acp client complete --job-id '<JOB_ID>' --chain-id 8453 --reason 'Test delivery verified' --json
# For a failed delivery, use this instead:
acp client reject --job-id '<JOB_ID>' --chain-id 8453 --reason 'Work was not delivered' --json
```

Do not use a zero evaluator: ACP can auto-complete those submissions and release escrow immediately. The bridge accepts only jobs with the client as evaluator, preserving the client's explicit accept/reject step.

Confirm the owner received accepted/delivered/outcome DMs and `/proof` has one crew `swarm`, kind `swarm.research`, `$4.00`, network `virtuals-acp` record. A successful IMD delivery stays pending in the ledger until ACP completes. Rejection/failure contributes no earned revenue. Restarting the engine must follow the same IMD order, not open another.

## Make offerings visible only after the test succeeds

Send `/acp visible` in the owner's private Telegram chat. It lists the offerings, requires exactly one of each intended name with distinct IDs, updates each with CLI 1.0.40's `--offering-id` and `--no-hidden` flags, then lists again to confirm. If an update fails partway, `/acp status` reports the current counts; retry `/acp visible` to finish, or use `/acp hide` to hide them all with `--hidden`.

Visibility changes only through these explicit owner commands. The bridge's background job loop never changes offerings.

## Recovery and protocol limits

`data/acp-bridge.json` stores seen jobs, phases, the desk/IMD IDs and delivery text with `writeAtomic` and a backup. `swarm-desk.json` independently saves checked bodies and reservations before any budget or IMD purchase. Keep both files. Missing state with a backup, or unreadable state, fails closed; restore it instead of deleting it. An ambiguous IMD open without a saved IMD ID becomes a failure, never a second purchase.

The loop uses `events listen --output … --json`, `events drain --file … --json`, `job list --json` and per-job `job history --job-id … --chain-id … --json`. History reconciles missed events and lost budget/submission answers. The active-job listing supplies the offering description and client/evaluator addresses; missing context is refused after two minutes. Requirements come from the first client message with `contentType: requirement`, never from `job.created`.

CLI 1.0.40 has **no provider reject/cancel command**. Before funding, refusal sends `message send` with a reason, sets no budget and lets the unpaid job expire. After funding, an IMD failure/block submits an explicit failure notice asking the client to reject for escrow return and alerts the owner. The provider cannot unilaterally force that rejection through this CLI. Track the job until the client rejects; do not report escrow returned before its outcome event.

Real server authentication, signer approval, a paid test job, actual escrow return and offering visibility remain server-side verification steps. No live services are exercised by the unit tests.
