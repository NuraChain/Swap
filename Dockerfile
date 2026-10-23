# One image for the whole app: stage 1 builds the client (client bundle, SSR
# bundle, prerender, sitemap), stage 2 runs the server - which has NO build step,
# Node >= 24 runs the TypeScript source - and serves the built client from the
# same origin.
#
# The runtime keeps the REPO LAYOUT under /app and runs from /app/server, so every
# path in server/src/main.ts resolves unchanged: CLIENT_DIR and SSR_ENTRY are
# relative to the repository root (/app), and the server
# reads one source file from the application half (application/src/lib/langs.ts).
#
# Build from the repo root:  docker build -t nuraswap .
# Run with the configuration supplied - every variable is required, none is
# baked in (see .env.example), and the indexer needs a PostgreSQL DATABASE_URL:
#   docker run --env-file .env -p 4400:4400 nuraswap

ARG NODE_VERSION=24

FROM node:${NODE_VERSION}-slim AS build
WORKDIR /app
# The origin canonical, hreflang, og:url and the sitemap claim. Anything other
# than production builds a noindex site - set it for staging.
ARG SITE_ORIGIN=https://swap.nurachain.net
ENV SITE_ORIGIN=${SITE_ORIGIN}
COPY package.json package-lock.json ./
COPY application/package.json application/
COPY server/package.json server/
COPY shared/package.json shared/
RUN npm ci
COPY . .
RUN npm run build

FROM node:${NODE_VERSION}-slim
WORKDIR /app
ARG SITE_ORIGIN=https://swap.nurachain.net
ENV SITE_ORIGIN=${SITE_ORIGIN}
# Same manifests and root lockfile as stage 1, scoped to the server workspace,
# dev deps omitted - vite and the devtools are only imported on the dev path.
COPY package.json package-lock.json ./
COPY application/package.json application/
COPY server/package.json server/
COPY shared/package.json shared/
RUN npm ci --omit=dev --workspace server && npm cache clean --force
COPY shared/src shared/src
COPY shared/deployments shared/deployments
COPY server/src server/src
COPY application/src/lib/langs.ts application/src/lib/langs.ts
COPY --from=build /app/application/dist application/dist
COPY --from=build /app/application/dist-server application/dist-server
# The NDJSON logs land in /app/server/logs, writable by the unprivileged user.
RUN mkdir -p server/logs && chown -R node:node server/logs
USER node
WORKDIR /app/server
EXPOSE 4400
HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 \
    CMD node -e "fetch('http://127.0.0.1:'+process.env.PORT+'/api/healthz').then(r=>process.exit(r.ok?0:1),()=>process.exit(1))"
CMD ["node", "src/main.ts"]
