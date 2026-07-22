/**
 * P0-A acceptance smoke — durable lifecycle chain (DB + optional API).
 *
 * Does NOT claim P0-A closed by itself. Prints gate table for operator.
 *
 * Usage:
 *   node scripts/p0a-lifecycle-smoke.mjs              # schema + queue probe
 *   node scripts/p0a-lifecycle-smoke.mjs --watch <operationId>
 *   node scripts/p0a-lifecycle-smoke.mjs --start       # POST start-machine (needs auth env)
 *
 * Env (.env.local or process):
 *   NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
 *   OWNER_USER_ID (default owner test uid)
 *   P0A_SMOKE_APP_URL — base for --start (local Next or apex)
 *   P0A_SMOKE_BEARER — user JWT for start-machine
 */
import { readFileSync, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { createClient } from '@supabase/supabase-js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const OWNER_DEFAULT = '70feafcf-6ad1-4b13-bb99-eae5a538d20a';

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
    const k = t.slice(0, i).trim();
    if (process.env[k] == null) process.env[k] = v;
  }
}

loadEnv();

const args = process.argv.slice(2);
const watchIdx = args.indexOf('--watch');
const watchId = watchIdx >= 0 ? args[watchIdx + 1] : null;
const doStart = args.includes('--start');

/** @type {{ gate: string; status: 'PASS'|'FAIL'|'SKIP'|'MANUAL'; detail: string }[]} */
const gates = [];

function gate(name, status, detail) {
  gates.push({ gate: name, status, detail });
  const mark = status === 'PASS' ? 'OK' : status === 'FAIL' ? 'XX' : '--';
  console.log(`[${mark}] ${name}: ${detail}`);
}

function sb() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error('missing NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY');
  return createClient(url, key, { auth: { persistSession: false } });
}

async function gateSchema(client) {
  const userId = process.env.OWNER_USER_ID || OWNER_DEFAULT;
  const correlationId = randomUUID();
  const idem = `p0a-smoke-schema-${Date.now()}`;
  const { data, error } = await client
    .from('machine_operations')
    .insert({
      operation: 'user_start_provision',
      user_id: userId,
      idempotency_key: idem,
      correlation_id: correlationId,
      priority: 70,
      payload: { smoke: 'schema' },
      retry_policy: 'user_start_provision',
      state: 'pending',
    })
    .select('id,operation,state')
    .single();

  if (error) {
    const needMig =
      /operation_check|invalid input|check constraint/i.test(error.message) ||
      error.code === '23514';
    gate(
      'Schema',
      'FAIL',
      needMig
        ? `migration 0049 NOT applied (${error.message})`
        : `insert failed: ${error.message}`,
    );
    return null;
  }

  gate('Schema', 'PASS', `migration 0049 ok — probe op ${data.id}`);
  await client.from('machine_operations').delete().eq('id', data.id);
  return data.id;
}

async function gateWatch(client, operationId) {
  const deadline = Date.now() + Number(process.env.P0A_SMOKE_WATCH_MS || 20 * 60_000);
  let sawLease = false;
  let sawClaim = false;
  let lastState = '';
  let machineId = null;
  const hit = new Set();

  console.log(`\nWatching operation ${operationId} …`);

  while (Date.now() < deadline) {
    const { data: op, error } = await client
      .from('machine_operations')
      .select(
        'id,state,lease_until,lease_count,attempts,started_at,completed_at,last_error,error_message,payload,machine_id,updated_at',
      )
      .eq('id', operationId)
      .maybeSingle();

    if (error) {
      gate('Durable', 'FAIL', error.message);
      return;
    }
    if (!op) {
      gate('Durable', 'FAIL', 'operation row missing');
      return;
    }

    if (op.state !== lastState) {
      console.log(
        `  state=${op.state} lease_until=${op.lease_until || '-'} lease_count=${op.lease_count ?? '-'} machine_id=${op.machine_id || '-'}`,
      );
      lastState = op.state;
    }

    if (
      !hit.has('Durable') &&
      ['pending', 'leased', 'running', 'retry_scheduled', 'completed'].includes(op.state)
    ) {
      hit.add('Durable');
      gate('Durable', 'PASS', `row exists state=${op.state}`);
    }

    if (
      !hit.has('Worker') &&
      (op.state === 'leased' || op.state === 'running' || Number(op.lease_count) > 0)
    ) {
      hit.add('Worker');
      sawClaim = true;
      gate('Worker', 'PASS', `claimed (state=${op.state} lease_count=${op.lease_count ?? 0})`);
    }
    if (!hit.has('Lease') && op.lease_until) {
      hit.add('Lease');
      sawLease = true;
      gate('Lease', 'PASS', `lease_until=${op.lease_until}`);
    }

    if (op.machine_id) machineId = op.machine_id;

    if (op.state === 'completed') {
      gate('Completion', 'PASS', `operation completed at ${op.completed_at}`);
      if (machineId || op.machine_id) {
        const mid = machineId || op.machine_id;
        const { data: m } = await client
          .from('machines')
          .select('id,status,provider_instance_id,comfy_ready_at,endpoint_url')
          .eq('id', mid)
          .maybeSingle();
        if (m && /running|ready/i.test(String(m.status || ''))) {
          gate(
            'Provision',
            'PASS',
            `machine ${m.id} status=${m.status} instance=${m.provider_instance_id || '-'}`,
          );
        } else if (m) {
          gate('Provision', 'FAIL', `machine ${m.id} status=${m.status}`);
        } else {
          gate('Provision', 'FAIL', 'completed op but machine row missing');
        }
      } else {
        const payloadMachine = op.payload?.machineId || op.payload?.machine_id;
        if (payloadMachine) {
          gate('Provision', 'PASS', `machine id in payload ${payloadMachine}`);
        } else {
          gate('Provision', 'SKIP', 'no machine_id on completed row — verify manually');
        }
      }
      return;
    }

    if (op.state === 'dead_letter' || op.state === 'failed') {
      gate(
        'Completion',
        'FAIL',
        `${op.state}: ${op.last_error || op.error_message || 'no message'}`,
      );
      return;
    }

    await new Promise((r) => setTimeout(r, 5000));
  }

  if (!sawClaim) gate('Worker', 'FAIL', 'never claimed before timeout — is VPS worker running?');
  if (!sawLease) gate('Lease', 'FAIL', 'never saw lease_until');
  gate('Completion', 'FAIL', 'timeout waiting for completed');
}

