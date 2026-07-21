/**
 * Plan card display helpers (client-safe — no server imports).
 */

import { formatDisplayHours } from '@/lib/dashboard-session-display';
import {
  formatComboHoursBreakdown,
  getPlanKeyFromName,
  getPlanNameFromKey,
  getPlanPrice,
  getPlanPurchaseAmount,
  getPlanQuota,
  formatCurrency,
  PLAN_ORDER,
} from '@/lib/gpu-pricing';

export const PURCHASE_BILLING_MODES = ['hourly', 'combo1', 'combo2'];

export const BILLING_PACKAGE_LABELS = {
  hourly: 'Giờ lẻ',
  combo1: 'Combo 1',
  combo2: 'Combo 2',
  gift: 'Tặng',
};

export function resolvePlanCardTotalHours(planInventoryTotalHours, subscriptionPackageHours) {
  if (planInventoryTotalHours != null && Number(planInventoryTotalHours) > 0) {
    return Number(planInventoryTotalHours);
  }
  if (subscriptionPackageHours != null && Number(subscriptionPackageHours) > 0) {
    return Number(subscriptionPackageHours);
  }
  return null;
}

/**
 * Reconcile plan card hours with billingView (M2 - same source as dashboard).
 */
export function resolvePlanCardHours({
  inventoryHoursRemaining = null,
  inventoryHoursTotal = null,
  subscriptionPackageHours = null,
  billingView = null,
} = {}) {
  const inventoryTotal =
    inventoryHoursTotal != null && Number(inventoryHoursTotal) > 0
      ? Number(inventoryHoursTotal)
      : null;
  const subscriptionTotal =
    subscriptionPackageHours != null && Number(subscriptionPackageHours) > 0
      ? Number(subscriptionPackageHours)
      : null;
  const planCardTotal =
    resolvePlanCardTotalHours(inventoryTotal, subscriptionTotal) ??
    (billingView?.planCardTotalHours != null
      ? Number(billingView.planCardTotalHours)
      : null);

  let hoursRemaining;
  if (inventoryHoursRemaining != null) {
    hoursRemaining = Math.max(0, Number(inventoryHoursRemaining));
  } else if (billingView?.planCardRemainingHours != null) {
    hoursRemaining = Math.max(0, Number(billingView.planCardRemainingHours));
  } else {
    hoursRemaining = 0;
  }

  hoursRemaining = clampPlanCardRemainingHours(hoursRemaining);

  return { hoursTotal: planCardTotal ?? 0, hoursRemaining };
}

export function clampPlanCardRemainingHours(value) {
  if (value == null || !Number.isFinite(Number(value))) return 0;
  return Math.max(0, Number(value));
}

export function resolvePlanCardValidUntil(inventoryValidUntil, subscriptionExpiresAt) {
  if (subscriptionExpiresAt) return subscriptionExpiresAt;
  return inventoryValidUntil ?? null;
}

export function resolveInventoryBillingMode(plan) {
  if (plan.planType === 'gift' || plan.billing === 'gift') return 'gift';
  if (plan.billing === 'hourly' || plan.billing === 'combo1' || plan.billing === 'combo2') {
    return plan.billing;
  }
  return plan.planType === 'hourly' ? 'hourly' : 'combo1';
}

export function daysUntilExpiry(validUntil) {
  if (!validUntil) return null;
  const endMs = new Date(validUntil).getTime();
  if (!Number.isFinite(endMs)) return null;
  const diffMs = endMs - Date.now();
  if (diffMs <= 0) return 0;
  return Math.ceil(diffMs / (24 * 60 * 60 * 1000));
}

export function formatPackageRemainingLine(hoursRemaining, validUntil) {
  const hoursLabel = formatDisplayHours(hoursRemaining);
  const days = daysUntilExpiry(validUntil);
  if (days == null) return `${hoursLabel} còn lại ▪ Không giới hạn`;
  if (days === 0) return `${hoursLabel} còn lại ▪ Hết hạn`;
  return `${hoursLabel} còn lại ▪ ${days} ngày`;
}

export function treeBranchPrefix(index, total) {
  if (total <= 1) return '└── ';
  return index === total - 1 ? '└── ' : '├── ';
}

export function formatPurchasePackageLine(hoursLabel, validityDays) {
  if (validityDays == null) return `${hoursLabel} ▪ Không giới hạn`;
  return `${hoursLabel} ▪ ${validityDays} ngày`;
}

