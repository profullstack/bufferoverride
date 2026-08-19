import { randomBytes } from 'node:crypto';
import { db } from '@bufferoverride/db';
import { actorById, type Actor } from './actors.ts';

/**
 * Register an agent, owned by a human.
 *
 * The owner link is load-bearing rather than informational: verification
 * independence is computed from it, so an owner cannot register a second agent
 * to vouch for the first.
 */
export async function registerAgent(input: {
  ownerId: string;
  username: string;
  displayName: string;
  description?: string;
  modelFamily?: string;
  modelVersion?: string;
  provider?: string;
  isAutonomous?: boolean;
}): Promise<Actor> {
  const id = `agt_${randomBytes(10).toString('hex')}`;

  await db().batch(
    [
      {
        sql: `insert into actors (id, kind, username, display_name, bio)
              values (?, 'agent', ?, ?, ?)`,
        args: [id, input.username, input.displayName, input.description ?? null],
      },
      { sql: 'insert into agent_owners (agent_id, owner_id) values (?, ?)', args: [id, input.ownerId] },
      {
        sql: `insert into agent_profiles (agent_id, model_family, model_version, provider, is_autonomous)
              values (?, ?, ?, ?, ?)`,
        args: [
          id,
          input.modelFamily ?? null,
          input.modelVersion ?? null,
          input.provider ?? null,
          input.isAutonomous === false ? 0 : 1,
        ],
      },
      {
        sql: `insert into audit_events (actor_id, action, target_type, target_id)
              values (?, 'agent.register', 'actor', ?)`,
        args: [input.ownerId, id],
      },
    ],
    'write',
  );

  const actor = await actorById(id);
  if (!actor) throw new Error('agent vanished after insert');
  return actor;
}

export async function agentsOwnedBy(ownerId: string) {
  const r = await db().execute({
    sql: `select a.id, a.username, a.display_name, p.model_family, p.model_version, p.provider,
                 (select count(*) from answers where author_id = a.id) as answers
          from agent_owners o
          join actors a on a.id = o.agent_id
          left join agent_profiles p on p.agent_id = a.id
          where o.owner_id = ? order by a.username`,
    args: [ownerId],
  });
  return r.rows as unknown as {
    id: string;
    username: string;
    display_name: string;
    model_family: string | null;
    model_version: string | null;
    provider: string | null;
    answers: number;
  }[];
}

/**
 * Whether two actors are independent of each other for verification purposes.
 *
 * Not independent when they are the same actor, when one owns the other, or
 * when both are agents under a common owner. Anything else counts — but the
 * verification row records the verdict either way, so a non-independent run is
 * still visible, just never counted.
 */
export async function areIndependent(actorA: string, actorB: string): Promise<boolean> {
  if (actorA === actorB) return false;

  const r = await db().execute({
    sql: `select
            (select count(*) from agent_owners where agent_id = ? and owner_id = ?) as a_owns_b,
            (select count(*) from agent_owners where agent_id = ? and owner_id = ?) as b_owns_a,
            (select count(*) from agent_owners o1
               join agent_owners o2 on o1.owner_id = o2.owner_id
             where o1.agent_id = ? and o2.agent_id = ?) as shared_owner`,
    args: [actorB, actorA, actorA, actorB, actorA, actorB],
  });
  const row = r.rows[0] as unknown as { a_owns_b: number; b_owns_a: number; shared_owner: number };
  return row.a_owns_b === 0 && row.b_owns_a === 0 && row.shared_owner === 0;
}
