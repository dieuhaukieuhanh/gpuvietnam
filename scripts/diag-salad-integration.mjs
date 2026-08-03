/**
 * SaladCloud integration diagnostic — step-by-step API test.
 *
 * Usage:
 *   $env:SALAD_API_KEY="salad_xxx"
 *   $env:SALAD_ORGANIZATION="gpuvietnam"
 *   $env:SALAD_PROJECT="comfyui"
 *   node scripts/diag-salad-integration.mjs
 */

const apiKey = process.env.SALAD_API_KEY;
const org = process.env.SALAD_ORGANIZATION;
const project = process.env.SALAD_PROJECT;
const priority = process.env.SALAD_PRIORITY || 'high';

const BASE = `https://api.salad.com/api/public/organizations/${org}/projects/${project}`;

function ok(msg) { console.log(`  \x1b[32m✓\x1b[0m ${msg}`); }
function fail(msg) { console.log(`  \x1b[31m✗\x1b[0m ${msg}`); }
function hdr(msg) { console.log(`\n\x1b[1m${msg}\x1b[0m`); }

/** Extract status string from Salad's nested current_state object. */
function stateStr(result) {
  if (!result) return '?';
  const cs = result.current_state;
  if (cs && typeof cs === 'object') return cs.status || '?';
  return String(cs || '?');
}

async function api(method, path, body) {
  // Org-scoped paths start with /organizations — project-scoped paths don't.
  const url = path.startsWith('/organizations')
    ? `https://api.salad.com/api/public${path}`
    : path.startsWith('http')
      ? path
      : `${BASE}${path}`;
  const headers = {
    'Salad-Api-Key': apiKey,
    'Content-Type': 'application/json',
    Accept: 'application/json',
  };
  const init = { method, headers };
  if (body) init.body = JSON.stringify(body);

  console.log(`  ${method} ${url.replace(BASE, '')}`);
  const t0 = Date.now();
  const res = await fetch(url, init);
  const text = await res.text();
  const ms = Date.now() - t0;

  let json = null;
  try { json = JSON.parse(text); } catch {}

  console.log(`  → HTTP ${res.status} (${ms}ms)`);
  if (json) {
    console.log(`  → Response: ${JSON.stringify(json).slice(0, 800)}`);
  } else if (text) {
    console.log(`  → Body: ${text.slice(0, 500)}`);
  }
  if (!res.ok && json?.message) {
    console.log(`  → Error msg: ${json.message}`);
  }
  return { ok: res.ok, status: res.status, json, text, ms };
}

