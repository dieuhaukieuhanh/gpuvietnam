/**
 * Session Lifecycle Domain — M3B.
 * Pure state machine. No DB, HTTP, Supabase, logging, or side effects.
 * @see docs/SESSION_DOMAIN_DESIGN.md v1.1
 */

/** @typedef {'pending'|'running'|'closing'|'closed'|'interrupted'|'completed'} SessionStatus */

/** @typedef {'not_applicable'|'awaiting_verify'|'pending'|'in_progress'|'settled'|'skipped'|'failed'} SettlementStatus */

/**
 * @typedef {Object} SessionRecord
 * @property {string} id
 * @property {string} userId
 * @property {SessionStatus} status
 * @property {string|null} [machineId]
 * @property {string|null} [started_at]
 * @property {string|null} [ended_at]
 * @property {SettlementStatus|null} [settlement_status]
 * @property {string|null} [destroy_reason]
 * @property {string|null} [verified_running_at]
 * @property {string|null} [verified_destroyed_at]
 */

/**
 * @typedef {Object} SessionContext
 * @property {boolean} [subscriptionActive]
 * @property {boolean} [machineExists]
 * @property {string|null} [machineStatus]
 * @property {boolean} [providerRunningVerified]
 * @property {boolean} [providerDestroyedVerified]
 * @property {number} [otherRunningSessionCount]
 * @property {number} [runningVerifyRetriesRemaining]
 * @property {'destroyed'|'still_running'|'timeout'} [verifyOutcome]
 * @property {string} [now]
 */

/**
 * @typedef {Object} TransitionOk
 * @property {'OK'|'IGNORED'} state
 * @property {SessionRecord} session
 * @property {{ from: SessionStatus|null, to: SessionStatus, command: string }|null} transition
 * @property {string|null} event
 */

/**
 * @typedef {Object} TransitionError
 * @property {'ERROR'} state
 * @property {string} code
 * @property {string} message
 */

/** @typedef {TransitionOk | TransitionError} TransitionResult */

export const SESSION_STATUS = Object.freeze({
  PENDING: 'pending',
  RUNNING: 'running',
  CLOSING: 'closing',
  CLOSED: 'closed',
  INTERRUPTED: 'interrupted',
  COMPLETED: 'completed',
});

export const SETTLEMENT_STATUS = Object.freeze({
  NOT_APPLICABLE: 'not_applicable',
  AWAITING_VERIFY: 'awaiting_verify',
  PENDING: 'pending',
  IN_PROGRESS: 'in_progress',
  SETTLED: 'settled',
  SKIPPED: 'skipped',
  FAILED: 'failed',
});

export const SESSION_COMMAND = Object.freeze({
  CREATE_PENDING: 'CREATE_PENDING',
  ACTIVATE_RUNNING: 'ACTIVATE_RUNNING',
  RUNNING_VERIFY_FAILED: 'RUNNING_VERIFY_FAILED',
  REQUEST_DESTROY: 'REQUEST_DESTROY',
  CLOSE: 'CLOSE',
  ROLLBACK_CLOSING: 'ROLLBACK_CLOSING',
  RETRY_DESTROY_VERIFY: 'RETRY_DESTROY_VERIFY',
  INTERRUPT: 'INTERRUPT',
  START_SETTLEMENT: 'START_SETTLEMENT',
  COMPLETE_SETTLEMENT: 'COMPLETE_SETTLEMENT',
  SKIP_SETTLEMENT: 'SKIP_SETTLEMENT',
  FAIL_SETTLEMENT: 'FAIL_SETTLEMENT',
  RETRY_SETTLEMENT: 'RETRY_SETTLEMENT',
});

export const SESSION_DOMAIN_EVENT = Object.freeze({
  SESSION_CREATED: 'SessionCreated',
  SESSION_ACTIVATED: 'SessionActivated',
  SESSION_CANCELLED: 'SessionCancelled',
  DESTROY_INITIATED: 'DestroyInitiated',
  SESSION_CLOSED: 'SessionClosed',
  SESSION_INTERRUPTED: 'SessionInterrupted',
  CLOSING_ROLLBACK: 'ProviderDestroyVerifyFailed',
  DESTROY_VERIFY_TIMEOUT: 'DestroyVerifyTimeout',
  SETTLEMENT_STARTED: 'SettlementStarted',
  SETTLEMENT_COMPLETED: 'SettlementCompleted',
  SETTLEMENT_SKIPPED: 'SettlementSkipped',
  SETTLEMENT_FAILED: 'SettlementFailed',
  SETTLEMENT_RETRIED: 'SettlementRetried',
});

export const SESSION_ERROR_CODE = Object.freeze({
  INVALID_TRANSITION: 'INVALID_TRANSITION',
  INVALID_SESSION_STATE: 'INVALID_SESSION_STATE',
  SESSION_NOT_PENDING: 'SESSION_NOT_PENDING',
  SESSION_NOT_RUNNING: 'SESSION_NOT_RUNNING',
  SESSION_NOT_CLOSING: 'SESSION_NOT_CLOSING',
  SESSION_NOT_CLOSED: 'SESSION_NOT_CLOSED',
  SESSION_ALREADY_CLOSED: 'SESSION_ALREADY_CLOSED',
  SESSION_ALREADY_TERMINAL: 'SESSION_ALREADY_TERMINAL',
  SESSION_LEGACY_COMPLETED: 'SESSION_LEGACY_COMPLETED',
  SUBSCRIPTION_NOT_ACTIVE: 'SUBSCRIPTION_NOT_ACTIVE',
  MACHINE_NOT_LINKED: 'MACHINE_NOT_LINKED',
  PROVIDER_NOT_VERIFIED: 'PROVIDER_NOT_VERIFIED',
  DESTROY_REASON_REQUIRED: 'DESTROY_REASON_REQUIRED',
  MULTIPLE_RUNNING_SESSIONS: 'MULTIPLE_RUNNING_SESSIONS',
  STARTED_AT_IMMUTABLE: 'STARTED_AT_IMMUTABLE',
  ENDED_AT_IMMUTABLE: 'ENDED_AT_IMMUTABLE',
  SETTLEMENT_ALREADY_SETTLED: 'SETTLEMENT_ALREADY_SETTLED',
  SETTLEMENT_NOT_FAILED: 'SETTLEMENT_NOT_FAILED',
  INVALID_INTERRUPT_REASON: 'INVALID_INTERRUPT_REASON',
  LEGACY_STATUS_FORBIDDEN: 'LEGACY_STATUS_FORBIDDEN',
});

