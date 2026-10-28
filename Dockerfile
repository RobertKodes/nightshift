# NIGHTSHIFT: one container, the engine serving the built dashboard.
FROM node:22-bookworm-slim AS build
RUN corepack enable && corepack prepare pnpm@9.15.9 --activate && apt-get update && apt-get install -y --no-install-recommends git ca-certificates && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY . .
RUN pnpm install --frozen-lockfile && pnpm --filter @nightshift/web build

FROM node:22-bookworm-slim
RUN corepack enable && corepack prepare pnpm@9.15.9 --activate
# Official ACP CLI stays separate from the pnpm workspace and frozen lockfile.
RUN npm install --prefix /opt/acp-cli --omit=dev --no-audit --no-fund @virtuals-protocol/acp-cli@1.0.40
WORKDIR /app
COPY --from=build /app /app
ENV NODE_ENV=production NIGHTSHIFT_SUPERVISED=1 PORT=8787 DATA_DIR=/data WEB_DIST=/app/apps/web/dist
# /idmradio: ffmpeg passes a live broadcast to Telegram unchanged; yt-dlp finds the broadcast's video (pinned release, checksum checked).
RUN apt-get update && apt-get install -y --no-install-recommends ffmpeg ca-certificates curl && curl -fsSL -o /usr/local/bin/yt-dlp https://github.com/yt-dlp/yt-dlp/releases/download/2026.10.26/yt-dlp_linux && echo "767ba9dce7052aa196f8b12652f433d76de128ba168966fa84b6394d5e6c6795  /usr/local/bin/yt-dlp" | sha256sum -c - && chmod 755 /usr/local/bin/yt-dlp && rm -rf /var/lib/apt/lists/*
# The engine runs as the unprivileged node user and owns only its data folder.
RUN mkdir -p /data && chown node:node /data
USER node
VOLUME /data
EXPOSE 8787
WORKDIR /app/apps/engine
HEALTHCHECK --interval=30s --timeout=5s CMD node -e "fetch('http://localhost:8787/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["npx", "tsx", "src/main.ts"]
