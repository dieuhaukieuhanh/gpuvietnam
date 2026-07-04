import { getPlanNameFromKey } from '@/lib/gpu-pricing';

import { DEFAULT_GPU_PORT } from '@/lib/gpu/gpu-config';

import { ComfyClient } from '@/lib/gpu/providers/vast/comfy-client';

import { syncUserPlanInventory, parseInventoryId } from '@/lib/user-plan-inventory';

import {
  calculateRemaining,
} from './remaining-time.js';
import { mapRemainingResultToBillingCredit } from './billing-projection.js';
import { calculateBillableSeconds, skipSessionSettlement } from './settlement.js';
import { resolveBillingAnchorFromRecords } from './billing-anchor-core.js';

export { mapRemainingResultToBillingCredit };

function roundHours(value) {

  return Math.round(Number(value) * 100) / 100;

}



const ACTIVE_MACHINE_STATUSES = ['creating', 'starting', 'running'];

export { resolveBillingAnchorFromRecords } from './billing-anchor-core.js';

/**

 * @param {Date} startedAt

 * @param {Date} endedAt

 * @param {Record<string, unknown> | null | undefined} machine

 */

function computeBillableDurationSeconds(startedAt, endedAt, machine) {

  let effectiveStart = startedAt;

  if (machine?.created_at) {

    const machineCreated = new Date(String(machine.created_at));

    if (Number.isFinite(machineCreated.getTime()) && machineCreated > effectiveStart) {

      effectiveStart = machineCreated;

    }

  }



  const rawSeconds = Math.max(0, Math.floor((endedAt.getTime() - effectiveStart.getTime()) / 1000));

  if (!machine?.created_at) return rawSeconds;



  const machineCreated = new Date(String(machine.created_at));

  const maxSeconds = Math.max(

    0,

    Math.floor((endedAt.getTime() - machineCreated.getTime()) / 1000) + 60,

  );

  return Math.min(rawSeconds, maxSeconds);

}



/**

 * @param {Record<string, unknown>} row

 */

function isInventoryRowUsable(row) {

  if (!row || row.status !== 'active') return false;

  if (Number(row.hours_remaining ?? 0) <= 0 && row.plan_type !== 'hourly') return false;

  if (row.valid_until && new Date(String(row.valid_until)).getTime() <= Date.now()) return false;

  return true;

}



/**

 * CORE LOGIC order: gift (expiring soonest) → combo → hourly.

 * @param {Record<string, unknown>} a

 * @param {Record<string, unknown>} b

 */

function compareBillablePlanPriority(a, b) {

  const tier = (row) => {

    if (row.plan_type === 'gift') return 0;

    if (row.plan_type === 'combo') return 1;

    if (row.plan_type === 'hourly') return 2;

    return 3;

  };



  const tierDiff = tier(a) - tier(b);

  if (tierDiff !== 0) return tierDiff;



  if (a.plan_type === 'gift' && b.plan_type === 'gift') {

    const aExpiry = a.valid_until ? new Date(String(a.valid_until)).getTime() : Number.MAX_SAFE_INTEGER;

    const bExpiry = b.valid_until ? new Date(String(b.valid_until)).getTime() : Number.MAX_SAFE_INTEGER;

    return aExpiry - bExpiry;

  }



  return 0;

}



/**

 * @param {import('@supabase/supabase-js').SupabaseClient} supabaseAdmin

 * @param {string} userId

 */

/**
 * @param {import('@supabase/supabase-js').SupabaseClient} supabaseAdmin
 * @param {string} userId
 */
export async function fetchOrderedBillablePlansForUser(supabaseAdmin, userId) {
  const { data: rows, error } = await supabaseAdmin
    .from('user_plan_inventory')
    .select('*')
    .eq('user_id', userId)
    .eq('status', 'active');

  if (error) throw error;

  return (rows ?? []).filter(isInventoryRowUsable).sort(compareBillablePlanPriority);
}

async function fetchOrderedBillablePlans(supabaseAdmin, userId) {
  return fetchOrderedBillablePlansForUser(supabaseAdmin, userId);
}



/**

 * @param {import('@supabase/supabase-js').SupabaseClient} supabaseAdmin

 * @param {string} userId

 * @param {Record<string, unknown>[]} plans

 */

