import { requireAdmin } from '@/lib/admin-auth';
import { getSupabaseAdmin } from '@/lib/supabase-admin';
import { listSupportSessionsForAdmin } from '@/lib/support-sessions';

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const admin = await requireAdmin(req, res);
    if (!admin) return undefined;

    const supabaseAdmin = getSupabaseAdmin();
    const sessions = await listSupportSessionsForAdmin(supabaseAdmin);

    return res.status(200).json({
      sessions,
      total: sessions.length,
    });
  } catch (err) {
    console.error('[support/sessions]', err);
    return res.status(500).json({ error: err.message || 'Không tải được danh sách phiên hỗ trợ.' });
  }
}
