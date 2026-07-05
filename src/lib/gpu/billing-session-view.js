/**
 * Server-authoritative billing projection (SCB M9 + display layer).
 * Single read path: M2 Remaining + M5 getBillingStatus - no duplicate formulas.
 */

import { getActiveMachineForUser } from '@/lib/machines';
import { mapRemainingStatusFields, mapSessionStatusFields } from './api-scb.js';
import { getBillingStatus, readRemainingForMachine, readRemainingForUser } from './billing.js';
import { isOutOfCredit, REMAINING_STATE_OK } from './remaining-time.js';
import { openBillableSession, loadActiveSessionRow } from './session-start.js';

const BILLABLE_MACHINE_PHASES = new Set(['running', 'disconnected', 'error', 'stopping']);

export function resolvePlanCardTotalHours(planInventoryTotalHours, m2TotalEntitlementHours) {
  if (planInventoryTotalHours != null && Number(planInventoryTotalHours) > 0) {
    return Number(planInventoryTotalHours);
  }
  if (m2TotalEntitlementHours != null && Number.isFinite(Number(m2TotalEntitlementHours))) {
    return Number(m2TotalEntitlementHours);
  }
  return null;
}

export function primaryPlanInventoryTotalHours(billablePlans) {
  if (!Array.isArray(billablePlans) || billablePlans.length === 0) return null;
  const total = Number(billablePlans[0]?.hours_total ?? 0);
  return total > 0 ? total : null;
}

export function buildBillingSessionView(input) {
  const {
    machineSessionPhase = 'idle',
    billing = null,
    remainingRead = null,
    sessionFields = null,
    outOfHours = false,
    lowCreditWarning = false,
    planInventoryTotalHours = null,
  } = input;

  const remainingFields = mapRemainingStatusFields(remainingRead);
  const session = sessionFields ?? mapSessionStatusFields(null);
  const remaining = remainingRead?.remaining;
  const primaryPlanType =
    remaining?.state === REMAINING_STATE_OK ? remaining.primaryPlanType : null;
  const walletBalance =
    remainingRead?.walletBalance != null ? Number(remainingRead.walletBalance) : null;

  const sessionDurationSeconds =
    billing?.sessionDurationSeconds != null
      ? Math.max(0, Math.floor(Number(billing.sessionDurationSeconds)))
      : 0;

  const billingStartedAt =
    billing?.billingStartedAt != null ? String(billing.billingStartedAt) : null;

  const planCardTotalHours = resolvePlanCardTotalHours(
    planInventoryTotalHours,
    remainingFields.totalEntitlementHours,
  );

  return {
    phase: machineSessionPhase,
    sessionDurationSeconds,
    billingStartedAt,
    remainingHours: remainingFields.remainingHours,
    totalEntitlementHours: remainingFields.totalEntitlementHours,
    currentSessionElapsedHours: remainingFields.currentSessionElapsedHours,
    settledSessionUsageHours: remainingFields.settledSessionUsageHours,
    primaryPlanType,
    walletBalance,
    planCardRemainingHours: remainingFields.remainingHours,
    planCardTotalHours,
    sessionStatus: session.sessionStatus,
    settlementStatus: session.settlementStatus,
    verifiedRunningAt: session.verifiedRunningAt,
    verifiedDestroyedAt: session.verifiedDestroyedAt,
    outOfHours: Boolean(outOfHours),
    lowCreditWarning: Boolean(lowCreditWarning),
    billingStarted: Boolean(remainingRead?.billingStarted ?? billingStartedAt),
  };
}

export function resolveStatusBillingPhase(liveStatus, machine, healthOk = false) {
  if (liveStatus === 'running' && healthOk) return 'running';
  if (
    liveStatus === 'running' ||
    liveStatus === 'starting' ||
    liveStatus === 'creating' ||
    (machine && ['creating', 'starting'].includes(String(machine.status ?? '')))
  ) {
    return 'opening';
  }
  return 'idle';
}

export async function resolveBillingSessionView(supabaseAdmin, userId, options = {}) {
  const {
    machine = null,
    machineSessionPhase = 'idle',
    walletBalance = null,
    gpuService = null,
    billablePlans = undefined,
    tryOpenBillableSession = false,
  } = options;

  let activeMachine = machine;
  const machineIsRunning = activeMachine && String(activeMachine.status ?? '') === 'running';
  const useMachineRemaining =
    activeMachine &&
    machineIsRunning &&
    BILLABLE_MACHINE_PHASES.has(machineSessionPhase);

  if (tryOpenBillableSession && machineIsRunning && activeMachine.instance_id && gpuService) {
    try {
      await openBillableSession(
        supabaseAdmin,
        userId,
        String(activeMachine.instance_id),
        gpuService,
      );
    } catch (error) {
      console.warn('[billing-session-view] openBillableSession failed (non-fatal):', error);
    }
    activeMachine =
      (await getActiveMachineForUser(supabaseAdmin, userId)) ?? activeMachine;
  }

  let remainingRead;
  let billing = null;
  let sessionRow = null;

  if (useMachineRemaining) {
    billing = await getBillingStatus(supabaseAdmin, userId, activeMachine);
    remainingRead = await readRemainingForMachine(supabaseAdmin, userId, activeMachine);
    sessionRow = await loadActiveSessionRow(
      supabaseAdmin,
      activeMachine.gpu_session_id ? String(activeMachine.gpu_session_id) : null,
      activeMachine.id ? String(activeMachine.id) : null,
    );
  } else {
    remainingRead = await readRemainingForUser(supabaseAdmin, userId, {
      knownRunningMachine: null,
      machine: activeMachine ?? undefined,
      walletBalance,
      billablePlans,
    });
  }

  const sessionFields = mapSessionStatusFields(sessionRow);
  const outOfHours =
    machineIsRunning &&
    Boolean(billing?.billingStartedAt ?? activeMachine?.billing_started_at) &&
    remainingRead.remaining?.state === REMAINING_STATE_OK &&
    isOutOfCredit({
      ...remainingRead.remaining,
      walletBalance: remainingRead.walletBalance,
    });

  const lowCreditWarning =
    machineIsRunning &&
    billing?.effectiveHoursRemaining != null &&
    Number(billing.effectiveHoursRemaining) > 0 &&
    Number(billing.effectiveHoursRemaining) <= 0.08;

  return buildBillingSessionView({
    machineSessionPhase,
    billing,
    remainingRead,
    sessionFields,
    outOfHours,
    lowCreditWarning,
    planInventoryTotalHours: primaryPlanInventoryTotalHours(billablePlans),
  });
}

/**
 * Resolve billingView for lifecycle command APIs (start/stop/cancel/destroy).
 */
export async function resolveBillingViewForCommand(supabaseAdmin, userId, options = {}) {
  const {
    machineSessionView = null,
    machine = null,
    gpuService = null,
    walletBalance = null,
    billablePlans = undefined,
  } = options;

  const phase = machineSessionView?.phase ?? 'idle';
  const machineIsRunning = machine && String(machine.status ?? '') === 'running';

  return resolveBillingSessionView(supabaseAdmin, userId, {
    machine,
    machineSessionPhase: phase,
    walletBalance,
    gpuService,
    billablePlans,
    tryOpenBillableSession: Boolean(
      phase === 'running' && machineIsRunning && machine.instance_id && gpuService,
    ),
  });
}
