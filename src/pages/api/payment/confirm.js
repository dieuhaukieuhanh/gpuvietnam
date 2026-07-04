import { getAuthUserFromRequest, unauthorized } from '@/lib/api-auth';
import {
  assertNoPendingGpuPayment,
  createPendingGpuSubscription,
  normalizeGpuPurchaseInput,
  replaceActiveSubscriptions,
} from '@/lib/gpu-subscription-purchase';
import { getSupabaseAdmin } from '@/lib/supabase-admin';

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const user = await getAuthUserFromRequest(req);
    if (!user) return unauthorized(res);

    const input = normalizeGpuPurchaseInput(req.body ?? {});
    if (input.error) {
      return res.status(400).json({ error: input.error });
    }

    const supabaseAdmin = getSupabaseAdmin();

    const pendingCheck = await assertNoPendingGpuPayment(supabaseAdmin, user.id);
    if (!pendingCheck.ok) {
      return res.status(400).json({
        error: pendingCheck.error,
        code: pendingCheck.code,
      });
    }

    await replaceActiveSubscriptions(supabaseAdmin, user.id);

    const data = await createPendingGpuSubscription(supabaseAdmin, user.id, input);

    return res.status(200).json({
      success: true,
      subscription: data,
      message:
        'Đã ghi nhận yêu cầu thanh toán. Admin sẽ xác nhận trong 5–10 phút sau khi kiểm tra chuyển khoản.',
    });
  } catch (err) {
    console.error('[payment/confirm]', err);
    return res.status(500).json({
      error: err.message || 'Không ghi nhận được thanh toán.',
    });
  }
}
