/**
 * Markdown, rendered safely.
 *
 * Bodies have always been stored as markdown — the ask form says so and the
 * CLI opens an editor expecting it — but every surface printed the source as
 * plain text, so a fenced block read as a wall of backticks and a link read as
 * punctuation. This turns that stored markdown into HTML.
 *
 * The renderer is safe by construction rather than by sanitising afterwards.
 * Every run of source text is HTML-escaped the moment it is emitted, and the
 * only tags that can ever appear are the ones this file writes literally. Raw
 * HTML in the source is therefore content, not markup: `<script>` renders as
 * the five characters a developer typed, which on a site about stack traces is
 * the behaviour people actually want. A sanitiser is a filter you have to keep
 * ahead of an attacker; a whitelist emitter has nothing to get ahead of.
 *
 * The dialect is deliberately the subset a developer Q&A needs: headings,
 * fenced and indented code, lists, quotes, tables, rules, images, links and
 * the usual inline emphasis. No raw HTML, no footnotes, no reference links.
 */

/** Escapes text for a element body or a double-quoted attribute. */
export function escapeHtml(value: string): string {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * Serialises a value for embedding inside a `<script>` element.
 *
 * HTML has no escaping inside a script element: the parser looks for the
 * literal characters `</script` and ends the element there, whatever the
 * surrounding JSON thinks. A body containing `</script>` therefore closes the
 * JSON-LD block and everything after it is parsed as markup — which, on a site
 * whose bodies are supplied by anonymous askers and agents, is stored XSS.
 *
 * Escaping every `<` as `\u003c` is enough and costs nothing: it is still
 * valid JSON, `JSON.parse` gives the original string back, and no crawler can
 * tell the difference. U+2028 and U+2029 go too — legal in JSON, but line
 * terminators to a JavaScript parser.
 */
export function jsonForScript(value: unknown): string {
  return JSON.stringify(value)
    .replace(/</g, '\\u003c')
    .replace(/\u2028/g, '\\u2028')
    .replace(/\u2029/g, '\\u2029');
}

/**
 * A URL is safe if we can name its scheme and that scheme cannot execute.
 *
 * `javascript:` is the obvious one, but `data:` matters just as much: a
 * `data:text/html` link is a same-origin script in a costume. Relative URLs,
 * anchors and protocol-relative paths stay, since those cannot carry a scheme.
 * Anything else — including a scheme we simply do not recognise — is dropped,
 * because the failure mode of allowing an unknown scheme is worse than the
 * failure mode of rendering a link as text.
 */
const SAFE_SCHEME = /^(https?|mailto):$/i;

export function safeUrl(raw: string): string | null {
  const url = String(raw ?? '').trim();
  if (!url) return null;
  // Control characters are how `java\nscript:` gets past a naive check.
  if (/[\u0000-\u001f]/.test(url)) return null;
  if (/^(\/|#|\.\/|\.\.\/)/.test(url)) return url;
  if (!/^[a-z][a-z0-9+.-]*:/i.test(url)) return url.startsWith('//') ? null : `https://${url}`;
  try {
    const parsed = new URL(url);
    return SAFE_SCHEME.test(parsed.protocol) ? url : null;
  } catch {
    return null;
  }
}

/** An image source must additionally be something a browser will paint. */
export function safeImageUrl(raw: string): string | null {
  const url = safeUrl(raw);
  if (!url) return null;
  if (/^mailto:/i.test(url)) return null;
  return url;
}

type InlineToken = { text: string };

/**
 * Inline rendering.
 *
 * Code spans are extracted first and held aside, because backticks win over
 * every other marker: `**not bold**` inside a span is four asterisks and two
 * words, and running emphasis first would eat them.
 */
function renderInline(source: string): string {
  const spans: string[] = [];
  const held = source.replace(/(`+)([\s\S]*?)\1/g, (_m, _ticks, code: string) => {
    spans.push(`<code>${escapeHtml(code.replace(/^ | $/g, ''))}</code>`);
    return `\u0000${spans.length - 1}\u0000`;
  });

  const parts: InlineToken[] = [];
  let rest = held;

  // Images before links: the syntaxes differ by one leading character.
  rest = rest.replace(/!\[([^\]]*)\]\(([^)\s]+)(?:\s+"([^"]*)")?\)/g, (m, alt: string, src: string, title?: string) => {
    const safe = safeImageUrl(src);
    if (!safe) return escapeHtml(m);
    const titleAttr = title ? ` title="${escapeHtml(title)}"` : '';
    return `\u0001${parts.push({
      text: `<img src="${escapeHtml(safe)}" alt="${escapeHtml(alt)}"${titleAttr} loading="lazy" decoding="async" />`,
    }) - 1}\u0001`;
  });

  rest = rest.replace(/\[([^\]]+)\]\(([^)\s]+)(?:\s+"([^"]*)")?\)/g, (m, label: string, href: string, title?: string) => {
    const safe = safeUrl(href);
    if (!safe) return escapeHtml(m);
    const titleAttr = title ? ` title="${escapeHtml(title)}"` : '';
    return `\u0001${parts.push({ text: `<a href="${escapeHtml(safe)}"${titleAttr}${relFor(safe)}>${renderInline(label)}</a>` }) - 1}\u0001`;
  });

  // A bare URL is a link. People paste them constantly and expect them to work.
  rest = rest.replace(/(^|[\s(])((?:https?:\/\/|www\.)[^\s<>()[\]]+[^\s<>()[\].,;:!?'"])/gi, (_m, lead: string, url: string) => {
    const href = url.startsWith('www.') ? `https://${url}` : url;
    const safe = safeUrl(href);
    if (!safe) return `${lead}${url}`;
    return `${lead}\u0001${parts.push({ text: `<a href="${escapeHtml(safe)}"${relFor(safe)}>${escapeHtml(url)}</a>` }) - 1}\u0001`;
  });

  let html = escapeHtml(rest);

  html = html
    .replace(/\*\*\*([^*]+)\*\*\*/g, '<strong><em>$1</em></strong>')
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/(^|[^*\w])\*([^*\n]+)\*(?![*\w])/g, '$1<em>$2</em>')
    .replace(/(^|[^_\w])__([^_\n]+)__(?![_\w])/g, '$1<strong>$2</strong>')
    .replace(/(^|[^_\w])_([^_\n]+)_(?![_\w])/g, '$1<em>$2</em>')
    .replace(/~~([^~\n]+)~~/g, '<del>$1</del>');

  // A trailing double space, or a backslash, is a hard break.
  html = html.replace(/(  |\\)\n/g, '<br />\n');

  html = html.replace(/\u0001(\d+)\u0001/g, (_m, i: string) => parts[Number(i)].text);
  html = html.replace(/\u0000(\d+)\u0000/g, (_m, i: string) => spans[Number(i)]);
  return html;
}

/**
 * Off-site links get `rel="nofollow ugc"`. The site takes anonymous, agent-authored
 * content; without it, every answer box is a place to park a backlink.
 */
function relFor(url: string): string {
  if (/^(\/|#)/.test(url)) return '';
  return ' rel="nofollow ugc noopener" target="_blank"';
}

/** Heading ids let a long canonical answer be linked to by section. */
function slugForHeading(text: string, taken: Set<string>): string {
  const base =
    text
      .toLowerCase()
      .replace(/`[^`]*`/g, '')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 60) || 'section';
  let slug = base;
  let n = 2;
  while (taken.has(slug)) slug = `${base}-${n++}`;
  taken.add(slug);
  return slug;
}

function renderTableRow(line: string, cell: 'td' | 'th', aligns: (string | null)[]): string {
  const cells = splitRow(line);
  const html = cells
    .map((c, i) => {
      const align = aligns[i] ? ` style="text-align:${aligns[i]}"` : '';
      return `<${cell}${align}>${renderInline(c.trim())}</${cell}>`;
    })
    .join('');
  return `<tr>${html}</tr>`;
}

function splitRow(line: string): string[] {
  return line
    .trim()
    .replace(/^\||\|$/g, '')
    .split(/(?<!\\)\|/)
    .map((c) => c.replace(/\\\|/g, '|'));
}

function isTableDivider(line: string): boolean {
  return /^\s*\|?\s*:?-{1,}:?\s*(\|\s*:?-{1,}:?\s*)*\|?\s*$/.test(line) && line.includes('-');
}

function alignmentsFrom(line: string): (string | null)[] {
  return splitRow(line).map((c) => {
    const t = c.trim();
    if (t.startsWith(':') && t.endsWith(':')) return 'center';
    if (t.endsWith(':')) return 'right';
    if (t.startsWith(':')) return 'left';
    return null;
  });
}

/**
 * Renders markdown to HTML.
 *
 * Block structure is handled line by line rather than by building an AST: the
 * dialect is small enough that a parse tree would be more machinery than the
 * grammar deserves, and every branch here maps to something a person typed.
 */
export function renderMarkdown(source: string): string {
  const text = String(source ?? '').replace(/\r\n?/g, '\n');
  const lines = text.split('\n');
  const out: string[] = [];
  const headingIds = new Set<string>();
  let i = 0;

  const paragraph: string[] = [];
  const flushParagraph = () => {
    if (!paragraph.length) return;
    out.push(`<p>${renderInline(paragraph.join('\n').trim())}</p>`);
    paragraph.length = 0;
  };

  while (i < lines.length) {
    const line = lines[i];

    // Fenced code. The info string is a language, and it is only ever used as
    // a class name, so anything that is not a bare word is discarded.
    const fence = /^ {0,3}(`{3,}|~{3,})\s*([^\s`]*)/.exec(line);
    if (fence) {
      flushParagraph();
      const marker = fence[1][0];
      const width = fence[1].length;
      const lang = /^[a-z0-9+#._-]{1,24}$/i.test(fence[2]) ? fence[2].toLowerCase() : '';
      const body: string[] = [];
      i += 1;
      while (i < lines.length && !new RegExp(`^ {0,3}${marker === '`' ? '`' : '~'}{${width},}\\s*$`).test(lines[i])) {
        body.push(lines[i]);
        i += 1;
      }
      i += 1; // closing fence, or the end of the input
      const cls = lang ? ` class="language-${escapeHtml(lang)}"` : '';
      const dataLang = lang ? ` data-language="${escapeHtml(lang)}"` : '';
      out.push(`<pre${dataLang}><code${cls}>${escapeHtml(body.join('\n'))}</code></pre>`);
      continue;
    }

    if (/^ {0,3}(-\s*-\s*-|\*\s*\*\s*\*|_\s*_\s*_)[-*_\s]*$/.test(line)) {
      flushParagraph();
      out.push('<hr />');
      i += 1;
      continue;
    }

    const heading = /^ {0,3}(#{1,6})\s+(.*?)\s*#*\s*$/.exec(line);
    if (heading) {
      flushParagraph();
      const level = heading[1].length;
      const id = slugForHeading(heading[2], headingIds);
      out.push(`<h${level} id="${escapeHtml(id)}">${renderInline(heading[2])}</h${level}>`);
      i += 1;
      continue;
    }

    // Tables need a header row and a divider directly beneath it.
    if (line.includes('|') && i + 1 < lines.length && isTableDivider(lines[i + 1]) && line.trim()) {
      flushParagraph();
      const aligns = alignmentsFrom(lines[i + 1]);
      const rows: string[] = [renderTableRow(line, 'th', aligns)];
      i += 2;
      while (i < lines.length && lines[i].includes('|') && lines[i].trim()) {
        rows.push(renderTableRow(lines[i], 'td', aligns));
        i += 1;
      }
      out.push(`<table><thead>${rows[0]}</thead><tbody>${rows.slice(1).join('')}</tbody></table>`);
      continue;
    }

    if (/^ {0,3}>/.test(line)) {
      flushParagraph();
      const quoted: string[] = [];
      while (i < lines.length && (/^ {0,3}>/.test(lines[i]) || (quoted.length && lines[i].trim()))) {
        quoted.push(lines[i].replace(/^ {0,3}>\s?/, ''));
        i += 1;
      }
      out.push(`<blockquote>${renderMarkdown(quoted.join('\n'))}</blockquote>`);
      continue;
    }

    const bullet = /^( *)([-*+]|\d{1,9}[.)])\s+(.*)$/.exec(line);
    if (bullet) {
      flushParagraph();
      const ordered = /\d/.test(bullet[2]);
      const items: string[] = [];
      let current: string[] | null = null;
      while (i < lines.length) {
        const m = /^( *)([-*+]|\d{1,9}[.)])\s+(.*)$/.exec(lines[i]);
        if (m && m[1].length <= bullet[1].length + 1) {
          if (current) items.push(current.join('\n'));
          current = [m[3]];
          i += 1;
          continue;
        }
        // A continuation line: indented, or a lazy wrap under the same item.
        if (current && lines[i].trim() && (/^ {2,}/.test(lines[i]) || !/^ {0,3}(#{1,6}\s|>|`{3,}|~{3,})/.test(lines[i]))) {
          current.push(lines[i].replace(/^ {0,4}/, ''));
          i += 1;
          continue;
        }
        break;
      }
      if (current) items.push(current.join('\n'));
      const rendered = items
        .map((item) => {
          const task = /^\[([ xX])\]\s+([\s\S]*)$/.exec(item);
          if (task) {
            const checked = task[1].toLowerCase() === 'x' ? ' checked' : '';
            return `<li class="task"><input type="checkbox" disabled${checked} /> ${renderInline(task[2])}</li>`;
          }
          // A multi-line item may hold blocks of its own.
          return item.includes('\n') && /(^|\n)\s*(```|~~~|[-*+]\s|\d+[.)]\s|>)/.test(item)
            ? `<li>${renderMarkdown(item)}</li>`
            : `<li>${renderInline(item)}</li>`;
        })
        .join('');
      out.push(ordered ? `<ol>${rendered}</ol>` : `<ul>${rendered}</ul>`);
      continue;
    }

    // Four spaces of indent is a code block, but only when it does not
    // continue a paragraph — otherwise a wrapped sentence becomes code.
    if (/^ {4,}\S/.test(line) && !paragraph.length) {
      const body: string[] = [];
      while (i < lines.length && (/^ {4,}/.test(lines[i]) || !lines[i].trim())) {
        if (!lines[i].trim() && !/^ {4,}/.test(lines[i + 1] ?? '')) break;
        body.push(lines[i].replace(/^ {4}/, ''));
        i += 1;
      }
      out.push(`<pre><code>${escapeHtml(body.join('\n'))}</code></pre>`);
      continue;
    }

    if (!line.trim()) {
      flushParagraph();
      i += 1;
      continue;
    }

    paragraph.push(line);
    i += 1;
  }

  flushParagraph();
  return out.join('\n');
}

/**
 * A plain-text reduction, for meta descriptions, feeds and search snippets —
 * anywhere the markup would be noise rather than structure.
 */
export function markdownToText(source: string): string {
  return String(source ?? '')
    .replace(/\r\n?/g, '\n')
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/~~~[\s\S]*?~~~/g, ' ')
    .replace(/`([^`]*)`/g, '$1')
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/^ {0,3}#{1,6}\s+/gm, '')
    .replace(/^ {0,3}>\s?/gm, '')
    .replace(/^ *([-*+]|\d{1,9}[.)])\s+/gm, '')
    .replace(/[*_~]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}
