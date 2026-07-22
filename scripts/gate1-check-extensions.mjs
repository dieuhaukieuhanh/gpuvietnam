import { readFileSync } from 'fs';
import { CloreClient } from '../src/lib/gpu/providers/clore/clore-client.js';
import { resolveSshTargetFromClore } from '../src/lib/machine-ssh.js';
import ssh2 from 'ssh2';

const { Client } = ssh2;
for (const line of readFileSync('.env.local', 'utf8').split(/\r?\n/)) {
  const t = line.trim();
  if (!t || t.startsWith('#')) continue;
  const i = t.indexOf('=');
  if (i <= 0) continue;
  process.env[t.slice(0, i).trim()] = t.slice(i + 1).trim();
}

const orderId = process.argv[2] || '1970248';
const clore = new CloreClient({ apiKey: process.env.CLORE_AI_KEY });
const order = await clore.getOrder(orderId);
const target = resolveSshTargetFromClore(order, { password: process.env.CLORE_SSH_PASSWORD });
target.password = process.env.CLORE_SSH_PASSWORD;

const conn = await new Promise((resolve, reject) => {
  const c = new Client();
  c.on('ready', () => resolve(c))
    .on('error', reject)
    .connect({
      host: target.host,
      port: target.port,
      username: 'root',
      password: target.password,
      readyTimeout: 30000,
    });
});

const cmd = [
  'curl -sf http://127.0.0.1:8080/api/extensions > /tmp/ext.json',
  'python3 - <<\'PY\'',
  'import json',
  'd=json.load(open("/tmp/ext.json"))',
  'print("count", len(d))',
  'print("gpuvietnam", [x for x in d if "gpuvietnam" in x])',
  'print("has_cp_sync", any("cp_sync" in x for x in d))',
  'PY',
].join('\n');

const out = await new Promise((resolve, reject) => {
  conn.exec(cmd, (e, stream) => {
    if (e) return reject(e);
    let s = '';
    stream.on('data', (d) => {
      s += d;
    });
    stream.stderr.on('data', (d) => {
      s += d;
    });
    stream.on('close', () => resolve(s));
  });
});
conn.end();
console.log(out);
