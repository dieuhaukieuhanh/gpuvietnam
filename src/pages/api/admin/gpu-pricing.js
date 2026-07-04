import { requireAdmin } from '@/lib/admin-auth';
import {
  getDefaultGpuPricingConfig,
  loadGpuPricingConfig,
  normalizeGpuPricingConfig,
  saveGpuPricingConfig,
} from '@/lib/gpu-pricing-config';
import { getSupabaseAdmin } from '@/lib/supabase-admin';

/**
 * GET — Cấu hình bảng giá GPU (admin hoặc public read).
 * PUT — Lưu toàn bộ cấu hình (admin).
 */
export default async function handler(req, res) {
  const supabaseAdmin = getSupabaseAdmin();

  if (req.method === 'GET') {
    try {
      const config = await loadGpuPricingConfig(supabaseAdmin, { force: true });
      return res.status(200).json({ config });
    } catch (err) {
      return res.status(500).json({ error: err.message || 'Không tải được bảng giá.' });
    }
  }

  if (req.method === 'PUT') {
    if (!(await requireAdmin(req, res))) return;

    try {
      const { config } = req.body ?? {};
      if (!config || typeof config !== 'object') {
        return res.status(400).json({ error: 'Thiếu config.' });
      }

      const normalized = normalizeGpuPricingConfig(config);
      const saved = await saveGpuPricingConfig(supabaseAdmin, normalized);

      return res.status(200).json({
        success: true,
        config: saved.config,
        updatedAt: saved.updatedAt,
      });
    } catch (err) {
      return res.status(500).json({ error: err.message || 'Cập nhật thất bại.' });
    }
  }

  return res.status(405).json({ error: 'Method not allowed' });
}

export { getDefaultGpuPricingConfig };