async function main() {
  console.log('=== SaladCloud API Diagnostic ===');
  console.log(`Org: ${org}  Project: ${project}  Priority: ${priority}\n`);

  // 1. List GPU classes
  hdr('1. List GPU classes');
  const gpu = await api('GET', `/organizations/${org}/gpu-classes`);
  if (gpu.ok) {
    const items = gpu.json?.items || [];
    ok(`${items.length} GPU classes found`);
    for (const c of items) {
      console.log(`     ${c.name} (${c.display_name || ''}) → ${c.id}`);
      if (c.prices) {
        for (const p of c.prices) {
          console.log(`       ${p.priority}: $${p.price}/hr`);
        }
      }
    }
  } else fail('GPU classes failed');

  // 2. Check quotas (Salad nests under container_groups_quotas)
  hdr('2. Quotas');
  const q = await api('GET', `/organizations/${org}/quotas`);
  const gq = q.json?.container_groups_quotas;
  if (q.ok && gq) {
    ok(`container_replicas: ${gq.container_replicas_used}/${gq.container_replicas_quota}`);
    ok(`max_group_recreates: ${gq.max_container_group_recreates_per_minute}/min`);
    ok(`max_group_restarts: ${gq.max_container_group_restarts_per_minute}/min`);
  } else fail(`Quotas failed`);

  if (q.ok && gq?.container_replicas_quota === 0) {
    console.log('\n  ⚠️  Your account has 0 container replica quota.');
    console.log('  Contact SaladCloud support to enable Container Groups for your account.');
    console.log('  Some accounts start with API Endpoints (Inference) only — need Container Group access.\n');
    process.exit(0);
  }

  // 3. Create container group
  const gpuLine = process.env.GPU_LINE || 'rtx4090_1x';
  const testMode = (process.env.TEST_MODE || ''); // empty=full, "simple", "noop", "bash"
  const gpuToken = gpuLine.includes('3090') ? '3090' : gpuLine.includes('5090') ? '5090' : '4090';

  let image, command, modeLabel;
  if (testMode === 'simple') {
    image = 'saladtechnologies/misc:test';
    command = ['sh', '-c', 'echo ready && sleep 3600'];
    modeLabel = 'SIMPLE TEST';
  } else if (testMode === 'noop') {
    image = 'dieuhaukieuhanh/gpuvietnam-comfyui:v3.6';
    command = ['sh', '-c', 'echo v3.6 loaded OK && nvidia-smi && sleep 3600'];
    modeLabel = 'NO-OP (skip start.sh, just nvidia-smi)';
  } else if (testMode === 'bash') {
    image = 'dieuhaukieuhanh/gpuvietnam-comfyui:v3.6';
    command = ['/bin/bash', '-c', 'set -x; cd /app/ComfyUI && ls -la && nvidia-smi && python -c "import torch; print(torch.cuda.is_available())" && echo ALL_CHECKS_PASSED && sleep 3600'];
    modeLabel = 'BASH DEBUG (manual checks)';
  } else {
    image = 'dieuhaukieuhanh/gpuvietnam-comfyui:v3.6';
    command = [];
    modeLabel = 'FULL (default start.sh)';
  }
  hdr(`3. Create Container Group (RTX ${gpuToken}, high priority, ${modeLabel})`);

  const gpuItems = gpu.json?.items || [];
  const selectedGpu = gpuItems.find((c) =>
    c.name?.toLowerCase().includes(gpuToken.toLowerCase()) &&
    !c.name?.toLowerCase().includes('laptop') &&
    !c.name?.toLowerCase().includes('ti')
  );
  if (!selectedGpu) { fail(`RTX ${gpuToken} not found in GPU classes`); process.exit(1); }

  const containerName = `diag-${Date.now().toString(36)}`;
  const createBody = {
    name: containerName,
    display_name: containerName,
    container: {
      image,
      command,
      resources: {
        cpu: 4,
        memory: 32768,
        gpu_classes: [selectedGpu.id],
        storage_amount: 53_687_091_200, // 50 GiB (max Salad)
        shm_size: 1024,
      },
      priority,
      environment_variables: {
        HOST: '::',
        PORT: '8080',
        COMFYUI_PORT: '8080',
      },
    },
    autostart_policy: true,
    restart_policy: 'never',
    replicas: 1,
    networking: {
      protocol: 'http',
      port: 8080,
      auth: false,
      load_balancer: 'least_number_of_connections',
      client_request_timeout: 100000,
      server_response_timeout: 100000,
    },
  };

  const create = await api('POST', '/containers', createBody);
  if (create.ok) {
    ok(`Created: ${create.json?.name}, state: ${stateStr(create.json)}`);
    ok(`Networking DNS: ${create.json?.networking?.dns || 'not yet available'}`);

    // 4. Poll until running (autostart=true, Salad prepares + starts + deploys automatically)
    hdr('4. Wait for running (autostart_policy=true, timeout 15 min)');
    let g = create.json;
    let s = stateStr(g);
    const deadline = Date.now() + 900_000;
    let lastStatus = '';
    while (Date.now() < deadline) {
      const poll = await api('GET', `/containers/${containerName}`);
      g = poll.json; s = stateStr(poll.json);
      const desc = g?.current_state?.description || '';
      const statusInfo = desc ? `${s} (${desc})` : s;
      if (statusInfo !== lastStatus) {
        console.log(`  → ${statusInfo}`);
        lastStatus = statusInfo;
      }
      if (s === 'running') { ok(`RUNNING! DNS: ${g?.networking?.dns}`); break; }
      if (s === 'failed') { fail(`FAILED: ${desc}`); break; }
      await new Promise((r) => setTimeout(r, 10_000));
    }

    // 5. Quick health check
    if (s === 'running') {
      hdr('5. Quick health check (/system_stats)');
      const dns = g?.networking?.dns;
      if (dns) {
        try {
          const res = await fetch(`https://${dns}/system_stats`, { signal: AbortSignal.timeout(15000) });
          if (res.ok) {
            const stats = await res.json();
            const devices = stats?.devices || [];
            const names = Array.isArray(devices) ? devices.map((d) => d.name || '?').join(', ') : '?';
            ok(`/system_stats OK — GPUs: ${names}`);
          } else {
            fail(`/system_stats HTTP ${res.status} — may still be booting`);
          }
        } catch (err) {
          fail(`/system_stats error: ${err.message}`);
        }
      }
    }

    // 6. Cleanup
    hdr('6. Cleanup');
    await api('POST', `/containers/${containerName}/stop`);
    await api('DELETE', `/containers/${containerName}`);
    ok('Done');
  } else {
    fail(`Create failed — check account permissions.`);
  }
}

main().catch((err) => { console.error('FATAL:', err); process.exit(1); });
