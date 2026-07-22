import { getAuthUserFromRequest, unauthorized } from '@/lib/api-auth';
import { getSupabaseAdmin } from '@/lib/supabase-admin';
import { COMFY_ACCESS_TOKEN_PREFIX, resolveComfyAccessToken } from '@/lib/comfy-proxy';
import { ensureActiveCpWorkflow } from '@/lib/cp-runtime/ensure-active-workflow';
import {
  normalizeCpWorkflowDocument,
  shouldRejectEmptyDocumentOverwrite,
  toComfySyncPayload,
} from '@/lib/cp-runtime/comfy-graph-document';
import {
  getCpWorkflow,
  toWorkflowClientSyncPayload,
  upsertCpWorkflowDocument,
} from '@/lib/cp-runtime/workflow-sot';

/**
 * Comfy ↔ CP sync (editor document).
 *
 * Auth (either):
 *   - Bearer supabase access token (dashboard)
 *   - Bearer gvc.* Comfy access token (extension via Worker / direct)
 *
 * GET  /api/cp/comfy-sync?workflowId=
 * PATCH /api/cp/comfy-sync { workflowId?, document, settings?, expectedRevision?, name? }
 */
export default async function handler(req, res) {
  const auth = await resolveComfySyncAuth(req);
  if (!auth) return unauthorized(res);

  const supabaseAdmin = getSupabaseAdmin();

  try {
    if (req.method === 'GET') {
      const preferredId = req.query?.workflowId ? String(req.query.workflowId) : '';
      const workflow = await ensureActiveCpWorkflow(supabaseAdmin, auth.userId, {
        workflowId: preferredId || null,
      });
      return res.status(200).json({
        ok: true,
        workflow: toComfySyncPayload(workflow, { machineId: auth.machineId }),
      });
    }

    if (req.method === 'PATCH' || req.method === 'POST') {
      const body = req.body && typeof req.body === 'object' ? req.body : {};
      const preferredId = String(body.workflowId ?? body.id ?? req.query?.workflowId ?? '').trim();
      const ensured = await ensureActiveCpWorkflow(supabaseAdmin, auth.userId, {
        workflowId: preferredId || null,
      });

      if (body.document === undefined && body.settings === undefined && body.name === undefined) {
        return res.status(400).json({ error: 'Thiếu document/settings để lưu.' });
      }

      const inboundDocument =
        body.document !== undefined ? normalizeCpWorkflowDocument(body.document) : undefined;
      if (
        inboundDocument !== undefined &&
        shouldRejectEmptyDocumentOverwrite(ensured.document, inboundDocument)
      ) {
        // No-op: keep SoT; do not bump revision. Extension may race with empty canvas at boot.
        return res.status(200).json({
          ok: true,
          skipped: 'empty_document_overwrite',
          workflow: toComfySyncPayload(ensured, { machineId: auth.machineId }),
          client: toWorkflowClientSyncPayload(ensured),
        });
      }

      try {
        const row = await upsertCpWorkflowDocument(supabaseAdmin, {
          workflowId: ensured.id,
          userId: auth.userId,
          name: body.name,
          document: inboundDocument,
          settings: body.settings,
          status: body.status,
          metadata: body.metadata,
          expectedRevision:
            body.expectedRevision != null ? Number(body.expectedRevision) : null,
        });
        return res.status(200).json({
          ok: true,
          workflow: toComfySyncPayload(row, { machineId: auth.machineId }),
          client: toWorkflowClientSyncPayload(row),
        });
      } catch (error) {
        if (error?.code === 'REVISION_CONFLICT') {
          const current =
            error.workflow ||
            (await getCpWorkflow(supabaseAdmin, auth.userId, ensured.id));
          return res.status(409).json({
            ok: false,
            code: 'REVISION_CONFLICT',
            error: 'Workflow đã được cập nhật nơi khác. Tải lại từ Control Plane.',
            workflow: current
              ? toComfySyncPayload(current, { machineId: auth.machineId })
              : null,
          });
        }
        throw error;
      }
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
    console.error('[api/cp/comfy-sync]', message);
    return res.status(500).json({ error: message || 'Lỗi Comfy sync.' });
  }
}

/**
 * @param {import('next').NextApiRequest} req
 * @returns {Promise<{ userId: string; machineId: string | null; authKind: 'supabase' | 'comfy' } | null>}
 */
async function resolveComfySyncAuth(req) {
  const authHeader = String(req.headers.authorization ?? '');
  const bearer = authHeader.replace(/^Bearer\s+/i, '').trim();
  if (!bearer) return null;

  if (bearer.startsWith(COMFY_ACCESS_TOKEN_PREFIX)) {
    const supabaseAdmin = getSupabaseAdmin();
    const resolved = await resolveComfyAccessToken(supabaseAdmin, bearer);
    if (!resolved) return null;
    return {
      userId: resolved.userId,
      machineId: resolved.machineId,
      authKind: 'comfy',
    };
  }

  const user = await getAuthUserFromRequest(req);
  if (!user) return null;
  return { userId: user.id, machineId: null, authKind: 'supabase' };
}
