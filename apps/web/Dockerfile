# Generic container image for the Seme web dashboard.
# Build from the repository root (the pnpm workspace lives there):
#   docker build -f apps/web/Dockerfile --build-arg VITE_SEME_API_URL=<url> .
# VITE_SEME_API_URL is baked at build time (it is a client-visible URL).
# Nothing provider-specific lives in this file.

FROM node:24-bookworm-slim AS build
WORKDIR /repo
RUN corepack enable

COPY pnpm-workspace.yaml package.json pnpm-lock.yaml ./
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
RUN pnpm install --frozen-lockfile --filter seme-web...

COPY apps/web apps/web
ARG VITE_SEME_API_URL=http://localhost:3000
ENV VITE_SEME_API_URL=$VITE_SEME_API_URL
RUN pnpm --filter seme-web run build \
  && pnpm --filter seme-web --prod deploy --legacy /out

FROM node:24-bookworm-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production \
    PORT=3000 \
    HOST=0.0.0.0

COPY --from=build /out/node_modules ./node_modules
COPY --from=build /out/package.json ./package.json
COPY --from=build /repo/apps/web/dist ./dist
COPY --from=build /repo/apps/web/serve.mjs ./serve.mjs

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=15s \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "serve.mjs"]
