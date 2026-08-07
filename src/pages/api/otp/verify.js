import { verifyOtpRecord } from '@/lib/otp';
import { isValidVietnamesePhone, normalizePhone } from '@/lib/phone';
import { checkRateLimit, clearLock, getLockRemaining, isLocked, setLock } from '@/lib/rate-limit';
import { getSupabaseAdmin } from '@/lib/supabase-admin';
import { logAuthEvent } from '@/lib/audit-log';

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { phone, otp } = req.body ?? {};
    const normalizedPhone = normalizePhone(phone ?? '');
    const otpCode = String(otp ?? '').trim();

    if (!isValidVietnamesePhone(normalizedPhone)) {
      return res.status(400).json({ error: 'Số điện thoại không hợp lệ.' });
    }

    if (!/^\d{6}$/.test(otpCode)) {
      return res.status(400).json({ error: 'OTP phải gồm 6 chữ số.' });
    }

    // Kiểm tra lock (brute-force protection)
    const lockKey = `otp-lock:${normalizedPhone}`;
    if (isLocked(lockKey)) {
      const remaining = getLockRemaining(lockKey);
      return res.status(423).json({ error: `Tài khoản tạm khóa. Vui lòng thử lại sau ${remaining}s.`, retryAfter: remaining });
    }

    // Rate limit: 5 attempts / phone / 5 phút
    const rateKey = `otp-verify:${normalizedPhone}`;
    const rate = checkRateLimit(rateKey, { max: 5, windowMs: 5 * 60 * 1000 });
    if (!rate.ok) {
      // Lock sau khi vượt quá limit
      setLock(lockKey, 15 * 60 * 1000);
      return res.status(423).json({ error: 'Quá nhiều lần thử OTP. Tài khoản tạm khóa 15 phút.', retryAfter: 900 });
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

    // Verify thành công → xóa lock
    clearLock(lockKey);

    const userId = verification.userId;
    if (!userId) {
      // OTP được tạo không có userId (user chưa có account khi gửi OTP)
      // Tìm user theo phone
      const { data: userByPhone } = await supabaseAdmin
        .from('users')
        .select('id')
        .eq('phone', normalizedPhone)
        .maybeSingle();

      if (!userByPhone) {
        return res.status(200).json({
          success: true,
          phone: normalizedPhone,
          verified: true,
          note: 'SĐT đã được xác thực. Vui lòng thêm SĐT này vào tài khoản của bạn trong Dashboard.',
        });
      }

      // Cập nhật phone_verified cho user tìm thấy
      await supabaseAdmin
        .from('users')
        .update({ phone: normalizedPhone, phone_verified: true })
        .eq('id', userByPhone.id);

      await logAuthEvent(supabaseAdmin, 'otp_verify', {
        userId: userByPhone.id,
        phone: normalizedPhone,
        ip: req.headers['x-forwarded-for']?.split(',')[0]?.trim() || req.socket?.remoteAddress,
        userAgent: req.headers['user-agent'],
      });

      return res.status(200).json({
        success: true,
        phone: normalizedPhone,
        verified: true,
      });
    }

    // Cập nhật phone_verified
    await supabaseAdmin
      .from('users')
      .update({ phone: normalizedPhone, phone_verified: true })
      .eq('id', userId);

    await logAuthEvent(supabaseAdmin, 'otp_verify', {
      userId,
      phone: normalizedPhone,
      ip: req.headers['x-forwarded-for']?.split(',')[0]?.trim() || req.socket?.remoteAddress,
      userAgent: req.headers['user-agent'],
    });

    return res.status(200).json({
      success: true,
      phone: normalizedPhone,
      verified: true,
      userId,
    });
  } catch (err) {
    return res.status(500).json({ error: err.message || 'Xác thực OTP thất bại.' });
  }
}
