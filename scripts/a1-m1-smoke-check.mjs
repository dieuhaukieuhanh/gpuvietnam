/** Smoke checks against an already-running a1-m1-local-shell. */
const BASE = process.env.A1_M1_URL || 'http://127.0.0.1:5191';
const results = {};
function pass(id, d) {
  results[id] = { status: 'PASS', detail: d };
  console.log('PASS', id, d);
}
function fail(id, d) {
  results[id] = { status: 'FAIL', detail: d };
  console.error('FAIL', id, d);
}

const health = await fetch(`${BASE}/health`);
const healthJson = await health.json().catch(() => ({}));
if (health.ok && healthJson.ok) pass('M1_shell_up', healthJson);
else fail('M1_shell_up', { status: health.status, healthJson });

const idx = await fetch(`${BASE}/`);
const html = await idx.text();
if (idx.ok && /ComfyUI/i.test(html) && /assets\//i.test(html)) {
  pass('M1_index_html', { bytes: html.length });
} else fail('M1_index_html', { status: idx.status });

const settings = await (await fetch(`${BASE}/api/settings`)).json();
if (settings['Comfy.InstalledVersion']) pass('M1_settings_stub', settings['Comfy.InstalledVersion']);
else fail('M1_settings_stub', settings);

const ext = await (await fetch(`${BASE}/api/extensions`)).json();
if (Array.isArray(ext) && ext.length === 0) pass('M1_extensions_empty', true);
else fail('M1_extensions_empty', ext);

const prompt = await fetch(`${BASE}/api/prompt`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ prompt: {}, client_id: 'm1' }),
});
const promptJson = await prompt.json().catch(() => ({}));
if (prompt.status === 503 && promptJson.code === 'A1_RUNTIME_OFFLINE') {
  pass('M1_prompt_blocked', promptJson.code);
} else fail('M1_prompt_blocked', { status: prompt.status, promptJson });

const assetMatch = html.match(/src="\.\/(assets\/[^"]+\.js)"/);
if (assetMatch) {
  const asset = await fetch(`${BASE}/${assetMatch[1]}`);
  if (asset.ok) pass('M1_asset_js', assetMatch[1]);
  else fail('M1_asset_js', asset.status);
} else fail('M1_asset_js', 'no asset path in index');

const failed = Object.values(results).filter((r) => r.status === 'FAIL');
console.log(
  JSON.stringify(
    { milestone: 'A1-M1', verdict: failed.length ? 'FAIL' : 'PASS', results },
    null,
    2,
  ),
);
process.exit(failed.length ? 1 : 0);
