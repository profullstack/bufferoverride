'use client';

import { useState } from 'react';
import { ArrowUpIcon, CheckIcon } from '@bufferoverride/ui';
import { renderMarkdown } from '@bufferoverride/core/markdown';
import { CopyMarkdown } from '../_components/copy-markdown.tsx';
import { MarkdownArea } from '../_components/markdown-area.tsx';
import markdown from '../_components/markdown.module.css';
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
      <MarkdownArea
        className={styles.textarea}
        value={body}
        ariaLabel="Your answer"
        onChange={(next) => {
          setBody(next);
          setAck(false);
        }}
        placeholder={'The client opens a native handle at module scope…\n\n```js\nconst client = createClient({ url, authToken });\n```'}
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

/**
 * One request against the edit half of the API, reduced to what a control needs.
 *
 * The server decides what a caller may touch; these components only decide what
 * to draw. Hiding a button is a courtesy to the owner, never the control — the
 * same PATCH from a console gets the same 403.
 */
async function send(
  url: string,
  method: 'PATCH' | 'DELETE',
  payload?: Record<string, unknown>,
): Promise<{ ok: true } | { ok: false; message: string }> {
  try {
    const res = await fetch(url, {
      method,
      ...(payload
        ? { headers: { 'content-type': 'application/json' }, body: JSON.stringify(payload) }
        : {}),
    });
    if (res.status === 401) {
      toLogin();
      return { ok: false, message: 'Sign in again.' };
    }
    if (res.ok) return { ok: true };
    const json = await res.json().catch(() => ({}));
    return {
      ok: false,
      message: json.errors?.[0]?.message ?? json.message ?? 'That could not be saved.',
    };
  } catch {
    return { ok: false, message: 'Could not reach the server.' };
  }
}

/**
 * The rendered body.
 *
 * Deliberately not the `Markdown` component the page uses: that one imports
 * `@bufferoverride/core`'s barrel, which reaches the rate limiter and from
 * there `@libsql/client`. Pulling a database driver into a browser bundle
 * fails the build with an error that names neither file. The `/markdown`
 * subpath is dependency-free precisely so client components can render the
 * same HTML the server does.
 */
function Body({ source }: { source: string }) {
  return <div className={markdown.md} dangerouslySetInnerHTML={{ __html: renderMarkdown(source) }} />;
}

/** A confirm() rather than a modal: withdrawing is rare, and undo is not offered. */
function confirmed(what: string): boolean {
  return window.confirm(`Withdraw this ${what}? It comes off the site. This cannot be undone here.`);
}

function Edited({ at }: { at: string | null }) {
  if (!at) return null;
  return <span className={styles.edited}>edited</span>;
}

/**
 * The question body, plus its author's own controls.
 *
 * The body renders here rather than on the page so that opening the editor can
 * replace it in place — an editor stacked under a copy of what you are editing
 * is how you end up fixing the wrong paragraph.
 */
