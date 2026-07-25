/**
 * Runtime GPU plan prices (billing / settlement).
 * Live SoT: Admin Edit giá → `gpu_pricing_config` (loaded via applyRuntimeGpuPlans).
 * Seed below mirrors `gpu-pricing-defaults.js` only for cold start / tests.
 */

import { DEFAULT_BILLING_VALIDITY, getDefaultGpuPricingConfig } from '@/lib/gpu-pricing-defaults';

function buildSeedGpuPlans() {
  const plans = {};
  for (const plan of getDefaultGpuPricingConfig().plans) {
    const entry = {
      name: plan.name,
      gpu: plan.gpu,
      vram: plan.vram,
      price_per_hour: plan.pricePerHour,
      combo1: { ...plan.combo1 },
      combo2: { ...plan.combo2 },
    };
    if (plan.badge) entry.badge = plan.badge;
    plans[plan.planKey] = entry;
  }
  return plans;
}

export const GPU_PLANS = buildSeedGpuPlans();

/** Gói đang dùng — cập nhật từ DB qua applyRuntimeGpuPlans(). */
let activeGpuPlans = GPU_PLANS;
let activeHourlyValidityDays = DEFAULT_BILLING_VALIDITY.hourlyDays;

export function applyRuntimeGpuPlans(plans) {
  if (plans && typeof plans === 'object') {
    activeGpuPlans = plans;
  }
}

export function applyRuntimeBillingValidity(billingValidity) {
  const days = Number(billingValidity?.hourlyDays);
  if (Number.isFinite(days) && days > 0) {
    activeHourlyValidityDays = Math.round(days);
  }
}

export function getHourlyValidityDays() {
  return activeHourlyValidityDays;
}

function getActivePlans() {
  return activeGpuPlans;
}

export const PLAN_ORDER = ['starter', 'pro', 'studio'];

export const PLAN_NAME_TO_KEY = {
  Starter: 'starter',
  'AI Starter': 'starter',
  Pro: 'pro',
  'AI Pro': 'pro',
  Studio: 'studio',
  'AI Studio': 'studio',
};

export const BILLING_MODES = ['hourly', 'combo1', 'combo2'];

export function getPlanKeyFromName(name) {
  if (name == null) return null;
  const trimmed = String(name).trim();
  if (!trimmed) return null;
  if (Object.prototype.hasOwnProperty.call(PLAN_NAME_TO_KEY, trimmed)) {
    return PLAN_NAME_TO_KEY[trimmed];
  }
  const lower = trimmed.toLowerCase();
  if (lower === 'starter' || lower === 'pro' || lower === 'studio') return lower;
  // Exact display-name match, case-insensitive
  for (const [label, key] of Object.entries(PLAN_NAME_TO_KEY)) {
    if (label.toLowerCase() === lower) return key;
  }
  return null;
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

export function normalizeHourlyPurchaseHours(value) {
  const hours = Math.floor(Number(value));
  if (!Number.isFinite(hours) || hours < 1) return 1;
  return hours;
}

/**
 * @param {string} planKeyOrName
 * @param {'hourly'|'combo1'|'combo2'} billing
 * @param {number|null|undefined} [hourlyHours]
 */
export function getPlanPurchaseHours(planKeyOrName, billing, hourlyHours = null) {
  if (billing === 'hourly') {
    return normalizeHourlyPurchaseHours(hourlyHours);
  }
  return getPlanQuota(planKeyOrName, billing).hoursTotal;
}

/**
 * @param {string} planKeyOrName
 * @param {'hourly'|'combo1'|'combo2'} billing
 * @param {number|null|undefined} [hourlyHours]
 */
export function getPlanPurchaseAmount(planKeyOrName, billing, hourlyHours = null) {
  if (billing === 'hourly') {
    return getPlanPrice(planKeyOrName, 'hourly') * normalizeHourlyPurchaseHours(hourlyHours);
  }
  return getPlanPrice(planKeyOrName, billing);
}

export function formatCurrency(amount) {
  return `${new Intl.NumberFormat('vi-VN').format(amount)}đ`;
}

export function getGpuLabel(planKey) {
  const plan = getActivePlans()[planKey];
  if (!plan) return 'GPU đang cấp phát';
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

/** Proactive renew / purchase preview reward rate (5%). */
export const COMBO_PURCHASE_REWARD_RATE = 0.05;

export function computeComboRewardHours(baseHours, rate = COMBO_PURCHASE_REWARD_RATE) {
  if (!baseHours || rate <= 0) return 0;
  return Math.max(1, Math.floor(baseHours * rate));
}

/**
 * @param {string} planKeyOrName
 * @param {'combo1' | 'combo2'} billingType
 * @param {{ rewardRate?: number; includeReward?: boolean }} [options]
 */
export function formatComboHoursBreakdown(planKeyOrName, billingType, options = {}) {
  const combo = getComboPackage(planKeyOrName, billingType);
  if (!combo) return null;
  const includeReward = options.includeReward !== false;
  const rewardRate = options.rewardRate ?? COMBO_PURCHASE_REWARD_RATE;
  const rewardHours = includeReward ? computeComboRewardHours(combo.hours, rewardRate) : 0;
  const parts = [`${combo.hours}h`, `${combo.bonus}h tặng`];
  if (rewardHours > 0) {
    parts.push(`${rewardHours}h thưởng`);
  }
  return {
    baseHours: combo.hours,
    giftHours: combo.bonus,
    rewardHours,
    line: parts.join(' + '),
  };
}

export function getPlanQuota(planName, billing) {
  if (billing === 'hourly') {
    return { hoursTotal: 0, validityDays: getHourlyValidityDays() };
  }
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
  if (billing === 'hourly') {
    return `Gói Đơn (Theo giờ · ${getHourlyValidityDays()} ngày)`;
  }
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
  if (key === 'studio') return `${planName} · RTX 5090 (32GB)`;
  return `${planName} · ${plan.gpu} (${plan.vram})`;
}

export function buildHourlyPricingNote(planKey) {
  const plan = getActivePlans()[planKey];
  if (!plan) return '';
  return `Trả theo giờ thực dùng · Hiệu lực ${getHourlyValidityDays()} ngày · ${plan.gpu} ${plan.vram}`;
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
