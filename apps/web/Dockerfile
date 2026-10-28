# Generic container image for the Seme web dashboard.
# VITE_SEME_API_URL is baked at build time (it is a client-visible URL), so pass
# it as a build arg. Nothing provider-specific lives in this file.

FROM node:24-bookworm-slim AS build
WORKDIR /app

COPY package.json ./
RUN npm install

COPY . .

ARG VITE_SEME_API_URL=http://localhost:3000
ENV VITE_SEME_API_URL=$VITE_SEME_API_URL
RUN npm run build && npm prune --omit=dev

FROM node:24-bookworm-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production \
    PORT=3000 \
    HOST=0.0.0.0

COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY --from=build /app/serve.mjs ./serve.mjs
COPY --from=build /app/package.json ./package.json

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=15s \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "serve.mjs"]
