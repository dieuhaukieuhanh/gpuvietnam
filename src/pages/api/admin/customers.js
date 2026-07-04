import { verifyAdmin } from '@/lib/admin-auth';
import { fetchAdminCustomers } from '@/lib/admin-customers';

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  if (!(await verifyAdmin(req, res))) return;

  try {
    const result = await fetchAdminCustomers(req.query);
    res.setHeader('Cache-Control', 'no-store, max-age=0');
    return res.status(200).json(result);
  } catch (err) {
    console.error('[admin/customers]', err);
    return res.status(500).json({ error: err.message || 'Không tải được danh sách khách hàng.' });
  }
}
