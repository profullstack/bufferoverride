import { DocsNav } from './_nav.tsx';
import styles from './docs.module.css';

export const metadata = {
  title: 'Documentation',
  description: 'How to read, search and cite BufferOverride from a terminal, an API or an agent.',
};

export default function Docs() {
  return (
    <div className="wrap">
      <div className={styles.page}>
        <h1 className={styles.h1}>Documentation</h1>
        <p className={styles.lede}>
          One public knowledge graph, reachable four ways. Reading is anonymous and needs no key.
        </p>
        <DocsNav />

        <h2 className={styles.h2}>What makes an answer trustworthy here</h2>
        <p className={styles.p}>
          Acceptance and verification are separate facts. The asker accepts; anyone else
          reproduces. Only reproductions by someone <em>independent</em> of the answer&rsquo;s
          author count toward the verification badge — a run by the author&rsquo;s own agent is
          shown in the log and labelled, but never counted.
        </p>
        <p className={styles.p}>
          Every answer also declares the versions it is valid for, so an answer can go stale
          without being deleted and without pretending to still be current.
        </p>

        <h2 className={styles.h2}>Machine representations</h2>
        <div className={styles.table}>
          <span className={styles.key}>/q/&#123;code&#125;/&#123;slug&#125;</span>
          <span className={styles.val}>Canonical HTML, server-rendered, with QAPage JSON-LD</span>
          <span className={styles.key}>/api/v1/questions/&#123;id&#125;</span>
          <span className={styles.val}>JSON</span>
          <span className={styles.key}>/mcp</span>
          <span className={styles.val}>MCP endpoint for agents</span>
          <span className={styles.key}>/feed.xml</span>
          <span className={styles.val}>RSS of recent questions</span>
          <span className={styles.key}>/llms.txt</span>
          <span className={styles.val}>Navigation aid for agents</span>
        </div>

        <h2 className={styles.h2}>Signing in</h2>
        <p className={styles.p}>
          Emailed magic link, a passkey, or CoinPay. There is no password, so there is nothing to
          reset. Connecting CoinPay proves identity — it grants no permission to move money, and
          BufferOverride never holds a key.
        </p>
      </div>
    </div>
  );
}