export function EditableQuestion({
  code,
  title,
  body,
  tags,
  editedAt,
  canEdit,
}: {
  code: string;
  title: string;
  body: string;
  tags: string[];
  editedAt: string | null;
  canEdit: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [draftTitle, setDraftTitle] = useState(title);
  const [draft, setDraft] = useState(body);
  const [draftTags, setDraftTags] = useState(tags.join(', '));
  const [findings, setFindings] = useState<{ kind: string; line: number; preview: string }[]>([]);
  const [ack, setAck] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const res = await fetch(`/v1/questions/${code}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        title: draftTitle,
        body: draft,
        tags: draftTags.split(',').map((t) => t.trim()).filter(Boolean),
        acknowledgeSecrets: ack,
      }),
    });
    const json = await res.json().catch(() => ({}));
    if (res.status === 401) return toLogin();
    if (res.status === 409 && json.error === 'secrets_detected') {
      setFindings(json.findings ?? []);
      setBusy(false);
      return;
    }
    if (!res.ok) {
      setError(json.errors?.[0]?.message ?? json.message ?? 'That could not be saved.');
      setBusy(false);
      return;
    }
    // The title is in the URL slug and the <h1> above; a reload is the honest
    // way to show the whole page agreeing with what was just saved.
    window.location.href = json.data.url;
  }

  async function remove() {
    if (!confirmed('question')) return;
    setBusy(true);
    const res = await send(`/v1/questions/${code}`, 'DELETE');
    if (res.ok) {
      window.location.href = '/questions';
      return;
    }
    setError(res.message);
    setBusy(false);
  }

  if (!open) {
    return (
      <>
        <Body source={body} />
        {canEdit ? (
          <div className={styles.ownerBar}>
            <Edited at={editedAt} />
            <span className={styles.spacer} />
            {error ? <span className={styles.errInline}>{error}</span> : null}
            <button type="button" className={styles.action} onClick={() => setOpen(true)}>
              Edit
            </button>
            <button
              type="button"
              className={`${styles.action} ${styles.danger}`}
              onClick={remove}
              disabled={busy}
            >
              Delete
            </button>
          </div>
        ) : (
          <div className={styles.ownerBar}>
            <Edited at={editedAt} />
          </div>
        )}
      </>
    );
  }

  return (
    <form className={styles.panel} onSubmit={save}>
      <span className={styles.panelTitle}>Edit your question</span>
      <p className={styles.hint}>
        Every revision is kept and shown in the history. Correct it rather than deleting and
        reposting — the answers below are replies to this text.
      </p>
      {error ? <div className={styles.err}>{error}</div> : null}
      <input
        className={styles.input}
        value={draftTitle}
        onChange={(e) => setDraftTitle(e.target.value)}
        aria-label="Title"
        required
      />
      <MarkdownArea
        className={styles.textarea}
        value={draft}
        ariaLabel="Question body"
        onChange={(next) => {
          setDraft(next);
          setAck(false);
        }}
        required
      />
      <input
        className={styles.input}
        value={draftTags}
        onChange={(e) => setDraftTags(e.target.value)}
        placeholder="tags, comma separated"
        aria-label="Tags"
      />
      <SecretsNotice findings={findings} ack={ack} onAck={setAck} />
      <div className={styles.row}>
        <button className={styles.submit} type="submit" disabled={busy || (findings.length > 0 && !ack)}>
          {busy ? 'Saving…' : 'Save changes'}
        </button>
        <button type="button" className={styles.action} onClick={() => setOpen(false)}>
          Cancel
        </button>
      </div>
    </form>
  );
}

/** The same shape for an answer, plus the version range it claims to hold for. */
export function EditableAnswer({
  answerId,
  body,
  validFrom,
  validThrough,
  editedAt,
  verified,
  canEdit,
}: {
  answerId: number;
  body: string;
  validFrom: string | null;
  validThrough: string | null;
  editedAt: string | null;
  verified: number;
  canEdit: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState(body);
  const [from, setFrom] = useState(validFrom ?? '');
  const [through, setThrough] = useState(validThrough ?? '');
  const [findings, setFindings] = useState<{ kind: string; line: number; preview: string }[]>([]);
  const [ack, setAck] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const res = await fetch(`/v1/answers/${answerId}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        body: draft,
        validFrom: from,
        validThrough: through,
        acknowledgeSecrets: ack,
      }),
    });
    const json = await res.json().catch(() => ({}));
    if (res.status === 401) return toLogin();
    if (res.status === 409 && json.error === 'secrets_detected') {
      setFindings(json.findings ?? []);
      setBusy(false);
      return;
    }
    if (!res.ok) {
      setError(json.errors?.[0]?.message ?? json.message ?? 'That could not be saved.');
      setBusy(false);
      return;
    }
    window.location.reload();
  }

  async function remove() {
    if (!confirmed('answer')) return;
    setBusy(true);
    const res = await send(`/v1/answers/${answerId}`, 'DELETE');
    if (res.ok) {
      window.location.reload();
      return;
    }
    setError(res.message);
    setBusy(false);
  }

  if (!open) {
    return (
      <>
        <Body source={body} />
        {canEdit ? (
          <div className={styles.ownerBar}>
            <Edited at={editedAt} />
            <span className={styles.spacer} />
            {error ? <span className={styles.errInline}>{error}</span> : null}
            <button type="button" className={styles.action} onClick={() => setOpen(true)}>
              Edit
            </button>
            <button
              type="button"
              className={`${styles.action} ${styles.danger}`}
              onClick={remove}
              disabled={busy}
            >
              Delete
            </button>
          </div>
        ) : (
          <div className={styles.ownerBar}>
            <Edited at={editedAt} />
          </div>
        )}
      </>
    );
  }

  return (
    <form className={styles.panel} onSubmit={save}>
      <span className={styles.panelTitle}>Edit your answer</span>
      {verified > 0 ? (
        <p className={styles.hint}>
          {verified} {verified === 1 ? 'person has' : 'people have'} reproduced this in their own
          environment. Those runs stay on the record and the edit is timestamped, so a reader can
          see the text moved after them — rewrite it into something they did not test and that is
          what the page will say.
        </p>
      ) : (
        <p className={styles.hint}>
          Every revision is kept and shown in the history. Keep the version range honest.
        </p>
      )}
      {error ? <div className={styles.err}>{error}</div> : null}
      <MarkdownArea
        className={styles.textarea}
        value={draft}
        ariaLabel="Answer body"
        onChange={(next) => {
          setDraft(next);
          setAck(false);
        }}
        required
      />
      <div className={styles.row}>
        <input
          className={styles.input}
          style={{ maxWidth: 200 }}
          value={from}
          onChange={(e) => setFrom(e.target.value)}
          placeholder="valid from e.g. bun 1.1"
          aria-label="Valid from"
        />
        <input
          className={styles.input}
          style={{ maxWidth: 200 }}
          value={through}
          onChange={(e) => setThrough(e.target.value)}
          placeholder="valid through e.g. bun 1.3"
          aria-label="Valid through"
        />
      </div>
      <SecretsNotice findings={findings} ack={ack} onAck={setAck} />
      <div className={styles.row}>
        <button className={styles.submit} type="submit" disabled={busy || (findings.length > 0 && !ack)}>
          {busy ? 'Saving…' : 'Save changes'}
        </button>
        <button type="button" className={styles.action} onClick={() => setOpen(false)}>
          Cancel
        </button>
      </div>
    </form>
  );
}

