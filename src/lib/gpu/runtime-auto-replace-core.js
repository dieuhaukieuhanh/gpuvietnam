/**
 * P1 Runtime auto-replace — pure policy (node:test friendly).
 *
 * Nên thay máy: đang trong phiên billable OPEN mà GPU chết ngoài ý muốn.
 * Không thay: user đóng / chưa sẵn sàng / không có phiên / hết giờ-hết tiền-policy stop /
 * đang có replace / đã hết retry cho máy chết đó.
 */

export const RUNTIME_REPLACE_UX_MESSAGE =
  'Generate tạm gián đoạn — Phiên vẫn làm việc bình thường';

/** @typedef {{
 *   status?: string|null;
 *   started_at?: string|null;
 *   close_requested_at?: string|null;
 *   ended_at?: string|null;
 * }} RuntimeReplaceSessionView */

/** @typedef {{
 *   userCloseRequested?: boolean;
 *   policyStopRequested?: boolean;
 *   outOfCredit?: boolean;
 *   hasActiveReplaceOp?: boolean;
 *   replaceDeadLetteredForMachine?: boolean;
 *   hasHealthyActiveMachineForSession?: boolean;
 * }} RuntimeReplaceContext */

/**
 * One durable op chain per (user, session, dead machine).
 * New machine death → new oldMachineId → new key (multi-replace in one session).
 * @param {string} userId
 * @param {string} sessionId
 * @param {string} oldMachineId
 */
export function runtimeAutoReplaceIdempotencyKey(userId, sessionId, oldMachineId) {
  return `runtime_auto_replace:${userId}:${sessionId}:${oldMachineId}`;
}

/**
 * Product gate for enqueue + execute.
 * @param {RuntimeReplaceSessionView|null|undefined} session
 * @param {RuntimeReplaceContext} [ctx]
 * @returns {{ allow: boolean, reason: string }}
 */
export function evaluateRuntimeAutoReplaceEligibility(session, ctx = {}) {
  if (!session) {
    return { allow: false, reason: 'no_session' };
  }

  const status = String(session.status ?? '');
  if (status === 'closed' || status === 'pending') {
    return { allow: false, reason: status === 'closed' ? 'session_closed' : 'session_not_ready' };
  }
  if (status !== 'running') {
    return { allow: false, reason: 'session_not_running' };
  }

  if (session.started_at == null || String(session.started_at).trim() === '') {
    return { allow: false, reason: 'session_not_ready' };
  }

  if (session.close_requested_at != null && String(session.close_requested_at).trim() !== '') {
    return { allow: false, reason: 'user_or_policy_close' };
  }

  if (session.ended_at != null && String(session.ended_at).trim() !== '') {
    return { allow: false, reason: 'session_ended' };
  }

  if (ctx.userCloseRequested === true || ctx.policyStopRequested === true) {
    return { allow: false, reason: 'user_or_policy_close' };
  }

  if (ctx.outOfCredit === true) {
    return { allow: false, reason: 'out_of_credit' };
  }

  if (ctx.hasHealthyActiveMachineForSession === true) {
    return { allow: false, reason: 'session_already_has_healthy_machine' };
  }

  if (ctx.hasActiveReplaceOp === true) {
    return { allow: false, reason: 'replace_already_in_flight' };
  }

  if (ctx.replaceDeadLetteredForMachine === true) {
    return { allow: false, reason: 'replace_retries_exhausted' };
  }

  return { allow: true, reason: 'open_billable_runtime_dead' };
}

/**
 * @param {import('@supabase/supabase-js').SupabaseClient} supabaseAdmin
 * @param {string} userId
 */
export async function loadOpenBillableSessionForUser(supabaseAdmin, userId) {
  const { data, error } = await supabaseAdmin
    .from('gpu_sessions')
    .select(
      'id, status, started_at, ended_at, close_requested_at, machine_id, plan, billing, template, gpu_config',
    )
    .eq('user_id', userId)
    .eq('status', 'running')
    .not('started_at', 'is', null)
    .order('started_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  return data;
}