export const ILLEGAL_POLICY = Object.freeze({
  IGNORE: 'IGNORE',
  DOMAIN_ERROR: 'DOMAIN_ERROR',
  LOG_WARNING: 'LOG_WARNING',
  INVARIANT_VIOLATION: 'INVARIANT_VIOLATION',
});

export const INTERRUPT_REASON = Object.freeze({
  PROVISION_FAILED: 'provision_failed',
  CANCELLED: 'cancelled',
  ORPHAN: 'orphan',
  ADMIN: 'admin',
  RUNNING_VERIFY_FATAL: 'running_verify_fatal',
});

/** Semantic version of the session state machine definition (bump when transitions change). */
export const SESSION_STATE_MACHINE_VERSION = '1.0';

/**
 * Recursively freeze plain objects and arrays (functions are frozen as object refs only).
 * @param {unknown} value
 * @returns {unknown}
 */
function deepFreeze(value) {
  if (value === null || typeof value !== 'object') {
    return value;
  }
  if (Object.isFrozen(value)) {
    return value;
  }
  Object.freeze(value);
  if (Array.isArray(value)) {
    for (const item of value) {
      deepFreeze(item);
    }
  } else {
    for (const key of Object.keys(value)) {
      deepFreeze(value[key]);
    }
  }
  return value;
}

const TERMINAL_STATUSES = new Set([
  SESSION_STATUS.CLOSED,
  SESSION_STATUS.INTERRUPTED,
  SESSION_STATUS.COMPLETED,
]);

const SCB_STATUSES = new Set([
  SESSION_STATUS.PENDING,
  SESSION_STATUS.RUNNING,
  SESSION_STATUS.CLOSING,
  SESSION_STATUS.CLOSED,
  SESSION_STATUS.INTERRUPTED,
]);

export class SessionInvariantViolationError extends Error {
  /**
   * @param {string} code
   * @param {string} message
   * @param {Record<string, unknown>} [details]
   */
  constructor(code, message, details = {}) {
    super(message);
    this.name = 'SessionInvariantViolationError';
    this.code = code;
    /** @type {Record<string, unknown>} */
    this.details = details;
  }
}

/** @param {string} code @param {string} message @returns {TransitionError} */
function errorResult(code, message) {
  return { state: 'ERROR', code, message };
}

/**
 * @param {SessionRecord} session
 * @param {{ from: SessionStatus|null, to: SessionStatus, command: string }} transition
 * @param {string|null} event
 * @returns {TransitionOk}
 */
function okResult(session, transition, event) {
  return { state: 'OK', session, transition, event };
}

/**
 * @param {SessionRecord} session
 * @returns {TransitionOk}
 */
function ignoredResult(session) {
  return { state: 'IGNORED', session, transition: null, event: null };
}

/** @param {SessionRecord|null|undefined} session @returns {SessionStatus|null} */
function currentStatus(session) {
  return session?.status ?? null;
}

/** @param {SessionContext} context */
function ctxNow(context) {
  return context.now ?? '1970-01-01T00:00:00.000Z';
}

/** @param {SessionRecord} session @throws {SessionInvariantViolationError} */
export function assertSessionIntegrity(session) {
  if (!session || typeof session !== 'object') {
    throw new SessionInvariantViolationError(
      SESSION_ERROR_CODE.INVALID_SESSION_STATE,
      'Session record is required',
    );
  }

  if (session.status === SESSION_STATUS.COMPLETED) {
    return;
  }

  if (session.status === SESSION_STATUS.RUNNING && session.started_at == null) {
    throw new SessionInvariantViolationError(
      SESSION_ERROR_CODE.INVALID_SESSION_STATE,
      'SD-2 violated: running session must have started_at',
      { sessionId: session.id },
    );
  }

  if (session.status === SESSION_STATUS.CLOSED) {
    if (session.ended_at == null) {
      throw new SessionInvariantViolationError(
        SESSION_ERROR_CODE.INVALID_SESSION_STATE,
        'SD-3 violated: closed session must have ended_at',
        { sessionId: session.id },
      );
    }
    if (session.settlement_status == null) {
      throw new SessionInvariantViolationError(
        SESSION_ERROR_CODE.INVALID_SESSION_STATE,
        'SD-4 violated: closed session must have settlement_status',
        { sessionId: session.id },
      );
    }
  }
}

/**
 * @param {SessionContext} context
 * @throws {SessionInvariantViolationError}
 */
export function assertAtMostOneRunningSession(context) {
  const count = context.otherRunningSessionCount ?? 0;
  if (count > 1) {
    throw new SessionInvariantViolationError(
      SESSION_ERROR_CODE.MULTIPLE_RUNNING_SESSIONS,
      'SD-1 violated: multiple running sessions for user',
      { otherRunningSessionCount: count },
    );
  }
}

