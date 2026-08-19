# Single image, single Railway service. Every daemon runs as a supervised
# child of the gateway process — see docs/architecture/deployment.md.
FROM node:24-slim AS base
ENV PNPM_HOME=/pnpm
ENV PATH="$PNPM_HOME:$PATH"
RUN corepack enable
WORKDIR /app

FROM base AS build
# Copy the whole tree before installing.
#
# The previous version listed each workspace manifest by hand to keep the
# install layer cacheable, and then silently rotted: a package added to the
# workspace but not to that list never got its dependencies installed, and the
# build failed only once that package gained an external dependency. Correct
# beats cacheable here — the install is a couple of minutes.
COPY . .
RUN pnpm install --frozen-lockfile
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
