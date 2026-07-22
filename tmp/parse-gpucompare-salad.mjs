import { readFileSync } from 'node:fs';

for (const label of ['l40s', 'l40']) {
  const html = readFileSync(`tmp/gpucompare-${label}.html`, 'utf8');
  const saladHits = [...html.matchAll(/salad/gi)].length;
  console.log(label, 'saladHits', saladHits);
  const prices = [...html.matchAll(/\$(\d+\.\d{2})\s*\/?\s*h(?:r|our)?/gi)].map((m) => m[1]);
  console.log(label, 'priceSamples', [...new Set(prices)].slice(0, 15));
}
