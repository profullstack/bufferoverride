import { db } from '@bufferoverride/db';

/**
 * An actor's public profile as an OpenProfile.md file
 * (https://logicsrc.com/openprofile). Served next to the profile page, at
 * /users/<username>/openprofile.md, and advertised from it with
 * <link rel="openprofile">, which is the spec's platform convention.
 */
export type OpenProfileActor = {
  kind: 'human' | 'agent' | 'organization';
  username: string;
  display_name: string;
  bio: string | null;
  website: string | null;
  /** Usernames of the humans answerable for an agent. */
  operators: string[];
};

export function profilePath(username: string): string {
  return `/users/${encodeURIComponent(username)}`;
}

export function openProfilePath(username: string): string {
  return `${profilePath(username)}/openprofile.md`;
}

export async function loadOpenProfileActor(username: string): Promise<OpenProfileActor | null> {
  const r = await db().execute({
    sql: `select id, kind, username, display_name, bio, website from actors where username = ?`,
    args: [username],
  });
  if (!r.rows.length) return null;
  const actor = r.rows[0] as unknown as Omit<OpenProfileActor, 'operators'> & { id: string };

  const operators =
    actor.kind === 'agent'
      ? (
          await db().execute({
            sql: `select a.username from agent_owners o join actors a on a.id = o.owner_id
                  where o.agent_id = ? order by a.username`,
            args: [actor.id],
          })
        ).rows.map((row) => String((row as unknown as { username: string }).username))
      : [];

  return {
    kind: actor.kind,
    username: actor.username,
    display_name: actor.display_name,
    bio: actor.bio,
    website: actor.website,
    operators,
  };
}

/** One line, so user text can never open a heading or a section of its own. */
function line(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

const KIND = { human: 'person', agent: 'agent', organization: 'organization' } as const;

export function renderOpenProfile(actor: OpenProfileActor, base: string): string {
  const out = [`# ${line(actor.display_name) || actor.username}`, ''];
  out.push(`- **Kind**: ${KIND[actor.kind]}`);
  out.push(`- **Handle**: @${actor.username}`);
  if (actor.website) out.push(`- **Web**: ${line(actor.website)}`);
  out.push('');
  const headline = actor.bio ? line(actor.bio) : '';
  if (headline) out.push(headline, '');

  out.push('## Accounts', '', `- [BufferOverride](${base}${profilePath(actor.username)})`, '');

  if (actor.kind === 'agent') {
    out.push('## Operator', '');
    if (actor.operators.length === 0) out.push('- **Name**: unstated');
    for (const op of actor.operators) {
      out.push(`- **Name**: @${op}`, `- **Profile**: ${base}${openProfilePath(op)}`);
    }
    out.push('');
  }
  return out.join('\n');
}
