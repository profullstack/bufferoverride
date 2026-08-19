'use client';

import { useId, useState } from 'react';
import { renderMarkdown } from '@bufferoverride/core/markdown';
import markdown from './markdown.module.css';
import styles from './markdown-area.module.css';

/**
 * A markdown textarea with a preview.
 *
 * The bodies were always markdown; what was missing was any way to find that
 * out before publishing. Preview renders through exactly the same function the
 * page does, so what an author checks here is what the question will show —
 * a preview that renders through a second, friendlier path is a preview that
 * eventually lies.
 *
 * Tab inserts two spaces rather than leaving the field. Losing a half-written
 * answer to a keystroke that means "indent" everywhere else in a developer's
 * day is a bad trade for the one visitor who tabs to the submit button; Escape
 * then Tab still leaves, which is the documented way out of a text control.
 */
export function MarkdownArea({
  value,
  onChange,
  placeholder,
  required,
  rows,
  className,
  hint = 'Markdown: **bold**, `code`, ```fences```, [links](https://example.com), ![images](…)',
  ariaLabel,
}: {
  value: string;
  onChange: (next: string) => void;
  placeholder?: string;
  required?: boolean;
  rows?: number;
  className?: string;
  hint?: string;
  ariaLabel?: string;
}) {
  const [tab, setTab] = useState<'write' | 'preview'>('write');
  const id = useId();
  const empty = !value.trim();

  return (
    <div className={styles.wrap}>
      <div className={styles.tabs} role="tablist" aria-label="Editor mode">
        <button
          type="button"
          role="tab"
          aria-selected={tab === 'write'}
          aria-controls={`${id}-write`}
          className={styles.tab}
          data-active={tab === 'write'}
          onClick={() => setTab('write')}
        >
          write
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={tab === 'preview'}
          aria-controls={`${id}-preview`}
          className={styles.tab}
          data-active={tab === 'preview'}
          onClick={() => setTab('preview')}
        >
          preview
        </button>
        <span className={styles.spacer} />
        <span className={styles.hint}>{hint}</span>
      </div>

      {tab === 'write' ? (
        <textarea
          id={`${id}-write`}
          className={className ? `${styles.area} ${className}` : styles.area}
          value={value}
          rows={rows}
          aria-label={ariaLabel}
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={(e) => {
            if (e.key !== 'Tab' || e.shiftKey) return;
            e.preventDefault();
            const el = e.currentTarget;
            const { selectionStart: start, selectionEnd: end } = el;
            const next = `${value.slice(0, start)}  ${value.slice(end)}`;
            onChange(next);
            requestAnimationFrame(() => el.setSelectionRange(start + 2, start + 2));
          }}
          placeholder={placeholder}
          required={required}
        />
      ) : (
        <div id={`${id}-preview`} role="tabpanel" className={styles.preview}>
          {empty ? (
            <span className={styles.blank}>Nothing to preview yet.</span>
          ) : (
            <div className={markdown.md} dangerouslySetInnerHTML={{ __html: renderMarkdown(value) }} />
          )}
        </div>
      )}
    </div>
  );
}
