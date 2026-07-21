/**
 * Clore orphan-order reconciliation (DB + provider I/O).
 * Pure matching/decision helpers live in clore-orphan-core.js.
 */

import { randomUUID } from 'node:crypto';
import { insertMachineRecord, mapGpuInstanceToMachineRow } from '../../../machines.js';
import { DEFAULT_GPU_PORT } from '../../gpu-config.js';
import {
  isStaleProvisioningClaim,
  STALE_PROVISIONING_CLAIM_MS,
} from '../../../machines-provisioning-sync.js';
import { mapCloreOrderToGPUInstance } from './clore-mapper.js';
import { isCloreOrderActive, isGpuVietnamCloreOrder } from './clore-client.js';
import { logCloreOrphanEvent } from './clore-orphan-log.js';
import { getCloreOrphanMetrics, incrCloreOrphanMetric } from './clore-orphan-metrics.js';
import { createProvisioningPendingSession } from '../../session-start.js';
import { getGpuLabel } from '../../../gpu-pricing.js';
import {
  ACTIVE_CLORE_MACHINE_STATUSES,
  DEFAULT_CLORE_ORPHAN_GRACE_MS,
  classifyOrphanCandidates,
  decideOrphanAction,
  matchCloreOrdersToMachines,
  normalizeCloreOrderSummary,
  resolveCloreOrphanGraceMs,
} from './clore-orphan-core.js';

export {
  ACTIVE_CLORE_MACHINE_STATUSES,
  DEFAULT_CLORE_ORPHAN_GRACE_MS,
  classifyMachineProtection,
  classifyOrphanCandidates,
  decideOrphanAction,
  matchCloreOrdersToMachines,
  normalizeCloreOrderSummary,
  resolveCloreOrderCreatedMs,
  resolveCloreOrphanGraceMs,
} from './clore-orphan-core.js';

export async function loadActiveCloreDbState(supabaseAdmin) {
  const { data: machines, error: machineError } = await supabaseAdmin
    .from('machines')
    .select('*')
    .eq('provider', 'clore')
    .in('status', ACTIVE_CLORE_MACHINE_STATUSES);

  if (machineError) throw machineError;

  const machineRows = Array.isArray(machines) ? machines : [];
  const machineIds = machineRows.map((m) => m.id).filter(Boolean);

  let sessions = [];
  if (machineIds.length) {
    const { data: sessionRows, error: sessionError } = await supabaseAdmin
      .from('gpu_sessions')
      .select('id, machine_id, user_id, subscription_id, status')
      .in('machine_id', machineIds)
      .in('status', ['pending', 'running']);
    if (sessionError) throw sessionError;
    sessions = Array.isArray(sessionRows) ? sessionRows : [];
  }

  const { data: provisioningSubs, error: subError } = await supabaseAdmin
    .from('subscriptions')
    .select('id, user_id, server_status, provisioning_started_at, plan, billing, status')
    .eq('server_status', 'provisioning');

  if (subError) throw subError;

  const machineSubIds = new Set(
    machineRows.map((m) => (m.subscription_id != null ? String(m.subscription_id) : '')).filter(Boolean),
  );
  const openClaims = (Array.isArray(provisioningSubs) ? provisioningSubs : []).filter(
    (sub) => !machineSubIds.has(String(sub.id)),
  );

  return { machines: machineRows, sessions, provisioningClaims: openClaims };
}

export async function listActiveGpuVietnamCloreOrders(cloreClient) {
  const orders = await cloreClient.listMyOrders();
  return orders
    .filter((order) => isCloreOrderActive(order))
    .map((order) => normalizeCloreOrderSummary(order))
    .filter((summary) => summary.orderId && isGpuVietnamCloreOrder(summary.raw));
}

function inferGpuLineFromOrder(order) {
  const gpu = String(
    (order.specs && typeof order.specs === 'object' ? order.specs.gpu : '') ||
      (Array.isArray(order.gpu_array) ? order.gpu_array[0] : '') ||
      '',
  ).toLowerCase();
  if (gpu.includes('5090')) return 'rtx5090_1x';
  if (gpu.includes('4090') && /2\s*x|2x/.test(gpu)) return 'rtx4090_2x';
  if (gpu.includes('4090')) return 'rtx4090_1x';
  if (gpu.includes('3090')) return 'rtx3090';
  return null;
}

function inferGpuLineFromPlan(plan) {
  const raw = String(plan ?? '').toLowerCase();
  if (raw.includes('studio') || raw.includes('5090')) return 'rtx5090_1x';
  if (raw.includes('pro')) return 'rtx4090_1x';
  if (raw.includes('starter')) return 'rtx3090';
  return null;
}

function inferPlanKeyFromGpuLine(gpuLine) {
  if (gpuLine === 'rtx4090_2x' || gpuLine === 'rtx5090_1x') return 'studio';
  if (gpuLine === 'rtx3090') return 'starter';
  return 'pro';
}

