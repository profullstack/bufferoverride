'use client';

import { useEffect, useRef, useState } from 'react';
import styles from './copy-markdown.module.css';

/**
 * Copies a body as its markdown source.
 *
 * What gets copied is the source, not the rendered text: someone lifting an
 * answer is nearly always moving it into another markdown surface — an issue,
 * a PR, a README, another agent's prompt — and a copy that arrives with its
 * fences and links intact is the one that survives the move.
 *
 * The clipboard also carries a `text/html` flavour, so pasting into a rich
 * editor that ignores markdown still lands formatted rather than as one long
 * line. Both flavours describe the same content; neither is a fallback for a
 * failure, only for a destination that cannot read the other.
 */
export function CopyMarkdown({
  source,
  html,
  label = 'copy as markdown',
}: {
  source: string;
  html?: string;
  label?: string;
}) {
  const [state, setState] = useState<'idle' | 'done' | 'failed'>('idle');
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);

  async function copy() {
    const ok = await writeClipboard(source, html);
    setState(ok ? 'done' : 'failed');
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setState('idle'), 1600);
  }

  return (
    <button
      type="button"
      onClick={copy}
      className={styles.copy}
      data-state={state}
      aria-live="polite"
      title="Copy this content as markdown"
    >
      {state === 'done' ? 'copied' : state === 'failed' ? 'press ⌘C' : label}
    </button>
  );
}

/**
 * The async Clipboard API is unavailable on insecure origins and inside some
 * embedded webviews, and `ClipboardItem` is missing in a few browsers that
 * otherwise have `writeText`. Each step below degrades to the next rather than
 * to nothing, because a copy button that silently does nothing is worse than
 * one that tells you to use the keyboard.
 */
async function writeClipboard(text: string, html?: string): Promise<boolean> {
  try {
    if (html && typeof ClipboardItem !== 'undefined' && navigator.clipboard?.write) {
      await navigator.clipboard.write([
        new ClipboardItem({
          'text/plain': new Blob([text], { type: 'text/plain' }),
          'text/html': new Blob([html], { type: 'text/html' }),
        }),
      ]);
      return true;
    }
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    // Fall through to the selection-based path below.
  }

  try {
    const area = document.createElement('textarea');
    area.value = text;
    area.setAttribute('readonly', '');
    area.style.position = 'fixed';
    area.style.top = '-1000px';
    document.body.appendChild(area);
    area.select();
    const ok = document.execCommand('copy');
    document.body.removeChild(area);
    return ok;
  } catch {
    return false;
  }
}