async function pickPlanWithCredit(supabaseAdmin, userId, plans) {

  for (const plan of plans) {

    if (plan.plan_type === 'hourly') {

      const { data: userRow } = await supabaseAdmin

        .from('users')

        .select('wallet_balance')

        .eq('id', userId)

        .maybeSingle();

      const pricePerHour = Number(plan.price_per_hour ?? 0);

      const balance = Number(userRow?.wallet_balance ?? 0);

      if (pricePerHour > 0 && balance > 0) return plan;

      if (pricePerHour <= 0) return plan;

      continue;

    }

    if (Number(plan.hours_remaining ?? 0) > 0) return plan;

  }

  return null;

}



/**

 * @param {import('@supabase/supabase-js').SupabaseClient} supabaseAdmin

 * @param {string} machineId

 */

async function clearMachineBillingFields(supabaseAdmin, machineId) {

  await supabaseAdmin

    .from('machines')

    .update({

      billing_started_at: null,

      gpu_session_id: null,

      billing_inventory_id: null,

      updated_at: new Date().toISOString(),

    })

    .eq('id', machineId);

}



/** @deprecated M7 — use {@link clearMachineBillingFieldsForPipeline} from destroy pipeline */

export async function clearMachineBillingFieldsForPipeline(supabaseAdmin, machineId) {

  return clearMachineBillingFields(supabaseAdmin, machineId);

}



/**

 * Record zero-charge usage on a session that the lifecycle layer closes without
 * charging plan hours (orphan / boot cancel).
 *
 * SCB 3.0 (M4): billing must NOT mutate session lifecycle. Writes only usage
 * fields. The lifecycle transition (running -> closed) is owned by
 * session-lifecycle.js / destroy pipeline / reconciliation.

 * @param {import('@supabase/supabase-js').SupabaseClient} supabaseAdmin

 * @param {string} sessionId

 * @param {string} [reason]

 */

async function closeSessionWithoutCharge(supabaseAdmin, sessionId, reason = 'orphan_auto_closed') {

  await supabaseAdmin

    .from('gpu_sessions')

    .update({

      duration_seconds: 0,

      output_summary: reason,

    })

    .eq('id', sessionId);

}



/**

 * @param {import('@supabase/supabase-js').SupabaseClient} supabaseAdmin

 * @param {string} userId

 * @param {{ exceptSessionId?: string | null }} [options]

 */

export async function closeOrphanRunningSessions(supabaseAdmin, userId, options = {}) {

  const [{ data: runningSessions }, { data: activeMachines }] = await Promise.all([

    supabaseAdmin

      .from('gpu_sessions')

      .select('id')

      .eq('user_id', userId)

      .eq('status', 'running'),

    supabaseAdmin

      .from('machines')

      .select('gpu_session_id')

      .eq('user_id', userId)

      .in('status', ACTIVE_MACHINE_STATUSES),

  ]);



  const linkedSessionIds = new Set(

    (activeMachines ?? [])

      .map((row) => (row.gpu_session_id ? String(row.gpu_session_id) : null))

      .filter(Boolean),

  );



  let closed = 0;

  for (const session of runningSessions ?? []) {

    const sessionId = String(session.id);

    if (options.exceptSessionId && sessionId === options.exceptSessionId) continue;

    if (linkedSessionIds.has(sessionId)) continue;

    await closeSessionWithoutCharge(supabaseAdmin, sessionId);

    closed += 1;

  }



  return { closed };

}



/**

 * @param {import('@supabase/supabase-js').SupabaseClient} supabaseAdmin

 * @param {Record<string, unknown>} machine

 */

async function settleLinkedSessionWithoutCharge(supabaseAdmin, machine) {

  if (machine.gpu_session_id) {

    const sessionId = String(machine.gpu_session_id);

    const { data: session } = await supabaseAdmin

      .from('gpu_sessions')

      .select('status, settlement_status')

      .eq('id', sessionId)

      .maybeSingle();



    if (session?.status === 'closed') {

      await skipSessionSettlement(supabaseAdmin, sessionId, 'billing_waived');

    } else {

      await closeSessionWithoutCharge(supabaseAdmin, sessionId, 'boot_cancelled_no_charge');

    }

  }

  await clearMachineBillingFields(supabaseAdmin, String(machine.id));

}



/**

 * @param {import('@supabase/supabase-js').SupabaseClient} supabaseAdmin

 * @param {Record<string, unknown>} machine

 */

export async function settleMachineBillingWithoutCharge(supabaseAdmin, machine) {

  return settleLinkedSessionWithoutCharge(supabaseAdmin, machine);

}