/** @type {Record<string, (session: SessionRecord|null, context: SessionContext, payload: Record<string, unknown>) => { ok: true } | { ok: false, code: string, message: string, policy?: string }>} */
export const SESSION_GUARDS = Object.freeze({
  notLegacyCompleted(session) {
    if (session?.status === SESSION_STATUS.COMPLETED) {
      return {
        ok: false,
        code: SESSION_ERROR_CODE.SESSION_LEGACY_COMPLETED,
        message: 'Legacy completed session is read-only',
        policy: ILLEGAL_POLICY.DOMAIN_ERROR,
      };
    }
    return { ok: true };
  },

  subscriptionActive(_session, context) {
    if (context.subscriptionActive !== true) {
      return {
        ok: false,
        code: SESSION_ERROR_CODE.SUBSCRIPTION_NOT_ACTIVE,
        message: 'Subscription must be active (OP-2)',
        policy: ILLEGAL_POLICY.DOMAIN_ERROR,
      };
    }
    return { ok: true };
  },

  noOtherRunning(_session, context) {
    const count = context.otherRunningSessionCount ?? 0;
    if (count > 1) {
      return {
        ok: false,
        code: SESSION_ERROR_CODE.MULTIPLE_RUNNING_SESSIONS,
        message: 'SD-1: multiple running sessions detected',
        policy: ILLEGAL_POLICY.INVARIANT_VIOLATION,
      };
    }
    if (count === 1) {
      return {
        ok: false,
        code: SESSION_ERROR_CODE.MULTIPLE_RUNNING_SESSIONS,
        message: 'SES-1: user already has a running session',
        policy: ILLEGAL_POLICY.DOMAIN_ERROR,
      };
    }
    return { ok: true };
  },

  ses1Activate(session, context) {
    const count = context.otherRunningSessionCount ?? 0;
    if (count > 1) {
      return {
        ok: false,
        code: SESSION_ERROR_CODE.MULTIPLE_RUNNING_SESSIONS,
        message: 'SD-1: multiple running sessions detected',
        policy: ILLEGAL_POLICY.INVARIANT_VIOLATION,
      };
    }
    if (count === 1 && session?.status !== SESSION_STATUS.RUNNING) {
      return {
        ok: false,
        code: SESSION_ERROR_CODE.MULTIPLE_RUNNING_SESSIONS,
        message: 'SES-1: user already has a running session',
        policy: ILLEGAL_POLICY.DOMAIN_ERROR,
      };
    }
    return { ok: true };
  },

  statusPending(session) {
    if (session?.status !== SESSION_STATUS.PENDING) {
      return {
        ok: false,
        code: SESSION_ERROR_CODE.SESSION_NOT_PENDING,
        message: 'Session must be pending',
        policy: ILLEGAL_POLICY.DOMAIN_ERROR,
      };
    }
    return { ok: true };
  },

  statusRunning(session) {
    if (session?.status !== SESSION_STATUS.RUNNING) {
      return {
        ok: false,
        code: SESSION_ERROR_CODE.SESSION_NOT_RUNNING,
        message: 'Session must be running',
        policy: ILLEGAL_POLICY.DOMAIN_ERROR,
      };
    }
    return { ok: true };
  },

  statusClosing(session) {
    if (session?.status !== SESSION_STATUS.CLOSING) {
      return {
        ok: false,
        code: SESSION_ERROR_CODE.SESSION_NOT_CLOSING,
        message: 'Session must be closing',
        policy: ILLEGAL_POLICY.DOMAIN_ERROR,
      };
    }
    return { ok: true };
  },

  statusClosed(session) {
    if (session?.status !== SESSION_STATUS.CLOSED) {
      return {
        ok: false,
        code: SESSION_ERROR_CODE.SESSION_NOT_CLOSED,
        message: 'Session must be closed',
        policy: ILLEGAL_POLICY.DOMAIN_ERROR,
      };
    }
    return { ok: true };
  },

  startedAtSet(session) {
    if (session?.status === SESSION_STATUS.RUNNING && session.started_at == null) {
      return {
        ok: false,
        code: SESSION_ERROR_CODE.INVALID_SESSION_STATE,
        message: 'SD-2: started_at required for running session',
        policy: ILLEGAL_POLICY.INVARIANT_VIOLATION,
      };
    }
    return { ok: true };
  },

  machineLinked(session) {
    if (!session?.machineId) {
      return {
        ok: false,
        code: SESSION_ERROR_CODE.MACHINE_NOT_LINKED,
        message: 'MAC-4: machine must be linked',
        policy: ILLEGAL_POLICY.DOMAIN_ERROR,
      };
    }
    if (session.status === SESSION_STATUS.RUNNING && contextMachineRunning(session) === false) {
      return {
        ok: false,
        code: SESSION_ERROR_CODE.MACHINE_NOT_LINKED,
        message: 'MAC-4: machine must exist for running session',
        policy: ILLEGAL_POLICY.DOMAIN_ERROR,
      };
    }
    return { ok: true };
  },

  machineExists(_session, context) {
    if (context.machineExists !== true) {
      return {
        ok: false,
        code: SESSION_ERROR_CODE.MACHINE_NOT_LINKED,
        message: 'Machine must exist',
        policy: ILLEGAL_POLICY.DOMAIN_ERROR,
      };
    }
    return { ok: true };
  },

  providerRunningVerified(_session, context) {
    if (context.providerRunningVerified !== true) {
      return {
        ok: false,
        code: SESSION_ERROR_CODE.PROVIDER_NOT_VERIFIED,
        message: 'Provider RUNNING verify required',
        policy: ILLEGAL_POLICY.DOMAIN_ERROR,
      };
    }
    return { ok: true };
  },

  providerDestroyedVerified(_session, context) {
    if (context.providerDestroyedVerified !== true) {
      return {
        ok: false,
        code: SESSION_ERROR_CODE.PROVIDER_NOT_VERIFIED,
        message: 'OP-1: Provider DESTROYED verify required before closed',
        policy: ILLEGAL_POLICY.DOMAIN_ERROR,
      };
    }
    return { ok: true };
  },

  endedAtSet(session) {
    if (session?.status === SESSION_STATUS.CLOSED && session.ended_at == null) {
      return {
        ok: false,
        code: SESSION_ERROR_CODE.INVALID_SESSION_STATE,
        message: 'SD-3: ended_at required for closed session',
        policy: ILLEGAL_POLICY.INVARIANT_VIOLATION,
      };
    }
    return { ok: true };
  },

  settlementNotSettled(session) {
    if (session?.settlement_status === SETTLEMENT_STATUS.SETTLED) {
      return {
        ok: false,
        code: SESSION_ERROR_CODE.SETTLEMENT_ALREADY_SETTLED,
        message: 'SD-9: settlement already committed',
        policy: ILLEGAL_POLICY.DOMAIN_ERROR,
      };
    }
    return { ok: true };
  },

  settlementFailed(session) {
    if (session?.settlement_status !== SETTLEMENT_STATUS.FAILED) {
      return {
        ok: false,
        code: SESSION_ERROR_CODE.SETTLEMENT_NOT_FAILED,
        message: 'Settlement retry requires failed status',
        policy: ILLEGAL_POLICY.DOMAIN_ERROR,
      };
    }
    return { ok: true };
  },

  notTerminal(session) {
    if (session && TERMINAL_STATUSES.has(session.status)) {
      return {
        ok: false,
        code: SESSION_ERROR_CODE.SESSION_ALREADY_TERMINAL,
        message: `Session is terminal (${session.status})`,
        policy: ILLEGAL_POLICY.DOMAIN_ERROR,
      };
    }
    return { ok: true };
  },

  destroyReasonProvided(_session, _context, payload) {
    if (!payload.destroyReason || typeof payload.destroyReason !== 'string') {
      return {
        ok: false,
        code: SESSION_ERROR_CODE.DESTROY_REASON_REQUIRED,
        message: 'SD-18: destroy_reason required when entering closing',
        policy: ILLEGAL_POLICY.DOMAIN_ERROR,
      };
    }
    return { ok: true };
  },
});

