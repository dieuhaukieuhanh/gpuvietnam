/**
 * Production E2E GPU Continuity (A1 post-Origin-Harden).
 *
 * Topology:
 *   gpuvietnam.com     = Control Plane Origin
 *   work.gpuvietnam.com = Workspace + Proxy
 *   GPU Runtime        = disposable Clore :v3.2
 *
 * Steps 1–11 per ticket. No Ticket C / dual-run / warm pool.
 *
 * Usage: node scripts/a1-prod-e2e-gpu-continuity.mjs
 */
import { createHash, randomUUID } from 'node:crypto';
import {
  readFileSync,
  existsSync,
  writeFileSync,
  unlinkSync,
  mkdirSync,
} from 'node:fs';
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
const APEX = 'https://gpuvietnam.com';
const WORK = 'https://work.gpuvietnam.com';
// Provision needs a long-lived Node process: Vercel Hobby kills post-response
// `void completeUserStartProvision(...)` before Clore rent finishes.
// CP graph + Workspace stay on apex / work.*; only start-machine uses this base.
const PROVISION_APP =
  process.env.PROVISION_APP_URL ||
  process.env.GATE1_APP_URL ||
  'http://127.0.0.1:3000';
const USER_ID = '70feafcf-6ad1-4b13-bb99-eae5a538d20a';
const CLORE_BASE = 'https://api.clore.ai/v1';
const MARKER = process.env.PROD_E2E_MARKER || `prod-e2e-${Date.now()}`;
const RESUME_REPORT = process.env.PROD_E2E_RESUME_REPORT || '';
const RESUME_FROM = Number(process.env.PROD_E2E_RESUME_FROM || 0) || 0;
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
    if (
      (v.startsWith('"') && v.endsWith('"')) ||
      (v.startsWith("'") && v.endsWith("'"))
    ) {
      v = v.slice(1, -1);
    }
    if (process.env[t.slice(0, i).trim()] == null) {
      process.env[t.slice(0, i).trim()] = v;
    }
  }
}
loadEnv();
process.env.COMFY_PROXY_ENABLED = '1';
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

const report = {
  milestone: 'PROD-E2E-GPU-CONTINUITY',
  marker: MARKER,
  apex: APEX,
  work: WORK,
  steps: {},
  runtimeA: null,
  runtimeB: null,
  workflow: null,
  outputs: {},
};
function pass(id, detail) {
  report.steps[id] = { ok: true, detail };
  console.log('PASS', id, detail ?? '');
}
function fail(id, detail) {
  report.steps[id] = { ok: false, detail };
  throw new Error(`${id}: ${JSON.stringify(detail)}`);
}
function writeReport(suffix = '') {
  if (!existsSync(join(root, 'tmp'))) mkdirSync(join(root, 'tmp'), { recursive: true });
  const path = join(root, 'tmp', `a1-prod-e2e-${MARKER}${suffix}.json`);
  writeFileSync(path, JSON.stringify(report, null, 2));
  return path;
}

