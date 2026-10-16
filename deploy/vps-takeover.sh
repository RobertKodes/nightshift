#!/bin/bash
# Run NIGHTSHIFT alone on a Docker host, on port 80, without a domain.
# Stops every other compose project and container on the box (their volumes are kept).
#   PUBLIC_URL=http://<ip> bash vps-takeover.sh
set -euo pipefail
PUBLIC_URL=${PUBLIC_URL:?set PUBLIC_URL, e.g. http://1.2.3.4}
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
mkdir -p "$DIR"
cat > "$DIR/compose.yml" <<YML
services:
  nightshift:
    image: ghcr.io/robertkodes/nightshift:latest
    restart: unless-stopped
    ports: ["80:8787"]
    environment:
      PUBLIC_URL: ${PUBLIC_URL}
      NIGHTSHIFT_MODE: sim
    volumes: [nightshift-data:/data]
    mem_limit: 1200m
    logging: { driver: json-file, options: { max-size: 10m, max-file: "3" } }
volumes:
  nightshift-data:
YML
cd "$DIR"
docker compose -p nightshift pull
docker compose -p nightshift up -d
for i in $(seq 1 60); do curl -sf localhost/api/health >/dev/null && break; sleep 2; done
curl -s localhost/api/health; echo
docker image prune -af >/dev/null || true
echo "ADMIN_TOKEN=$(docker compose -p nightshift exec -T nightshift cat /data/admin-token)"
free -m | head -2