export async function reconnectCloreOrphanOrder(supabaseAdmin, order, subscription, options = {}) {
  const requestId = options.requestId ?? randomUUID();
  const userId = String(subscription.user_id ?? '');
  const subscriptionId = String(subscription.id ?? '');
  const started = Date.now();

  logCloreOrphanEvent(
    'ORPHAN_RECONNECT_STARTED',
    {
      requestId,
      orderId: order.orderId,
      serverId: order.serverId,
      recoveryAction: 'reconnect',
      subscriptionId,
      userId,
    },
    'Reconnecting Clore orphan order to provisioning subscription',
  );

  try {
    const gpuLine =
      options.gpuLine ||
      inferGpuLineFromOrder(order.raw) ||
      inferGpuLineFromPlan(subscription.plan) ||
      'rtx4090_1x';

    const instance = mapCloreOrderToGPUInstance(order.raw, gpuLine, { port: DEFAULT_GPU_PORT });
    const machineRow = mapGpuInstanceToMachineRow(instance, {
      gpuLine,
      region: instance.region,
      subscriptionId,
    });

    const machine = await insertMachineRecord(supabaseAdmin, userId, machineRow);
    const planKey = inferPlanKeyFromGpuLine(gpuLine);
    const sessionResult = await createProvisioningPendingSession(supabaseAdmin, {
      userId,
      machine,
      subscription,
      template: machine.template ?? null,
      plan: subscription.plan != null ? String(subscription.plan) : getGpuLabel(planKey),
      billing: subscription.billing ?? 'combo1',
      gpuConfig: getGpuLabel(planKey),
    });

    incrCloreOrphanMetric('orphanReconnectSuccess');
    incrCloreOrphanMetric('orphanRecovered');
    logCloreOrphanEvent(
      'ORPHAN_RECONNECT_SUCCESS',
      {
        requestId,
        orderId: order.orderId,
        serverId: order.serverId,
        machineId: machine.id != null ? String(machine.id) : null,
        gpuSessionId: sessionResult?.sessionId != null ? String(sessionResult.sessionId) : null,
        elapsedTime: Date.now() - started,
        recoveryAction: 'reconnect',
        subscriptionId,
        userId,
      },
      'Clore orphan reconnected to machine/session',
    );
    return { machine, sessionResult };
  } catch (error) {
    incrCloreOrphanMetric('orphanReconnectFailure');
    logCloreOrphanEvent(
      'ORPHAN_RECONNECT_FAILED',
      {
        requestId,
        orderId: order.orderId,
        serverId: order.serverId,
        elapsedTime: Date.now() - started,
        recoveryAction: 'reconnect',
        subscriptionId,
        userId,
        err: { message: error instanceof Error ? error.message : String(error) },
      },
      'Clore orphan reconnect failed',
    );
    throw error;
  }
}

export async function cancelCloreOrphanOrder(cloreClient, order, options = {}) {
  const requestId = options.requestId ?? randomUUID();
  const started = Date.now();

  logCloreOrphanEvent(
    'ORPHAN_CANCEL_STARTED',
    {
      requestId,
      orderId: order.orderId,
      serverId: order.serverId,
      recoveryAction: 'cancel',
      elapsedTime: 0,
    },
    'Cancelling Clore orphan order',
  );

  try {
    await cloreClient.destroyInstance(order.orderId);
    let stillActive = false;
    try {
      const live = await cloreClient.getOrder(order.orderId);
      stillActive = isCloreOrderActive(live);
    } catch {
      stillActive = false;
    }

    if (stillActive) {
      logCloreOrphanEvent(
        'ORPHAN_CANCEL_FAILED',
        {
          requestId,
          orderId: order.orderId,
          serverId: order.serverId,
          elapsedTime: Date.now() - started,
          recoveryAction: 'cancel',
          reason: 'still_active_after_cancel',
        },
        'Clore cancel_order returned but order still active',
      );
      return { ok: false, reason: 'still_active_after_cancel' };
    }

    incrCloreOrphanMetric('orphanCancelled');
    logCloreOrphanEvent(
      'ORPHAN_CANCEL_SUCCESS',
      {
        requestId,
        orderId: order.orderId,
        serverId: order.serverId,
        elapsedTime: Date.now() - started,
        recoveryAction: 'cancel',
      },
      'Clore orphan order cancelled',
    );
    return { ok: true };
  } catch (error) {
    logCloreOrphanEvent(
      'ORPHAN_CANCEL_FAILED',
      {
        requestId,
        orderId: order.orderId,
        serverId: order.serverId,
        elapsedTime: Date.now() - started,
        recoveryAction: 'cancel',
        err: { message: error instanceof Error ? error.message : String(error) },
      },
      'Clore cancel_order failed',
    );
    return { ok: false, reason: error instanceof Error ? error.message : String(error) };
  }
}

