import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { SESSION_COOKIE, actorFromSessionToken } from '@bufferoverride/auth';
import { inbox } from '@bufferoverride/notifications';
import { Badge } from '@bufferoverride/ui';
import { daysAgo } from '../_lib/queries.ts';
import { SettingsNav } from '../account/_nav.tsx';
import { MarkAllRead } from './mark-read.tsx';
import styles from '../account/settings.module.css';
import list from '../list.module.css';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Notifications', robots: { index: false, follow: false } };

export default async function Notifications() {
  const jar = await cookies();
  const actor = await actorFromSessionToken(jar.get(SESSION_COOKIE)?.value);
  if (!actor) redirect('/login');

  const items = await inbox(actor.id);
  const unread = items.filter((n) => !n.read_at).length;

  return (
    <div className="wrap">
      <div className={styles.layout}>
        <SettingsNav current="/notifications" />
        <div className={styles.main}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <h1 className={styles.h1}>Notifications</h1>
            {unread > 0 ? <Badge variant="agent">{unread} unread</Badge> : null}
            <span className={styles.spacer} />
            {unread > 0 ? <MarkAllRead /> : null}
          </div>

          {items.length === 0 ? (
            <div className={list.empty}>
              Nothing yet. You will hear when someone answers your question, reproduces your
              answer, or challenges a canonical answer you wrote.
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column' }}>
              {items.map((n) => (
                <a
                  key={n.id}
                  href={n.url ?? '#'}
                  className={styles.section}
                  style={{
                    marginBottom: 8,
                    borderLeft: n.read_at ? undefined : '3px solid var(--accent-primary)',
                    color: 'inherit',
                  }}
                >
                  <div className={styles.sectionHead}>
                    <span className={styles.sectionTitle}>{n.title}</span>
                    <span className={styles.spacer} />
                    <span className="mono" style={{ fontSize: 11.5, color: 'var(--text-muted)' }}>
                      {daysAgo(n.created_at)}
                    </span>
                  </div>
                  {n.body ? <span className={styles.sectionBody}>{n.body}</span> : null}
                </a>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
