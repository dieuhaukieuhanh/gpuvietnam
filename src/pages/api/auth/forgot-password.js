import { createClient } from '@supabase/supabase-js';
import { isValidEmail, normalizePhone } from '@/lib/phone';
import { getSiteUrl } from '@/lib/site-url';
import { getSupabaseAdmin } from '@/lib/supabase-admin';

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { email, phone } = req.body ?? {};
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

    if (!supabaseUrl || !anonKey) {
      return res.status(500).json({ error: 'Thiếu cấu hình Supabase.' });
    }

    let loginEmail = email?.trim().toLowerCase();

    if (phone && !loginEmail) {
      const normalizedPhone = normalizePhone(phone);
      const supabaseAdmin = getSupabaseAdmin();
      const { data: userRow } = await supabaseAdmin
        .from('users')
        .select('email')
        .eq('phone', normalizedPhone)
        .maybeSingle();

      loginEmail = userRow?.email?.trim().toLowerCase();
    }

    if (!loginEmail || !isValidEmail(loginEmail)) {
      return res.status(400).json({ error: 'Vui lòng nhập email hoặc SĐT hợp lệ.' });
    }

    const redirectTo = `${getSiteUrl(req)}/dat-lai-mat-khau`;
    const supabase = createClient(supabaseUrl, anonKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    const { error } = await supabase.auth.resetPasswordForEmail(loginEmail, {
      redirectTo,
    });

    if (error) {
      console.error('[auth/forgot-password]', error);
      return res.status(500).json({ error: 'Không gửi được email đặt lại mật khẩu.' });
    }

    return res.status(200).json({
      success: true,
      message:
        'Nếu tài khoản tồn tại, chúng tôi đã gửi link đặt lại mật khẩu tới email đăng ký. Kiểm tra hộp thư (và mục Spam).',
      email: loginEmail,
    });
  } catch (err) {
    console.error('[auth/forgot-password]', err);
    return res.status(500).json({ error: err.message || 'Gửi email thất bại.' });
  }
}
