/**
 * Zalo ZNS (Zalo Notification Service) — gửi OTP qua Zalo.
 * Fallback sang SMS Speedsms nếu ZNS không khả dụng hoặc user không có Zalo.
 *
 * ZNS hoạt động qua template đã được Zalo phê duyệt trước.
 * Template OTP cần được tạo tại: https://oa.zalo.me
 *
 * API ref: https://developers.zalo.me/docs/official-account/zns
 */

/**
 * Gửi OTP qua Zalo ZNS.
 * Nếu ZNS chưa được cấu hình hoặc gửi thất bại → fallback sang SMS.
 *
 * @param {string} phone — SĐT đã normalize (dạng 0xxxxxxxxx)
 * @param {string} otp  — Mã OTP 6 chữ số
 * @returns {Promise<{success: boolean, channel: 'zalo'|'sms', dev?: boolean}>}
 */
export async function sendOtp(phone, otp) {
  // Thử Zalo ZNS trước nếu được cấu hình
  const znsConfigured = !!process.env.ZALO_OA_ACCESS_TOKEN;
  if (znsConfigured) {
    try {
      const result = await sendZnsOtp(phone, otp);
      if (result.success) return { success: true, channel: 'zalo' };
      // ZNS fail → fallback xuống SMS bên dưới
    } catch (err) {
      console.warn('[zalo-zns] ZNS failed, falling back to SMS:', err.message);
    }
  }

  // Fallback SMS qua Speedsms
  const { sendOtpSms } = await import('./speedsms');
  const smsResult = await sendOtpSms(phone, otp);
  return { success: smsResult.success, channel: 'sms', dev: smsResult.dev };
}

/**
 * Gửi OTP qua Zalo ZNS API.
 * @param {string} phone — SĐT chuẩn hóa 0xxxxxxxxx
 * @param {string} otp   — Mã OTP 6 số
 * @returns {Promise<{success: boolean}>}
 */
async function sendZnsOtp(phone, otp) {
  const accessToken = process.env.ZALO_OA_ACCESS_TOKEN;
  const templateId = process.env.ZALO_OTP_TEMPLATE_ID;

  if (!accessToken) {
    throw new Error('Thiếu ZALO_OA_ACCESS_TOKEN');
  }

  if (!templateId) {
    throw new Error('Thiếu ZALO_OTP_TEMPLATE_ID');
  }

  // Chuyển SĐT sang định dạng Zalo: 84xxxxxxxxx (bỏ số 0 đầu)
  const zaloPhone = phone.startsWith('0') ? `84${phone.slice(1)}` : phone;

  const response = await fetch('https://business.openapi.zalo.me/message/template', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'access_token': accessToken,
    },
    body: JSON.stringify({
      phone: zaloPhone,
      template_id: templateId,
      template_data: {
        otp,                           // {{otp}} trong template
        otp1: otp[0], otp2: otp[1],   // Hoặc từng chữ số riêng
        otp3: otp[2], otp4: otp[3],
        otp5: otp[4], otp6: otp[5],
      },
      tracking_id: `otp_${Date.now()}_${phone.slice(-4)}`,
    }),
  });

  const result = await response.json().catch(() => ({}));

  if (!response.ok || result.error !== 0) {
    const msg = result.message || `ZNS status ${response.status}`;
    throw new Error(`ZNS gửi thất bại: ${msg}`);
  }

  return { success: true };
}
