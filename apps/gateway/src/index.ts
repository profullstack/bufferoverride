import { createServer, request as httpRequest, type IncomingMessage, type ServerResponse } from 'node:http';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { env } from '@bufferoverride/db';
import { migrate } from '@bufferoverride/db';
import { Supervisor, type Daemon } from './supervisor.ts';

const HERE = dirname(fileURLToPath(import.meta.url));
const APPS = resolve(HERE, '..', '..');

const PORT = Number(env('PORT') ?? 3000);
const WEB_PORT = Number(env('WEB_PORT') ?? 3003);
const API_PORT = Number(env('API_PORT') ?? 3001);
const MEDIA_PORT = Number(env('MEDIA_PORT') ?? 3002);

const enabled = new Set(
  (env('SERVICES') ?? 'web,api,media,worker').split(',').map((s) => s.trim()).filter(Boolean),
);

// Resolve Next from the web app's own dependency tree: pnpm isolates packages
// per workspace member, so it is not hoisted to the repo root.
const NEXT_BIN = createRequire(join(APPS, 'web', 'package.json')).resolve('next/dist/bin/next');

const CATALOG: Daemon[] = [
  {
    name: 'web',
    entry: NEXT_BIN,
    args: ['start', '--port', String(WEB_PORT)],
    // next start resolves .next relative to cwd, not to the binary.
    cwd: join(APPS, 'web'),
    port: WEB_PORT,
    essential: true,
    env: { PORT: String(WEB_PORT) },
  },
  {
    name: 'api',
    entry: join(APPS, 'api', 'src', 'index.ts'),
    port: API_PORT,
    essential: true,
    env: { API_PORT: String(API_PORT) },
  },
  {
    name: 'media',
    entry: join(APPS, 'media', 'src', 'index.ts'),
    port: MEDIA_PORT,
    essential: false,
    env: { MEDIA_PORT: String(MEDIA_PORT) },
  },
  {
    name: 'worker',
    entry: join(APPS, 'worker', 'src', 'index.ts'),
    essential: false,
  },
];

// Migrations run once, here, before any daemon can serve a request — rather
// than in each daemon, where four processes would race for the write lock.
const applied = await migrate();
console.log(applied.length ? `[gateway] migrations: ${applied.join(', ')}` : '[gateway] schema current');

const supervisor = new Supervisor(CATALOG.filter((d) => enabled.has(d.name)));
supervisor.start();

/** Path prefix → upstream port. First match wins, so order matters. */
const ROUTES: Array<[RegExp, number, string]> = [
  [/^\/(v1|api)(\/|$)/, API_PORT, 'api'],
  [/^\/mcp(\/|$)/, API_PORT, 'api'],
  [/^\/media(\/|$)/, MEDIA_PORT, 'media'],
];

function upstreamFor(url: string): { port: number; name: string } {
  for (const [pattern, port, name] of ROUTES) {
    if (pattern.test(url)) return { port, name };
  }
  return { port: WEB_PORT, name: 'web' };
}

function proxy(req: IncomingMessage, res: ServerResponse, port: number, name: string): void {
  const upstream = httpRequest(
    {
      host: '127.0.0.1',
      port,
      path: req.url,
      method: req.method,
      headers: { ...req.headers, host: req.headers.host ?? 'localhost' },
    },
    (up) => {
      res.writeHead(up.statusCode ?? 502, up.headers);
      up.pipe(res);
    },
  );

  upstream.on('error', (err) => {
    console.error(`[gateway] ${name} upstream error:`, err.message);
    if (!res.headersSent) {
      res.writeHead(502, { 'content-type': 'application/json' });
    }
    res.end(JSON.stringify({ error: 'upstream_unavailable', service: name }));
  });

  req.pipe(upstream);
}

const server = createServer((req, res) => {
  const url = req.url ?? '/';

  if (url === '/health' || url === '/healthz') {
    const ok = supervisor.healthy;
    res.writeHead(ok ? 200 : 503, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ ok, services: supervisor.report() }, null, 2));
    return;
  }

  const { port, name } = upstreamFor(url);
  proxy(req, res, port, name);
});

server.listen(PORT, () => {
  console.log(`[gateway] listening on ${PORT}; daemons: ${[...enabled].join(', ')}`);
});
