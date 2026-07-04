import { verifyAdmin } from '@/lib/admin-auth';
import { usdHourlyToVnd } from '@/lib/currency';
import {
  DEFAULT_INFRASTRUCTURE_FILTERS,
  filterInfrastructureRows,
} from '@/lib/infrastructure-shared';
import { fetchInfrastructureData } from '@/lib/infrastructure-providers';

function withVndPrice(row) {
  return {
    ...row,
    avg_price_10_vnd:
      row.avg_price_10_vnd ??
      (row.avg_price_10 > 0 ? usdHourlyToVnd(row.avg_price_10) : 0),
  };
}

function parseQueryFilters(query) {
  return {
    provider: typeof query.provider === 'string' ? query.provider : DEFAULT_INFRASTRUCTURE_FILTERS.provider,
    gpuLine:
      typeof query.gpu_line === 'string'
        ? query.gpu_line
        : typeof query.gpuLine === 'string'
          ? query.gpuLine
          : DEFAULT_INFRASTRUCTURE_FILTERS.gpuLine,
    region: typeof query.region === 'string' ? query.region : DEFAULT_INFRASTRUCTURE_FILTERS.region,
    status: typeof query.status === 'string' ? query.status : DEFAULT_INFRASTRUCTURE_FILTERS.status,
  };
}

function hasActiveFilters(filters) {
  return (
    filters.provider !== 'all' ||
    filters.gpuLine !== 'all' ||
    filters.region !== 'all' ||
    filters.status !== 'all'
  );
}

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  if (!(await verifyAdmin(req, res))) return;

  try {
    const filters = parseQueryFilters(req.query);
    const allItems = (await fetchInfrastructureData()).map(withVndPrice);
    const filtered = hasActiveFilters(filters)
      ? filterInfrastructureRows(allItems, filters)
      : allItems;

    return res.status(200).json({
      items: filtered,
      total: allItems.length,
      filtered: filtered.length,
      filters,
    });
  } catch (err) {
    console.error('[admin/infrastructure]', err);
    return res.status(500).json({ error: err.message || 'Không tải được dữ liệu hạ tầng.' });
  }
}