export function formatPurchaseValiditySuffix(validityDays) {
  if (validityDays == null) return '▪ Không giới hạn';
  return `▪ ${validityDays} ngày`;
}

export function getTierPurchaseBillingOptions(tierKey) {
  const planName = getPlanNameFromKey(tierKey);
  return PURCHASE_BILLING_MODES.map((billing) => {
    const label = BILLING_PACKAGE_LABELS[billing];
    const quota = getPlanQuota(planName, billing);
    let hoursLabel = 'Theo giờ';
    if (billing !== 'hourly') {
      const breakdown = formatComboHoursBreakdown(planName, billing, { includeReward: false });
      hoursLabel = breakdown?.line ?? `${quota.hoursTotal}h`;
    }
    const detail = formatPurchasePackageLine(hoursLabel, quota.validityDays);
    const validitySuffix = formatPurchaseValiditySuffix(quota.validityDays);
    const unitPrice = getPlanPrice(planName, billing);
    const unitPriceLabel =
      billing === 'hourly' ? `${formatCurrency(unitPrice)}/giờ` : formatCurrency(unitPrice);
    const packagePrice = getPlanPurchaseAmount(planName, billing);
    return {
      billing,
      label,
      detail,
      validitySuffix,
      unitPrice,
      unitPriceLabel,
      packagePrice,
      packagePriceLabel: formatCurrency(packagePrice),
    };
  });
}

export function comparePlansByExpiry(a, b) {
  const aTime = a.validUntil ? new Date(a.validUntil).getTime() : Number.POSITIVE_INFINITY;
  const bTime = b.validUntil ? new Date(b.validUntil).getTime() : Number.POSITIVE_INFINITY;
  if (aTime !== bTime) return aTime - bTime;
  return Number(a.id ?? 0) - Number(b.id ?? 0);
}

/**
 * Display / burn order within a GPU tier: soonest `validUntil` first
 * (matches settlement-core compareSettlementPlanPriority).
 */
export function comparePlansByBurnOrder(a, b) {
  return comparePlansByExpiry(a, b);
}

const GROUPED_TIER_KEYS = new Set(['starter', 'pro', 'studio']);

function resolvePlanTierKey(item) {
  if (item?.planKey && GROUPED_TIER_KEYS.has(item.planKey)) return item.planKey;
  const key = getPlanKeyFromName(item?.planName) ?? (item?.planKey ?? null);
  if (key && GROUPED_TIER_KEYS.has(key)) return key;
  const normalized = String(item?.planName ?? '')
    .trim()
    .toLowerCase();
  if (GROUPED_TIER_KEYS.has(normalized)) return normalized;
  if (/\bstarter\b/i.test(String(item?.planName ?? '')) || /\brtx\s*3090\b/i.test(String(item?.planName ?? ''))) {
    return 'starter';
  }
  if (/\bstudio\b/i.test(String(item?.planName ?? ''))) return 'studio';
  if (/\bpro\b/i.test(String(item?.planName ?? '')) || /\brtx\s*4090\b/i.test(String(item?.planName ?? ''))) {
    return 'pro';
  }
  console.warn('[resolvePlanTierKey] unrecognized plan, skipping tier dump-to-pro:', item?.planName);
  return null;
}

export function groupInventoryPlansByTier(items) {
  const grouped = { starter: [], pro: [], studio: [] };

  for (const item of items ?? []) {
    const tierKey = resolvePlanTierKey(item);
    if (tierKey && grouped[tierKey]) grouped[tierKey].push(item);
  }

  for (const tierKey of PLAN_ORDER) {
    grouped[tierKey].sort(comparePlansByBurnOrder);
  }

  return grouped;
}

export function resolveActiveTierKey(grouped, activePlan) {
  if (activePlan?.planKey && GROUPED_TIER_KEYS.has(activePlan.planKey)) {
    return activePlan.planKey;
  }
  if (activePlan?.planName) {
    const key = getPlanKeyFromName(activePlan.planName) ?? resolvePlanTierKey(activePlan);
    if (key) return key;
  }
  for (const tierKey of PLAN_ORDER) {
    if (grouped[tierKey]?.some((plan) => plan.isActive && plan.usable)) return tierKey;
  }
  return null;
}

export function pickTierActivationTarget(tierPlans) {
  const usable = (tierPlans ?? []).filter((plan) => plan.usable);
  if (!usable.length) return null;
  const active = usable.find((plan) => plan.isActive);
  return active ?? usable[0];
}

export { PLAN_ORDER, getPlanNameFromKey };