/** @param {SessionRecord} session */
function contextMachineRunning(session) {
  return Boolean(session.machineId);
}

/**
 * @param {string[]} guardNames
 * @param {SessionRecord|null} session
 * @param {SessionContext} context
 * @param {Record<string, unknown>} payload
 * @throws {SessionInvariantViolationError}
 * @returns {TransitionError|null}
 */
function runGuards(guardNames, session, context, payload) {
  for (const name of guardNames) {
    const guard = SESSION_GUARDS[name];
    if (!guard) {
      throw new SessionInvariantViolationError(
        SESSION_ERROR_CODE.INVALID_SESSION_STATE,
        `Unknown guard: ${name}`,
      );
    }
    const result = guard(session, context, payload);
    if (!result.ok) {
      if (result.policy === ILLEGAL_POLICY.INVARIANT_VIOLATION) {
        throw new SessionInvariantViolationError(result.code, result.message);
      }
      return errorResult(result.code, result.message);
    }
  }
  return null;
}

/** @param {SessionRecord} session @param {string} field @param {string|null} next @param {string} code */
function assertImmutableField(session, field, next, code) {
  const current = session[field];
  if (current != null && next != null && current !== next) {
    throw new SessionInvariantViolationError(
      code,
      `${field} is immutable once set (SD-5/SD-6)`,
      { sessionId: session.id, field, current, next },
    );
  }
}

/**
 * @typedef {Object} TransitionDefinition
 * @property {string} transitionId
 * @property {SessionStatus|null} from
 * @property {string} command
 * @property {SessionStatus|null} to
 * @property {string[]} guards
 * @property {string} event
 * @property {string} illegalPolicy
 * @property {(session: SessionRecord|null, context: SessionContext, payload: Record<string, unknown>) => boolean} [match]
 * @property {(session: SessionRecord|null, context: SessionContext, payload: Record<string, unknown>) => SessionRecord} apply
 * @property {(session: SessionRecord, context: SessionContext, payload: Record<string, unknown>) => boolean} [idempotent]
 */

