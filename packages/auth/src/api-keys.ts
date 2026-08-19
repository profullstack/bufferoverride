import { randomBytes } from 'node:crypto';
import { db } from '@bufferoverride/db';
import { actorById, type Actor } from './actors.ts';
import { hashToken } from './tokens.ts';

/**
 * Scopes are deliberately narrow and additive. Payment scopes are absent
 * rather than merely unused: nothing in this system can authorize money, so
 * there is no scope to accidentally grant.
 */
export const SCOPES = [
  'read',
  'write:questions',
  'write:answers',
  'write:verifications',
  'write:comments',
] as const;

export type Scope = (typeof SCOPES)[number];

export function isScope(value: string): value is Scope {
  return (SCOPES as readonly string[]).includes(value);
}

export type KeyPrincipal = { actor: Actor; scopes: Scope[]; keyId: string };

/** Returns the plaintext exactly once; only its hash is stored. */
export async function createApiKey(input: {
  actorId: string;
  createdBy: string;
  name: string;
  scopes: Scope[];
}): Promise<{ id: string; token: string; prefix: string }> {
  const id = `key_${randomBytes(8).toString('hex')}`;
  const secret = randomBytes(24).toString('base64url');
  const token = `bo_${secret}`;
  const prefix = token.slice(0, 10);

  await db().batch(
    [
      {
        sql: `insert into api_keys (id, actor_id, created_by, name, prefix, token_hash, scopes)
              values (?, ?, ?, ?, ?, ?, ?)`,
        args: [id, input.actorId, input.createdBy, input.name, prefix, hashToken(token), input.scopes.join(' ')],
      },
      {
        sql: `insert into audit_events (actor_id, action, target_type, target_id, metadata)
              values (?, 'apikey.create', 'actor', ?, ?)`,
        args: [input.createdBy, input.actorId, JSON.stringify({ scopes: input.scopes, prefix })],
      },
    ],
    'write',
  );

  return { id, token, prefix };
}

/** Resolve `Authorization: Bearer bo_…` to an actor and its granted scopes. */
export async function principalFromAuthHeader(header: string | undefined): Promise<KeyPrincipal | null> {
  if (!header) return null;
  const match = /^Bearer\s+(bo_[A-Za-z0-9_-]+)$/.exec(header.trim());
  if (!match) return null;

  const r = await db().execute({
    sql: 'select id, actor_id, scopes, revoked_at from api_keys where token_hash = ?',
    args: [hashToken(match[1])],
  });
  const row = r.rows[0] as unknown as
    | { id: string; actor_id: string; scopes: string; revoked_at: string | null }
    | undefined;
  if (!row || row.revoked_at) return null;

  const actor = await actorById(row.actor_id);
  if (!actor) return null;

  // Best-effort touch; a failure here must never fail the request.
  db()
    .execute({
      sql: `update api_keys set last_used_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') where id = ?`,
      args: [row.id],
    })
    .catch(() => {});

  return {
    actor,
    scopes: row.scopes.split(' ').filter(isScope),
    keyId: row.id,
  };
}

export async function listApiKeys(actorId: string) {
  const r = await db().execute({
    sql: `select id, name, prefix, scopes, created_at, last_used_at, revoked_at
          from api_keys where actor_id = ? order by created_at desc`,
    args: [actorId],
  });
  return r.rows as unknown as {
    id: string;
    name: string;
    prefix: string;
    scopes: string;
    created_at: string;
    last_used_at: string | null;
    revoked_at: string | null;
  }[];
}

export async function revokeApiKey(id: string, byActorId: string): Promise<void> {
  await db().batch(
    [
      {
        sql: `update api_keys set revoked_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')
              where id = ? and revoked_at is null`,
        args: [id],
      },
      {
        sql: `insert into audit_events (actor_id, action, target_type, target_id)
              values (?, 'apikey.revoke', 'api_key', ?)`,
        args: [byActorId, id],
      },
    ],
    'write',
  );
}
