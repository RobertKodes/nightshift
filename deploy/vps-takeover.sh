#!/bin/bash
# Run NIGHTSHIFT alone on a Docker host behind Caddy (automatic HTTPS), with or without a domain.
# DESTRUCTIVE: stops and removes every other compose project and container on the box (their volumes
# are kept), and disables any caddy/nginx/apache2 service. Only on a server that is NIGHTSHIFT's alone:
#   CONFIRM_TAKEOVER=yes bash vps-takeover.sh       (add HOST=your-domain.com once you have one)
# Optional: IMAGE_TAG=<git sha> deploys that exact build (CI pushes :latest and :<sha>);
# BACKUP_AGE_RECIPIENT=age1… encrypts the daily backups to that public key (keep the private key off this box).
set -euo pipefail
DIR=/opt/nightshift
umask 077

if [ "${CONFIRM_TAKEOVER:-}" != "yes" ]; then
  cat >&2 <<'WARN'
!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!
!! vps-takeover.sh STOPS AND REMOVES EVERY OTHER PROJECT AND CONTAINER ON THIS BOX,  !!
!! and disables caddy, nginx and apache2. Nothing was touched.                       !!
!! If this server is NIGHTSHIFT's alone, run it again with CONFIRM_TAKEOVER=yes.     !!
!! Sharing the box with other apps? Use deploy/compose.shared-host.yml instead.      !!
!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!
WARN
  exit 1
fi

echo "== stopping other stacks"
for p in $(docker compose ls -a --format json | python3 -c 'import json,sys;[print(x["Name"]) for x in json.load(sys.stdin) if x["Name"]!="nightshift"]'); do
  echo "down: $p"; docker compose -p "$p" down --remove-orphans || true
done
for id in $(docker ps -aq); do
  [ "$(docker inspect -f '{{index .Config.Labels "com.docker.compose.project"}}' "$id")" = nightshift ] || docker rm -f "$id"
done
for s in caddy nginx apache2; do systemctl disable --now "$s" 2>/dev/null || true; done

echo "== nightshift"
# HOST: the name Caddy gets a certificate for. Without a domain, <ip-with-dashes>.sslip.io resolves
# to this server for free. Set HOST=your-domain.com later and rerun.
IP=$(curl -s https://checkip.amazonaws.com || hostname -I | cut -d' ' -f1)
HOST=${HOST:-$(echo "$IP" | tr . -).sslip.io}
TAG=${IMAGE_TAG:-latest}
mkdir -p "$DIR" /var/backups/nightshift
chmod 700 /var/backups/nightshift
# secrets (NIGHTSHIFT_SECRET, ADMIN_TOKEN, SESSION_SECRET…) go in $DIR/.env, readable by root only; never in the backups folder
[ -f "$DIR/.env" ] || : > "$DIR/.env"
chmod 600 "$DIR/.env"
cat > "$DIR/Caddyfile" <<CADDY
$HOST {
  encode zstd gzip
  reverse_proxy nightshift:8787 {
    flush_interval -1
  }
}
http://$IP {
  redir https://$HOST{uri} permanent
}
CADDY
# Caddy and the engine share one network with a fixed range: only Caddy's X-Forwarded-For is believed.
cat > "$DIR/compose.yml" <<YML
services:
  nightshift:
    image: ghcr.io/robertkodes/nightshift:$TAG
    restart: unless-stopped
    env_file: .env
    environment:
      PUBLIC_URL: https://$HOST
      NIGHTSHIFT_MODE: \${NIGHTSHIFT_MODE:-sim}
      TRUSTED_PROXIES: 172.31.89.0/24
    volumes: [nightshift-data:/data]
    mem_limit: 1200m
    logging: { driver: json-file, options: { max-size: 10m, max-file: "3" } }
    networks: [edge]
  caddy:
    image: caddy:2.8
    restart: unless-stopped
    ports: ["80:80", "443:443", "443:443/udp"]
    volumes: [./Caddyfile:/etc/caddy/Caddyfile:ro, caddy-data:/data, caddy-config:/config]
    depends_on: [nightshift]
    networks: [edge]
volumes:
  nightshift-data:
  caddy-data:
  caddy-config:
networks:
  edge:
    ipam:
      config:
        - subnet: 172.31.89.0/24
YML
# Daily backup of the data volume (company wallets live here, encrypted by NIGHTSHIFT_SECRET), 14 kept.
# Root-only files in a root-only folder; with BACKUP_AGE_RECIPIENT set, encrypted with age before they touch the disk.
cat > /etc/cron.daily/nightshift-backup <<CRON
#!/bin/sh
set -e
umask 077
RECIPIENT="${BACKUP_AGE_RECIPIENT:-}"
B=/var/backups/nightshift
mkdir -p "\$B" && chmod 700 "\$B"
F="nightshift-\$(date +%F).tgz"
if [ -n "\$RECIPIENT" ]; then
  docker run --rm -e RECIPIENT="\$RECIPIENT" -e F="\$F" -v nightshift_nightshift-data:/d:ro -v "\$B":/b alpine:3.20 \\
    sh -c 'umask 077 && apk add --no-cache -q age && tar czf - -C /d . | age -r "\$RECIPIENT" -o "/b/\$F.age"'
else
  docker run --rm -e F="\$F" -v nightshift_nightshift-data:/d:ro -v "\$B":/b alpine:3.20 sh -c 'umask 077 && tar czf "/b/\$F" -C /d .'
fi
chmod 600 "\$B"/nightshift-* 2>/dev/null || true
ls -1t "\$B"/nightshift-*.tgz* 2>/dev/null | tail -n +15 | xargs -r rm -f
CRON
chmod 700 /etc/cron.daily/nightshift-backup
[ -n "${BACKUP_AGE_RECIPIENT:-}" ] || echo "!! backups are NOT encrypted: set BACKUP_AGE_RECIPIENT=age1… and rerun to encrypt them" >&2
cd "$DIR"
docker compose -p nightshift pull
docker compose -p nightshift up -d --remove-orphans
for i in $(seq 1 60); do curl -sf -o /dev/null http://localhost:80 -H "Host: $IP" && break; sleep 2; done
/etc/cron.daily/nightshift-backup && ls -la /var/backups/nightshift | tail -2
for i in $(seq 1 30); do curl -sf -o /dev/null "https://$HOST/api/health" && break; sleep 3; done
echo "HTTPS: $(curl -s -o /dev/null -w '%{http_code}' https://$HOST/api/health) https://$HOST"
docker image prune -af >/dev/null || true
free -m | head -2