/** @type {TransitionDefinition[]} */
const SESSION_TRANSITION_MAP = [
  {
    transitionId: 'SES-TR-001',
    from: null,
    command: SESSION_COMMAND.CREATE_PENDING,
    to: SESSION_STATUS.PENDING,
    guards: ['noOtherRunning', 'subscriptionActive'],
    event: SESSION_DOMAIN_EVENT.SESSION_CREATED,
    illegalPolicy: ILLEGAL_POLICY.DOMAIN_ERROR,
    apply(_session, context, payload) {
      const now = ctxNow(context);
      return {
        id: String(payload.id),
        userId: String(payload.userId),
        status: SESSION_STATUS.PENDING,
        machineId: payload.machineId != null ? String(payload.machineId) : null,
        started_at: null,
        ended_at: null,
        settlement_status: SETTLEMENT_STATUS.NOT_APPLICABLE,
        destroy_reason: null,
        verified_running_at: null,
        verified_destroyed_at: null,
        created_at: payload.created_at ?? now,
      };
    },
  },
  {
    transitionId: 'SES-TR-002',
    from: SESSION_STATUS.PENDING,
    command: SESSION_COMMAND.ACTIVATE_RUNNING,
    to: SESSION_STATUS.RUNNING,
    guards: [
      'notLegacyCompleted',
      'statusPending',
      'ses1Activate',
      'subscriptionActive',
      'machineExists',
      'providerRunningVerified',
    ],
    event: SESSION_DOMAIN_EVENT.SESSION_ACTIVATED,
    illegalPolicy: ILLEGAL_POLICY.DOMAIN_ERROR,
    apply(session, context, payload) {
      assertSessionIntegrity(session);
      const startedAt = payload.started_at ?? ctxNow(context);
      assertImmutableField(session, 'started_at', startedAt, SESSION_ERROR_CODE.STARTED_AT_IMMUTABLE);
      return {
        ...session,
        status: SESSION_STATUS.RUNNING,
        started_at: session.started_at ?? startedAt,
        verified_running_at: payload.verified_running_at ?? ctxNow(context),
        settlement_status: null,
      };
    },
  },
  {
    transitionId: 'SES-TR-003',
    from: SESSION_STATUS.PENDING,
    command: SESSION_COMMAND.RUNNING_VERIFY_FAILED,
    to: SESSION_STATUS.PENDING,
    guards: ['notLegacyCompleted', 'statusPending'],
    event: null,
    illegalPolicy: ILLEGAL_POLICY.DOMAIN_ERROR,
    match(_session, context) {
      return (context.runningVerifyRetriesRemaining ?? 0) > 0;
    },
    apply(session) {
      return { ...session };
    },
    idempotent() {
      return true;
    },
  },
  {
    transitionId: 'SES-TR-004',
    from: SESSION_STATUS.PENDING,
    command: SESSION_COMMAND.RUNNING_VERIFY_FAILED,
    to: SESSION_STATUS.INTERRUPTED,
    guards: ['notLegacyCompleted', 'statusPending'],
    event: SESSION_DOMAIN_EVENT.SESSION_INTERRUPTED,
    illegalPolicy: ILLEGAL_POLICY.DOMAIN_ERROR,
    match(_session, context) {
      return (context.runningVerifyRetriesRemaining ?? 0) <= 0;
    },
    apply(session, context) {
      return {
        ...session,
        status: SESSION_STATUS.INTERRUPTED,
        settlement_status: SETTLEMENT_STATUS.SKIPPED,
        ended_at: null,
        destroy_reason: 'running_verify_fatal',
      };
    },
  },
  {
    transitionId: 'SES-TR-005',
    from: SESSION_STATUS.PENDING,
    command: SESSION_COMMAND.INTERRUPT,
    to: SESSION_STATUS.INTERRUPTED,
    guards: ['notLegacyCompleted', 'statusPending'],
    event: SESSION_DOMAIN_EVENT.SESSION_INTERRUPTED,
    illegalPolicy: ILLEGAL_POLICY.DOMAIN_ERROR,
    match(_session, _context, payload) {
      return payload.reason === INTERRUPT_REASON.PROVISION_FAILED;
    },
    apply(session) {
      return {
        ...session,
        status: SESSION_STATUS.INTERRUPTED,
        settlement_status: SETTLEMENT_STATUS.NOT_APPLICABLE,
        ended_at: null,
        destroy_reason: INTERRUPT_REASON.PROVISION_FAILED,
      };
    },
  },
  {
    transitionId: 'SES-TR-006',
    from: SESSION_STATUS.PENDING,
    command: SESSION_COMMAND.INTERRUPT,
    to: SESSION_STATUS.INTERRUPTED,
    guards: ['notLegacyCompleted', 'statusPending'],
    event: SESSION_DOMAIN_EVENT.SESSION_CANCELLED,
    illegalPolicy: ILLEGAL_POLICY.DOMAIN_ERROR,
    match(_session, _context, payload) {
      return payload.reason === INTERRUPT_REASON.CANCELLED;
    },
    apply(session) {
      return {
        ...session,
        status: SESSION_STATUS.INTERRUPTED,
        settlement_status: SETTLEMENT_STATUS.SKIPPED,
        ended_at: null,
        destroy_reason: INTERRUPT_REASON.CANCELLED,
      };
    },
  },
  {
    transitionId: 'SES-TR-007',
    from: SESSION_STATUS.RUNNING,
    command: SESSION_COMMAND.REQUEST_DESTROY,
    to: SESSION_STATUS.CLOSING,
    guards: [
      'notLegacyCompleted',
      'statusRunning',
      'startedAtSet',
      'machineLinked',
      'destroyReasonProvided',
    ],
    event: SESSION_DOMAIN_EVENT.DESTROY_INITIATED,
    illegalPolicy: ILLEGAL_POLICY.DOMAIN_ERROR,
    apply(session, _context, payload) {
      assertSessionIntegrity(session);
      return {
        ...session,
        status: SESSION_STATUS.CLOSING,
        destroy_reason: String(payload.destroyReason),
        settlement_status: SETTLEMENT_STATUS.AWAITING_VERIFY,
      };
    },
    idempotent(session) {
      return session.status === SESSION_STATUS.CLOSING;
    },
  },
  {
    transitionId: 'SES-TR-008',
    from: SESSION_STATUS.CLOSING,
    command: SESSION_COMMAND.REQUEST_DESTROY,
    to: SESSION_STATUS.CLOSING,
    guards: ['notLegacyCompleted', 'statusClosing'],
    event: null,
    illegalPolicy: ILLEGAL_POLICY.IGNORE,
    apply(session) {
      return { ...session };
    },
    idempotent() {
      return true;
    },
  },
  {
    transitionId: 'SES-TR-009',
    from: SESSION_STATUS.RUNNING,
    command: SESSION_COMMAND.INTERRUPT,
    to: SESSION_STATUS.INTERRUPTED,
    guards: ['notLegacyCompleted', 'statusRunning'],
    event: SESSION_DOMAIN_EVENT.SESSION_INTERRUPTED,
    illegalPolicy: ILLEGAL_POLICY.DOMAIN_ERROR,
    match(_session, _context, payload) {
      return (
        payload.reason === INTERRUPT_REASON.ORPHAN || payload.reason === INTERRUPT_REASON.ADMIN
      );
    },
    apply(session, context, payload) {
      const wasBillable = session.started_at != null;
      return {
        ...session,
        status: SESSION_STATUS.INTERRUPTED,
        settlement_status: SETTLEMENT_STATUS.SKIPPED,
        ended_at: wasBillable ? ctxNow(context) : null,
        destroy_reason: String(payload.reason),
      };
    },
  },
  {
    transitionId: 'SES-TR-010',
    from: SESSION_STATUS.CLOSING,
    command: SESSION_COMMAND.CLOSE,
    to: SESSION_STATUS.CLOSED,
    guards: ['notLegacyCompleted', 'statusClosing', 'providerDestroyedVerified'],
    event: SESSION_DOMAIN_EVENT.SESSION_CLOSED,
    illegalPolicy: ILLEGAL_POLICY.DOMAIN_ERROR,
    apply(session, context, payload) {
      assertSessionIntegrity(session);
      const endedAt = payload.ended_at ?? ctxNow(context);
      assertImmutableField(session, 'ended_at', endedAt, SESSION_ERROR_CODE.ENDED_AT_IMMUTABLE);
      return {
        ...session,
        status: SESSION_STATUS.CLOSED,
        ended_at: session.ended_at ?? endedAt,
        verified_destroyed_at: payload.verified_destroyed_at ?? ctxNow(context),
        settlement_status: SETTLEMENT_STATUS.PENDING,
      };
    },
    idempotent(session) {
      return session.status === SESSION_STATUS.CLOSED;
    },
  },
  {
    transitionId: 'SES-TR-011',
    from: SESSION_STATUS.CLOSING,
    command: SESSION_COMMAND.ROLLBACK_CLOSING,
    to: SESSION_STATUS.RUNNING,
    guards: ['notLegacyCompleted', 'statusClosing'],
    event: SESSION_DOMAIN_EVENT.CLOSING_ROLLBACK,
    illegalPolicy: ILLEGAL_POLICY.DOMAIN_ERROR,
    apply(session) {
      return {
        ...session,
        status: SESSION_STATUS.RUNNING,
        destroy_reason: null,
        settlement_status: null,
      };
    },
  },
  {
    transitionId: 'SES-TR-012',
    from: SESSION_STATUS.CLOSING,
    command: SESSION_COMMAND.RETRY_DESTROY_VERIFY,
    to: SESSION_STATUS.CLOSING,
    guards: ['notLegacyCompleted', 'statusClosing'],
    event: SESSION_DOMAIN_EVENT.DESTROY_VERIFY_TIMEOUT,
    illegalPolicy: ILLEGAL_POLICY.IGNORE,
    apply(session) {
      return { ...session };
    },
    idempotent() {
      return true;
    },
  },
  {
    transitionId: 'SES-TR-013',
    from: SESSION_STATUS.CLOSING,
    command: SESSION_COMMAND.INTERRUPT,
    to: SESSION_STATUS.INTERRUPTED,
    guards: ['notLegacyCompleted', 'statusClosing'],
    event: SESSION_DOMAIN_EVENT.SESSION_INTERRUPTED,
    illegalPolicy: ILLEGAL_POLICY.DOMAIN_ERROR,
    match(_session, _context, payload) {
      return payload.reason === INTERRUPT_REASON.ADMIN;
    },
    apply(session, context) {
      const wasBillable = session.started_at != null;
      return {
        ...session,
        status: SESSION_STATUS.INTERRUPTED,
        settlement_status: SETTLEMENT_STATUS.SKIPPED,
        ended_at: wasBillable ? ctxNow(context) : null,
        destroy_reason: INTERRUPT_REASON.ADMIN,
      };
    },
  },
  {
    transitionId: 'SES-TR-014',
    from: SESSION_STATUS.CLOSED,
    command: SESSION_COMMAND.START_SETTLEMENT,
    to: SESSION_STATUS.CLOSED,
    guards: ['notLegacyCompleted', 'statusClosed', 'endedAtSet', 'settlementNotSettled'],
    event: SESSION_DOMAIN_EVENT.SETTLEMENT_STARTED,
    illegalPolicy: ILLEGAL_POLICY.DOMAIN_ERROR,
    match(session) {
      return (
        session.settlement_status === SETTLEMENT_STATUS.PENDING ||
        session.settlement_status === SETTLEMENT_STATUS.FAILED
      );
    },
    apply(session) {
      return { ...session, settlement_status: SETTLEMENT_STATUS.IN_PROGRESS };
    },
    idempotent(session) {
      return session.settlement_status === SETTLEMENT_STATUS.IN_PROGRESS;
    },
  },
  {
    transitionId: 'SES-TR-015',
    from: SESSION_STATUS.CLOSED,
    command: SESSION_COMMAND.COMPLETE_SETTLEMENT,
    to: SESSION_STATUS.CLOSED,
    guards: ['notLegacyCompleted', 'statusClosed', 'endedAtSet'],
    event: SESSION_DOMAIN_EVENT.SETTLEMENT_COMPLETED,
    illegalPolicy: ILLEGAL_POLICY.DOMAIN_ERROR,
    apply(session) {
      if (session.settlement_status === SETTLEMENT_STATUS.SETTLED) {
        return session;
      }
      return { ...session, settlement_status: SETTLEMENT_STATUS.SETTLED };
    },
    idempotent(session) {
      return session.settlement_status === SETTLEMENT_STATUS.SETTLED;
    },
  },
  {
    transitionId: 'SES-TR-016',
    from: SESSION_STATUS.CLOSED,
    command: SESSION_COMMAND.SKIP_SETTLEMENT,
    to: SESSION_STATUS.CLOSED,
    guards: ['notLegacyCompleted', 'statusClosed', 'endedAtSet', 'settlementNotSettled'],
    event: SESSION_DOMAIN_EVENT.SETTLEMENT_SKIPPED,
    illegalPolicy: ILLEGAL_POLICY.DOMAIN_ERROR,
    apply(session) {
      return { ...session, settlement_status: SETTLEMENT_STATUS.SKIPPED };
    },
  },
  {
    transitionId: 'SES-TR-017',
    from: SESSION_STATUS.CLOSED,
    command: SESSION_COMMAND.FAIL_SETTLEMENT,
    to: SESSION_STATUS.CLOSED,
    guards: ['notLegacyCompleted', 'statusClosed', 'endedAtSet'],
    event: SESSION_DOMAIN_EVENT.SETTLEMENT_FAILED,
    illegalPolicy: ILLEGAL_POLICY.DOMAIN_ERROR,
    match(session) {
      return session.settlement_status !== SETTLEMENT_STATUS.SETTLED;
    },
    apply(session) {
      return { ...session, settlement_status: SETTLEMENT_STATUS.FAILED };
    },
  },
  {
    transitionId: 'SES-TR-018',
    from: SESSION_STATUS.CLOSED,
    command: SESSION_COMMAND.RETRY_SETTLEMENT,
    to: SESSION_STATUS.CLOSED,
    guards: ['notLegacyCompleted', 'statusClosed', 'endedAtSet', 'settlementFailed'],
    event: SESSION_DOMAIN_EVENT.SETTLEMENT_RETRIED,
    illegalPolicy: ILLEGAL_POLICY.DOMAIN_ERROR,
    apply(session) {
      return { ...session, settlement_status: SETTLEMENT_STATUS.IN_PROGRESS };
    },
    idempotent(session) {
      return session.settlement_status === SETTLEMENT_STATUS.SETTLED;
    },
  },
  {
    transitionId: 'SES-TR-019',
    from: SESSION_STATUS.INTERRUPTED,
    command: SESSION_COMMAND.INTERRUPT,
    to: SESSION_STATUS.INTERRUPTED,
    guards: ['notLegacyCompleted'],
    event: null,
    illegalPolicy: ILLEGAL_POLICY.IGNORE,
    apply(session) {
      return { ...session };
    },
    idempotent() {
      return true;
    },
  },
  {
    transitionId: 'SES-TR-020',
    from: SESSION_STATUS.COMPLETED,
    command: SESSION_COMMAND.ACTIVATE_RUNNING,
    to: SESSION_STATUS.COMPLETED,
    guards: ['notLegacyCompleted'],
    event: null,
    illegalPolicy: ILLEGAL_POLICY.DOMAIN_ERROR,
    apply(session) {
      return session;
    },
  },
];

