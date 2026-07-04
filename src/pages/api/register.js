import { generatePassword } from '@/lib/generate-password';
import { createOtpRecord } from '@/lib/otp';
import { isValidEmail, isValidVietnamesePhone, normalizePhone } from '@/lib/phone';
import { sendOtpSms } from '@/lib/speedsms';
import { getSupabaseAdmin } from '@/lib/supabase-admin';

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const {
      email,
      phone,
      password: rawPassword,
      plan,
      billing,
      env,
      icon,
      desc,
      workstation,
      trial,
    } = req.body ?? {};

    if (!email || !phone) {
      return res.status(400).json({ error: 'Vui lòng nhập email và số điện thoại.' });
    }

    if (!isValidEmail(email)) {
      return res.status(400).json({ error: 'Email không hợp lệ.' });
    }

    const normalizedPhone = normalizePhone(phone);
    if (!isValidVietnamesePhone(normalizedPhone)) {
      return res.status(400).json({ error: 'Số điện thoại không hợp lệ (định dạng 0xxxxxxxxx).' });
    }

    const supabaseAdmin = getSupabaseAdmin();
    const password = rawPassword?.trim() || generatePassword();
    const normalizedEmail = String(email).trim().toLowerCase();

    const { data: existingUser } = await supabaseAdmin
      .from('users')
      .select('id, email, phone_verified')
      .eq('phone', normalizedPhone)
      .maybeSingle();

    if (existingUser?.phone_verified) {
      return res.status(400).json({
        error: 'Số điện thoại này đã được đăng ký. Vui lòng đăng nhập.',
        code: 'phone_taken',
      });
    }

    if (existingUser && !existingUser.phone_verified) {
      const otp = await createOtpRecord(supabaseAdmin, {
        phone: normalizedPhone,
        userId: existingUser.id,
      });
      const smsResult = await sendOtpSms(normalizedPhone, otp);

      const payload = {
        userId: existingUser.id,
        email: existingUser.email,
        phone: normalizedPhone,
        resent: true,
        message: 'SĐT đã đăng ký nhưng chưa xác thực OTP. Mã mới đã được gửi.',
      };

      if (process.env.NODE_ENV === 'development' && smsResult?.dev) {
        payload.devOtp = otp;
        payload.devSms = true;
      }

      return res.status(200).json(payload);
    }

    const { data, error } = await supabaseAdmin.auth.admin.createUser({
      email: normalizedEmail,
      password,
      email_confirm: true,
      user_metadata: {
        phone: normalizedPhone,
        pending_login_password: password,
        ...(plan ? { plan } : {}),
        ...(billing ? { billing } : {}),
        ...(env ? { env } : {}),
        ...(icon ? { icon } : {}),
        ...(desc ? { desc } : {}),
        ...(workstation ? { workstation } : {}),
        ...(trial === true ? { trial: true } : {}),
      },
    });

    if (error) {
      const detail =
        error.message && error.message !== '{}'
          ? error.message
          : error.code || error.status || 'Không tạo được tài khoản Auth';
      const message = String(detail).includes('already been registered')
        ? 'Email này đã được đăng ký. Vui lòng đăng nhập.'
        : String(detail);
      return res.status(400).json({ error: message });
    }

    const { error: upsertError } = await supabaseAdmin.from('users').upsert({
      id: data.user.id,
      email: normalizedEmail,
      phone: normalizedPhone,
      phone_verified: false,
    });

    if (upsertError) {
      throw upsertError;
    }

    const otp = await createOtpRecord(supabaseAdmin, {
      phone: normalizedPhone,
      userId: data.user.id,
    });

    const smsResult = await sendOtpSms(normalizedPhone, otp);

    const payload = {
      userId: data.user.id,
      email: normalizedEmail,
      phone: normalizedPhone,
      message: 'Đăng ký thành công. Vui lòng xác thực OTP.',
    };

    if (process.env.NODE_ENV === 'development' && smsResult?.dev) {
      payload.devOtp = otp;
      payload.devSms = true;
    }

    return res.status(200).json(payload);
  } catch (err) {
    return res.status(500).json({ error: err.message || 'Đăng ký thất bại.' });
  }
}
