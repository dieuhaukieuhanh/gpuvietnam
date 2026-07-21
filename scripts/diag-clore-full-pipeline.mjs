/**
 * Mirror exact Dashboard flow — provisionGpuInstance with GPU_CLORE_ONLY.
 * Usage: node scripts/diag-clore-full-pipeline.mjs [gpuLine] [plan]
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
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

const gpuLine = process.argv[2] || 'rtx3090';
const plan = process.argv[3] || 'starter';

console.log('GPU_CLORE_ONLY =', process.env.GPU_CLORE_ONLY);
console.log('CLORE_API_KEY =', (process.env.CLORE_API_KEY || '').slice(0, 8) + '...');

const { provisionGpuInstance, bootstrapProviderRegistry } = await import(
  pathToFileURL(join(process.cwd(), 'src/lib/gpu/index.js')).href
);

bootstrapProviderRegistry();

try {
  const result = await provisionGpuInstance(null, {
    gpuLine,
    plan,
    label: 'diag-full-' + Date.now(),
  });
  console.log('✅ SUCCESS:', JSON.stringify({ id: result.id, provider: result.providerId }, null, 2));

  // Cancel the order
  const { CloreClient } = await import(
    pathToFileURL(join(process.cwd(), 'src/lib/gpu/providers/clore/clore-client.js')).href
  );
  const client = new CloreClient();
  if (result.id) {
    await new Promise((r) => setTimeout(r, 5500));
    const cancel = await client.destroyInstance(String(result.id));
    console.log('Cancel result:', JSON.stringify(cancel));
  }
} catch (error) {
  console.error('❌ FAILED:', error.message);
  console.error('Stack:', error.stack?.split('\n').slice(0, 6).join('\n'));
}