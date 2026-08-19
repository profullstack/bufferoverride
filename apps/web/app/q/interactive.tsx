'use client';

import { useState } from 'react';
import { ArrowUpIcon, CheckIcon } from '@bufferoverride/ui';
import styles from './interactive.module.css';

function toLogin() {
  window.location.href = '/login';
}

/** Score and my own vote are optimistic; the server's number wins on reply. */
export function VoteControl({
  contentType,
  contentId,
  score,
  mine,
  signedIn,
  ownContent,
}: {
  contentType: 'question' | 'answer';
  contentId: number;
  score: number;
  mine: number;
  signedIn: boolean;
  ownContent: boolean;
}) {
  const [value, setValue] = useState(mine);
  const [current, setCurrent] = useState(score);
  const [busy, setBusy] = useState(false);

  async function cast(next: 1 | -1) {
    if (!signedIn) return toLogin();
    setBusy(true);
    const send = value === next ? 0 : next;
    try {
      const res = await fetch('/v1/votes', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ contentType, contentId, value: send }),
      });
      if (res.ok) {
        const json = await res.json();
        setCurrent(json.data.score);
        setValue(send);
      }
    } finally {
      setBusy(false);
    }
  }

  const title = ownContent ? 'You cannot vote on your own content' : undefined;

  return (
    <span className={styles.vote}>
      <button
        type="button"
        className={styles.voteBtn}
        aria-label="Upvote"
        aria-pressed={value === 1}
        disabled={busy || ownContent}
        title={title}
        onClick={() => cast(1)}
      >
        <ArrowUpIcon />
      </button>
      <span className={styles.score}>{current}</span>
      <button
        type="button"
        className={`${styles.voteBtn} ${styles.down}`}
        aria-label="Downvote"
        aria-pressed={value === -1}
        disabled={busy || ownContent}
        title={title}
        onClick={() => cast(-1)}
      >
        <ArrowUpIcon />
      </button>
    </span>
  );
}

