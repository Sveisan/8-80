import process from 'node:process';
import console from 'node:console';
import { spawn, spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, delimiter } from 'node:path';
import { createServer } from 'node:net';
import postgres from 'postgres';

const args = process.argv.slice(2);
const browserOnly = args.includes('--browser');
const unitOnly = args.includes('--unit');
const forwarded = args.includes('--') ? args.slice(args.indexOf('--') + 1) : [];
let data, bin, started = false;
const env = { ...process.env };
const run = (command, argv) => new Promise((resolve, reject) => {
  const child = spawn(command, argv, { env, stdio: 'inherit' });
  child.once('error', reject);
  child.once('exit', code => code === 0 ? resolve() : reject(new Error(`${command} ${argv.join(' ')} exited ${code}`)));
});
try {
  if (!env.TEST_DATABASE_URL) {
    const candidates = [env.DESIGN_PG_BIN, ...String(env.PATH).split(delimiter), '/opt/homebrew/opt/postgresql@18/bin', '/opt/homebrew/opt/postgresql@17/bin'].filter(Boolean);
    bin = candidates.find(path => existsSync(join(path, 'initdb')) && existsSync(join(path, 'pg_ctl')));
    if (!bin) throw new Error('Set TEST_DATABASE_URL, add Postgres to PATH or set DESIGN_PG_BIN. Database tests may not silently skip in a release check.');
    data = mkdtempSync(join(tmpdir(), '8and80-design-test-'));
    const socket = createServer();
    await new Promise(resolve => socket.listen(0, '127.0.0.1', resolve));
    const port = socket.address().port;
    await new Promise(resolve => socket.close(resolve));
    const pg = (name, argv) => {
      const result = spawnSync(join(bin, name), argv, { encoding: 'utf8' });
      if (result.status !== 0) throw new Error(`${name}: ${result.stderr}`);
    };
    pg('initdb', ['-D', data, '-A', 'trust', '-U', 'postgres', '--locale=C', '--encoding=UTF8']);
    pg('pg_ctl', ['-D', data, '-o', `-h 127.0.0.1 -p ${port} -k ${data}`, '-l', join(data, 'server.log'), '-w', 'start']);
    started = true;
    const sql = postgres(`postgres://postgres@127.0.0.1:${port}/postgres`, { max: 1 });
    await sql.unsafe('create database eight80_design_test'); await sql.end();
    env.TEST_DATABASE_URL = `postgres://postgres@127.0.0.1:${port}/eight80_design_test`;
    console.log('Started an isolated, temporary Postgres database.');
  }
  if (!browserOnly) await run('npm', ['run', 'check']);
  if (!unitOnly) await run('npm', ['run', 'design:test', '--', ...forwarded]);
} catch (error) { console.error(error.message); process.exitCode = 1; }
finally {
  if (started) spawnSync(join(bin, 'pg_ctl'), ['-D', data, '-m', 'immediate', '-w', 'stop'], { stdio: 'ignore' });
  if (data) rmSync(data, { recursive: true, force: true });
}
