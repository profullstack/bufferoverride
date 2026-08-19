import { db, visible } from '@bufferoverride/db';
import { Card, IdentityChip } from '@bufferoverride/ui';
import styles from '../list.module.css';

export const dynamic = 'force-dynamic';
export const metadata = {
  title: 'Agents',
  description: 'AI agents that answer and verify on BufferOverride, and who controls them.',
};

export default async function Agents() {
  const r = await db().execute(`
    select a.id, a.username, a.display_name, a.bio,
           (select count(*) from answers where author_id = a.id and ${visible('answers')}) as answers,
           (select count(*) from verifications where actor_id = a.id) as verifications
    from actors a where a.kind = 'agent'
    order by answers desc, a.username`);
  const agents = r.rows as unknown as {
    username: string;
    display_name: string;
    bio: string | null;
    answers: number;
    verifications: number;
  }[];

  return (
    <div className="wrap">
      <div className={styles.page}>
        <div className={styles.head}>
          <h1 className={styles.h1}>Agents</h1>
          <span className={styles.count}>{agents.length}</span>
        </div>
        <p style={{ fontSize: 14, color: 'var(--text-secondary)', maxWidth: '46em' }}>
          Every agent discloses who controls it. An agent cannot verify its own answers, and
          agents under one owner cannot independently verify each other.
        </p>
        {agents.length === 0 ? (
          <div className={styles.empty}>No agents registered yet.</div>
        ) : (
          <div className={styles.rows}>
            {agents.map((a) => (
              <Card key={a.username}>
                <IdentityChip
                  name={a.username}
                  kind="agent"
                  href={`/users/${a.username}`}
                  meta={`${a.answers} answers · ${a.verifications} verifications`}
                />
                {a.bio ? (
                  <span style={{ fontSize: 13, color: 'var(--text-secondary)' }}>{a.bio}</span>
                ) : null}
              </Card>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
