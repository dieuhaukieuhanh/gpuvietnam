/**
 * Dashboard display helpers for Control Plane Job / Attempt (B1.8).
 * Spec: docs/architecture/B1_8_DASHBOARD_JOBS.md
 */

/** @typedef {'queued' | 'running' | 'retry' | 'succeeded' | 'failed' | 'cancelled'} JobUiStatusKey */

const JOB_UI_LABELS = Object.freeze({
  queued: 'Đang chờ',
  running: 'Đang chạy',
  retry: 'Đang chạy lại',
  succeeded: 'Thành công',
  failed: 'Thất bại',
  cancelled: 'Đã hủy',
});

const ACTIVE_ATTEMPT = new Set([
  'pending',
  'provisioning',
  'submitting',
  'running',
]);

/**
 * @param {string | null | undefined} key
 * @returns {string}
 */
export function jobUiStatusLabel(key) {
  const k = String(key ?? '').trim();
  return JOB_UI_LABELS[/** @type {keyof typeof JOB_UI_LABELS} */ (k)] ?? (k || '—');
}

/**
 * @param {string | null | undefined} key
 * @returns {string} CSS modifier suffix
 */
export function jobUiStatusBadgeClass(key) {
  switch (String(key ?? '')) {
    case 'queued':
      return 'job-badge-queued';
    case 'running':
      return 'job-badge-running';
    case 'retry':
      return 'job-badge-retry';
    case 'succeeded':
      return 'job-badge-succeeded';
    case 'failed':
      return 'job-badge-failed';
    case 'cancelled':
      return 'job-badge-cancelled';
    default:
      return 'job-badge-queued';
  }
}

/**
 * Resolve a single UI status for a Job given its attempts.
 * "retry" = active Attempt with attempt_number > 1 (failover re-run).
 *
 * @param {{ status?: string | null }} job
 * @param {Array<{ attempt_number?: number; attemptNumber?: number; status?: string | null }>} [attempts]
 * @returns {JobUiStatusKey}
 */
export function resolveJobUiStatus(job, attempts = []) {
  const jobStatus = String(job?.status ?? '').trim().toLowerCase();
  const list = Array.isArray(attempts) ? attempts : [];

  const sorted = [...list].sort(
    (a, b) =>
      Number(a.attempt_number ?? a.attemptNumber ?? 0) -
      Number(b.attempt_number ?? b.attemptNumber ?? 0),
  );
  const latest = sorted[sorted.length - 1] ?? null;
  const latestNum = Number(latest?.attempt_number ?? latest?.attemptNumber ?? 0) || 0;
  const latestStatus = String(latest?.status ?? '').trim().toLowerCase();

  if (latest && latestNum > 1 && ACTIVE_ATTEMPT.has(latestStatus)) {
    return 'retry';
  }

  if (jobStatus === 'cancelled' || latestStatus === 'cancelled') return 'cancelled';
  if (jobStatus === 'succeeded' || latestStatus === 'succeeded') return 'succeeded';
  if (jobStatus === 'failed' && (!latest || latestStatus === 'failed' || latestStatus === 'cancelled')) {
    return 'failed';
  }
  if (
    jobStatus === 'running' ||
    ACTIVE_ATTEMPT.has(latestStatus) ||
    jobStatus === 'queued'
  ) {
    if (jobStatus === 'queued' && !ACTIVE_ATTEMPT.has(latestStatus)) return 'queued';
    if (ACTIVE_ATTEMPT.has(latestStatus) || jobStatus === 'running') return 'running';
    return 'queued';
  }
  if (jobStatus === 'failed') return 'failed';
  return 'queued';
}

/**
 * @param {{
 *   id: string;
 *   status?: string | null;
 *   created_at?: string | null;
 *   updated_at?: string | null;
 *   started_at?: string | null;
 *   finished_at?: string | null;
 *   error_message?: string | null;
 *   required_image_spec_ref?: string | null;
 * }} job
 * @param {Array<{
 *   id?: string;
 *   job_id?: string;
 *   attempt_number?: number;
 *   status?: string | null;
 *   error_message?: string | null;
 *   external_prompt_id?: string | null;
 *   created_at?: string | null;
 *   finished_at?: string | null;
 * }>} attempts
 */
export function buildJobListItemViewModel(job, attempts = []) {
  const all = Array.isArray(attempts) ? attempts : [];
  const scoped = all.some((a) => a.job_id != null)
    ? all.filter((a) => String(a.job_id) === String(job.id))
    : all;

  const sorted = [...scoped].sort(
    (a, b) => Number(a.attempt_number ?? 0) - Number(b.attempt_number ?? 0),
  );
  const latest = sorted[sorted.length - 1] ?? null;
  const uiStatus = resolveJobUiStatus(job, sorted);
  const attemptNumber = Number(latest?.attempt_number ?? 0) || null;

  return {
    id: String(job.id),
    status: String(job.status ?? 'queued'),
    uiStatus,
    uiLabel: jobUiStatusLabel(uiStatus),
    badgeClass: jobUiStatusBadgeClass(uiStatus),
    attemptNumber,
    attemptStatus: latest ? String(latest.status ?? '') : null,
    attemptCount: sorted.length,
    errorMessage: String(job.error_message ?? latest?.error_message ?? '') || null,
    imageSpecRef: job.required_image_spec_ref ?? null,
    createdAt: job.created_at ?? null,
    updatedAt: job.updated_at ?? null,
    startedAt: job.started_at ?? null,
    finishedAt: job.finished_at ?? null,
  };
}

/**
 * @param {Array<object>} jobs
 * @param {Array<object>} attempts
 */
export function buildJobListViewModels(jobs, attempts) {
  const byJob = new Map();
  for (const a of Array.isArray(attempts) ? attempts : []) {
    const jid = String(a.job_id ?? '');
    if (!jid) continue;
    if (!byJob.has(jid)) byJob.set(jid, []);
    byJob.get(jid).push(a);
  }
  return (Array.isArray(jobs) ? jobs : []).map((job) =>
    buildJobListItemViewModel(job, byJob.get(String(job.id)) ?? []),
  );
}

/**
 * @param {unknown} error
 */
export function isMissingCpJobsRelation(error) {
  const msg = String(
    (error && typeof error === 'object' && 'message' in error
      ? /** @type {{ message?: string }} */ (error).message
      : error) ?? '',
  ).toLowerCase();
  const code = String(
    error && typeof error === 'object' && 'code' in error
      ? /** @type {{ code?: string }} */ (error).code
      : '',
  );
  return (
    code === '42P01' ||
    code === 'PGRST205' ||
    msg.includes('does not exist') ||
    msg.includes('could not find the table')
  );
}
