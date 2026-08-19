/**
 * Secret detection for anything about to leave this machine.
 *
 * This is a deliberate copy of packages/core/src/secrets.ts rather than an
 * import of it. The CLI is published to npm as a standalone package and cannot
 * depend on a private workspace package, and more importantly it has to work
 * *offline*: the whole point of redacting locally is that the unredacted text
 * never reaches the network, so asking the server to scan it first would defeat
 * the exercise. The server re-scans on ingest regardless — this is the first of
 * two passes, not the only one.
 *
 * Best effort, and it cannot be complete: no pattern list catches a
 * custom-format secret. The response to a miss is revocation, not a longer
 * regex. Keep the rules here in step with the server's.
 */

const RULES = [
  { kind: 'AWS access key id', re: /\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/g },
  { kind: 'GitHub token', re: /\bgh[pousr]_[A-Za-z0-9]{36,}\b/g },
  { kind: 'Slack token', re: /\bxox[abprs]-[A-Za-z0-9-]{10,}\b/g },
  { kind: 'Stripe key', re: /\b[sr]k_(?:live|test)_[A-Za-z0-9]{16,}\b/g },
  // Before the OpenAI rule: `sk-ant-…` matches both, and whichever runs first
  // supplies the label the author reads.
  { kind: 'Anthropic key', re: /\bsk-ant-[A-Za-z0-9_-]{20,}\b/g },
  { kind: 'OpenAI key', re: /\bsk-(?:proj-)?[A-Za-z0-9_-]{20,}\b/g },
  { kind: 'Resend key', re: /\bre_[A-Za-z0-9]{20,}\b/g },
  { kind: 'Google API key', re: /\bAIza[0-9A-Za-z_-]{35}\b/g },
  { kind: 'BufferOverride key', re: /\bbo_[A-Za-z0-9_-]{24,}\b/g },
  { kind: 'private key block', re: /-----BEGIN (?:RSA |EC |OPENSSH |PGP )?PRIVATE KEY-----/g },
  { kind: 'JSON Web Token', re: /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/g },
  { kind: 'connection string password', re: /\b[a-z+]{2,12}:\/\/[^\s:@/]+:[^\s@/]{3,}@/gi },
  { kind: 'bearer token', re: /\bBearer\s+[A-Za-z0-9._~+/-]{20,}={0,2}/g },
  {
    kind: 'assigned credential',
    re: /\b(?:api[_-]?key|secret|password|passwd|token|auth[_-]?token)\b\s*[:=]\s*["']?[^\s"'<>,;]{8,}/gi,
  },
];

/** Placeholders and obvious examples are noise, not secrets. */
const IGNORE = /(?:x{5,}|\*{5,}|\.{3,}|redacted|example|placeholder|your[_-]?(?:key|token)|<[^>]+>)/i;

/**
 * A credential *reference* is not a credential. Developers paste
 * `process.env.TOKEN` constantly, and flagging it teaches people to dismiss the
 * warning — the one outcome that makes a scanner useless.
 */
const REFERENCE =
  /[:=]\s*["'`]?\s*(?:process\.env|import\.meta\.env|os\.environ|Deno\.env|System\.getenv|ENV|\$\{?[A-Za-z_]|<%|\{\{)/i;

/** An all-caps identifier on the right-hand side is a variable name, not a value. */
const IDENTIFIER = /[:=]\s*["'`]?[A-Z][A-Z0-9_]{3,}["'`]?\s*$/;

function skip(kind, hit) {
  if (IGNORE.test(hit)) return true;
  return kind === 'assigned credential' && (REFERENCE.test(hit) || IDENTIFIER.test(hit));
}

/** @returns {{kind: string, line: number, preview: string}[]} */
export function scanSecrets(text) {
  const findings = [];
  text.split('\n').forEach((line, index) => {
    for (const rule of RULES) {
      rule.re.lastIndex = 0;
      for (const match of line.matchAll(rule.re)) {
        const hit = match[0];
        if (skip(rule.kind, hit)) continue;
        findings.push({
          kind: rule.kind,
          line: index + 1,
          preview: hit.length > 24 ? `${hit.slice(0, 10)}…${hit.slice(-4)}` : hit,
        });
      }
    }
  });
  return findings;
}

/** Replace every detected secret with a visible marker. */
export function redactSecrets(text) {
  const findings = scanSecrets(text);
  let out = text;
  for (const rule of RULES) {
    rule.re.lastIndex = 0;
    out = out.replace(rule.re, (hit) => (skip(rule.kind, hit) ? hit : `[REDACTED ${rule.kind}]`));
  }
  return { text: out, findings };
}

/**
 * Redact values that came out of this machine's own environment.
 *
 * Pattern matching only knows the shapes it was told about, and every
 * deployment invents its own. Anything long and high-entropy sitting in an
 * env var whose name sounds like a credential is worth blanking wherever it
 * appears in captured output, whatever shape it happens to be.
 */
const SENSITIVE_NAME = /(?:key|secret|token|password|passwd|credential|auth|session|cookie|private)/i;

export function redactEnvironmentValues(text, environment = process.env) {
  const replaced = new Set();
  let out = text;

  for (const [name, value] of Object.entries(environment)) {
    if (!value || value.length < 12) continue;
    if (!SENSITIVE_NAME.test(name)) continue;
    if (!out.includes(value)) continue;
    out = out.split(value).join(`[REDACTED ${name}]`);
    replaced.add(name);
  }

  return { text: out, replaced: [...replaced] };
}

/** Both passes, in the order that matters: known shapes, then local values. */
export function redactAll(text, environment = process.env) {
  const first = redactSecrets(text);
  const second = redactEnvironmentValues(first.text, environment);
  return {
    text: second.text,
    findings: first.findings,
    envNames: second.replaced,
    count: first.findings.length + second.replaced.length,
  };
}
