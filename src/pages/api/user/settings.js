import { getAuthUserFromRequest, unauthorized } from '@/lib/api-auth';
import { evaluateAutoRenew } from '@/lib/auto-renew';
import {
  AUTO_TOPUP_AMOUNTS,
  AUTO_TOPUP_THRESHOLDS,
  getOrCreateUserSettings,
} from '@/lib/user-settings';
import { getSupabaseAdmin } from '@/lib/supabase-admin';

const SETTINGS_SELECT =
  'auto_renew_enabled, auto_renew_method, auto_renew_threshold, auto_topup_enabled, auto_topup_threshold, auto_topup_amount, auto_topup_warn_enabled, theme';

function toClientSettings(row, preview) {
  return {
    autoRenewEnabled: row.auto_renew_enabled,
    autoRenewMethod: row.auto_renew_method,
    autoRenewThreshold: Number(row.auto_renew_threshold ?? 10),
    autoTopupEnabled: row.auto_topup_enabled,
    autoTopupThreshold: Number(row.auto_topup_threshold ?? 50000),
    autoTopupAmount: Number(row.auto_topup_amount ?? 200000),
    autoTopupWarnEnabled: row.auto_topup_warn_enabled ?? true,
    theme: row.theme,
    autoRenewPreview: preview
      ? {
          hoursRemaining: preview.hoursRemaining,
          withinThreshold: preview.withinThreshold,
          renewPrice: preview.renewPrice,
          walletBalance: preview.walletBalance,
          canAutoRenew: preview.canAutoRenew,
          badge: preview.badge,
        }
      : null,
  };
}

export default async function handler(req, res) {
  const user = await getAuthUserFromRequest(req);
  if (!user) return unauthorized(res);

  const supabaseAdmin = getSupabaseAdmin();

  if (req.method === 'GET') {
    try {
      const settings = await getOrCreateUserSettings(supabaseAdmin, user.id);
      const preview = await evaluateAutoRenew(supabaseAdmin, user.id);
      return res.status(200).json({ settings: toClientSettings(settings, preview) });
    } catch (err) {
      return res.status(500).json({ error: err.message || 'Không tải được cài đặt.' });
    }
  }

  if (req.method === 'PUT') {
    try {
      await getOrCreateUserSettings(supabaseAdmin, user.id);

      const updates = {};
      const body = req.body ?? {};

      if (body.autoRenewEnabled !== undefined) {
        updates.auto_renew_enabled = Boolean(body.autoRenewEnabled);
      }
      if (body.autoRenewMethod !== undefined) {
        if (!['wallet', 'transfer'].includes(body.autoRenewMethod)) {
          return res.status(400).json({ error: 'Phương thức gia hạn không hợp lệ.' });
        }
        updates.auto_renew_method = body.autoRenewMethod;
      }
      if (body.autoRenewThreshold !== undefined) {
        const threshold = Number(body.autoRenewThreshold);
        if (!Number.isFinite(threshold) || threshold < 1 || threshold > 48) {
          return res.status(400).json({ error: 'Ngưỡng gia hạn phải từ 1–48 giờ.' });
        }
        updates.auto_renew_threshold = threshold;
      }
      if (body.autoTopupEnabled !== undefined) {
        updates.auto_topup_enabled = Boolean(body.autoTopupEnabled);
      }
      if (body.autoTopupThreshold !== undefined) {
        const value = Number(body.autoTopupThreshold);
        if (!AUTO_TOPUP_THRESHOLDS.includes(value)) {
          return res.status(400).json({ error: 'Ngưỡng nạp tự động không hợp lệ.' });
        }
        updates.auto_topup_threshold = value;
      }
      if (body.autoTopupAmount !== undefined) {
        const value = Number(body.autoTopupAmount);
        if (!AUTO_TOPUP_AMOUNTS.includes(value)) {
          return res.status(400).json({ error: 'Mệnh giá nạp tự động không hợp lệ.' });
        }
        updates.auto_topup_amount = value;
      }
      if (body.autoTopupWarnEnabled !== undefined) {
        updates.auto_topup_warn_enabled = Boolean(body.autoTopupWarnEnabled);
      }
      if (body.theme !== undefined) {
        if (!['light', 'dark'].includes(body.theme)) {
          return res.status(400).json({ error: 'Chủ đề không hợp lệ.' });
        }
        updates.theme = body.theme;
      }

      if (Object.keys(updates).length === 0) {
        return res.status(400).json({ error: 'Không có thay đổi.' });
      }

      updates.updated_at = new Date().toISOString();

      const { data, error } = await supabaseAdmin
        .from('user_settings')
        .update(updates)
        .eq('user_id', user.id)
        .select(SETTINGS_SELECT)
        .single();

      if (error) throw error;

      const preview = await evaluateAutoRenew(supabaseAdmin, user.id);
      return res.status(200).json({ success: true, settings: toClientSettings(data, preview) });
    } catch (err) {
      return res.status(500).json({ error: err.message || 'Cập nhật thất bại.' });
    }
  }

  return res.status(405).json({ error: 'Method not allowed' });
}
