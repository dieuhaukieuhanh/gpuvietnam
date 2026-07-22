/**
 * Robust Gate-1 inject: one SSH session, write cp_sync, soft-reload Comfy.
 * Usage: node scripts/gate1-inject-cp-sync.mjs [machineId]
 */
import { readFileSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { createClient } from '@supabase/supabase-js';
import ssh2 from 'ssh2';
import { CloreClient } from '../src/lib/gpu/providers/clore/clore-client.js';
import { resolveSshTargetFromClore } from '../src/lib/machine-ssh.js';

const { Client } = ssh2;
const root = join(dirname(fileURLToPath(import.meta.url)), '..');

function loadEnv() {
  const env = { ...process.env };
  const p = join(root, '.env.local');
  if (!existsSync(p)) return env;
  for (const line of readFileSync(p, 'utf8').split('\n')) {
    const t = line.trim();
    if (!t || t.startsWith('#')) continue;
    const i = t.indexOf('=');
    if (i < 0) continue;
    env[t.slice(0, i).trim()] = t.slice(i + 1).trim();
  }
  return env;
}

function connect(target) {
  return new Promise((resolve, reject) => {
    const conn = new Client();
    const timer = setTimeout(() => {
      conn.end();
      reject(new Error('SSH connect timeout'));
    }, 45000);
    conn
      .on('ready', () => {
        clearTimeout(timer);
        resolve(conn);
      })
      .on('error', (err) => {
        clearTimeout(timer);
        reject(err);
      })
      .connect({
        host: target.host,
        port: Number(target.port) || 22,
        username: target.username || 'root',
        password: String(target.password || ''),
        readyTimeout: 40000,
        keepaliveInterval: 10000,
      });
  });
}

function exec(conn, command) {
  return new Promise((resolve, reject) => {
    conn.exec(command, (error, stream) => {
      if (error) return reject(error);
      let stdout = '';
      let stderr = '';
      stream
        .on('close', (code) => resolve({ code, stdout, stderr }))
        .on('data', (d) => {
          stdout += d.toString();
        });
      stream.stderr.on('data', (d) => {
        stderr += d.toString();
      });
    });
  });
}

function writeFile(conn, remotePath, content) {
  return new Promise((resolve, reject) => {
    conn.sftp((error, sftp) => {
      if (error) return reject(error);
      const stream = sftp.createWriteStream(remotePath);
      stream.on('error', reject);
      stream.on('close', () => resolve(true));
      stream.end(content);
    });
  });
}

const env = loadEnv();
for (const [k, v] of Object.entries(env)) {
  if (process.env[k] == null) process.env[k] = v;
}

const machineId = process.argv[2] || '9b3dc18f-ca01-418b-b8b2-3bfd6c501bfd';
const extRoot = join(root, 'comfyui-extensions', 'gpuvietnam_cp_sync');
const initPy = readFileSync(join(extRoot, '__init__.py'));
const syncJs = readFileSync(join(extRoot, 'web', 'cp_sync.js'));

const sb = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY);
const { data: machine, error } = await sb.from('machines').select('*').eq('id', machineId).maybeSingle();
if (error || !machine) {
  console.error('machine load failed', error?.message);
  process.exit(1);
}
console.log('machine', machine.id, machine.status, 'order', machine.instance_id);

let order = null;
for (let attempt = 1; attempt <= 5; attempt++) {
  try {
    const clore = new CloreClient({ apiKey: env.CLORE_AI_KEY || env.CLORE_API_KEY });
    order = await clore.getOrder(String(machine.instance_id));
    break;
  } catch (e) {
    console.warn('getOrder attempt', attempt, e.message || e);
    await new Promise((r) => setTimeout(r, 2000 * attempt));
  }
}
if (!order) {
  console.error('cannot load Clore order');
  process.exit(1);
}

const password = String(env.CLORE_SSH_PASSWORD || '').trim();
const target = resolveSshTargetFromClore(order, { password });
if (!target?.host) {
  console.error('no SSH target');
  process.exit(1);
}
target.password = password;
console.log('SSH', target.host, target.port);

let lastErr = null;
for (let attempt = 1; attempt <= 4; attempt++) {
  let conn = null;
  try {
    console.log('connect attempt', attempt);
    conn = await connect(target);
    const probe = await exec(
      conn,
      'set -e; for d in /app/ComfyUI /workspace/ComfyUI /root/ComfyUI; do if [ -d \"$d/custom_nodes\" ]; then echo BASE=$d; ls \"$d/custom_nodes\" | head; exit 0; fi; done; echo BASE=; ls / | head; exit 2',
    );
    console.log(probe.stdout || probe.stderr);
    const baseMatch = (probe.stdout || '').match(/BASE=(\S+)/);
    const base = baseMatch?.[1];
    if (!base) throw new Error('ComfyUI custom_nodes base not found');

    const remoteBase = `${base}/custom_nodes/gpuvietnam_cp_sync`;
    await exec(conn, `mkdir -p '${remoteBase}/web'`);
    await writeFile(conn, `${remoteBase}/__init__.py`, initPy);
    await writeFile(conn, `${remoteBase}/web/cp_sync.js`, syncJs);
    await exec(conn, `sed -i 's/\\r$//' '${remoteBase}/__init__.py' '${remoteBase}/web/cp_sync.js' && ls -la '${remoteBase}' '${remoteBase}/web'`);

    // Kill + start in separate SSH execs. `pkill -f` suicides when the pattern
    // also appears in the remote bash -c wrapper cmdline.
    const killOut = await exec(
      conn,
      [
        'python3 - <<\'PY\'',
        'import os, signal',
        'for pid in os.listdir("/proc"):',
        '    if not pid.isdigit():',
        '        continue',
        '    try:',
        '        cmd = open(f"/proc/{pid}/cmdline", "rb").read().replace(b"\\0", b" ").decode("utf-8", "ignore")',
        '    except Exception:',
        '        continue',
        '    if "ComfyUI/main.py" in cmd and "python" in cmd:',
        '        os.kill(int(pid), signal.SIGTERM)',
        '        print("KILLED", pid)',
        'print("KILL_DONE")',
        'PY',
        'sleep 2',
      ].join('\n'),
    );
    console.log(killOut.stdout || killOut.stderr);
    const startOut = await exec(
      conn,
      [
        'set +e',
        'cd /app/ComfyUI',
        'nohup python main.py --listen 0.0.0.0 --port 8080 --enable-cors-header "*" >/tmp/comfy-inject-restart.log 2>&1 &',
        'echo RESTART_VIA_MAIN=$!',
        'for i in 1 2 3 4 5 6 7 8 9 10 11 12; do',
        '  code=$(curl -sf -o /dev/null -w "%{http_code}" --max-time 5 http://127.0.0.1:8080/system_stats || echo 000)',
        '  echo WAIT_$i HTTP=$code',
        '  if [ "$code" = "200" ]; then break; fi',
        '  sleep 4',
        'done',
      ].join('\n'),
    );
    console.log(startOut.stdout || startOut.stderr);
    conn.end();
    console.log('INJECT_OK base=', base);
    process.exit(0);
  } catch (e) {
    lastErr = e;
    console.warn('attempt failed', attempt, e.message || e);
    try {
      conn?.end();
    } catch {
      /* ignore */
    }
    await new Promise((r) => setTimeout(r, 2500 * attempt));
  }
}

console.error('INJECT_FAILED', lastErr?.message || lastErr);
process.exit(1);
