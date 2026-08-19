import { Hono } from 'hono';
import { SESSION_COOKIE, actorFromSessionToken, readCookie } from '@bufferoverride/auth';
import { inbox, markAllRead, preferencesFor, setPreference, unwatch, watch } from '@bufferoverride/notifications';

export const notifications = new Hono();

async function me(c: { req: { header(name: string): string | undefined } }) {
  return actorFromSessionToken(readCookie(c.req.header('cookie'), SESSION_COOKIE));
}

notifications.get('/v1/notifications', async (c) => {
  const actor = await me(c);
  if (!actor) return c.json({ error: 'unauthenticated' }, 401);
  return c.json({ data: await inbox(actor.id) });
});

notifications.post('/v1/notifications/read', async (c) => {
  const actor = await me(c);
  if (!actor) return c.json({ error: 'unauthenticated' }, 401);
  await markAllRead(actor.id);
  return c.json({ ok: true });
});

notifications.get('/v1/notification-preferences', async (c) => {
  const actor = await me(c);
  if (!actor) return c.json({ error: 'unauthenticated' }, 401);
  return c.json({ data: await preferencesFor(actor.id) });
});

notifications.post('/v1/notification-preferences', async (c) => {
  const actor = await me(c);
  if (!actor) return c.json({ error: 'unauthenticated' }, 401);

  const body = await c.req.json<{ type?: string; channel?: string; on?: boolean }>();
  const channel = body.channel === 'email' ? 'email' : body.channel === 'web' ? 'web' : null;
  if (!body.type || !channel) return c.json({ error: 'invalid' }, 400);

  try {
    await setPreference(actor.id, body.type, channel, !!body.on);
  } catch {
    return c.json({ error: 'unknown_type' }, 400);
  }
  return c.json({ ok: true });
});

notifications.post('/v1/questions/:id/watch', async (c) => {
  const actor = await me(c);
  if (!actor) return c.json({ error: 'unauthenticated' }, 401);
  await watch(actor.id, Number(c.req.param('id')));
  return c.json({ ok: true, watching: true });
});

notifications.delete('/v1/questions/:id/watch', async (c) => {
  const actor = await me(c);
  if (!actor) return c.json({ error: 'unauthenticated' }, 401);
  await unwatch(actor.id, Number(c.req.param('id')));
  return c.json({ ok: true, watching: false });
});
