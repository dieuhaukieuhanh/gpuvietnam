/** Tỷ giá quy đổi USD → VNĐ (cập nhật tại đây khi thay đổi). */
export const USD_TO_VND = 27000;

/**
 * Quy đổi giá USD/giờ sang VNĐ/giờ (làm tròn).
 * @param {number} usdPerHour
 * @returns {number}
 */
export function usdHourlyToVnd(usdPerHour) {
  const usd = Number(usdPerHour);
  if (!Number.isFinite(usd) || usd <= 0) return 0;
  return Math.round(usd * USD_TO_VND);
}

/**
 * Hiển thị giá VNĐ/giờ: ~ 8.640đ/h
 * @param {number} vndPerHour
 * @returns {string}
 */
export function formatVndPerHour(vndPerHour) {
  const vnd = Number(vndPerHour);
  if (!Number.isFinite(vnd) || vnd <= 0) return '—';
  const formatted = new Intl.NumberFormat('vi-VN').format(vnd);
  return `~ ${formatted}đ/h`;
}
