import { requireAdmin } from '@/lib/admin-auth';
import { rejectPlanRenewRequest } from '@/lib/plan-renew-request';
import { getSupabaseAdmin } from '@/lib/supabase-admin';

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  if (!(await requireAdmin(req, res))) return;

  try {
    const { requestId, reason } = req.body ?? {};
    if (!requestId) {
      return res.status(400).json({ error: 'Thiếu requestId.' });
    }

    const supabaseAdmin = getSupabaseAdmin();
    const result = await rejectPlanRenewRequest(supabaseAdmin, requestId, reason);

    if (result.error) {
      return res.status(404).json({ error: result.error });
    }

    return res.status(200).json({
      success: true,
      message: 'Đã từ chối yêu cầu tái tục.',
    });
  } catch (err) {
    console.error('[admin/plan-renew/reject]', err);
    return res.status(500).json({ error: err.message || 'Từ chối tái tục thất bại.' });
  }
}
