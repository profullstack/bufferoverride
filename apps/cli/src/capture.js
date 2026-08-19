import { spawn } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { arch, platform, release } from 'node:os';
import { join } from 'node:path';
import { redactAll } from './redact.js';

/**
 * Capturing a failure.
 *
 * The command runs attached to the real terminal's output so the user watches
 * it fail as usual, and every byte is kept alongside. Nothing is uploaded from
 * here: this module produces a capture object, and the caller decides what to
 * do with it after the user has seen it.
 */

const MAX_STREAM = 200_000;

/** Keep the tail. A failure's evidence is at the end, and the head is boilerplate. */
function tail(chunks, limit = MAX_STREAM) {
  const text = chunks.join('');
  if (text.length <= limit) return { text, truncated: false };
  return { text: text.slice(-limit), truncated: true };
}

export function runCommand(argv, { cwd = process.cwd(), quiet = false } = {}) {
  return new Promise((resolve) => {
    const started = Date.now();
    const child = spawn(argv[0], argv.slice(1), {
      cwd,
      // No shell: the argv came from after `--` and is already split the way
      // the user's own shell split it. Re-interpreting it would change what
      // runs, and quoting bugs there are impossible to explain.
      shell: false,
      stdio: ['inherit', 'pipe', 'pipe'],
    });

    const stdout = [];
    const stderr = [];
    const combined = [];

    child.stdout.on('data', (chunk) => {
      stdout.push(chunk.toString());
      combined.push(chunk.toString());
      if (!quiet) process.stdout.write(chunk);
    });
    child.stderr.on('data', (chunk) => {
      stderr.push(chunk.toString());
      combined.push(chunk.toString());
      if (!quiet) process.stderr.write(chunk);
    });

    child.on('error', (err) => {
      resolve({
        argv,
        cwd,
        spawnError: err.code === 'ENOENT' ? `command not found: ${argv[0]}` : err.message,
        exitCode: 127,
        signal: null,
        durationMs: Date.now() - started,
        stdout: '',
        stderr: '',
        combined: '',
        truncated: false,
      });
    });

    child.on('close', (code, signal) => {
      const all = tail(combined);
      resolve({
        argv,
        cwd,
        spawnError: null,
        exitCode: code ?? (signal ? 128 : 0),
        signal,
        durationMs: Date.now() - started,
        stdout: tail(stdout).text,
        stderr: tail(stderr).text,
        combined: all.text,
        truncated: all.truncated,
      });
    });
  });
}

// ── environment ───────────────────────────────────────────────────────────

function readJson(path) {
  try {
    return JSON.parse(readFileSync(path, 'utf8'));
  } catch {
    return null;
  }
}

/**
 * What the failure happened on.
 *
 * Runtime versions come from the process and from manifests on disk rather
 * than by shelling out to every tool that might be installed: probing is slow,
 * and a version that is *declared* by the project is more useful in an answer
 * than whatever happens to be first on PATH.
 */
export function probeEnvironment(cwd = process.cwd()) {
  const facts = {
    os: `${platform()} ${release()}`,
    arch: arch(),
    node: process.versions.node,
  };

  if (process.versions.bun) facts.bun = process.versions.bun;
  if (process.versions.deno) facts.deno = process.versions.deno;

  const pkg = readJson(join(cwd, 'package.json'));
  if (pkg) {
    facts.packageManager = pkg.packageManager ?? detectPackageManager(cwd);
    const deps = { ...(pkg.dependencies ?? {}), ...(pkg.devDependencies ?? {}) };
    const interesting = Object.entries(deps).slice(0, 40);
    if (interesting.length) facts.dependencies = Object.fromEntries(interesting);
  }

  for (const [file, key] of [
    ['pyproject.toml', 'python'],
    ['Cargo.toml', 'rust'],
    ['go.mod', 'go'],
  ]) {
    if (existsSync(join(cwd, file))) facts[`${key}Project`] = file;
  }

  return facts;
}

