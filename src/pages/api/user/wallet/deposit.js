import { getAuthUserFromRequest, unauthorized } from '@/lib/api-auth';
import { createWalletDepositRequest } from '@/lib/wallet-deposit';
import { getSupabaseAdmin } from '@/lib/supabase-admin';

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const user = await getAuthUserFromRequest(req);
    if (!user) return unauthorized(res);

    const { amount } = req.body ?? {};
    const supabaseAdmin = getSupabaseAdmin();
    const result = await createWalletDepositRequest(supabaseAdmin, user.id, amount);

    if (result.error) {
      return res.status(400).json({ error: result.error });
    }

    return res.status(200).json({
      success: true,
      message: 'Yêu cầu nạp tiền đã được gửi. Admin sẽ duyệt trong 15 phút.',
      transaction: result.transaction,
      pending: result.pending,
    });
  } catch (err) {
    console.error('[user/wallet/deposit]', err);
    return res.status(500).json({ error: err.message || 'Nạp ví thất bại.' });
  }
}
