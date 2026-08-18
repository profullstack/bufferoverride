# Single image, single Railway service. Every daemon runs as a supervised
# child of the gateway process — see docs/architecture/deployment.md.
FROM node:24-slim AS base
ENV PNPM_HOME=/pnpm
ENV PATH="$PNPM_HOME:$PATH"
RUN corepack enable
WORKDIR /app

FROM base AS deps
# Manifests first so a source-only change reuses the install layer.
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml .npmrc ./
COPY packages/db/package.json ./packages/db/
COPY apps/api/package.json ./apps/api/
COPY apps/web/package.json ./apps/web/
COPY apps/media/package.json ./apps/media/
COPY apps/worker/package.json ./apps/worker/
COPY apps/gateway/package.json ./apps/gateway/
RUN pnpm install --frozen-lockfile

FROM base AS build
COPY --from=deps /app/node_modules ./node_modules
COPY --from=deps /app/apps ./apps
COPY --from=deps /app/packages ./packages
COPY . .
# Next reads no runtime secrets at build time; pages are force-dynamic.
RUN pnpm --filter @bufferoverride/web build

FROM base AS runtime
ENV NODE_ENV=production
COPY --from=build /app ./
# Railway mounts the persistent volume here.
RUN mkdir -p /data/media
EXPOSE 3000
# The gateway runs migrations, then supervises web, api, media and worker.
CMD ["node", "apps/gateway/src/index.ts"]
