'use client';

import { useEffect, useRef, useState } from 'react';
import { Badge, VersionPill } from '@bufferoverride/ui';
import styles from './ask.module.css';

type Dupe = { id: number; code: string; slug: string; title: string; answer_count: number; verified_count: number | null };
type Finding = { kind: string; line: number; preview: string };
type Invalid = { field: string; message: string };

export function AskForm() {
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [tags, setTags] = useState('');
  const [dupes, setDupes] = useState<Dupe[]>([]);
  const [findings, setFindings] = useState<Finding[]>([]);
  const [acknowledged, setAcknowledged] = useState(false);
  const [errors, setErrors] = useState<Invalid[]>([]);
  const [failure, setFailure] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const debounce = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Search before ask: the existing answer should surface while the title is
  // still being typed, not after a duplicate has been published.
  useEffect(() => {
    if (debounce.current) clearTimeout(debounce.current);
    if (title.trim().length < 12) {
      setDupes([]);
      return;
    }
    debounce.current = setTimeout(async () => {
      try {
        const res = await fetch('/v1/questions/duplicates', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ title }),
        });
        const json = await res.json();
        setDupes(json.data ?? []);
      } catch {
        /* a failed suggestion must never block asking */
      }
    }, 400);
    return () => {
      if (debounce.current) clearTimeout(debounce.current);
    };
  }, [title]);

  // Re-scan whenever the acknowledgement would go stale.
  useEffect(() => {
    setAcknowledged(false);
  }, [title, body]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setErrors([]);
    setFailure(null);

    const payload = {
      title,
      body,
      tags: tags.split(/[\s,]+/).filter(Boolean),
      acknowledgeSecrets: acknowledged,
    };

    try {
      const res = await fetch('/v1/questions', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const json = await res.json();

      if (res.status === 401) {
        window.location.href = '/login';
        return;
      }
      if (res.status === 409 && json.error === 'secrets_detected') {
        setFindings(json.findings ?? []);
        setBusy(false);
        return;
      }
      if (res.status === 429) {
        setFailure('You have asked several questions in the last hour. Try again shortly.');
        setBusy(false);
        return;
      }
      if (!res.ok) {
        setErrors(json.errors ?? []);
        if (!json.errors) setFailure('That could not be published.');
        setBusy(false);
        return;
      }
      window.location.href = json.data.url;
    } catch {
      setFailure('Could not reach the server.');
      setBusy(false);
    }
  }

  return (
    <form className={styles.page} onSubmit={submit}>
      <div>
        <h1 className={styles.h1}>Ask a question</h1>
        <p className={styles.lede}>
          Paste the real failure. Say what you expected, what happened, and what you are running —
          an answer that does not know your versions cannot tell you whether it still applies.
        </p>
      </div>

      {failure ? <div className={styles.errors}>{failure}</div> : null}

      <div className={styles.field}>
        <label className={styles.label} htmlFor="title">
          Title
        </label>
        <span className={styles.hint}>The error itself usually makes the best title.</span>
        <input
          id="title"
          className={styles.input}
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="Bun worker exits after importing libsql"
          maxLength={160}
          required
        />
        <span className={styles.counter}>{title.length}/160</span>
        {errors.filter((e) => e.field === 'title').map((e) => (
          <span key={e.message} className={styles.errors}>{e.message}</span>
        ))}
      </div>

      {dupes.length > 0 ? (
        <div className={styles.dupes}>
          <span className={styles.dupesTitle}>
            {dupes.length === 1 ? 'One existing question looks close' : `${dupes.length} existing questions look close`}
          </span>
          {dupes.map((d) => (
            <div key={d.id} className={styles.dupeRow}>
              <a href={`/q/${d.code}/${d.slug}`} target="_blank" rel="noreferrer">
                {d.title}
              </a>
              <span className={styles.dupeMeta}>
                {d.answer_count} {d.answer_count === 1 ? 'answer' : 'answers'}
                {d.verified_count ? ` · verified ${d.verified_count}x` : ''}
              </span>
            </div>
          ))}
        </div>
      ) : null}

      <div className={styles.field}>
        <label className={styles.label} htmlFor="body">
          What happened
        </label>
        <span className={styles.hint}>
          Command, expected result, actual result, and the environment. Paste the output verbatim.
        </span>
        <textarea
          id="body"
          className={styles.textarea}
          value={body}
          onChange={(e) => setBody(e.target.value)}
          placeholder={'$ bun test worker.spec.ts\nworker exited before finishing (code 0)\n\nExpected the worker to run to completion.\nbun 1.3.14 / ubuntu 24.04 / @libsql/client 0.15.15'}
          required
        />
        {errors.filter((e) => e.field === 'body').map((e) => (
          <span key={e.message} className={styles.errors}>{e.message}</span>
        ))}
      </div>

      <div className={styles.field}>
        <label className={styles.label} htmlFor="tags">
          Tags
        </label>
        <span className={styles.hint}>Up to five, space separated.</span>
        <input
          id="tags"
          className={styles.input}
          value={tags}
          onChange={(e) => setTags(e.target.value)}
          placeholder="bun turso worker-threads"
        />
        <div className={styles.tagRow}>
          {tags
            .split(/[\s,]+/)
            .filter(Boolean)
            .slice(0, 5)
            .map((t) => (
              <VersionPill key={t}>{t}</VersionPill>
            ))}
        </div>
      </div>

      {findings.length > 0 ? (
        <div className={styles.secrets}>
          <span className={styles.secretsTitle}>
            This looks like it contains {findings.length === 1 ? 'a credential' : 'credentials'}
          </span>
          {findings.map((f, i) => (
            <span key={i} className={styles.secretRow}>
              line {f.line} · {f.kind} · {f.preview}
            </span>
          ))}
          <label className={styles.ack}>
            <input
              type="checkbox"
              checked={acknowledged}
              onChange={(e) => setAcknowledged(e.target.checked)}
            />
            <span>
              I have checked these and they are not live credentials. Publish anyway.
              <br />
              If any of them are real, rotate them now — publishing here makes them public.
            </span>
          </label>
        </div>
      ) : null}

      <div className={styles.actions}>
        <button className={styles.submit} type="submit" disabled={busy || (findings.length > 0 && !acknowledged)}>
          {busy ? 'Publishing…' : 'Publish question'}
        </button>
        <Badge variant="outline">public and permanent</Badge>
      </div>
    </form>
  );
}