async function gateStart() {
  const base = (process.env.P0A_SMOKE_APP_URL || process.env.PROVISION_APP_URL || '').replace(
    /\/$/,
    '',
  );
  const bearer = process.env.P0A_SMOKE_BEARER;
  if (!base || !bearer) {
    gate(
      'Enqueue',
      'SKIP',
      'set P0A_SMOKE_APP_URL + P0A_SMOKE_BEARER to POST start-machine',
    );
    return null;
  }

  const res = await fetch(`${base}/api/user/start-machine`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${bearer}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({}),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    gate('Enqueue', 'FAIL', `HTTP ${res.status} ${JSON.stringify(body).slice(0, 200)}`);
    return null;
  }
  const operationId = body.operationId || body.operation_id;
  if (!operationId) {
    gate('Enqueue', 'FAIL', `no operationId in response: ${JSON.stringify(body).slice(0, 200)}`);
    return null;
  }
  gate('Enqueue', 'PASS', `operationId=${operationId}`);
  return operationId;
}

function printManualGates() {
  console.log('\n--- Manual gates (operator on VPS) ---');
  const manual = [
    ['Recovery', 'Kill worker mid-op → wait lease expire → new worker reclaim'],
    ['Restart', 'systemctl restart gpuvietnam-lifecycle-worker — op not lost'],
    ['Orphan', 'Force Clore/machine drift → worker reconcile'],
    ['Service', 'kill -9 worker PID → systemd Restart=always brings it back'],
    ['Comfy Runtime', 'object_info / Generate ready after provision'],
  ];
  for (const [name, detail] of manual) {
    gate(name, 'MANUAL', detail);
  }
}

async function main() {
  console.log('P0-A lifecycle smoke\n');
  const client = sb();

  await gateSchema(client);

  let opId = watchId || null;
  if (doStart) {
    opId = (await gateStart()) || opId;
  }

  if (opId) {
    await gateWatch(client, opId);
  } else {
    gate('Enqueue', 'SKIP', 'pass --start or --watch <operationId>');
    gate('Durable', 'SKIP', 'needs live operation');
    gate('Worker', 'SKIP', 'needs live operation');
    gate('Lease', 'SKIP', 'needs live operation');
    gate('Provision', 'SKIP', 'needs live operation');
    gate('Completion', 'SKIP', 'needs live operation');
  }

  printManualGates();

  const outDir = join(root, 'tmp');
  mkdirSync(outDir, { recursive: true });
  const outPath = join(outDir, `p0a-lifecycle-smoke-${Date.now()}.json`);
  const summary = {
    at: new Date().toISOString(),
    operationId: opId,
    gates,
    pass: gates.filter((g) => g.status === 'PASS').length,
    fail: gates.filter((g) => g.status === 'FAIL').length,
    skip: gates.filter((g) => g.status === 'SKIP').length,
    manual: gates.filter((g) => g.status === 'MANUAL').length,
    closed:
      gates.some((g) => g.gate === 'Schema' && g.status === 'PASS') &&
      gates.some((g) => g.gate === 'Enqueue' && g.status === 'PASS') &&
      gates.some((g) => g.gate === 'Worker' && g.status === 'PASS') &&
      gates.some((g) => g.gate === 'Lease' && g.status === 'PASS') &&
      gates.some((g) => g.gate === 'Provision' && g.status === 'PASS') &&
      gates.some((g) => g.gate === 'Completion' && g.status === 'PASS'),
  };
  writeFileSync(outPath, JSON.stringify(summary, null, 2));
  console.log(`\nWrote ${outPath}`);
  console.log(
    summary.closed
      ? '\nP0-A automated gates: PASS — still run MANUAL gates before closing P0-A.'
      : '\nP0-A NOT CLOSED — fix FAIL / run --start|--watch + MANUAL gates.',
  );
  process.exit(summary.fail > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
