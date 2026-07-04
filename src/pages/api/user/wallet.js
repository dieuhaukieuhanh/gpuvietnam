import { getAuthUserFromRequest, unauthorized } from '@/lib/api-auth';
import { createWalletDepositRequest } from '@/lib/wallet-deposit';
import { getSupabaseAdmin } from '@/lib/supabase-admin';

export default async function handler(req, res) {
  if (req.method !== 'GET' && req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const user = await getAuthUserFromRequest(req);
    if (!user) return unauthorized(res);

    const supabaseAdmin = getSupabaseAdmin();

    if (req.method === 'GET') {
      const { data: profile } = await supabaseAdmin
        .from('users')
        .select('wallet_balance')
        .eq('id', user.id)
        .maybeSingle();

      const limit = Math.min(Math.max(Number(req.query.limit) || 5, 1), 100);

      const { data: transactions } = await supabaseAdmin
        .from('wallet_transactions')
        .select('id, type, amount, bonus_amount, balance_after, description, status, created_at')
        .eq('user_id', user.id)
        .order('created_at', { ascending: false })
        .limit(limit);

      return res.status(200).json({
        balance: Number(profile?.wallet_balance ?? 0),
        transactions: transactions ?? [],
      });
    }

    const { amount } = req.body ?? {};
    const result = await createWalletDepositRequest(supabaseAdmin, user.id, amount);

    if (result.error) {
      return res.status(400).json({ error: result.error });
    }

    return res.status(200).json({
      success: true,
      transaction: result.transaction,
      pending: result.pending,
      message: 'Yêu cầu nạp tiền đã được gửi. Admin sẽ duyệt trong 15 phút.',
    });
  } catch (err) {
    return res.status(500).json({ error: err.message || 'Xử lý ví thất bại.' });
  }
}
