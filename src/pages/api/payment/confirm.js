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

    if (!input.additional) {
      await replaceActiveSubscriptions(supabaseAdmin, user.id);
    }

    const result = await createPendingGpuSubscription(supabaseAdmin, user.id, input);
    const subscription = result?.subscription ?? result;
    const transfer = result?.transfer ?? null;

    return res.status(200).json({
      success: true,
      subscription,
      transfer,
      transferCode: result?.transferCode ?? null,
      amount: result?.amount ?? null,
      message:
        'Đã ghi nhận yêu cầu. Chuyển khoản đúng nội dung (mã GD) — hệ thống tự duyệt trong vài phút.',
    });
  } catch (err) {
    console.error('[payment/confirm]', err);
    return res.status(500).json({
      error: err.message || 'Không ghi nhận được thanh toán.',
    });
  }
}
