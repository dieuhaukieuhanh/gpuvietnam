import { getAuthUserFromRequest, unauthorized } from '@/lib/api-auth';
import { mapSessionRow } from '@/lib/gpu-sessions';
import { getSupabaseAdmin } from '@/lib/supabase-admin';

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const user = await getAuthUserFromRequest(req);
    if (!user) return unauthorized(res);

    const supabaseAdmin = getSupabaseAdmin();
    const limit = Math.min(Math.max(Number(req.query.limit) || 7, 1), 100);
    const offset = Math.max(Number(req.query.offset) || 0, 0);

    const { count: total, error: countError } = await supabaseAdmin
      .from('gpu_sessions')
      .select('*', { count: 'exact', head: true })
      .eq('user_id', user.id);

    if (countError) throw countError;

    const { data: rows, error: rowsError } = await supabaseAdmin
      .from('gpu_sessions')
      .select('*')
      .eq('user_id', user.id)
      .order('started_at', { ascending: false })
      .range(offset, offset + limit - 1);

    if (rowsError) throw rowsError;

    const sessionTotal = total ?? 0;
    const sessions = (rows ?? []).map((row, index) =>
      mapSessionRow(row, {
        sessionNumber: sessionTotal - offset - index,
      }),
    );

    return res.status(200).json({
      sessions,
      total: sessionTotal,
      limit,
      offset,
      hasMore: offset + sessions.length < sessionTotal,
    });
  } catch (err) {
    return res.status(500).json({ error: err.message || 'Không tải được lịch sử phiên.' });
  }
}
