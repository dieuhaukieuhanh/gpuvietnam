/**
 * Ensure logs/ directory and channel files exist before next dev/start.
 */
import { mkdirSync, openSync, closeSync } from 'node:fs';
import { join } from 'node:path';

const FILES = ['app.log', 'api.log', 'worker.log', 'provider.log', 'error.log'];

const dir = join(process.cwd(), 'logs');
mkdirSync(dir, { recursive: true });
for (const name of FILES) {
  const fd = openSync(join(dir, name), 'a');
  closeSync(fd);
}
console.log(`[ensure-logs-dir] ready: ${dir}`);
