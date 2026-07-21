/**
 * Project Snapshot Save / Restore (B2.2.5).
 */

import { upsertCpWorkflowDocument } from './workflow-sot.js';

/**
 * @param {import('@supabase/supabase-js').SupabaseClient} supabaseAdmin
 * @param {{
 *   userId: string;
 *   projectId: string;
 *   cpWorkflowId: string;
 *   label?: string;
 * }} input
 */
export async function saveProjectSnapshot(supabaseAdmin, input) {
  const userId = String(input.userId ?? '').trim();
  const projectId = String(input.projectId ?? '').trim();
  const cpWorkflowId = String(input.cpWorkflowId ?? '').trim();
  if (!userId || !projectId || !cpWorkflowId) {
    throw new Error('saveProjectSnapshot: userId, projectId, cpWorkflowId required');
  }

  const { data: workflow, error: wfErr } = await supabaseAdmin
    .from('cp_workflows')
    .select('*')
    .eq('id', cpWorkflowId)
    .eq('user_id', userId)
    .maybeSingle();
  if (wfErr) throw new Error(wfErr.message || 'load workflow failed');
  if (!workflow) throw new Error('Workflow not found');

  const { data: project, error: pErr } = await supabaseAdmin
    .from('projects')
    .select('id, name, metadata')
    .eq('id', projectId)
    .eq('user_id', userId)
    .maybeSingle();
  if (pErr) throw new Error(pErr.message || 'load project failed');
  if (!project) throw new Error('Project not found');

  const row = {
    user_id: userId,
    project_id: projectId,
    cp_workflow_id: cpWorkflowId,
    label: String(input.label ?? 'Save').trim() || 'Save',
    workflow_document: workflow.document ?? {},
    workflow_settings: workflow.settings ?? {},
    project_metadata: {
      name: project.name,
      ...(project.metadata && typeof project.metadata === 'object' ? project.metadata : {}),
    },
    revision: Number(workflow.revision ?? 1),
  };

  const { data, error } = await supabaseAdmin
    .from('project_snapshots')
    .insert(row)
    .select('*')
    .single();

  if (error) throw new Error(error.message || 'saveProjectSnapshot failed');
  return data;
}

/**
 * @param {import('@supabase/supabase-js').SupabaseClient} supabaseAdmin
 * @param {string} userId
 * @param {string} projectId
 * @param {{ limit?: number }} [options]
 */
export async function listProjectSnapshots(supabaseAdmin, userId, projectId, options = {}) {
  const limit = Math.min(50, Math.max(1, Number(options.limit ?? 20) || 20));
  const { data, error } = await supabaseAdmin
    .from('project_snapshots')
    .select(
      'id, project_id, cp_workflow_id, label, revision, created_at',
    )
    .eq('user_id', String(userId))
    .eq('project_id', String(projectId))
    .order('created_at', { ascending: false })
    .limit(limit);

  if (error) throw new Error(error.message || 'listProjectSnapshots failed');
  return Array.isArray(data) ? data : [];
}

/**
 * Restore snapshot document onto the linked (or provided) cp_workflow.
 *
 * @param {import('@supabase/supabase-js').SupabaseClient} supabaseAdmin
 * @param {{
 *   userId: string;
 *   snapshotId: string;
 *   targetWorkflowId?: string | null;
 * }} input
 */
export async function restoreProjectSnapshot(supabaseAdmin, input) {
  const userId = String(input.userId ?? '').trim();
  const snapshotId = String(input.snapshotId ?? '').trim();
  if (!userId || !snapshotId) throw new Error('restoreProjectSnapshot: ids required');

  const { data: snap, error } = await supabaseAdmin
    .from('project_snapshots')
    .select('*')
    .eq('id', snapshotId)
    .eq('user_id', userId)
    .maybeSingle();

  if (error) throw new Error(error.message || 'load snapshot failed');
  if (!snap) throw new Error('Snapshot not found');

  const targetWorkflowId = String(
    input.targetWorkflowId ?? snap.cp_workflow_id ?? '',
  ).trim();
  if (!targetWorkflowId) {
    throw new Error('Snapshot has no workflow target');
  }

  const workflow = await upsertCpWorkflowDocument(supabaseAdmin, {
    workflowId: targetWorkflowId,
    userId,
    document:
      snap.workflow_document && typeof snap.workflow_document === 'object'
        ? snap.workflow_document
        : {},
    settings:
      snap.workflow_settings && typeof snap.workflow_settings === 'object'
        ? snap.workflow_settings
        : {},
    metadata: {
      restoredFromSnapshotId: snap.id,
      restoredAt: new Date().toISOString(),
    },
  });

  return { snapshot: snap, workflow };
}
