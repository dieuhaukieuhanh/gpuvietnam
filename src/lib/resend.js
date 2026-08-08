/**
 * Server-side Resend email utility.
 *
 * Sends emails through the Resend API using the RESEND_API_KEY env var.
 * Only call this from API routes or server-side code — never from the browser.
 */

const RESEND_API_URL = 'https://api.resend.com/emails';

/** @returns {string} */
function apiKey() {
  const key = process.env.RESEND_API_KEY;
  if (!key || key === 're_xxxxxxxx') {
    throw new Error('RESEND_API_KEY chưa được cấu hình. Vui lòng thêm vào .env.local');
  }
  return key;
}

/**
 * Send a transactional email via Resend.
 *
 * @param {object} opts
 * @param {string} opts.to        - Recipient email address
 * @param {string} opts.subject   - Email subject
 * @param {string} opts.html      - HTML body
 * @param {string} [opts.from]    - Sender (defaults to "GPUVietnam <notify@gpuvietnam.com>")
 * @param {string} [opts.replyTo] - Reply-to address
 * @returns {Promise<{id: string}>}
 */
export async function sendEmail({ to, subject, html, from, replyTo }) {
  const sender = from || 'GPUVietnam <notify@gpuvietnam.com>';

  const res = await fetch(RESEND_API_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey()}`,
    },
    body: JSON.stringify({
      from: sender,
      to,
      subject,
      html,
      ...(replyTo ? { reply_to: replyTo } : {}),
    }),
  });

  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(`Resend gửi thất bại (${res.status}): ${JSON.stringify(body)}`);
  }

  return res.json();
}

/**
 * Send a payment notification to the admin when a customer confirms payment.
 *
 * @param {object} order
 * @param {string} order.plan    - Plan name
 * @param {string} order.billing - Billing type
 * @param {string} order.email   - Customer email
 * @param {string} order.phone   - Customer phone
 * @param {string} order.env     - Environment name
 * @param {string} order.price   - Formatted price string
 */
export async function sendPaymentNotification(order) {
  const adminEmail = process.env.ADMIN_NOTIFY_EMAIL;
  if (!adminEmail) {
    throw new Error('ADMIN_NOTIFY_EMAIL chưa được cấu hình.');
  }

  return sendEmail({
    to: adminEmail,
    subject: `🔔 KH mới: Gói ${order.plan} - ${order.billing}`,
    html: `
      <h2>Có khách hàng xác nhận thanh toán!</h2>
      <p><strong>Email:</strong> ${order.email}</p>
      <p><strong>SĐT:</strong> ${order.phone}</p>
      <p><strong>Gói:</strong> ${order.plan}</p>
      <p><strong>Cách dùng:</strong> ${order.billing}</p>
      <p><strong>Số tiền:</strong> ${order.price}</p>
      <p><strong>Môi trường:</strong> ${order.env}</p>
      <p><strong>Thời gian:</strong> ${new Date().toLocaleString('vi-VN')}</p>
    `,
  });
}
