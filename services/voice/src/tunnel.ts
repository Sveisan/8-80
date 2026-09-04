import { spawn, type ChildProcess } from 'node:child_process';

/**
 * A quick Cloudflare tunnel, started and read automatically.
 *
 * Quick tunnels get a new hostname on every restart, and the dead one stays in
 * .env. That has produced a connected-but-silent call more than once, which is
 * the most expensive kind of failure here: it looks like a broken voice model.
 * Starting the tunnel ourselves and reading the hostname it prints removes the
 * whole class of mistake.
 */
export interface Tunnel {
  url: string;
  stop(): void;
}

/** Pull the hostname out of cloudflared's banner. Exported for testing. */
export function parseTunnelUrl(output: string): string | null {
  const m = /https:\/\/[a-z0-9-]+\.trycloudflare\.com/i.exec(output);
  return m ? m[0] : null;
}

export function cloudflaredAvailable(): boolean {
  const r = spawn('which', ['cloudflared']);
  return r.pid !== undefined;
}

export async function startTunnel(port: number, timeoutMs = 40_000): Promise<Tunnel> {
  const proc: ChildProcess = spawn('cloudflared', ['tunnel', '--url', `http://localhost:${port}`], {
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  return new Promise<Tunnel>((resolve, reject) => {
    let buf = '';
    const done = (fn: () => void) => {
      clearTimeout(timer);
      proc.stdout?.removeAllListeners('data');
      proc.stderr?.removeAllListeners('data');
      fn();
    };
    const timer = setTimeout(
      () => done(() => { proc.kill(); reject(new Error('cloudflared did not print a URL within 40s')); }),
      timeoutMs,
    );

    const onData = (chunk: Buffer) => {
      buf += chunk.toString();
      const url = parseTunnelUrl(buf);
      if (url) {
        done(() =>
          resolve({
            url,
            stop: () => proc.kill(),
          }),
        );
      }
    };

    proc.stdout?.on('data', onData);
    proc.stderr?.on('data', onData); // cloudflared logs the banner to stderr
    proc.on('error', (e) => done(() => reject(new Error(`could not start cloudflared: ${e.message}`))));
    proc.on('exit', (code) => done(() => reject(new Error(`cloudflared exited (${code}) before printing a URL`))));
  });
}
