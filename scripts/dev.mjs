// Start API server and Vite dev server together.

import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));

function run(cmd, args, opts = {}) {
  const child = spawn(cmd, args, {
    stdio: 'inherit',
    shell: true,
    cwd: opts.cwd ?? root,
    env: { ...process.env, ...opts.env },
  });
  child.on('exit', (code) => {
    if (code !== 0 && code !== null) process.exit(code);
  });
  return child;
}

const server = run('node', ['src/server.js']);
const web = run('npm', ['run', 'dev'], { cwd: path.join(root, 'web') });

function shutdown() {
  server.kill();
  web.kill();
  process.exit(0);
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