function extractEndpointFromMachine(machine) {

  const ip = typeof machine?.ip_address === 'string' ? machine.ip_address : null;

  const port = Number(machine?.port ?? DEFAULT_GPU_PORT);

  if (!ip) {

    return { ip: null, port, comfyUrl: null };

  }

  const comfyUrl = `http://${ip}:${port}`;

  return { ip, port, comfyUrl };

}



/**

 * @param {import('@supabase/supabase-js').SupabaseClient} supabaseAdmin

 * @param {string} userId

 * @param {string} instanceId

 */

export async function findMachineForBilling(supabaseAdmin, userId, instanceId) {

  const { data, error } = await supabaseAdmin

    .from('machines')

    .select('*')

    .eq('user_id', userId)

    .eq('instance_id', instanceId)

    .order('created_at', { ascending: false })

    .limit(1)

    .maybeSingle();



  if (error) throw error;

  return data;

}



/**

 * @param {import('@supabase/supabase-js').SupabaseClient} supabaseAdmin

 * @param {string} sessionId

 */

async function loadRunningBillingSession(supabaseAdmin, sessionId) {

  const { data, error } = await supabaseAdmin

    .from('gpu_sessions')

    .select('id, started_at, status, duration_seconds')

    .eq('id', sessionId)

    .maybeSingle();



  if (error) throw error;

  return data;

}


/**

 * @param {import('@supabase/supabase-js').SupabaseClient} supabaseAdmin

 * @param {string} userId

 */

async function fetchUserSessionsForRemaining(supabaseAdmin, userId) {

  const { data, error } = await supabaseAdmin

    .from('gpu_sessions')

    .select('status, started_at, ended_at, settlement_status')

    .eq('user_id', userId);



  if (error) throw error;

  return data ?? [];

}



/**

 * @param {import('@supabase/supabase-js').SupabaseClient} supabaseAdmin

 * @param {string} userId

 * @param {Record<string, unknown> | null | undefined} machine

 * @param {{ startedAt: string|null, sessionId: string|null }} anchor

 */

async function buildRemainingSnapshot(supabaseAdmin, userId, machine, anchor) {

  const [plans, sessions, userResult] = await Promise.all([

    fetchOrderedBillablePlans(supabaseAdmin, userId),

    fetchUserSessionsForRemaining(supabaseAdmin, userId),

    supabaseAdmin.from('users').select('wallet_balance').eq('id', userId).maybeSingle(),

  ]);



  const machineRunning = machine && String(machine.status ?? '') === 'running';

  const providerRunningVerified = Boolean(

    machineRunning && anchor.startedAt && anchor.sessionId,

  );



  return {

    snapshot: {

      entitlementPlans: plans,

      walletBalance: userResult.data?.wallet_balance ?? 0,

      sessions,

      providerRunningVerified,

    },

    walletBalance: userResult.data?.wallet_balance ?? null,

  };

}



/**

 * @param {import('@supabase/supabase-js').SupabaseClient} supabaseAdmin

 * @param {string} userId

 */

export async function repairUserBillingState(supabaseAdmin, userId) {

  const orphanResult = await closeOrphanRunningSessions(supabaseAdmin, userId);



  const { data: bootingMachines } = await supabaseAdmin

    .from('machines')

    .select('id, gpu_session_id, billing_started_at, status')

    .eq('user_id', userId)

    .in('status', ['creating', 'starting'])

    .not('billing_started_at', 'is', null);



  let clearedBootBilling = 0;

  for (const machine of bootingMachines ?? []) {

    await settleLinkedSessionWithoutCharge(supabaseAdmin, machine);

    clearedBootBilling += 1;

  }



  return { ...orphanResult, clearedBootBilling };

}



/**

 * Persist billing anchor on machine row — fall back if optional columns reject UUIDs.

 * @param {import('@supabase/supabase-js').SupabaseClient} supabaseAdmin

 * @param {Record<string, unknown>} machine

 * @param {string} sessionId

 * @param {string} startedAt

 * @param {number | null} inventoryId

 */

export async function linkMachineToBillingSession(supabaseAdmin, machine, sessionId, startedAt, inventoryId) {

  const now = new Date().toISOString();

  /** @type {Record<string, unknown>[]} */

  const attempts = [

    {

      billing_started_at: startedAt,

      gpu_session_id: sessionId,

      ...(inventoryId ? { billing_inventory_id: inventoryId } : {}),

      updated_at: now,

    },

    {

      billing_started_at: startedAt,

      gpu_session_id: sessionId,

      updated_at: now,

    },

    {

      billing_started_at: startedAt,

      updated_at: now,

    },

  ];



  let lastError = null;

  for (const patch of attempts) {

    const { error } = await supabaseAdmin.from('machines').update(patch).eq('id', machine.id);

    if (!error) return;

    lastError = error;

    if (error.code !== '22P02') break;

  }



  if (lastError) throw lastError;

}



