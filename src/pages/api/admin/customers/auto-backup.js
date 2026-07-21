import { requireAdmin } from '@/lib/admin-auth';
import {
  normalizeAutoBackupOverride,
  resolveUserAutoBackupContext,
  setUserAutoBackupOverride,
} from '@/lib/backup-auto-policy';
import { getSupabaseAdmin } from '@/lib/supabase-admin';

/**
 * GET ?userId= — effective auto-backup for one user.
 * PUT { userId, override: null|'force_on'|'force_off' } — per-user Admin override.
 */
export default async function handler(req, res) {
  if (!(await requireAdmin(req, res))) return;

  const supabaseAdmin = getSupabaseAdmin();

  if (req.method === 'GET') {
    try {
      const userId = typeof req.query.userId === 'string' ? req.query.userId.trim() : '';
      if (!userId) {
        return res.status(400).json({ error: 'Thiếu userId.' });
      }
      const ctx = await resolveUserAutoBackupContext(supabaseAdmin, userId, null);
      return res.status(200).json({
        userId,
        enabled: ctx.enabled,
        planKey: ctx.planKey,
        override: ctx.override,
        source: ctx.source,
        policy: ctx.policy,
      });
    } catch (err) {
      console.error('[admin/customers/auto-backup] GET', err);
      return res.status(500).json({ error: err.message || 'Không tải được auto backup.' });
    }
  }

  if (req.method === 'PUT') {
    try {
      const body = req.body ?? {};
      const userId = String(body.userId ?? '').trim();
      if (!userId) {
        return res.status(400).json({ error: 'Thiếu userId.' });
      }

      if (!('override' in body) && !('auto_backup_override' in body)) {
        return res.status(400).json({ error: 'Thiếu override.' });
      }

      const raw = 'override' in body ? body.override : body.auto_backup_override;
      const normalized = normalizeAutoBackupOverride(raw);
      // Allow explicit null; reject unknown strings that normalize to null unless raw was nullish/default
      if (
        raw != null &&
        String(raw).trim() !== '' &&
        !['force_on', 'force_off', 'null', 'default', 'follow'].includes(
          String(raw).trim().toLowerCase(),
        ) &&
        normalized === null
      ) {
        return res.status(400).json({
          error: 'override phải là null, force_on hoặc force_off.',
        });
      }

      await setUserAutoBackupOverride(supabaseAdmin, userId, normalized);
      const ctx = await resolveUserAutoBackupContext(supabaseAdmin, userId, null);

      return res.status(200).json({
        success: true,
        userId,
        override: ctx.override,
        enabled: ctx.enabled,
        planKey: ctx.planKey,
        source: ctx.source,
      });
    } catch (err) {
      console.error('[admin/customers/auto-backup] PUT', err);
      return res.status(500).json({ error: err.message || 'Cập nhật thất bại.' });
    }
  }

  return res.status(405).json({ error: 'Method not allowed' });
}
