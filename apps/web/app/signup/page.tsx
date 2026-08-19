import { SignInPanels } from '../_components/sign-in-panels.tsx';
import styles from '../_components/auth.module.css';

export const metadata = { title: 'Create an account', robots: { index: false, follow: true } };

export default async function Signup({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const { error } = await searchParams;
  return (
    <div className="wrap">
      <div className={styles.page}>
        <SignInPanels mode="signup" error={error} />
      </div>
    </div>
  );
}