/**

 * Resolve when billing started for an active machine.

 * @param {import('@supabase/supabase-js').SupabaseClient} supabaseAdmin

 * @param {string} userId

 * @param {Record<string, unknown> | null | undefined} machine

 */

async function resolveBillingAnchor(supabaseAdmin, userId, machine) {

  let linkedSession = null;

  if (machine?.gpu_session_id) {

    const { data, error } = await supabaseAdmin

      .from('gpu_sessions')

      .select('id, machine_id, started_at, status')

      .eq('id', String(machine.gpu_session_id))

      .maybeSingle();

    if (error) throw error;

    linkedSession = data;

  }

  // FK fallback: when projection gpu_session_id drifted null/stale, query by authoritative FK.
  // gpu_sessions.machine_id is the relational SoT (machines-billing.sql:13-16, idx_gpu_sessions_machine).
  if (!linkedSession && machine?.id) {

    const { data, error } = await supabaseAdmin

      .from('gpu_sessions')

      .select('id, machine_id, started_at, status')

      .eq('machine_id', String(machine.id))

      .eq('status', 'running')

      .order('started_at', { ascending: false })

      .limit(1)

      .maybeSingle();

    if (error) throw error;

    linkedSession = data;

  }

  const resolved = resolveBillingAnchorFromRecords(machine, linkedSession);

  return resolved;

}



/**

 * @param {import('@supabase/supabase-js').SupabaseClient} supabaseAdmin

 * @param {Record<string, unknown>} machine

 * @param {{ startedAt: string; sessionId: string | null }} anchor

 */

async function persistBillingAnchorIfDrifted(supabaseAdmin, machine, anchor) {

  if (!anchor.startedAt || !anchor.sessionId) return;

  const current = machine.billing_started_at ? String(machine.billing_started_at) : null;

  if (current === anchor.startedAt) return;

  const inventoryId =

    machine.billing_inventory_id != null ? Number(machine.billing_inventory_id) : null;

  await linkMachineToBillingSession(

    supabaseAdmin,

    machine,

    anchor.sessionId,

    anchor.startedAt,

    Number.isFinite(inventoryId) ? inventoryId : null,

  );

}



/**

 * @param {Record<string, unknown> | null | undefined} machine

 */

export async function collectSessionMetrics(machine) {

  const { comfyUrl } = extractEndpointFromMachine(machine);

  if (!comfyUrl) {

    return { vramAvg: null, outputCount: 0 };

  }



  const comfy = new ComfyClient(comfyUrl);

  let vramAvg = null;

  let outputCount = 0;



  try {

    const stats = await comfy.request('/system_stats');

    const devices = Array.isArray(stats?.devices) ? stats.devices : [];

    const cudaDevice = devices.find((device) => device?.type === 'cuda') ?? devices[0];

    const total = Number(cudaDevice?.vram_total ?? 0);

    const free = Number(cudaDevice?.vram_free ?? 0);

    if (total > 0) {

      vramAvg = Math.round(((total - free) / total) * 100);

    }

  } catch (error) {

    console.warn('[gpu/billing] system_stats failed:', error);

  }



  try {

    const history = await comfy.request('/history');

    if (history && typeof history === 'object') {

      for (const entry of Object.values(history)) {

        const outputs = entry?.outputs ?? {};

        for (const nodeOutput of Object.values(outputs)) {

          if (!nodeOutput || typeof nodeOutput !== 'object') continue;

          outputCount += Array.isArray(nodeOutput.images) ? nodeOutput.images.length : 0;

        }

      }

    }

  } catch (error) {

    console.warn('[gpu/billing] history failed:', error);

  }



  return { vramAvg, outputCount };

}



/**
 * @param {import('@supabase/supabase-js').SupabaseClient} supabaseAdmin

 * @param {Record<string, unknown>} machine

 * @param {{ durationSeconds?: number; hoursUsed?: number; sessionId?: string | null; endedAt?: string; skipped?: boolean }} billingResult

 * @param {{ vramAvg?: number | null; outputCount?: number }} metrics

 */

