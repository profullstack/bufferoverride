import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

/** Read once: package.json is beside the source, not beside the caller's cwd. */
const HERE = dirname(fileURLToPath(import.meta.url));
export const VERSION = JSON.parse(readFileSync(join(HERE, '..', 'package.json'), 'utf8')).version;

/**
 * A refusal from the server, carrying enough to print something useful.
 *
 * The API answers with a machine-readable code and, where a field is at fault,
 * the field and a sentence about it. Both are preserved: the code so callers
 * can branch, the sentences so the person reading the terminal learns what to
 * change.
 */
/**
 * How a question is addressed.
 *
 * The row id is internal and the API stopped putting it in URLs; search returns
 * only `code`, while a single question still carries both. Printing `hit.id`
 * therefore rendered `#undefined` on the one command people run first. Anything
 * shown to a person, or handed back as an argument to another `bo` command, has
 * to go through here. Answers are excluded on purpose: their numeric id is
 * their identity and `--answer 3921` is the documented form.
 */
export function questionRef(question) {
  return question?.code ?? question?.id;
}

export class ApiError extends Error {
  constructor(status, payload, url) {
    super(ApiError.describe(status, payload, url));
    this.status = status;
    this.payload = payload ?? {};
    this.code = payload?.error ?? `http_${status}`;
  }

  static describe(status, payload, url) {
    if (!payload || typeof payload !== 'object') return `HTTP ${status} from ${url}`;
    if (Array.isArray(payload.errors) && payload.errors.length) {
      return payload.errors.map((e) => `${e.field}: ${e.message}`).join('\n');
    }
    if (payload.message) return payload.message;
    switch (payload.error) {
      case 'unauthenticated':
        return 'Not signed in. Run `bo login`.';
      case 'insufficient_scope':
        return 'This credential does not carry the scope that call needs.';
      case 'rate_limited':
        return `Rate limited. Try again in ${payload.retryAfterMinutes ?? 60} minutes.`;
      case 'not_found':
        return 'Not found.';
      default:
        return `${payload.error ?? 'error'} (HTTP ${status})`;
    }
  }
}

export class Api {
  constructor({ url, token, timeoutMs = 20_000 }) {
    this.url = url;
    this.token = token;
    this.timeoutMs = timeoutMs;
  }

  get authenticated() {
    return !!this.token;
  }

  async request(method, path, { body, auth = true, timeoutMs } = {}) {
    const target = `${this.url}${path}`;
    const headers = { accept: 'application/json', 'user-agent': `bo/${VERSION}` };
    if (body !== undefined) headers['content-type'] = 'application/json';
    if (auth && this.token) headers.authorization = `Bearer ${this.token}`;

    // AbortSignal.timeout exists from Node 17.3; a hung request must not leave
    // a terminal waiting forever with no way to tell what happened.
    let response;
    try {
      response = await fetch(target, {
        method,
        headers,
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: AbortSignal.timeout(timeoutMs ?? this.timeoutMs),
      });
    } catch (err) {
      const reason = err?.name === 'TimeoutError' ? 'timed out' : (err?.message ?? 'failed');
      throw new ApiError(0, { error: 'network', message: `Could not reach ${this.url} (${reason}).` }, target);
    }

    if (response.status === 204) return null;

    const text = await response.text();
    let payload = null;
    if (text) {
      try {
        payload = JSON.parse(text);
      } catch {
        payload = { error: 'bad_response', message: text.slice(0, 200) };
      }
    }

    if (!response.ok) throw new ApiError(response.status, payload, target);
    return payload;
  }

  get(path, options) {
    return this.request('GET', path, options);
  }

  post(path, body, options) {
    return this.request('POST', path, { ...options, body: body ?? {} });
  }

  // ── the calls the CLI makes ──────────────────────────────────────────────
  search(query, limit = 10) {
    return this.get(`/v1/search?q=${encodeURIComponent(query)}&limit=${limit}`);
  }

  question(id) {
    return this.get(`/v1/questions/${encodeURIComponent(id)}`);
  }

  duplicates(title) {
    return this.post('/v1/questions/duplicates', { title }, { auth: false });
  }

  me() {
    return this.get('/v1/me');
  }

  ask(payload) {
    return this.post('/v1/questions', payload);
  }

  answer(questionId, payload) {
    return this.post(`/v1/questions/${encodeURIComponent(questionId)}/answers`, payload);
  }

  verify(answerId, payload) {
    return this.post(`/v1/answers/${encodeURIComponent(answerId)}/verify`, payload);
  }
}
