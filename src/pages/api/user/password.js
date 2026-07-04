import { createClient } from '@supabase/supabase-js';
import { getAuthUserFromRequest, unauthorized } from '@/lib/api-auth';
import { getSupabaseAdmin } from '@/lib/supabase-admin';

export default async function handler(req, res) {
  if (req.method !== 'PUT') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const user = await getAuthUserFromRequest(req);
    if (!user) return unauthorized(res);

    const { currentPassword, newPassword } = req.body ?? {};
    const current = String(currentPassword ?? '');
    const next = String(newPassword ?? '');

    if (!current || !next) {
      return res.status(400).json({ error: 'Vui lòng nhập đủ mật khẩu cũ và mới.' });
    }

    if (next.length < 8 || !/[A-Z]/.test(next) || !/\d/.test(next)) {
      return res.status(400).json({
        error: 'Mật khẩu mới tối thiểu 8 ký tự, có chữ hoa và số.',
      });
    }

    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    const supabaseAdmin = getSupabaseAdmin();

    const { data: profile } = await supabaseAdmin
      .from('users')
      .select('email')
      .eq('id', user.id)
      .maybeSingle();

    const email = profile?.email ?? user.email;
    if (!email) {
      return res.status(400).json({ error: 'Không tìm thấy email tài khoản.' });
    }

    const verifyClient = createClient(supabaseUrl, anonKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    const { error: signInError } = await verifyClient.auth.signInWithPassword({
      email,
      password: current,
    });

    if (signInError) {
      return res.status(400).json({ error: 'Mật khẩu cũ không đúng.' });
    }

    const { error: updateError } = await supabaseAdmin.auth.admin.updateUserById(user.id, {
      password: next,
    });

    if (updateError) throw updateError;

    return res.status(200).json({ success: true, message: 'Đã đổi mật khẩu.' });
  } catch (err) {
    return res.status(500).json({ error: err.message || 'Đổi mật khẩu thất bại.' });
  }
}
