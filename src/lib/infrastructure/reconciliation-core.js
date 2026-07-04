/**
 * Infrastructure Reconciliation — pure detection (M13).
 * No DB, no domain side effects.
 * @see docs/SESSION_CENTRIC_BILLING_ARCHITECTURE.md §8
 */

export const RECONCILIATION_MODULE_VERSION = '1.0';

export const DRIFT_TYPE = Object.freeze({
  ZOMBIE_LOCAL: 'zombie_local',
  ORPHAN_PROVIDER: 'orphan_provider',
  STALE_CLOSING: 'stale_closing',
  DESTROYED_MISMATCH: 'destroyed_mismatch',
  SETTLEMENT_FAILED: 'settlement_failed',
  SETTLEMENT_PENDING: 'settlement_pending',
  ORPHAN_SESSION: 'orphan_session',
});

export const REPAIR_OUTCOME = Object.freeze({
  REPAIRED: 'repaired',
  SKIPPED: 'skipped',
  FAILED: 'failed',
  ALREADY_CONSISTENT: 'already_consistent',
});

/** @type {number} */
export const DEFAULT_STALE_CLOSING_MS = 30 * 60 * 1000;

const ACTIVE_MACHINE_STATUSES = new Set(['creating', 'starting', 'running', 'closing']);

const SETTLEMENT_RETRY_STATUSES = new Set(['failed', 'pending', 'in_progress', 'awaiting_verify']);

/**
 * @param {string} driftType
 * @param {string} entityType
 * @param {string} entityId
 * @param {string} message
 * @param {Record<string, unknown>} [details]
 */
export function buildDriftDescriptor(driftType, entityType, entityId, message, details = {}) {
  return {
    driftType,
    entityType,
    entityId,
    message,
    details,
  };
}

/**
 * @param {Record<string, unknown>|null|undefined} snapshot
 * @param {Record<string, unknown>|null|undefined} verifyResult
 */
export function isProviderDestroyed(snapshot, verifyResult) {
  if (verifyResult?.outcome === 'verified_destroyed') {
    return true;
  }
  if (snapshot?.normalizedState === 'destroyed') {
    return true;
  }
  if (verifyResult?.code === 'INSTANCE_NOT_FOUND') {
    return true;
  }
  return false;
}

/**
 * @param {Record<string, unknown>|null|undefined} snapshot
 */
export function isProviderRunning(snapshot) {
  const state = snapshot?.normalizedState;
  return state === 'running' || state === 'starting';
}

/**
 * @param {string} nowIso
 * @param {string} sinceIso
 * @param {number} staleAfterMs
 */
export function isOlderThan(nowIso, sinceIso, staleAfterMs) {
  const ageMs = new Date(nowIso).getTime() - new Date(sinceIso).getTime();
  return ageMs >= staleAfterMs;
}

/**
 * @param {Record<string, unknown>|null|undefined} session
 * @param {Record<string, unknown>|null|undefined} machine
 * @param {string} now
 * @param {number} [staleAfterMs]
 */
export function detectStaleClosing(session, machine, now, staleAfterMs = DEFAULT_STALE_CLOSING_MS) {
  if (String(session?.status ?? '') !== 'closing') {
    return null;
  }

  const closingSince = machine?.closing_started_at ?? machine?.updated_at;
  if (!closingSince || !isOlderThan(now, String(closingSince), staleAfterMs)) {
    return null;
  }

  return buildDriftDescriptor(
    DRIFT_TYPE.STALE_CLOSING,
    'session',
    String(session.id),
    'Session closing exceeded timeout without verify',
    {
      closingSince,
      staleAfterMs,
      machineId: machine?.id ?? null,
      userId: session.user_id ?? session.userId ?? null,
    },
  );
}

/**
 * @param {Record<string, unknown>|null|undefined} session
 * @param {Record<string, unknown>|null|undefined} machine
 * @param {Record<string, unknown>|null|undefined} providerSnapshot
 * @param {Record<string, unknown>|null|undefined} [verifyResult]
 */
export function detectZombieLocal(session, machine, providerSnapshot, verifyResult) {
  const sessionRunning = String(session?.status ?? '') === 'running';
  const machineActive =
    machine != null && ACTIVE_MACHINE_STATUSES.has(String(machine.status ?? ''));

  if (!sessionRunning && !machineActive) {
    return null;
  }

  if (!isProviderDestroyed(providerSnapshot, verifyResult)) {
    return null;
  }

  const entityId = session?.id ? String(session.id) : String(machine?.id ?? 'unknown');

  return buildDriftDescriptor(
    DRIFT_TYPE.ZOMBIE_LOCAL,
    session?.id ? 'session' : 'machine',
    entityId,
    'Local running state but provider instance is destroyed or missing',
    {
      sessionId: session?.id ?? null,
      machineId: machine?.id ?? null,
      instanceId: machine?.instance_id ?? providerSnapshot?.instanceId ?? null,
      sessionStatus: session?.status ?? null,
      machineStatus: machine?.status ?? null,
      providerState: providerSnapshot?.normalizedState ?? null,
      userId: session?.user_id ?? session?.userId ?? machine?.user_id ?? null,
    },
  );
}

