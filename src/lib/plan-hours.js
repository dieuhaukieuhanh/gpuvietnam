/** @deprecated Import từ @/lib/gpu-pricing — file này giữ tương thích ngược */
export {
  getComboTotalHours,
  getGpuLabelByName as getGpuLabel,
  getPlanQuota,
} from './gpu-pricing';

export { TRIAL_HOURS, TRIAL_VALIDITY_DAYS } from './plan-trial';

export function computeExpiresAt(validityDays) {
  if (!validityDays) return null;
  const d = new Date();
  d.setDate(d.getDate() + validityDays);
  return d.toISOString();
}
