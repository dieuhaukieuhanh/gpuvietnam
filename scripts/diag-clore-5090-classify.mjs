import { readFileSync, writeFileSync } from 'node:fs';
import { classifyCloreServerForLine } from '../src/lib/gpu/providers/clore/clore-client.js';

for (const line of readFileSync('.env.local', 'utf8').split(/\r?\n/)) {
  const t = line.trim();
  if (!t || t.startsWith('#')) continue;
  const i = t.indexOf('=');
  if (i <= 0) continue;
  let v = t.slice(i + 1).trim();
  if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
  const k = t.slice(0, i).trim();
  if (!process.env[k]) process.env[k] = v;
}

const key = process.env.CLORE_AI_KEY;
const res = await fetch('https://api.clore.ai/v1/marketplace', {
  headers: { Accept: 'application/json', auth: key },
});
const data = await res.json();
const servers = data.servers || [];
const hit5090 = servers.filter((s) => {
  const arr = Array.isArray(s.gpu_array) ? s.gpu_array.join(' ') : '';
  const specs = String(s.specs?.gpu ?? '');
  return /5090/i.test(`${arr} ${specs}`);
});
console.log('servers', servers.length, 'name5090', hit5090.length);
const samples = [];
for (const s of hit5090.slice(0, 15)) {
  const c = classifyCloreServerForLine(s, 'rtx5090_1x');
  samples.push({
    id: s.id,
    rented: s.rented,
    gpu_array: s.gpu_array,
    gpu: s.specs?.gpu,
    gpuram: s.specs?.gpuram,
    reliability: s.reliability,
    classified: c,
  });
}
const ok = hit5090.filter((s) => classifyCloreServerForLine(s, 'rtx5090_1x'));
console.log('classified ok', ok.length);
writeFileSync('tmp/clore-5090-classify-debug.json', JSON.stringify({ hit5090: hit5090.length, ok: ok.length, samples }, null, 2));
console.log(JSON.stringify(samples.slice(0, 8), null, 2));
