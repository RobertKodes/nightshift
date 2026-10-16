#!/bin/bash
# Run NIGHTSHIFT alone on a Docker host behind Caddy (automatic HTTPS), with or without a domain.
# Stops every other compose project and container on the box (their volumes are kept).
#   bash vps-takeover.sh            (HOST=your-domain.com bash vps-takeover.sh once you have one)
set -euo pipefail
DIR=/opt/nightshift

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
mkdir -p "$DIR" /var/backups/nightshift
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
cat > "$DIR/compose.yml" <<YML
services:
  nightshift:
    image: ghcr.io/robertkodes/nightshift:latest
    restart: unless-stopped
    environment:
      PUBLIC_URL: https://$HOST
      NIGHTSHIFT_MODE: sim
    volumes: [nightshift-data:/data]
    mem_limit: 1200m
    logging: { driver: json-file, options: { max-size: 10m, max-file: "3" } }
  caddy:
    image: caddy:2
    restart: unless-stopped
    ports: ["80:80", "443:443", "443:443/udp"]
    volumes: [./Caddyfile:/etc/caddy/Caddyfile:ro, caddy-data:/data, caddy-config:/config]
    depends_on: [nightshift]
volumes:
  nightshift-data:
  caddy-data:
  caddy-config:
YML
# Daily backup of the data volume (company wallets live here), 14 kept.
cat > /etc/cron.daily/nightshift-backup <<'CRON'
#!/bin/sh
docker run --rm -v nightshift_nightshift-data:/d:ro -v /var/backups/nightshift:/b alpine tar czf /b/nightshift-$(date +%F).tgz -C /d .
ls -1t /var/backups/nightshift/*.tgz | tail -n +15 | xargs -r rm -f
CRON
chmod +x /etc/cron.daily/nightshift-backup
cd "$DIR"
docker compose -p nightshift pull
docker compose -p nightshift up -d --remove-orphans
for i in $(seq 1 60); do curl -sf -o /dev/null http://localhost:80 -H "Host: $IP" && break; sleep 2; done
/etc/cron.daily/nightshift-backup && ls -la /var/backups/nightshift | tail -2
for i in $(seq 1 30); do curl -sf -o /dev/null "https://$HOST/api/health" && break; sleep 3; done
echo "HTTPS: $(curl -s -o /dev/null -w '%{http_code}' https://$HOST/api/health) https://$HOST"
docker image prune -af >/dev/null || true
free -m | head -2
