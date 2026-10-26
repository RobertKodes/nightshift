# Virtuals ACP Swarm Desk

Run these commands **on the server, inside the engine container, as the engine user**. Nothing in this guide has been run against Virtuals during development. Keep the nine offerings hidden until a test job has completed successfully.

The bridge is off unless `ACP_BRIDGE=1` (or `/acp on` is saved). It also requires live mode and the existing Swarm Desk enabled on Base. `/acp off` stops the listener and ACP actions; `/acp on` resumes the saved phases. Already paid IMD work remains with the desk's follower. Switch off before maintenance, then resume promptly so funded jobs do not miss their SLA.

## Install and persistent storage

Use Node 24 and the container's mounted `/data`. These defaults match the bridge's child process environment; set any overrides in the engine's environment too. Do not change `HOME`, move signer files to another machine, or copy credentials out of this server. The CLI uses its headless file fallback when an OS keychain is unavailable. Both its token store and the native signer's XDG config must survive container replacement.

```sh
cd /app/apps/engine
export DATA_DIR="${DATA_DIR:-/data}"
umask 077
export ACP_CONFIG_DIR="$DATA_DIR/acp"
export XDG_CONFIG_HOME="$DATA_DIR/acp-xdg"
export KEYRING_PROPERTY_FILE_PATH="$ACP_CONFIG_DIR/keyring.json"
mkdir -p "$ACP_CONFIG_DIR" "$XDG_CONFIG_HOME" "$DATA_DIR/acp-cli"
npm install --prefix "$DATA_DIR/acp-cli" --cache "$DATA_DIR/acp-npm-cache" \
  --omit=dev --no-audit --no-fund @virtuals-protocol/acp-cli@1.0.40
acp() { node "$DATA_DIR/acp-cli/node_modules/@virtuals-protocol/acp-cli/dist/bin/acp.js" "$@"; }
acp --version
acp skill print --json
acp provider set-budget --help
acp provider submit --help
acp events listen --help
acp events drain --help
```

The bridge checks for exactly CLI `1.0.40`. It invokes Node directly with argument arrays; no shell, `npx` download or signer-key export occurs during job processing. This is an external official CLI installation in the data volume; the monorepo dependency files are unchanged.

## Authenticate and select the existing agent

```sh
acp configure start --json
```

Open the returned `url` on the owner's phone and approve it. Keep the returned `requestId`. Then run, substituting that ID:

```sh
acp configure complete --request-id '<AUTH_REQUEST_ID>' --json
```

If the response is `pending`, repeat the same complete command after phone approval. Wait for `status: authenticated`.

Alternatively, when `ACP_ACCESS_TOKEN`, `ACP_REFRESH_TOKEN` and `ACP_OWNER_WALLET` were securely injected **on this server**, `acp configure --json` consumes those environment variables and persists the session. Do not paste tokens into bot messages or commit them.

```sh
acp agent use --agent-id 01a17749-ac75-7e8f-962f-2b33d027fb2e --json
acp agent whoami --json
```

Confirm ID `01a17749-ac75-7e8f-962f-2b33d027fb2e`, name `NIGHTSHIFT Swarm Desk`, and wallet `0xaddf82c34e2c425bb91bb07a71edab8510ec08c5`. The bridge refuses another active identity.

## Generate the restricted signer here

```sh
acp agent add-signer --agent-id 01a17749-ac75-7e8f-962f-2b33d027fb2e \
  --policy restricted --no-wait --json
```

This generates the signing key **inside this server container**. Only the public key is printed. Open the returned `signerUrl` on the owner's phone and approve it. Complete the split flow with the returned `requestId` and `publicKey`:

```sh
acp agent signer-status --agent-id 01a17749-ac75-7e8f-962f-2b33d027fb2e \
  --request-id '<SIGNER_REQUEST_ID>' --public-key '<PUBLIC_KEY>' --json
acp agent signer-policy --agent-id 01a17749-ac75-7e8f-962f-2b33d027fb2e --json
acp agent whoami --json
acp job list --json
acp offering list --json
```

Repeat `signer-status` while pending; wait for `completed`. Confirm the restricted ACP policy. `job list` authenticates through the local signer; `whoami` alone only proves owner authentication. Never export the private key or generate it on a laptop for later transfer. Keep the CLI config, keyring and native signer store on the mounted server volume, private to the engine user. After any container replacement, repeat `whoami` and `job list` before making new sales.

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

Enable live mode and `SWARM_DESK=1`, provision the house's IMD and Ethereum gas, and use the owner's private bot commands `/swarm` and `/acp on`. `/acp` shows auth, local signer, hidden/visible counts, jobs today, running, delivered and rejected. The engine owns the listener; do not start another listener or drain the same event file yourself. Run one engine replica per data volume.

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

Read each exact ID from `offering list`, then run this for each of the nine intended offerings:

```sh
acp offering list --json
acp offering update --offering-id '<OFFERING_ID>' --no-hidden --json
acp offering list --json
```

Visibility is an explicit owner step; the bridge never changes offerings. `--no-hidden` and `--offering-id` are the CLI 1.0.40 flags.

## Recovery and protocol limits

`data/acp-bridge.json` stores seen jobs, phases, the desk/IMD IDs and delivery text with `writeAtomic` and a backup. `swarm-desk.json` independently saves checked bodies and reservations before any budget or IMD purchase. Keep both files. Missing state with a backup, or unreadable state, fails closed; restore it instead of deleting it. An ambiguous IMD open without a saved IMD ID becomes a failure, never a second purchase.

The loop uses `events listen --output … --json`, `events drain --file … --json`, `job list --json` and per-job `job history --job-id … --chain-id … --json`. History reconciles missed events and lost budget/submission answers. The active-job listing supplies the offering description and client/evaluator addresses; missing context is refused after two minutes. Requirements come from the first client message with `contentType: requirement`, never from `job.created`.

CLI 1.0.40 has **no provider reject/cancel command**. Before funding, refusal sends `message send` with a reason, sets no budget and lets the unpaid job expire. After funding, an IMD failure/block submits an explicit failure notice asking the client to reject for escrow return and alerts the owner. The provider cannot unilaterally force that rejection through this CLI. Track the job until the client rejects; do not report escrow returned before its outcome event.

Real server authentication, signer approval, a paid test job, actual escrow return and offering visibility remain server-side verification steps. No live services are exercised by the unit tests.
