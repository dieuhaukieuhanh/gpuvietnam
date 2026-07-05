/**
 * Verify Projection-first is default and profiler shows ReadPath = Projection.
 */
import assert from 'node:assert/strict';
import { withProf, renderProfTree } from '../src/lib/prof.js';
import {
  getReadPathMode,
  getReadPathProfilerLabel,
  isScbReadProjectionFirst,
  logArchitectureFreezeStartup,
} from '../src/lib/scb-read-path.js';

function snapshotEnv(name) {
  const value = process.env[name];
  return value === undefined ? '(unset)' : value;
}

console.info('--- Projection-first default verification ---');
console.info('SCB_READ_PROJECTION_FIRST before:', snapshotEnv('SCB_READ_PROJECTION_FIRST'));

delete process.env.SCB_READ_PROJECTION_FIRST;
assert.equal(isScbReadProjectionFirst(), true, 'unset must default to Projection-first');
assert.equal(getReadPathMode(), 'Projection-first');
assert.equal(getReadPathProfilerLabel(), 'Projection');

process.env.SCB_READ_PROJECTION_FIRST = '1';
assert.equal(isScbReadProjectionFirst(), true);

process.env.SCB_READ_PROJECTION_FIRST = '0';
assert.equal(isScbReadProjectionFirst(), false);
assert.equal(getReadPathProfilerLabel(), 'Legacy');

delete process.env.SCB_READ_PROJECTION_FIRST;
console.info('SCB_READ_PROJECTION_FIRST after reset:', snapshotEnv('SCB_READ_PROJECTION_FIRST'));
assert.equal(isScbReadProjectionFirst(), true);

logArchitectureFreezeStartup();

await withProf('dashboard/me simulation', async () => {
  const tree = renderProfTree();
  assert.match(tree, /^ReadPath = Projection/m, 'profiler must show ReadPath = Projection');
  console.info('[prof]\n' + tree);
});

console.info('PASS: Projection-first default + profiler label verified.');
console.info('Expected HTTP path (default): dashboard/me → runReadPathProjectionFirst → DB → Response');
console.info('Manual: restart dev server; confirm no [vast/getInstance] on GET /api/dashboard/me');
