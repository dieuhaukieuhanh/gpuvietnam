import { getAuthUserFromRequest, unauthorized } from '@/lib/api-auth';

/** Khách hàng không thể tự gửi yêu cầu hỗ trợ — chỉ Admin khởi tạo. */
export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const user = await getAuthUserFromRequest(req);
  if (!user) return unauthorized(res);

  return res.status(403).json({
    error: 'Chỉ Admin mới có thể gửi yêu cầu hỗ trợ từ xa. Vui lòng chờ thông báo trên chuông 🔔.',
  });
}
