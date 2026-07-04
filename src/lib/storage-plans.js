export const VALID_PLAN_GB = [10, 20, 50, 100];

export const SSD_PLANS = {
  10: 29_000,
  20: 49_000,
  50: 99_000,
  100: 179_000,
};

export const BACKUP_PLANS = {
  10: 19_000,
  20: 29_000,
  50: 69_000,
  100: 129_000,
};

export function isValidPlanGb(gb) {
  return VALID_PLAN_GB.includes(Number(gb));
}

export function calcStoragePricing(currentSsdGb, currentBackupGb, requestedSsdGb, requestedBackupGb) {
  return calcStoragePricingFromMaps(
    SSD_PLANS,
    BACKUP_PLANS,
    currentSsdGb,
    currentBackupGb,
    requestedSsdGb,
    requestedBackupGb,
  );
}

export function calcStoragePricingFromMaps(
  ssdPlans,
  backupPlans,
  currentSsdGb,
  currentBackupGb,
  requestedSsdGb,
  requestedBackupGb,
) {
  const ssdDiff = (ssdPlans[requestedSsdGb] ?? 0) - (ssdPlans[currentSsdGb] ?? 0);
  const backupDiff = (backupPlans[requestedBackupGb] ?? 0) - (backupPlans[currentBackupGb] ?? 0);
  const priceChangePerMonth = ssdDiff + backupDiff;
  const totalAmount = Math.max(0, priceChangePerMonth);

  return {
    ssdDiff,
    backupDiff,
    priceChangePerMonth,
    totalAmount,
  };
}

export function rowsToPricingMaps(rows) {
  const ssdPlans = {};
  const backupPlans = {};

  for (const row of rows ?? []) {
    const price = Number(row.price_monthly);
    if (row.storage_type === 'ssd') ssdPlans[row.size_gb] = price;
    else if (row.storage_type === 'backup') backupPlans[row.size_gb] = price;
  }

  return { ssdPlans, backupPlans };
}

export async function loadStoragePricingRows(supabaseAdmin, { activeOnly = false } = {}) {
  let query = supabaseAdmin
    .from('storage_pricing')
    .select('id, storage_type, size_gb, price_monthly, is_active, updated_at')
    .order('storage_type')
    .order('size_gb');

  if (activeOnly) {
    query = query.eq('is_active', true);
  }

  const { data, error } = await query;
  if (error) throw error;
  return data ?? [];
}

export async function getStoragePricingMaps(supabaseAdmin, { activeOnly = false } = {}) {
  const rows = await loadStoragePricingRows(supabaseAdmin, { activeOnly });

  if (rows.length === 0) {
    return {
      ssdPlans: { ...SSD_PLANS },
      backupPlans: { ...BACKUP_PLANS },
    };
  }

  const { ssdPlans, backupPlans } = rowsToPricingMaps(rows);

  return {
    ssdPlans: activeOnly ? ssdPlans : { ...SSD_PLANS, ...ssdPlans },
    backupPlans: activeOnly ? backupPlans : { ...BACKUP_PLANS, ...backupPlans },
  };
}

/**
 * Lấy giá một mức từ storage_pricing (fallback hardcode nếu chưa seed DB).
 */
export async function getStoragePrice(supabaseAdmin, storageType, sizeGb, { activeOnly = true } = {}) {
  const { data, error } = await supabaseAdmin
    .from('storage_pricing')
    .select('price_monthly, is_active')
    .eq('storage_type', storageType)
    .eq('size_gb', sizeGb)
    .maybeSingle();

  if (error) throw error;

  if (!data || (activeOnly && !data.is_active)) {
    const fallback = storageType === 'ssd' ? SSD_PLANS : BACKUP_PLANS;
    return fallback[sizeGb] ?? 0;
  }

  return Number(data.price_monthly);
}

export function planBytes(gb) {
  return gb * 1024 ** 3;
}

export function isPlanBlocked(used, gb) {
  return used > planBytes(gb);
}

export async function getUserStorageUsage(supabaseAdmin, userId) {
  const { data, error } = await supabaseAdmin
    .from('storage_files')
    .select('storage_type, file_size_bytes')
    .eq('user_id', userId);

  if (error) throw error;

  let ssdUsed = 0;
  let backupUsed = 0;

  for (const row of data ?? []) {
    const size = Number(row.file_size_bytes) || 0;
    if (row.storage_type === 'ssd') ssdUsed += size;
    else if (row.storage_type === 'backup') backupUsed += size;
  }

  return { ssdUsed, backupUsed };
}

export function validateStorageDowngrade(ssdUsed, backupUsed, requestedSsdGb, requestedBackupGb) {
  const errors = [];

  if (ssdUsed > planBytes(requestedSsdGb)) {
    errors.push({
      field: 'ssd',
      message: `SSD đang dùng ${(ssdUsed / 1024 ** 3).toFixed(1)}GB, không thể hạ xuống ${requestedSsdGb}GB.`,
    });
  }

  if (backupUsed > planBytes(requestedBackupGb)) {
    errors.push({
      field: 'backup',
      message: `Backup đang dùng ${(backupUsed / 1024 ** 3).toFixed(1)}GB, không thể hạ xuống ${requestedBackupGb}GB.`,
    });
  }

  return errors;
}

export async function applyUserStoragePlan(supabaseAdmin, userId, ssdGb, backupGb) {
  const { error } = await supabaseAdmin
    .from('users')
    .update({
      ssd_plan_gb: ssdGb,
      backup_plan_gb: backupGb,
      updated_at: new Date().toISOString(),
    })
    .eq('id', userId);

  if (error) throw error;
}
