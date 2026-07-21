/**
 * Control Plane Workflow SoT (B2.1).
 * Table: cp_workflows (not catalog public.workflows).
 */

/**
 * @param {import('@supabase/supabase-js').SupabaseClient} supabaseAdmin
 * @param {{
 *   userId: string;
 *   projectId?: string | null;
 *   cpSessionId?: string | null;
 *   name?: string;
 *   document?: Record<string, unknown>;
 *   settings?: Record<string, unknown>;
 *   status?: 'draft' | 'ready' | 'archived';
 *   metadata?: Record<string, unknown>;
 * }} input
 */
export async function createCpWorkflow(supabaseAdmin, input) {
  const userId = String(input.userId ?? '').trim();
  if (!userId) throw new Error('createCpWorkflow: userId required');

  const row = {
    user_id: userId,
    project_id: input.projectId ?? null,
    cp_session_id: input.cpSessionId ?? null,
    name: String(input.name ?? 'Untitled').trim() || 'Untitled',
    document: input.document && typeof input.document === 'object' ? input.document : {},
    settings: input.settings && typeof input.settings === 'object' ? input.settings : {},
    status: input.status ?? 'draft',
    metadata: input.metadata && typeof input.metadata === 'object' ? input.metadata : {},
    revision: 1,
  };

  const { data, error } = await supabaseAdmin
    .from('cp_workflows')
    .insert(row)
    .select('*')
    .single();

  if (error) throw new Error(error.message || 'createCpWorkflow failed');
  return data;
}

/**
 * Persist graph/settings; bumps revision when document or settings change.
 *
 * @param {import('@supabase/supabase-js').SupabaseClient} supabaseAdmin
 * @param {{
 *   workflowId: string;
 *   userId: string;
 *   name?: string;
 *   document?: Record<string, unknown>;
 *   settings?: Record<string, unknown>;
 *   status?: 'draft' | 'ready' | 'archived';
 *   metadata?: Record<string, unknown>;
 * }} input
 */
export async function upsertCpWorkflowDocument(supabaseAdmin, input) {
  const workflowId = String(input.workflowId ?? '').trim();
  const userId = String(input.userId ?? '').trim();
  if (!workflowId || !userId) throw new Error('upsertCpWorkflowDocument: ids required');

  const { data: existing, error: loadErr } = await supabaseAdmin
    .from('cp_workflows')
    .select('*')
    .eq('id', workflowId)
    .eq('user_id', userId)
    .maybeSingle();

  if (loadErr) throw new Error(loadErr.message || 'load workflow failed');
  if (!existing) throw new Error('Workflow not found');

  const nextDoc =
    input.document && typeof input.document === 'object' ? input.document : existing.document;
  const nextSettings =
    input.settings && typeof input.settings === 'object' ? input.settings : existing.settings;

  const docChanged = JSON.stringify(nextDoc) !== JSON.stringify(existing.document);
  const settingsChanged = JSON.stringify(nextSettings) !== JSON.stringify(existing.settings);
  const revision =
    docChanged || settingsChanged
      ? Number(existing.revision ?? 1) + 1
      : Number(existing.revision ?? 1);

  /** @type {Record<string, unknown>} */
  const patch = {
    document: nextDoc,
    settings: nextSettings,
    revision,
    updated_at: new Date().toISOString(),
  };
  if (input.name != null) patch.name = String(input.name).trim() || existing.name;
  if (input.status != null) patch.status = input.status;
  if (input.metadata && typeof input.metadata === 'object') patch.metadata = input.metadata;

  const { data, error } = await supabaseAdmin
    .from('cp_workflows')
    .update(patch)
    .eq('id', workflowId)
    .eq('user_id', userId)
    .select('*')
    .single();

  if (error) throw new Error(error.message || 'upsertCpWorkflowDocument failed');
  return data;
}

/**
 * @param {import('@supabase/supabase-js').SupabaseClient} supabaseAdmin
 * @param {string} userId
 * @param {string} workflowId
 */
export async function getCpWorkflow(supabaseAdmin, userId, workflowId) {
  const { data, error } = await supabaseAdmin
    .from('cp_workflows')
    .select('*')
    .eq('id', String(workflowId))
    .eq('user_id', String(userId))
    .maybeSingle();
  if (error) throw new Error(error.message || 'getCpWorkflow failed');
  return data;
}

/**
 * @param {import('@supabase/supabase-js').SupabaseClient} supabaseAdmin
 * @param {string} userId
 * @param {{ projectId?: string | null; limit?: number }} [options]
 */
export async function listCpWorkflows(supabaseAdmin, userId, options = {}) {
  const limit = Math.min(50, Math.max(1, Number(options.limit ?? 20) || 20));
  let q = supabaseAdmin
    .from('cp_workflows')
    .select(
      'id, user_id, project_id, cp_session_id, name, revision, status, updated_at, created_at',
    )
    .eq('user_id', String(userId))
    .order('updated_at', { ascending: false })
    .limit(limit);

  if (options.projectId) {
    q = q.eq('project_id', String(options.projectId));
  }

  const { data, error } = await q;
  if (error) throw new Error(error.message || 'listCpWorkflows failed');
  return Array.isArray(data) ? data : [];
}

/**
 * Pure helper: sync payload for client editors (no GPU dependency).
 * @param {object} workflow
 */
export function toWorkflowClientSyncPayload(workflow) {
  return {
    id: workflow.id,
    projectId: workflow.project_id ?? null,
    name: workflow.name,
    document: workflow.document ?? {},
    settings: workflow.settings ?? {},
    revision: Number(workflow.revision ?? 1),
    status: workflow.status,
    updatedAt: workflow.updated_at ?? null,
  };
}
