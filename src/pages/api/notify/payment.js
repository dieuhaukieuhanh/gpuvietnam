/**
 * POST /api/notify/payment
 *
 * Gửi email thông báo thanh toán cho admin qua Resend.
 * API key được giữ phía server, không lộ ra client.
 */
import { sendPaymentNotification } from '@/lib/resend';

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { plan, billing, email, phone, env, price } = req.body || {};

    if (!plan || !billing || !email || !phone || !env || !price) {
      return res.status(400).json({ error: 'Thiếu thông tin đơn hàng.' });
    }

    const result = await sendPaymentNotification({
      plan,
      billing,
      email,
      phone,
      env,
      price,
    });

    return res.status(200).json({ success: true, id: result.id });
  } catch (err) {
    console.error('[notify/payment]', err.message);
    return res.status(500).json({ error: 'Không gửi được email thông báo.' });
  }
}
