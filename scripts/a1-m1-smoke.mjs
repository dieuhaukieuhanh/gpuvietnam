/**
 * A1 M1 smoke: Workspace shell loads without GPU Runtime.
 * Usage: node scripts/a1-m1-smoke.mjs
 * Expects local shell on A1_M1_PORT (default 5191) OR starts checks against LAB.
 */
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const PORT = Number(process.env.A1_M1_PORT || 5191);
const BASE = `http://127.0.0.1:${PORT}`;

async function waitHealth(ms = 15000) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    try {
      const r = await fetch(`${BASE}/health`, { signal: AbortSignal.timeout(2000) });
      if (r.ok) return true;
    } catch {
      /* retry */
    }
    await new Promise((r) => setTimeout(r, 300));
  }
  return false;
}

const fe = join(root, 'workers/comfy-proxy/public/index.html');
if (!existsSync(fe)) {
  console.log('vendoring FE…');
  const v = spawn('node', [join(root, 'scripts/vendor-comfy-frontend.mjs')], {
    cwd: root,
    stdio: 'inherit',
    shell: true,
  });
  await new Promise((resolve, reject) => {
    v.on('exit', (code) => (code === 0 ? resolve() : reject(new Error('vendor failed'))));
  });
}

let child = null;
let healthy = await waitHealth(2000);
if (!healthy) {
  child = spawn(process.execPath, [join(root, 'scripts/a1-m1-local-shell.mjs')], {
    cwd: root,
    stdio: ['ignore', 'pipe', 'pipe'],
    shell: false,
    env: { ...process.env, A1_M1_PORT: String(PORT) },
  });
  child.stderr?.on('data', (b) => process.stderr.write(b));
  child.stdout?.on('data', (b) => process.stdout.write(b));
  healthy = await waitHealth(20000);
}

const results = {};
function pass(id, detail) {
  results[id] = { status: 'PASS', detail };
  console.log('PASS', id, detail);
}
function fail(id, detail) {
  results[id] = { status: 'FAIL', detail };
  console.error('FAIL', id, detail);
}

try {
  if (!healthy) {
    fail('M1_shell_up', 'local shell did not become healthy');
  } else {
    pass('M1_shell_up', { base: BASE });

    const idx = await fetch(`${BASE}/`);
    const html = await idx.text();
    if (idx.ok && /ComfyUI/i.test(html) && /assets\//i.test(html)) {
      pass('M1_index_html', { bytes: html.length });
    } else fail('M1_index_html', { status: idx.status });

    const settings = await fetch(`${BASE}/api/settings`);
    const settingsJson = await settings.json();
    if (settings.ok && settingsJson['Comfy.InstalledVersion']) {
      pass('M1_settings_stub', settingsJson['Comfy.InstalledVersion']);
    } else fail('M1_settings_stub', settings.status);

    const ext = await fetch(`${BASE}/api/extensions`);
    const extJson = await ext.json();
    if (ext.ok && Array.isArray(extJson) && extJson.length === 0) {
      pass('M1_extensions_empty', true);
    } else fail('M1_extensions_empty', extJson);

    const prompt = await fetch(`${BASE}/api/prompt`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prompt: {}, client_id: 'm1' }),
    });
    const promptJson = await prompt.json().catch(() => ({}));
    if (prompt.status === 503 && promptJson.code === 'A1_RUNTIME_OFFLINE') {
      pass('M1_prompt_blocked', promptJson.code);
    } else fail('M1_prompt_blocked', { status: prompt.status, promptJson });

    // Asset from package
    const assetMatch = html.match(/src="\.\/(assets\/[^"]+\.js)"/);
    if (assetMatch) {
      const asset = await fetch(`${BASE}/${assetMatch[1]}`);
      if (asset.ok) pass('M1_asset_js', assetMatch[1]);
      else fail('M1_asset_js', asset.status);
    } else {
      fail('M1_asset_js', 'no asset path in index');
    }
  }
} finally {
  if (child) child.kill();
}

const failed = Object.values(results).filter((r) => r.status === 'FAIL');
console.log(JSON.stringify({ milestone: 'A1-M1', verdict: failed.length ? 'FAIL' : 'PASS', results }, null, 2));
process.exit(failed.length ? 1 : 0);