deepFreeze(SESSION_TRANSITION_MAP);

/**
 * @param {SessionStatus|null} from
 * @param {string} command
 * @returns {TransitionDefinition[]}
 */
export function findTransitions(from, command) {
  return SESSION_TRANSITION_MAP.filter((def) => def.from === from && def.command === command);
}

/** @returns {TransitionDefinition[]} */
export function getTransitionMap() {
  return SESSION_TRANSITION_MAP;
}

/**
 * When no (from, command) row exists, infer a domain error from status guards on same command.
 * @param {SessionRecord|null} session
 * @param {string} command
 * @param {SessionContext} context
 * @param {Record<string, unknown>} payload
 * @returns {TransitionError|null}
 */
function inferGuardErrorForCommand(session, command, context, payload) {
  const related = SESSION_TRANSITION_MAP.filter(
    (def) => def.command === command && def.from != null,
  );

  for (const def of related) {
    for (const guardName of def.guards) {
      if (!guardName.startsWith('status')) {
        continue;
      }
      const guard = SESSION_GUARDS[guardName];
      if (!guard) {
        continue;
      }
      const result = guard(session, context, payload);
      if (!result.ok && result.policy !== ILLEGAL_POLICY.INVARIANT_VIOLATION) {
        return errorResult(result.code, result.message);
      }
    }
  }

  return null;
}

