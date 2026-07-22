/**
 * List / destroy orphan Vast instances.
 *   node tmp/vast-orphan-cleanup.mjs
 *   node tmp/vast-orphan-cleanup.mjs --destroy
 */
import { readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
function loadEnv() {
  const p = join(root, '.env.local');
  if (!existsSync(p)) return;
  for (const line of readFileSync(p, 'utf8').split(/\r?\n/)) {
    const t = line.trim();
    if (!t || t.startsWith('#')) continue;
    const i = t.indexOf('=');
    if (i <= 0) continue;
    let v = t.slice(i + 1).trim();
    if (
      (v.startsWith('"') && v.endsWith('"')) ||
      (v.startsWith("'") && v.endsWith("'"))
    ) {
      v = v.slice(1, -1);
    }
    const k = t.slice(0, i).trim();
    if (process.env[k] == null) process.env[k] = v;
  }
}
loadEnv();

const doDestroy = process.argv.includes('--destroy');
const knownIds = new Set(['45548543', ...process.argv.filter((a) => /^\d{5,}$/.test(a))]);
const VAST_V1 = 'https://console.vast.ai/api/v1';

const { VastClient } = await import('../src/lib/gpu/providers/vast/vast-client.js');
const client = new VastClient();

const selectCols = JSON.stringify([
  'id',
  'label',
  'actual_status',
  'cur_state',
  'intended_status',
  'gpu_name',
  'num_gpus',
  'public_ipaddr',
  'dph_total',
  'status_msg',
]);
const query = new URLSearchParams({
  select_filters: JSON.stringify({}),
  select_cols: selectCols,
  limit: '100',
});

const payload = await client.request('GET', `/instances/?${query.toString()}`, undefined, {
  baseUrl: VAST_V1,
});
const list = Array.isArray(payload?.instances) ? payload.instances : [];

console.log(`Vast instances visible: ${list.length}`);
for (const row of list) {
  console.log(
    JSON.stringify({
      id: String(row.id ?? ''),
      status: row.actual_status ?? row.cur_state ?? null,
      intended: row.intended_status ?? null,
      label: row.label ?? null,
      gpu: row.gpu_name ?? null,
      numGpus: row.num_gpus ?? null,
      ip: row.public_ipaddr ?? null,
      dph: row.dph_total ?? null,
    }),
  );
}

for (const id of knownIds) {
  try {
    const one = await client.getInstance(id);
    console.log(
      'PROBE',
      id,
      one
        ? {
            status: one.actual_status ?? one.cur_state,
            label: one.label,
            ip: one.public_ipaddr,
            num_gpus: one.num_gpus,
          }
        : null,
    );
  } catch (err) {
    console.log('PROBE', id, 'ERR', err instanceof Error ? err.message : err);
  }
}

if (!doDestroy) {
  console.log('\nDry-run. Re-run with --destroy to DELETE orphans (known ids + gv-/gpuvietnam labels).');
  process.exit(0);
}

/** @type {{ id: string }[]} */
const toKill = [];
const seen = new Set();
for (const row of list) {
  const id = String(row.id ?? '');
  const label = String(row.label ?? '').toLowerCase();
  const status = String(row.actual_status ?? row.cur_state ?? '').toLowerCase();
  if (!id || /destroyed/.test(status)) continue;
  if (knownIds.has(id) || label.includes('gpuvietnam') || label.startsWith('gv-')) {
    if (!seen.has(id)) {
      seen.add(id);
      toKill.push({ id });
    }
  }
}
for (const id of knownIds) {
  if (!seen.has(id)) {
    seen.add(id);
    toKill.push({ id });
  }
}

console.log(`\nDestroying ${toKill.length}…`);
for (const { id } of toKill) {
  try {
    await client.destroyInstance(id);
    console.log('DESTROYED', id);
  } catch (err) {
    console.error('FAIL', id, err instanceof Error ? err.message : err);
  }
}
