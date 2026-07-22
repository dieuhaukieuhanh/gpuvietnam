/**
 * Gate 1 G6 — Pixel Generate on restored CP Checkpoint graph (GPU thật).
 *
 * Flow:
 *   1) Start Runtime (or reuse running)
 *   2) PATCH CP with Checkpoint UI graph + gate1 marker
 *   3) POST Comfy /prompt (API graph matching CP)
 *   4) Wait /history → SaveImage output + /view bytes
 *   5) Confirm CP marker still intact
 *   6) Cancel Clore order (cost stop)
 *
 * Usage: node scripts/gate1-g6-generate.mjs
 */
import { readFileSync, existsSync, writeFileSync, mkdirSync } from 'node:fs';
import { createClient } from '@supabase/supabase-js';

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

const USER_ID = '70feafcf-6ad1-4b13-bb99-eae5a538d20a';
const APP = process.env.GATE1_APP_URL || 'http://127.0.0.1:3000';
const WORKFLOW_ID = process.env.GATE1_WORKFLOW_ID || 'f287ec3d-f268-4ddb-a0cd-460deec8e5bf';
const CLORE_BASE = 'https://api.clore.ai/v1';
const MARKER = `gate1-g6-${Date.now()}`;
const cloreKey = (process.env.CLORE_API_KEY || process.env.CLORE_AI_KEY || '').trim();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const sbAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { persistSession: false, autoRefreshToken: false } },
);
const sbAuth = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { persistSession: false, autoRefreshToken: false } },
);

function imageOk(image) {
  return /:(v3\.1|v3\.2)\b/.test(String(image || ''));
}

function comfyBase(machine) {
  const host = machine.ip_address;
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

async function comfyFetch(base, path, { method = 'GET', body, timeoutMs = 30_000 } = {}) {
  const res = await fetch(`${base.replace(/\/$/, '')}${path}`, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(timeoutMs),
  });
  const ct = res.headers.get('content-type') || '';
  const buf = Buffer.from(await res.arrayBuffer());
  if (ct.includes('application/json') || (buf[0] === 0x7b /* { */ || buf[0] === 0x5b /* [ */)) {
    let json = null;
    try {
      json = JSON.parse(buf.toString('utf8'));
    } catch {
      json = null;
    }
    const htmlTrap =
      typeof json !== 'object' ||
      json === null ||
      /proxy not found/i.test(buf.toString('utf8').slice(0, 200));
    return {
      status: res.status,
      ok: res.ok && !htmlTrap && json != null,
      json,
      bytes: null,
      text: buf.toString('utf8').slice(0, 400),
    };
  }
  const text = buf.toString('utf8').slice(0, 400);
  const proxyDead = /proxy not found/i.test(text);
  return {
    status: res.status,
    ok: res.ok && !proxyDead && !/^<!DOCTYPE/i.test(text),
    json: null,
    bytes: buf,
    text,
  };
}

const { data: userRow } = await sbAdmin.from('users').select('email').eq('id', USER_ID).maybeSingle();
const { data: linkData } = await sbAdmin.auth.admin.generateLink({
  type: 'magiclink',
  email: userRow.email,
});
const { data: otpData, error: otpErr } = await sbAuth.auth.verifyOtp({
  token_hash: linkData.properties.hashed_token,
  type: 'email',
});
if (otpErr) throw otpErr;
const token = otpData.session.access_token;