function detectPackageManager(cwd) {
  if (existsSync(join(cwd, 'pnpm-lock.yaml'))) return 'pnpm';
  if (existsSync(join(cwd, 'bun.lockb')) || existsSync(join(cwd, 'bun.lock'))) return 'bun';
  if (existsSync(join(cwd, 'yarn.lock'))) return 'yarn';
  if (existsSync(join(cwd, 'package-lock.json'))) return 'npm';
  return null;
}

/** One line, for the `environment` field of a verification. */
export function environmentLine(facts) {
  const parts = [facts.os, facts.arch, `node ${facts.node}`];
  if (facts.bun) parts.push(`bun ${facts.bun}`);
  if (facts.deno) parts.push(`deno ${facts.deno}`);
  if (facts.packageManager) parts.push(String(facts.packageManager));
  return parts.join(' · ');
}

// ── the search signature ──────────────────────────────────────────────────

const ERROR_LINE =
  /(?:^|\s)(?:error|fatal|exception|panic|traceback|assertion|failed|failure|cannot|could not|unexpected|unhandled|refused|denied|timeout|segmentation fault)\b/i;

const NOISE = [
  [/\b[0-9a-f]{7,}\b/gi, ''], // hashes, addresses
  [/\b\d+(?:\.\d+)+\b/g, ''], // version numbers: they belong in the fields, not the query
  [/(?:\/[\w.@+-]+){2,}/g, ''], // absolute paths, which are unique to one machine
  [/[a-z]:\\[^\s:]+/gi, ''],
  [/:\d+(?::\d+)?\b/g, ''], // line:column
  [/\d+/g, ''],
  [/\s+/g, ' '],
];

/**
 * Turn captured output into something worth searching for.
 *
 * The first line that reads like an error, stripped of everything unique to
 * this machine and this run — paths, hashes, line numbers, timings. What is
 * left is the part another person would also have seen.
 */
export function errorSignature(capture) {
  const source = `${capture.stderr}\n${capture.stdout}`;
  const lines = source.split('\n').map((l) => l.trim()).filter(Boolean);

  const candidates = lines.filter((line) => ERROR_LINE.test(line));
  const chosen = candidates[0] ?? lines[lines.length - 1] ?? '';

  let cleaned = chosen.replace(/^\W+/, '');
  for (const [re, to] of NOISE) cleaned = cleaned.replace(re, to);
  cleaned = cleaned.replace(/\s{2,}/g, ' ').trim();

  // A signature of two words finds everything, which is the same as finding
  // nothing; fall back to the raw line rather than searching for "error".
  const words = cleaned.split(' ').filter((w) => w.length > 2);
  if (words.length < 3) return chosen.slice(0, 160);
  return words.slice(0, 14).join(' ').slice(0, 160);
}

/**
 * The markdown body a question starts from, for the editor or for --yes.
 *
 * The command line is redacted too, not just the output. `curl -H
 * "Authorization: Bearer …"` and `PGPASSWORD=… psql` put the credential in
 * argv, where a reader of the published question would find it sitting in the
 * "What I ran" block — the one part nobody thinks to check.
 */
export function captureToMarkdown(capture, facts, redacted) {
  const command = redactAll(capture.argv.join(' ')).text;
  const lines = [
    '## What I ran',
    '',
    '```',
    `$ ${command}`,
    '```',
    '',
    '## What happened',
    '',
    `Exit code ${capture.exitCode}${capture.signal ? ` (signal ${capture.signal})` : ''}.`,
    '',
    '```',
    (redacted ?? capture.combined).trim().split('\n').slice(-60).join('\n') || '(no output)',
    '```',
    '',
    '## What I expected',
    '',
    '<!-- Replace this line: what should have happened instead? -->',
    '',
    '## Environment',
    '',
    '```',
    environmentLine(facts),
    '```',
  ];
  if (facts.dependencies) {
    const named = Object.entries(facts.dependencies)
      .slice(0, 12)
      .map(([name, version]) => `${name} ${version}`)
      .join('\n');
    lines.push('', '<details><summary>Declared dependencies</summary>', '', '```', named, '```', '', '</details>');
  }
  if (capture.truncated) {
    lines.push('', '_Output was truncated to the last 200 KB._');
  }
  return lines.join('\n');
}
