import { verifyAdmin } from '@/lib/admin-auth';
import { fetchAdminCustomerStats, formatVndShort } from '@/lib/admin-customers';

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  if (!(await verifyAdmin(req, res))) return;

  try {
    const stats = await fetchAdminCustomerStats();
    return res.status(200).json({
      ...stats,
      formattedAvgRevenue: formatVndShort(stats.avgRevenuePerCustomer),
      formattedTotalRevenue: formatVndShort(stats.totalRevenue),
    });
  } catch (err) {
    console.error('[admin/customer-stats]', err);
    return res.status(500).json({ error: err.message || 'Không tải được thống kê khách hàng.' });
  }
}
