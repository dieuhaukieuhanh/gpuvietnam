import { getAuthUserFromRequest, unauthorized } from '@/lib/api-auth';
import { getSupabaseAdmin } from '@/lib/supabase-admin';
import { loadSessionRestoreContext } from '@/lib/cp-runtime/session-restore';

/**
 * B2.2 — Session Restore context for dashboard demo / UX.
 * GET /api/cp/session-restore?projectId=&workflowId=
 */
export default async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const user = await getAuthUserFromRequest(req);
  if (!user) return unauthorized(res);

  try {
    const restore = await loadSessionRestoreContext(getSupabaseAdmin(), user.id, {
      projectId: req.query?.projectId ? String(req.query.projectId) : null,
      workflowId: req.query?.workflowId ? String(req.query.workflowId) : null,
    });
    return res.status(200).json({ restore });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (/does not exist|PGRST205|42P01/i.test(message)) {
      return res.status(200).json({
        restore: {
          schema: 'cp.session_restore.v1',
          restoreKind: 'session',
          projectContinues: false,
          jobResumed: false,
          jobRerunning: false,
          project: null,
          workflow: null,
          snapshot: null,
          job: null,
          runtime: null,
          message:
            'Session Restore sẽ hiện sau khi apply migration CP (0043–0046). GPU cũ không còn là SoT bài làm.',
          available: false,
        },
      });
    }
    console.error('[api/cp/session-restore]', message);
    return res.status(500).json({ error: 'Không tải được Session Restore.' });
  }
}