export async function finalizeGpuSession(supabaseAdmin, machine, billingResult, metrics = {}) {

  const sessionId = billingResult.sessionId ?? machine.gpu_session_id;

  if (!sessionId) return null;



  const { data: existing, error: loadError } = await supabaseAdmin
    .from('gpu_sessions')
    .select('id')
    .eq('id', sessionId)
    .maybeSingle();

  if (loadError) throw loadError;
  if (!existing) return null;

  const outputCount = Number(metrics.outputCount ?? 0);
  const outputSummary = outputCount > 0 ? `${outputCount} file output` : '—';
  const durationSeconds = billingResult.durationSeconds ?? 0;

  // SCB 3.0 (M4): billing records usage only. Lifecycle (status / ended_at) is
  // owned by session-lifecycle.js and must already be transitioned to `closed`
  // by the destroy pipeline before this step. No status / ended_at write here.
  const patch = {
    duration_seconds: durationSeconds,
    vram_avg_pct: metrics.vramAvg ?? null,
    output_count: outputCount,
    output_summary: outputSummary,
  };

  const { data, error } = await supabaseAdmin
    .from('gpu_sessions')
    .update(patch)
    .eq('id', sessionId)
    .select('*')
    .maybeSingle();

  if (error) throw error;
  return data;
}



/**

 * @param {import('@supabase/supabase-js').SupabaseClient} supabaseAdmin

 * @param {string} userId

 * @param {Record<string, unknown> | null | undefined} machine

 */

export async function getBillingStatus(supabaseAdmin, userId, machine) {

  const anchor = await resolveBillingAnchor(supabaseAdmin, userId, machine);



  if (anchor.startedAt) {

    try {

      await persistBillingAnchorIfDrifted(supabaseAdmin, machine, anchor);

    } catch (error) {

      console.warn('[billing] persistBillingAnchorIfDrifted failed (non-fatal):', error);

    }

  }



  if (!anchor.startedAt) {

    return {

      sessionDurationSeconds: 0,

      billingStartedAt: null,

      hoursRemaining: null,

      effectiveHoursRemaining: null,

      planType: null,

      walletBalance: null,

    };

  }



  const elapsedSeconds = Math.max(

    0,

    Math.floor((Date.now() - new Date(anchor.startedAt).getTime()) / 1000),

  );



  const { snapshot, walletBalance } = await buildRemainingSnapshot(

    supabaseAdmin,

    userId,

    machine,

    anchor,

  );

  const remaining = calculateRemaining(snapshot);

  const credit = mapRemainingResultToBillingCredit(remaining, walletBalance);



  return {

    sessionDurationSeconds: elapsedSeconds,

    billingStartedAt: anchor.startedAt,

    hoursRemaining: credit.hoursRemaining,

    effectiveHoursRemaining: credit.effectiveHoursRemaining,

    planType: credit.planType,

    walletBalance: credit.walletBalance,

  };

}



/**

 * Read-only Remaining snapshot for runtime consumers (M8 auto-stop, status poll).

 * @param {import('@supabase/supabase-js').SupabaseClient} supabaseAdmin

 * @param {string} userId

 * @param {Record<string, unknown> | null | undefined} machine

 */

export async function readRemainingForMachine(supabaseAdmin, userId, machine) {

  const anchor = await resolveBillingAnchor(supabaseAdmin, userId, machine);



  if (!anchor.startedAt) {

    return {

      remaining: null,

      walletBalance: null,

      billingStarted: false,

    };

  }



  const { snapshot, walletBalance } = await buildRemainingSnapshot(

    supabaseAdmin,

    userId,

    machine,

    anchor,

  );



  return {

    remaining: calculateRemaining(snapshot),

    walletBalance,

    billingStarted: true,

  };

}



/**

 * Read-only M2 Remaining for entitlement consumers (auto-renew, renew quote, admin).

 * Unlike readRemainingForMachine, works without an active billing anchor.

 *

 * @param {import('@supabase/supabase-js').SupabaseClient} supabaseAdmin

 * @param {string} userId

 */

export async function readRemainingForUser(supabaseAdmin, userId) {

  const { data: machine } = await supabaseAdmin

    .from('machines')

    .select('*')

    .eq('user_id', userId)

    .eq('status', 'running')

    .order('created_at', { ascending: false })

    .limit(1)

    .maybeSingle();



  const anchor = machine

    ? await resolveBillingAnchor(supabaseAdmin, userId, machine)

    : { startedAt: null, sessionId: null };



  const { snapshot, walletBalance } = await buildRemainingSnapshot(

    supabaseAdmin,

    userId,

    machine,

    anchor,

  );



  return {

    remaining: calculateRemaining(snapshot),

    walletBalance,

    machine: machine ?? null,

    billingStarted: Boolean(anchor.startedAt),

  };

}


