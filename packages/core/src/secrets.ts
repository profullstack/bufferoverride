/**
 * Secret detection for anything a person or agent is about to publish.
 *
 * This is best effort and cannot be complete — no pattern list catches a
 * custom-format secret. It exists to stop the common, catastrophic cases and
 * to show the author what was found *before* they publish, not to provide a
 * guarantee. The response to a miss is revocation, not a longer regex.
 */

export type Finding = { kind: string; line: number; preview: string };

type Rule = { kind: string; re: RegExp };

const RULES: Rule[] = [
  { kind: 'AWS access key id', re: /\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/g },
  { kind: 'GitHub token', re: /\bgh[pousr]_[A-Za-z0-9]{36,}\b/g },
  { kind: 'Slack token', re: /\bxox[abprs]-[A-Za-z0-9-]{10,}\b/g },
  { kind: 'Stripe key', re: /\b[sr]k_(?:live|test)_[A-Za-z0-9]{16,}\b/g },
  { kind: 'OpenAI key', re: /\bsk-(?:proj-)?[A-Za-z0-9_-]{20,}\b/g },
  { kind: 'Anthropic key', re: /\bsk-ant-[A-Za-z0-9_-]{20,}\b/g },
  { kind: 'Resend key', re: /\bre_[A-Za-z0-9]{20,}\b/g },
  { kind: 'Google API key', re: /\bAIza[0-9A-Za-z_-]{35}\b/g },
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
 * `process.env.TOKEN` constantly, and flagging it teaches people to dismiss
 * the warning — which is the one outcome that makes the scanner useless.
 */
const REFERENCE =
  /[:=]\s*["'`]?\s*(?:process\.env|import\.meta\.env|os\.environ|Deno\.env|System\.getenv|ENV|\$\{?[A-Za-z_]|<%|\{\{)/i;

/** An all-caps identifier on the right-hand side is a variable name, not a value. */
const IDENTIFIER = /[:=]\s*["'`]?[A-Z][A-Z0-9_]{3,}["'`]?\s*$/;

export function scanSecrets(text: string): Finding[] {
  const findings: Finding[] = [];
  const lines = text.split('\n');

  lines.forEach((line, index) => {
    for (const rule of RULES) {
      rule.re.lastIndex = 0;
      for (const match of line.matchAll(rule.re)) {
        const hit = match[0];
        if (IGNORE.test(hit)) continue;
        if (rule.kind === 'assigned credential' && (REFERENCE.test(hit) || IDENTIFIER.test(hit)))
          continue;
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
export function redactSecrets(text: string): { text: string; findings: Finding[] } {
  const findings = scanSecrets(text);
  let out = text;
  for (const rule of RULES) {
    rule.re.lastIndex = 0;
    out = out.replace(rule.re, (hit) => {
      if (IGNORE.test(hit)) return hit;
      if (rule.kind === 'assigned credential' && (REFERENCE.test(hit) || IDENTIFIER.test(hit)))
        return hit;
      return `[REDACTED ${rule.kind}]`;
    });
  }
  return { text: out, findings };
}
