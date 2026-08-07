import { logAuthEvent } from '@/lib/audit-log';
import { generatePassword } from '@/lib/generate-password';
import { isValidEmail, isDisposableEmail } from '@/lib/email-utils';
import { isValidVietnamesePhone, normalizePhone } from '@/lib/phone';
import { checkRateLimit } from '@/lib/rate-limit';
import { getSupabaseAdmin } from '@/lib/supabase-admin';

function getClientIp(req) {
  const forwarded = req.headers['x-forwarded-for'];
  if (forwarded) return forwarded.split(',')[0].trim();
  return req.socket?.remoteAddress ?? '127.0.0.1';
}

const ALLOWED_PLANS = new Set([
  'gpu-starter', 'gpu-pro', 'gpu-enterprise',
  'storage-basic', 'storage-plus',
]);
const ALLOWED_BILLINGS = new Set(['hourly', 'monthly', 'yearly']);
const MAX_DESC_LENGTH = 200;

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const ip = getClientIp(req);

    // Rate limit IP: 10 req/15 phút
    const ipRate = checkRateLimit(`register:ip:${ip}`, { max: 10, windowMs: 15 * 60 * 1000 });
    if (!ipRate.ok) {
      return res.status(429).json({ error: 'Quá nhiều yêu cầu. Vui lòng thử lại sau.', retryAfter: ipRate.retryAfter });
    }

    const {
      email,
      phone,
      password: rawPassword,
      confirmPassword: rawConfirmPassword,
      plan,
      billing,
      env,
      icon,
      desc,
      workstation,
      trial,
    } = req.body ?? {};

    // ── Email validation (BẮT BUỘC) ──────────────────────────
    if (!email) {
      return res.status(400).json({ error: 'Vui lòng nhập email.' });
    }

    const normalizedEmail = String(email).trim().toLowerCase();

    if (!isValidEmail(normalizedEmail)) {
      return res.status(400).json({ error: 'Email không hợp lệ.' });
    }

    if (isDisposableEmail(normalizedEmail)) {
      return res.status(400).json({
        error: 'Email tạm thời không được hỗ trợ. Vui lòng dùng email cá nhân hoặc công ty.',
        code: 'disposable_email',
      });
    }

    // Rate limit email: 3 lần/giờ cho cùng 1 email
    const emailRate = checkRateLimit(`register:email:${normalizedEmail}`, { max: 3, windowMs: 60 * 60 * 1000 });
    if (!emailRate.ok) {
      return res.status(429).json({ error: 'Email này đã được thử đăng ký quá nhiều lần. Vui lòng thử lại sau.', retryAfter: emailRate.retryAfter });
    }

    // ── Phone validation (TÙY CHỌN) ────────────────────────────
    let normalizedPhone = null;
    if (phone && String(phone).trim()) {
      normalizedPhone = normalizePhone(phone);
      if (!isValidVietnamesePhone(normalizedPhone)) {
        return res.status(400).json({ error: 'Số điện thoại không hợp lệ (định dạng 0xxxxxxxxx).' });
      }
    }

    // ── Password validation ──────────────────────────────────
    const userProvidedPassword = rawPassword?.trim();
    if (userProvidedPassword) {
      if (userProvidedPassword.length < 8) {
        return res.status(400).json({ error: 'Mật khẩu tối thiểu 8 ký tự.' });
      }
      if (!/[A-Z]/.test(userProvidedPassword)) {
        return res.status(400).json({ error: 'Mật khẩu cần ít nhất 1 chữ hoa.' });
      }
      if (!/\d/.test(userProvidedPassword)) {
        return res.status(400).json({ error: 'Mật khẩu cần ít nhất 1 chữ số.' });
      }
      const confirm = (rawConfirmPassword ?? '').trim();
      if (userProvidedPassword !== confirm) {
        return res.status(400).json({ error: 'Mật khẩu xác nhận không khớp.' });
      }
    }

    const password = userProvidedPassword || generatePassword();

    // ── Validate input params ────────────────────────────────
    if (plan && !ALLOWED_PLANS.has(plan)) {
      return res.status(400).json({ error: 'Gói dịch vụ không hợp lệ.' });
    }
    if (billing && !ALLOWED_BILLINGS.has(billing)) {
      return res.status(400).json({ error: 'Chu kỳ thanh toán không hợp lệ.' });
    }
    const sanitizedDesc = desc && String(desc).length <= MAX_DESC_LENGTH ? String(desc) : undefined;

    const supabaseAdmin = getSupabaseAdmin();

    // ── Kiểm tra email đã tồn tại ─────────────────────────────
    const { data: existingByEmail } = await supabaseAdmin
      .from('users')
      .select('id, email, phone_verified')
      .eq('email', normalizedEmail)
      .maybeSingle();

    if (existingByEmail) {
      return res.status(400).json({
        error: 'Email này đã được đăng ký. Vui lòng đăng nhập hoặc khôi phục mật khẩu.',
        code: 'email_taken',
      });
    }

    // ── Kiểm tra SĐT đã tồn tại (nếu user cung cấp) ──────────
    if (normalizedPhone) {
      const { data: existingByPhone } = await supabaseAdmin
        .from('users')
        .select('id, phone_verified')
        .eq('phone', normalizedPhone)
        .maybeSingle();

      if (existingByPhone) {
        if (existingByPhone.phone_verified) {
          return res.status(400).json({
            error: 'Số điện thoại này đã có tài khoản. Vui lòng đăng nhập.',
            code: 'phone_taken',
          });
        }
        // SĐT chưa verify → giải phóng khỏi user cũ để tránh unique constraint
        await supabaseAdmin
          .from('users')
          .update({ phone: null, updated_at: new Date().toISOString() })
          .eq('id', existingByPhone.id);
      }
    }

    // ── Tạo user trong Supabase Auth ──────────────────────────
    // email_confirm = false → Supabase tự gửi email xác thực
    const { data, error } = await supabaseAdmin.auth.admin.createUser({
      email: normalizedEmail,
      password,
      email_confirm: false,
      user_metadata: {
        ...(normalizedPhone ? { phone: normalizedPhone } : {}),
        password_set: !!userProvidedPassword,
        ...(plan ? { plan } : {}),
        ...(billing ? { billing } : {}),
        ...(env ? { env } : {}),
        ...(icon ? { icon } : {}),
        ...(sanitizedDesc ? { desc: sanitizedDesc } : {}),
        ...(workstation ? { workstation } : {}),
        ...(trial === true ? { trial: true } : {}),
      },
    });

    if (error) {
      const message = String(error.message || error.code || 'Không tạo được tài khoản');
      return res.status(400).json({ error: message });
    }

    // ── Upsert vào public.users ───────────────────────────────
    const userRow = {
      id: data.user.id,
      email: normalizedEmail,
      email_verified: false,
      phone_verified: false,
    };
    if (normalizedPhone) userRow.phone = normalizedPhone;

    const { error: upsertError } = await supabaseAdmin.from('users').upsert(userRow);

    if (upsertError) {
      // Rollback: xóa user khỏi Auth để tránh orphan
      await supabaseAdmin.auth.admin.deleteUser(data.user.id).catch(() => {});
      throw upsertError;
    }

    // ── Audit log ─────────────────────────────────────────────
    await logAuthEvent(supabaseAdmin, 'register', {
      userId: data.user.id,
      email: normalizedEmail,
      phone: normalizedPhone,
      ip,
      userAgent: req.headers['user-agent'],
      metadata: { plan, billing, trial, hasPhone: !!normalizedPhone },
    });

    return res.status(200).json({
      userId: data.user.id,
      email: normalizedEmail,
      phone: normalizedPhone,
      message: 'Đăng ký thành công. Vui lòng kiểm tra email để xác thực tài khoản.',
      nextStep: 'verify_email',
      // Chỉ trả về password khi hệ thống tự tạo (user không tự đặt)
      ...(userProvidedPassword ? {} : { generatedPassword: password }),
    });
  } catch (err) {
    return res.status(500).json({ error: err.message || 'Đăng ký thất bại.' });
  }
}
