#!/usr/bin/env node
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { fileURLToPath } from 'url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const authPath = path.join(
  process.env.APPDATA || '',
  'xdg.data',
  'com.vercel.cli',
  'auth.json',
);
const auth = JSON.parse(fs.readFileSync(authPath, 'utf8'));
const project = JSON.parse(fs.readFileSync(path.join(root, '.vercel/project.json'), 'utf8'));
const token = auth.token;
const projectId = project.projectId;
const teamId = project.orgId;

const skip = new Set([
  'VERCEL_OIDC_TOKEN',
  'VAST_SSH_PRIVATE_KEY_PATH',
  'GPU_CLORE_ONLY',
  'SUPABASE_DB_URL',
  'SMOKE_TEST_VAR',
  'VAST_SSH_PRIVATE_KEY',
]);

const map = {};
for (const line of fs.readFileSync(path.join(root, '.env.local'), 'utf8').split(/\r?\n/)) {
  if (!line || line.trim().startsWith('#')) continue;
  const i = line.indexOf('=');
  if (i < 1) continue;
  const name = line.slice(0, i).trim();
  let val = line.slice(i + 1).trim();
  if (
    (val.startsWith('"') && val.endsWith('"')) ||
    (val.startsWith("'") && val.endsWith("'"))
  ) {
    val = val.slice(1, -1);
  }
  if (!val || skip.has(name)) continue;
  map[name] = val.trim();
}

map.NEXT_PUBLIC_APP_URL = 'https://app.gpuvietnam.com';
map.NEXT_PUBLIC_SITE_URL = 'https://app.gpuvietnam.com';
map.GPUVIETNAM_PUBLIC_API_URL = 'https://app.gpuvietnam.com';
map.CRON_SECRET = crypto.randomBytes(24).toString('base64url');

const qs = new URLSearchParams({ teamId });
const listRes = await fetch(
  `https://api.vercel.com/v9/projects/${projectId}/env?${qs}`,
  { headers: { Authorization: `Bearer ${token}` } },
);
const listed = await listRes.json();
const byKey = new Map();
for (const env of listed.envs || []) {
  if (!byKey.has(env.key)) byKey.set(env.key, []);
  byKey.get(env.key).push(env);
}

let ok = 0;
let fail = 0;
for (const [key, value] of Object.entries(map)) {
  const existing = byKey.get(key) || [];
  let res;
  if (existing.length > 0) {
    // Remove all existing rows for this key, then recreate once.
    for (const env of existing) {
      await fetch(`https://api.vercel.com/v9/projects/${projectId}/env/${env.id}?${qs}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}` },
      });
    }
  }
  res = await fetch(`https://api.vercel.com/v10/projects/${projectId}/env?${qs}`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      key,
      value,
      type: 'encrypted',
      target: ['production', 'preview'],
    }),
  });
  if (res.ok) {
    ok += 1;
    console.log('OK', key);
  } else {
    fail += 1;
    const body = await res.text();
    console.log('FAIL', key, res.status, body.slice(0, 200));
  }
}

console.log(`done ok=${ok} fail=${fail} keys=${Object.keys(map).length}`);
if (fail > 0) process.exit(1);
