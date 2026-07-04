import { formatCurrency } from '@/lib/gpu-pricing';
import {
  inventoryToSelectorPlan,
  listUserPlans,
  parseInventoryId,
} from '@/lib/user-plan-inventory';

/**
 * @param {import('@supabase/supabase-js').SupabaseClient} supabaseAdmin
 * @param {string} userId
 */
export async function fetchUserActivePlans(supabaseAdmin, userId) {
  const { usable } = await listUserPlans(supabaseAdmin, userId);
  const plans = usable.map(inventoryToSelectorPlan);
  return { plans, count: plans.length };
}

export function findActivePlanSelection(plans, { planId, type, plan, inventoryId }) {
  if (inventoryId) {
    const parsedInventoryId = parseInventoryId(inventoryId);
    const byInventory = parsedInventoryId
      ? plans.find((item) => item.inventoryId === parsedInventoryId)
      : undefined;
    if (byInventory) return byInventory;
  }

  return plans.find((item) => {
    if (planId && item.id === planId) return true;
    if (type && plan && item.type === type && item.plan === plan) return true;
    return false;
  });
}

export function formatPlanPriceLabel(pricePerHour) {
  if (!pricePerHour) return 'Miễn phí';
  return `${formatCurrency(pricePerHour)}/h`;
}

export { normalizePlanKey, parseInventoryId } from '@/lib/user-plan-inventory';