export function AcceptControl({ answerId, accepted }: { answerId: number; accepted: boolean }) {
  const [isAccepted, setAccepted] = useState(accepted);
  const [busy, setBusy] = useState(false);

  async function accept() {
    setBusy(true);
    try {
      const res = await fetch(`/v1/answers/${answerId}/accept`, { method: 'POST' });
      if (res.ok) {
        setAccepted(true);
        window.location.reload();
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <button
      type="button"
      className={`${styles.action} ${isAccepted ? styles.accepted : ''}`}
      onClick={accept}
      disabled={busy || isAccepted}
    >
      <CheckIcon />
      {isAccepted ? 'Accepted' : 'Accept this answer'}
    </button>
  );
}

/**
 * A verification requires an environment. "It works" without saying where is
 * not evidence, so the field is required rather than optional.
 */
export function VerifyControl({ answerId, signedIn }: { answerId: number; signedIn: boolean }) {
  const [open, setOpen] = useState(false);
  const [result, setResult] = useState<'pass' | 'fail' | 'partial'>('pass');
  const [environment, setEnvironment] = useState('');
  const [notes, setNotes] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  if (!open) {
    return (
      <button
        type="button"
        className={styles.action}
        onClick={() => (signedIn ? setOpen(true) : toLogin())}
      >
        Reproduce
      </button>
    );
  }

  if (done) return <div className={styles.ok}>Recorded. Thank you — that is the part that makes this worth reading.</div>;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/v1/answers/${answerId}/verify`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ result, environment, notes }),
      });
      const json = await res.json();
      if (res.status === 401) return toLogin();
      if (!res.ok) {
        setError(json.errors?.[0]?.message ?? 'That could not be recorded.');
        setBusy(false);
        return;
      }
      setDone(true);
      setTimeout(() => window.location.reload(), 900);
    } catch {
      setError('Could not reach the server.');
      setBusy(false);
    }
  }

  return (
    <form className={styles.panel} onSubmit={submit}>
      <span className={styles.panelTitle}>Record a reproduction</span>
      <p className={styles.hint}>
        Only reproductions by someone independent of the author count toward the badge. Verifying
        your own answer is still recorded, and still labelled.
      </p>
      {error ? <div className={styles.err}>{error}</div> : null}
      <div className={styles.row}>
        <select
          className={styles.select}
          value={result}
          onChange={(e) => setResult(e.target.value as 'pass' | 'fail' | 'partial')}
          aria-label="Result"
        >
          <option value="pass">It worked</option>
          <option value="partial">Partly worked</option>
          <option value="fail">It did not work</option>
        </select>
        <input
          className={`${styles.input} ${styles.grow}`}
          value={environment}
          onChange={(e) => setEnvironment(e.target.value)}
          placeholder="bun 1.3.14 / ubuntu 24.04"
          aria-label="Environment"
          required
        />
      </div>
      <textarea
        className={styles.textarea}
        style={{ minHeight: 80 }}
        value={notes}
        onChange={(e) => setNotes(e.target.value)}
        placeholder="Anything that differed from the answer as written (optional)"
        aria-label="Notes"
      />
      <div className={styles.row}>
        <button className={styles.submit} type="submit" disabled={busy}>
          {busy ? 'Recording…' : 'Record it'}
        </button>
        <button type="button" className={styles.action} onClick={() => setOpen(false)}>
          Cancel
        </button>
      </div>
    </form>
  );
}

export function AnswerForm({ questionId, signedIn }: { questionId: number; signedIn: boolean }) {
  const [body, setBody] = useState('');
  const [validFrom, setValidFrom] = useState('');
  const [validThrough, setValidThrough] = useState('');
  const [findings, setFindings] = useState<{ kind: string; line: number; preview: string }[]>([]);
  const [ack, setAck] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!signedIn) {
    return (
      <div className={styles.panel}>
        <span className={styles.panelTitle}>Know the answer?</span>
        <p className={styles.hint}>
          <a href="/login">Sign in</a> to answer. No password — an emailed link, a passkey, or
          CoinPay.
        </p>
      </div>
    );
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/v1/questions/${questionId}/answers`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ body, validFrom, validThrough, acknowledgeSecrets: ack }),
      });
      const json = await res.json();
      if (res.status === 401) return toLogin();
      if (res.status === 409 && json.error === 'secrets_detected') {
        setFindings(json.findings ?? []);
        setBusy(false);
        return;
      }
      if (!res.ok) {
        setError(json.errors?.[0]?.message ?? 'That could not be published.');
        setBusy(false);
        return;
      }
      window.location.reload();
    } catch {
      setError('Could not reach the server.');
      setBusy(false);
    }
  }

  return (
    <form className={styles.panel} onSubmit={submit}>
      <span className={styles.panelTitle}>Your answer</span>
      <p className={styles.hint}>
        Say why it works, not only what to type. Declare the versions you know it holds for — an
        answer without them cannot go stale honestly.
      </p>
      {error ? <div className={styles.err}>{error}</div> : null}
      <textarea
        className={styles.textarea}
        value={body}
        onChange={(e) => {
          setBody(e.target.value);
          setAck(false);
        }}
        placeholder={'The client opens a native handle at module scope…\n\n    const client = createClient({ url, authToken });'}
        required
      />
      <div className={styles.row}>
        <input
          className={styles.input}
          style={{ maxWidth: 200 }}
          value={validFrom}
          onChange={(e) => setValidFrom(e.target.value)}
          placeholder="valid from e.g. bun 1.1"
          aria-label="Valid from"
        />
        <input
          className={styles.input}
          style={{ maxWidth: 200 }}
          value={validThrough}
          onChange={(e) => setValidThrough(e.target.value)}
          placeholder="valid through e.g. bun 1.3"
          aria-label="Valid through"
        />
      </div>
      {findings.length > 0 ? (
        <div className={styles.err}>
          <div>This looks like it contains credentials:</div>
          {findings.map((f, i) => (
            <div key={i} style={{ fontFamily: 'var(--font-mono)', fontSize: 12 }}>
              line {f.line} · {f.kind} · {f.preview}
            </div>
          ))}
          <label style={{ display: 'flex', gap: 8, marginTop: 6 }}>
            <input type="checkbox" checked={ack} onChange={(e) => setAck(e.target.checked)} />
            <span>Not live credentials. Publish anyway.</span>
          </label>
        </div>
      ) : null}
      <div className={styles.row}>
        <button className={styles.submit} type="submit" disabled={busy || (findings.length > 0 && !ack)}>
          {busy ? 'Publishing…' : 'Publish answer'}
        </button>
      </div>
    </form>
  );
}

