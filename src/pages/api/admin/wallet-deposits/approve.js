import { requireAdmin } from '@/lib/admin-auth';
import { approveWalletDeposit } from '@/lib/wallet-deposit';
import { notifyWalletDepositApproved } from '@/lib/user-notifications';
import { getSupabaseAdmin } from '@/lib/supabase-admin';

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  if (!(await requireAdmin(req, res))) return;

  try {
    const { transactionId } = req.body ?? {};
    if (!transactionId) {
      return res.status(400).json({ error: 'Thiếu transactionId.' });
    }

    const supabaseAdmin = getSupabaseAdmin();
    const result = await approveWalletDeposit(supabaseAdmin, transactionId);

    if (result.error) {
      return res.status(404).json({ error: result.error });
    }

    await notifyWalletDepositApproved(supabaseAdmin, {
      userId: result.userId,
      amount: result.amount,
      newBalance: result.newBalance,
    });

    return res.status(200).json({
      success: true,
      transaction: result.transaction,
      message: 'Đã duyệt nạp Ví và cộng tiền cho khách hàng.',
    });
  } catch (err) {
    console.error('[admin/wallet-deposits/approve]', err);
    return res.status(500).json({ error: err.message || 'Duyệt nạp Ví thất bại.' });
  }
}