/**
 * @param {Record<string, unknown>|null|undefined} machine
 * @param {Record<string, unknown>|null|undefined} providerSnapshot
 */
export function detectDestroyedMismatch(machine, providerSnapshot) {
  if (String(machine?.status ?? '') !== 'destroyed') {
    return null;
  }
  if (!isProviderRunning(providerSnapshot)) {
    return null;
  }

  return buildDriftDescriptor(
    DRIFT_TYPE.DESTROYED_MISMATCH,
    'machine',
    String(machine.id),
    'Machine marked destroyed in DB but provider instance is still running',
    {
      instanceId: machine.instance_id ?? providerSnapshot?.instanceId ?? null,
      userId: machine.user_id ?? null,
      providerState: providerSnapshot?.normalizedState ?? null,
    },
  );
}

/**
 * @param {Record<string, unknown>|null|undefined} session
 * @param {Record<string, unknown>|null|undefined} machine
 */
export function detectOrphanSession(session, machine) {
  if (String(session?.status ?? '') !== 'running') {
    return null;
  }

  const hasActiveMachine =
    machine != null && ACTIVE_MACHINE_STATUSES.has(String(machine.status ?? ''));

  if (hasActiveMachine) {
    return null;
  }

  return buildDriftDescriptor(
    DRIFT_TYPE.ORPHAN_SESSION,
    'session',
    String(session.id),
    'Running session without an active machine',
    {
      userId: session.user_id ?? session.userId ?? null,
      machineId: session.machine_id ?? session.machineId ?? null,
    },
  );
}

/**
 * @param {Record<string, unknown>|null|undefined} session
 */
export function detectSettlementDrift(session) {
  const status = String(session?.status ?? '');
  if (status !== 'closed' && status !== 'completed') {
    return null;
  }

  const settlementStatus = String(session?.settlement_status ?? session?.settlementStatus ?? '');
  if (settlementStatus === 'settled' || settlementStatus === 'skipped') {
    return null;
  }

  if (settlementStatus === 'failed') {
    return buildDriftDescriptor(
      DRIFT_TYPE.SETTLEMENT_FAILED,
      'session',
      String(session.id),
      'Closed session with failed settlement',
      {
        userId: session.user_id ?? session.userId ?? null,
        settlementStatus,
        verifiedDestroyedAt: session.verified_destroyed_at ?? session.verifiedDestroyedAt ?? null,
      },
    );
  }

  if (SETTLEMENT_RETRY_STATUSES.has(settlementStatus)) {
    return buildDriftDescriptor(
      DRIFT_TYPE.SETTLEMENT_PENDING,
      'session',
      String(session.id),
      'Closed session awaiting settlement commit',
      {
        userId: session.user_id ?? session.userId ?? null,
        settlementStatus,
        verifiedDestroyedAt: session.verified_destroyed_at ?? session.verifiedDestroyedAt ?? null,
      },
    );
  }

  return null;
}

/**
 * Detect drifts for a machine row + optional linked session (SCB §8.2).
 * @param {Record<string, unknown>} input
 */
export function detectMachineDrifts(input = {}) {
  const { machine, session, providerSnapshot, verifyResult, now, staleClosingAfterMs } = input;
  /** @type {ReturnType<typeof buildDriftDescriptor>[]} */
  const drifts = [];

  const mismatch = detectDestroyedMismatch(machine, providerSnapshot);
  if (mismatch) drifts.push(mismatch);

  const zombie = detectZombieLocal(session, machine, providerSnapshot, verifyResult);
  if (zombie) drifts.push(zombie);

  const stale =
    session && now
      ? detectStaleClosing(session, machine, String(now), staleClosingAfterMs)
      : null;
  if (stale) drifts.push(stale);

  const orphanSession = detectOrphanSession(session, machine);
  if (orphanSession) drifts.push(orphanSession);

  return drifts;
}

/**
 * Detect drifts for a session row (no provider call).
 * @param {Record<string, unknown>} input
 */
export function detectSessionDrifts(input = {}) {
  const { session, machine, now, staleClosingAfterMs } = input;
  /** @type {ReturnType<typeof buildDriftDescriptor>[]} */
  const drifts = [];

  const orphanSession = detectOrphanSession(session, machine);
  if (orphanSession) drifts.push(orphanSession);

  const stale =
    session && now
      ? detectStaleClosing(session, machine, String(now), staleClosingAfterMs)
      : null;
  if (stale) drifts.push(stale);

  const settlement = detectSettlementDrift(session);
  if (settlement) drifts.push(settlement);

  return drifts;
}

/**
 * Settlement drift detection only — no settlement trigger (M4/M6 contract).
 * @param {Record<string, unknown>} input
 */
export function detectSettlementDrifts(input = {}) {
  const drift = detectSettlementDrift(input.session);
  return drift ? [drift] : [];
}

/**
 * @param {ReturnType<typeof buildDriftDescriptor>[]} drifts
 */
export function dedupeDrifts(drifts) {
  const seen = new Set();
  return drifts.filter((drift) => {
    const key = `${drift.driftType}:${drift.entityType}:${drift.entityId}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
