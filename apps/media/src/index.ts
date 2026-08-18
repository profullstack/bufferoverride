import { createServer } from 'node:http';
import { createReadStream } from 'node:fs';
import { stat, mkdir } from 'node:fs/promises';
import { join, normalize, resolve, sep } from 'node:path';
import { env } from '@bufferoverride/db';

const ROOT = resolve(env('MEDIA_ROOT') ?? './.data/media');
const PORT = Number(env('MEDIA_PORT') ?? 3002);

await mkdir(join(ROOT, 'originals'), { recursive: true });
await mkdir(join(ROOT, 'quarantine'), { recursive: true });

const TYPES: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
  '.txt': 'text/plain; charset=utf-8',
  '.log': 'text/plain; charset=utf-8',
};

/**
 * Resolve a request path inside ROOT, or null if it escapes.
 * User input never reaches the filesystem as a path without passing here.
 */
function safePath(urlPath: string): string | null {
  const decoded = decodeURIComponent(urlPath);
  if (decoded.includes('\0')) return null;
  const full = resolve(join(ROOT, normalize(decoded)));
  if (full !== ROOT && !full.startsWith(ROOT + sep)) return null;
  return full;
}

const server = createServer(async (req, res) => {
  if (req.url === '/health' || req.url === '/media/health') {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ ok: true, service: 'media' }));
    return;
  }

  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.writeHead(405).end();
    return;
  }

  const rel = (req.url ?? '/').replace(/^\/media/, '').split('?')[0];
  const path = safePath(rel);
  if (!path) {
    res.writeHead(400).end('bad path');
    return;
  }

  try {
    const info = await stat(path);
    if (!info.isFile()) {
      res.writeHead(404).end();
      return;
    }
    const ext = path.slice(path.lastIndexOf('.')).toLowerCase();
    res.writeHead(200, {
      'content-type': TYPES[ext] ?? 'application/octet-stream',
      'content-length': info.size,
      // Content-addressed paths are immutable, so let the edge hold them.
      'cache-control': 'public, max-age=31536000, immutable',
      'x-content-type-options': 'nosniff',
    });
    if (req.method === 'HEAD') {
      res.end();
      return;
    }
    createReadStream(path).pipe(res);
  } catch {
    res.writeHead(404).end();
  }
});

server.listen(PORT, () => console.log(`[media] listening on ${PORT}, root ${ROOT}`));
