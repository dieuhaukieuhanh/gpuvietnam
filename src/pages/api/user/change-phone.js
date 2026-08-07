import { getAuthUserFromRequest, unauthorized } from '@/lib/api-auth';
import { createOtpRecord } from '@/lib/otp';
import { isValidVietnamesePhone, normalizePhone } from '@/lib/phone';
import { getSupabaseAdmin } from '@/lib/supabase-admin';
import { sendOtp } from '@/lib/zalo-zns';
import { checkRateLimit } from '@/lib/rate-limit';

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const user = await getAuthUserFromRequest(req);
    if (!user) return unauthorized(res);

    // Rate limit: 3 lần/giờ cho mỗi user
    const rate = checkRateLimit(`change-phone:${user.id}`, { max: 3, windowMs: 60 * 60 * 1000 });
    if (!rate.ok) {
      return res.status(429).json({ error: 'Quá nhiều yêu cầu. Vui lòng thử lại sau.', retryAfter: rate.retryAfter });
    }

    const { phone } = req.body ?? {};
    const normalizedPhone = normalizePhone(phone ?? '');

    if (!isValidVietnamesePhone(normalizedPhone)) {
      return res.status(400).json({ error: 'Số điện thoại không hợp lệ.' });
    }

    const supabaseAdmin = getSupabaseAdmin();

    // Kiểm tra SĐT đã thuộc user khác chưa
    const { data: existing } = await supabaseAdmin
      .from('users')
      .select('id')
      .eq('phone', normalizedPhone)
      .neq('id', user.id)
      .maybeSingle();

    if (existing) {
      return res.status(400).json({ error: 'Số điện thoại đã được sử dụng.' });
    }

    // Cooldown 60s
    const { data: lastOtp } = await supabaseAdmin
      .from('otp_verifications')
      .select('created_at')
      .eq('phone', normalizedPhone)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (lastOtp?.created_at) {
      const elapsed = Date.now() - new Date(lastOtp.created_at).getTime();
      if (elapsed < 60_000) {
        const retryAfter = Math.ceil((60_000 - elapsed) / 1000);
        return res.status(429).json({ error: `Vui lòng đợi ${retryAfter}s trước khi gửi lại OTP.`, retryAfter });
      }
    }

    const otp = await createOtpRecord(supabaseAdmin, {
      phone: normalizedPhone,
      userId: user.id,
    });

    // Gửi OTP: Zalo ZNS trước, SMS fallback
    const result = await sendOtp(normalizedPhone, otp);

    const payload = { success: true, phone: normalizedPhone, channel: result.channel };

    if (process.env.NODE_ENV === 'development' && result.dev) {
      payload.devOtp = otp;
    }

    return res.status(200).json(payload);
  } catch (err) {
    return res.status(500).json({ error: err.message || 'Không gửi được OTP.' });
  }
}