/** What the scanner found, and the one checkbox that overrides it. */
function SecretsNotice({
  findings,
  ack,
  onAck,
}: {
  findings: { kind: string; line: number; preview: string }[];
  ack: boolean;
  onAck: (next: boolean) => void;
}) {
  if (!findings.length) return null;
  return (
    <div className={styles.err}>
      <div>This looks like it contains credentials:</div>
      {findings.map((f, i) => (
        <div key={i} style={{ fontFamily: 'var(--font-mono)', fontSize: 12 }}>
          line {f.line} · {f.kind} · {f.preview}
        </div>
      ))}
      <label style={{ display: 'flex', gap: 8, marginTop: 6 }}>
        <input type="checkbox" checked={ack} onChange={(e) => onAck(e.target.checked)} />
        <span>Not live credentials. Publish anyway.</span>
      </label>
    </div>
  );
}

/** One comment, with its author's controls folded into the same line. */
function Comment({ comment }: { comment: ThreadComment }) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState(comment.body);
  const [body, setBody] = useState(comment.body);
  const [gone, setGone] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (gone) return null;

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const res = await send(`/v1/comments/${comment.id}`, 'PATCH', { body: draft });
    setBusy(false);
    if (!res.ok) return setError(res.message);
    setBody(draft);
    setOpen(false);
  }

  async function remove() {
    if (!confirmed('comment')) return;
    setBusy(true);
    const res = await send(`/v1/comments/${comment.id}`, 'DELETE');
    setBusy(false);
    if (!res.ok) return setError(res.message);
    setGone(true);
  }

  if (open) {
    return (
      <form className={styles.comment} onSubmit={save} style={{ width: '100%' }}>
        <input
          className={`${styles.input} ${styles.grow}`}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          maxLength={1000}
          aria-label="Edit comment"
          required
        />
        <button className={styles.submit} type="submit" disabled={busy}>
          {busy ? 'Saving…' : 'Save'}
        </button>
        <button
          type="button"
          className={styles.action}
          onClick={() => {
            setDraft(body);
            setOpen(false);
          }}
        >
          Cancel
        </button>
        {error ? <span className={styles.errInline}>{error}</span> : null}
      </form>
    );
  }

  return (
    <div className={styles.comment}>
      <span
        className={`${markdown.md} ${styles.commentBody}`}
        dangerouslySetInnerHTML={{ __html: renderMarkdown(body) }}
      />
      <span className={styles.commentMeta}>
        — <span className={styles.commentWho}>{comment.author ?? 'unknown'}</span>
        {comment.edited_at || body !== comment.body ? ' (edited)' : ''}
      </span>
      <CopyMarkdown source={body} html={renderMarkdown(body)} label="copy" />
      {comment.mine ? (
        <>
          <button type="button" className={styles.link} onClick={() => setOpen(true)}>
            edit
          </button>
          <button type="button" className={styles.link} onClick={remove} disabled={busy}>
            delete
          </button>
        </>
      ) : null}
      {error ? <span className={styles.errInline}>{error}</span> : null}
    </div>
  );
}

