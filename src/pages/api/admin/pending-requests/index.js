import { requireAdmin } from '@/lib/admin-auth';
import {
  fetchMergedPendingRequests,
  fetchRecentProcessedRequests,
} from '@/lib/admin-pending-requests';
import { getSupabaseAdmin } from '@/lib/supabase-admin';

/**
 * GET — Tất cả yêu cầu pending (gói GPU + nâng cấp bộ nhớ) + đã xử lý gần đây.
 * Auth: Bearer (role=admin) hoặc x-admin-secret
 */
export default async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  if (!(await requireAdmin(req, res))) return;

  try {
    const supabaseAdmin = getSupabaseAdmin();
    const [{ items, count }, recent] = await Promise.all([
      fetchMergedPendingRequests(supabaseAdmin),
      fetchRecentProcessedRequests(supabaseAdmin),
    ]);

    return res.status(200).json({ items, count, recent });
  } catch (err) {
    return res.status(500).json({ error: err.message || 'Không tải được danh sách.' });
  }
}
