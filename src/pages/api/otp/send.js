import { logAuthEvent } from '@/lib/audit-log';
import { createOtpRecord } from '@/lib/otp';
import { isValidVietnamesePhone, normalizePhone } from '@/lib/phone';
import { checkRateLimit } from '@/lib/rate-limit';
import { getSupabaseAdmin } from '@/lib/supabase-admin';
import { sendOtp } from '@/lib/zalo-zns';

function getClientIp(req) {
  const forwarded = req.headers['x-forwarded-for'];
  if (forwarded) return forwarded.split(',')[0].trim();
  return req.socket?.remoteAddress ?? '127.0.0.1';
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { phone } = req.body ?? {};
    const normalizedPhone = normalizePhone(phone ?? '');

    if (!isValidVietnamesePhone(normalizedPhone)) {
      return res.status(400).json({ error: 'Số điện thoại không hợp lệ.' });
    }

    // Rate limit per IP: 10 req/giờ
    const ip = getClientIp(req);
    const ipRate = checkRateLimit(`otp-send-ip:${ip}`, { max: 10, windowMs: 60 * 60 * 1000 });
    if (!ipRate.ok) {
      return res.status(429).json({ error: 'Quá nhiều yêu cầu. Vui lòng thử lại sau.', retryAfter: ipRate.retryAfter });
    }

    // Rate limit per phone: 3 req/5 phút
    const phoneRate = checkRateLimit(`otp-send-phone:${normalizedPhone}`, { max: 3, windowMs: 5 * 60 * 1000 });
    if (!phoneRate.ok) {
      return res.status(429).json({ error: 'Đã gửi quá nhiều OTP cho số này. Vui lòng thử lại sau.', retryAfter: phoneRate.retryAfter });
    }

    const supabaseAdmin = getSupabaseAdmin();

    // Cooldown 60s: kiểm tra OTP record cuối cùng cho phone này
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

    // Tìm user theo phone để gắn userId nếu có
    const { data: userRow } = await supabaseAdmin
      .from('users')
      .select('id, email')
      .eq('phone', normalizedPhone)
      .maybeSingle();

    const userId = userRow?.id ?? null;

    const otp = await createOtpRecord(supabaseAdmin, {
      phone: normalizedPhone,
      userId,
    });

    // Gửi OTP: Zalo ZNS trước, SMS fallback
    const result = await sendOtp(normalizedPhone, otp);

    // Audit log
    await logAuthEvent(supabaseAdmin, 'otp_send', {
      userId,
      phone: normalizedPhone,
      ip,
      userAgent: req.headers['user-agent'],
      metadata: { channel: result.channel },
    });

    const payload = { success: true, phone: normalizedPhone, channel: result.channel };

    // Dev mode: hiển thị OTP nếu không có Zalo và Speedsms không được cấu hình
    if (process.env.NODE_ENV === 'development' && result.dev) {
      payload.devOtp = otp;
    }

    return res.status(200).json(payload);
  } catch (err) {
    return res.status(500).json({ error: err.message || 'Không gửi được OTP.' });
  }
}
