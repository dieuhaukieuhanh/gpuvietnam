import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { join } from 'node:path';

for (const line of readFileSync('.env.local', 'utf8').split(/\r?\n/)) {
  const t = line.trim();
  if (!t || t.startsWith('#')) continue;
  const i = t.indexOf('=');
  if (i <= 0) continue;
  let v = t.slice(i + 1).trim();
  if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
  process.env[t.slice(0, i).trim()] = v;
}

const { CloreClient } = await import(
  pathToFileURL(join(process.cwd(), 'src/lib/gpu/providers/clore/clore-client.js')).href
);

const client = new CloreClient();
const orderId = process.argv[2] || '1940616';
console.log('Cancelling order', orderId, '...');
const result = await client.destroyInstance(orderId);
console.log('Result:', JSON.stringify(result));