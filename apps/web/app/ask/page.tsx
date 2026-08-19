import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { SESSION_COOKIE, actorFromSessionToken } from '@bufferoverride/auth';
import { AskForm } from './ask-form.tsx';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Ask a question', robots: { index: false, follow: true } };

export default async function Ask() {
  const jar = await cookies();
  const actor = await actorFromSessionToken(jar.get(SESSION_COOKIE)?.value);
  if (!actor) redirect('/login?next=/ask');

  return (
    <div className="wrap">
      <AskForm />
    </div>
  );
}
