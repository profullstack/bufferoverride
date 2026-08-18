import { spawn, type ChildProcess } from 'node:child_process';

export type Daemon = {
  name: string;
  entry: string;
  args?: string[];
  /** Working directory for the child; defaults to the gateway's. */
  cwd?: string;
  port?: number;
  /** An essential daemon failing repeatedly should fail the health check. */
  essential: boolean;
  env?: Record<string, string>;
};

type Supervised = {
  spec: Daemon;
  child?: ChildProcess;
  restarts: number;
  healthy: boolean;
  lastExit?: number;
};

const MAX_BACKOFF_MS = 30_000;
const RESET_AFTER_MS = 60_000;

/**
 * Runs the daemons as children of this process and keeps them running.
 *
 * The whole point of the single-service topology is that one crashing daemon
 * must not take the container down with it, so a child exiting is always
 * restarted with backoff — never propagated. Only a repeatedly failing
 * *essential* daemon is allowed to affect the health check.
 */
export class Supervisor {
  private readonly procs = new Map<string, Supervised>();
  private stopping = false;

  constructor(specs: Daemon[]) {
    for (const spec of specs) {
      this.procs.set(spec.name, { spec, restarts: 0, healthy: false });
    }
  }

  start(): void {
    for (const name of this.procs.keys()) this.spawnOne(name);

    for (const signal of ['SIGTERM', 'SIGINT'] as const) {
      process.on(signal, () => this.shutdown(signal));
    }
  }

  private spawnOne(name: string): void {
    const entry = this.procs.get(name);
    if (!entry || this.stopping) return;

    const child = spawn(process.execPath, [entry.spec.entry, ...(entry.spec.args ?? [])], {
      cwd: entry.spec.cwd,
      stdio: ['ignore', 'inherit', 'inherit'],
      env: { ...process.env, ...entry.spec.env },
    });

    entry.child = child;
    entry.healthy = true;
    const startedAt = Date.now();

    child.on('exit', (code, signal) => {
      entry.healthy = false;
      entry.lastExit = code ?? undefined;
      if (this.stopping) return;

      // A child that stayed up a while is treated as a fresh failure, not a
      // continuation of an old crash loop.
      if (Date.now() - startedAt > RESET_AFTER_MS) entry.restarts = 0;
      entry.restarts++;

      const delay = Math.min(500 * 2 ** (entry.restarts - 1), MAX_BACKOFF_MS);
      console.error(
        `[supervisor] ${name} exited (code=${code} signal=${signal}); ` +
          `restart #${entry.restarts} in ${delay}ms`,
      );
      setTimeout(() => this.spawnOne(name), delay).unref();
    });

    child.on('error', (err) => console.error(`[supervisor] ${name} spawn error:`, err));
    console.log(`[supervisor] started ${name} (pid ${child.pid})`);
  }

  /** Unhealthy only when an essential daemon is in a sustained crash loop. */
  get healthy(): boolean {
    for (const entry of this.procs.values()) {
      if (entry.spec.essential && !entry.healthy && entry.restarts >= 3) return false;
    }
    return true;
  }

  report(): Record<string, { up: boolean; restarts: number; essential: boolean }> {
    const out: Record<string, { up: boolean; restarts: number; essential: boolean }> = {};
    for (const [name, entry] of this.procs) {
      out[name] = {
        up: entry.healthy,
        restarts: entry.restarts,
        essential: entry.spec.essential,
      };
    }
    return out;
  }

  private shutdown(signal: NodeJS.Signals): void {
    if (this.stopping) return;
    this.stopping = true;
    console.log(`[supervisor] ${signal} — stopping children`);
    for (const entry of this.procs.values()) entry.child?.kill(signal);
    setTimeout(() => process.exit(0), 5_000).unref();
  }
}
