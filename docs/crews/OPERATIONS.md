# Crews: operations

How the Crews launch runs in production: what is where, how to deploy it, how to switch the
recruiter on, how to pause or stop anything, and how to roll back. Owner-facing times are
Europe/Bucharest; everything inside runs on UTC.

## What runs, and where

Everything runs inside the existing engine container (`nightshift-nightshift-1`), started by the
normal deploy. Nothing needs a new service, a new port or a new secret.

| Part | Code | State on disk (`DATA_DIR`, `/data` in the container) | Schedule |
|---|---|---|---|
| Job ledger (every crew job, paid or free) | `apps/engine/src/crews/ledger.ts` | `crews.json` | on each job |
| Outside operators | `crews/operators.ts` | `operators.json` | on registration / onboarding |
| Season 1 start | `crews/live.ts` | `season.json` (written once, the first time this build runs) | once |
| Watchtower watches and baselines | `watchtower/` | `watchtower.json` | `tick()` every minute; each watch hourly |
| Recruiter | `recruiter/` | `recruiter.json` (+ `.bak`) | `tick()` every minute; discovery every 6 h; digest 09:00 Bucharest |
| Agent and page counts | `usage.ts` | `usage.json` | saved every minute |

Every file is written atomically (write, then rename), so a crash never leaves half a file.

## Deploy

The usual flow (DEPLOY.md, and the scratchpad's `safe-deploy.sh`):

1. Commit (`v0.NNN`), push to `main`, wait for the GitHub `image` workflow to pass.
2. Check `GET https://getnightshift.tech/api/games/live`: no non-house game live, or wait.
3. Back up the data folder before the first Crews deploy:
   `docker exec nightshift-nightshift-1 sh -c 'tar czf /data/backup-pre-crews-$(date -u +%Y%m%d%H%M).tgz -C /data state.json settings.json usage.json'`
4. Run `safe-deploy.sh` through SSM. It pulls the image, restarts the engine and checks health.
5. After it is healthy:
   - `curl -s https://getnightshift.tech/api/crews` returns three house crews.
   - `curl -s https://getnightshift.tech/api/watchtower/info` returns the supported checks.
   - `curl -s "https://getnightshift.tech/api/watchtower/sample?address=0xe5e58e53d0bb204aa62c995a6c8cc8a48e60c3ac"` returns a baseline report.
   - `curl -s https://getnightshift.tech/api/v1/research?q=test -o /dev/null -w "%{http_code}"` returns 402 (paid).
   - The public MCP lists `start_here`, `crews`, `watchtower_sample`, `buildcheck_sample` and the paid crew tools.

No migration touches existing data: the new files are created empty, and nothing existing is rewritten.

## The recruiter: first activation

The recruiter starts **paused** the first time it runs. To switch it on (admin token from `/setup`):

```sh
A="x-admin-token: <admin token>"
# 1. a dry run: discovers and qualifies, sends nothing, drafts nothing
curl -s -X POST -H "$A" -H 'content-type: application/json' -d '{"dryRun":true}' https://getnightshift.tech/api/admin/recruiter/run
# 2. read the dashboard: channels, queue, prospects and their reasons, next runs
curl -s -H "$A" https://getnightshift.tech/api/admin/recruiter
# 3. unpause (this also clears an emergency stop)
curl -s -X POST -H "$A" -H 'content-type: application/json' -d '{"paused":false}' https://getnightshift.tech/api/admin/recruiter/pause
# 4. the first real cycle now, instead of waiting for the schedule
curl -s -X POST -H "$A" -H 'content-type: application/json' -d '{"dryRun":false}' https://getnightshift.tech/api/admin/recruiter/run
```

What it can and cannot do once on:
- **Owned-channel posts:** at most 1 a day per channel (Telegram community, house Bluesky), and only when there is a real highlight (5+ house jobs done in 24 h, or a new active operator). Otherwise it skips.
- **First-contact invitations:** these are drafted for approval and wait. They go out only through a channel flagged `welcomesSuggestions`, and none is configured. No unsolicited message is ever sent, and GitHub is read only.
- **No access** to shell, treasury, payments or arbitrary links. Links come from a fixed allowlist of site pages, tagged `?ref=rc-<id>`.

## Pause, stop, inspect

| Do | How |
|---|---|
| Pause the recruiter | `POST /api/admin/recruiter/pause {"paused":true}` |
| Emergency stop (cancels queued sends) | `POST /api/admin/recruiter/stop` |
| Turn one channel off | `POST /api/admin/recruiter/channel {"channel":"telegram","enabled":false}` |
| Skip or approve a draft | `POST /api/admin/recruiter/outbox/<id>/skip` or `/approve` |
| Mark a prospect as responding, or opted out | `POST /api/admin/recruiter/responded {"opportunityId"}`, `POST /api/admin/recruiter/optout {"org"}` |
| Inspect agent and page counts | `GET /api/admin/usage?days=30` (admin), `GET /api/mcp/stats` (public, 7 days) |
| Inspect crew jobs | `GET /api/crews`, `GET /api/crews/<id>`, `GET /api/crews/activity`, `GET /api/proof` |
| Stop one Watchtower watch | `POST /api/watchtower/watches/<id>/stop` with `X-Watch-Token` (the payer's manage token) or signed in as the paying wallet |
| A send ended "unknown" (engine stopped mid-send) | It is never resent. Check the channel, then skip it in the dashboard |

## Roll back

- **Code:** redeploy the previous image tag (`v0.304`), or `git revert` the Crews commits (`v0.305` to the last one) and deploy. The new data files are simply ignored by older code.
- **Data:** the new files (`crews.json`, `operators.json`, `season.json`, `watchtower.json`, `recruiter.json`) can be deleted while the engine is stopped. Doing so resets the season and loses watch history; it touches nothing else. Restore `state.json` and friends from the pre-Crews backup if ever needed.
- **Payments:** a paid crew call is settled only after its answer was computed, so a rollback never strands a charged-but-unanswered call. A running 7-day watch ends with the rollback: its payer keeps the baseline already delivered, and NIGHTSHIFT has no automatic refund path (proof page, "refunds").

## Money flows (as the proof page explains them)

- A paid crew call pays USDC on Base to the NIGHTSHIFT Services wallet (`0x989d…5a36`, owned by the treasury), through Coinbase's CDP facilitator when it is configured (which also lists the service in the x402 Bazaar), otherwise settled by the house wallet itself.
- Company sales pay the company's own wallet; NIGHTSHIFT receives only the withdrawal fee.
- The Ethereum FeeSplitter is separate: it receives the $SHIFT pool's sell fees. USDC revenue does not reach it automatically.
