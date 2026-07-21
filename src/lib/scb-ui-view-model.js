/**
 * SCB UI — presentation-only helpers (smooth timer/remaining display).
 */

/** Reject lifecycle sentinel / corrupt session anchors (matches M2 remaining-time guard). */
const MIN_VALID_SESSION_STARTED_MS = Date.parse('2020-01-01T00:00:00.000Z');

/** Presentation cap — corrupt API duration must not inflate the session clock. */
const MAX_PLAUSIBLE_SESSION_SECONDS = 30 * 24 * 3600;

/**
 * @param {unknown} value
 * @returns {number|null}
 */
function parseValidStartedMs(value) {
  if (value == null) return null;
  const ms = Date.parse(String(value));
  if (!Number.isFinite(ms) || ms < MIN_VALID_SESSION_STARTED_MS) return null;
  return ms;
}

/**
 * Presentation-only anchor for smooth session elapsed display (M11+).
 * Resync on each dashboard refresh via resolveSessionElapsedAnchor().
 *
 * @param {{ sessionDurationSeconds?: number; billingStartedAt?: string | null; verifiedRunningAt?: string | null }} api
 * @param {number} [syncNowMs]
 * @returns {{ mode: 'duration'; baseSeconds: number; syncedAtMs: number } | { mode: 'startedAt'; startedMs: number }}
 */
export function resolveSessionElapsedAnchor(api, syncNowMs = Date.now()) {
  const rawSeconds = Math.max(0, Math.floor(Number(api?.sessionDurationSeconds ?? 0)));
  const baseSeconds =
    rawSeconds > MAX_PLAUSIBLE_SESSION_SECONDS ? 0 : rawSeconds;
  const startedMs =
    parseValidStartedMs(api?.billingStartedAt) ??
    parseValidStartedMs(api?.verifiedRunningAt);

  if (baseSeconds > 0) {
    return { mode: 'duration', baseSeconds, syncedAtMs: syncNowMs };
  }
  if (startedMs != null) {
    return { mode: 'startedAt', startedMs };
  }
  return { mode: 'duration', baseSeconds: 0, syncedAtMs: syncNowMs };
}

/**
 * @param {ReturnType<typeof resolveSessionElapsedAnchor>|null|undefined} anchor
 * @param {number} [nowMs]
 */
export function computeSessionElapsedSeconds(anchor, nowMs = Date.now()) {
  if (!anchor) return 0;
  if (anchor.mode === 'startedAt') {
    return Math.max(0, Math.floor((nowMs - anchor.startedMs) / 1000));
  }
  return Math.max(0, anchor.baseSeconds + Math.floor((nowMs - anchor.syncedAtMs) / 1000));
}

/**
 * Presentation-only anchor for smooth remaining-hours display (M11+).
 * Resync on each dashboard refresh. No interpolation when API pair is incomplete.
 *
 * @param {number | null | undefined} remainingHours
 * @param {number | null | undefined} sessionDurationSeconds
 * @returns {{ remainingHours: number; sessionDurationSeconds: number } | null}
 */
export function resolveRemainingHoursAnchor(remainingHours, sessionDurationSeconds) {
  if (remainingHours == null || !Number.isFinite(Number(remainingHours))) return null;
  const duration = Math.max(0, Math.floor(Number(sessionDurationSeconds ?? 0)));
  if (duration <= 0) return null;
  return {
    remainingHours: Number(remainingHours),
    sessionDurationSeconds: duration,
  };
}

/**
 * Interpolate remaining hours from poll anchor + elapsed session clock (presentation only).
 *
 * @param {{ remainingHours: number; sessionDurationSeconds: number } | null | undefined} anchor
 * @param {number} currentElapsedSeconds
 * @returns {number | null} null when anchor missing — caller shows raw API value
 */
export function computeDisplayRemainingHours(anchor, currentElapsedSeconds) {
  if (!anchor) return null;
  const elapsed = Math.max(0, Math.floor(Number(currentElapsedSeconds ?? 0)));
  const deltaSeconds = Math.max(0, elapsed - anchor.sessionDurationSeconds);
  return Math.max(0, anchor.remainingHours - deltaSeconds / 3600);
}

const REMAINING_REGRESSION_EPSILON_HOURS = 0.02;

/** @param {Record<string, unknown> | null | undefined} view */
export function pickBillingRemainingHours(view) {
  if (view?.planCardRemainingHours != null) return Number(view.planCardRemainingHours);
  if (view?.remainingHours != null) return Number(view.remainingHours);
  return null;
}

/**
 * Reject stale entitlement reads right after session end (settlement lag).
 * @param {Record<string, unknown> | null | undefined} prev
 * @param {Record<string, unknown> | null | undefined} next
 */
/**
 * Reject stale lifecycle regression while boot/shutdown is in flight on the client.
 * @param {Record<string, unknown> | null | undefined} prev
 * @param {Record<string, unknown> | null | undefined} next
 * @param {{ openingGuardUntilMs?: number; nowMs?: number }} [options]
 */
export function mergeMachineSessionViewOnPoll(prev, next, options = {}) {
  if (!next) return next;
  if (!prev) return next;

  const prevPhase = String(prev.phase ?? 'idle');
  const nextPhase = String(next.phase ?? 'idle');
  const nowMs = Number(options.nowMs ?? Date.now());
  const openingGuardUntilMs = Number(options.openingGuardUntilMs ?? 0);

  if (prevPhase === 'opening' && nextPhase === 'idle') {
    if (openingGuardUntilMs > nowMs || prev.clientOptimistic === true) {
      return prev;
    }
  }

  if (prevPhase === 'running' && nextPhase === 'opening') {
    return prev;
  }

  // Hour top-up / wrong subscription pick must not flash the idle "Mở phiên" card.
  if (
    prevPhase === 'running' &&
    nextPhase === 'idle' &&
    prev.machine?.id &&
    (!next.machine || String(next.machine.id) === String(prev.machine.id))
  ) {
    return prev;
  }

  if (prevPhase === 'stopping' && (nextPhase === 'opening' || nextPhase === 'running')) {
    return prev;
  }

  return next;
}

export function mergeBillingSessionViewOnPoll(prev, next) {
  if (!next) return next;
  if (!prev) return next;

  const prevRemaining = pickBillingRemainingHours(prev);
  const nextRemaining = pickBillingRemainingHours(next);
  if (prevRemaining == null || nextRemaining == null) return next;

  const hadBillableSession =
    Boolean(prev.billingStarted) ||
    Number(prev.sessionDurationSeconds ?? 0) > 0 ||
    prev.phase === 'running' ||
    prev.phase === 'stopping' ||
    prev.phase === 'disconnected' ||
    prev.phase === 'opening';

  if (
    hadBillableSession &&
    nextRemaining > prevRemaining + REMAINING_REGRESSION_EPSILON_HOURS
  ) {
    return {
      ...next,
      planCardRemainingHours: prev.planCardRemainingHours ?? prevRemaining,
      remainingHours: prev.remainingHours ?? prevRemaining,
    };
  }

  return next;
}
