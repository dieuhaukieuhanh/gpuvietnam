import { getAuthUserFromRequest, unauthorized } from '@/lib/api-auth';
import { getBackupLogForUser } from '@/lib/backup-logs';
import { restoreBackupToMachine } from '@/lib/machine-backup';
import { getActiveMachineForUser } from '@/lib/machines';
import { getSupabaseAdmin } from '@/lib/supabase-admin';

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const user = await getAuthUserFromRequest(req);
    if (!user) return unauthorized(res);

    const logId = Number(req.body?.logId ?? req.body?.id);
    if (!Number.isFinite(logId)) {
      return res.status(400).json({ error: 'Thiếu logId.' });
    }

    const supabaseAdmin = getSupabaseAdmin();
    const backupLog = await getBackupLogForUser(supabaseAdmin, user.id, logId);

    if (!backupLog) {
      return res.status(404).json({ error: 'Không tìm thấy bản backup.' });
    }

    const machine = await getActiveMachineForUser(supabaseAdmin, user.id);
    if (!machine || machine.status !== 'running') {
      return res.status(400).json({
        error: 'Máy đang tắt. Hãy bật máy trước khi khôi phục dữ liệu.',
      });
    }

    const result = await restoreBackupToMachine(supabaseAdmin, user.id, backupLog, machine);

    return res.status(200).json({
      success: true,
      restored: result.restored,
      total: result.total,
      errors: result.errors,
      message: `Đã khôi phục ${result.restored}/${result.total} gói dữ liệu lên máy.`,
    });
  } catch (err) {
    console.error('[user/backup-restore]', err);
    return res.status(500).json({ error: err.message || 'Khôi phục backup thất bại.' });
  }
}
