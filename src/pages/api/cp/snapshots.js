import { getAuthUserFromRequest, unauthorized } from '@/lib/api-auth';
import { getSupabaseAdmin } from '@/lib/supabase-admin';
import {
  listProjectSnapshots,
  restoreProjectSnapshot,
  saveProjectSnapshot,
} from '@/lib/cp-runtime/project-snapshot';
import { toWorkflowClientSyncPayload } from '@/lib/cp-runtime/workflow-sot';

/**
 * B2.2.5 — Project Snapshot Save / list / restore
 * GET  /api/cp/snapshots?projectId=
 * POST /api/cp/snapshots { action: 'save'|'restore', ... }
 */
export default async function handler(req, res) {
  const user = await getAuthUserFromRequest(req);
  if (!user) return unauthorized(res);

  const supabaseAdmin = getSupabaseAdmin();

  try {
    if (req.method === 'GET') {
      const projectId = String(req.query?.projectId ?? '').trim();
      if (!projectId) return res.status(400).json({ error: 'Thiếu projectId.' });
      const snapshots = await listProjectSnapshots(supabaseAdmin, user.id, projectId, {
        limit: Number(req.query?.limit ?? 20),
      });
      return res.status(200).json({
        snapshots: snapshots.map((s) => ({
          id: s.id,
          projectId: s.project_id,
          workflowId: s.cp_workflow_id,
          label: s.label,
          revision: s.revision,
          createdAt: s.created_at,
        })),
      });
    }

    if (req.method === 'POST') {
      const body = req.body && typeof req.body === 'object' ? req.body : {};
      const action = String(body.action ?? 'save').trim();

      if (action === 'save') {
        const snap = await saveProjectSnapshot(supabaseAdmin, {
          userId: user.id,
          projectId: body.projectId,
          cpWorkflowId: body.workflowId ?? body.cpWorkflowId,
          label: body.label,
        });
        return res.status(201).json({
          snapshot: {
            id: snap.id,
            projectId: snap.project_id,
            workflowId: snap.cp_workflow_id,
            label: snap.label,
            revision: snap.revision,
            createdAt: snap.created_at,
          },
        });
      }

      if (action === 'restore') {
        const result = await restoreProjectSnapshot(supabaseAdmin, {
          userId: user.id,
          snapshotId: body.snapshotId,
          targetWorkflowId: body.targetWorkflowId ?? null,
        });
        return res.status(200).json({
          snapshotId: result.snapshot.id,
          workflow: toWorkflowClientSyncPayload(result.workflow),
        });
      }

      return res.status(400).json({ error: 'action phải là save hoặc restore.' });
    }

    return res.status(405).json({ error: 'Method not allowed' });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (/does not exist|PGRST205|42P01/i.test(message)) {
      return res.status(503).json({
        error: 'Project snapshots chưa sẵn sàng (cần migration 0046).',
        available: false,
      });
    }
    console.error('[api/cp/snapshots]', message);
    return res.status(500).json({ error: message || 'Lỗi snapshot.' });
  }
}
