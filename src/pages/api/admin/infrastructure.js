import { verifyAdmin } from '@/lib/admin-auth';
import { fetchInfrastructureData } from '@/lib/infrastructure-providers';

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  if (!(await verifyAdmin(req, res))) return;

  try {
    const items = await fetchInfrastructureData();

    return res.status(200).json({ items });
  } catch (err) {
    console.error('[admin/infrastructure]', err);
    return res.status(500).json({ error: err.message || 'Không tải được dữ liệu hạ tầng.' });
  }
}