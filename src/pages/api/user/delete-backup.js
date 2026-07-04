import { getAuthUserFromRequest, unauthorized } from '@/lib/api-auth';
import { getSupabaseAdmin } from '@/lib/supabase-admin';

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const user = await getAuthUserFromRequest(req);
    if (!user) return unauthorized(res);

    const { confirmText } = req.body ?? {};
    if (confirmText !== 'XÓA') {
      return res.status(400).json({ error: 'Vui lòng nhập chính xác "XÓA" để xác nhận.' });
    }

    const supabaseAdmin = getSupabaseAdmin();

    const { data: files, error: listError } = await supabaseAdmin
      .from('storage_files')
      .select('id')
      .eq('user_id', user.id)
      .eq('storage_type', 'backup');

    if (listError) throw listError;

    const count = files?.length ?? 0;

    if (count > 0) {
      const { error: deleteError } = await supabaseAdmin
        .from('storage_files')
        .delete()
        .eq('user_id', user.id)
        .eq('storage_type', 'backup');

      if (deleteError) throw deleteError;
    }

    return res.status(200).json({
      success: true,
      deletedCount: count,
      message: count > 0 ? `Đã xóa ${count} mục trên Backup.` : 'Backup đã trống.',
    });
  } catch (err) {
    return res.status(500).json({ error: err.message || 'Xóa backup thất bại.' });
  }
}
