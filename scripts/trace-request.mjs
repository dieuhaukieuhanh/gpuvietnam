/**
 * Grep structured JSON logs by requestId / Support Code across logs/*.log
 *
 * Usage:
 *   node scripts/trace-request.mjs <requestId>
 *   node scripts/trace-request.mjs REQ-A1B2C3D4
 *   npm run logs:trace -- <requestId>
 */
import { createReadStream, existsSync, readdirSync } from 'node:fs';
import { createInterface } from 'node:readline';
import { join } from 'node:path';

function normalizeQuery(raw) {
  const value = String(raw ?? '').trim();
  if (!value) return '';
  if (/^REQ-/i.test(value)) {
    const compact = value.replace(/^REQ-/i, '').replace(/-/g, '');
    return compact;
  }
  return value;
}

const input = process.argv[2];
if (!input) {
  console.error('Usage: node scripts/trace-request.mjs <requestId|REQ-XXXXXXXX>');
  process.exit(1);
}

const query = normalizeQuery(input);
const logsDir = join(process.cwd(), 'logs');
if (!existsSync(logsDir)) {
  console.error(`No logs directory at ${logsDir}. Start the app once with npm run dev.`);
  process.exit(1);
}

const files = readdirSync(logsDir).filter((f) => f.endsWith('.log'));
/** @type {Array<Record<string, unknown>>} */
const matches = [];

for (const file of files) {
  const path = join(logsDir, file);
  const rl = createInterface({ input: createReadStream(path, { encoding: 'utf8' }), crlfDelay: Infinity });
  for await (const line of rl) {
    if (!line.includes(query) && !line.toLowerCase().includes(String(input).toLowerCase())) continue;
    try {
      const obj = JSON.parse(line);
      matches.push({ file, ...obj });
    } catch {
      matches.push({ file, raw: line });
    }
  }
}

matches.sort((a, b) => String(a.time ?? '').localeCompare(String(b.time ?? '')));

if (matches.length === 0) {
  console.log(`No log lines found for query=${input} (normalized=${query})`);
  process.exit(0);
}

console.log(`Found ${matches.length} line(s) for query=${input}\n`);
for (const row of matches) {
  console.log(JSON.stringify(row));
}