/**
 * @param {SessionRecord|null} session
 * @param {string} command
 * @param {SessionContext} context
 * @param {Record<string, unknown>} [payload]
 * @returns {TransitionResult}
 */
export function executeCommand(session, command, context, payload = {}) {
  const from = currentStatus(session);

  if (session && from !== SESSION_STATUS.COMPLETED) {
    try {
      assertSessionIntegrity(session);
    } catch (err) {
      if (err instanceof SessionInvariantViolationError) {
        throw err;
      }
      throw err;
    }
  }

  const candidates = findTransitions(from, command);
  if (candidates.length === 0) {
    const inferred = inferGuardErrorForCommand(session, command, context, payload);
    if (inferred) {
      return inferred;
    }
    return errorResult(
      SESSION_ERROR_CODE.INVALID_TRANSITION,
      `No transition for status=${from ?? 'null'} command=${command}`,
    );
  }

  const matched = candidates.filter((def) => !def.match || def.match(session, context, payload));
  if (matched.length === 0) {
    return errorResult(
      SESSION_ERROR_CODE.INVALID_TRANSITION,
      `No matching transition for status=${from ?? 'null'} command=${command}`,
    );
  }

  const definition = matched[0];

  if (session && definition.idempotent?.(session, context, payload)) {
    if (definition.to && session.status === definition.to) {
      return ignoredResult(session);
    }
  }

  const guardError = runGuards(definition.guards, session, context, payload);
  if (guardError) {
    return guardError;
  }

  if (session && definition.idempotent?.(session, context, payload)) {
    return ignoredResult(session);
  }

  const nextSession = definition.apply(session, context, payload);

  if (nextSession.status === SESSION_STATUS.COMPLETED && command === SESSION_COMMAND.CREATE_PENDING) {
    return errorResult(
      SESSION_ERROR_CODE.LEGACY_STATUS_FORBIDDEN,
      'SD-14: cannot create completed session',
    );
  }

  if (SCB_STATUSES.has(nextSession.status) || nextSession.status === SESSION_STATUS.COMPLETED) {
    try {
      assertSessionIntegrity(nextSession);
    } catch (err) {
      if (err instanceof SessionInvariantViolationError) {
        throw err;
      }
      throw err;
    }
  }

  const transition =
    definition.to != null
      ? { from, to: definition.to, command }
      : null;

  return okResult(nextSession, transition, definition.event);
}

