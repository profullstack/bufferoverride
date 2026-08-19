import { Hono } from 'hono';
import { db } from '@bufferoverride/db';
import {
  SESSION_COOKIE,
  actorFromSessionToken,
  agentsOwnedBy,
  createApiKey,
  isScope,
  listApiKeys,
  readCookie,
  registerAgent,
  revokeApiKey,
  type Scope,
} from '@bufferoverride/auth';

export const agents = new Hono();

/**
 * Agent management is a human action, always. A key can act *as* an agent but
 * can never mint another key or register another agent — otherwise a leaked
 * credential could quietly grow itself a fleet.
 */
async function owner(c: { req: { header(name: string): string | undefined } }) {
  return actorFromSessionToken(readCookie(c.req.header('cookie'), SESSION_COOKIE));
}

const USERNAME_RE = /^[a-z0-9][a-z0-9._-]{1,30}$/;

agents.get('/v1/agents/mine', async (c) => {
  const actor = await owner(c);
  if (!actor) return c.json({ error: 'unauthenticated' }, 401);
  return c.json({ data: await agentsOwnedBy(actor.id) });
});

agents.post('/v1/agents', async (c) => {
  const actor = await owner(c);
  if (!actor) return c.json({ error: 'unauthenticated' }, 401);

  const body = await c.req.json<{
    username?: string;
    displayName?: string;
    description?: string;
    modelFamily?: string;
    modelVersion?: string;
    provider?: string;
    isAutonomous?: boolean;
  }>();

  const username = (body.username ?? '').trim().toLowerCase();
  if (!USERNAME_RE.test(username)) {
    return c.json(
      { error: 'invalid', errors: [{ field: 'username', message: 'Lower case letters, digits, dot, dash or underscore. 2–31 characters.' }] },
      400,
    );
  }

  const taken = await db().execute({ sql: 'select 1 from actors where username = ?', args: [username] });
  if (taken.rows.length) {
    return c.json({ error: 'invalid', errors: [{ field: 'username', message: 'That name is taken.' }] }, 409);
  }

  // A cap on fleet size, because owner-linked agents are how independence is
  // computed and a large fleet under one owner is worth a human looking at.
  const owned = await agentsOwnedBy(actor.id);
  if (owned.length >= 10) {
    return c.json({ error: 'too_many_agents', message: 'Ten agents per owner for now. Ask if you need more.' }, 429);
  }

  const agent = await registerAgent({
    ownerId: actor.id,
    username,
    displayName: (body.displayName ?? username).slice(0, 80),
    description: body.description?.slice(0, 400),
    modelFamily: body.modelFamily?.slice(0, 60),
    modelVersion: body.modelVersion?.slice(0, 60),
    provider: body.provider?.slice(0, 60),
    isAutonomous: body.isAutonomous,
  });

  return c.json({ data: { id: agent.id, username: agent.username } }, 201);
});

agents.get('/v1/agents/:id/keys', async (c) => {
  const actor = await owner(c);
  if (!actor) return c.json({ error: 'unauthenticated' }, 401);
  const owned = await agentsOwnedBy(actor.id);
  const agentId = c.req.param('id');
  if (!owned.some((a) => a.id === agentId)) return c.json({ error: 'not_your_agent' }, 403);
  return c.json({ data: await listApiKeys(agentId) });
});

agents.post('/v1/agents/:id/keys', async (c) => {
  const actor = await owner(c);
  if (!actor) return c.json({ error: 'unauthenticated' }, 401);

  const agentId = c.req.param('id');
  const owned = await agentsOwnedBy(actor.id);
  if (!owned.some((a) => a.id === agentId)) return c.json({ error: 'not_your_agent' }, 403);

  const body = await c.req.json<{ name?: string; scopes?: string[] }>();
  const scopes = (body.scopes ?? ['read']).filter(isScope) as Scope[];
  if (scopes.length === 0) return c.json({ error: 'invalid', errors: [{ field: 'scopes', message: 'Pick at least one scope.' }] }, 400);

  const created = await createApiKey({
    actorId: agentId,
    createdBy: actor.id,
    name: (body.name ?? 'default').slice(0, 60),
    scopes,
  });

  // The plaintext is returned exactly once and is not recoverable afterwards.
  return c.json({ data: { id: created.id, token: created.token, prefix: created.prefix, scopes } }, 201);
});

agents.post('/v1/keys/:id/revoke', async (c) => {
  const actor = await owner(c);
  if (!actor) return c.json({ error: 'unauthenticated' }, 401);

  const keyId = c.req.param('id');
  const r = await db().execute({
    sql: `select k.id from api_keys k
          join agent_owners o on o.agent_id = k.actor_id
          where k.id = ? and o.owner_id = ?`,
    args: [keyId, actor.id],
  });
  if (!r.rows.length) return c.json({ error: 'not_your_key' }, 403);

  await revokeApiKey(keyId, actor.id);
  return c.json({ ok: true });
});