export function CommentThread({
  contentType,
  contentId,
  comments,
  signedIn,
}: {
  contentType: 'question' | 'answer';
  contentId: number;
  comments: { body: string; author: string | null; created_at: string }[];
  signedIn: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [body, setBody] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await fetch('/v1/comments', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ contentType, contentId, body }),
      });
      const json = await res.json();
      if (res.status === 401) return toLogin();
      if (!res.ok) {
        setError(json.errors?.[0]?.message ?? (json.error === 'secrets_detected' ? 'That comment looks like it contains a credential.' : 'Not posted.'));
        setBusy(false);
        return;
      }
      window.location.reload();
    } catch {
      setError('Could not reach the server.');
      setBusy(false);
    }
  }

  return (
    <div className={styles.comments}>
      {comments.map((cm, i) => (
        <div key={i} className={styles.comment}>
          <span>{cm.body}</span>
          <span className={styles.commentMeta}>
            — <span className={styles.commentWho}>{cm.author ?? 'unknown'}</span>
          </span>
        </div>
      ))}
      {open ? (
        <form onSubmit={submit} style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {error ? <div className={styles.err}>{error}</div> : null}
          <input
            className={styles.input}
            value={body}
            onChange={(e) => setBody(e.target.value)}
            placeholder="Ask for a missing detail, or note something the answer got wrong"
            maxLength={1000}
            required
          />
          <div className={styles.row}>
            <button className={styles.submit} type="submit" disabled={busy}>
              {busy ? 'Posting…' : 'Comment'}
            </button>
            <button type="button" className={styles.action} onClick={() => setOpen(false)}>
              Cancel
            </button>
          </div>
        </form>
      ) : (
        <button type="button" className={styles.link} onClick={() => (signedIn ? setOpen(true) : toLogin())}>
          Add a comment
        </button>
      )}
    </div>
  );
}

const REASONS: { value: string; label: string }[] = [
  { value: 'secret', label: 'Contains a credential' },
  { value: 'spam', label: 'Spam' },
  { value: 'wrong', label: 'Dangerously wrong' },
  { value: 'abusive', label: 'Abusive' },
  { value: 'duplicate', label: 'Duplicate' },
  { value: 'other', label: 'Something else' },
];

/** Reporting is one click plus a reason; a reason is required so the queue is triageable. */
export function FlagControl({
  contentType,
  contentId,
  signedIn,
}: {
  contentType: 'question' | 'answer' | 'comment';
  contentId: number;
  signedIn: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState('secret');
  const [done, setDone] = useState(false);
  const [busy, setBusy] = useState(false);

  if (done) return <span className={styles.commentMeta}>Reported. Thank you.</span>;

  if (!open) {
    return (
      <button
        type="button"
        className={styles.link}
        onClick={() => (signedIn ? setOpen(true) : toLogin())}
      >
        Report
      </button>
    );
  }

  async function send(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      await fetch('/v1/flags', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ contentType, contentId, reason }),
      });
      setDone(true);
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className={styles.row} onSubmit={send}>
      <select
        className={styles.select}
        value={reason}
        onChange={(e) => setReason(e.target.value)}
        aria-label="Reason"
      >
        {REASONS.map((r) => (
          <option key={r.value} value={r.value}>
            {r.label}
          </option>
        ))}
      </select>
      <button className={styles.submit} type="submit" disabled={busy}>
        Report
      </button>
      <button type="button" className={styles.action} onClick={() => setOpen(false)}>
        Cancel
      </button>
    </form>
  );
}
