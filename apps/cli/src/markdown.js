import { spawn } from 'node:child_process';
import { blue, bold, dim, green } from './render.js';

/**
 * Markdown in a terminal.
 *
 * Bodies are markdown, and until now `bo get` printed the source: a fenced
 * block arrived as a row of backticks and a link as punctuation. This renders
 * the same document for a terminal — bold is bold, a fence is an indented
 * block, and a link keeps its href because a URL you cannot see is a URL you
 * cannot follow.
 *
 * Nothing here is styling for its own sake. Colour is already opt-out three
 * ways in render.js, and when it is off every function below degrades to plain
 * text that is still correctly structured, because the common case for this
 * output is a pipe into a file, a pager, or another agent's context.
 */

/** A link keeps its href beside the label: terminals that autolink make it
    clickable, and the ones that do not still show something you can copy. */
function link(label, url) {
  if (!url) return label;
  if (label === url) return blue(url);
  return `${label} ${dim(`(${blue(url)})`)}`;
}

function inline(text) {
  const spans = [];
  let s = String(text).replace(/(`+)([\s\S]*?)\1/g, (_m, _t, code) => {
    spans.push(green(code.replace(/^ | $/g, '')));
    return `\u0000${spans.length - 1}\u0000`;
  });

  s = s.replace(/!\[([^\]]*)\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g, (_m, alt, src) =>
    link(dim(`[image${alt ? `: ${alt}` : ''}]`), src),
  );
  s = s.replace(/\[([^\]]+)\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g, (_m, label, href) => link(label, href));

  s = s
    .replace(/\*\*\*([^*]+)\*\*\*/g, (_m, t) => bold(t))
    .replace(/\*\*([^*]+)\*\*/g, (_m, t) => bold(t))
    .replace(/(^|[^*\w])\*([^*\n]+)\*(?![*\w])/g, (_m, lead, t) => `${lead}${bold(t)}`)
    .replace(/(^|[^_\w])__([^_\n]+)__(?![_\w])/g, (_m, lead, t) => `${lead}${bold(t)}`)
    .replace(/~~([^~\n]+)~~/g, (_m, t) => dim(t));

  return s.replace(/\u0000(\d+)\u0000/g, (_m, i) => spans[Number(i)]);
}

/**
 * Renders a markdown body as terminal text.
 *
 * Line-oriented, like the web renderer, and for the same reason: the dialect
 * is small and every branch maps to something someone typed.
 */
export function renderTerminal(source, { width = 0 } = {}) {
  const lines = String(source ?? '')
    .replace(/\r\n?/g, '\n')
    .split('\n');
  const out = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];

    const fence = /^ {0,3}(`{3,}|~{3,})\s*([^\s`]*)/.exec(line);
    if (fence) {
      const marker = fence[1][0];
      const lang = fence[2];
      const body = [];
      i += 1;
      while (i < lines.length && !new RegExp(`^ {0,3}\\${marker}{3,}\\s*$`).test(lines[i])) {
        body.push(lines[i]);
        i += 1;
      }
      i += 1;
      if (lang) out.push(dim(`  ${lang}`));
      for (const b of body) out.push(`  ${green(b)}`);
      out.push('');
      continue;
    }

    const heading = /^ {0,3}(#{1,6})\s+(.*?)\s*#*\s*$/.exec(line);
    if (heading) {
      // A heading opens a section, but the first line of the body opens
      // nothing — a leading blank there is just a wasted row of terminal.
      if (out.length && out[out.length - 1] !== '') out.push('');
      out.push(bold(inline(heading[2])));
      out.push('');
      i += 1;
      continue;
    }

    if (/^ {0,3}(-\s*-\s*-|\*\s*\*\s*\*|_\s*_\s*_)[-*_\s]*$/.test(line)) {
      out.push(dim('─'.repeat(Math.min(width || process.stdout.columns || 72, 72))));
      i += 1;
      continue;
    }

    if (/^ {0,3}>/.test(line)) {
      out.push(`${dim('│')} ${inline(line.replace(/^ {0,3}>\s?/, ''))}`);
      i += 1;
      continue;
    }

    const bullet = /^( *)([-*+]|\d{1,9}[.)])\s+(.*)$/.exec(line);
    if (bullet) {
      const depth = Math.floor(bullet[1].length / 2);
      const marker = /\d/.test(bullet[2]) ? bullet[2] : '•';
      const task = /^\[([ xX])\]\s+([\s\S]*)$/.exec(bullet[3]);
      const text = task ? task[2] : bullet[3];
      const box = task ? (task[1].toLowerCase() === 'x' ? `${green('[x]')} ` : '[ ] ') : '';
      out.push(`${'  '.repeat(depth + 1)}${dim(marker)} ${box}${inline(text)}`);
      i += 1;
      continue;
    }

    if (!line.trim()) {
      if (out.length && out[out.length - 1] !== '') out.push('');
      i += 1;
      continue;
    }

    out.push(inline(line));
    i += 1;
  }

  while (out.length && out[out.length - 1] === '') out.pop();
  return out.join('\n');
}

/**
 * Assembles a question and its answers as one markdown document.
 *
 * This is what `--markdown` prints and what `--copy` puts on the clipboard.
 * It is a document rather than a transcript of the screen: someone lifting an
 * answer is moving it into an issue, a PR or another agent's context, and
 * headings and fences are what make it land there intact.
 */
export function questionToMarkdown(question, { url } = {}) {
  const lines = [];
  lines.push(`# ${question.title}`);
  lines.push('');
  const facts = [
    `asked by ${question.author ?? 'unknown'}`,
    String(question.created_at ?? '').slice(0, 10),
    question.attribution,
  ].filter(Boolean);
  lines.push(`*${facts.join(' · ')}*`);
  if (url) {
    lines.push('');
    lines.push(`<${url}>`);
  }
  lines.push('');
  lines.push(String(question.body ?? '').trim());

  const answers = question.answers ?? [];
  for (const answer of answers) {
    const badges = [];
    if (answer.is_accepted) badges.push('accepted');
    if (answer.verified_count > 0) badges.push(`verified ${answer.verified_count}x`);
    if (answer.is_stale) badges.push('stale');
    if (answer.valid_from || answer.valid_through) {
      badges.push([answer.valid_from, answer.valid_through].filter(Boolean).join(' – '));
    }
    badges.push(`by ${answer.author ?? 'unknown'}`);
    lines.push('');
    lines.push(`## Answer ${answer.id}`);
    lines.push('');
    lines.push(`*${badges.filter(Boolean).join(' · ')}*`);
    lines.push('');
    lines.push(String(answer.body ?? '').trim());
  }

  lines.push('');
  return `${lines.join('\n').replace(/\n{3,}/g, '\n\n').trim()}\n`;
}

/**
 * The platform clipboard, when there is one.
 *
 * There is no portable way to do this and no dependency worth taking for it,
 * so we try the tool each platform actually ships and report honestly when
 * none is present — a copy that silently does nothing is worse than a message
 * saying to pipe the output somewhere.
 */
const CLIPBOARDS = [
  { cmd: 'pbcopy', args: [] },
  { cmd: 'wl-copy', args: [] },
  { cmd: 'xclip', args: ['-selection', 'clipboard'] },
  { cmd: 'xsel', args: ['--clipboard', '--input'] },
  { cmd: 'clip.exe', args: [] },
];

export async function copyToClipboard(text) {
  for (const { cmd, args } of CLIPBOARDS) {
    const ok = await tryCopy(cmd, args, text);
    if (ok) return cmd;
  }
  return null;
}

function tryCopy(cmd, args, text) {
  return new Promise((resolve) => {
    let child;
    try {
      child = spawn(cmd, args, { stdio: ['pipe', 'ignore', 'ignore'] });
    } catch {
      return resolve(false);
    }
    child.on('error', () => resolve(false));
    child.on('close', (code) => resolve(code === 0));
    child.stdin.on('error', () => resolve(false));
    child.stdin.end(text);
  });
}
