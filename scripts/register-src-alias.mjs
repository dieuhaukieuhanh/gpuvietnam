/**
 * Node ESM loader bootstrap: resolve `@/` → `src/`.
 * Usage: node --import ./scripts/register-src-alias.mjs scripts/lifecycle-worker.mjs
 */
import { register } from 'node:module';
import { pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..');
process.env.GPUVIETNAM_SRC_ROOT = join(root, 'src');

register(
  './lifecycle-worker-loader.mjs',
  pathToFileURL(join(here, 'register-src-alias.mjs')),
);
