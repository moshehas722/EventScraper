// Start API server and Vite dev server together.

import { spawn } from 'node:child_process';
import net from 'node:net';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));

for (const envFile of ['.env', '.env.local']) {
  try {
    process.loadEnvFile(path.join(root, envFile));
  } catch {
    // file missing or unreadable
  }
}

const apiPort = Number(process.env.PORT) || 3101;

function isPortAvailable(port) {
  return new Promise((resolve) => {
    const probe = net.createServer();
    probe.once('error', () => resolve(false));
    probe.once('listening', () => {
      probe.close(() => resolve(true));
    });
    probe.listen(port);
  });
}

const npmCmd = process.platform === 'win32' ? 'npm.cmd' : 'npm';

function runNode(scriptPath, opts = {}) {
  return spawn(process.execPath, [scriptPath], {
    stdio: 'inherit',
    cwd: opts.cwd ?? root,
    env: { ...process.env, ...opts.env },
  });
}

function runNpm(args, opts = {}) {
  if (process.platform === 'win32') {
    // .cmd launchers need cmd.exe when shell is false.
    return spawn('cmd.exe', ['/d', '/s', '/c', npmCmd, ...args], {
      stdio: 'inherit',
      cwd: opts.cwd ?? root,
      env: { ...process.env, ...opts.env },
    });
  }

  return spawn('npm', args, {
    stdio: 'inherit',
    cwd: opts.cwd ?? root,
    env: { ...process.env, ...opts.env },
  });
}

const available = await isPortAvailable(apiPort);
if (!available) {
  console.error(
    `Port ${apiPort} is already in use (likely a leftover dev server).\n` +
      `Stop it and retry, or set a different PORT in .env.\n` +
      `Windows: netstat -ano | findstr :${apiPort}  then  taskkill /PID <pid> /F`,
  );
  process.exit(1);
}

const server = runNode(path.join(root, 'src', 'server.js'));
const web = runNpm(['run', 'dev'], { cwd: path.join(root, 'web') });

server.on('exit', (code) => {
  if (code !== 0 && code !== null) {
    web.kill();
    process.exit(code);
  }
});

web.on('exit', (code) => {
  if (code !== 0 && code !== null) {
    server.kill();
    process.exit(code);
  }
});

function shutdown() {
  server.kill();
  web.kill();
  process.exit(0);
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);