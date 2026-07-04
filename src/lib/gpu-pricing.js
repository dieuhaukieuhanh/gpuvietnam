/**
 * Định nghĩa giá GPU — nơi DUY NHẤT để sửa giá bán.
 * Giá vốn Vast.ai (tham chiếu): 3090 5.500đ/h · 4090 1x 11.000đ/h · 4090 2x 21.000đ/h
 */

export const GPU_PLANS = {
  starter: {
    name: 'Starter',
    gpu: 'RTX 3090',
    vram: '24GB',
    price_per_hour: 9_900,
    combo1: { hours: 100, bonus: 10, days: 45, price: 990_000 },
    combo2: { hours: 200, bonus: 30, days: 120, price: 1_980_000 },
  },
  pro: {
    name: 'Pro',
    gpu: 'RTX 4090',
    vram: '24GB',
    price_per_hour: 22_000,
    combo1: { hours: 100, bonus: 10, days: 45, price: 2_200_000 },
    combo2: { hours: 200, bonus: 30, days: 120, price: 4_400_000 },
    badge: 'Phổ biến nhất',
  },
  studio: {
    name: 'Studio',
    gpu: '2x RTX 4090',
    vram: '48GB',
    price_per_hour: 40_000,
    combo1: { hours: 100, bonus: 10, days: 45, price: 4_000_000 },
    combo2: { hours: 200, bonus: 30, days: 120, price: 8_000_000 },
  },
};

/** Gói đang dùng — cập nhật từ DB qua applyRuntimeGpuPlans(). */
let activeGpuPlans = GPU_PLANS;

export function applyRuntimeGpuPlans(plans) {
  if (plans && typeof plans === 'object') {
    activeGpuPlans = plans;
  }
}

function getActivePlans() {
  return activeGpuPlans;
}

export const PLAN_ORDER = ['starter', 'pro', 'studio'];

export const PLAN_NAME_TO_KEY = {
  Starter: 'starter',
  Pro: 'pro',
  Studio: 'studio',
};

export const BILLING_MODES = ['hourly', 'combo1', 'combo2'];

export function getPlanKeyFromName(name) {
  return PLAN_NAME_TO_KEY[name] ?? null;
}

export function getPlanNameFromKey(key) {
  return getActivePlans()[key]?.name ?? key;
}

export function getPlanConfig(planKeyOrName) {
  const plans = getActivePlans();
  if (plans[planKeyOrName]) return plans[planKeyOrName];
  const key = getPlanKeyFromName(planKeyOrName);
  return key ? plans[key] : null;
}

/** @param {string} planKeyOrName - 'starter' | 'Pro' | ... */
/** @param {'hourly'|'combo1'|'combo2'} billingType */
export function getPlanPrice(planKeyOrName, billingType) {
  const plan = getPlanConfig(planKeyOrName);
  if (!plan) return 0;
  if (billingType === 'hourly') return plan.price_per_hour;
  if (billingType === 'combo1') return plan.combo1.price;
  if (billingType === 'combo2') return plan.combo2.price;
  return 0;
}

export function formatCurrency(amount) {
  return `${new Intl.NumberFormat('vi-VN').format(amount)}đ`;
}

export function getGpuLabel(planKey) {
  const plan = getActivePlans()[planKey];
  if (!plan) return 'GPU đang cấp phát';
  if (planKey === 'studio') {
    return `${plan.gpu} — ${plan.vram} VRAM (2x24GB riêng biệt)`;
  }
  return `${plan.gpu} — ${plan.vram} VRAM`;
}

export function getGpuLabelByName(planName) {
  const key = getPlanKeyFromName(planName);
  return key ? getGpuLabel(key) : 'GPU đang cấp phát';
}

export function getComboPackage(planKeyOrName, billingType) {
  const plan = getPlanConfig(planKeyOrName);
  if (!plan || billingType === 'hourly') return null;
  return plan[billingType] ?? null;
}

export function getComboTotalHours(planKeyOrName, billingType) {
  const combo = getComboPackage(planKeyOrName, billingType);
  if (!combo) return 0;
  return combo.hours + combo.bonus;
}

export function getPlanQuota(planName, billing) {
  const combo = getComboPackage(planName, billing);
  if (!combo) {
    return { hoursTotal: 0, validityDays: null };
  }
  return {
    hoursTotal: combo.hours + combo.bonus,
    validityDays: combo.days,
  };
}

export function formatBillingLabel(billing) {
  if (billing === 'hourly') return 'Gói Đơn (Theo giờ)';
  const sample = getActivePlans().starter;
  if (billing === 'combo1') {
    const c = sample.combo1;
    return `Combo1 (${c.hours}h+${c.bonus}h · ${c.days} ngày)`;
  }
  if (billing === 'combo2') {
    const c = sample.combo2;
    return `Combo2 (${c.hours}h+${c.bonus}h · ${c.days} ngày)`;
  }
  return billing ?? '—';
}

export function formatGpuConfigShort(planName) {
  const key = getPlanKeyFromName(planName);
  const plan = getActivePlans()[key];
  if (!plan) return planName ?? '—';
  if (key === 'studio') return `${planName} · 2x RTX 4090 (48GB)`;
  return `${planName} · ${plan.gpu} (${plan.vram})`;
}

export function buildHourlyPricingNote(planKey) {
  const plan = getActivePlans()[planKey];
  if (!plan) return '';
  return `Trả theo giờ thực dùng · ${plan.gpu} ${plan.vram}`;
}

export function buildComboPricingNote(planKey, comboType) {
  const combo = getActivePlans()[planKey]?.[comboType];
  if (!combo) return '';
  return `${combo.hours} giờ + tặng ${combo.bonus} giờ · Hiệu lực ${combo.days} ngày`;
}

/** Dữ liệu hiển thị giá cho checkout / trang chủ */
export function buildPlanPricingDisplay(planKey) {
  const plan = getActivePlans()[planKey];
  if (!plan) {
    return {
      hourly: { price: '—', unit: '', note: '' },
      combo1: { price: '—', unit: '', note: '' },
      combo2: { price: '—', unit: '', note: '' },
    };
  }
  return {
    hourly: {
      price: formatCurrency(plan.price_per_hour),
      unit: '/giờ',
      note: buildHourlyPricingNote(planKey),
    },
    combo1: {
      price: formatCurrency(plan.combo1.price),
      unit: '',
      note: buildComboPricingNote(planKey, 'combo1'),
    },
    combo2: {
      price: formatCurrency(plan.combo2.price),
      unit: '',
      note: buildComboPricingNote(planKey, 'combo2'),
    },
  };
}

/** Legacy alias */
export function getPlanPriceVnd(planName, billing) {
  return getPlanPrice(planName, billing);
}

export const PLAN_PRICES_VND = Object.fromEntries(
  Object.entries(PLAN_NAME_TO_KEY).map(([name]) => [
    name,
    {
      hourly: getPlanPrice(name, 'hourly'),
      combo1: getPlanPrice(name, 'combo1'),
      combo2: getPlanPrice(name, 'combo2'),
    },
  ]),
);
