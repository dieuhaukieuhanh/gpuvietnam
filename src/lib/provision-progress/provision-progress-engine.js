/**
 * Provision Progress Engine — real lifecycle stages for dashboard UX.
 */

import {
  PROVISION_STAGE,
  PROVISION_STAGE_LABELS_VI,
  PROVISION_STAGE_ORDER,
  PROVISION_STAGE_REMAINING_MS,
  PROVISION_TIMELINE_STEPS,
  formatEstimatedRemaining,
  formatEstimatedRemainingVi,
  mapProgressTickToStage,
  mapResumeStateToStage,
  messageForProgressTick,
  progressPercentForStage,
} from './provision-progress-stages.js';
import { logProvisionProgressEvent } from './provision-progress-log.js';
import {
  recordFailedStage,
  recordProvisionDuration,
  recordStageDuration,
} from './provision-progress-metrics.js';
import {
  clearProvisionProgressRecord,
  getProvisionProgressRecord,
  loadProvisionProgressFromDb,
  persistProvisionProgressToDb,
  putProvisionProgressRecord,
} from './provision-progress-store.js';

/**
 * @param {Record<string, unknown>} record
 * @param {number} [now]
 */
function enrichRecord(record, now = Date.now()) {
  const stage = String(record.stage || PROVISION_STAGE.OFFLINE);
  const startedAt = Number(record.startedAt) || now;
  const provisionStartedAt = Number(record.provisionStartedAt) || startedAt;
  const elapsedMs = Math.max(0, now - startedAt);
  const totalElapsedMs = Math.max(0, now - provisionStartedAt);
  const baseRemaining = PROVISION_STAGE_REMAINING_MS[stage] ?? 0;
  // Shrink estimate slightly as time in stage grows (floor at 5s while not terminal)
  const estimatedRemainingMs =
    stage === PROVISION_STAGE.RUNNING ||
    stage === PROVISION_STAGE.FAILED ||
    stage === PROVISION_STAGE.STOPPED ||
    stage === PROVISION_STAGE.OFFLINE
      ? 0
      : Math.max(5_000, baseRemaining - Math.min(elapsedMs, baseRemaining * 0.6));

  return {
    ...record,
    stage,
    startedAt,
    provisionStartedAt,
    elapsedMs,
    totalElapsedMs,
    estimatedRemainingMs,
    progressPercent: progressPercentForStage(stage),
    message:
      record.message ||
      PROVISION_STAGE_LABELS_VI[stage] ||
      stage,
    estimatedRemainingLabel: formatEstimatedRemaining(estimatedRemainingMs),
    estimatedRemainingLabelVi: formatEstimatedRemainingVi(estimatedRemainingMs),
  };
}

/**
 * Build API/UI snapshot from a progress record.
 * @param {Record<string, unknown> | null | undefined} record
 * @param {number} [now]
 */
export function buildProgressSnapshot(record, now = Date.now()) {
  if (!record) {
    return {
      stage: PROVISION_STAGE.OFFLINE,
      startedAt: null,
      elapsedMs: 0,
      estimatedRemainingMs: 0,
      progressPercent: 0,
      provider: null,
      gpuType: null,
      hostId: null,
      message: PROVISION_STAGE_LABELS_VI.OFFLINE,
      estimatedRemainingLabel: formatEstimatedRemaining(0),
      estimatedRemainingLabelVi: formatEstimatedRemainingVi(0),
      timeline: PROVISION_TIMELINE_STEPS.map((step, index) => ({
        ...step,
        labelVi: PROVISION_STAGE_LABELS_VI[step.stage] || step.label,
        // First step active so boot UI never shows an all-pending list.
        state: index === 0 ? 'active' : 'pending',
      })),
      requestId: null,
      machineId: null,
      gpuSessionId: null,
    };
  }

  const enriched = enrichRecord(record, now);
  const activeTimelineIdx = findActiveTimelineIndex(String(enriched.stage));
  const timeline = PROVISION_TIMELINE_STEPS.map((step, index) => {
    let state = 'pending';
    if (enriched.stage === PROVISION_STAGE.FAILED) {
      state = index <= Math.max(activeTimelineIdx, 0) ? 'done' : 'pending';
      if (step.stage === PROVISION_STAGE.RUNNING) state = 'pending';
    } else if (enriched.stage === PROVISION_STAGE.RUNNING) {
      state = 'done';
    } else if (index < activeTimelineIdx) {
      state = 'done';
    } else if (index === activeTimelineIdx) {
      state = 'active';
    }
    return {
      ...step,
      labelVi: PROVISION_STAGE_LABELS_VI[step.stage] || step.label,
      state,
    };
  });

  // Ensure exactly one active when in boot path
  if (enriched.stage !== PROVISION_STAGE.RUNNING && enriched.stage !== PROVISION_STAGE.FAILED) {
    const actives = timeline.filter((t) => t.state === 'active');
    if (actives.length === 0) {
      const fallback = timeline.find((t) => t.state === 'pending');
      if (fallback) fallback.state = 'active';
    }
  }

  return {
    stage: enriched.stage,
    startedAt: new Date(Number(enriched.startedAt)).toISOString(),
    elapsedMs: enriched.elapsedMs,
    totalElapsedMs: enriched.totalElapsedMs,
    estimatedRemainingMs: enriched.estimatedRemainingMs,
    progressPercent: enriched.progressPercent,
    provider: enriched.provider ?? null,
    gpuType: enriched.gpuType ?? null,
    hostId: enriched.hostId ?? null,
    message: enriched.message,
    estimatedRemainingLabel: enriched.estimatedRemainingLabel,
    estimatedRemainingLabelVi: enriched.estimatedRemainingLabelVi,
    timeline,
    requestId: enriched.requestId ?? null,
    machineId: enriched.machineId ?? null,
    gpuSessionId: enriched.gpuSessionId ?? null,
    tick: enriched.tick ?? null,
  };
}

