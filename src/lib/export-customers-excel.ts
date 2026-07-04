import {
  formatSessionDurationShort,
  type AdminCustomerRow,
  type ChurnRiskLevel,
  type CustomerStats,
} from '@/lib/admin-customers-shared';

function churnLabel(level: ChurnRiskLevel): string {
  if (level === 'high') return 'Cao';
  if (level === 'medium') return 'Trung bình';
  return 'Thấp';
}

function formatLastAccess(iso: string | null): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString('vi-VN', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function exportFilename(): string {
  const now = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  const stamp = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}_${pad(now.getHours())}-${pad(now.getMinutes())}`;
  return `khach-hang-gpuvietnam-${stamp}.xlsx`;
}

function customerRowsToSheet(rows: AdminCustomerRow[]) {
  return rows.map((row) => {
    const hoursPct =
      row.totalHours > 0 ? Math.round((row.hoursLeft / row.totalHours) * 1000) / 10 : 0;
    return {
      'Mã KH': row.id,
      'Họ tên': row.name,
      Email: row.email,
      Gói: row.plan,
      'Giờ còn': row.hoursLeft,
      'Tổng giờ gói': row.totalHours,
      '% Giờ còn': hoursPct,
      'Lần cuối truy cập': formatLastAccess(row.lastAccess),
      Workflow: row.workflow,
      Model: row.model,
      'Hành trình': row.journey,
      'Doanh thu (VND)': row.revenue,
      'Giờ TB/ngày': row.avgDaily,
      'Churn Risk': churnLabel(row.churnRisk),
      'Điểm Churn': row.churnScore,
      'Phiên/tuần': row.sessionsPerWeek,
      'Lịch sử gói': row.history.join(' → '),
      Region: row.region,
      'Đang sử dụng': row.isUsing ? 'Có' : 'Không',
      'Trạng thái':
        row.realtimeStatus === 'online'
          ? `Online · ${formatSessionDurationShort(row.currentSessionDuration)}`
          : row.realtimeStatus === 'hasPlan'
            ? 'Có gói'
            : 'Hết giờ',
      'Template hiện tại': row.currentTemplate ?? '',
      'Cảnh báo': row.anomalies.map((a) => a.label).join(', '),
      'Mức cảnh báo':
        row.anomalyLevel === 'high'
          ? 'Nghiêm trọng'
          : row.anomalyLevel === 'medium'
            ? 'Cần theo dõi'
            : row.anomalyLevel === 'low'
              ? 'Thấp'
              : 'Không',
    };
  });
}

function statsToSheet(stats: CustomerStats) {
  const rows: (string | number)[][] = [
    ['Chỉ số', 'Giá trị'],
    ['Tổng khách hàng', stats.totalCustomers],
    ['Mới trong tháng', stats.newThisMonth],
    ['Đang sử dụng', stats.activeUsing],
    ['Còn giờ', stats.withHours],
    ['Doanh thu bình quân/KH (VND)', stats.avgRevenuePerCustomer],
    ['Tổng doanh thu (VND)', stats.totalRevenue],
    ['Tỷ lệ tái gia hạn (%)', stats.retentionRate],
    ['Thay đổi retention (%)', stats.retentionDelta],
    ['Giờ cao điểm — Sáng (%)', stats.peakHours.morning],
    ['Giờ cao điểm — Chiều (%)', stats.peakHours.afternoon],
    ['Giờ cao điểm — Tối (%)', stats.peakHours.evening],
    ['Ghi chú giờ cao điểm', stats.peakHourNote],
    ['Ghi chú GPU/Template', stats.templateNote],
  ];

  stats.gpuRegions.forEach((region) => {
    rows.push([`GPU — ${region.label} (%)`, region.percent]);
  });

  return rows;
}

const CUSTOMER_COL_WIDTHS = [
  { wch: 10 },
  { wch: 22 },
  { wch: 28 },
  { wch: 10 },
  { wch: 10 },
  { wch: 12 },
  { wch: 10 },
  { wch: 20 },
  { wch: 12 },
  { wch: 14 },
  { wch: 22 },
  { wch: 14 },
  { wch: 12 },
  { wch: 14 },
  { wch: 10 },
  { wch: 10 },
  { wch: 28 },
  { wch: 12 },
  { wch: 14 },
  { wch: 14 },
];

/**
 * Tải file .xlsx danh sách khách hàng (và sheet thống kê nếu có).
 */
export async function exportCustomersToExcel(
  rows: AdminCustomerRow[],
  stats?: CustomerStats | null,
): Promise<void> {
  if (rows.length === 0) {
    throw new Error('Không có dữ liệu để xuất.');
  }

  const XLSX = await import('xlsx');
  const workbook = XLSX.utils.book_new();

  const customerSheet = XLSX.utils.json_to_sheet(customerRowsToSheet(rows));
  customerSheet['!cols'] = CUSTOMER_COL_WIDTHS;
  XLSX.utils.book_append_sheet(workbook, customerSheet, 'Khách hàng');

  if (stats) {
    const statsSheet = XLSX.utils.aoa_to_sheet(statsToSheet(stats));
    statsSheet['!cols'] = [{ wch: 28 }, { wch: 36 }];
    XLSX.utils.book_append_sheet(workbook, statsSheet, 'Thống kê');
  }

  XLSX.writeFile(workbook, exportFilename());
}
