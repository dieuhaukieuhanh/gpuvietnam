/**
 * Pure Clore orphan matching / decision helpers (no Supabase / Next aliases).
 */

import { DEFAULT_GPU_IMAGE } from '../../gpu-config.js';
import {
  PROVISIONING_BOOT_MAX_MS,
  isRecentBootMachine,
  isStaleProvisioningClaim,
  STALE_PROVISIONING_CLAIM_MS,
} from '../../../machines-provisioning-sync.js';
import {
  extractCloreOrderId,
  extractCloreServerId,
  isGpuVietnamCloreOrder,
} from './clore-client.js';

export const DEFAULT_CLORE_ORPHAN_GRACE_MS = 2 * 60 * 1000;
export const ACTIVE_CLORE_MACHINE_STATUSES = ['creating', 'starting', 'running'];

export function resolveCloreOrphanGraceMs() {
  const raw = Number(process.env.CLORE_ORPHAN_GRACE_MS ?? DEFAULT_CLORE_ORPHAN_GRACE_MS);
  return Number.isFinite(raw) && raw >= 0 ? raw : DEFAULT_CLORE_ORPHAN_GRACE_MS;
}

export function resolveCloreOrderCreatedMs(order) {
  const ct = Number(order.ct ?? order.created ?? order.created_at ?? 0);
  if (Number.isFinite(ct) && ct > 1e12) return ct;
  if (Number.isFinite(ct) && ct > 1e9) return ct * 1000;
  return 0;
}

export function normalizeCloreOrderSummary(order) {
  const rec = order && typeof order === 'object' ? order : {};
  return {
    orderId: extractCloreOrderId(rec),
    serverId: extractCloreServerId(rec),
    image: rec.image != null ? String(rec.image) : '',
    online: rec.online === true || rec.online === 1 || rec.online === '1',
    createdMs: resolveCloreOrderCreatedMs(rec),
    raw: rec,
  };
}

export function classifyMachineProtection(machine, nowMs = Date.now()) {
  const status = String(machine.status ?? '');
  if (status === 'running') {
    return { protected: true, reason: 'machine_running' };
  }
  if (status === 'creating' || status === 'starting') {
    if (isRecentBootMachine(machine, nowMs, PROVISIONING_BOOT_MAX_MS)) {
      return { protected: true, reason: 'provisioning_window' };
    }
    return { protected: false, reason: 'stale_boot' };
  }
  return { protected: false, reason: 'inactive_status' };
}

export function matchCloreOrdersToMachines(orders, machines, sessions = [], nowMs = Date.now()) {
  const byInstanceId = new Map();
  for (const machine of machines) {
    const iid = String(machine.instance_id ?? '').trim();
    if (iid) byInstanceId.set(iid, machine);
  }

  const sessionByMachineId = new Map();
  for (const session of sessions) {
    const mid = String(session.machine_id ?? '').trim();
    if (mid && !sessionByMachineId.has(mid)) sessionByMachineId.set(mid, session);
  }

  const matched = [];
  const unmatched = [];

  for (const order of orders) {
    if (!order.orderId) continue;
    const machine = byInstanceId.get(order.orderId) ?? null;
    if (!machine) {
      unmatched.push(order);
      continue;
    }
    const machineId = machine.id != null ? String(machine.id) : null;
    const session = machineId ? sessionByMachineId.get(machineId) : null;
    const gpuSessionId =
      (session?.id != null ? String(session.id) : null) ||
      (machine.gpu_session_id != null ? String(machine.gpu_session_id) : null);
    const protect = classifyMachineProtection(machine, nowMs);
    matched.push({
      orderId: order.orderId,
      serverId: order.serverId,
      machineId,
      gpuSessionId,
      machineStatus: String(machine.status ?? ''),
      userId: machine.user_id != null ? String(machine.user_id) : null,
      subscriptionId: machine.subscription_id != null ? String(machine.subscription_id) : null,
      protected: protect.protected,
      protectReason: protect.reason,
    });
  }

  return { matched, unmatched };
}

export function classifyOrphanCandidates(unmatched, options = {}) {
  const imageHint = options.image ?? DEFAULT_GPU_IMAGE;
  return unmatched.filter((order) => isGpuVietnamCloreOrder(order.raw, imageHint));
}

export function decideOrphanAction(input) {
  const nowMs = input.nowMs ?? Date.now();
  const graceMs = input.graceMs ?? resolveCloreOrphanGraceMs();
  const age = nowMs - input.firstSeenAt;
  if (age < graceMs) {
    return { action: 'wait', reason: 'grace_period', subscription: null };
  }

  const claims = (input.provisioningClaims ?? []).filter((sub) => {
    if (String(sub.server_status ?? '') !== 'provisioning') return false;
    return !isStaleProvisioningClaim(sub, nowMs, Math.max(STALE_PROVISIONING_CLAIM_MS, graceMs));
  });

  if (claims.length === 1) {
    return { action: 'reconnect', reason: 'single_provisioning_claim', subscription: claims[0] };
  }

  if (claims.length > 1) {
    const orderCreated = input.order.createdMs || input.firstSeenAt;
    let best = claims[0];
    let bestDelta = Infinity;
    for (const claim of claims) {
      const started = claim.provisioning_started_at
        ? new Date(String(claim.provisioning_started_at)).getTime()
        : 0;
      const delta = Math.abs(started - orderCreated);
      if (delta < bestDelta) {
        bestDelta = delta;
        best = claim;
      }
    }
    if (bestDelta <= PROVISIONING_BOOT_MAX_MS) {
      return { action: 'reconnect', reason: 'closest_provisioning_claim', subscription: best };
    }
  }

  return { action: 'cancel', reason: 'still_orphaned_after_grace', subscription: null };
}
