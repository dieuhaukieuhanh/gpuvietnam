/**
 * Session Restore view-model (B2.2) — Session Restore ≠ Job Resume.
 */

/**
 * Build UX payload after GPU change / failover.
 *
 * @param {{
 *   project?: { id: string; name?: string } | null;
 *   workflow?: { id: string; name?: string; revision?: number } | null;
 *   snapshot?: { id: string; label?: string; created_at?: string } | null;
 *   job?: {
 *     id: string;
 *     status?: string;
 *     attemptNumber?: number | null;
 *     uiStatus?: string;
 *   } | null;
 *   runtime?: {
 *     id?: string | null;
 *     status?: string | null;
 *     rebinding?: boolean;
 *   } | null;
 *   message?: string | null;
 * }} input
 */
export function buildSessionRestoreViewModel(input = {}) {
  const project = input.project ?? null;
  const workflow = input.workflow ?? null;
  const snapshot = input.snapshot ?? null;
  const job = input.job ?? null;
  const runtime = input.runtime ?? null;

  const attemptNumber = Number(job?.attemptNumber ?? 0) || null;
  const jobRerunning =
    Boolean(job) &&
    (String(job?.uiStatus ?? '') === 'retry' ||
      (attemptNumber != null && attemptNumber > 1 && ['running', 'queued'].includes(String(job?.status ?? ''))));

  const defaultMessage = (() => {
    if (!project && !workflow) {
      return 'Chưa có Project/Workflow trên Control Plane để khôi phục.';
    }
    if (jobRerunning) {
      return `Project vẫn còn trên web. Job đang chạy lại trên máy mới (Attempt #${attemptNumber}) — không resume CUDA từ máy cũ.`;
    }
    if (runtime?.rebinding) {
      return 'Project/Workflow đã khôi phục. Đang gắn lại địa chỉ làm việc (work.*) tới Runtime mới.';
    }
    return 'Project và Workflow vẫn còn trên Control Plane. Mở lại Comfy trên máy mới sẽ khôi phục graph đã đồng bộ — không cần bắt đầu lại từ đầu.';
  })();

  return {
    schema: 'cp.session_restore.v1',
    restoreKind: 'session', // never 'job_cuda_resume'
    projectContinues: Boolean(project || workflow),
    jobResumed: false, // architecture invariant
    jobRerunning,
    project: project
      ? { id: project.id, name: project.name ?? null }
      : null,
    workflow: workflow
      ? {
          id: workflow.id,
          name: workflow.name ?? null,
          revision: Number(workflow.revision ?? 1),
        }
      : null,
    snapshot: snapshot
      ? {
          id: snapshot.id,
          label: snapshot.label ?? 'Save',
          createdAt: snapshot.created_at ?? null,
        }
      : null,
    job: job
      ? {
          id: job.id,
          status: job.status ?? null,
          uiStatus: job.uiStatus ?? null,
          attemptNumber,
        }
      : null,
    runtime: runtime
      ? {
          id: runtime.id ?? null,
          status: runtime.status ?? null,
          rebinding: Boolean(runtime.rebinding),
        }
      : null,
    message: String(input.message ?? defaultMessage),
  };
}

/**
 * Load restore context for a user (best-effort from CP tables).
 *
 * @param {import('@supabase/supabase-js').SupabaseClient} supabaseAdmin
 * @param {string} userId
 * @param {{ projectId?: string | null; workflowId?: string | null }} [options]
 */
export async function loadSessionRestoreContext(supabaseAdmin, userId, options = {}) {
  const uid = String(userId ?? '').trim();
  if (!uid) throw new Error('userId required');

  let project = null;
  let workflow = null;
  let snapshot = null;
  let job = null;

  if (options.projectId) {
    const { data } = await supabaseAdmin
      .from('projects')
      .select('id, name')
      .eq('id', String(options.projectId))
      .eq('user_id', uid)
      .maybeSingle();
    project = data;
  } else {
    const { data } = await supabaseAdmin
      .from('projects')
      .select('id, name')
      .eq('user_id', uid)
      .eq('status', 'active')
      .order('updated_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    project = data;
  }

  if (options.workflowId) {
    const { data } = await supabaseAdmin
      .from('cp_workflows')
      .select('id, name, revision, project_id')
      .eq('id', String(options.workflowId))
      .eq('user_id', uid)
      .maybeSingle();
    workflow = data;
  } else if (project?.id) {
    const { data } = await supabaseAdmin
      .from('cp_workflows')
      .select('id, name, revision, project_id')
      .eq('user_id', uid)
      .eq('project_id', project.id)
      .order('updated_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    workflow = data;
  }

  if (project?.id) {
    const { data } = await supabaseAdmin
      .from('project_snapshots')
      .select('id, label, created_at')
      .eq('user_id', uid)
      .eq('project_id', project.id)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    snapshot = data;
  }

  const { data: jobRow } = await supabaseAdmin
    .from('jobs')
    .select('id, status, created_at')
    .eq('user_id', uid)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (jobRow) {
    const { data: attempts } = await supabaseAdmin
      .from('job_attempts')
      .select('attempt_number, status')
      .eq('job_id', jobRow.id)
      .order('attempt_number', { ascending: false })
      .limit(1);
    const latest = Array.isArray(attempts) ? attempts[0] : null;
    job = {
      id: jobRow.id,
      status: jobRow.status,
      attemptNumber: latest ? Number(latest.attempt_number) : null,
      uiStatus:
        latest && Number(latest.attempt_number) > 1 && ['running', 'provisioning', 'submitting'].includes(String(latest.status))
          ? 'retry'
          : jobRow.status,
    };
  }

  return buildSessionRestoreViewModel({ project, workflow, snapshot, job });
}
