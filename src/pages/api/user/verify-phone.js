import { getAuthUserFromRequest, unauthorized } from '@/lib/api-auth';
import { verifyOtpRecord } from '@/lib/otp';
import { isValidVietnamesePhone, normalizePhone } from '@/lib/phone';
import { getSupabaseAdmin } from '@/lib/supabase-admin';

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const user = await getAuthUserFromRequest(req);
    if (!user) return unauthorized(res);

    const { phone, otp } = req.body ?? {};
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

    if (verification.userId && verification.userId !== user.id) {
      return res.status(400).json({ error: 'OTP không thuộc tài khoản này.' });
    }

    const { data: existing } = await supabaseAdmin
      .from('users')
      .select('id')
      .eq('phone', normalizedPhone)
      .neq('id', user.id)
      .maybeSingle();

    if (existing) {
      return res.status(400).json({ error: 'Số điện thoại đã được sử dụng.' });
    }

    const { data, error } = await supabaseAdmin
      .from('users')
      .update({
        phone: normalizedPhone,
        phone_verified: true,
        updated_at: new Date().toISOString(),
      })
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
    return res.status(500).json({ error: err.message || 'Xác nhận SĐT thất bại.' });
  }
}
