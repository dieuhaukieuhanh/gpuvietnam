import { getAuthUserFromRequest, unauthorized } from '@/lib/api-auth';
import { formatCurrency } from '@/lib/gpu-pricing';
import { createPlanRenewTransferRequest } from '@/lib/plan-renew-request';
import { processPlanRenew } from '@/lib/user-plan-inventory';
import { notifyPaymentSuccess } from '@/lib/user-notifications';
import { getSupabaseAdmin } from '@/lib/supabase-admin';

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const user = await getAuthUserFromRequest(req);
    if (!user) return unauthorized(res);

    const { plan, billing, previewOnly, confirmTransfer } = req.body ?? {};
    const supabaseAdmin = getSupabaseAdmin();

    if (confirmTransfer) {
      const transferResult = await createPlanRenewTransferRequest(supabaseAdmin, user.id, {
        plan,
        billing,
      });

      if (transferResult.error) {
        return res.status(400).json({ error: transferResult.error });
      }

      return res.status(200).json({
        success: true,
        alreadyPending: Boolean(transferResult.alreadyPending),
        message: transferResult.alreadyPending
          ? 'Yêu cầu tái tục đang chờ Admin duyệt.'
          : 'Đã gửi yêu cầu tái tục — Admin sẽ duyệt trong 5–15 phút.',
        pending: transferResult.pending,
      });
    }

    const result = await processPlanRenew(supabaseAdmin, user.id, {
      plan,
      billing,
      previewOnly: Boolean(previewOnly),
      isAutoRenew: false,
    });

    if (result.error === 'insufficient') {
      return res.status(402).json(result);
    }

    if (result.error) {
      return res.status(400).json({ error: result.error });
    }

    if (!previewOnly && result.success) {
      await notifyPaymentSuccess(supabaseAdmin, {
        userId: user.id,
        planName: result.quote?.planName,
        amountLabel: formatCurrency(result.quote?.price ?? 0),
      });
    }

    return res.status(200).json(result);
  } catch (err) {
    console.error('[payment/renew]', err);
    return res.status(500).json({ error: err.message || 'Tái tục thất bại.' });
  }
}
