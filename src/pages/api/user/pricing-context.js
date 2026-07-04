import { getAuthUserFromRequest, unauthorized } from '@/lib/api-auth';
import { isReturningGpuCustomer } from '@/lib/customer-eligibility';
import { getSupabaseAdmin } from '@/lib/supabase-admin';

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const user = await getAuthUserFromRequest(req);
    if (!user) {
      return res.status(200).json({
        isLoggedIn: false,
        isReturningCustomer: false,
        eligibleForTrial: true,
        walletBalance: 0,
      });
    }

    const supabaseAdmin = getSupabaseAdmin();

    const [{ data: profile }, isReturningCustomer] = await Promise.all([
      supabaseAdmin.from('users').select('wallet_balance').eq('id', user.id).maybeSingle(),
      isReturningGpuCustomer(supabaseAdmin, user.id),
    ]);

    return res.status(200).json({
      isLoggedIn: true,
      isReturningCustomer,
      eligibleForTrial: !isReturningCustomer,
      walletBalance: Number(profile?.wallet_balance ?? 0),
    });
  } catch (err) {
    console.error('[user/pricing-context]', err);
    return res.status(500).json({ error: err.message || 'Không tải được thông tin bảng giá.' });
  }
}
