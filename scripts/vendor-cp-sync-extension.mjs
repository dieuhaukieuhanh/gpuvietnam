/**
 * Copy gpuvietnam_cp_sync web extension into Workspace FE static tree
 * so offline Workspace can load CP sync without GPU Runtime.
 *
 * Usage: node scripts/vendor-cp-sync-extension.mjs
 */
import { copyFileSync, mkdirSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..');
const src = join(root, 'comfyui-extensions/gpuvietnam_cp_sync/web/cp_sync.js');
const destDir = join(
  root,
  'workers/comfy-proxy/public/extensions/gpuvietnam_cp_sync',
);
const dest = join(destDir, 'cp_sync.js');

if (!existsSync(src)) {
  console.error('Missing source', src);
  process.exit(1);
}

mkdirSync(destDir, { recursive: true });
copyFileSync(src, dest);

const pin = {
  source: 'comfyui-extensions/gpuvietnam_cp_sync/web/cp_sync.js',
  dest: 'workers/comfy-proxy/public/extensions/gpuvietnam_cp_sync/cp_sync.js',
  vendoredAt: new Date().toISOString(),
  bytes: readFileSync(dest).length,
};
writeFileSync(join(destDir, 'VENDOR.json'), `${JSON.stringify(pin, null, 2)}\n`);
console.log(JSON.stringify({ ok: true, ...pin }, null, 2));
