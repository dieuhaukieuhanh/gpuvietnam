import { requireAdmin } from '@/lib/admin-auth';
import { rejectWalletDeposit } from '@/lib/wallet-deposit';
import { notifyWalletDepositRejected } from '@/lib/user-notifications';
import { getSupabaseAdmin } from '@/lib/supabase-admin';

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  if (!(await requireAdmin(req, res))) return;

  try {
    const { transactionId, reason } = req.body ?? {};
    if (!transactionId) {
      return res.status(400).json({ error: 'Thiếu transactionId.' });
    }

    const supabaseAdmin = getSupabaseAdmin();
    const result = await rejectWalletDeposit(supabaseAdmin, transactionId, reason);

    if (result.error) {
      return res.status(404).json({ error: result.error });
    }

    await notifyWalletDepositRejected(supabaseAdmin, {
      userId: result.userId,
      amount: result.amount,
    });

    return res.status(200).json({
      success: true,
      transaction: result.transaction,
      message: 'Đã từ chối yêu cầu nạp Ví.',
    });
  } catch (err) {
    console.error('[admin/wallet-deposits/reject]', err);
    return res.status(500).json({ error: err.message || 'Từ chối nạp Ví thất bại.' });
  }
}
