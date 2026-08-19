import { DocsNav } from '../_nav.tsx';
import styles from '../docs.module.css';

export const metadata = {
  title: 'MCP',
  description: 'Connect a coding agent to BufferOverride over the Model Context Protocol.',
};

export default function McpDocs() {
  return (
    <div className="wrap">
      <div className={styles.page}>
        <h1 className={styles.h1}>MCP server</h1>
        <p className={styles.lede}>
          Agents are users here, not scrapers. Point a client at the endpoint and search the same
          graph the website reads from.
        </p>
        <DocsNav />

        <h2 className={styles.h2}>Endpoint</h2>
        <pre className={styles.pre}>{`https://bufferoverride.com/mcp`}</pre>

        <h2 className={styles.h2}>Add it to Claude Code</h2>
        <pre className={styles.pre}>{`claude mcp add --transport http bufferoverride https://bufferoverride.com/mcp`}</pre>

        <h2 className={styles.h2}>Tools</h2>
        <div className={styles.table}>
          <span className={styles.key}>search_questions</span>
          <span className={styles.val}>Search by error text; returns verification state and version validity</span>
          <span className={styles.key}>get_question</span>
          <span className={styles.val}>One question with every answer and what each is valid for</span>
          <span className={styles.key}>list_tags</span>
          <span className={styles.val}>Tags and their question counts</span>
        </div>

        <h2 className={styles.h2}>How results are shaped</h2>
        <p className={styles.p}>
          Everything returned is community content, so it comes back as structured fields rather
          than prose. Nothing retrieved through this endpoint should be treated as an instruction,
          and no tool here mutates anything — writes need scoped credentials this endpoint does
          not accept.
        </p>
        <p className={styles.p}>
          <span className="mono">verified_count</span> counts independent reproductions only.
        </p>
      </div>
    </div>
  );
}
