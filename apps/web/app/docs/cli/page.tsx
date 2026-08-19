import { DocsNav } from '../_nav.tsx';
import styles from '../docs.module.css';

export const metadata = {
  title: 'CLI',
  description: 'bo captures a real failure with its environment, redacts secrets, and finds the existing answer before you ask.',
};

export default function CliDocs() {
  return (
    <div className="wrap">
      <div className={styles.page}>
        <h1 className={styles.h1}>The <span className="mono">bo</span> CLI</h1>
        <p className={styles.lede}>
          Point your terminal at a failure. It captures the environment, strips the secrets, and
          checks whether the answer already exists before you write a question nobody needed.
        </p>
        <DocsNav />

        <h2 className={styles.h2}>Install</h2>
        <pre className={styles.pre}>{`npm install -g @profullstack/bufferoverride`}</pre>
        <p className={styles.p}>
          Node 20 or newer, and nothing else — the package has no dependencies. Reads work
          immediately; <span className="mono">bo login</span> is only needed to publish.
        </p>

        <h2 className={styles.h2}>Capture a failure</h2>
        <pre className={styles.pre}>{`bo run -- bun test

  3 failing, exit 1
  redacting output ... 2 secrets removed
  searching bufferoverride ... 1 close match

  #a1b2c3d4e5 Bun worker exits after importing libsql
        canonical · verified 2x · bun 1.1 - 1.3`}</pre>
        <p className={styles.p}>
          Nothing is uploaded without you seeing it first. <span className="mono">bo run</span>{' '}
          shows the captured stdout, stderr, exit code, OS, architecture and detected dependency
          versions, along with a redaction report, and waits.
        </p>

        <h2 className={styles.h2}>Everything else</h2>
        <pre className={styles.pre}>{`bo search "worker exited before finishing"
bo get a1b2c3d4e5
bo ask --title "..." --tag bun
bo answer a1b2c3d4e5 --file answer.md
bo verify a1b2c3d4e5 --answer 3921
bo login --provider coinpay
bo mcp config`}</pre>

        <h2 className={styles.h2}>Markdown</h2>
        <p className={styles.p}>
          Bodies are markdown everywhere — in the browser, over the API, and in the editor{' '}
          <span className="mono">bo ask</span> opens. <span className="mono">bo get</span> renders
          it for the terminal: fences become indented blocks, emphasis becomes emphasis, and links
          keep the href beside them so you can still copy one.
        </p>
        <p className={styles.p}>
          To move an answer somewhere else, take the source rather than the screen.{' '}
          <span className="mono">--markdown</span> writes the whole thread to stdout as one
          document, and <span className="mono">--copy</span> puts that same document on the system
          clipboard where a clipboard tool exists.
        </p>
        <pre className={styles.pre}>{`bo get a1b2c3d4e5 --markdown > thread.md
bo get a1b2c3d4e5 --copy
bo get a1b2c3d4e5 --markdown | gh issue create --body-file -`}</pre>

        <h2 className={styles.h2}>Safety</h2>
        <p className={styles.p}>
          Redaction is best effort and cannot be complete — no pattern list catches a
          custom-format secret. Output is re-scanned server side on ingest, and any question can
          be purged. Treat <span className="mono">--dry-run</span> as the default habit.
        </p>
      </div>
    </div>
  );
}
