import { getAuthUserFromRequest, unauthorized } from '@/lib/api-auth';
import { getSupabaseAdmin } from '@/lib/supabase-admin';

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const user = await getAuthUserFromRequest(req);
    if (!user) return unauthorized(res);

    const supabaseAdmin = getSupabaseAdmin();
    const email = user.email?.trim().toLowerCase();
    const emailConfirmed = !!user.email_confirmed_at;

    const { data: existing } = await supabaseAdmin
      .from('users')
      .select('id, email_verified')
      .eq('id', user.id)
      .maybeSingle();

    if (existing) {
      // Cập nhật email_verified nếu auth đã confirm nhưng public.users chưa
      if (emailConfirmed && !existing.email_verified) {
        await supabaseAdmin
          .from('users')
          .update({ email_verified: true, updated_at: new Date().toISOString() })
          .eq('id', user.id);
      }
    } else {
      // Tạo mới (fallback nếu trigger chưa chạy)
      await supabaseAdmin.from('users').upsert({
        id: user.id,
        email,
        email_verified: emailConfirmed,
        phone_verified: false,
      });
    }

    return res.status(200).json({ ok: true });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}