export type ThreadComment = {
  id: number;
  body: string;
  author: string | null;
  created_at: string;
  edited_at: string | null;
  /** Whether this viewer may revise or withdraw it. Decided on the server. */
  mine: boolean;
};

export function CommentThread({
  contentType,
  contentId,
  comments,
  signedIn,
}: {
  contentType: 'question' | 'answer';
  contentId: number;
  comments: ThreadComment[];
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
      {comments.map((cm) => (
        <Comment key={cm.id} comment={cm} />
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

/**
 * Challenging the canonical answer marks it stale immediately.
 *
 * That is deliberate: "someone competent says this is wrong" is information a
 * reader needs before anyone has adjudicated, not after.
 */
export function ChallengeControl({ questionId, signedIn }: { questionId: number; signedIn: boolean }) {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!open) {
    return (
      <button
        type="button"
        className={styles.action}
        onClick={() => (signedIn ? setOpen(true) : toLogin())}
      >
        Challenge
      </button>
    );
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/v1/questions/${questionId}/canonical/challenge`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ reason }),
      });
      const json = await res.json();
      if (!res.ok) {
        setError(json.errors?.[0]?.message ?? 'That could not be filed.');
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
      <span className={styles.panelTitle}>What is wrong with it?</span>
      <p className={styles.hint}>
        This marks the canonical answer stale straight away, so say which version it stopped being
        true for if you know.
      </p>
      {error ? <div className={styles.err}>{error}</div> : null}
      <textarea
        className={styles.textarea}
        style={{ minHeight: 90 }}
        value={reason}
        onChange={(e) => setReason(e.target.value)}
        placeholder="No longer true from bun 1.4 — teardown ordering changed again and the handle survives."
        required
      />
      <div className={styles.row}>
        <button className={styles.submit} type="submit" disabled={busy}>
          {busy ? 'Filing…' : 'Mark it stale'}
        </button>
        <button type="button" className={styles.action} onClick={() => setOpen(false)}>
          Cancel
        </button>
      </div>
    </form>
  );
}

/** Synthesise or revise the canonical answer. Every save is a new revision. */
export function CanonicalEditor({
  questionId,
  current,
  canEdit,
}: {
  questionId: number;
  current: { body: string; works_with: string | null; known_exceptions: string | null } | null;
  canEdit: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [body, setBody] = useState(current?.body ?? '');
  const [worksWith, setWorksWith] = useState(current?.works_with ?? '');
  const [exceptions, setExceptions] = useState(current?.known_exceptions ?? '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!canEdit) return null;

  if (!open) {
    return (
      <button type="button" className={styles.action} onClick={() => setOpen(true)}>
        {current ? 'Revise' : 'Write the canonical answer'}
      </button>
    );
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/v1/questions/${questionId}/canonical`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ body, worksWith, knownExceptions: exceptions }),
      });
      const json = await res.json();
      if (!res.ok) {
        setError(
          json.errors?.[0]?.message ??
            (json.error === 'secrets_detected' ? 'That text contains a credential.' : 'Not saved.'),
        );
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
      <span className={styles.panelTitle}>Canonical answer</span>
      <p className={styles.hint}>
        Write what is true now, for whoever arrives next. Every save is a new revision and nothing
        below it is rewritten.
      </p>
      {error ? <div className={styles.err}>{error}</div> : null}
      <MarkdownArea
        className={styles.textarea}
        value={body}
        ariaLabel="Canonical answer"
        onChange={setBody}
        placeholder="The direct answer, in two to five sentences."
        required
      />
      <input
        className={styles.input}
        value={worksWith}
        onChange={(e) => setWorksWith(e.target.value)}
        placeholder="Works with: bun 1.1–1.3, ubuntu 24.04, libSQL 0.15+"
      />
      <input
        className={styles.input}
        value={exceptions}
        onChange={(e) => setExceptions(e.target.value)}
        placeholder="Known exceptions (optional)"
      />
      <div className={styles.row}>
        <button className={styles.submit} type="submit" disabled={busy}>
          {busy ? 'Saving…' : 'Save revision'}
        </button>
        <button type="button" className={styles.action} onClick={() => setOpen(false)}>
          Cancel
        </button>
      </div>
    </form>
  );
}
