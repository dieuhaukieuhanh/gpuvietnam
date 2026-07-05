/** @type {number} */
export const SESSION_MACHINE_TOLERANCE_MS = 5000;

/** Reject lifecycle sentinel / corrupt anchors (matches M2 remaining-time guard). */
export const MIN_VALID_SESSION_STARTED_MS = Date.parse('2020-01-01T00:00:00.000Z');

/**
 * @param {unknown} value
 * @returns {number|null}
 */
export function parseValidSessionStartedMs(value) {
  if (value == null) return null;
  const ms = Date.parse(String(value));
  if (!Number.isFinite(ms) || ms < MIN_VALID_SESSION_STARTED_MS) return null;
  return ms;
}

/**
 * @param {{ started_at?: string | null; machine_id?: string | null }} session
 * @param {{ id?: string | null; created_at?: string | null }} machine
 */
export function sessionBelongsToMachine(session, machine) {
  if (!session?.started_at && !session?.verified_running_at) return false;

  if (machine?.id && session?.machine_id && String(session.machine_id) === String(machine.id)) {
    return true;
  }

  if (!session?.started_at || !machine?.created_at) return false;

  const sessionStart = new Date(String(session.started_at)).getTime();
  const machineCreated = new Date(String(machine.created_at)).getTime();
  if (!Number.isFinite(sessionStart) || !Number.isFinite(machineCreated)) return false;

  return sessionStart >= machineCreated - SESSION_MACHINE_TOLERANCE_MS;
}

/**
 * @param {string} billingStartedAt
 * @param {Record<string, unknown>} machine
 */
export function isMachineBillingAnchorValid(billingStartedAt, machine) {
  if (parseValidSessionStartedMs(billingStartedAt) == null) return false;

  if (!machine.created_at) return true;

  const anchorMs = new Date(billingStartedAt).getTime();
  const createdMs = new Date(String(machine.created_at)).getTime();
  if (!Number.isFinite(createdMs)) return false;

  return anchorMs >= createdMs - SESSION_MACHINE_TOLERANCE_MS;
}

/**
 * @param {Record<string, unknown>|null|undefined} machine
 * @param {Record<string, unknown>|null|undefined} linkedSession
 */
function resolveLinkedRunningSessionId(machine, linkedSession) {
  if (machine?.gpu_session_id) return String(machine.gpu_session_id);
  if (linkedSession?.status === 'running' && linkedSession?.id) {
    return String(linkedSession.id);
  }
  return null;
}

/**
 * Comfy-ready anchor from linked running session (started_at, then verified_running_at).
 *
 * @param {Record<string, unknown>|null|undefined} linkedSession
 * @param {Record<string, unknown>} machine
 */
function resolveLinkedSessionStartedAt(linkedSession, machine) {
  if (!linkedSession || linkedSession.status !== 'running') return null;
  if (!sessionBelongsToMachine(linkedSession, machine)) return null;

  if (parseValidSessionStartedMs(linkedSession.started_at) != null) {
    return String(linkedSession.started_at);
  }

  if (parseValidSessionStartedMs(linkedSession.verified_running_at) != null) {
    return String(linkedSession.verified_running_at);
  }

  return null;
}

/**
 * Pure billing anchor resolution (M5 read path).
 * @param {Record<string, unknown> | null | undefined} machine
 * @param {Record<string, unknown> | null | undefined} linkedSession
 */
export function resolveBillingAnchorFromRecords(machine, linkedSession) {
  if (!machine || String(machine.status ?? '') !== 'running') {
    return { startedAt: null, sessionId: null };
  }

  const sessionId = resolveLinkedRunningSessionId(machine, linkedSession);

  if (machine.billing_started_at) {
    const startedAt = String(machine.billing_started_at);
    if (isMachineBillingAnchorValid(startedAt, machine)) {
      return { startedAt, sessionId };
    }
  }

  const linkedStartedAt = resolveLinkedSessionStartedAt(linkedSession, machine);
  if (linkedStartedAt) {
    return {
      startedAt: linkedStartedAt,
      sessionId: sessionId ?? (linkedSession?.id ? String(linkedSession.id) : null),
    };
  }

  return { startedAt: null, sessionId: null };
}
