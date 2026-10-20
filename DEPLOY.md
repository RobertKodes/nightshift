# Launching NIGHTSHIFT

## 1. Run the demo publicly (no money moves)

```bash
cp .env.example .env            # keep NIGHTSHIFT_MODE=sim, set PUBLIC_URL
docker compose up -d --build
```

Put it behind HTTPS (Caddy, Cloudflare Tunnel, or your host's proxy) at `PUBLIC_URL`. The demo is open: no sign-in, simulated swarm, simulated buyers, every sim sale labelled.

## 2. Go live

1. Set `NIGHTSHIFT_MODE=live` and a long random `NIGHTSHIFT_SECRET`. **Back it up**: it encrypts every company wallet, and losing it means losing those wallets.
2. Set `OPENROUTER_API_KEY` so the CEO is a model, not the playbook.
3. Set `SALES_CHAIN_ID=8453` for Base mainnet sales (or `84532` for a Base Sepolia rehearsal).
4. Optional: `PLATFORM_FEE_BPS` and `PLATFORM_TREASURY` for a fee on withdrawals.
5. Restart: `docker compose up -d`.

Sign-in with a wallet is on automatically in live mode. Each owner sees and controls only their companies, and MCP keys are per owner.

## 3. First live company (do this before announcing)

1. Sign in, start a company with a **$5 daily budget** and **ask-over $0** (every purchase waits for you).
2. Send the company wallet ~2 IMD and ~0.003 ETH on Ethereum (Permit2 approval) and ~0.0005 ETH on Base (sale settlement gas).
3. Approve the first purchase; watch it go through check → quote → payment → admission → job steps on the dashboard and on explorer.imd.fun.
4. Buy its product yourself with a second wallet holding a little USDC on Base, from the public page.
5. Withdraw the revenue.

If any step fails, the dashboard log and `docker compose logs` say where. IMD error codes are explained in plain words.

## On a server that already runs Caddy (shared host)

The image is built by GitHub Actions (`.github/workflows/image.yml`) and published as
`ghcr.io/robertkodes/nightshift:latest`, so the server only pulls it.

1. DNS: an `A` record `nightshift.<domain>` pointing at the server.
2. Copy `deploy/compose.shared-host.yml` and a filled `.env` to the server. Set `EDGE_NETWORK` to
   the Docker network Caddy is on (`docker network ls`).
3. `docker compose -f compose.shared-host.yml --env-file .env up -d`
4. Add `deploy/Caddyfile.snippet` to the Caddyfile and reload Caddy.

The service is capped at 384 MB and half a CPU so it cannot starve the other apps on the box.

**Telegram Mini App (`/tg`)**: if Caddy sets the site's security headers itself, `/tg` needs its own
`frame-ancestors` (Telegram Web shows Mini Apps in an iframe) and no `X-Frame-Options`; every other
path keeps `frame-ancestors 'none'`. The exact Caddy block, the BotFather steps and why are in
[docs/telegram/RESEARCH.md](docs/telegram/RESEARCH.md#the-caddy-change-needed-not-applied-the-server-is-not-edited-from-here).

## Operations

- **Data**: `/data` (volume `nightshift-data`): `state.json` (companies, ledger), `vault.json` (encrypted keys), `settings.json` (API keys in plain text), `admin-token`, `sessions.json`, `telegram.json` (Telegram players: it maps Telegram ids to profiles, keep it private), `sim-files/`. Back it up daily, encrypted (`BACKUP_AGE_RECIPIENT`), and keep `NIGHTSHIFT_SECRET` somewhere else: the backup and the secret together open every wallet.
- **Health**: `GET /api/health`.
- **Stop a company**: the owner presses Pause (or `nightshift_pause` over MCP). Paused companies spend nothing.
- **Scale**: one engine per data folder. The JSON store is fine for hundreds of companies; move to Postgres before thousands.

## Security settings

| Variable | What it does |
|---|---|
| `TRUSTED_PROXIES` | IPs, CIDRs or container names whose `X-Forwarded-For` is believed (default `127.0.0.0/8,::1,caddy`: loopback and the `caddy` container, looked up every minute). The client's IP is the rightmost hop that is not a trusted proxy. Behind another proxy, list it here, or every visitor shares one rate limit. |
| `SESSION_SECRET` | Signs sign-in sessions. Unset, it is derived from `NIGHTSHIFT_SECRET` as before. Setting or changing it signs everyone out once, without touching the wallets. |
| `ADMIN_TOKEN` | At least 24 characters, or the engine refuses to start. Unset, a random one is written to `/data/admin-token`. |
| `BACKUP_AGE_RECIPIENT` | An `age` public key: `deploy/vps-takeover.sh` encrypts the daily backups to it (mode 600, folder 700). Keep the private key off the server. |
| `IMAGE_TAG` | The image tag the compose files pull (default `latest`). Deploy a commit's full git sha (CI pushes `:latest` and `:<sha>`) to know exactly what runs. |
| `CONFIRM_TAKEOVER=yes` | Required by `deploy/vps-takeover.sh`, which stops every other project on the box. |

- Sign out everywhere: `POST /api/auth/logout-all` (also on the MCP page and in the phone menu).
- API keys (`nsk_`) reach `/mcp` and a few read-only routes; anything that changes money or settings needs a wallet session.
- Report a vulnerability through GitHub private reporting (see `SECURITY.md`).
