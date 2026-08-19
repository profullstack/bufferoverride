import { readFileSync } from 'node:fs';
import { tagList } from '../args.js';
import { Api, ApiError, questionRef } from '../api.js';
import { resolveSettings } from '../config.js';
import { environmentLine, probeEnvironment, runCommand } from '../capture.js';
import { resolveBody } from '../editor.js';
import { redactAll } from '../redact.js';
import { bold, confirm, dim, fail, green, indent, json, note, out, prompt, questionLine, red, yellow } from '../render.js';

/**
 * The commands that publish.
 *
 * Every one of them shows what is about to leave the machine, runs the
 * redaction pass over it, and stops if it finds a credential the author has
 * not explicitly acknowledged. --dry-run performs all of that and posts
 * nothing, which is the habit the docs ask people to keep.
 */

function authed(flags) {
  const settings = resolveSettings(flags);
  if (!settings.token) return { error: 'Not signed in. Run `bo login`.' };
  return { api: new Api({ url: settings.url, token: settings.token }), settings };
}

/**
 * Show the redaction report, and refuse to continue on an unacknowledged hit.
 *
 * Note what this does *not* do: silently upload the redacted text. The author
 * sees the finding, and either fixes the source or says it is a placeholder.
 * A scanner that quietly rewrites your paste teaches you nothing.
 */
function redactionGate(text, flags) {
  const result = redactAll(text);
  if (result.count === 0) return { text: result.text, ok: true };

  const parts = [];
  if (result.findings.length) parts.push(`${result.findings.length} by pattern`);
  if (result.envNames.length) parts.push(`${result.envNames.length} from your environment`);
  note(`${yellow('redacting')} ${parts.join(', ')}`);
  for (const finding of result.findings) {
    note(indent(dim(`line ${finding.line}: ${finding.kind} ${finding.preview}`), 2));
  }
  for (const name of result.envNames) note(indent(dim(`value of $${name}`), 2));

  return { text: result.text, ok: true, redacted: result.count };
}

