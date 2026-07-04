import { toSpeedSmsPhone } from '@/lib/phone';

export async function sendOtpSms(phone, otp) {
  const accessToken = process.env.SPEEDSMS_ACCESS_TOKEN;

  if (!accessToken) {
    if (process.env.NODE_ENV === 'development') {
      console.info(`[DEV OTP] ${phone}: ${otp}`);
      return { success: true, dev: true };
    }
    throw new Error('Thiếu SPEEDSMS_ACCESS_TOKEN');
  }

  const content = `GPUVietnam: Ma xac thuc cua ban la ${otp}. Hieu luc 5 phut.`;
  const response = await fetch('https://api.speedsms.vn/index.php/sms/send', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${accessToken}`,
    },
    body: JSON.stringify({
      to: [toSpeedSmsPhone(phone)],
      content,
      sms_type: 2,
      sender: process.env.SPEEDSMS_SENDER || '',
    }),
  });

  const result = await response.json().catch(() => ({}));

  if (!response.ok || result.status === 'error') {
    throw new Error(result.message || 'Không gửi được SMS OTP');
  }

  return { success: true };
}