/**
 * Map fine-grained stages onto coarser timeline keys (5-step UI).
 * @param {string} timelineStage
 * @param {string} currentStage
 */
function isTimelineActive(timelineStage, currentStage) {
  const groups = {
    [PROVISION_STAGE.CHECKING_ACCOUNT]: [
      PROVISION_STAGE.CHECKING_ACCOUNT,
      PROVISION_STAGE.CHECKING_WALLET,
    ],
    [PROVISION_STAGE.SEARCHING_GPU]: [
      PROVISION_STAGE.SEARCHING_GPU,
      PROVISION_STAGE.SELECTING_HOST,
      PROVISION_STAGE.CREATING_ORDER,
      PROVISION_STAGE.RECOVERING_ORDER_ID,
    ],
    // After rent succeeds (instance_rented / machine_insert) show "Đang khởi động máy".
    [PROVISION_STAGE.BOOTING_MACHINE]: [
      PROVISION_STAGE.CREATING_MACHINE,
      PROVISION_STAGE.BOOTING_MACHINE,
      PROVISION_STAGE.WAITING_FOR_NETWORK,
    ],
    [PROVISION_STAGE.STARTING_COMFY]: [
      PROVISION_STAGE.STARTING_COMFY,
      PROVISION_STAGE.VERIFYING_HEALTH,
    ],
    [PROVISION_STAGE.RUNNING]: [PROVISION_STAGE.RUNNING],
  };
  return (groups[timelineStage] || []).includes(currentStage);
}

/**
 * @param {string} currentStage
 * @returns {number}
 */
function findActiveTimelineIndex(currentStage) {
  for (let i = 0; i < PROVISION_TIMELINE_STEPS.length; i += 1) {
    if (isTimelineActive(PROVISION_TIMELINE_STEPS[i].stage, currentStage)) return i;
  }
  const activeIdx = PROVISION_STAGE_ORDER.indexOf(currentStage);
  if (activeIdx < 0) return 0;
  let best = 0;
  for (let i = 0; i < PROVISION_TIMELINE_STEPS.length; i += 1) {
    const stepIdx = PROVISION_STAGE_ORDER.indexOf(PROVISION_TIMELINE_STEPS[i].stage);
    if (stepIdx >= 0 && stepIdx <= activeIdx) best = i;
  }
  return best;
}

/**
 * Advance progress for a subscription.
 *
 * @param {string} subscriptionId
 * @param {{
 *   stage?: string;
 *   tick?: string;
 *   requestId?: string|null;
 *   provider?: string|null;
 *   gpuType?: string|null;
 *   hostId?: string|null;
 *   machineId?: string|null;
 *   gpuSessionId?: string|null;
 *   message?: string|null;
 *   supabaseAdmin?: import('@supabase/supabase-js').SupabaseClient | null;
 *   now?: number;
 * }} meta
 */
