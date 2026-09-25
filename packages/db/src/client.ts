import type { Client } from '@libsql/client';

/** The client surface every query in the repo is written against (identical for both drivers). */
export type { Client };
import { createClient as createPostgresClient } from '@profullstack/libsql-pg';
import { createRequire } from 'node:module';

/**
 * Read an env var without letting a bundler inline it at build time.
 * Next.js statically replaces `process.env.LITERAL` during the build, including
 * in server code — a var absent at build time is compiled in as `undefined`
 * permanently. Indexing with a non-literal key defeats that substitution.
 */
export function env(name: string): string | undefined {
  const key = String(name);
  return process.env[key];
}

const POSTGRES_URL = /^postgres(ql)?:\/\//i;
const require_ = createRequire(import.meta.url);

/**
 * The database URL. Production is Postgres (`DATABASE_URL=postgres://...`, the
 * shared cluster on dev2); local development and the tests use an embedded
 * libSQL file (`file:...`). `TURSO_DATABASE_URL` is still honoured as the name
 * for a `file:` URL so nothing local had to change when the data left Turso
 * (2026-09); a `libsql://` value is refused rather than silently read.
 */
export function databaseUrl(): string {
  const url = env('DATABASE_URL') || env('TURSO_DATABASE_URL');
  if (!url) throw new Error('DATABASE_URL is not set (postgres://... in production, file:... locally)');
  if (!POSTGRES_URL.test(url) && !url.startsWith('file:')) {
    throw new Error(
      `DATABASE_URL must be a postgres:// URL (production) or a file: path (local); got "${url.split(':')[0]}:". ` +
        'Turso/libsql:// is no longer supported: the data lives in Postgres now.',
    );
  }
  return url;
}

/** True when the client talks to Postgres (through @profullstack/libsql-pg). */
export function isPostgres(client: Client): boolean {
  return (client as { protocol?: string }).protocol === 'postgres';
}

/**
 * Open a client for a URL. Postgres goes through @profullstack/libsql-pg, which
 * keeps the @libsql/client surface every query here was written against and
 * rewrites the remaining SQLite idioms per statement (`dialect: 'sqlite'`, the
 * default). A `file:` URL loads @libsql/client lazily: it is a devDependency,
 * so the production image needs neither it nor its native binding.
 */
export function openClient(url: string, options: { dialect?: 'sqlite' | 'postgres' } = {}): Client {
  if (POSTGRES_URL.test(url)) {
    return createPostgresClient({ url, dialect: options.dialect ?? 'sqlite' }) as unknown as Client;
  }
  const { createClient } = require_('@libsql/client') as typeof import('@libsql/client');
  return createClient({ url });
}

let client: Client | undefined;

/** Process-wide database client. One connection pool, shared by every daemon. */
export function db(): Client {
  if (!client) client = openClient(databaseUrl());
  return client;
}
