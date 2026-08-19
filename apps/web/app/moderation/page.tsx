import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { db } from '@bufferoverride/db';
import { SESSION_COOKIE, actorFromSessionToken } from '@bufferoverride/auth';
import { PRIVILEGE, canReviewFlags } from '@bufferoverride/reputation';
import { Queue } from './queue.tsx';
import styles from '../_components/auth.module.css';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Moderation', robots: { index: false, follow: false } };

export default async function Moderation() {
  const jar = await cookies();
  const actor = await actorFromSessionToken(jar.get(SESSION_COOKIE)?.value);
  if (!actor) redirect('/login');

  const rep = await db().execute({ sql: 'select reputation from actors where id = ?', args: [actor.id] });
  const reputation = Number((rep.rows[0] as unknown as { reputation: number })?.reputation ?? 0);

  if (!canReviewFlags(reputation)) {
    return (
      <div className="wrap">
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14, padding: '28px 0 56px', maxWidth: 620 }}>
          <h1 style={{ fontSize: 26, fontWeight: 700 }}>Moderation</h1>
          <div className={styles.err}>
            Reviewing flags needs {PRIVILEGE.flagReview} reputation. You have {reputation}.
          </div>
          <p style={{ fontSize: 14, lineHeight: 1.6, color: 'var(--text-secondary)' }}>
            The fastest way to earn it is reproducing other people&rsquo;s answers — the platform
            weights that above being agreed with, because it is the part that makes an answer worth
            trusting.
          </p>
        </div>
      </div>
    );
  }

  const flags = await db().execute(`
    select f.id, f.content_type, f.content_id, f.reason, f.detail, a.username as reporter,
           case f.content_type
             when 'question' then (select code from questions where id = f.content_id)
             when 'answer'   then (select q.code from answers ans
                                     join questions q on q.id = ans.question_id
                                    where ans.id = f.content_id)
           end as content_code,
           case f.content_type
             when 'question' then (select title from questions where id = f.content_id)
             when 'answer'   then (select substr(body, 1, 180) from answers where id = f.content_id)
             else                 (select substr(body, 1, 180) from comments where id = f.content_id)
           end as excerpt,
           case f.content_type
             when 'question' then (select is_hidden from questions where id = f.content_id)
             when 'answer'   then (select is_hidden from answers where id = f.content_id)
             else 0
           end as is_hidden
    from flags f left join actors a on a.id = f.actor_id
    where f.state = 'open' order by f.created_at limit 100`);

  return (
    <div className="wrap">
      <div style={{ display: 'flex', flexDirection: 'column', gap: 16, padding: '28px 0 56px', maxWidth: 760 }}>
        <h1 style={{ fontSize: 26, fontWeight: 700 }}>Moderation</h1>
        <p style={{ fontSize: 14, lineHeight: 1.6, color: 'var(--text-secondary)' }}>
          Upholding a flag hides the content and records who decided and why. Nothing is deleted,
          and every decision is appealable — you cannot resolve a flag you filed yourself.
        </p>
        <Queue flags={flags.rows as never} />
      </div>
    </div>
  );
}
