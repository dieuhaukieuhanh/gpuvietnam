import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

function loadEnvLocal() {
  const text = readFileSync(join(process.cwd(), '.env.local'), 'utf8');
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq <= 0) continue;
    const key = trimmed.slice(0, eq).trim();
    let value = trimmed.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (process.env[key] == null) process.env[key] = value;
  }
}

loadEnvLocal();
const key = (process.env.CLORE_API_KEY || process.env.CLORE_AI_KEY || '').trim();
const response = await fetch('https://api.clore.ai/v1/marketplace', {
  headers: { auth: key, Accept: 'application/json' },
});
const payload = await response.json();
const servers = payload.servers || [];

let hasUsdPrice = 0;
let allowedUsd = 0;
let both = 0;
let priceButNotAllowed = 0;
const samples = [];
const both3090 = [];

for (const s of servers) {
  if (s.rented) continue;
  const price = Number(s?.price?.on_demand?.['USD-Blockchain'] || 0) > 0;
  const allowed =
    Array.isArray(s.allowed_coins) && s.allowed_coins.includes('USD-Blockchain');
  if (price) hasUsdPrice += 1;
  if (allowed) allowedUsd += 1;
  if (price && allowed) {
    both += 1;
    const gpu = String(s?.specs?.gpu || '') + ' ' + String(s?.gpu_array || '');
    if (/3090/.test(gpu)) {
      both3090.push({
        id: s.id,
        gpu: s.specs?.gpu,
        daily: s.price.on_demand['USD-Blockchain'],
        allowed: s.allowed_coins,
      });
    }
  }
  if (price && !allowed) {
    priceButNotAllowed += 1;
    if (samples.length < 8) {
      samples.push({
        id: s.id,
        gpu: s.specs?.gpu,
        daily: s.price.on_demand['USD-Blockchain'],
        allowed: s.allowed_coins,
      });
    }
  }
}

both3090.sort((a, b) => a.daily - b.daily);
const report = {
  at: new Date().toISOString(),
  total: servers.length,
  hasUsdPrice,
  allowedUsd,
  both,
  priceButNotAllowed,
  samples,
  both3090Top: both3090.slice(0, 10),
  both3090Count: both3090.length,
};
mkdirSync('tmp', { recursive: true });
writeFileSync('tmp/clore-allowed-coins.json', JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 2));
