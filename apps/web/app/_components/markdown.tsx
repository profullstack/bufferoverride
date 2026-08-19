import { renderMarkdown } from '@bufferoverride/core';
import styles from './markdown.module.css';

/**
 * Renders a stored body as markdown.
 *
 * `dangerouslySetInnerHTML` is the right call here precisely because the HTML
 * is not user HTML: `renderMarkdown` escapes every run of source text and can
 * only emit tags it writes itself, so there is no untrusted markup to inject.
 * The alternative — building React elements from a parse tree — would give the
 * same output for considerably more machinery.
 */
export function Markdown({
  source,
  lead = false,
  className,
}: {
  source: string;
  /** The capsule's direct answer reads at a larger size than a reply does. */
  lead?: boolean;
  className?: string;
}) {
  const classes = [styles.md, lead ? styles.mdLead : '', className ?? ''].filter(Boolean).join(' ');
  return <div className={classes} dangerouslySetInnerHTML={{ __html: renderMarkdown(source) }} />;
}
