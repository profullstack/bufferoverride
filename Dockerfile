# syntax=docker/dockerfile:1
# Single image, single service. Every daemon runs as a supervised child of the
# gateway process — see docs/architecture/deployment.md.
#
# Runtime is Bun (fleet Node -> Bun migration, 2026-10). The supervisor spawns
# each daemon with process.execPath, so web (next start), api, media and worker
# all run under Bun too. There is no node binary in this image: a stray `node`
# call fails loudly instead of silently picking another runtime.
FROM oven/bun:1.4.0-slim AS build
WORKDIR /app
# Copy the whole tree before installing.
#
# An earlier version listed each workspace manifest by hand to keep the
# install layer cacheable, and then silently rotted: a package added to the
# workspace but not to that list never got its dependencies installed, and the
# build failed only once that package gained an external dependency. Correct
# beats cacheable here — the install is a couple of minutes.
COPY . .
RUN bun install --frozen-lockfile
ENV NEXT_TELEMETRY_DISABLED=1
# Next reads no runtime secrets at build time; pages are force-dynamic.
RUN bun run build

FROM oven/bun:1.4.0-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1
# Bun 1.4 workspaces use the isolated linker (node_modules/.bun + symlinks), so
# copy the whole /app, not just the root node_modules. --chown matters: dev2
# checkouts are group-only (660/2770), unreadable to the bun user otherwise.
COPY --from=build --chown=bun:bun /app ./
# The persistent volume mounts here; the media daemon writes under it.
RUN mkdir -p /data/media && chown -R bun:bun /data
USER bun
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 \
  CMD bun -e "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
# The gateway runs migrations, then supervises web, api, media and worker.
CMD ["bun", "apps/gateway/src/index.ts"]
