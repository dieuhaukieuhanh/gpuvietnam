/**
 * RC6 — SES-1 running-session count for Session Domain adapters.
 * Domain expects caller-injected `otherRunningSessionCount` (LIMIT 2 is enough).
 */

import { SESSION_ERROR_CODE } from './session-lifecycle.js';

/** Temporary INFO tag while validating RC6 in production. */
export const RC6_SES1_LOG_TAG = '[RC6-SES1]';

/**
 * Count running sessions for a user, capped at 2 (Domain only needs 0 / 1 / ≥2).
 * @param {import('@supabase/supabase-js').SupabaseClient} supabaseAdmin
 * @param {string} userId
 * @returns {Promise<number>}
 */
export async function countRunningSessionsForUser(supabaseAdmin, userId) {
  const { data, error } = await supabaseAdmin
    .from('gpu_sessions')
    .select('id')
    .eq('user_id', String(userId))
    .eq('status', 'running')
    .limit(2);

  if (error) throw error;
  return Array.isArray(data) ? data.length : 0;
}

/**
 * Load running count once and attach to SessionContext.
 * @param {import('@supabase/supabase-js').SupabaseClient} supabaseAdmin
 * @param {string} userId
 * @param {Record<string, unknown>} baseContext
 * @returns {Promise<{ context: Record<string, unknown>, otherRunningSessionCount: number }>}
 */
export async function withOtherRunningSessionCount(supabaseAdmin, userId, baseContext) {
  const otherRunningSessionCount = await countRunningSessionsForUser(supabaseAdmin, userId);
  return {
    context: { ...baseContext, otherRunningSessionCount },
    otherRunningSessionCount,
  };
}

/**
 * @param {string} command
 * @param {{ state?: string, code?: string, message?: string } | null | undefined} result
 * @param {Record<string, unknown>} [meta]
 */
export function noteIfSes1Blocked(command, result, meta = {}) {
  if (result?.state !== 'ERROR' || result.code !== SESSION_ERROR_CODE.MULTIPLE_RUNNING_SESSIONS) {
    return;
  }
  // Temporary INFO instrumentation (RC6 validation) — do not remove until post-fix flight passes.
  console.info(
    `${RC6_SES1_LOG_TAG} blocked second running session`,
    JSON.stringify({
      command,
      code: result.code,
      message: result.message ?? null,
      ...meta,
    }),
  );
}