export async function setProvisionProgress(subscriptionId, meta = {}) {
  const key = String(subscriptionId ?? '').trim();
  if (!key) return null;

  const now = meta.now ?? Date.now();
  const prev = getProvisionProgressRecord(key);
  const nextStage =
    meta.stage ||
    (meta.tick ? mapProgressTickToStage(meta.tick) : null) ||
    prev?.stage ||
    PROVISION_STAGE.CHECKING_ACCOUNT;

  // Do not go backwards on the happy path (except FAILED/STOPPING/STOPPED)
  const prevIdx = PROVISION_STAGE_ORDER.indexOf(String(prev?.stage || ''));
  const nextIdx = PROVISION_STAGE_ORDER.indexOf(String(nextStage));
  const terminal = new Set([
    PROVISION_STAGE.FAILED,
    PROVISION_STAGE.STOPPING,
    PROVISION_STAGE.STOPPED,
    PROVISION_STAGE.OFFLINE,
  ]);
  let stage = String(nextStage);
  if (
    prev &&
    !terminal.has(stage) &&
    prevIdx >= 0 &&
    nextIdx >= 0 &&
    nextIdx < prevIdx &&
    !terminal.has(String(prev.stage))
  ) {
    stage = String(prev.stage);
  }

  const stageChanged = !prev || String(prev.stage) !== stage;
  if (stageChanged && prev?.stage && prev.startedAt) {
    recordStageDuration(String(prev.stage), now - Number(prev.startedAt));
  }

  const tickMessage = meta.message
    ? null
    : messageForProgressTick(meta.tick ?? prev?.tick);
  const provisionStartedAt = Number(prev?.provisionStartedAt) || now;
  /** @type {Record<string, unknown>} */
  const record = {
    subscriptionId: key,
    stage,
    tick: meta.tick ?? prev?.tick ?? null,
    startedAt: stageChanged ? now : Number(prev?.startedAt) || now,
    provisionStartedAt,
    requestId: meta.requestId ?? prev?.requestId ?? null,
    provider: meta.provider ?? prev?.provider ?? null,
    gpuType: meta.gpuType ?? prev?.gpuType ?? null,
    hostId: meta.hostId ?? prev?.hostId ?? null,
    machineId: meta.machineId ?? prev?.machineId ?? null,
    gpuSessionId: meta.gpuSessionId ?? prev?.gpuSessionId ?? null,
    message:
      meta.message ??
      tickMessage?.messageVi ??
      tickMessage?.message ??
      PROVISION_STAGE_LABELS_VI[stage] ??
      stage,
    updatedAt: now,
  };

  putProvisionProgressRecord(key, record);
  if (meta.supabaseAdmin) {
    await persistProvisionProgressToDb(meta.supabaseAdmin, key, record);
  }

  const snapshot = buildProgressSnapshot(record, now);

  if (stageChanged) {
    logProvisionProgressEvent(
      'PROGRESS_STAGE_CHANGED',
      {
        requestId: record.requestId,
        machineId: record.machineId,
        gpuSessionId: record.gpuSessionId,
        provider: record.provider,
        stage,
        previousStage: prev?.stage ?? null,
        elapsedMs: snapshot.elapsedMs,
        estimatedRemainingMs: snapshot.estimatedRemainingMs,
        tick: record.tick,
      },
      'Provision progress stage changed',
    );
  }

  if (stage === PROVISION_STAGE.RUNNING) {
    recordProvisionDuration(now - provisionStartedAt);
    logProvisionProgressEvent(
      'PROGRESS_COMPLETED',
      {
        requestId: record.requestId,
        machineId: record.machineId,
        gpuSessionId: record.gpuSessionId,
        provider: record.provider,
        stage,
        elapsedMs: now - provisionStartedAt,
        estimatedRemainingMs: 0,
      },
      'Provision progress completed',
    );
  }

  if (stage === PROVISION_STAGE.FAILED) {
    recordFailedStage(String(prev?.stage || stage));
    logProvisionProgressEvent(
      'PROGRESS_FAILED',
      {
        requestId: record.requestId,
        machineId: record.machineId,
        gpuSessionId: record.gpuSessionId,
        provider: record.provider,
        stage,
        elapsedMs: now - provisionStartedAt,
        estimatedRemainingMs: 0,
        message: record.message,
      },
      'Provision progress failed',
    );
  }

  return snapshot;
}

/**
 * Fix rows where tick advanced (e.g. provision_gate) but stage was left behind
 * by an old mapper / anti-regression — keeps DB + file consistent with tick.
 * @param {Record<string, unknown> | null | undefined} record
 * @param {number} [now]
 * @returns {{ record: Record<string, unknown> | null; healed: boolean }}
 */
export function healProgressRecordFromTick(record, now = Date.now()) {
  if (!record || typeof record !== 'object') return { record: null, healed: false };
  const tick = record.tick != null ? String(record.tick) : '';
  if (!tick) return { record, healed: false };

  const fromTick = mapProgressTickToStage(tick);
  const terminal = new Set([
    PROVISION_STAGE.FAILED,
    PROVISION_STAGE.STOPPING,
    PROVISION_STAGE.STOPPED,
    PROVISION_STAGE.OFFLINE,
    PROVISION_STAGE.RUNNING,
  ]);
  if (terminal.has(String(record.stage))) return { record, healed: false };

  const prevIdx = PROVISION_STAGE_ORDER.indexOf(String(record.stage || ''));
  const tickIdx = PROVISION_STAGE_ORDER.indexOf(fromTick);
  if (tickIdx < 0 || prevIdx < 0 || tickIdx <= prevIdx) {
    return { record, healed: false };
  }

  return {
    record: {
      ...record,
      stage: fromTick,
      message: PROVISION_STAGE_LABELS_VI[fromTick] || record.message,
      updatedAt: now,
    },
    healed: true,
  };
}

