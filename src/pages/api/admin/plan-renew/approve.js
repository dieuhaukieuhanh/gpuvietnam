import { requireAdmin } from '@/lib/admin-auth';
import { approvePlanRenewRequest } from '@/lib/plan-renew-request';
import { getSupabaseAdmin } from '@/lib/supabase-admin';

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  if (!(await requireAdmin(req, res))) return;

  try {
    const { requestId } = req.body ?? {};
    if (!requestId) {
      return res.status(400).json({ error: 'Thiếu requestId.' });
    }

    const supabaseAdmin = getSupabaseAdmin();
    const result = await approvePlanRenewRequest(supabaseAdmin, requestId);

    if (result.error) {
      return res.status(400).json({ error: result.error });
    }

    return res.status(200).json({
      success: true,
      message: `Đã duyệt tái tục — cộng ${result.hoursAdded}h vào gói.`,
      hoursAdded: result.hoursAdded,
    });
  } catch (err) {
    console.error('[admin/plan-renew/approve]', err);
    return res.status(500).json({ error: err.message || 'Duyệt tái tục thất bại.' });
  }
}
