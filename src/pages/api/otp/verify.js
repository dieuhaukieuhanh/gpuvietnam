import { createUserSession, verifyOtpRecord } from '@/lib/otp';
import { isValidVietnamesePhone, normalizePhone } from '@/lib/phone';
import { getSupabaseAdmin } from '@/lib/supabase-admin';
import { resolveUserRole } from '@/lib/user-role';

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { phone, otp, email } = req.body ?? {};
    const normalizedPhone = normalizePhone(phone ?? '');
    const otpCode = String(otp ?? '').trim();

    if (!isValidVietnamesePhone(normalizedPhone)) {
      return res.status(400).json({ error: 'Số điện thoại không hợp lệ.' });
    }

    if (!/^\d{6}$/.test(otpCode)) {
      return res.status(400).json({ error: 'OTP phải gồm 6 chữ số.' });
    }

    const supabaseAdmin = getSupabaseAdmin();
    const verification = await verifyOtpRecord(supabaseAdmin, {
      phone: normalizedPhone,
      otp: otpCode,
    });

    if (!verification.valid) {
      const messages = {
        not_found: 'Không tìm thấy OTP. Vui lòng gửi lại.',
        expired: 'OTP đã hết hạn. Vui lòng gửi lại.',
        invalid: 'OTP không đúng. Vui lòng thử lại.',
      };
      return res.status(400).json({ error: messages[verification.reason] || 'OTP không hợp lệ.' });
    }

    const userId = verification.userId;
    if (!userId) {
      return res.status(400).json({ error: 'Không tìm thấy tài khoản liên kết.' });
    }

    await supabaseAdmin
      .from('users')
      .update({ phone: normalizedPhone, phone_verified: true })
      .eq('id', userId);

    const { data: authUser, error: userError } = await supabaseAdmin.auth.admin.getUserById(userId);
    if (userError || !authUser.user) {
      return res.status(400).json({ error: 'Không lấy được thông tin user.' });
    }

    const loginEmail = email?.trim().toLowerCase() || authUser.user.email;
    const password = authUser.user.user_metadata?.pending_login_password;

    if (!password) {
      return res.status(400).json({
        error: 'Không thể tự động đăng nhập. Vui lòng đăng nhập bằng mật khẩu.',
      });
    }

    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    const session = await createUserSession(supabaseUrl, anonKey, loginEmail, password);

    await supabaseAdmin.auth.admin.updateUserById(userId, {
      user_metadata: {
        ...authUser.user.user_metadata,
        pending_login_password: null,
        phone_verified: true,
      },
    });

    const role = await resolveUserRole(supabaseAdmin, { userId, email: loginEmail });

    return res.status(200).json({
      success: true,
      session,
      email: loginEmail,
      phone: normalizedPhone,
      role,
    });
  } catch (err) {
    return res.status(500).json({ error: err.message || 'Xác thực OTP thất bại.' });
  }
}
