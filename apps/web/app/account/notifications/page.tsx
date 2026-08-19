import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { SESSION_COOKIE, actorFromSessionToken } from '@bufferoverride/auth';
import { preferencesFor } from '@bufferoverride/notifications';
import { SettingsNav } from '../_nav.tsx';
import { NotificationPrefs } from './prefs.tsx';
import styles from '../settings.module.css';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Notification settings', robots: { index: false, follow: false } };

export default async function NotificationSettings() {
  const jar = await cookies();
  const actor = await actorFromSessionToken(jar.get(SESSION_COOKIE)?.value);
  if (!actor) redirect('/login');

  const prefs = await preferencesFor(actor.id);

  return (
    <div className="wrap">
      <div className={styles.layout}>
        <SettingsNav current="/account/notifications" />
        <div className={styles.main}>
          <h1 className={styles.h1}>Notifications</h1>
          <p className={styles.lede}>
            Only things that happen to your own content, or to a question you chose to follow.
            Changes save as you make them.
          </p>
          <div className={styles.section}>
            <NotificationPrefs initial={prefs} />
          </div>
          <p className={styles.sectionBody}>
            Email goes to <span className="mono">{actor.email ?? 'no address on file'}</span>. Every
            message carries a link straight back to this page.
          </p>
        </div>
      </div>
    </div>
  );
}
