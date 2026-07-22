/**
 * Capture ComfyAPI fixtures from a live Runtime (local CPU or GPU).
 * Usage: node labs/a0.5-editor-without-runtime/capture-object-info.mjs [baseUrl]
 */
import { writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const fixtures = join(here, 'fixtures');
const base = (process.argv[2] || 'http://127.0.0.1:8188').replace(/\/$/, '');

mkdirSync(fixtures, { recursive: true });

async function get(path) {
  const res = await fetch(base + path, { signal: AbortSignal.timeout(120_000) });
  const text = await res.text();
  return { status: res.status, text };
}

const paths = [
  ['/object_info', 'object_info.full.json'],
  ['/settings', 'settings.sample.json'],
  ['/extensions', 'extensions.sample.json'],
  ['/users', 'users.sample.json'],
  ['/system_stats', 'system_stats.sample.json'],
];

for (const [path, file] of paths) {
  const r = await get(path);
  if (r.status !== 200) throw new Error(`${path} → ${r.status}`);
  writeFileSync(join(fixtures, file), r.text);
  console.log('wrote', file, r.text.length);
}

const oi = JSON.parse((await get('/object_info')).text);
const corePrefer = [
  'CheckpointLoaderSimple',
  'CLIPTextEncode',
  'EmptyLatentImage',
  'KSampler',
  'VAEDecode',
  'SaveImage',
  'PreviewImage',
  'Note',
  'EmptyImage',
  'LoadImage',
];
/** Offline catalog: built-in nodes only (no custom_nodes.*), capped. */
const curated = {};
for (const k of corePrefer) {
  if (oi[k]) curated[k] = oi[k];
}
for (const k of Object.keys(oi).sort()) {
  if (k.includes('.')) continue;
  if (curated[k]) continue;
  curated[k] = oi[k];
  if (Object.keys(curated).length >= 120) break;
}
writeFileSync(join(fixtures, 'object_info.offline.json'), JSON.stringify(curated));
console.log({
  base,
  fullNodes: Object.keys(oi).length,
  curatedNodes: Object.keys(curated).length,
  hasCore: corePrefer.filter((k) => Boolean(oi[k])),
  fixturesExist: existsSync(join(fixtures, 'object_info.offline.json')),
});
