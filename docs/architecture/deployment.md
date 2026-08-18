# Deployment architecture

> Supersedes §12 of [the PRD](../PRD.md) where the two disagree. The PRD sketches
> six independently deployed apps; this document records the topology actually
> chosen.

## Decision

**One repository. One Railway service. One Turso database.**

Every process — the web PWA, the REST API, the MCP server, the media service and
the background daemons — runs inside a single container under a process
supervisor, sharing one persistent volume and one database.

## Topology

```text
┌─ Railway service: bufferoverride ─────────────────┐
│                                                   │
│  supervisor (PID 1)                               │
│   ├── web        Next.js, public HTML + PWA       │
│   ├── api        Hono — REST, MCP, webhooks       │
│   ├── media      uploads, variants, OG images     │
│   ├── worker     indexing, notifications, moderation
│   └── scheduler  cadence, reconciliation, GC      │
│                                                   │
│  volume: /data  ──── media, quarantine, backups   │
└───────────────────────────────────────────────────┘
                       │
          ┌────────────┴────────────┐
          ▼                         ▼
     Turso / libSQL           Cloudflare
     (single database)        (DNS, CDN, WAF)
```

An edge router inside the container fronts the processes so the service exposes
one HTTP port:

| Path | Process |
|---|---|
| `/api/**`, `/v1/**` | api |
| `/mcp` | api |
| `/media/**` | media |
| everything else | web |

## Why this shape

**The media volume forces it anyway.** A Railway volume attaches to exactly one
service and pins that service to a single replica. The PRD's separate media
service (§12.4) exists to avoid multiple writers on one volume — but collapsing
everything into one service solves the same problem more directly: there is only
one writer because there is only one container.

**Operational surface.** One deploy, one log stream, one set of environment
variables, one health check. At pre-launch scale the coordination cost of six
services buys nothing.

**In-process calls.** The worker and API share the same `packages/db` connection
pool rather than talking over HTTP.

## What this costs

Stated plainly, because these are real and they are the reason most projects
don't do this:

- **No independent scaling.** The web tier cannot scale without also scaling the
  worker. The volume caps the whole service at one replica regardless.
- **Blast radius.** A crash-looping daemon can take the site down with it. The
  supervisor must be configured to restart individual children rather than exit,
  and a non-essential daemon must never be able to fail the container's health
  check.
- **Deploys restart everything.** There is no partial deploy; shipping a CSS
  change restarts the indexer.
- **No sandbox here, ever.** §12.7 of the PRD is not negotiable — untrusted answer
  verification must not share a container with the API. When verification ships it
  gets its own isolated service. Nothing in this document applies to it.

Migrating a process out later is intentionally cheap: each daemon is a separate
entry point in the monorepo already, so promoting one to its own Railway service
is a config change, not a rewrite.

## Data

Turso/libSQL, one database, accessed only through `packages/db`.

Two constraints that shape the schema and are much cheaper to honour now than to
retrofit:

1. **Write transactions serialize per database, and acquiring the write path
   dominates the cost of the work inside it.** A one-row insert and a hundred-row
   insert cost about the same. Budget **at most two write transactions per
   user-visible action**, and batch aggressively — resolve foreign keys in SQL
   within the same batch rather than reading them back in a round trip.
2. **Append-only tables ride along.** The PRD's audit, payment and revision
   tables (§22.1) must be written in the *same* batch as the action that caused
   them, never as a follow-up write. Fan-out — notifying every watcher of a
   question — belongs in a queue, not in the request path.

Concurrency is not a lever for write throughput; more workers only deepen the
queue. Measure by counting actual transactions in a code path, not by reasoning
about them.

## Environment

| Variable | Purpose |
|---|---|
| `TURSO_DATABASE_URL` | libSQL endpoint |
| `TURSO_AUTH_TOKEN` | libSQL auth token |
| `MEDIA_ROOT` | volume mount, `/data/media` |
| `PORT` | edge router port, supplied by Railway |
| `PUBLIC_BASE_URL` | canonical origin for URLs, feeds and JSON-LD |

Secrets live in Railway's variables and are never committed. Note that Next.js
inlines `process.env.SOME_NAME` **at build time**, including in server code — a
variable absent during the build is compiled in as `undefined` permanently.
Server-side secrets must be read through a non-literal accessor
(`process.env[String(name)]`); only `NEXT_PUBLIC_*` should be referenced
directly.

## Backups

The volume cannot be mounted by a second service, so backups are a push from
inside the container to external object storage — not a sidecar. Cloudflare R2 is
excluded by the PRD, so the target must be named before the media service ships;
until then §25.4's backup and restore-drill metrics measure a job that does not
exist.

Turso is backed up by the provider; the volume is not.
