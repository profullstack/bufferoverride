import { Api, ApiError } from '../api.js';
import { resolveSettings } from '../config.js';
import { bold, dim, fail, green, indent, json, note, out, questionLine, truncate, yellow } from '../render.js';
import { copyToClipboard, questionToMarkdown, renderTerminal } from '../markdown.js';

/** Reads need no credential, so these commands work before `bo login`. */
function client(flags) {
  const settings = resolveSettings(flags);
  return { api: new Api({ url: settings.url, token: settings.token }), settings };
}

export async function search(ctx) {
  const query = ctx.positional.join(' ').trim();
  if (!query) {
    fail('Nothing to search for. Try: bo search "worker exited before finishing"');
    return 2;
  }

  const { api, settings } = client(ctx.flags);
  const limit = Math.min(Number(ctx.flags.limit ?? 10) || 10, 50);

  let result;
  try {
    result = await api.search(query, limit);
  } catch (err) {
    fail(err instanceof ApiError ? err.message : String(err));
    return 1;
  }

  if (ctx.flags.json) {
    json(result);
    return result.data.length ? 0 : 1;
  }

  if (!result.data.length) {
    out(`No match for ${bold(truncate(query, 60))}.`);
    out(dim('Nobody has asked this yet. `bo ask` publishes it.'));
    return 1;
  }

  out('');
  for (const hit of result.data) out(`${questionLine(hit)}\n`);
  out(dim(`${settings.url}/search?q=${encodeURIComponent(query)}`));
  return 0;
}

export async function get(ctx) {
  const id = ctx.positional[0];
  if (!id) {
    fail('Which question? Try: bo get 1842');
    return 2;
  }

  const { api, settings } = client(ctx.flags);
  let result;
  try {
    result = await api.question(id);
  } catch (err) {
    if (err instanceof ApiError && err.status === 404) {
      fail(`No question ${id}.`);
      return 1;
    }
    fail(err instanceof ApiError ? err.message : String(err));
    return 1;
  }

  const question = result.data;
  if (ctx.flags.json) {
    json(question);
    return 0;
  }

  const pageUrl = `${settings.url}/q/${question.code ?? question.id}/${question.slug}`;

  // The whole thread as markdown: printed for a pipe, or put on the clipboard.
  if (ctx.flags.markdown || ctx.flags.copy) {
    const document = questionToMarkdown(question, { url: pageUrl });
    if (ctx.flags.copy) {
      const via = await copyToClipboard(document);
      if (via) {
        note(dim(`Copied as markdown (${via}).`));
        return 0;
      }
      note(yellow('No clipboard tool found — printing instead.'));
      note(dim('Install one of pbcopy, wl-copy, xclip, xsel, or pipe --markdown yourself.'));
    }
    process.stdout.write(document);
    return 0;
  }

  out('');
  out(bold(`#${question.id} ${question.title}`));
  out(dim(`asked by ${question.author} · ${String(question.created_at).slice(0, 10)} · ${question.attribution}`));
  out('');
  out(renderTerminal(question.body));
  out('');

  const answers = question.answers ?? [];
  if (!answers.length) {
    out(yellow('No answers yet.'));
    out(dim(`bo answer ${question.id} --file answer.md`));
  }

  for (const answer of answers) {
    const badges = [];
    if (answer.is_accepted) badges.push(green('accepted'));
    if (answer.verified_count > 0) badges.push(green(`verified ${answer.verified_count}x`));
    if (answer.is_stale) badges.push(yellow('stale'));
    if (answer.valid_from || answer.valid_through) {
      badges.push([answer.valid_from, answer.valid_through].filter(Boolean).join(' - '));
    }
    badges.push(`by ${answer.author}`, answer.attribution);

    out(dim('─'.repeat(Math.min(process.stdout.columns || 72, 72))));
    out(`${bold(`answer ${answer.id}`)} ${dim(badges.join(' · '))}`);
    out('');
    out(indent(renderTerminal(answer.body), 2));
    out('');
  }

  note(dim(pageUrl));
  return 0;
}
