/**
 * Stop stale Next.js dev servers on port 3000 and restart with a fresh .next cache.
 * Use when you see "missing required error components" or GET / 404 in dev.
 */
import { execSync, spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const port = process.env.PORT ?? '3000';

function killPortWindows(targetPort) {
  try {
    const out = execSync(`netstat -ano | findstr :${targetPort} | findstr LISTENING`, {
      encoding: 'utf8',
    });
    const pids = new Set();
    for (const line of out.split('\n')) {
      const match = line.trim().match(/\s(\d+)\s*$/);
      if (match) pids.add(match[1]);
    }
    for (const pid of pids) {
      try {
        execSync(`taskkill /F /PID ${pid}`, { stdio: 'ignore' });
        console.log(`[dev:clean] Stopped PID ${pid} on port ${targetPort}`);
      } catch {
        // already exited
      }
    }
  } catch {
    console.log(`[dev:clean] No listener on port ${targetPort}`);
  }
}

function killPortUnix(targetPort) {
  try {
    const out = execSync(`lsof -ti tcp:${targetPort}`, { encoding: 'utf8' }).trim();
    if (!out) return;
    for (const pid of out.split('\n').filter(Boolean)) {
      execSync(`kill -9 ${pid}`, { stdio: 'ignore' });
      console.log(`[dev:clean] Stopped PID ${pid} on port ${targetPort}`);
    }
  } catch {
    console.log(`[dev:clean] No listener on port ${targetPort}`);
  }
}

if (process.platform === 'win32') {
  killPortWindows(port);
} else {
  killPortUnix(port);
}

const nextDir = path.join(root, '.next');
fs.rmSync(nextDir, { recursive: true, force: true });
console.log('[dev:clean] Removed .next cache');
console.log(`[dev:clean] Starting next dev on http://localhost:${port}`);

const child = spawn('npx', ['next', 'dev', '-p', port], {
  cwd: root,
  stdio: 'inherit',
  shell: true,
  env: { ...process.env, PORT: port },
});

child.on('exit', (code) => process.exit(code ?? 0));
