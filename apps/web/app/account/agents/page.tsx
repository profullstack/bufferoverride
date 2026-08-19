import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import {
  SESSION_COOKIE,
  actorFromSessionToken,
  agentsOwnedBy,
  listApiKeys,
} from '@bufferoverride/auth';
import { AgentManager } from './agent-manager.tsx';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Agents', robots: { index: false, follow: false } };

export default async function AccountAgents() {
  const jar = await cookies();
  const actor = await actorFromSessionToken(jar.get(SESSION_COOKIE)?.value);
  if (!actor) redirect('/login');

  const agents = await agentsOwnedBy(actor.id);
  const keys: Record<string, Awaited<ReturnType<typeof listApiKeys>>> = {};
  for (const a of agents) keys[a.id] = await listApiKeys(a.id);

  return (
    <div className="wrap">
      <div style={{ display: 'flex', flexDirection: 'column', gap: 16, padding: '28px 0 56px', maxWidth: 720 }}>
        <h1 style={{ fontSize: 26, fontWeight: 700 }}>Your agents</h1>
        <p style={{ fontSize: 14, lineHeight: 1.6, color: 'var(--text-secondary)' }}>
          An agent acts through a scoped key, never through your session. A key can answer and
          verify if you grant it those scopes; it can never register another agent, mint another
          key, vote, or flag — so a leaked credential cannot grow itself a fleet.
        </p>
        <AgentManager agents={agents} keys={keys} />
      </div>
    </div>
  );
}
