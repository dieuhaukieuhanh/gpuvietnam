import { getAuthUserFromRequest, unauthorized } from '@/lib/api-auth';
import {
  normalizeGpuPurchaseInput,
  purchaseGpuPlanWithWallet,
} from '@/lib/gpu-subscription-purchase';
import { formatCurrency } from '@/lib/gpu-pricing';
import { notifyPaymentSuccess } from '@/lib/user-notifications';
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
    const result = await purchaseGpuPlanWithWallet(supabaseAdmin, user.id, input);

    if (!result.ok) {
      return res.status(result.code === 'insufficient_balance' ? 402 : 400).json({
        error: result.error,
        code: result.code,
      });
    }

    await notifyPaymentSuccess(supabaseAdmin, {
      userId: user.id,
      planName: input.plan,
      amountLabel: formatCurrency(result.amountCharged ?? 0),
    });

    return res.status(200).json({
      success: true,
      subscription: result.subscription,
      walletBalance: result.walletBalance,
      amountCharged: result.amountCharged,
      plan: input.plan,
      message: `Thanh toán ví thành công. Gói ${input.plan} đang được kích hoạt.`,
    });
  } catch (err) {
    console.error('[payment/pay-wallet]', err);
    return res.status(500).json({ error: err.message || 'Thanh toán ví thất bại.' });
  }
}
