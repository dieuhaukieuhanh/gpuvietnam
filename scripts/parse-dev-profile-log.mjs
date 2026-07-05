/**
 * Parse dev-profile.log [prof] blocks (post-run helper).
 * Usage: node scripts/parse-dev-profile-log.mjs dev-profile.log
 */
import { readFileSync } from 'node:fs';

const file = process.argv[2] ?? 'dev-profile.log';
const buf = readFileSync(file);
const raw = (buf[0] === 0xff && buf[1] === 0xfe ? buf.toString('utf16le') : buf.toString('utf8')).replace(
  /\r\n/g,
  '\n',
);
const blocks = raw.split('[prof]\n').slice(1);

function parseBlock(block) {
  const metrics = {};
  const totalMatch = block.match(/Dashboard request \((\d+)ms total\)/);
  if (totalMatch) metrics.dashboardTotal = Number(totalMatch[1]);
  for (const line of block.split('\n')) {
    const m = line.match(/(.+?)\s+(\d+)ms\s*$/);
    if (!m) continue;
    let label = m[1].replace(/[^\x20-\x7E]/g, '').replace(/^\s+/, '').trim();
    if (!label || label.includes('Dashboard request')) continue;
    if (label.includes('runReadPathProjectionFirst')) label = 'runReadPathProjectionFirst (call)';
    metrics[label] = Number(m[2]);
  }
  return metrics;
}

function stats(values) {
  const min = Math.min(...values);
  const max = Math.max(...values);
  const avg = Math.round(values.reduce((a, b) => a + b, 0) / values.length);
  return { min, max, avg };
}

const parsed = blocks
  .map((b) => parseBlock(b.split('\n\n')[0]))
  .filter((m) => m.dashboardTotal && m['runReadPathProjectionFirst (call)']);

const last5 = parsed.slice(-5);
console.info(`Parsed ${last5.length} dashboard/me blocks with runReadPathProjectionFirst\n`);

const keys = [
  'dashboardTotal',
  'runReadPathProjectionFirst (call)',
  'Load Machine',
  'Load Subscription',
  'Detect Projection',
  'Drift Queue Enqueue',
  'Projection Verify Queue Enqueue',
  'readRemainingForUser',
  'syncUserPlanInventory (idle)',
];

console.info('| Metric | Min | Max | Avg |');
console.info('|--------|-----|-----|-----|');
for (const key of keys) {
  const values = last5.map((s) => s[key]).filter((v) => typeof v === 'number');
  if (!values.length) continue;
  const { min, max, avg } = stats(values);
  console.info(`| ${key} | ${min} | ${max} | ${avg} |`);
}

console.info('\nSamples:', JSON.stringify(last5, null, 2));