/**
 * @param {Record<string, unknown>} input
 * @param {SessionContext} context
 * @returns {TransitionResult}
 */
export function createPendingSession(input, context) {
  if (input.status === SESSION_STATUS.COMPLETED) {
    return errorResult(
      SESSION_ERROR_CODE.LEGACY_STATUS_FORBIDDEN,
      'SD-14: cannot create completed session',
    );
  }

  return executeCommand(null, SESSION_COMMAND.CREATE_PENDING, context, input);
}

/**
 * @param {SessionRecord} session
 * @param {SessionContext} context
 * @param {Record<string, unknown>} [payload]
 * @returns {TransitionResult}
 */
export function activateRunningSession(session, context, payload = {}) {
  return executeCommand(session, SESSION_COMMAND.ACTIVATE_RUNNING, context, payload);
}

/**
 * @param {SessionRecord} session
 * @param {SessionContext} context
 * @param {{ destroyReason: string }} payload
 * @returns {TransitionResult}
 */
export function requestDestroy(session, context, payload) {
  return executeCommand(session, SESSION_COMMAND.REQUEST_DESTROY, context, payload);
}

/**
 * @param {SessionRecord} session
 * @param {SessionContext} context
 * @param {Record<string, unknown>} [payload]
 * @returns {TransitionResult}
 */
export function closeSession(session, context, payload = {}) {
  return executeCommand(session, SESSION_COMMAND.CLOSE, context, payload);
}

/**
 * @param {SessionRecord} session
 * @param {SessionContext} context
 * @param {{ reason: string }} payload
 * @returns {TransitionResult}
 */
export function interruptSession(session, context, payload) {
  const validReasons = new Set(Object.values(INTERRUPT_REASON));
  if (!validReasons.has(payload.reason)) {
    return errorResult(
      SESSION_ERROR_CODE.INVALID_INTERRUPT_REASON,
      `Invalid interrupt reason: ${payload.reason}`,
    );
  }
  return executeCommand(session, SESSION_COMMAND.INTERRUPT, context, payload);
}

/**
 * @param {SessionRecord} session
 * @param {SessionContext} context
 * @returns {TransitionResult}
 */
export function handleRunningVerifyFailed(session, context) {
  return executeCommand(session, SESSION_COMMAND.RUNNING_VERIFY_FAILED, context, {});
}

/**
 * @param {SessionRecord} session
 * @param {SessionContext} context
 * @returns {TransitionResult}
 */
export function rollbackClosingToRunning(session, context) {
  return executeCommand(session, SESSION_COMMAND.ROLLBACK_CLOSING, context, {});
}

/**
 * @param {SessionRecord} session
 * @param {SessionContext} context
 * @returns {TransitionResult}
 */
export function retryDestroyVerification(session, context) {
  const outcome = context.verifyOutcome;

  if (session.status === SESSION_STATUS.CLOSED) {
    return ignoredResult(session);
  }

  if (session.status !== SESSION_STATUS.CLOSING) {
    return errorResult(
      SESSION_ERROR_CODE.SESSION_NOT_CLOSING,
      'Retry destroy verify requires closing session',
    );
  }

  if (outcome === 'destroyed') {
    return closeSession(session, { ...context, providerDestroyedVerified: true }, {});
  }

  if (outcome === 'still_running') {
    return rollbackClosingToRunning(session, context);
  }

  if (outcome === 'timeout') {
    return executeCommand(session, SESSION_COMMAND.RETRY_DESTROY_VERIFY, context, {});
  }

  return errorResult(
    SESSION_ERROR_CODE.INVALID_TRANSITION,
    'verifyOutcome must be destroyed, still_running, or timeout',
  );
}

/**
 * @param {SessionRecord} session
 * @param {SessionContext} context
 * @returns {TransitionResult}
 */
export function retrySettlement(session, context) {
  if (session.settlement_status === SETTLEMENT_STATUS.SETTLED) {
    return ignoredResult(session);
  }
  return executeCommand(session, SESSION_COMMAND.RETRY_SETTLEMENT, context, {});
}

/**
 * @param {SessionRecord} session
 * @param {SessionContext} context
 * @returns {TransitionResult}
 */
export function cancelSession(session, context) {
  return interruptSession(session, context, { reason: INTERRUPT_REASON.CANCELLED });
}

/**
 * @param {SessionRecord} session
 * @param {SessionContext} context
 * @returns {TransitionResult}
 */
export function startSettlement(session, context) {
  return executeCommand(session, SESSION_COMMAND.START_SETTLEMENT, context, {});
}

/**
 * @param {SessionRecord} session
 * @param {SessionContext} context
 * @returns {TransitionResult}
 */
export function completeSettlement(session, context) {
  return executeCommand(session, SESSION_COMMAND.COMPLETE_SETTLEMENT, context, {});
}

/**
 * @param {SessionRecord} session
 * @param {SessionContext} context
 * @returns {TransitionResult}
 */
export function skipSettlement(session, context) {
  return executeCommand(session, SESSION_COMMAND.SKIP_SETTLEMENT, context, {});
}

/**
 * @param {SessionRecord} session
 * @param {SessionContext} context
 * @returns {TransitionResult}
 */
export function failSettlement(session, context) {
  return executeCommand(session, SESSION_COMMAND.FAIL_SETTLEMENT, context, {});
}

/** @param {SessionStatus} status @returns {boolean} */
export function isTerminalStatus(status) {
  return TERMINAL_STATUSES.has(status);
}

/** @param {SessionStatus} status @returns {boolean} */
export function isScbStatus(status) {
  return SCB_STATUSES.has(status);
}
