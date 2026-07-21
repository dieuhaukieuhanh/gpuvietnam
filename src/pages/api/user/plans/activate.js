import { getAuthUserFromRequest, unauthorized } from '@/lib/api-auth';
import {
  activateInventoryPlan,
  deactivateInventoryPlan,
} from '@/lib/user-plan-inventory';
import { getSupabaseAdmin } from '@/lib/supabase-admin';

export default async function handler(req, res) {
  if (req.method !== 'PUT') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const user = await getAuthUserFromRequest(req);
    if (!user) return unauthorized(res);

    const { inventoryId, action } = req.body ?? {};
    const id = Number(inventoryId);
    if (!Number.isFinite(id)) {
      return res.status(400).json({ error: 'Thiếu inventoryId.' });
    }

    const supabaseAdmin = getSupabaseAdmin();

    if (action === 'deactivate') {
      const result = await deactivateInventoryPlan(supabaseAdmin, user.id, id);
      if (result.error) return res.status(400).json({ error: result.error });
      return res.status(200).json(result);
    }

    const { data: runningSession } = await supabaseAdmin
      .from('gpu_sessions')
      .select('id, status')
      .eq('user_id', user.id)
      .eq('status', 'running')
      .limit(1)
      .maybeSingle();
    if (runningSession) {
      return res.status(409).json({
        error: 'Phiên làm việc đang mở. Vui lòng tắt máy trước khi đổi gói dịch vụ.',
      });
    }

    const result = await activateInventoryPlan(supabaseAdmin, user.id, id);
    if (result.error) return res.status(400).json({ error: result.error });
    return res.status(200).json(result);
  } catch (err) {
    console.error('[user/plans/activate]', err);
    return res.status(500).json({ error: err.message || 'Không đổi được gói đang dùng.' });
  }
}
