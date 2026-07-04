import { requireAdmin } from '@/lib/admin-auth';
import { getSupabaseAdmin } from '@/lib/supabase-admin';

/**
 * GET — Toàn bộ bảng giá (public, không cần auth).
 * PUT — Cập nhật price_monthly hoặc is_active (yêu cầu admin).
 */
export default async function handler(req, res) {
  const supabaseAdmin = getSupabaseAdmin();

  if (req.method === 'GET') {
    try {
      const { data, error } = await supabaseAdmin
        .from('storage_pricing')
        .select('id, storage_type, size_gb, price_monthly, is_active, updated_at')
        .order('storage_type', { ascending: true })
        .order('size_gb', { ascending: true });

      if (error) throw error;

      return res.status(200).json({ items: data ?? [] });
    } catch (err) {
      return res.status(500).json({ error: err.message || 'Không tải được bảng giá.' });
    }
  }

  if (req.method === 'PUT') {
    if (!(await requireAdmin(req, res))) return;

    try {
      const { id, price_monthly: priceMonthly, is_active: isActive } = req.body ?? {};

      if (!id) {
        return res.status(400).json({ error: 'Thiếu id.' });
      }

      const updates = {};

      if (priceMonthly !== undefined) {
        const price = Number(priceMonthly);
        if (!Number.isFinite(price) || price < 0) {
          return res.status(400).json({ error: 'Giá không hợp lệ.' });
        }
        updates.price_monthly = price;
      }

      if (isActive !== undefined) {
        updates.is_active = Boolean(isActive);
      }

      if (Object.keys(updates).length === 0) {
        return res.status(400).json({ error: 'Thiếu price_monthly hoặc is_active.' });
      }

      const { data, error } = await supabaseAdmin
        .from('storage_pricing')
        .update(updates)
        .eq('id', id)
        .select('id, storage_type, size_gb, price_monthly, is_active, updated_at')
        .single();

      if (error) throw error;
      if (!data) {
        return res.status(404).json({ error: 'Không tìm thấy mức giá.' });
      }

      return res.status(200).json({ success: true, item: data });
    } catch (err) {
      return res.status(500).json({ error: err.message || 'Cập nhật thất bại.' });
    }
  }

  return res.status(405).json({ error: 'Method not allowed' });
}
