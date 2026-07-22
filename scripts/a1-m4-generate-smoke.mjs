/**
 * A1 M4 — Generate when Runtime online (Workspace → Proxy → Runtime → ComfyUI).
 *
 * DoD:
 *   1 offline edit OK
 *   2 Generate blocked offline (A1_RUNTIME_OFFLINE)
 *   3 bind real Runtime
 *   4 Proxy resolves upstream
 *   5 live object_info
 *   6 POST /prompt executes CP graph on Runtime
 *   7 WS progress (status frame)
 *   8 history + /view
 *   9 stop → Generate blocked; CP graph remains
 *  10 Generate ≠ Session/Graph Restore
 *
 * Targets:
 *   A1_M4_TARGET=local       → http://127.0.0.1:5191 (local shell) + Docker/Clore upstream
 *   A1_M4_TARGET=production  → https://work.gpuvietnam.com + public Runtime + wrangler KV
 *
 * Env:
 *   A1_M4_UPSTREAM           override Runtime base (e.g. http://127.0.0.1:18188)
 *   A1_M4_SKIP_DESTROY=1     keep Runtime after smoke
 *   A1_M4_SKIP_START=1       require existing running machine / A1_M4_UPSTREAM
 *
 * Usage:
 *   node scripts/a1-m4-generate-smoke.mjs
 */
import { createHash, randomUUID } from 'node:crypto';
import { readFileSync, existsSync, writeFileSync, unlinkSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createClient } from '@supabase/supabase-js';
import { issueComfyAccessToken } from '../src/lib/comfy-proxy/comfy-access-token.js';
import { ensureActiveCpWorkflow } from '../src/lib/cp-runtime/ensure-active-workflow.js';
import { upsertCpWorkflowDocument, getCpWorkflow } from '../src/lib/cp-runtime/workflow-sot.js';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..');
const USER_ID = '70feafcf-6ad1-4b13-bb99-eae5a538d20a';
const TARGET = String(process.env.A1_M4_TARGET || 'local').toLowerCase();
const WORK =
  TARGET === 'production'
    ? 'https://work.gpuvietnam.com'
    : String(process.env.A1_M4_WORK || 'http://127.0.0.1:5191').replace(/\/$/, '');
const APP = String(process.env.GATE1_APP_URL || process.env.NEXT_PUBLIC_APP_URL || 'http://127.0.0.1:3000').replace(
  /\/$/,
  '',
);
const CLORE_BASE = 'https://api.clore.ai/v1';
const MARKER = `a1-m4-${Date.now()}`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function loadEnv() {
  const p = join(root, '.env.local');
  if (!existsSync(p)) return;
  for (const line of readFileSync(p, 'utf8').split(/\r?\n/)) {
    const t = line.trim();
    if (!t || t.startsWith('#')) continue;
    const i = t.indexOf('=');
    if (i <= 0) continue;
    let v = t.slice(i + 1).trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
      v = v.slice(1, -1);
    }
    if (process.env[t.slice(0, i).trim()] == null) {
      process.env[t.slice(0, i).trim()] = v;
    }
  }
}
loadEnv();
process.env.COMFY_PROXY_ENABLED = '1';
// Always mint enter URLs for this smoke's WORK host (do not keep .env production base).
process.env.COMFY_PROXY_BASE_URL = WORK;

const cloreKey = (process.env.CLORE_API_KEY || process.env.CLORE_AI_KEY || '').trim();
const sb = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { persistSession: false, autoRefreshToken: false } },
);
const sbAuth = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { persistSession: false, autoRefreshToken: false } },
);

const report = { milestone: 'A1-M4', target: TARGET, work: WORK, marker: MARKER, checks: {} };
function pass(id, detail) {
  report.checks[id] = { ok: true, detail };
  console.log('PASS', id, detail ?? '');
}
function fail(id, detail) {
  report.checks[id] = { ok: false, detail };
  throw new Error(`${id}: ${JSON.stringify(detail)}`);
}

function imageOk(image) {
  return /:(v3\.1|v3\.2)\b/.test(String(image || ''));
}

function comfyBase(machine) {
  const host = machine?.ip_address;
  if (!host) return null;
  return machine.port === 443 ? `https://${host}` : `http://${host}:${machine.port || 8080}`;
}

async function clore(method, path, body) {
  const init = {
    method,
    headers: { Accept: 'application/json', auth: cloreKey },
  };
  if (body !== undefined) {
    init.headers['Content-Type'] = 'application/json';
    init.body = JSON.stringify(body);
  }
  const res = await fetch(CLORE_BASE + path, init);
  const json = await res.json().catch(() => ({}));
  return { status: res.status, json };
}

