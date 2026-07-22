import { readFileSync, existsSync } from 'node:fs';
import crypto from 'node:crypto';

function loadEnv() {
  if (!existsSync('.env.local')) return;
  for (const line of readFileSync('.env.local', 'utf8').split(/\r?\n/)) {
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
    process.env[t.slice(0, i).trim()] = v;
  }
}
loadEnv();

const secret = process.env.COMFY_PROXY_SECRET;
const token = process.argv[2] || 'gvc.4KY0sxwHqYVub0mUjwCFRTVc8aL0cmZo';

const publicApp = String(process.env.NEXT_PUBLIC_APP_URL || '').replace(/\/$/, '');
const urls = [
  `http://127.0.0.1:3000/api/internal/comfy-proxy-resolve?token=${encodeURIComponent(token)}`,
];
if (publicApp) {
  urls.push(
    `${publicApp}/api/internal/comfy-proxy-resolve?token=${encodeURIComponent(token)}`,
  );
}

for (const u of urls) {
  const res = await fetch(u, {
    headers: { Authorization: `Bearer ${secret}`, Accept: 'application/json' },
  });
  const text = await res.text();
  console.log('---', res.status, u);
  console.log(text.slice(0, 400));
}

const hash = crypto.createHash('sha256').update(token, 'utf8').digest('hex');
const key = `comfy:${hash}`;
const kvUrl = `https://api.cloudflare.com/client/v4/accounts/${process.env.CF_ACCOUNT_ID}/storage/kv/namespaces/${process.env.CF_KV_NAMESPACE_ID}/values/${encodeURIComponent(key)}?expiration_ttl=3600`;
const kvRes = await fetch(kvUrl, {
  method: 'PUT',
  headers: {
    Authorization: `Bearer ${process.env.CF_API_TOKEN}`,
    'Content-Type': 'application/json',
  },
  body: JSON.stringify({
    upstream: 'https://1t1z1xtdrn2c0.us.clorecloud.net',
    userId: 'x',
    machineId: 'y',
    exp: Math.floor(Date.now() / 1000) + 3600,
  }),
});
console.log('KV put', kvRes.status, (await kvRes.text()).slice(0, 500));

const enter = await fetch(`https://work.gpuvietnam.com/enter/${encodeURIComponent(token)}`, {
  redirect: 'manual',
});
console.log('enter', enter.status, enter.headers.get('location'), (await enter.text()).slice(0, 200));
