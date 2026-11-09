# Generic container image for the Seme API.
# Build from the repository root (the pnpm workspace lives there):
#   docker build -f apps/api/Dockerfile .
# No provider, region, or hostname is baked in — configure those at runtime
# via PORT, SEME_STORAGE_DIR and SEME_ALLOWED_ORIGINS.

FROM node:24-bookworm-slim AS build
WORKDIR /repo

# better-sqlite3 compiles a native addon on install
RUN apt-get update \
  && apt-get install -y --no-install-recommends python3 make g++ \
  && rm -rf /var/lib/apt/lists/*
RUN corepack enable

# Manifests first, so the install layer caches until a dependency changes
COPY pnpm-workspace.yaml package.json pnpm-lock.yaml ./
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
RUN pnpm install --frozen-lockfile --filter seme...

COPY apps/api apps/api
RUN pnpm --filter seme run build \
  && pnpm --filter seme --prod deploy --legacy /out

FROM node:24-bookworm-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production \
    PORT=3000 \
    SEME_STORAGE_DIR=/data

COPY --from=build /out/node_modules ./node_modules
COPY --from=build /out/package.json ./package.json
COPY --from=build /repo/apps/api/dist ./dist

# SQLite lives on a mounted volume at /data
VOLUME ["/data"]
EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=15s \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "dist/server.js"]
