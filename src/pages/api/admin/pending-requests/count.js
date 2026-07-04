import { requireAdmin } from '@/lib/admin-auth';
import { fetchPendingRequestsCount } from '@/lib/admin-pending-requests';
import { getSupabaseAdmin } from '@/lib/supabase-admin';

/**
 * GET — Số lượng yêu cầu pending (badge tab Admin).
 * Auth: Bearer (role=admin) hoặc x-admin-secret
 */
export default async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  if (!(await requireAdmin(req, res))) return;

  try {
    const supabaseAdmin = getSupabaseAdmin();
    const count = await fetchPendingRequestsCount(supabaseAdmin);
    return res.status(200).json({ count });
  } catch (err) {
    return res.status(500).json({ error: err.message || 'Không đếm được yêu cầu.' });
  }
}