/**
 * @param {string} subscriptionId
 * @param {{
 *   supabaseAdmin?: import('@supabase/supabase-js').SupabaseClient | null;
 *   resumeState?: string | null;
 *   machineStatus?: string | null;
 *   now?: number;
 * }} [options]
 */
export async function getProvisionProgress(subscriptionId, options = {}) {
  const key = String(subscriptionId ?? '').trim();
  if (!key) return buildProgressSnapshot(null);

  const now = options.now ?? Date.now();
  let record = getProvisionProgressRecord(key);
  // Always consult DB when available — file can be stale vs Supabase (or vice versa).
  if (options.supabaseAdmin) {
    const fromDb = await loadProvisionProgressFromDb(options.supabaseAdmin, key);
    if (fromDb) record = fromDb;
  }

  let healed = false;
  ({ record, healed } = healProgressRecordFromTick(record, now));
  if (healed && record) {
    putProvisionProgressRecord(key, record);
    if (options.supabaseAdmin) {
      await persistProvisionProgressToDb(options.supabaseAdmin, key, record);
    }
  }

  const resumeState = options.resumeState != null ? String(options.resumeState) : '';
  const machineStatus = options.machineStatus != null ? String(options.machineStatus) : '';

  // Machine usable but progress row stuck mid-boot (lost ticks / gate mapping) → complete UI.
  if (
    record &&
    resumeState === 'RUNNING' &&
    record.stage !== PROVISION_STAGE.RUNNING &&
    record.stage !== PROVISION_STAGE.FAILED &&
    record.stage !== PROVISION_STAGE.STOPPING
  ) {
    const fixed = {
      ...record,
      stage: PROVISION_STAGE.RUNNING,
      tick: record.tick || 'comfy_ready',
      message: PROVISION_STAGE_LABELS_VI.RUNNING,
      updatedAt: now,
    };
    putProvisionProgressRecord(key, fixed);
    if (options.supabaseAdmin) {
      await persistProvisionProgressToDb(options.supabaseAdmin, key, fixed);
    }
    return buildProgressSnapshot(fixed, now);
  }

  if (
    record &&
    machineStatus === 'running' &&
    record.stage !== PROVISION_STAGE.RUNNING &&
    record.stage !== PROVISION_STAGE.FAILED &&
    record.stage !== PROVISION_STAGE.STOPPING
  ) {
    const stageIdx = PROVISION_STAGE_ORDER.indexOf(String(record.stage));
    const comfyIdx = PROVISION_STAGE_ORDER.indexOf(PROVISION_STAGE.STARTING_COMFY);
    // Host row already running but progress still on account/search/order — jump to Comfy boot.
    if (stageIdx >= 0 && stageIdx < comfyIdx) {
      const fixed = {
        ...record,
        stage: PROVISION_STAGE.STARTING_COMFY,
        message: PROVISION_STAGE_LABELS_VI.STARTING_COMFY,
        updatedAt: now,
      };
      putProvisionProgressRecord(key, fixed);
      if (options.supabaseAdmin) {
        await persistProvisionProgressToDb(options.supabaseAdmin, key, fixed);
      }
      return buildProgressSnapshot(fixed, now);
    }
  }

  if (!record && options.resumeState) {
    const inferred = mapResumeStateToStage(options.resumeState);
    if (inferred !== PROVISION_STAGE.OFFLINE) {
      return buildProgressSnapshot(
        {
          subscriptionId: key,
          stage: inferred,
          startedAt: now,
          provisionStartedAt: now,
          message: PROVISION_STAGE_LABELS_VI[inferred],
        },
        now,
      );
    }
  }

  return buildProgressSnapshot(record, now);
}

/**
 * @param {string} subscriptionId
 * @param {{ supabaseAdmin?: import('@supabase/supabase-js').SupabaseClient | null }} [options]
 */
export async function clearProvisionProgress(subscriptionId, options = {}) {
  const key = String(subscriptionId ?? '').trim();
  if (!key) return;
  clearProvisionProgressRecord(key);
  if (options.supabaseAdmin) {
    await persistProvisionProgressToDb(options.supabaseAdmin, key, null);
  }
}

export {
  PROVISION_STAGE,
  PROVISION_TIMELINE_STEPS,
  mapProgressTickToStage,
  mapResumeStateToStage,
};