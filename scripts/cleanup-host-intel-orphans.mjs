/**
 * One-shot: destroy live Vast instances labeled gpuvietnam-host-intel (ops probes).
 * Usage: node scripts/cleanup-host-intel-orphans.mjs [--force]
 *   without --force: destroy only age >= grace (default 10m)
 *   with --force: destroy all matching label regardless of age
 */
import { VastClient } from '../src/lib/gpu/providers/vast/vast-client.js';
import {
  normalizeVastHostIntelInstance,
  classifyVastHostIntelOrphans,
  resolveVastHostIntelOrphanGraceMs,
} from '../src/lib/gpu/providers/vast/vast-host-intel-orphan.js';
import { HOST_INTEL_VAST_LABEL } from '../src/lib/gpu/host-reputation/host-intel-runtime.js';

const force = process.argv.includes('--force');
const client = new VastClient();
if (!client.apiKey) {
  console.error('Missing VAST_AI_KEY');
  process.exit(1);
}

const rows = await client.listInstancesByLabel(HOST_INTEL_VAST_LABEL);
const normalized = rows.map((r) => normalizeVastHostIntelInstance(r)).filter(Boolean);
const graceMs = force ? 0 : resolveVastHostIntelOrphanGraceMs();
const decisions = classifyVastHostIntelOrphans(normalized, { graceMs, nowMs: Date.now() });

console.log(
  JSON.stringify(
    {
      label: HOST_INTEL_VAST_LABEL,
      force,
      graceMs,
      listed: normalized.length,
      decisions,
    },
    null,
    2,
  ),
);

let destroyed = 0;
for (const d of decisions) {
  if (!force && d.action !== 'destroy') continue;
  try {
    await client.destroyInstance(d.id);
    destroyed += 1;
    console.log(`destroyed ${d.id}`);
  } catch (err) {
    console.error(`destroy failed ${d.id}:`, err instanceof Error ? err.message : err);
  }
}
console.log(`done destroyed=${destroyed}`);
