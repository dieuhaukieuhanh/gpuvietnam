import { getAuthUserFromRequest, unauthorized } from '@/lib/api-auth';
import { createOtpRecord } from '@/lib/otp';
import { isValidVietnamesePhone, normalizePhone } from '@/lib/phone';
import { sendOtpSms } from '@/lib/speedsms';
import { getSupabaseAdmin } from '@/lib/supabase-admin';

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const user = await getAuthUserFromRequest(req);
    if (!user) return unauthorized(res);

    const { phone } = req.body ?? {};
    const normalizedPhone = normalizePhone(phone ?? '');

    if (!isValidVietnamesePhone(normalizedPhone)) {
      return res.status(400).json({ error: 'Số điện thoại không hợp lệ.' });
    }

    const supabaseAdmin = getSupabaseAdmin();

    const { data: existing } = await supabaseAdmin
      .from('users')
      .select('id')
      .eq('phone', normalizedPhone)
      .neq('id', user.id)
      .maybeSingle();

    if (existing) {
      return res.status(400).json({ error: 'Số điện thoại đã được sử dụng.' });
    }

    const otp = await createOtpRecord(supabaseAdmin, {
      phone: normalizedPhone,
      userId: user.id,
    });

    const smsResult = await sendOtpSms(normalizedPhone, otp);

    const payload = { success: true, phone: normalizedPhone };
    if (process.env.NODE_ENV === 'development' && smsResult?.dev) {
      payload.devOtp = otp;
    }

    return res.status(200).json(payload);
  } catch (err) {
    return res.status(500).json({ error: err.message || 'Không gửi được OTP.' });
  }
}
