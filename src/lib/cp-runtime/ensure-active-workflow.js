/**
 * Ensure the user has an active CP workflow to sync Comfy against.
 */

import { createCpWorkflow, listCpWorkflows, getCpWorkflow } from './workflow-sot.js';

/**
 * @param {import('@supabase/supabase-js').SupabaseClient} supabaseAdmin
 * @param {string} userId
 * @param {{
 *   workflowId?: string | null;
 *   projectId?: string | null;
 *   cpSessionId?: string | null;
 *   name?: string;
 * }} [options]
 */
export async function ensureActiveCpWorkflow(supabaseAdmin, userId, options = {}) {
  const uid = String(userId ?? '').trim();
  if (!uid) throw new Error('ensureActiveCpWorkflow: userId required');

  const preferredId = String(options.workflowId ?? '').trim();
  if (preferredId) {
    const existing = await getCpWorkflow(supabaseAdmin, uid, preferredId);
    if (existing) return existing;
  }

  // Prefer latest non-archived workflow for this user (optionally scoped to project).
  const listed = await listCpWorkflows(supabaseAdmin, uid, {
    projectId: options.projectId ?? null,
    limit: 10,
  });
  const draftOrReady = listed.find((w) => w.status !== 'archived') ?? listed[0];
  if (draftOrReady?.id) {
    const full = await getCpWorkflow(supabaseAdmin, uid, draftOrReady.id);
    if (full) return full;
  }

  // Create a project if none — optional; workflow can exist without project.
  let projectId = options.projectId ? String(options.projectId) : null;
  if (!projectId) {
    const { data: project } = await supabaseAdmin
      .from('projects')
      .select('id')
      .eq('user_id', uid)
      .eq('status', 'active')
      .order('updated_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    projectId = project?.id ?? null;
  }

  if (!projectId) {
    const { data: createdProject, error: projectErr } = await supabaseAdmin
      .from('projects')
      .insert({
        user_id: uid,
        name: 'Workspace',
        status: 'active',
      })
      .select('id')
      .single();
    if (!projectErr && createdProject?.id) {
      projectId = createdProject.id;
    }
  }

  return createCpWorkflow(supabaseAdmin, {
    userId: uid,
    projectId,
    cpSessionId: options.cpSessionId ?? null,
    name: options.name ?? 'Comfy session',
    document: {},
    settings: {},
    status: 'draft',
    metadata: { source: 'comfy_sync_ensure' },
  });
}
