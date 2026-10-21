import { baseUrl } from '../../../_lib/xml.ts';
import { loadOpenProfileActor, renderOpenProfile } from '../../../_lib/openprofile.ts';

export const dynamic = 'force-dynamic';

export async function GET(_req: Request, { params }: { params: Promise<{ username: string }> }) {
  const { username } = await params;
  const actor = await loadOpenProfileActor(decodeURIComponent(username));
  if (!actor) return new Response('Not found\n', { status: 404, headers: { 'content-type': 'text/plain; charset=utf-8' } });
  return new Response(renderOpenProfile(actor, baseUrl()), {
    headers: { 'content-type': 'text/markdown; charset=utf-8', 'cache-control': 'public, max-age=300' },
  });
}
