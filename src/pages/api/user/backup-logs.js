import { getAuthUserFromRequest, unauthorized } from '@/lib/api-auth';
import { listRecentBackupLogs, BACKUP_REASON_LABELS } from '@/lib/backup-logs';
import { getSupabaseAdmin } from '@/lib/supabase-admin';

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const user = await getAuthUserFromRequest(req);
    if (!user) return unauthorized(res);

    const limit = Math.min(Math.max(Number(req.query.limit) || 5, 1), 20);
    const supabaseAdmin = getSupabaseAdmin();
    const logs = await listRecentBackupLogs(supabaseAdmin, user.id, { limit });

    const items = logs.map((log) => ({
      id: log.id,
      machineId: log.machine_id,
      reason: log.reason,
      reasonLabel: BACKUP_REASON_LABELS[log.reason] ?? log.reason,
      status: log.status,
      errorMessage: log.error_message,
      sizeBytes: Number(log.size_bytes ?? 0),
      archives: log.archives ?? [],
      createdAt: log.created_at,
    }));

    return res.status(200).json({ items });
  } catch (err) {
    console.error('[user/backup-logs]', err);
    return res.status(500).json({ error: err.message || 'Không tải được backup logs.' });
  }
}
