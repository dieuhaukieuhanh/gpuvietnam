import { getAuthUserFromRequest, unauthorized } from '@/lib/api-auth';
import { getSupabaseAdmin } from '@/lib/supabase-admin';
import {
  createCpWorkflow,
  getCpWorkflow,
  listCpWorkflows,
  toWorkflowClientSyncPayload,
  upsertCpWorkflowDocument,
} from '@/lib/cp-runtime/workflow-sot';

/**
 * B2.1 — Control Plane Workflow SoT
 * GET  /api/cp/workflows?projectId=&limit=
 * POST /api/cp/workflows  { name, projectId, document, settings }
 * PATCH /api/cp/workflows { workflowId, document, settings, name, status }
 */
export default async function handler(req, res) {
  const user = await getAuthUserFromRequest(req);
  if (!user) return unauthorized(res);

  const supabaseAdmin = getSupabaseAdmin();

  try {
    if (req.method === 'GET') {
      const workflowId = req.query?.id ? String(req.query.id) : '';
      if (workflowId) {
        const row = await getCpWorkflow(supabaseAdmin, user.id, workflowId);
        if (!row) return res.status(404).json({ error: 'Không tìm thấy workflow.' });
        return res.status(200).json({ workflow: toWorkflowClientSyncPayload(row) });
      }
      const rows = await listCpWorkflows(supabaseAdmin, user.id, {
        projectId: req.query?.projectId ? String(req.query.projectId) : null,
        limit: Number(req.query?.limit ?? 20),
      });
      return res.status(200).json({
        workflows: rows.map((r) => ({
          id: r.id,
          projectId: r.project_id,
          name: r.name,
          revision: r.revision,
          status: r.status,
          updatedAt: r.updated_at,
          createdAt: r.created_at,
        })),
      });
    }

    if (req.method === 'POST') {
      const body = req.body && typeof req.body === 'object' ? req.body : {};
      const row = await createCpWorkflow(supabaseAdmin, {
        userId: user.id,
        projectId: body.projectId ?? null,
        cpSessionId: body.cpSessionId ?? null,
        name: body.name,
        document: body.document,
        settings: body.settings,
        status: body.status,
        metadata: body.metadata,
      });
      return res.status(201).json({ workflow: toWorkflowClientSyncPayload(row) });
    }

    if (req.method === 'PATCH') {
      const body = req.body && typeof req.body === 'object' ? req.body : {};
      const workflowId = String(body.workflowId ?? body.id ?? '').trim();
      if (!workflowId) return res.status(400).json({ error: 'Thiếu workflowId.' });
      const row = await upsertCpWorkflowDocument(supabaseAdmin, {
        workflowId,
        userId: user.id,
        name: body.name,
        document: body.document,
        settings: body.settings,
        status: body.status,
        metadata: body.metadata,
      });
      return res.status(200).json({ workflow: toWorkflowClientSyncPayload(row) });
    }

    return res.status(405).json({ error: 'Method not allowed' });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (/does not exist|PGRST205|42P01/i.test(message)) {
      return res.status(503).json({
        error: 'CP workflows chưa sẵn sàng (cần migration 0046).',
        available: false,
      });
    }
    console.error('[api/cp/workflows]', message);
    return res.status(500).json({ error: message || 'Lỗi workflow CP.' });
  }
}
