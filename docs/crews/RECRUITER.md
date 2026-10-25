# The recruiter

NIGHTSHIFT's recruitment operator. It runs inside the engine process (`apps/engine/src/recruiter/`)
and keeps working after any terminal session ends. It finds builders and agent operators who fit a
crew (Watchtower, Research Desk, Build & Check, or "run your agent as a crew"), prepares
invitations, posts real highlights on our own channels, and reports to the owner.

It has no shell, no treasury, no wallet and no way to pay. It reads two public hosts
(`api.github.com`, `api.imd.fun`), links only to getnightshift.tech pages on a fixed allowlist, and
talks only through the channel adapters the engine gives it. It makes no model calls
(`modelBudgetUsd` is 0 and nothing spends without it).

## What it does

| Step | When | What |
|---|---|---|
| Discover | every 6 h (kept across restarts) | GitHub repository search (pushed in the last 30 days: v4 hooks, x402, MCP + on-chain, agent marketplaces, IMD / identity-md) and IMD launches from the last 30 days. Read-only. Backs off on 403/429. |
| Qualify | after each discovery | A score with reasons: service fit, recent activity, evidence of demand, a permitted channel. Stars are shown, never scored. Text written to steer an AI is rejected. |
| Prepare | each cycle | Fixed templates. An invitation names the problem, links one real example with `?ref=rc-<id>`, states the benefit and says it is "NIGHTSHIFT's automated assistant". Posts come only from real highlights; none means no post. |
| Distribute | each minute when something is due | Through the adapters, inside the caps below. |
| Learn | hourly | Funnel per ref tag (visits, free results, first paid, repeat) from the site's records. Never changes prices, tokenomics or limits. |
| Digest | 09:00 Europe/Bucharest | One plain message to the owner alert chat. |

Outside text (repo descriptions, launch data) is cleaned (no HTML, links, control characters; at
most 280 characters) and never goes into a message. It cannot choose a link, a channel or a recipient.

## Caps

- 2 original posts per owned platform per day (UTC), at least 60 minutes apart.
- 3 first-contact invitations per day in total.
- 1 first contact per organization per 30 days.
- No follow-up after silence. At most one follow-up, only after the owner marks the prospect responded, and only after approval.
- Every first contact and follow-up needs the owner's approval **and** a channel that welcomes suggestions. None exists by default, so invitations wait.
- GitHub is read-only: no issues, PRs, comments or discussions, ever.

Hard ceilings in code: posts 4/day, invitations 5/day, cooldown at least 30 days.

## Channels

| Channel | Needs | Used for |
|---|---|---|
| `telegram` | the bot token and one fixed chat id (`telegramChannel(token, chat)` in `adapters.ts`) | posts; invitations only if created with `welcomesSuggestions: true` |
| `bluesky` | `BLUESKY_HANDLE` and `BLUESKY_APP_PASSWORD` (`blueskyChannel(handle, password)`) | posts (300 characters) |

A missing adapter shows "blocked: no credentials" and its drafts are kept (posts expire after 24 h).
`welcomesSuggestions` is only for a published collaboration channel or a public discussion that
explicitly welcomes suggestions, never for our own community chat.

## Sending safely

Each outbox item has an idempotency key (channel, kind, subject, day) and is saved as `sending`
before it goes out. After a crash it shows as `unknown` and is never resent: check the channel,
then skip it. Failures retry after 2 and 4 minutes (3 attempts at most). After 3 failures in a row a
channel rests for 6 hours and the owner is told.

## Pause, stop, inspect

All admin only (`x-admin-token`):

- `GET /api/admin/recruiter`: settings, channels and why they are blocked, the queue, sends to reconcile, prospects with reasons, sent items, failures, funnel, model spend, next runs (UTC and Bucharest), recent runs.
- `POST /api/admin/recruiter/pause {paused}`: pause or resume. Resuming also clears a stop.
- `POST /api/admin/recruiter/stop`: emergency stop. Cancels every waiting or queued send.
- `POST /api/admin/recruiter/channel {channel, enabled}`
- `POST /api/admin/recruiter/run {dryRun}`: one cycle now. A dry run unless `dryRun` is `false`; a dry run reads and scores but drafts and sends nothing.
- `POST /api/admin/recruiter/outbox/<id>/approve` or `/skip`
- `POST /api/admin/recruiter/responded {opportunityId}` and `/optout {org}`

The digest arrives at 09:00 Bucharest (or until noon after a late start), once a day.

## State

One JSON file, `DATA_DIR/recruiter.json` (written atomically, previous version in `.bak`): settings
snapshot, schedule, opportunities (500 max), outbox, runs (200), daily counters (40 days), funnel,
circuit breakers. Pause, stop and channel switches survive restarts; limits come from code and
the engine's settings. The GitHub token is never saved or shown. An unreadable file means the
recruiter starts paused.

## Wiring (engine)

```ts
const recruiter = new Recruiter({
  file: join(config.dataDir, "recruiter.json"),
  channels: {
    ...(config.telegramToken ? { telegram: telegramChannel(config.telegramToken, "<chat id>") } : {}),
    ...(config.blueskyAppPassword ? { bluesky: blueskyChannel(config.blueskyHandle, config.blueskyAppPassword) } : {}),
  },
  notifyOwner: (text) => this.alert(text, `recruiter-${text.split("\n")[0]}`),
  highlights: () => /* real highlights from the crews job ledger */ [],
  attribution: (refs) => /* ref → { visits, freeResults, firstPaid, repeat } */ ({}),
  settings: { githubToken: process.env.RECRUITER_GITHUB_TOKEN ?? "" },
});
setInterval(() => void recruiter.tick(), 60_000);
```
