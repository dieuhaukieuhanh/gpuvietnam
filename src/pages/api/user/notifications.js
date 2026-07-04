import { getAuthUserFromRequest, unauthorized } from '@/lib/api-auth';
import { listUserNotifications } from '@/lib/user-notifications';
import { getOrCreateNotificationSettings } from '@/lib/user-settings';
import { getSupabaseAdmin } from '@/lib/supabase-admin';
const NOTIFICATION_FIELDS = [
  'zalo_enabled',
  'email_enabled',
  'event_low_hours',
  'event_expiring',
  'event_backup_full',
  'event_payment_success',
];

function toClientSettings(row) {
  return {
    zaloEnabled: row.zalo_enabled,
    emailEnabled: row.email_enabled,
    eventLowHours: row.event_low_hours,
    eventExpiring: row.event_expiring,
    eventBackupFull: row.event_backup_full,
    eventPaymentSuccess: row.event_payment_success,
  };
}

export default async function handler(req, res) {
  const user = await getAuthUserFromRequest(req);
  if (!user) return unauthorized(res);

  const supabaseAdmin = getSupabaseAdmin();

  if (req.method === 'GET') {
    try {
      if (req.query.limit !== undefined || req.query.offset !== undefined) {
        const limit = req.query.limit;
        const offset = req.query.offset;
        const result = await listUserNotifications(supabaseAdmin, user.id, { limit, offset });
        return res.status(200).json(result);
      }

      const settings = await getOrCreateNotificationSettings(supabaseAdmin, user.id);
      return res.status(200).json({ settings: toClientSettings(settings) });
    } catch (err) {
      return res.status(500).json({ error: err.message || 'Không tải được dữ liệu.' });
    }
  }

  if (req.method === 'PUT') {
    try {
      await getOrCreateNotificationSettings(supabaseAdmin, user.id);

      const updates = {};
      const body = req.body ?? {};

      if (body.zaloEnabled !== undefined) updates.zalo_enabled = Boolean(body.zaloEnabled);
      if (body.emailEnabled !== undefined) updates.email_enabled = Boolean(body.emailEnabled);
      if (body.eventLowHours !== undefined) updates.event_low_hours = Boolean(body.eventLowHours);
      if (body.eventExpiring !== undefined) updates.event_expiring = Boolean(body.eventExpiring);
      if (body.eventBackupFull !== undefined) updates.event_backup_full = Boolean(body.eventBackupFull);
      if (body.eventPaymentSuccess !== undefined) {
        updates.event_payment_success = Boolean(body.eventPaymentSuccess);
      }

      if (Object.keys(updates).length === 0) {
        return res.status(400).json({ error: 'Không có thay đổi.' });
      }

      updates.updated_at = new Date().toISOString();

      const { data, error } = await supabaseAdmin
        .from('user_notification_settings')
        .update(updates)
        .eq('user_id', user.id)
        .select(NOTIFICATION_FIELDS.join(', '))
        .single();

      if (error) throw error;

      return res.status(200).json({ success: true, settings: toClientSettings(data) });
    } catch (err) {
      return res.status(500).json({ error: err.message || 'Cập nhật thất bại.' });
    }
  }

  return res.status(405).json({ error: 'Method not allowed' });
}
