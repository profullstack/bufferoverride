import { Api, ApiError } from '../api.js';
import { resolveSettings } from '../config.js';
import {
  captureToMarkdown,
  environmentLine,
  errorSignature,
  probeEnvironment,
  runCommand,
} from '../capture.js';
import { redactAll } from '../redact.js';
import { bold, dim, fail, green, indent, json, note, out, prompt, questionLine, red, truncate, yellow } from '../render.js';
import { ask } from './write.js';

/**
 * `bo run -- <command>`
 *
 * Run the thing that is failing, keep what it printed, strip what should not
 * leave the machine, and look for the answer that already exists. Nothing is
 * uploaded here. The capture is shown, the matches are shown, and then the
 * user decides — which is the whole reason this command exists rather than a
 * "report a bug" button that posts your terminal to the internet.
 */
export async function run(ctx) {
  const { flags } = ctx;

  if (!ctx.command.length) {
    fail('Nothing to run. Put the command after --, e.g. bo run -- bun test');
    return 2;
  }

  const settings = resolveSettings(flags);
  const api = new Api({ url: settings.url, token: settings.token });

  // Under --json stdout belongs to the report, so the child's own output is
  // captured without being echoed: a caller piping this into jq must not have
  // the wrapped command's stdout spliced into the middle of the JSON.
  const capture = await runCommand(ctx.command, { quiet: flags.quiet === true || flags.json === true });
  if (capture.spawnError) {
    fail(capture.spawnError);
    return 127;
  }

  const facts = probeEnvironment(capture.cwd);
  const redaction = redactAll(capture.combined);
  const signature = errorSignature({ ...capture, combined: redaction.text });

  // A command that succeeded has nothing to ask about. Say so and pass its
  // exit code through, so `bo run --` can wrap a command in a script.
  if (capture.exitCode === 0 && !flags.force) {
    if (flags.json) json({ command: capture.argv, exitCode: 0, matches: [], note: 'nothing to report' });
    else note(`${green('exit 0')} — nothing to report.`);
    return 0;
  }

  // Everything below narrates to the human. Under --json none of it is
  // printed: stdout carries the report and nothing else.
  const say = flags.json ? () => {} : out;

  say('');
  say(`  ${red(`exit ${capture.exitCode}`)}${capture.signal ? ` (${capture.signal})` : ''} after ${Math.round(capture.durationMs / 100) / 10}s`);

  if (redaction.count) {
    const parts = [];
    if (redaction.findings.length) parts.push(`${redaction.findings.length} by pattern`);
    if (redaction.envNames.length) parts.push(`${redaction.envNames.length} from your environment`);
    say(`  ${yellow('redacting output')} ... ${parts.join(', ')} removed`);
    for (const finding of redaction.findings) {
      say(indent(dim(`line ${finding.line}: ${finding.kind} ${finding.preview}`), 4));
    }
    for (const name of redaction.envNames) say(indent(dim(`value of $${name}`), 4));
  } else {
    say(`  ${dim('redacting output ... nothing matched')}`);
  }

  let matches = [];
  if (signature) {
    try {
      const found = await api.search(signature, 5);
      matches = found.data ?? [];
      say(
        `  ${dim('searching bufferoverride ...')} ${matches.length ? `${matches.length} close match${matches.length === 1 ? '' : 'es'}` : 'nothing close'}`,
      );
    } catch (err) {
      say(`  ${dim('searching bufferoverride ...')} ${yellow(err instanceof ApiError ? err.code : 'unavailable')}`);
    }
  }

  say('');
  for (const hit of matches) say(`${questionLine(hit)}\n`);

  const body = captureToMarkdown(capture, facts, redaction.text);

  if (flags.json) {
    json({
      command: capture.argv,
      exitCode: capture.exitCode,
      signal: capture.signal,
      durationMs: capture.durationMs,
      environment: facts,
      signature,
      redacted: { patterns: redaction.findings, environmentVariables: redaction.envNames },
      output: redaction.text,
      matches,
      body,
    });
    return capture.exitCode;
  }

  say(dim(`  ${environmentLine(facts)}`));
  say('');

  if (flags['dry-run']) {
    note(`${green('dry run')} — nothing was published.`);
    note(dim(`Search used: ${truncate(signature, 70)}`));
    return capture.exitCode;
  }

  // Non-interactive and not told what to do: stop here rather than guess. A
  // capture posted by a CI job nobody watched is exactly the kind of noise
  // this site is meant not to accumulate.
  if (!process.stdin.isTTY && !flags.ask) {
    note(dim('Not a terminal; nothing published. Pass --ask to publish, --json to pipe the capture.'));
    return capture.exitCode;
  }

  if (!flags.ask) {
    const choice = (
      await prompt(`  ${bold('[a]')}sk about this · ${bold('[o]')}pen a match · ${bold('[q]')}uit  `, { fallback: 'q' })
    ).toLowerCase();

    if (choice.startsWith('o')) {
      const which = matches.length === 1 ? matches[0] : null;
      const id =
        which?.id ?? (await prompt(`  which id? ${dim(matches.map((m) => m.id).join(' '))} `));
      if (id) {
        const { get } = await import('./read.js');
        return get({ ...ctx, positional: [String(id)], flags: { ...flags } });
      }
      return capture.exitCode;
    }
    if (!choice.startsWith('a')) return capture.exitCode;
  }

  if (!settings.token) {
    fail('Not signed in, so this cannot be published. Run `bo login`.');
    return 1;
  }

  const title = flags.title ?? (await prompt('  title: ')) ?? '';
  if (!title.trim()) {
    fail('No title, nothing published.');
    return 1;
  }

  return ask({
    ...ctx,
    positional: [],
    flags: { ...flags, title, 'skip-duplicates': true },
    initialBody: body,
  });
}