export async function runCloreOrphanReconciliationPass(deps) {
  const nowMs = deps.nowMs ?? Date.now();
  const graceMs = deps.graceMs ?? resolveCloreOrphanGraceMs();
  const pending = deps.pending ?? new Map();
  const requestId = deps.requestId ?? randomUUID();

  if (!deps.cloreClient?.isConfigured?.()) {
    return { skipped: true, reason: 'clore_not_configured', metrics: getCloreOrphanMetrics() };
  }

  const [orders, dbState] = await Promise.all([
    listActiveGpuVietnamCloreOrders(deps.cloreClient),
    loadActiveCloreDbState(deps.supabaseAdmin),
  ]);

  const { matched, unmatched } = matchCloreOrdersToMachines(
    orders,
    dbState.machines,
    dbState.sessions,
    nowMs,
  );

  const orphans = classifyOrphanCandidates(unmatched);

  const liveOrderIds = new Set(orders.map((o) => o.orderId));
  const matchedIds = new Set(matched.map((m) => m.orderId));
  for (const orderId of [...pending.keys()]) {
    if (!liveOrderIds.has(orderId) || matchedIds.has(orderId)) {
      pending.delete(orderId);
    }
  }

  const actions = [];

  for (const order of orphans) {
    let entry = pending.get(order.orderId);
    if (!entry) {
      const orphanRequestId = randomUUID();
      entry = { firstSeenAt: nowMs, order, requestId: orphanRequestId };
      pending.set(order.orderId, entry);
      incrCloreOrphanMetric('orphanDetected');
      logCloreOrphanEvent(
        'ORPHAN_DETECTED',
        {
          requestId: orphanRequestId,
          orderId: order.orderId,
          serverId: order.serverId,
          elapsedTime: 0,
          recoveryAction: 'observe',
          image: order.image,
        },
        'Clore orphan candidate detected',
      );
      deps.scheduleRecheck?.(order.orderId, graceMs);
      actions.push({ orderId: order.orderId, action: 'observe', reason: 'grace_period' });
      continue;
    }

    entry.order = order;
    const decision = decideOrphanAction({
      order,
      firstSeenAt: entry.firstSeenAt,
      nowMs,
      graceMs,
      provisioningClaims: dbState.provisioningClaims,
    });

    logCloreOrphanEvent(
      'ORPHAN_RECHECK',
      {
        requestId: entry.requestId,
        orderId: order.orderId,
        serverId: order.serverId,
        elapsedTime: nowMs - entry.firstSeenAt,
        recoveryAction: decision.action,
        reason: decision.reason,
      },
      'Clore orphan recheck',
    );

    if (decision.action === 'wait') {
      const remaining = graceMs - (nowMs - entry.firstSeenAt);
      deps.scheduleRecheck?.(order.orderId, Math.max(1000, remaining));
      actions.push({ orderId: order.orderId, action: 'wait', reason: decision.reason });
      continue;
    }

    if (decision.action === 'reconnect' && decision.subscription) {
      try {
        await reconnectCloreOrphanOrder(deps.supabaseAdmin, order, decision.subscription, {
          requestId: entry.requestId,
        });
        pending.delete(order.orderId);
        actions.push({ orderId: order.orderId, action: 'reconnect', reason: decision.reason });
      } catch {
        if (isStaleProvisioningClaim(decision.subscription, nowMs)) {
          const cancelResult = await cancelCloreOrphanOrder(deps.cloreClient, order, {
            requestId: entry.requestId,
          });
          if (cancelResult.ok) pending.delete(order.orderId);
          actions.push({
            orderId: order.orderId,
            action: cancelResult.ok ? 'cancel' : 'cancel_failed',
            reason: 'reconnect_failed_stale_claim',
          });
        } else {
          deps.scheduleRecheck?.(order.orderId, Math.min(graceMs, 30_000));
          actions.push({
            orderId: order.orderId,
            action: 'reconnect_failed',
            reason: decision.reason,
          });
        }
      }
      continue;
    }

    const freshClaims = dbState.provisioningClaims.filter(
      (sub) => !isStaleProvisioningClaim(sub, nowMs, Math.max(STALE_PROVISIONING_CLAIM_MS, graceMs)),
    );
    if (freshClaims.length > 0) {
      deps.scheduleRecheck?.(order.orderId, graceMs);
      actions.push({ orderId: order.orderId, action: 'wait', reason: 'ambiguous_provisioning_claims' });
      continue;
    }

    const cancelResult = await cancelCloreOrphanOrder(deps.cloreClient, order, {
      requestId: entry.requestId,
    });
    if (cancelResult.ok) pending.delete(order.orderId);
    actions.push({
      orderId: order.orderId,
      action: cancelResult.ok ? 'cancel' : 'cancel_failed',
      reason: decision.reason,
    });
  }

  logCloreOrphanEvent(
    'ORPHAN_RECONCILE_PASS',
    {
      requestId,
      orderId: null,
      serverId: null,
      machineId: null,
      gpuSessionId: null,
      elapsedTime: null,
      recoveryAction: 'reconcile_pass',
      liveOrders: orders.length,
      matched: matched.length,
      orphans: orphans.length,
      pending: pending.size,
      actions,
      metrics: getCloreOrphanMetrics(),
    },
    'Clore orphan reconciliation pass complete',
  );

  return {
    skipped: false,
    liveOrders: orders.length,
    matched: matched.length,
    orphans: orphans.length,
    actions,
    metrics: getCloreOrphanMetrics(),
  };
}