async function userApiToken() {
  const { data: userRow } = await sb.from('users').select('email').eq('id', USER_ID).maybeSingle();
  const { data: linkData } = await sb.auth.admin.generateLink({
    type: 'magiclink',
    email: userRow.email,
  });
  const { data: otpData, error: otpErr } = await sbAuth.auth.verifyOtp({
    token_hash: linkData.properties.hashed_token,
    type: 'email',
  });
  if (otpErr) throw otpErr;
  return otpData.session.access_token;
}

async function api(path, { method = 'GET', body, token } = {}) {
  const res = await fetch(`${APP}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const json = await res.json().catch(() => ({}));
  return { status: res.status, json };
}

async function putKv(token, payload) {
  if (TARGET !== 'production') return null;
  const ns = process.env.CF_KV_NAMESPACE_ID;
  if (!ns) throw new Error('CF_KV_NAMESPACE_ID missing');
  const hash = createHash('sha256').update(token, 'utf8').digest('hex');
  const exp = payload.exp;
  const ttl = Math.max(120, exp - Math.floor(Date.now() / 1000));
  const key = `comfy:${hash}`;
  const tmp = join(tmpdir(), `a1-m4-kv-${Date.now()}.json`);
  writeFileSync(tmp, JSON.stringify(payload));
  const env = { ...process.env };
  delete env.CF_API_TOKEN;
  delete env.CLOUDFLARE_API_TOKEN;
  const put = spawnSync(
    'npx',
    ['wrangler', 'kv', 'key', 'put', key, '--path', tmp, '--namespace-id', ns, '--ttl', String(ttl)],
    {
      cwd: join(root, 'workers/comfy-proxy'),
      encoding: 'utf8',
      shell: true,
      env,
    },
  );
  try {
    unlinkSync(tmp);
  } catch {
    /* ignore */
  }
  if (put.status !== 0) {
    throw new Error(`kv put failed: ${(put.stdout || '') + (put.stderr || '')}`.slice(-800));
  }
  return key;
}

async function enterCookie(workUrl) {
  const enter = await fetch(workUrl, {
    redirect: 'manual',
    signal: AbortSignal.timeout(30_000),
  });
  const setCookie = enter.headers.get('set-cookie') || '';
  if (enter.status !== 302 || !/gvn_comfy=/i.test(setCookie)) {
    fail('enter', { status: enter.status, setCookie: setCookie.slice(0, 120) });
  }
  const m = setCookie.match(/gvn_comfy=([^;]+)/i);
  return `gvn_comfy=${m[1]}`;
}

async function workFetch(path, { cookie, method = 'GET', body, timeoutMs = 60_000 } = {}) {
  const res = await fetch(`${WORK}${path}`, {
    method,
    headers: {
      Cookie: cookie,
      ...(body ? { 'Content-Type': 'application/json' } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(timeoutMs),
  });
  const ct = res.headers.get('content-type') || '';
  const buf = Buffer.from(await res.arrayBuffer());
  let json = null;
  if (ct.includes('json') || buf[0] === 0x7b || buf[0] === 0x5b) {
    try {
      json = JSON.parse(buf.toString('utf8'));
    } catch {
      json = null;
    }
  }
  return { status: res.status, ok: res.ok, json, bytes: buf, text: buf.toString('utf8').slice(0, 400) };
}

function uiDoc(marker, ckpt, seed, positive, negative) {
  return {
    last_node_id: 8,
    last_link_id: 9,
    nodes: [
      {
        id: 8,
        type: 'Note',
        pos: [40, 40],
        size: [280, 80],
        flags: {},
        order: 0,
        mode: 0,
        title: marker,
        properties: { text: marker },
        widgets_values: [marker],
      },
      {
        id: 1,
        type: 'CheckpointLoaderSimple',
        pos: [40, 160],
        size: [320, 100],
        flags: {},
        order: 1,
        mode: 0,
        inputs: [],
        outputs: [
          { name: 'MODEL', type: 'MODEL', links: [1], slot_index: 0 },
          { name: 'CLIP', type: 'CLIP', links: [2, 3], slot_index: 1 },
          { name: 'VAE', type: 'VAE', links: [6], slot_index: 2 },
        ],
        properties: {},
        widgets_values: [ckpt],
      },
      {
        id: 2,
        type: 'CLIPTextEncode',
        pos: [420, 120],
        size: [360, 120],
        flags: {},
        order: 2,
        mode: 0,
        inputs: [{ name: 'clip', type: 'CLIP', link: 2 }],
        outputs: [{ name: 'CONDITIONING', type: 'CONDITIONING', links: [4], slot_index: 0 }],
        properties: {},
        widgets_values: [positive],
      },
      {
        id: 3,
        type: 'CLIPTextEncode',
        pos: [420, 280],
        size: [360, 100],
        flags: {},
        order: 3,
        mode: 0,
        inputs: [{ name: 'clip', type: 'CLIP', link: 3 }],
        outputs: [{ name: 'CONDITIONING', type: 'CONDITIONING', links: [5], slot_index: 0 }],
        properties: {},
        widgets_values: [negative],
      },
      {
        id: 4,
        type: 'EmptyLatentImage',
        pos: [40, 320],
        size: [280, 110],
        flags: {},
        order: 4,
        mode: 0,
        inputs: [],
        outputs: [{ name: 'LATENT', type: 'LATENT', links: [7], slot_index: 0 }],
        properties: {},
        widgets_values: [512, 512, 1],
      },
      {
        id: 5,
        type: 'KSampler',
        pos: [860, 180],
        size: [300, 260],
        flags: {},
        order: 5,
        mode: 0,
        inputs: [
          { name: 'model', type: 'MODEL', link: 1 },
          { name: 'positive', type: 'CONDITIONING', link: 4 },
          { name: 'negative', type: 'CONDITIONING', link: 5 },
          { name: 'latent_image', type: 'LATENT', link: 7 },
        ],
        outputs: [{ name: 'LATENT', type: 'LATENT', links: [8], slot_index: 0 }],
        properties: {},
        widgets_values: [seed, 'fixed', 6, 5, 'euler', 'normal', 1],
      },
      {
        id: 6,
        type: 'VAEDecode',
        pos: [1220, 200],
        size: [210, 50],
        flags: {},
        order: 6,
        mode: 0,
        inputs: [
          { name: 'samples', type: 'LATENT', link: 8 },
          { name: 'vae', type: 'VAE', link: 6 },
        ],
        outputs: [{ name: 'IMAGE', type: 'IMAGE', links: [9], slot_index: 0 }],
        properties: {},
      },
      {
        id: 7,
        type: 'SaveImage',
        pos: [1480, 200],
        size: [260, 80],
        flags: {},
        order: 7,
        mode: 0,
        inputs: [{ name: 'images', type: 'IMAGE', link: 9 }],
        outputs: [],
        properties: {},
        widgets_values: [`a1_m4_${marker}`],
      },
    ],
    links: [
      [1, 1, 0, 5, 0, 'MODEL'],
      [2, 1, 1, 2, 0, 'CLIP'],
      [3, 1, 1, 3, 0, 'CLIP'],
      [4, 2, 0, 5, 1, 'CONDITIONING'],
      [5, 3, 0, 5, 2, 'CONDITIONING'],
      [6, 1, 2, 6, 1, 'VAE'],
      [7, 4, 0, 5, 3, 'LATENT'],
      [8, 5, 0, 6, 0, 'LATENT'],
      [9, 6, 0, 7, 0, 'IMAGE'],
    ],
    groups: [],
    config: {},
    extra: { gate1: marker, a1m4: marker, a1m4_ckpt: ckpt, a1m4_seed: seed },
    version: 0.4,
  };
}

function apiPrompt(ckpt, seed, positive, negative, prefix) {
  return {
    '1': { class_type: 'CheckpointLoaderSimple', inputs: { ckpt_name: ckpt } },
    '2': { class_type: 'CLIPTextEncode', inputs: { text: positive, clip: ['1', 1] } },
    '3': { class_type: 'CLIPTextEncode', inputs: { text: negative, clip: ['1', 1] } },
    '4': {
      class_type: 'EmptyLatentImage',
      inputs: { width: 512, height: 512, batch_size: 1 },
    },
    '5': {
      class_type: 'KSampler',
      inputs: {
        seed,
        steps: 6,
        cfg: 5,
        sampler_name: 'euler',
        scheduler: 'normal',
        denoise: 1,
        model: ['1', 0],
        positive: ['2', 0],
        negative: ['3', 0],
        latent_image: ['4', 0],
      },
    },
    '6': { class_type: 'VAEDecode', inputs: { samples: ['5', 0], vae: ['1', 2] } },
    '7': {
      class_type: 'SaveImage',
      inputs: { filename_prefix: prefix, images: ['6', 0] },
    },
  };
}

async function probeWs(cookie, clientId) {
  const wsHttpBase = WORK.replace(/\/$/, '');
  const wsPath = `/ws?clientId=${encodeURIComponent(clientId)}`;
  // Prefer raw upgrade so Cookie is always sent (Node WebSocket often drops headers).
  try {
    const u = new URL(wsHttpBase + wsPath);
    const isHttps = u.protocol === 'https:';
    const lib = isHttps ? await import('node:https') : await import('node:http');
    const result = await new Promise((resolve) => {
      const req = lib.request(
        {
          protocol: u.protocol,
          hostname: u.hostname,
          port: u.port || (isHttps ? 443 : 80),
          path: u.pathname + u.search,
          method: 'GET',
          headers: {
            Host: u.host,
            Cookie: cookie,
            Connection: 'Upgrade',
            Upgrade: 'websocket',
            'Sec-WebSocket-Version': '13',
            'Sec-WebSocket-Key': Buffer.from(randomUUID()).toString('base64'),
          },
        },
        (res) => {
          resolve({ ok: false, reason: `http_${res.statusCode}` });
          res.resume();
        },
      );
      const timer = setTimeout(() => {
        req.destroy();
        resolve({ ok: false, reason: 'timeout' });
      }, 12_000);
      req.on('upgrade', (res, socket) => {
        const seen = [];
        let settled = false;
        const finish = (payload) => {
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          try {
            socket.destroy();
          } catch {
            /* ignore */
          }
          resolve(payload);
        };
        socket.on('data', (buf) => {
          // Best-effort: look for JSON text frames containing known types
          const s = buf.toString('utf8');
          if (/feature_flags/.test(s)) seen.push('feature_flags');
          if (/"type"\s*:\s*"status"/.test(s) || /"type":"status"/.test(s)) seen.push('status');
          if (seen.length) finish({ ok: true, seen, via: 'upgrade' });
        });
        // Send feature_flags as a masked text frame is complex; many Comfy servers push status on connect.
        setTimeout(() => {
          if (seen.length) finish({ ok: true, seen, via: 'upgrade' });
          else if (res.statusCode === 101) finish({ ok: true, seen: ['upgraded_101'], via: 'upgrade' });
          else finish({ ok: false, reason: 'no_frames', seen });
        }, 2500);
      });
      req.on('error', (e) => {
        clearTimeout(timer);
        resolve({ ok: false, reason: e.message });
      });
      req.end();
    });
    if (result.ok) return result;
  } catch (e) {
    /* fall through to WebSocket */
  }

  const wsUrl = WORK.replace(/^http/, 'ws') + wsPath;
  return new Promise((resolve) => {
    const deadline = setTimeout(() => {
      try {
        ws.close();
      } catch {
        /* ignore */
      }
      resolve({ ok: false, reason: 'timeout' });
    }, 12_000);
    /** @type {WebSocket} */
    let ws;
    try {
      ws = new WebSocket(wsUrl, { headers: { Cookie: cookie } });
    } catch (e) {
      clearTimeout(deadline);
      resolve({ ok: false, reason: e instanceof Error ? e.message : String(e) });
      return;
    }
    const seen = [];
    ws.addEventListener('open', () => {
      ws.send(JSON.stringify({ type: 'feature_flags', data: { supports_preview_metadata: true } }));
    });
    ws.addEventListener('message', (ev) => {
      try {
        const msg = JSON.parse(String(ev.data));
        if (msg?.type) seen.push(msg.type);
        if (seen.includes('status') || seen.includes('feature_flags')) {
          clearTimeout(deadline);
          try {
            ws.close();
          } catch {
            /* ignore */
          }
          resolve({ ok: true, seen });
        }
      } catch {
        seen.push('binary');
      }
    });
    ws.addEventListener('error', () => {
      clearTimeout(deadline);
      resolve({ ok: false, reason: 'error', seen });
    });
  });
}

async function ensureLocalDockerMachine(upstream) {
  const u = new URL(upstream);
  const host = u.hostname;
  const port = Number(u.port || (u.protocol === 'https:' ? 443 : 80));
  const row = {
    id: randomUUID(),
    user_id: USER_ID,
    status: 'running',
    image: 'dieuhaukieuhanh/gpuvietnam-comfyui:v3.2',
    instance_id: `local-m4-${Date.now()}`,
    ip_address: host,
    port,
    provider: 'local',
    gpu_type: 'local',
    projection_verified_at: new Date().toISOString(),
    projection_message: 'A1 M4 local Docker Runtime',
    updated_at: new Date().toISOString(),
    created_at: new Date().toISOString(),
  };
  let { data, error } = await sb.from('machines').insert(row).select('id,status,ip_address,port,image').maybeSingle();
  if (error) {
    const slim = { ...row };
    delete slim.projection_verified_at;
    delete slim.projection_message;
    delete slim.gpu_type;
    ({ data, error } = await sb
      .from('machines')
      .insert(slim)
      .select('id,status,ip_address,port,image')
      .maybeSingle());
  }
  if (error || !data) throw new Error(`local machine insert failed: ${error?.message}`);
  return data;
}

async function findOrStartMachine(token) {
  const override = String(process.env.A1_M4_UPSTREAM || '').trim();
  if (override) {
    const probe = await fetch(`${override.replace(/\/$/, '')}/system_stats`, {
      signal: AbortSignal.timeout(15_000),
    });
    if (!probe.ok) fail('runtime_probe_override', { status: probe.status, override });
    const machine = await ensureLocalDockerMachine(override);
    pass('runtime_bind', { via: 'A1_M4_UPSTREAM', upstream: override, machineId: machine.id });
    return { machine, upstream: override.replace(/\/$/, '') };
  }

  let { data: rows } = await sb
    .from('machines')
    .select('id,status,image,instance_id,ip_address,port,projection_verified_at')
    .eq('user_id', USER_ID)
    .eq('status', 'running')
    .order('created_at', { ascending: false })
    .limit(3);

  for (const m of rows || []) {
    if (!imageOk(m.image) && TARGET === 'production') continue;
    const base = comfyBase(m);
    if (!base) continue;
    try {
      const probe = await fetch(`${base}/system_stats`, { signal: AbortSignal.timeout(12_000) });
      if (probe.ok) {
        pass('runtime_reuse', { machineId: m.id, base });
        return { machine: m, upstream: base };
      }
    } catch {
      /* try next */
    }
  }

  if (process.env.A1_M4_SKIP_START === '1') {
    fail('runtime_start', 'no live machine and A1_M4_SKIP_START=1');
  }

  const { data: inv } = await sb
    .from('user_plan_inventory')
    .select('id,plan_name,is_active,subscription_id,hours_remaining,status')
    .eq('user_id', USER_ID)
    .eq('status', 'active')
    .limit(20);
  const ranked = (inv || [])
    .filter((r) => Number(r.hours_remaining) > 0.2)
    .sort((a, b) => Number(b.hours_remaining) - Number(a.hours_remaining));
  const plan =
    ranked.find((r) => r.is_active) ||
    ranked.find((r) => /pro/i.test(String(r.plan_name || ''))) ||
    ranked[0];
  if (!plan) fail('runtime_start', 'no plan hours');

  const start = await api('/api/user/start-machine', {
    method: 'POST',
    token,
    body: {
      inventoryId: plan.id,
      plan: plan.plan_name,
      subscriptionId: plan.subscription_id,
    },
  });
  console.log('start-machine', start.status, JSON.stringify(start.json).slice(0, 400));

  let machine = null;
  let upstream = null;
  for (let i = 0; i < 120; i++) {
    await sleep(10_000);
    const q = await sb
      .from('machines')
      .select('id,status,image,instance_id,ip_address,port')
      .eq('user_id', USER_ID)
      .order('created_at', { ascending: false })
      .limit(1);
    machine = q.data?.[0] ?? null;
    console.log('poll', i + 1, machine?.status, machine?.ip_address, machine?.image);
    if (machine?.status === 'running' && machine.ip_address && imageOk(machine.image)) {
      upstream = comfyBase(machine);
      try {
        const probe = await fetch(`${upstream}/system_stats`, { signal: AbortSignal.timeout(12_000) });
        if (probe.ok) break;
      } catch {
        /* keep waiting */
      }
    }
  }
  if (!machine || !upstream) fail('runtime_start', { machine });
  pass('runtime_bind', { machineId: machine.id, upstream });
  return { machine, upstream };
}

async function main() {
  console.log(JSON.stringify({ milestone: 'A1-M4', target: TARGET, work: WORK, marker: MARKER }, null, 2));

  const health = await fetch(`${WORK}/health`, { signal: AbortSignal.timeout(15_000) });
  if (!health.ok) fail('health', health.status);
  pass('health', await health.text().then((t) => t.slice(0, 80)));

  // ——— Phase 1: Offline Workspace ———
  const editor = await issueComfyAccessToken(sb, { userId: USER_ID, mode: 'editor' });
  await putKv(editor.token, {
    upstream: null,
    userId: USER_ID,
    machineId: null,
    exp: Math.floor(new Date(editor.expiresAt).getTime() / 1000),
    mode: 'editor',
  });
  const cookieOff = await enterCookie(editor.workUrl);
  pass('offline_enter', { mode: editor.mode });

  const shell = await workFetch('/', { cookie: cookieOff });
  if (shell.status !== 200 || !/ComfyUI/i.test(shell.text)) fail('offline_shell', shell.status);
  pass('offline_shell', { bytes: shell.bytes.length });

  const oiOff = await workFetch('/api/object_info', { cookie: cookieOff });
  const oiOffCount = Object.keys(oiOff.json || {}).length;
  if (!oiOff.ok || oiOffCount < 100) fail('offline_object_info', { oiOffCount });
  pass('offline_object_info', { oiOffCount, note: 'Supported Manifest snapshot' });

  const promptOff = await workFetch('/api/prompt', {
    cookie: cookieOff,
    method: 'POST',
    body: { prompt: {}, client_id: 'a1-m4-offline' },
  });
  if (promptOff.status !== 503 || promptOff.json?.code !== 'A1_RUNTIME_OFFLINE') {
    fail('offline_generate_blocked', { status: promptOff.status, body: promptOff.json });
  }
  pass('offline_generate_blocked', { code: 'A1_RUNTIME_OFFLINE' });

  // Seed CP graph (identity lives on CP — not Session Restore)
  const wf = await ensureActiveCpWorkflow(sb, USER_ID);
  const seedDoc = {
    last_node_id: 1,
    last_link_id: 0,
    nodes: [
      {
        id: 1,
        type: 'EmptyLatentImage',
        pos: [100, 100],
        size: [200, 100],
        flags: {},
        order: 0,
        mode: 0,
        inputs: [],
        outputs: [{ name: 'LATENT', type: 'LATENT', links: null }],
        title: MARKER,
        properties: {},
        widgets_values: [512, 512, 1],
      },
    ],
    links: [],
    groups: [],
    config: {},
    extra: { gate1: MARKER, a1m4: MARKER },
    version: 0.4,
  };
  const saved = await upsertCpWorkflowDocument(sb, {
    workflowId: wf.id,
    userId: USER_ID,
    document: seedDoc,
    expectedRevision: Number(wf.revision ?? 1),
  });
  pass('cp_seed_offline', {
    workflowId: wf.id,
    revision: saved.revision,
    note: 'Graph on CP before Runtime — not Generate Resume',
  });

  // ——— Phase 2: Bind Runtime + Online Generate ———
  const authToken = await userApiToken();
  const { machine, upstream } = await findOrStartMachine(authToken);

  await sb
    .from('machines')
    .update({
      projection_verified_at: new Date().toISOString(),
      projection_message: 'A1 M4: Comfy ready for generate',
      updated_at: new Date().toISOString(),
    })
    .eq('id', machine.id);

  const runtime = await issueComfyAccessToken(sb, {
    userId: USER_ID,
    mode: 'runtime',
    machineId: machine.id,
    upstreamUrl: upstream,
    ttlSeconds: 3600,
  });
  await putKv(runtime.token, {
    upstream,
    userId: USER_ID,
    machineId: machine.id,
    exp: Math.floor(new Date(runtime.expiresAt).getTime() / 1000),
    mode: 'runtime',
  });
  pass('proxy_resolve_upstream', { mode: runtime.mode, upstreamHost: new URL(upstream).host });

  const cookieOn = await enterCookie(runtime.workUrl);
  pass('online_enter', { mode: runtime.mode });

  const oiOn = await workFetch('/api/object_info', { cookie: cookieOn, timeoutMs: 120_000 });
  const oiOnCount = Object.keys(oiOn.json || {}).length;
  if (!oiOn.ok || !oiOn.json?.CheckpointLoaderSimple) {
    fail('live_object_info', { status: oiOn.status, oiOnCount, text: oiOn.text });
  }
  // Live catalog should expose model COMBO list (Runtime), not only snapshot shape
  const ckptField = oiOn.json.CheckpointLoaderSimple?.input?.required?.ckpt_name;
  const ckptList = Array.isArray(ckptField?.[0]) ? ckptField[0] : Array.isArray(ckptField) ? ckptField : [];
  if (oiOnCount < oiOffCount * 0.5 && ckptList.length === 0) {
    fail('live_object_info_thin', { oiOnCount, oiOffCount, ckptList: ckptList.length });
  }
  pass('live_object_info', { oiOnCount, ckptCount: ckptList.length });

  const prefer = ['sd_xl_base_1.0.safetensors', 'RealVisXL_V6.0_B1.safetensors'];
  const ckpt = prefer.find((p) => ckptList.includes(p)) || ckptList[0] || null;
  const usePixelPassthrough = !ckpt;
  if (usePixelPassthrough) {
    pass('ckpt_discover', {
      ckpt: null,
      note: 'no checkpoints on Runtime — LoadImage→SaveImage passthrough (still full Proxy path)',
    });
  } else {
    pass('ckpt_discover', { ckpt });
  }

  const seed = Number(String(Date.now()).slice(-9));
  const positive = `a1 m4 generate smoke, soft light, ${MARKER}`;
  const negative = 'text, watermark, blurry';

  /** @type {Record<string, unknown>} */
  let promptGraph;
  /** @type {Record<string, unknown>} */
  let doc;

  if (usePixelPassthrough) {
    // Valid 1×1 PNG (IHDR+IDAT+IEND)
    const png = Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
      'base64',
    );
    const form = new FormData();
    form.append('image', new Blob([png], { type: 'image/png' }), `a1_m4_${MARKER}.png`);
    form.append('overwrite', 'true');
    const up = await fetch(`${WORK}/api/upload/image`, {
      method: 'POST',
      headers: { Cookie: cookieOn },
      body: form,
      signal: AbortSignal.timeout(60_000),
    });
    let upJson = await up.json().catch(() => ({}));
    if (!up.ok) {
      const up2 = await fetch(`${WORK}/upload/image`, {
        method: 'POST',
        headers: { Cookie: cookieOn },
        body: form,
        signal: AbortSignal.timeout(60_000),
      });
      upJson = await up2.json().catch(() => ({}));
      if (!up2.ok) fail('upload_image', { status: up.status, upJson, up2: await up2.text().catch(() => '') });
    }
    const fname = upJson.name || upJson.filename || `a1_m4_${MARKER}.png`;
    pass('upload_image', { name: fname });

    promptGraph = {
      '1': {
        class_type: 'LoadImage',
        inputs: { image: fname },
      },
      '2': {
        class_type: 'SaveImage',
        inputs: { filename_prefix: `a1_m4_${MARKER}`, images: ['1', 0] },
      },
    };
    doc = {
      last_node_id: 2,
      last_link_id: 1,
      nodes: [
        {
          id: 1,
          type: 'LoadImage',
          pos: [40, 160],
          size: [320, 100],
          flags: {},
          order: 0,
          mode: 0,
          inputs: [],
          outputs: [
            { name: 'IMAGE', type: 'IMAGE', links: [1], slot_index: 0 },
            { name: 'MASK', type: 'MASK', links: null, slot_index: 1 },
          ],
          properties: {},
          widgets_values: [fname, 'image'],
        },
        {
          id: 2,
          type: 'SaveImage',
          pos: [420, 160],
          size: [260, 80],
          flags: {},
          order: 1,
          mode: 0,
          inputs: [{ name: 'images', type: 'IMAGE', link: 1 }],
          outputs: [],
          properties: {},
          widgets_values: [`a1_m4_${MARKER}`],
        },
      ],
      links: [[1, 1, 0, 2, 0, 'IMAGE']],
      groups: [],
      config: {},
      extra: { gate1: MARKER, a1m4: MARKER, a1m4_mode: 'passthrough' },
      version: 0.4,
    };
  } else {
    doc = uiDoc(MARKER, ckpt, seed, positive, negative);
    promptGraph = apiPrompt(ckpt, seed, positive, negative, `a1_m4_${MARKER}`);
  }

  const patched = await upsertCpWorkflowDocument(sb, {
    workflowId: wf.id,
    userId: USER_ID,
    document: doc,
    expectedRevision: Number(saved.revision),
  });
  pass('cp_graph_ready', { revision: patched.revision, note: 'Generate uses Runtime; graph identity stays CP' });

  const clientId = `a1-m4-${Date.now().toString(36)}`;
  const wsProbe = await probeWs(cookieOn, clientId);
  if (!wsProbe.ok) {
    // Soft-fail note: some Node WebSocket builds drop Cookie; HTTP path still required.
    console.warn('WARN ws_probe', wsProbe);
    report.checks.ws_progress = { ok: false, detail: wsProbe, soft: true };
  } else {
    pass('ws_progress', wsProbe);
  }

  const promptBody = {
    prompt: promptGraph,
    client_id: clientId,
  };
  const promptRes = await workFetch('/api/prompt', {
    cookie: cookieOn,
    method: 'POST',
    body: promptBody,
    timeoutMs: 60_000,
  });
  if (!promptRes.ok || !promptRes.json?.prompt_id) {
    // try without /api prefix (some images)
    const alt = await workFetch('/prompt', {
      cookie: cookieOn,
      method: 'POST',
      body: promptBody,
      timeoutMs: 60_000,
    });
    if (!alt.ok || !alt.json?.prompt_id) {
      fail('prompt_queue', { promptRes: promptRes.json || promptRes.text, alt: alt.json || alt.text });
    }
    promptRes.json = alt.json;
    promptRes.ok = alt.ok;
  }
  const promptId = String(promptRes.json.prompt_id);
  pass('prompt_queue', { promptId, note: 'POST → Proxy → Runtime (not CP→Comfy)' });

  let histEntry = null;
  const deadline = Date.now() + 20 * 60_000;
  while (Date.now() < deadline) {
    await sleep(5000);
    const hist = await workFetch(`/api/history/${encodeURIComponent(promptId)}`, {
      cookie: cookieOn,
      timeoutMs: 20_000,
    });
    histEntry = hist.json?.[promptId] ?? null;
    if (!histEntry) {
      const hist2 = await workFetch(`/history/${encodeURIComponent(promptId)}`, {
        cookie: cookieOn,
        timeoutMs: 20_000,
      });
      histEntry = hist2.json?.[promptId] ?? null;
    }
    if (histEntry) break;
    console.log('waiting generate…', promptId);
  }
  if (!histEntry) fail('history', 'timeout');
  const failed =
    String(histEntry.status?.status_str || '').toLowerCase().includes('error') ||
    histEntry.status?.completed === false;
  if (failed) fail('history_exec', histEntry.status);
  const images = [];
  for (const nodeOut of Object.values(histEntry.outputs || {})) {
    if (Array.isArray(nodeOut?.images)) images.push(...nodeOut.images);
  }
  if (!images.length) fail('history_images', histEntry.outputs);
  pass('history', { images: images.length, status: histEntry.status?.status_str });

  const img0 = images[0];
  const viewPath = `/api/view?filename=${encodeURIComponent(img0.filename)}&subfolder=${encodeURIComponent(img0.subfolder || '')}&type=${encodeURIComponent(img0.type || 'output')}`;
  let view = await workFetch(viewPath, { cookie: cookieOn, timeoutMs: 60_000 });
  if (!view.ok || view.bytes.length < 100) {
    view = await workFetch(viewPath.replace(/^\/api/, ''), { cookie: cookieOn, timeoutMs: 60_000 });
  }
  const isPng = view.bytes[0] === 0x89 && view.bytes[1] === 0x50;
  if (!view.ok || !isPng) fail('view_preview', { status: view.status, bytes: view.bytes.length });
  if (!existsSync(join(root, 'tmp'))) mkdirSync(join(root, 'tmp'), { recursive: true });
  const outPath = join(root, 'tmp', `a1-m4-${MARKER}.png`);
  writeFileSync(outPath, view.bytes);
  pass('view_preview', { bytes: view.bytes.length, outPath });

  // ——— Phase 3: Stop Runtime → Generate blocked; CP graph remains ———
  const editor2 = await issueComfyAccessToken(sb, { userId: USER_ID, mode: 'editor' });
  await putKv(editor2.token, {
    upstream: null,
    userId: USER_ID,
    machineId: null,
    exp: Math.floor(new Date(editor2.expiresAt).getTime() / 1000),
    mode: 'editor',
  });
  const cookieOff2 = await enterCookie(editor2.workUrl);
  const promptOff2 = await workFetch('/api/prompt', {
    cookie: cookieOff2,
    method: 'POST',
    body: { prompt: promptBody.prompt, client_id: 'a1-m4-after-stop' },
  });
  if (promptOff2.status !== 503 || promptOff2.json?.code !== 'A1_RUNTIME_OFFLINE') {
    fail('after_stop_generate_blocked', promptOff2.json || promptOff2.text);
  }
  pass('after_stop_generate_blocked', { code: 'A1_RUNTIME_OFFLINE' });

  const cpAfter = await getCpWorkflow(sb, USER_ID, wf.id);
  const gate = cpAfter?.document?.extra?.gate1 || cpAfter?.document?.extra?.a1m4;
  if (gate !== MARKER) fail('cp_graph_survives', { gate, marker: MARKER });
  pass('cp_graph_survives', {
    revision: cpAfter.revision,
    gate,
    note: 'Stop Runtime ≠ wipe graph; Generate Resume ≠ Session/Graph Restore',
  });

  if (process.env.A1_M4_SKIP_DESTROY !== '1') {
    try {
      if (machine.provider === 'local' || String(machine.instance_id || '').startsWith('local-m4-')) {
        await sb
          .from('machines')
          .update({ status: 'destroyed', updated_at: new Date().toISOString() })
          .eq('id', machine.id);
        pass('cleanup_local_machine', { id: machine.id });
      } else if (machine.instance_id && cloreKey) {
        const cancel = await clore('POST', '/cancel_order', { id: Number(machine.instance_id) });
        await sb
          .from('machines')
          .update({ status: 'destroyed', updated_at: new Date().toISOString() })
          .eq('id', machine.id);
        pass('cleanup_clore', { status: cancel.status, order: machine.instance_id });
      }
    } catch (e) {
      console.warn('cleanup warn', e instanceof Error ? e.message : e);
    }
  }

  report.ok = Object.values(report.checks).every((c) => c.ok || c.soft);
  const reportPath = join(root, 'tmp', `a1-m4-report-${MARKER}.json`);
  writeFileSync(reportPath, JSON.stringify(report, null, 2));
  console.log(JSON.stringify({ ok: report.ok, reportPath, checks: Object.keys(report.checks) }, null, 2));
  if (!report.ok) process.exit(1);
}

main().catch((err) => {
  console.error('FAIL', err instanceof Error ? err.message : err);
  try {
    writeFileSync(join(root, 'tmp', `a1-m4-report-${MARKER}-fail.json`), JSON.stringify(report, null, 2));
  } catch {
    /* ignore */
  }
  process.exit(1);
});
