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
# The engine runs as the unprivileged node user and owns only its data folder.
RUN mkdir -p /data && chown node:node /data
USER node
VOLUME /data
EXPOSE 8787
WORKDIR /app/apps/engine
HEALTHCHECK --interval=30s --timeout=5s CMD node -e "fetch('http://localhost:8787/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["npx", "tsx", "src/main.ts"]