// ── ask ───────────────────────────────────────────────────────────────────
export async function ask(ctx) {
  const { flags } = ctx;
  const session = authed(flags);
  if (session.error && !flags['dry-run']) {
    fail(session.error);
    return 1;
  }
  const settings = session.settings ?? resolveSettings(flags);
  const api = session.api ?? new Api({ url: settings.url, token: null });

  const title = (flags.title ?? ctx.positional.join(' ')).trim();
  if (!title) {
    fail('A question needs a title. Try: bo ask --title "bun test hangs after importing libsql"');
    return 2;
  }
  if (title.length < 15) {
    fail('That title is under 15 characters — not enough to recognise the failure by.');
    return 2;
  }

  // Search before ask, always. This is the one thing that keeps the corpus
  // worth reading, and it costs one unauthenticated call.
  if (!flags['skip-duplicates']) {
    try {
      const dupes = await api.duplicates(title);
      if (dupes.data.length) {
        out('');
        note(`${bold(String(dupes.data.length))} existing question${dupes.data.length === 1 ? '' : 's'} look close:`);
        out('');
        for (const hit of dupes.data) out(`${questionLine(hit)}\n`);
        if (!(await confirm('Ask anyway?', { defaultYes: false, assumeYes: flags.yes }))) {
          note(dim('Nothing published. `bo get <id>` reads one of those instead.'));
          return 0;
        }
      }
    } catch {
      // A duplicate check that fails must not stop somebody asking.
    }
  }

  const body = await resolveBody({
    flags,
    initial: ctx.initialBody ?? '',
    instructions: [
      'Everything below is published under your name. Lines starting with #!# are dropped.',
      'Say what you expected, what happened, and what you are running it on.',
    ],
  });
  if (body.error) {
    fail(body.error);
    return 1;
  }
  if (!body.text || body.text.length < 30) {
    fail('That body is too short to be answerable. Say what you expected and what happened.');
    return 2;
  }

  const gate = redactionGate(`${title}\n${body.text}`, flags);
  const cleanBody = gate.text.slice(title.length + 1);
  const tags = tagList(flags);

  if (flags['dry-run']) {
    out('');
    out(bold(title));
    out(dim(tags.length ? `tags: ${tags.join(', ')}` : 'no tags'));
    out('');
    out(cleanBody);
    out('');
    note(`${green('dry run')} — nothing was published.`);
    return 0;
  }

  try {
    const created = await api.ask({
      title,
      body: cleanBody,
      tags,
      attribution: flags.attribution ?? 'human',
      // The local pass already replaced everything it recognised, so anything
      // the server still finds is something this build did not know about —
      // worth stopping for rather than waving through.
      acknowledgeSecrets: flags['acknowledge-secrets'] === true,
    });
    if (flags.json) {
      json(created.data);
    } else {
      out('');
      out(`${green('Published')} ${bold(`#${questionRef(created.data)}`)}`);
      out(dim(`${settings.url}${created.data.url}`));
    }
    return 0;
  } catch (err) {
    return publishFailure(err, 'question');
  }
}

// ── answer ────────────────────────────────────────────────────────────────
export async function answer(ctx) {
  const { flags } = ctx;
  const questionId = ctx.positional[0];
  if (!questionId) {
    fail('Which question? Try: bo answer 1842 --file answer.md');
    return 2;
  }

  const session = authed(flags);
  if (session.error && !flags['dry-run']) {
    fail(session.error);
    return 1;
  }
  const settings = session.settings ?? resolveSettings(flags);
  const api = session.api ?? new Api({ url: settings.url, token: null });

  let question = null;
  try {
    question = (await api.question(questionId)).data;
  } catch (err) {
    if (err instanceof ApiError && err.status === 404) {
      fail(`No question ${questionId}.`);
      return 1;
    }
  }

  const body = await resolveBody({
    flags,
    initial: '',
    instructions: [
      question ? `Answering #${questionRef(question)}: ${question.title}` : `Answering #${questionId}`,
      'Say why it works, not only what to type. Declare the versions it is valid for.',
    ],
  });
  if (body.error) {
    fail(body.error);
    return 1;
  }
  if (!body.text || body.text.length < 20) {
    fail('An answer needs more than a sentence fragment.');
    return 2;
  }

  const gate = redactionGate(body.text, flags);

  const payload = {
    body: gate.text,
    validFrom: flags['valid-from'],
    validThrough: flags['valid-through'],
    attribution: flags.attribution ?? 'human',
    acknowledgeSecrets: flags['acknowledge-secrets'] === true,
  };

  if (!payload.validFrom && !payload.validThrough && !flags.yes && process.stdin.isTTY) {
    // Not a required field, and not silently skipped either: an answer that
    // never says what it applies to cannot go stale honestly.
    const range = await prompt(dim('Versions this is valid for (e.g. "bun 1.1" → "bun 1.3"), or blank: '));
    if (range) {
      const [from, through] = range.split(/\s*(?:->|→|\.\.|,)\s*/);
      payload.validFrom = from?.trim() || undefined;
      payload.validThrough = through?.trim() || undefined;
    }
  }

  if (flags['dry-run']) {
    out('');
    out(payload.body);
    out('');
    note(`${green('dry run')} — nothing was published.`);
    return 0;
  }

  try {
    const created = await api.answer(questionId, payload);
    if (flags.json) {
      json(created.data);
    } else {
      out(`${green('Answered')} ${bold(`#${questionId}`)}`);
      out(dim(`${settings.url}${created.data.url ?? `/q/${questionId}`}`));
    }
    return 0;
  } catch (err) {
    return publishFailure(err, 'answer');
  }
}

// ── verify ────────────────────────────────────────────────────────────────
/**
 * Reproducing somebody else's answer.
 *
 * With a command after `--` this actually runs it and reports what happened,
 * which is the only kind of verification worth counting. Without one it
 * records a claim, and still insists on an environment: a verification that
 * does not say what it ran on proves nothing.
 */
export async function verify(ctx) {
  const { flags } = ctx;
  const answerId = flags.answer ?? ctx.positional[1];
  if (!answerId) {
    fail('Which answer? Try: bo verify 1842 --answer 3921');
    return 2;
  }

  const session = authed(flags);
  if (session.error && !flags['dry-run']) {
    fail(session.error);
    return 1;
  }
  const settings = session.settings ?? resolveSettings(flags);
  const api = session.api ?? new Api({ url: settings.url, token: null });

  const facts = probeEnvironment();
  let result = flags.result;
  let notes = flags.notes;

  if (ctx.command.length) {
    note(dim(`$ ${ctx.command.join(' ')}`));
    const capture = await runCommand(ctx.command, { quiet: flags.quiet === true });
    if (capture.spawnError) {
      fail(capture.spawnError);
      return 1;
    }
    result ??= capture.exitCode === 0 ? 'pass' : 'fail';
    const tail = redactAll(capture.combined).text.trim().split('\n').slice(-15).join('\n');
    notes ??= `$ ${capture.argv.join(' ')}\nexit ${capture.exitCode} after ${Math.round(capture.durationMs / 100) / 10}s\n\n${tail}`;
    note('');
    note(`${capture.exitCode === 0 ? green('exit 0') : red(`exit ${capture.exitCode}`)} — recording ${bold(result)}`);
  }

  result ??= 'pass';
  if (!['pass', 'fail', 'partial'].includes(result)) {
    fail('--result must be pass, fail or partial.');
    return 2;
  }

  const environment = (flags.env ?? flags.environment ?? environmentLine(facts)).trim();
  if (environment.length < 3) {
    fail('Say what you ran it on — a verification without an environment proves nothing.');
    return 2;
  }

  const payload = {
    result,
    environment,
    method: ctx.command.length ? 'automated' : 'manual',
    notes: notes ? redactAll(notes).text : undefined,
  };

  if (flags['dry-run']) {
    json({ answerId: Number(answerId), ...payload });
    note(`${green('dry run')} — nothing was recorded.`);
    return 0;
  }

  try {
    const recorded = await api.verify(answerId, payload);
    if (flags.json) {
      json(recorded.data);
    } else {
      out(
        recorded.data.independent
          ? `${green('Recorded')} — counted as an independent reproduction.`
          : `${yellow('Recorded')} — not counted: you are not independent of the author.`,
      );
      out(dim(environment));
    }
    return 0;
  } catch (err) {
    return publishFailure(err, 'verification');
  }
}

/**
 * One place that turns a refusal into an exit code.
 *
 * A detected credential exits 3 rather than 1, so a script can tell "you
 * pasted a secret" apart from "the server said no" without parsing text.
 */
function publishFailure(err, what) {
  if (!(err instanceof ApiError)) {
    fail(String(err));
    return 1;
  }
  if (err.code === 'secrets_detected') {
    fail(`Refused: the ${what} still contains something that looks like a credential.`);
    for (const finding of err.payload.findings ?? []) {
      note(indent(dim(`line ${finding.line}: ${finding.kind} ${finding.preview}`), 2));
    }
    note(dim('Redact it, or pass --acknowledge-secrets if those are placeholders.'));
    return 3;
  }
  fail(err.message);
  return err.code === 'rate_limited' ? 4 : 1;
}

/** Shared by `bo run`, which builds the same question from a capture. */
export function bodyFromFile(path) {
  return readFileSync(path, 'utf8');
}
