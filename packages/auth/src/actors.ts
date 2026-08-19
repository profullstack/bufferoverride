import { db } from '@bufferoverride/db';
import { randomBytes } from 'node:crypto';

export type Actor = {
  id: string;
  kind: string;
  username: string;
  display_name: string;
  email: string | null;
};

function slugifyUsername(input: string): string {
  const base = input
    .toLowerCase()
    .replace(/@.*$/, '')
    .replace(/[^a-z0-9._-]+/g, '-')
    .replace(/^[-.]+|[-.]+$/g, '')
    .slice(0, 24);
  return base.length >= 2 ? base : 'dev';
}

/** Find a free username near the requested one rather than failing the signup. */
async function availableUsername(desired: string): Promise<string> {
  const base = slugifyUsername(desired);
  for (let attempt = 0; attempt < 20; attempt++) {
    const candidate = attempt === 0 ? base : `${base}-${attempt + 1}`;
    const taken = await db().execute({
      sql: 'select 1 from actors where username = ? limit 1',
      args: [candidate],
    });
    if (!taken.rows.length) return candidate;
  }
  return `${base}-${randomBytes(3).toString('hex')}`;
}

export async function actorById(id: string): Promise<Actor | null> {
  const r = await db().execute({
    sql: 'select id, kind, username, display_name, email from actors where id = ?',
    args: [id],
  });
  return (r.rows[0] as unknown as Actor) ?? null;
}

export async function actorByEmail(email: string): Promise<Actor | null> {
  const r = await db().execute({
    sql: 'select id, kind, username, display_name, email from actors where email = ?',
    args: [email.toLowerCase()],
  });
  return (r.rows[0] as unknown as Actor) ?? null;
}

/**
 * The magic link doubles as registration: an unknown address makes the account
 * rather than being turned away to find a separate sign-up form.
 */
export async function findOrCreateByEmail(
  email: string,
  displayName?: string,
): Promise<{ actor: Actor; created: boolean }> {
  const normalized = email.toLowerCase();
  const existing = await actorByEmail(normalized);
  if (existing) return { actor: existing, created: false };

  const username = await availableUsername(displayName ?? normalized);
  const id = `hum_${randomBytes(10).toString('hex')}`;

  await db().batch(
    [
      {
        sql: `insert into actors (id, kind, username, display_name, email)
              values (?, 'human', ?, ?, ?)`,
        args: [id, username, displayName ?? username, normalized],
      },
      {
        sql: `insert into audit_events (actor_id, action, target_type, target_id)
              values (?, 'actor.create', 'actor', ?)`,
        args: [id, id],
      },
    ],
    'write',
  );

  const actor = await actorById(id);
  if (!actor) throw new Error('actor vanished after insert');
  return { actor, created: true };
}

export async function createActorForIdentity(
  preferredUsername: string,
  displayName: string,
  email: string | null,
): Promise<Actor> {
  const username = await availableUsername(preferredUsername || displayName || 'dev');
  const id = `hum_${randomBytes(10).toString('hex')}`;
  await db().batch(
    [
      {
        sql: `insert into actors (id, kind, username, display_name, email)
              values (?, 'human', ?, ?, ?)`,
        args: [id, username, displayName || username, email ? email.toLowerCase() : null],
      },
      {
        sql: `insert into audit_events (actor_id, action, target_type, target_id)
              values (?, 'actor.create', 'actor', ?)`,
        args: [id, id],
      },
    ],
    'write',
  );
  const actor = await actorById(id);
  if (!actor) throw new Error('actor vanished after insert');
  return actor;
}