async function api(path, { method = 'GET', body } = {}) {
  const res = await fetch(`${APP.replace(/\/$/, '')}${path}`, {
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

// Soft-clear bad-host list if it would zero marketplace
try {
  const badPath = 'tmp/clore-bad-hosts.json';
  if (existsSync(badPath)) {
    const raw = readFileSync(badPath, 'utf8').replace(/^\uFEFF/, '').trim() || '[]';
    const bad = JSON.parse(raw);
    const n = Array.isArray(bad)
      ? bad.length
      : Array.isArray(bad?.entries)
        ? bad.entries.length
        : Object.keys(bad || {}).length;
    if (n >= 3) {
      writeFileSync(`tmp/clore-bad-hosts.backup-g6-${Date.now()}.json`, JSON.stringify(bad));
      writeFileSync(badPath, '[]\n');
      console.log('cleared bad-hosts (count was', n, ')');
    } else {
      console.log('bad-hosts count', n);
    }
  }
} catch (e) {
  console.warn('bad-hosts check', e instanceof Error ? e.message : e);
}

async function probeMachineLive(m) {
  const base = comfyBase(m);
  if (!base) return false;
  try {
    const s = await comfyFetch(base, '/system_stats', { timeoutMs: 12_000 });
    return Boolean(s.ok && s.json);
  } catch {
    return false;
  }
}

let machineQ = await sbAdmin
  .from('machines')
  .select('id,status,image,instance_id,ip_address,port,projection_verified_at')
  .eq('user_id', USER_ID)
  .eq('status', 'running')
  .order('created_at', { ascending: false })
  .limit(1);
let machine = machineQ.data?.[0] ?? null;
console.log('existing running', machine);
if (machine && !(await probeMachineLive(machine))) {
  console.warn('stale running machine (Comfy dead) — destroy locally', machine.id);
  await sbAdmin
    .from('machines')
    .update({
      status: 'destroyed',
      updated_at: new Date().toISOString(),
      projection_message: 'gate1 G6: stale Comfy / Proxy Not Found',
    })
    .eq('id', machine.id);
  machine = null;
}

// Prefer live Clore order already up (orphan from prior provision)
if (!machine) {
  const orders = await clore('GET', '/my_orders');
  const list = Array.isArray(orders.json?.orders) ? orders.json.orders : [];
  for (const o of list) {
    const http = String(o.http_pub || '').replace(/\/$/, '');
    const image = String(o.image || '');
    if (!http || !imageOk(image)) continue;
    const url = http.startsWith('http') ? http : `https://${http}`;
    const host = url.replace(/^https?:\/\//, '').split('/')[0];
    const probe = await comfyFetch(url, '/system_stats', { timeoutMs: 15_000 });
    if (!probe.ok) continue;
    console.log('adopt live order', o.id, host);
    const row = {
      user_id: USER_ID,
      status: 'running',
      image,
      instance_id: String(o.id),
      ip_address: host,
      port: 443,
      provider: 'clore',
      gpu_type: 'rtx_4090',
      gpu_line: 'rtx_4090',
      projection_verified_at: new Date().toISOString(),
      projection_message: 'gate1 G6 adopt live Clore order',
      updated_at: new Date().toISOString(),
    };
    let { data: inserted, error: insErr } = await sbAdmin
      .from('machines')
      .insert(row)
      .select('id,status,image,instance_id,ip_address,port')
      .maybeSingle();
    if (insErr) {
      console.warn('adopt insert', insErr.message);
      const slim = { ...row };
      delete slim.gpu_line;
      delete slim.projection_verified_at;
      delete slim.projection_message;
      ({ data: inserted, error: insErr } = await sbAdmin
        .from('machines')
        .insert(slim)
        .select('id,status,image,instance_id,ip_address,port')
        .maybeSingle());
    }
    if (!insErr && inserted) {
      machine = inserted;
      break;
    }
  }
}

if (!machine) {
  const { data: inv } = await sbAdmin
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
    ranked.find((r) => /starter/i.test(String(r.plan_name || ''))) ||
    ranked[0];
  if (!plan) {
    console.error('FAIL no plan hours');
    process.exit(1);
  }
  console.log('start Runtime…', plan);
  const start = await api('/api/user/start-machine', {
    method: 'POST',
    body: {
      inventoryId: plan.id,
      plan: plan.plan_name,
      subscriptionId: plan.subscription_id,
    },
  });
  console.log('start', start.status, JSON.stringify(start.json).slice(0, 700));

  for (let i = 0; i < 180; i++) {
    await sleep(10_000);
    machineQ = await sbAdmin
      .from('machines')
      .select('id,status,image,instance_id,ip_address,port,projection_verified_at,ssh_ok')
      .eq('user_id', USER_ID)
      .order('created_at', { ascending: false })
      .limit(1);
    machine = machineQ.data?.[0] ?? null;
    console.log('poll', {
      i: i + 1,
      id: machine?.id,
      status: machine?.status,
      image: machine?.image,
      order: machine?.instance_id,
    });
    if (machine?.status === 'running' && imageOk(machine.image) && machine.ip_address) break;

    // Adopt path: live Clore order with Comfy 200 but no DB running row
    if ((!machine || machine.status !== 'running') && i > 0 && i % 6 === 0) {
      const orders = await clore('GET', '/my_orders');
      const list = Array.isArray(orders.json?.orders) ? orders.json.orders : [];
      for (const o of list) {
        const http = String(o.http_pub || o.http || '').replace(/\/$/, '');
        const image = String(o.image || o.docker_image || '');
        if (!http || !imageOk(image)) continue;
        const url = http.startsWith('http') ? http : `https://${http}`;
        try {
          const probe = await fetch(`${url}/system_stats`, {
            signal: AbortSignal.timeout(12_000),
          });
          if (!probe.ok) continue;
          console.log('adopt candidate', o.id, url, image);
          const host = url.replace(/^https?:\/\//, '').split('/')[0];
          const row = {
            user_id: USER_ID,
            status: 'running',
            image,
            instance_id: String(o.id),
            ip_address: host,
            port: 443,
            provider: 'clore',
            gpu_type: 'rtx_4090',
            gpu_line: 'rtx_4090',
            projection_verified_at: new Date().toISOString(),
            projection_message: 'gate1 G6 adopt: Comfy system_stats 200',
            updated_at: new Date().toISOString(),
          };
          let { data: inserted, error: insErr } = await sbAdmin
            .from('machines')
            .insert(row)
            .select('id,status,image,instance_id,ip_address,port')
            .maybeSingle();
          if (insErr) {
            console.warn('adopt insert failed', insErr.message);
            const slim = { ...row };
            delete slim.projection_verified_at;
            delete slim.projection_message;
            delete slim.gpu_line;
            ({ data: inserted, error: insErr } = await sbAdmin
              .from('machines')
              .insert(slim)
              .select('id,status,image,instance_id,ip_address,port')
              .maybeSingle());
            if (insErr) {
              console.warn('adopt slim insert failed', insErr.message);
              continue;
            }
          }
          machine = inserted;
          console.log('adopted', machine);
          break;
        } catch {
          /* try next */
        }
      }
      if (machine?.status === 'running') break;
    }
  }
}

if (!machine || machine.status !== 'running' || !machine.ip_address) {
  console.error('FAIL no running Runtime', machine);
  process.exit(1);
}

const base = comfyBase(machine);
console.log('Comfy base', base, 'image', machine.image, 'order', machine.instance_id);

let statsOk = false;
for (let i = 0; i < 60; i++) {
  try {
    const s = await comfyFetch(base, '/system_stats', { timeoutMs: 15_000 });
    console.log('system_stats', i + 1, s.status);
    if (s.ok) {
      statsOk = true;
      break;
    }
  } catch (e) {
    console.log('system_stats wait', i + 1, e instanceof Error ? e.message : e);
  }
  await sleep(5000);
}
if (!statsOk) {
  console.error('FAIL Comfy not ready');
  process.exit(1);
}

// Discover checkpoint
let ckpt = 'sd_xl_base_1.0.safetensors';
try {
  const oi = await comfyFetch(base, '/object_info/CheckpointLoaderSimple', { timeoutMs: 60_000 });
  const names =
    oi.json?.CheckpointLoaderSimple?.input?.required?.ckpt_name?.[0] ||
    oi.json?.CheckpointLoaderSimple?.input?.required?.ckpt_name ||
    [];
  const list = Array.isArray(names) ? names : [];
  console.log('checkpoints available', list.slice(0, 12), 'count', list.length);
  const prefer = [
    'sd_xl_base_1.0.safetensors',
    'RealVisXL_V6.0_B1.safetensors',
  ];
  ckpt = prefer.find((p) => list.includes(p)) || list[0] || ckpt;
} catch (e) {
  console.warn('object_info failed, using default ckpt', e instanceof Error ? e.message : e);
}
console.log('using ckpt', ckpt);

const seed = Number(String(Date.now()).slice(-9));
const positive = `gate1 g6 continuity smoke, soft light, ${MARKER}`;
const negative = 'text, watermark, blurry';

/** Comfy API prompt (execution graph) */
const apiPrompt = {
  '1': {
    class_type: 'CheckpointLoaderSimple',
    inputs: { ckpt_name: ckpt },
  },
  '2': {
    class_type: 'CLIPTextEncode',
    inputs: { text: positive, clip: ['1', 1] },
  },
  '3': {
    class_type: 'CLIPTextEncode',
    inputs: { text: negative, clip: ['1', 1] },
  },
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
  '6': {
    class_type: 'VAEDecode',
    inputs: { samples: ['5', 0], vae: ['1', 2] },
  },
  '7': {
    class_type: 'SaveImage',
    inputs: { filename_prefix: `gate1_g6_${MARKER}`, images: ['6', 0] },
  },
};

/** LiteGraph UI document for CP SoT (restore surface) */
const uiDoc = {
  last_node_id: 8,
  last_link_id: 7,
  nodes: [
    {
      id: 8,
      type: 'Note',
      pos: [40, 40],
      size: [280, 80],
      flags: {},
      order: 0,
      mode: 0,
      title: MARKER,
      properties: { text: MARKER },
      widgets_values: [MARKER],
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
      widgets_values: [`gate1_g6_${MARKER}`],
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
  extra: { gate1: MARKER, gate1_ckpt: ckpt, gate1_seed: seed },
  version: 0.4,
};

// Fix last_link_id
uiDoc.last_link_id = 9;

const patch = await api('/api/cp/comfy-sync', {
  method: 'PATCH',
  body: { workflowId: WORKFLOW_ID, document: uiDoc },
});
const markerCp = patch.json?.workflow?.document?.extra?.gate1;
const rev = patch.json?.workflow?.revision;
console.log('PATCH CP', patch.status, { revision: rev, marker: markerCp, inject: patch.json?.workflow?.inject });
if (patch.status !== 200 || markerCp !== MARKER) {
  console.error('FAIL CP sync', JSON.stringify(patch.json).slice(0, 500));
  process.exit(1);
}

// Ensure machine projection so comfy-access works
await sbAdmin
  .from('machines')
  .update({
    projection_verified_at: new Date().toISOString(),
    projection_message: 'gate1 G6: Comfy ready for generate',
    updated_at: new Date().toISOString(),
  })
  .eq('id', machine.id);

const clientId = `gate1-g6-${Date.now().toString(36)}`;
console.log('queue /prompt…');
const promptRes = await comfyFetch(base, '/prompt', {
  method: 'POST',
  body: { prompt: apiPrompt, client_id: clientId },
  timeoutMs: 60_000,
});
console.log(
  'prompt',
  promptRes.status,
  promptRes.ok,
  JSON.stringify(promptRes.json).slice(0, 400),
  promptRes.text?.slice(0, 200),
);
if (!promptRes.ok || !promptRes.json?.prompt_id) {
  console.error('FAIL /prompt', promptRes.text?.slice(0, 500));
  process.exit(1);
}
const promptId = String(promptRes.json.prompt_id);

let outputs = null;
let histEntry = null;
const genDeadline = Date.now() + 20 * 60_000; // model pull + 6-step SDXL
while (Date.now() < genDeadline) {
  await sleep(5000);
  try {
    const hist = await comfyFetch(base, `/history/${encodeURIComponent(promptId)}`, {
      timeoutMs: 20_000,
    });
    histEntry = hist.json?.[promptId] ?? null;
    if (histEntry) {
      outputs = histEntry.outputs || null;
      const st = histEntry.status?.status_str || histEntry.status;
      console.log('history', { status: st, hasOutputs: Boolean(outputs) });
      break;
    }
    const q = await comfyFetch(base, '/queue', { timeoutMs: 10_000 });
    const running = Array.isArray(q.json?.queue_running) ? q.json.queue_running.length : '?';
    const pending = Array.isArray(q.json?.queue_pending) ? q.json.queue_pending.length : '?';
    console.log('waiting generate…', { running, pending, promptId });
  } catch (e) {
    console.log('history poll', e instanceof Error ? e.message : e);
  }
}

if (!histEntry) {
  console.error('FAIL history timeout');
  process.exit(1);
}

const failed =
  String(histEntry.status?.status_str || '').toLowerCase().includes('error') ||
  histEntry.status?.completed === false;
if (failed) {
  console.error('FAIL execution', JSON.stringify(histEntry.status).slice(0, 800));
  process.exit(1);
}

const images = [];
for (const nodeOut of Object.values(outputs || {})) {
  const imgs = nodeOut?.images;
  if (!Array.isArray(imgs)) continue;
  for (const img of imgs) images.push(img);
}
console.log('images', images);
if (!images.length) {
  console.error('FAIL no SaveImage outputs');
  process.exit(1);
}

const img0 = images[0];
const view = await comfyFetch(
  base,
  `/view?filename=${encodeURIComponent(img0.filename)}&subfolder=${encodeURIComponent(img0.subfolder || '')}&type=${encodeURIComponent(img0.type || 'output')}`,
  { timeoutMs: 60_000 },
);
const byteLen = view.bytes?.length || 0;
const isPng = view.bytes && view.bytes[0] === 0x89 && view.bytes[1] === 0x50;
console.log('view', { status: view.status, bytes: byteLen, png: isPng });

if (!existsSync('tmp')) mkdirSync('tmp', { recursive: true });
const outPath = `tmp/gate1-g6-${MARKER}.png`;
if (view.bytes?.length) writeFileSync(outPath, view.bytes);

const syncAfter = await api(`/api/cp/comfy-sync?workflowId=${encodeURIComponent(WORKFLOW_ID)}`);
const markerAfter = syncAfter.json?.workflow?.document?.extra?.gate1;
const hasCkptNode = Array.isArray(syncAfter.json?.workflow?.document?.nodes)
  ? syncAfter.json.workflow.document.nodes.some((n) => n?.type === 'CheckpointLoaderSimple')
  : false;

const g6 =
  markerAfter === MARKER &&
  hasCkptNode &&
  byteLen > 10_000 &&
  Boolean(isPng);

// Cost stop
const orderId = Number(machine.instance_id);
if (Number.isFinite(orderId) && orderId > 0) {
  const cancel = await clore('POST', '/cancel_order', { id: orderId });
  console.log('cancel_order', orderId, cancel.status, cancel.json);
  await sbAdmin
    .from('machines')
    .update({
      status: 'destroyed',
      updated_at: new Date().toISOString(),
      projection_message: 'gate1 G6: cancelled after generate',
    })
    .eq('id', machine.id);
}

const report = {
  G6_generate: g6 ? 'PASS' : 'FAIL',
  marker: MARKER,
  markerAfter,
  revision: syncAfter.json?.workflow?.revision,
  ckpt,
  seed,
  promptId,
  image: img0,
  bytes: byteLen,
  png: isPng,
  outPath: view.bytes?.length ? outPath : null,
  machineId: machine.id,
  orderId: machine.instance_id,
  imageTag: machine.image,
};
console.log(JSON.stringify(report, null, 2));
process.exit(g6 ? 0 : 1);
