import { requireAdmin } from '@/lib/admin-auth';
import {
  BACKUP_INTERVALS_BY_PLAN,
  loadBackupAutoPolicy,
  mergeBackupIntervalsByPlan,
  saveBackupAutoPolicy,
} from '@/lib/backup-auto-policy';
import { getSupabaseAdmin } from '@/lib/supabase-admin';

function resolveAdminId(adminCtx) {
  if (adminCtx?.mode === 'auth' && adminCtx.user?.id) {
    return adminCtx.user.id;
  }
  return null;
}

/**
 * GET — backup intervals by plan (+ code defaults).
 * PUT — update intervals for starter / pro / studio (outputsSec, workflowsSec).
 */
export default async function handler(req, res) {
  const adminCtx = await requireAdmin(req, res);
  if (!adminCtx) return;

  const supabaseAdmin = getSupabaseAdmin();

  if (req.method === 'GET') {
    try {
      const policy = await loadBackupAutoPolicy(supabaseAdmin);
      return res.status(200).json({
        intervals: policy.intervals,
        defaults: BACKUP_INTERVALS_BY_PLAN,
        updatedAt: policy.updatedAt,
      });
    } catch (err) {
      console.error('[admin/backup-auto-policy] GET', err);
      return res.status(500).json({ error: err.message || 'Không tải được tần suất backup.' });
    }
  }

  if (req.method === 'PUT') {
    try {
      const body = req.body ?? {};
      if (body.intervals == null || typeof body.intervals !== 'object') {
        return res.status(400).json({ error: 'Thiếu intervals (starter / pro / studio).' });
      }

      const intervals = mergeBackupIntervalsByPlan(body.intervals);
      const policy = await saveBackupAutoPolicy(supabaseAdmin, {
        intervals,
        updatedBy: resolveAdminId(adminCtx),
      });

      return res.status(200).json({
        success: true,
        intervals: policy.intervals,
        defaults: BACKUP_INTERVALS_BY_PLAN,
        updatedAt: policy.updatedAt,
      });
    } catch (err) {
      console.error('[admin/backup-auto-policy] PUT', err);
      return res.status(500).json({ error: err.message || 'Cập nhật tần suất backup thất bại.' });
    }
  }

  return res.status(405).json({ error: 'Method not allowed' });
}
