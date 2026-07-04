import { getAuthUserFromRequest, unauthorized } from '@/lib/api-auth';
import { getSupabaseAdmin } from '@/lib/supabase-admin';

export default async function handler(req, res) {
  if (req.method !== 'PUT') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const user = await getAuthUserFromRequest(req);
    if (!user) return unauthorized(res);

    const { fullName } = req.body ?? {};
    const trimmed = String(fullName ?? '').trim();

    if (!trimmed || trimmed.length < 2) {
      return res.status(400).json({ error: 'Họ tên phải có ít nhất 2 ký tự.' });
    }

    const supabaseAdmin = getSupabaseAdmin();
    const { data, error } = await supabaseAdmin
      .from('users')
      .update({ full_name: trimmed, updated_at: new Date().toISOString() })
      .eq('id', user.id)
      .select('id, email, phone, phone_verified, full_name')
      .single();

    if (error) throw error;

    return res.status(200).json({
      success: true,
      profile: {
        id: data.id,
        email: data.email,
        phone: data.phone,
        phoneVerified: data.phone_verified,
        fullName: data.full_name,
      },
    });
  } catch (err) {
    return res.status(500).json({ error: err.message || 'Cập nhật thất bại.' });
  }
}
