/** @type {number} */
export const SESSION_MACHINE_TOLERANCE_MS = 5000;

/**
 * @param {{ started_at?: string | null; machine_id?: string | null }} session
 * @param {{ id?: string | null; created_at?: string | null }} machine
 */
export function sessionBelongsToMachine(session, machine) {
  if (!session?.started_at) return false;

  if (machine?.id && session?.machine_id && String(session.machine_id) === String(machine.id)) {
    return true;
  }

  if (!machine?.created_at) return false;

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
  if (!machine.created_at) return true;

  const anchorMs = new Date(billingStartedAt).getTime();
  const createdMs = new Date(String(machine.created_at)).getTime();
  if (!Number.isFinite(anchorMs) || !Number.isFinite(createdMs)) return false;

  return anchorMs >= createdMs - SESSION_MACHINE_TOLERANCE_MS;
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

  if (machine.billing_started_at) {
    const startedAt = String(machine.billing_started_at);
    if (isMachineBillingAnchorValid(startedAt, machine)) {
      return {
        startedAt,
        sessionId: machine.gpu_session_id ? String(machine.gpu_session_id) : null,
      };
    }
  }

  if (
    linkedSession?.status === 'running' &&
    linkedSession.started_at &&
    sessionBelongsToMachine(linkedSession, machine)
  ) {
    return {
      startedAt: String(linkedSession.started_at),
      sessionId: String(linkedSession.id),
    };
  }

  return { startedAt: null, sessionId: null };
}
