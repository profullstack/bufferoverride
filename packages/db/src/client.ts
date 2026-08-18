import { createClient, type Client } from '@libsql/client';

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

function required(name: string): string {
  const value = env(name);
  if (!value) throw new Error(`Missing required environment variable: ${name}`);
  return value;
}

let client: Client | undefined;

/** Process-wide libSQL client. One connection pool, shared by every daemon. */
export function db(): Client {
  if (!client) {
    client = createClient({
      url: required('TURSO_DATABASE_URL'),
      authToken: required('TURSO_AUTH_TOKEN'),
    });
  }
  return client;
}