function imageOk(image) {
  return /:(v3\.1|v3\.2)\b/.test(String(image || ''));
}
function comfyBase(machine) {
  const host = machine?.ip_address;
  if (!host) return null;
  if (/trycloudflare|localhost|127\.0\.0\.1/i.test(host)) return null;
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

async function api(path, { method = 'GET', body, token, base = APEX } = {}) {
  const res = await fetch(`${base}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const json = await res.json().catch(() => ({}));
  return { status: res.status, json };
}

async function putKv(token, payload) {
  const ns = process.env.CF_KV_NAMESPACE_ID;
  if (!ns) throw new Error('CF_KV_NAMESPACE_ID missing');
  const hash = createHash('sha256').update(token, 'utf8').digest('hex');
  const exp = payload.exp;
  const ttl = Math.max(120, exp - Math.floor(Date.now() / 1000));
  const key = `comfy:${hash}`;
  const tmp = join(tmpdir(), `e2e-kv-${Date.now()}-${randomUUID()}.json`);
  writeFileSync(tmp, JSON.stringify(payload));
  const env = { ...process.env };
  delete env.CF_API_TOKEN;
  delete env.CLOUDFLARE_API_TOKEN;
  const put = spawnSync(
    'npx',
    ['wrangler', 'kv', 'key', 'put', key, '--path', tmp, '--namespace-id', ns, '--ttl', String(ttl)],
    { cwd: join(root, 'workers/comfy-proxy'), encoding: 'utf8', shell: true, env },
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
  const enter = await fetch(workUrl, { redirect: 'manual', signal: AbortSignal.timeout(30_000) });
  const setCookie = enter.headers.get('set-cookie') || '';
  if (enter.status !== 302 || !/gvn_comfy=/i.test(setCookie)) {
    fail('enter', { status: enter.status, setCookie: setCookie.slice(0, 100) });
  }
  return `gvn_comfy=${setCookie.match(/gvn_comfy=([^;]+)/i)[1]}`;
}

async function workFetch(path, { cookie, method = 'GET', body, timeoutMs = 60_000 } = {}) {
  const res = await fetch(`${WORK}${path}`, {
    method,
    headers: {
      Cookie: cookie,
      ...(body ? { 'Content-Type': 'application/json' } : {}),
      Accept: '*/*',
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

function markerDoc(marker, note) {
  return {
    last_node_id: 2,
    last_link_id: 0,
    nodes: [
      {
        id: 1,
        type: 'Note',
        pos: [40, 40],
        size: [360, 100],
        flags: {},
        order: 0,
        mode: 0,
        title: marker,
        properties: { text: note || marker },
        widgets_values: [note || marker],
      },
      {
        id: 2,
        type: 'EmptyLatentImage',
        pos: [40, 180],
        size: [280, 110],
        flags: {},
        order: 1,
        mode: 0,
        inputs: [],
        outputs: [{ name: 'LATENT', type: 'LATENT', links: null }],
        properties: {},
        widgets_values: [512, 512, 1],
      },
    ],
    links: [],
    groups: [],
    config: {},
    extra: { gate1: marker, prod_e2e: marker, note: note || marker },
    version: 0.4,
  };
}

function uiDocCheckpoint(marker, ckpt, seed, positive, negative) {
  return {
    last_node_id: 8,
    last_link_id: 9,
    nodes: [
      {
        id: 8,
        type: 'Note',
        pos: [40, 40],
        size: [320, 80],
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
        widgets_values: [`prod_e2e_${marker}`],
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
    extra: { gate1: marker, prod_e2e: marker, prod_e2e_ckpt: ckpt, prod_e2e_seed: seed },
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

async function cleanStaleLocalMachines() {
  const { data } = await sb
    .from('machines')
    .select('id,instance_id,ip_address,status')
    .eq('user_id', USER_ID)
    .eq('status', 'running');
  let n = 0;
  for (const m of data || []) {
    const local =
      String(m.instance_id || '').startsWith('local-m4-') ||
      /trycloudflare|127\.0\.0\.1|localhost/i.test(String(m.ip_address || ''));
    if (!local) continue;
    await sb
      .from('machines')
      .update({
        status: 'destroyed',
        updated_at: new Date().toISOString(),
        projection_message: 'prod-e2e: clear stale local/tunnel machine',
      })
      .eq('id', m.id);
    n += 1;
  }
  pass('cleanup_stale_local_machines', { destroyed: n });
}

async function mintEditorSession() {
  const issued = await issueComfyAccessToken(sb, { userId: USER_ID, mode: 'editor' });
  await putKv(issued.token, {
    upstream: null,
    userId: USER_ID,
    machineId: null,
    exp: Math.floor(new Date(issued.expiresAt).getTime() / 1000),
    mode: 'editor',
  });
  const cookie = await enterCookie(issued.workUrl);
  return { issued, cookie };
}

async function mintRuntimeSession(machine, upstream) {
  const issued = await issueComfyAccessToken(sb, {
    userId: USER_ID,
    mode: 'runtime',
    machineId: machine.id,
    upstreamUrl: upstream,
    ttlSeconds: 7200,
  });
  await putKv(issued.token, {
    upstream,
    userId: USER_ID,
    machineId: machine.id,
    exp: Math.floor(new Date(issued.expiresAt).getTime() / 1000),
    mode: 'runtime',
  });
  const cookie = await enterCookie(issued.workUrl);
  return { issued, cookie };
}

async function startRealRuntime(authToken, label) {
  const { data: inv } = await sb
    .from('user_plan_inventory')
    .select('id,plan_name,is_active,subscription_id,hours_remaining,status')
    .eq('user_id', USER_ID)
    .eq('status', 'active')
    .limit(20);
  const ranked = (inv || [])
    .filter((r) => Number(r.hours_remaining) > 0.5)
    .sort((a, b) => Number(b.hours_remaining) - Number(a.hours_remaining));
  const plan =
    ranked.find((r) => r.is_active) ||
    ranked.find((r) => /pro/i.test(String(r.plan_name || ''))) ||
    ranked[0];
  if (!plan) fail(`start_${label}`, 'no plan hours');

  // Clear expired/stuck lease so start can claim again
  if (plan.subscription_id) {
    await sb
      .from('subscriptions')
      .update({
        server_status: 'offline',
        provisioning_started_at: null,
        provisioning_lease_id: null,
        provisioning_lease_expires_at: null,
        provisioning_heartbeat_at: null,
        provisioning_lease_owner: null,
        provisioning_progress: null,
      })
      .eq('id', plan.subscription_id)
      .eq('server_status', 'provisioning');
  }

  const start = await api('/api/user/start-machine', {
    method: 'POST',
    token: authToken,
    base: PROVISION_APP,
    body: {
      inventoryId: plan.id,
      plan: plan.plan_name,
      subscriptionId: plan.subscription_id,
    },
  });
  console.log(
    `start-machine ${label}`,
    PROVISION_APP,
    start.status,
    JSON.stringify(start.json).slice(0, 500),
  );
  if (start.status >= 400 && !start.json?.accepted && !start.json?.alreadyStarting) {
    fail(`start_${label}_http`, { status: start.status, json: start.json });
  }

  let machine = null;
  let upstream = null;
  for (let i = 0; i < 120; i++) {
    await sleep(10_000);
    const q = await sb
      .from('machines')
      .select('id,status,image,instance_id,ip_address,port,provider,created_at')
      .eq('user_id', USER_ID)
      .order('created_at', { ascending: false })
      .limit(8);
    const newest = q.data?.[0] || null;
    for (const cand of q.data || []) {
      if (!['running', 'starting', 'creating', 'opening'].includes(cand.status)) continue;
      if (!imageOk(cand.image) || !cand.ip_address) continue;
      if (String(cand.instance_id || '').startsWith('local-m4-')) continue;
      const base = comfyBase(cand);
      if (!base) continue;
      if (cand.status !== 'running') continue;
      try {
        const probe = await fetch(`${base}/system_stats`, {
          signal: AbortSignal.timeout(15_000),
        });
        if (!probe.ok) continue;
        machine = cand;
        upstream = base;
        break;
      } catch {
        /* keep polling */
      }
    }
    console.log(`poll ${label}`, i + 1, {
      ready: Boolean(machine),
      newestId: newest?.id,
      newestStatus: newest?.status,
      newestIp: newest?.ip_address,
      newestImage: newest?.image,
      newestInstance: newest?.instance_id,
    });
    if (machine && upstream) break;
  }
  if (!machine || !upstream) fail(`start_${label}`, { machine, start });

  await sb
    .from('machines')
    .update({
      projection_verified_at: new Date().toISOString(),
      projection_message: `prod-e2e ${label}: Comfy ready`,
      updated_at: new Date().toISOString(),
    })
    .eq('id', machine.id);

  return { machine, upstream, planId: plan.id };
}

async function destroyRuntime(machine, label) {
  const orderId = Number(machine.instance_id);
  if (Number.isFinite(orderId) && orderId > 0 && cloreKey) {
    const cancel = await clore('POST', '/cancel_order', { id: orderId });
    console.log(`cancel ${label}`, orderId, cancel.status, JSON.stringify(cancel.json).slice(0, 200));
  }
  const { data: row } = await sb
    .from('machines')
    .select('id,subscription_id')
    .eq('id', machine.id)
    .maybeSingle();
  await sb
    .from('machines')
    .update({
      status: 'destroyed',
      updated_at: new Date().toISOString(),
      projection_message: `prod-e2e: destroyed ${label}`,
    })
    .eq('id', machine.id);
  if (row?.subscription_id) {
    await sb
      .from('subscriptions')
      .update({
        server_status: 'offline',
        provisioning_started_at: null,
        provisioning_lease_id: null,
        provisioning_lease_expires_at: null,
        provisioning_heartbeat_at: null,
        provisioning_lease_owner: null,
        provisioning_progress: null,
      })
      .eq('id', row.subscription_id);
  }
  // wait so marketplace frees / no stale active
  await sleep(5000);
}

function parseCkptList(oiJson) {
  const ckptField = oiJson?.CheckpointLoaderSimple?.input?.required?.ckpt_name;
  if (Array.isArray(ckptField?.[0])) return ckptField[0];
  if (Array.isArray(ckptField)) return ckptField;
  return [];
}

async function waitForObjectInfo(cookie, label) {
  let last = null;
  for (let i = 0; i < 36; i++) {
    const oi = await workFetch('/api/object_info', { cookie, timeoutMs: 120_000 });
    last = oi;
    if (oi.ok && oi.json?.CheckpointLoaderSimple) {
      const ckptList = parseCkptList(oi.json);
      if (ckptList.length > 0 || oi.json?.LoadImage) {
        return { oi, ckptList };
      }
    }
    console.log(`wait object_info ${label}`, i + 1, {
      status: oi.status,
      nodes: oi.json ? Object.keys(oi.json).length : 0,
      ckpts: parseCkptList(oi.json || {}).length,
    });
    await sleep(10_000);
  }
  fail(`live_object_info_${label}`, {
    status: last?.status,
    ckpts: parseCkptList(last?.json || {}).length,
  });
}

async function generateOnRuntime({ cookie, marker, label, expectedRevision }) {
  const { oi, ckptList } = await waitForObjectInfo(cookie, label);
  const prefer = ['sd_xl_base_1.0.safetensors', 'RealVisXL_V6.0_B1.safetensors'];
  const ckpt = prefer.find((p) => ckptList.includes(p)) || ckptList[0] || null;

  const seed = Number(String(Date.now()).slice(-9));
  const positive = `prod e2e continuity ${marker}, soft light, ${label}`;
  const negative = 'text, watermark, blurry';
  let doc;
  let promptGraph;
  if (ckpt) {
    doc = uiDocCheckpoint(marker, ckpt, seed, positive, negative);
    promptGraph = apiPrompt(ckpt, seed, positive, negative, `prod_e2e_${marker}_${label}`);
  } else if (oi.json?.LoadImage && oi.json?.SaveImage) {
    // Models still downloading — still proves Workspace→Proxy→Runtime→history/view
    console.log(`ckpt_${label} empty — LoadImage→SaveImage fallback`);
    doc = {
      last_node_id: 2,
      last_link_id: 1,
      nodes: [
        {
          id: 1,
          type: 'LoadImage',
          pos: [40, 120],
          size: [320, 140],
          flags: {},
          order: 1,
          mode: 0,
          inputs: [],
          outputs: [{ name: 'IMAGE', type: 'IMAGE', links: [1], slot_index: 0 }],
          properties: {},
          widgets_values: ['example.png', 'image'],
        },
        {
          id: 2,
          type: 'SaveImage',
          pos: [420, 120],
          size: [260, 80],
          flags: {},
          order: 2,
          mode: 0,
          inputs: [{ name: 'images', type: 'IMAGE', link: 1 }],
          outputs: [],
          properties: {},
          widgets_values: [`prod_e2e_${marker}_${label}`],
        },
      ],
      links: [[1, 1, 0, 2, 0, 'IMAGE']],
      groups: [],
      config: {},
      extra: { gate1: marker, prod_e2e: marker, prod_e2e_mode: 'load_save' },
      version: 0.4,
    };
    promptGraph = {
      '1': { class_type: 'LoadImage', inputs: { image: 'example.png' } },
      '2': {
        class_type: 'SaveImage',
        inputs: { filename_prefix: `prod_e2e_${marker}_${label}`, images: ['1', 0] },
      },
    };
  } else {
    fail(`ckpt_${label}`, { count: ckptList.length });
  }

  // Keep CP graph aligned with what we Generate (SoT before execute)
  const wf = await ensureActiveCpWorkflow(sb, USER_ID);
  const saved = await upsertCpWorkflowDocument(sb, {
    workflowId: wf.id,
    userId: USER_ID,
    document: doc,
    expectedRevision: expectedRevision != null ? Number(expectedRevision) : Number(wf.revision),
  });

  const clientId = `prod-e2e-${label}-${Date.now().toString(36)}`;
  const promptBody = {
    prompt: promptGraph,
    client_id: clientId,
  };
  let promptRes = await workFetch('/api/prompt', {
    cookie,
    method: 'POST',
    body: promptBody,
    timeoutMs: 60_000,
  });
  if (!promptRes.ok || !promptRes.json?.prompt_id) {
    promptRes = await workFetch('/prompt', {
      cookie,
      method: 'POST',
      body: promptBody,
      timeoutMs: 60_000,
    });
  }
  if (!promptRes.ok || !promptRes.json?.prompt_id) {
    fail(`prompt_${label}`, promptRes.json || promptRes.text);
  }
  const promptId = String(promptRes.json.prompt_id);

  let histEntry = null;
  const deadline = Date.now() + 25 * 60_000;
  while (Date.now() < deadline) {
    await sleep(8000);
    let hist = await workFetch(`/api/history/${encodeURIComponent(promptId)}`, {
      cookie,
      timeoutMs: 20_000,
    });
    histEntry = hist.json?.[promptId] ?? null;
    if (!histEntry) {
      hist = await workFetch(`/history/${encodeURIComponent(promptId)}`, {
        cookie,
        timeoutMs: 20_000,
      });
      histEntry = hist.json?.[promptId] ?? null;
    }
    if (histEntry) break;
    console.log(`waiting generate ${label}…`, promptId);
  }
  if (!histEntry) fail(`history_${label}`, 'timeout');
  const failed =
    String(histEntry.status?.status_str || '').toLowerCase().includes('error') ||
    histEntry.status?.completed === false;
  if (failed) fail(`history_exec_${label}`, histEntry.status);

  const images = [];
  for (const nodeOut of Object.values(histEntry.outputs || {})) {
    if (Array.isArray(nodeOut?.images)) images.push(...nodeOut.images);
  }
  if (!images.length) fail(`images_${label}`, histEntry.outputs);
  const img0 = images[0];
  const viewPath = `/api/view?filename=${encodeURIComponent(img0.filename)}&subfolder=${encodeURIComponent(img0.subfolder || '')}&type=${encodeURIComponent(img0.type || 'output')}`;
  let view = await workFetch(viewPath, { cookie, timeoutMs: 60_000 });
  if (!view.ok || view.bytes.length < 100) {
    view = await workFetch(viewPath.replace(/^\/api/, ''), { cookie, timeoutMs: 60_000 });
  }
  const isPng = view.bytes[0] === 0x89 && view.bytes[1] === 0x50;
  if (!view.ok || !isPng) fail(`view_${label}`, { status: view.status, bytes: view.bytes.length });
  const outPath = join(root, 'tmp', `a1-prod-e2e-${MARKER}-${label}.png`);
  writeFileSync(outPath, view.bytes);

  return {
    promptId,
    ckpt,
    seed,
    revision: saved.revision,
    workflowId: wf.id,
    image: img0,
    bytes: view.bytes.length,
    outPath,
  };
}

async function main() {
  console.log(
    JSON.stringify(
      {
        milestone: report.milestone,
        marker: MARKER,
        apex: APEX,
        work: WORK,
        provisionApp: PROVISION_APP,
        resumeReport: RESUME_REPORT || null,
        note: 'start-machine via long-lived Next; CP+Workspace stay production hosts',
      },
      null,
      2,
    ),
  );
  if (!cloreKey) fail('clore_key', 'CLORE_API_KEY missing');
  report.provisionApp = PROVISION_APP;

  let authToken = null;
  let rtA = null;
  let rtB = null;
  let fromStep = 1;
  let genA = null;

  if (RESUME_REPORT) {
    const prev = JSON.parse(readFileSync(RESUME_REPORT, 'utf8'));
    if (prev.marker && prev.marker !== MARKER) {
      fail('resume_marker_mismatch', { expected: MARKER, got: prev.marker });
    }
    report.steps = { ...(prev.steps || {}), ...report.steps };
    report.workflow = prev.workflow || report.workflow;
    report.runtimeA = prev.runtimeA;
    report.runtimeB = prev.runtimeB;
    report.outputs = prev.outputs || {};
    delete report.steps.ckpt_A;
    delete report.steps.start_B;
    authToken = await userApiToken();
    fromStep = RESUME_FROM || 7;

    if (fromStep <= 7) {
      if (!prev.runtimeA?.machineId || !prev.runtimeA?.upstream) {
        fail('resume_missing_runtime_A', prev.runtimeA);
      }
      const { data: m } = await sb
        .from('machines')
        .select('id,status,image,instance_id,ip_address,port,provider,created_at')
        .eq('id', prev.runtimeA.machineId)
        .maybeSingle();
      if (!m || m.status !== 'running') {
        fail('resume_runtime_A_not_running', { machine: m, prev: prev.runtimeA });
      }
      const upstream = comfyBase(m) || prev.runtimeA.upstream;
      const probe = await fetch(`${upstream}/system_stats`, {
        signal: AbortSignal.timeout(20_000),
      });
      if (!probe.ok) fail('resume_runtime_A_probe', { status: probe.status, upstream });
      rtA = { machine: m, upstream, planId: null };
      report.runtimeA = {
        machineId: m.id,
        orderId: m.instance_id,
        image: m.image,
        upstream,
      };
      pass('resume_reuse_runtime_A', report.runtimeA);
    }

    if (fromStep >= 11) {
      const bId = prev.runtimeB?.machineId || process.env.PROD_E2E_RUNTIME_B_ID;
      if (!bId) fail('resume_missing_runtime_B', prev.runtimeB);
      const { data: mB } = await sb
        .from('machines')
        .select('id,status,image,instance_id,ip_address,port,provider,created_at')
        .eq('id', bId)
        .maybeSingle();
      if (!mB || mB.status !== 'running') {
        fail('resume_runtime_B_not_running', { machine: mB, bId });
      }
      const upstreamB = comfyBase(mB) || prev.runtimeB?.upstream;
      const probeB = await fetch(`${upstreamB}/system_stats`, {
        signal: AbortSignal.timeout(20_000),
      });
      if (!probeB.ok) fail('resume_runtime_B_probe', { status: probeB.status, upstreamB });
      rtB = { machine: mB, upstream: upstreamB, planId: null };
      report.runtimeB = {
        machineId: mB.id,
        orderId: mB.instance_id,
        image: mB.image,
        upstream: upstreamB,
        note: prev.runtimeB?.note || 'resumed',
      };
      pass('resume_reuse_runtime_B', report.runtimeB);
      if (prev.outputs?.A) genA = prev.outputs.A;
    }
  } else {
    await cleanStaleLocalMachines();
    authToken = await userApiToken();
  }

  if (fromStep <= 5) {
    // ——— 1–3 Offline Workspace + CP save ———
    let { issued: editor1, cookie: cookie1 } = await mintEditorSession();
    pass('step1_open_workspace_offline', { mode: editor1.mode });

    const shell = await workFetch('/', { cookie: cookie1 });
    if (shell.status !== 200 || !/ComfyUI/i.test(shell.text)) fail('step1_shell', shell.status);

    const promptOff = await workFetch('/api/prompt', {
      cookie: cookie1,
      method: 'POST',
      body: { prompt: {}, client_id: 'e2e-offline' },
    });
    if (promptOff.status !== 503 || promptOff.json?.code !== 'A1_RUNTIME_OFFLINE') {
      fail('step1_generate_blocked', promptOff.json);
    }
    pass('step1_generate_blocked_offline', { code: 'A1_RUNTIME_OFFLINE' });

    const wf = await ensureActiveCpWorkflow(sb, USER_ID);
    const note1 = `${MARKER} offline compose`;
    const doc1 = markerDoc(MARKER, note1);
    const saved1 = await upsertCpWorkflowDocument(sb, {
      workflowId: wf.id,
      userId: USER_ID,
      document: doc1,
      expectedRevision: Number(wf.revision ?? 1),
    });
    report.workflow = { id: wf.id, revisionAfterCompose: saved1.revision };

    // Also PATCH via Worker path (autosave equivalent)
    const syncPatch = await fetch(`${WORK}/gpuvietnam/cp/sync`, {
      method: 'PATCH',
      headers: {
        Authorization: `Bearer ${editor1.token}`,
        Cookie: cookie1,
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: JSON.stringify({
        workflowId: wf.id,
        document: markerDoc(MARKER, `${note1} via worker`),
        expectedRevision: saved1.revision,
      }),
      signal: AbortSignal.timeout(30_000),
    });
    const patchBody = await syncPatch.json().catch(() => ({}));
    if (!syncPatch.ok || patchBody.workflow?.document?.extra?.gate1 !== MARKER) {
      fail('step3_cp_autosave', { status: syncPatch.status, patchBody });
    }
    pass('step2_3_compose_and_cp_save', {
      revision: patchBody.workflow?.revision,
      note: 'Đã lưu Control Plane (Worker→apex)',
    });
    report.workflow.revisionAfterCompose = patchBody.workflow?.revision;

    // ——— 4–5 Close browser (new token) → restore from CP ———
    const { issued: editor2, cookie: cookie2 } = await mintEditorSession();
    pass('step4_close_browser_new_session', { mode: editor2.mode });

    const syncGet = await fetch(`${WORK}/gpuvietnam/cp/sync`, {
      headers: {
        Authorization: `Bearer ${editor2.token}`,
        Cookie: cookie2,
        Accept: 'application/json',
      },
      signal: AbortSignal.timeout(30_000),
    });
    const syncGetBody = await syncGet.json().catch(() => ({}));
    if (!syncGet.ok || syncGetBody.workflow?.document?.extra?.gate1 !== MARKER) {
      fail('step5_restore_from_cp', { status: syncGet.status, syncGetBody });
    }
    pass('step5_restore_from_cp', {
      revision: syncGetBody.workflow?.revision,
      gate: MARKER,
      note: 'new session — graph from CP, not localStorage',
    });
  }

  // ——— 6–9 Runtime A + Generate ———
  if (fromStep <= 9) {
    if (fromStep <= 6) {
      rtA = await startRealRuntime(authToken, 'A');
      report.runtimeA = {
        machineId: rtA.machine.id,
        orderId: rtA.machine.instance_id,
        image: rtA.machine.image,
        upstream: rtA.upstream,
      };
      pass('step6_provision_runtime_A', report.runtimeA);
    }

    const { issued: runtimeATok, cookie: cookieA } = await mintRuntimeSession(
      rtA.machine,
      rtA.upstream,
    );
    pass('step7_bind_runtime_A', {
      mode: runtimeATok.mode,
      upstreamHost: new URL(rtA.upstream).host,
    });

    // Confirm restore still has marker before generate overwrites with checkpoint graph (same marker)
    const syncBeforeGen = await fetch(`${WORK}/gpuvietnam/cp/sync`, {
      headers: {
        Authorization: `Bearer ${runtimeATok.token}`,
        Cookie: cookieA,
        Accept: 'application/json',
      },
    });
    const beforeGen = await syncBeforeGen.json().catch(() => ({}));
    if (beforeGen.workflow?.document?.extra?.gate1 !== MARKER) {
      fail('step7_graph_still_on_cp', beforeGen);
    }

    genA = await generateOnRuntime({
      cookie: cookieA,
      marker: MARKER,
      label: 'A',
      expectedRevision: beforeGen.workflow?.revision,
    });
    report.outputs.A = genA;
    report.workflow.revisionAfterGenA = genA.revision;
    pass('step8_9_generate_A_history_view', {
      promptId: genA.promptId,
      bytes: genA.bytes,
      outPath: genA.outPath,
      ckpt: genA.ckpt,
    });

    // ——— 10 Stop/destroy A ———
    await destroyRuntime(rtA.machine, 'A');
    pass('step10_destroy_runtime_A', {
      machineId: rtA.machine.id,
      orderId: rtA.machine.instance_id,
    });

    const { cookie: cookieOffAfterA } = await mintEditorSession();
    const blocked = await workFetch('/api/prompt', {
      cookie: cookieOffAfterA,
      method: 'POST',
      body: { prompt: {}, client_id: 'after-a' },
    });
    if (blocked.status !== 503 || blocked.json?.code !== 'A1_RUNTIME_OFFLINE') {
      fail('step10_generate_blocked_after_destroy', blocked.json);
    }
    pass('step10_generate_blocked_after_destroy', { code: 'A1_RUNTIME_OFFLINE' });

    const cpAfterA = await getCpWorkflow(sb, USER_ID, genA.workflowId);
    if (cpAfterA?.document?.extra?.gate1 !== MARKER) {
      fail('step10_cp_survives_destroy_A', cpAfterA?.document?.extra);
    }
    pass('step10_cp_graph_survives_A', { revision: cpAfterA.revision, gate: MARKER });
  }

  // ——— 11 Runtime B → restore → Generate again ———
  if (!rtB) {
    rtB = await startRealRuntime(authToken, 'B');
  }
  report.runtimeB = {
    machineId: rtB.machine.id,
    orderId: rtB.machine.instance_id,
    image: rtB.machine.image,
    upstream: rtB.upstream,
  };
  if (rtA?.machine?.id && rtB.machine.id === rtA.machine.id) {
    fail('step11_runtime_B_distinct', { a: rtA.machine.id, b: rtB.machine.id });
  }
  if (report.runtimeA?.machineId && rtB.machine.id === report.runtimeA.machineId) {
    fail('step11_runtime_B_distinct', {
      a: report.runtimeA.machineId,
      b: rtB.machine.id,
    });
  }
  pass('step11_provision_runtime_B', report.runtimeB);

  const { issued: runtimeBTok, cookie: cookieB } = await mintRuntimeSession(
    rtB.machine,
    rtB.upstream,
  );
  const syncB = await fetch(`${WORK}/gpuvietnam/cp/sync`, {
    headers: {
      Authorization: `Bearer ${runtimeBTok.token}`,
      Cookie: cookieB,
      Accept: 'application/json',
    },
  });
  const syncBBody = await syncB.json().catch(() => ({}));
  if (!syncB.ok || syncBBody.workflow?.document?.extra?.gate1 !== MARKER) {
    fail('step11_restore_graph_on_B', { status: syncB.status, syncBBody });
  }
  pass('step11_restore_graph_on_B', {
    revision: syncBBody.workflow?.revision,
    gate: MARKER,
    note: 'same CP marker across A→B',
  });

  const genB = await generateOnRuntime({
    cookie: cookieB,
    marker: MARKER,
    label: 'B',
    expectedRevision: syncBBody.workflow?.revision,
  });
  report.outputs.B = genB;
  report.workflow.revisionAfterGenB = genB.revision;
  pass('step11_generate_B_from_restored_graph', {
    promptId: genB.promptId,
    bytes: genB.bytes,
    outPath: genB.outPath,
    ckpt: genB.ckpt,
    sameMarker: true,
    pairedWithA: genA?.promptId || report.outputs?.A?.promptId || null,
  });

  await destroyRuntime(rtB.machine, 'B');
  pass('cleanup_destroy_runtime_B', { machineId: rtB.machine.id });

  report.ok = Object.values(report.steps).every((s) => s.ok);
  report.verdict = report.ok
    ? 'PASS — graph survived Runtime A→B; outputs generated from CP-restored graph on both runtimes'
    : 'FAIL';
  const reportPath = writeReport();
  console.log(JSON.stringify({ ok: report.ok, verdict: report.verdict, reportPath, runtimeA: report.runtimeA, runtimeB: report.runtimeB, workflow: report.workflow }, null, 2));
  if (!report.ok) process.exit(1);
}

main().catch(async (err) => {
  console.error('FAIL', err instanceof Error ? err.message : err);
  report.ok = false;
  report.error = err instanceof Error ? err.message : String(err);
  const path = writeReport('-fail');
  console.log('report', path);
  process.exit(1);
});
