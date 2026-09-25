import { readdir, readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { databaseUrl, db, isPostgres, openClient } from './client.ts';

const PACKAGE_DIR = join(dirname(fileURLToPath(import.meta.url)), '..');

/**
 * Forward-only migration runner, keyed by filename.
 *
 * Each file is applied inside a single write transaction together with its
 * bookkeeping row, so a migration and the record that it ran can never
 * disagree. There is no down-migration: roll forward with a new file.
 *
 * Two editions of every migration exist: `migrations/` (SQLite, for local
 * `file:` databases and the tests) and `migrations-pg/` (Postgres, generated
 * from the former with `npx libsql-pg convert-schema` and reviewed). The same
 * filenames mark the same steps, so a `schema_migrations` table copied from
 * the old database is already complete. Postgres DDL is sent as-is through a
 * second client (`dialect: 'postgres'`): the statement rewriter only knows
 * SQLite's dialect and must not touch DDL that is not.
 */
export async function migrate(): Promise<string[]> {
  const postgres = isPostgres(db());
  const client = postgres ? openClient(databaseUrl(), { dialect: 'postgres' }) : db();
  try {
    return await run(client, join(PACKAGE_DIR, postgres ? 'migrations-pg' : 'migrations'), postgres);
  } finally {
    if (postgres) client.close();
  }
}

async function run(client: ReturnType<typeof db>, migrationsDir: string, postgres: boolean): Promise<string[]> {
  await client.execute(postgres
    ? `
    create table if not exists schema_migrations (
      filename    text primary key,
      applied_at  text not null default (to_char(now() at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'))
    )
  `
    : `
    create table if not exists schema_migrations (
      filename    text primary key,
      applied_at  text not null default (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
    )
  `);

  const applied = new Set(
    (await client.execute('select filename from schema_migrations')).rows.map(
      (row) => row.filename as string,
    ),
  );

  const files = (await readdir(migrationsDir)).filter((f) => f.endsWith('.sql')).sort();
  const ran: string[] = [];

  for (const file of files) {
    if (applied.has(file)) continue;

    const sql = await readFile(join(migrationsDir, file), 'utf8');
    const statements = splitStatements(sql);

    // One write transaction for the whole migration plus its bookkeeping row.
    await client.batch(
      [
        ...statements.map((s) => ({ sql: s, args: [] as never[] })),
        { sql: 'insert into schema_migrations (filename) values (?)', args: [file] as never },
      ],
      'write',
    );

    ran.push(file);
  }

  return ran;
}

/**
 * Split on semicolons at statement level. Naive on purpose — migrations are
 * ours, not user input — but it does respect the BEGIN...END of a trigger body,
 * which is the one place a bare split would corrupt the SQL.
 */
function splitStatements(sql: string): string[] {
  const out: string[] = [];
  let buffer = '';
  let triggerDepth = 0;

  for (const rawLine of sql.split('\n')) {
    const line = rawLine.replace(/--.*$/, '');
    if (!line.trim()) continue;

    buffer += line + '\n';

    if (/\bbegin\b/i.test(line) && /\btrigger\b/i.test(buffer)) triggerDepth++;
    if (/\bend\s*;/i.test(line) && triggerDepth > 0) {
      triggerDepth--;
      if (triggerDepth === 0) {
        out.push(buffer.trim().replace(/;$/, ''));
        buffer = '';
      }
      continue;
    }
    if (triggerDepth > 0) continue;

    if (line.trimEnd().endsWith(';')) {
      out.push(buffer.trim().replace(/;$/, ''));
      buffer = '';
    }
  }

  if (buffer.trim()) out.push(buffer.trim());
  return out.filter(Boolean);
}

// Allow `node packages/db/src/migrate.ts` as a one-shot CLI.
if (import.meta.url === `file://${process.argv[1]}`) {
  const ran = await migrate();
  console.log(ran.length ? `applied: ${ran.join(', ')}` : 'no pending migrations');
  process.exit(0);
}
