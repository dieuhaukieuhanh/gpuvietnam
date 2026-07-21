import { getAuthUserFromRequest, unauthorized } from '@/lib/api-auth';
import { listUserJobDashboardItems } from '@/lib/cp-runtime/list-user-jobs';
import { getSupabaseAdmin } from '@/lib/supabase-admin';

/**
 * GET /api/dashboard/jobs — minimal Job/Attempt status for dashboard (B1.8).
 */
export default async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const user = await getAuthUserFromRequest(req);
  if (!user) return unauthorized(res);

  try {
    const limitRaw = Number(req.query?.limit);
    const limit = Number.isFinite(limitRaw) ? limitRaw : 20;
    const result = await listUserJobDashboardItems(getSupabaseAdmin(), user.id, { limit });

    return res.status(200).json({
      available: result.available,
      jobs: result.items,
      error: result.error,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error('[api/dashboard/jobs]', message);
    return res.status(500).json({ error: 'Không tải được danh sách Job.' });
  }
}
