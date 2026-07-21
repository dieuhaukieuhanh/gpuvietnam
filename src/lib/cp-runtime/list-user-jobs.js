/**
 * Load user Jobs + Attempts for dashboard (B1.8).
 */

import {
  buildJobListViewModels,
  isMissingCpJobsRelation,
} from './job-attempt-display.js';

/**
 * @param {import('@supabase/supabase-js').SupabaseClient} supabaseAdmin
 * @param {string} userId
 * @param {{ limit?: number }} [options]
 * @returns {Promise<{
 *   available: boolean;
 *   items: ReturnType<typeof buildJobListViewModels>;
 *   error: string | null;
 * }>}
 */
export async function listUserJobDashboardItems(supabaseAdmin, userId, options = {}) {
  const uid = String(userId ?? '').trim();
  if (!uid) {
    return { available: true, items: [], error: 'missing userId' };
  }

  const limit = Math.min(50, Math.max(1, Number(options.limit ?? 20) || 20));

  const { data: jobs, error: jobsError } = await supabaseAdmin
    .from('jobs')
    .select(
      'id, status, execution_policy, required_image_spec_ref, error_message, created_at, updated_at, started_at, finished_at',
    )
    .eq('user_id', uid)
    .order('created_at', { ascending: false })
    .limit(limit);

  if (jobsError) {
    if (isMissingCpJobsRelation(jobsError)) {
      return { available: false, items: [], error: null };
    }
    return { available: true, items: [], error: jobsError.message || 'jobs query failed' };
  }

  const list = Array.isArray(jobs) ? jobs : [];
  if (list.length === 0) {
    return { available: true, items: [], error: null };
  }

  const ids = list.map((j) => j.id);
  const { data: attempts, error: attemptsError } = await supabaseAdmin
    .from('job_attempts')
    .select(
      'id, job_id, attempt_number, status, error_message, external_prompt_id, created_at, finished_at',
    )
    .eq('user_id', uid)
    .in('job_id', ids)
    .order('attempt_number', { ascending: true });

  if (attemptsError && !isMissingCpJobsRelation(attemptsError)) {
    return {
      available: true,
      items: buildJobListViewModels(list, []),
      error: attemptsError.message || 'job_attempts query failed',
    };
  }

  return {
    available: true,
    items: buildJobListViewModels(list, Array.isArray(attempts) ? attempts : []),
    error: null,
  };
}
