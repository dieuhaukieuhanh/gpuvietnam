/**
 * Vendor pinned comfyui-frontend-package static → workers/comfy-proxy/public
 * (gitignored). Used by Worker Assets / local M1 smoke.
 *
 * Usage:
 *   node scripts/vendor-comfy-frontend.mjs
 *   node scripts/vendor-comfy-frontend.mjs --src "D:/path/to/static"
 */
import { cpSync, existsSync, mkdirSync, rmSync, writeFileSync, readFileSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const dest = join(root, 'workers/comfy-proxy/public');
const pinPath = join(root, 'workers/comfy-proxy/FE_PIN.txt');

const DEFAULT_SRC = resolve(
  root,
  '../ComfyUI/.venv/Lib/site-packages/comfyui_frontend_package/static',
);

function argValue(flag) {
  const i = process.argv.indexOf(flag);
  if (i >= 0 && process.argv[i + 1]) return process.argv[i + 1];
  return null;
}

const src = resolve(argValue('--src') || process.env.A1_FE_STATIC || DEFAULT_SRC);
if (!existsSync(join(src, 'index.html'))) {
  console.error('FE static not found (need index.html):', src);
  process.exit(1);
}

if (existsSync(dest)) {
  rmSync(dest, { recursive: true, force: true });
}
mkdirSync(dest, { recursive: true });
cpSync(src, dest, { recursive: true });

const pin = {
  package: 'comfyui-frontend-package',
  version: '1.45.21',
  vendoredAt: new Date().toISOString(),
  source: src,
  note: 'A1 M1 Workspace shell — must match Runtime image FE pin',
};
writeFileSync(pinPath, `${pin.version}\nsource=${src}\nvendoredAt=${pin.vendoredAt}\n`);

// Also try to read installed version from adjacent package if present
try {
  const require = createRequire(import.meta.url);
  const pkgJson = join(src, '..', '..', 'comfyui_frontend_package', 'package.json');
  // site-packages/comfyui_frontend_package may not have package.json; ignore
  if (existsSync(join(src, '..', 'package.json'))) {
    const v = JSON.parse(readFileSync(join(src, '..', 'package.json'), 'utf8')).version;
    if (v) pin.version = v;
  }
  void require;
  void pkgJson;
} catch {
  /* ignore */
}

console.log(JSON.stringify({ ok: true, dest, ...pin }, null, 2));
